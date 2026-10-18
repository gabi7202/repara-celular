#!/usr/bin/env node
/**
 * TapaTech — servidor sin dependencias (Node ≥ 18)
 * Sirve el sitio estático + API de leads (base de datos en JSONL).
 *
 *   node server.js                       → http://localhost:3000
 *   ADMIN_PIN=mipin node server.js       → panel /admin.html protegido
 *   LEAD_WEBHOOK=https://... node server.js  → reenvía cada lead (Slack/Sheets/WhatsApp Cloud)
 *
 * Rutas:
 *   POST   /api/leads            guarda un lead (público, con rate limit)
 *   GET    /api/leads?pin=       lista leads (solo con PIN)
 *   PATCH  /api/leads/:id        cambia estado / notas (solo con PIN)
 *   DELETE /api/leads/:id        borra un lead (solo con PIN)
 *   GET    /api/leads.csv?pin=   exporta CSV
 *   GET    /api/stats?pin=       métricas agregadas
 *   POST   /api/eventos          analítica propia (opcional)
 *   GET    /api/health           estado del servicio
 *
 * Almacenamiento: data/leads.jsonl (una línea JSON por lead) + data/eventos.jsonl.
 * Un respaldo data/backup-AAAA-MM-DD.jsonl se crea una vez al día.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');
/* Lupita: mismo cliente Groq resiliente (fallback de modelos + retries) que las
   funciones de Vercel. Los archivos _ no se enrutan como endpoint en Vercel y
   aquí solo se requieren como librería — cero duplicación de lógica. */
const { groqKey, clavesGroq, chatConFallback, sttConFallback, sanearModelo } = require('./api/_groq');
const { cotizarServer, parseSalida } = require('./api/_agente');

/* Carga .env sin dependencias (dotenv-style): claves → process.env.
   Las variables que ya existan en el entorno tienen prioridad sobre .env,
   y si no hay archivo .env el servidor arranca igual (producción usa las
   Environment Variables de Vercel, no un .env). */
(function cargarEnv(){
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const linea of txt.split(/\r?\n/)) {
      const l = linea.trim();
      if (!l || l.startsWith('#')) continue;
      const eq = l.indexOf('=');
      if (eq < 1) continue;
      const k = l.slice(0, eq).trim();
      let v = l.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (e) { /* .env opcional */ }
})();

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PORT = process.env.PORT || 3000;
const PIN = process.env.ADMIN_PIN || 'cambia-este-pin';
const WEBHOOK = process.env.LEAD_WEBHOOK || '';
const CORS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const LEADS = path.join(DATA, 'leads.jsonl');
const EVENTOS = path.join(DATA, 'eventos.jsonl');
const VISITAS = path.join(DATA, 'visitas.jsonl');
/* huella anónima IP+UA — misma fórmula que api/_lib.js en Vercel */
const LUPITA_FREQ = (process.env.LUPITA_FREQ || 'dia').toLowerCase();
const MS_PERIOD = LUPITA_FREQ === '3dias' ? 3 * 864e5 : 864e5;
function huella(ipAddr, ua){ return crypto.createHash('sha256').update((process.env.LUPITA_SAL || 'tapatech-lupita-v1') + '|' + ipAddr + '|' + String(ua||'').slice(0,120)).digest('hex').slice(0,32); }

const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.xml':'application/xml; charset=utf-8',
  '.woff2':'font/woff2', '.pdf':'application/pdf',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.weba':'audio/webm',
  '.md':'text/markdown; charset=utf-8', '.avif':'image/avif', '.webmanifest':'application/manifest+json; charset=utf-8'
};
const CAMPOS = ['folio','tipo','estado','nombre','telefono','telefono_texto','email','equipo','marca','modelo',
  'falla','detalle','domicilio','colonia','contacto','cita_fecha','cita_hora','servicio','calidad','rango_precio',
  'tiempo','extras','oferta','consentimiento','notas','origen','referrer','pagina','idioma','pantalla','online',
  'created_at','updated_at','ip','ua','utm'];

fs.mkdirSync(DATA, { recursive: true });
[LEADS, EVENTOS].forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, ''); });

/* ── utilidades ─────────────────────────────────────────────────────── */
const log = (...a) => console.log(new Date().toISOString(), ...a);
function leer(f){ try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch(e){ return null; } }).filter(Boolean); } catch(e){ return []; } }
function anexar(f, obj){
  fs.appendFileSync(f, JSON.stringify(obj) + '\n');
  const hoy = new Date().toISOString().slice(0, 10);
  const bak = path.join(DATA, 'backup-' + hoy + '.jsonl');
  if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);           // respaldo diario
}
function escribir(f, arr){ const tmp = f + '.tmp'; fs.writeFileSync(tmp, arr.map(x => JSON.stringify(x)).join('\n') + (arr.length ? '\n' : '')); fs.renameSync(tmp, f); }
function json(res, code, obj, req){
  const body = JSON.stringify(obj);
  const heads = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow' };
  if (CORS.length && req && CORS.includes(req.headers.origin || '')) { heads['Access-Control-Allow-Origin'] = req.headers.origin; heads['Vary'] = 'Origin'; }
  res.writeHead(code, heads); res.end(body);
}
function limpiar(v){ return typeof v === 'string' ? v.slice(0, 2000) : v; }
function normalizar(lead, ip){
  const out = {};
  CAMPOS.forEach(k => { if (lead[k] !== undefined) out[k] = limpiar(lead[k]); });
  out.id = out.id || ('ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  out.folio = String(out.folio || ('TT-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).slice(2,6).toUpperCase()));
  out.tipo = ['diagnostico','cotizacion','callback','cita','oferta','boleto','otro'].includes(out.tipo) ? out.tipo : 'otro';
  out.estado = ['nuevo','contactado','cotizado','autorizado','en_reparacion','entregado','perdido'].includes(out.estado) ? out.estado : 'nuevo';
  out.nombre = String(out.nombre || '').slice(0, 120);
  out.telefono = String(out.telefono || '').replace(/\D/g,'').slice(0, 15);
  out.email = String(out.email || '').slice(0, 160);
  out.ip = ip; out.ip_hash = huella(ip, lead && lead.ua); out.created_at = out.created_at || new Date().toISOString();
  out.updated_at = new Date().toISOString();
  if (typeof out.utm === 'object' && out.utm) out.utm = JSON.stringify(out.utm).slice(0, 500);
  return out;
}
/* rate limit simple por IP (anti spam) */
const hits = new Map();
function permitir(ip, max = 25, ventanaMs = 60000){
  const t = Date.now(), arr = (hits.get(ip) || []).filter(x => t - x < ventanaMs);
  arr.push(t); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length <= max;
}
async function webhook(lead){
  if (!WEBHOOK) return;
  try {
    const texto = `🔔 Lead nuevo (${lead.tipo}) folio ${lead.folio}\n${lead.nombre || '—'} · ${lead.telefono || '—'}\n${lead.equipo || ''} ${lead.marca || ''} ${lead.modelo || ''}\nFalla: ${lead.falla || '—'}\n${lead.detalle || ''}\n${lead.domicilio ? 'Domicilio: ' + (lead.colonia || '') : 'Lleva al local'}${lead.cita_fecha ? '\nCita: ' + lead.cita_fecha + ' ' + (lead.cita_hora || '') : ''}`;
    await fetch(WEBHOOK, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ text: texto, lead }) });
  } catch(e){ log('webhook falló:', e.message); }
}
function csv(arr){
  const cols = ['created_at','folio','tipo','estado','nombre','telefono','email','equipo','marca','modelo','falla','detalle','domicilio','colonia','contacto','cita_fecha','cita_hora','rango_precio','origen','utm','notas'];
  const esc = v => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  return [cols.join(',')].concat(arr.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
}
function stats(arr){
  const hoy = new Date().toISOString().slice(0,10);
  const por = (k) => arr.reduce((a, r) => (a[r[k] || '—'] = (a[r[k] || '—'] || 0) + 1, a), {});
  const ultimos7 = arr.filter(r => (r.created_at || '').slice(0,10) >= new Date(Date.now() - 7*864e5).toISOString().slice(0,10));
  return {
    total: arr.length, hoy: arr.filter(r => (r.created_at||'').slice(0,10) === hoy).length,
    ultimos7: ultimos7.length, por_tipo: por('tipo'), por_estado: por('estado'),
    por_equipo: por('equipo'), por_falla: por('falla'),
    domicilio: arr.filter(r => r.domicilio === true).length,
    con_cita: arr.filter(r => r.cita_fecha).length,
    conversion: {
      autorizados: arr.filter(r => ['autorizado','en_reparacion','entregado'].includes(r.estado)).length,
      perdidos: arr.filter(r => r.estado === 'perdido').length
    }
  };
}
function leerBody(req, limite = 64 * 1024){
  return new Promise((resolve, reject) => {
    let size = 0, buf = '';
    req.on('data', c => { size += c.length; if (size > limite){ reject(new Error('payload_too_large')); req.destroy(); return; } buf += c; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch(e){ reject(new Error('json_invalido')); } });
    req.on('error', reject);
  });
}
const auth = q => q.get('pin') === PIN;

/* ── servidor ───────────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const q = u.searchParams;

  if (CORS.length && req.method === 'OPTIONS'){
    res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' });
    return res.end();
  }

  /* ── API ── */
  if (u.pathname === '/api/health'){
    const kg = process.env.GROQ_API_KEY ? String(process.env.GROQ_API_KEY).trim() : '';
    return json(res, 200, { ok:true, ts:new Date().toISOString(), leads: leer(LEADS).length, backend:'local',
      groq: process.env.GROQ_API_KEY ? 'conectada' : 'FALTA_GROQ_API_KEY',
      groq_detalle: { estado: process.env.GROQ_API_KEY ? 'conectada' : 'FALTA_GROQ_API_KEY',
        info:{ longitud: kg.length, empieza_gsk:/^gsk_/i.test(kg), espacios_dentro:/\s/.test(kg) } },
      node: process.version }, req);
  }

  if (u.pathname === '/api/leads' && req.method === 'POST'){
    if (!permitir(ip)) return json(res, 429, { ok:false, error:'demasiadas_solicitudes' }, req);
    let body; try { body = await leerBody(req); } catch(e){ return json(res, 400, { ok:false, error:e.message }, req); }
    const lead = normalizar(body, ip);
    /* Validación mínima: sin datos útiles no se guarda (evita basura en la BD) */
    const anonimo = ['cotizacion','boleto'].includes(lead.tipo);
    if (!anonimo){
      if (!lead.nombre || lead.nombre.length < 2) return json(res, 400, { ok:false, error:'nombre_requerido' }, req);
      if (!lead.telefono || lead.telefono.length < 7) return json(res, 400, { ok:false, error:'telefono_requerido' }, req);
    } else if (!lead.modelo && !lead.servicio){
      return json(res, 400, { ok:false, error:'datos_insuficientes' }, req);
    }
    anexar(LEADS, lead); webhook(lead);
    log('lead', lead.tipo, lead.folio, lead.nombre || '', lead.telefono || '');
    return json(res, 201, { ok:true, id: lead.id, folio: lead.folio }, req);
  }
  if (u.pathname === '/api/leads' && req.method === 'GET'){
    if (!auth(q)) return json(res, 401, { ok:false, error:'pin_invalido' }, req);
    let arr = leer(LEADS).reverse();
    if (q.get('tipo')) arr = arr.filter(r => r.tipo === q.get('tipo'));
    if (q.get('estado')) arr = arr.filter(r => r.estado === q.get('estado'));
    if (q.get('desde')) arr = arr.filter(r => (r.created_at||'') >= q.get('desde'));
    if (q.get('q')){ const s = q.get('q').toLowerCase(); arr = arr.filter(r => JSON.stringify(r).toLowerCase().includes(s)); }
    const limit = Math.min(parseInt(q.get('limit') || '500', 10) || 500, 5000);
    return json(res, 200, { ok:true, total: arr.length, leads: arr.slice(0, limit) }, req);
  }
  if (u.pathname === '/api/leads.csv' && req.method === 'GET'){
    if (!auth(q)) return json(res, 401, { ok:false, error:'pin_invalido' }, req);
    res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="leads.csv"', 'Cache-Control':'no-store' });
    return res.end('\uFEFF' + csv(leer(LEADS).reverse()));
  }
  if (u.pathname === '/api/stats' && req.method === 'GET'){
    if (!auth(q)) return json(res, 401, { ok:false, error:'pin_invalido' }, req);
    return json(res, 200, { ok:true, stats: stats(leer(LEADS)) }, req);
  }
  const mId = u.pathname.match(/^\/api\/leads\/([\w-]+)$/);
  if (mId && (req.method === 'PATCH' || req.method === 'DELETE')){
    if (!auth(q)) return json(res, 401, { ok:false, error:'pin_invalido' }, req);
    const arr = leer(LEADS), i = arr.findIndex(r => r.id === mId[1] || r.folio === mId[1]);
    if (i < 0) return json(res, 404, { ok:false, error:'no_encontrado' }, req);
    if (req.method === 'DELETE'){ arr.splice(i, 1); escribir(LEADS, arr); return json(res, 200, { ok:true, borrado: mId[1] }, req); }
    let body; try { body = await leerBody(req); } catch(e){ return json(res, 400, { ok:false, error:e.message }, req); }
    if (body.estado) arr[i].estado = normalizar({ estado: body.estado }).estado;
    if (body.notas !== undefined) arr[i].notas = String(body.notas).slice(0, 1000);
    arr[i].updated_at = new Date().toISOString();
    escribir(LEADS, arr); log('actualizado', arr[i].folio, arr[i].estado);
    return json(res, 200, { ok:true, lead: arr[i] }, req);
  }
  if (u.pathname === '/api/eventos' && req.method === 'POST'){
    if (!permitir(ip, 120)) return json(res, 429, { ok:false }, req);
    let body; try { body = await leerBody(req, 8 * 1024); } catch(e){ return json(res, 400, { ok:false }, req); }
    anexar(EVENTOS, { ev: String(body.event || body.ev || '').slice(0, 60), d: body.data || body.payload || {}, ts: new Date().toISOString(), ip });
    return json(res, 201, { ok:true }, req);
  }

  /* ── Lupita · remarketing: /api/visitas (misma semántica que Vercel) ── */
  if (u.pathname === '/api/visitas'){
    if (req.method === 'GET'){
      if (!auth(q)) return json(res, 401, { ok:false, error:'pin_invalido' }, req);
      const rows = leer(VISITAS);
      return json(res, 200, { ok:true, total: rows.length, visitas: rows.slice(-400).reverse() }, req);
    }
    if (req.method !== 'POST') return json(res, 405, { ok:false }, req);
    if (!permitir(ip, 120)) return json(res, 429, { ok:false }, req);
    let body; try { body = await leerBody(req, 8 * 1024); } catch(e){ return json(res, 400, { ok:false }, req); }
    const accion = String(body.accion || 'visita');
    const rows = leer(VISITAS);
    const now = Date.now();
    const h = body.hash ? String(body.hash).slice(0,64) : huella(ip, req.headers['user-agent']);
    if (accion === 'avisado'){
      const v = rows.find(r => r.h === h);
      if (v){ v.ultimo_aviso = now; v.avisos = (v.avisos||0)+1; v.contexto_aviso = String(body.contexto||'').slice(0,200); escribir(VISITAS, rows); }
      return json(res, 201, { ok:true }, req);
    }
    if (accion === 'clic_notif'){
      const v = rows.find(r => r.h === h);
      if (v){ v.retornos = (v.retornos||0)+1; v.ultimo_retorno = new Date().toISOString(); escribir(VISITAS, rows); }
      return json(res, 201, { ok:true }, req);
    }
    let v = rows.find(r => r.h === h);
    const esNueva = !v;
    if (esNueva){ v = { h, vistas: 0, created_at:new Date().toISOString() }; rows.push(v); }
    v.vistas = (v.vistas||0)+1; v.ultima = new Date().toISOString();
    if (body.datos && typeof body.datos === 'object'){
      v.ctx = { pagina:String(body.datos.pagina||'').slice(0,120), falla:String(body.datos.falla||'').slice(0,90), origen:String(body.datos.origen||'').slice(0,60) };
    }
    const leads = leer(LEADS);
    let convirtio = false;
    try { convirtio = leads.some(l => l.ip_hash === h); } catch(e){}
    if (convirtio) v.convirtio = true;
    const sinAvisoReciente = !v.ultimo_aviso || (now - v.ultimo_aviso) >= MS_PERIOD;
    const notificar = !convirtio && !esNueva && v.vistas >= 2 && sinAvisoReciente && (v.avisos||0) < 5;
    escribir(VISITAS, rows.length > 2000 ? rows.slice(-2000) : rows);
    return json(res, 201, { ok:true, nueva: esNueva, notificar, freq: LUPITA_FREQ }, req);
  }

  /* ── IA: Groq (LLM + Whisper) y TTS neuronal — MISMA lógica resiliente que api/ en Vercel ── */
  if (u.pathname === '/api/chat' && req.method === 'POST'){
    if (!permitir(ip, 40, 60000)) return json(res, 429, { ok:false, error:'demasiadas_solicitudes' }, req);
    let key; try { key = groqKey(req); } catch(e){ return json(res, e.status || 503, { ok:false, error:e.code || 'sin_clave', detalle:String(e.message).slice(0,200) }, req); }
    let body; try { body = await leerBody(req, 256 * 1024); } catch(e){ return json(res, 400, { ok:false, error:e.message }, req); }
    const mensajes = Array.isArray(body.mensajes) ? body.mensajes.slice(-20).map(m => ({
      role: ['system','user','assistant','tool'].includes(m.role) ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, 8000) : (m.content || null),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {})
    })) : [];
    if (!mensajes.length) return json(res, 400, { ok:false, error:'mensajes_vacios' }, req);
    /* prompt maestro desde disco (cache 5 min), igual que api/chat.js en Vercel */
    let maestro = '';
    try {
      const crudo = fs.readFileSync(path.join(ROOT, 'datos', 'prompt-agente.md'), 'utf8');
      const i = crudo.lastIndexOf('===PROMPT==='), j = i >= 0 ? crudo.indexOf('===FIN===', i) : -1;
      maestro = (i >= 0 && j > i) ? crudo.slice(i + 12, j).trim() : crudo.trim();
    } catch(e){ log('prompt maestro no encontrado:', e.message); }
    const sistema = [maestro, String(body.sistema || '').slice(0, 12000)].filter(Boolean).join('\n\n')
                  + (body.contexto ? '\n\n' + String(body.contexto).slice(0, 12000) : '');
    mensajes.unshift({ role:'system', content: sistema });
    const tools = Array.isArray(body.herramientas) ? body.herramientas.filter(t => t && t.type === 'function' && t.function && t.function.name).slice(0, 12) : undefined;
    const payloadBase = {
      messages: mensajes,
      temperature: Number.isFinite(body.temperature) ? Math.min(1.2, Math.max(0, body.temperature)) : 0.45,
      max_tokens: Math.min(900, parseInt(body.max_tokens || 400, 10) || 400),
      top_p: Number.isFinite(body.top_p) ? body.top_p : 0.9,
      stream: false,
      ...(tools && tools.length ? { tools, tool_choice:'auto' } : {})
    };
    try {
      let d = null, jsonFormat = true;
      try { d = await chatConFallback(Object.assign({ response_format:{ type:'json_object' } }, payloadBase), body.modelo, key, req); }
      catch(e){ if (e.code === 'sin_clave') throw e; jsonFormat = false; d = await chatConFallback(payloadBase, body.modelo, key, req); }
      const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
      const sal = parseSalida(msg.content || '');
      log('chat', msg.tool_calls ? 'tool_calls:' + msg.tool_calls.map(t=>t.function.name).join(',') : (sal.decir||'').slice(0,60).replace(/\n/g,' '), '· modelo', d._modelo_usado);
      return json(res, 200, { ok:true, content: sal.decir, accion: sal.accion, tool_calls: msg.tool_calls || null,
        uso: d.usage || null, modelo: d._modelo_usado || '', json_format: jsonFormat }, req);
    } catch(e){
      const s = e.groqStatus || e.status || 502;
      /* 404 de Groq con "model_not_found" (modelo jubilado o sin acceso para
         esta cuenta) NO es un fallo del servidor: se reporta como 404 real,
         estable y con código propio, para que el navegador lo registre como
         modelo_no_disponible en vez del confuso llm_404_groq_fallo. */
      const modelNotFound = s === 404 && /does not exist|do not have access|model_not_found/i.test(String(e.message || ''));
      const code = (s === 401 || s === 403) ? 'clave_invalida'
        : s === 429 ? 'limite_groq'
        : modelNotFound ? 'modelo_no_disponible'
        : 'groq_fallo';
      log('groq chat falló:', s, String(e.message).slice(0,160));
      return json(res, s >= 400 && s < 600 ? s : 502, { ok:false, error:code, detalle:String(e.message).slice(0,200) }, req);
    }
  }

  if (u.pathname === '/api/stt' && req.method === 'POST'){
    if (!permitir(ip, 40, 60000)) return json(res, 429, { ok:false, error:'demasiadas_solicitudes' }, req);
    let key; try { key = groqKey(req); } catch(e){ return json(res, e.status || 503, { ok:false, error:e.code || 'sin_clave' }, req); }
    let body; try { body = await leerBody(req, 6 * 1024 * 1024); } catch(e){ return json(res, 413, { ok:false, error:'audio_demasiado_grande' }, req); }
    if (!body.audio_base64) return json(res, 400, { ok:false, error:'audio_faltante' }, req);
    let buf; try { buf = Buffer.from(String(body.audio_base64).replace(/^data:[^,]+,/,'').slice(0, 5.5 * 1024 * 1024), 'base64'); } catch(e){ return json(res, 400, { ok:false, error:'audio_invalido' }, req); }
    const mime = String(body.mime || 'audio/webm');
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const formFactory = (model) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
      fd.append('model', model);
      fd.append('language', String(body.idioma || 'es').slice(0, 8));
      fd.append('response_format', 'json');
      fd.append('temperature', '0');
      fd.append('no_speech_threshold', '0.6');
      fd.append('compression_ratio_threshold', '2.4');
      fd.append('logprob_threshold', '-1.0');
      return fd;
    };
    try {
      const d = await sttConFallback(formFactory, body.modelo || 'whisper-large-v3-turbo', key, req);
      log('stt', (d.text || '').slice(0, 70), '· modelo', d._modelo_usado);
      return json(res, 200, { ok:true, text: d.text || '', idioma: d.language || 'es', modelo: d._modelo_usado || '' }, req);
    } catch(e){
      const s = e.groqStatus || 502;
      log('groq stt', s, String(e.message).slice(0,160));
      return json(res, s >= 400 && s < 600 ? s : 502, { ok:false, error:(s === 401 || s === 403) ? 'clave_invalida' : 'groq_fallo', detalle: String(e.message).slice(0,200) }, req);
    }
  }

  if (u.pathname === '/api/tts' && req.method === 'POST'){
    if (!permitir(ip, 80, 60000)) return json(res, 429, { ok:false, error:'demasiadas_solicitudes' }, req);
    let body; try { body = await leerBody(req, 32 * 1024); } catch(e){ return json(res, 400, { ok:false, error:e.message }, req); }
    const texto = String(body.text || '').slice(0, 1200);
    if (!texto) return json(res, 400, { ok:false, error:'texto_faltante' }, req);
    /* 1) webhook TTS gratuito (Edge neuronal es-MX). Ver tools/tts-edge.py */
    const hook = process.env.TTS_WEBHOOK || (body.webhook || '');
    if (hook){
      try {
        const rh = await fetch(hook, { method:'POST', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ text: texto, voice: body.voice || 'es-MX-DaliaNeural', rate: body.rate || '+2%', pitch: body.pitch || '+4Hz', volume: body.volume || '100', format: body.formato || 'mp3', ssml: body.ssml || null }) });
        if (rh.ok){
          const buf = Buffer.from(await rh.arrayBuffer());
          if (buf.length > 400){
            res.writeHead(200, { 'Content-Type': rh.headers.get('content-type') || 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control':'no-store' });
            return res.end(buf);
          }
        } else log('tts webhook', rh.status);
      } catch(e){ log('tts webhook falló:', e.message); }
    }
    /* 2) PlayAI vía Groq — con normalización de voz/estilo y retries (igual que api/tts.js).
       Sanear modelos retirados: si el cliente pide uno jubilado (p. ej. openai/gpt-oss-*),
       se fuerza 'playai-tts' (los 4xx ya hacían caer el TTS entero con groq_fallo/502). */
    let key; try { key = groqKey(req); } catch(e){ return json(res, e.status || 503, { ok:false, error:e.code || 'sin_clave' }, req); }
    const clavesTts = clavesGroq(req); if (clavesTts.length) key = clavesTts[0];
    const colaClavesTts = clavesTts.slice(1);
    const ESTILOS_VALIDOS = ['Cheerful','Sincere','Efficient','Lively'];
    let voz = String(body.voice || 'Jennifer');
    let estilo = body.style ? String(body.style).slice(0,30) : null;
    if (/^es[-_]/i.test(voz) || !/^[A-Z][a-z]+$/.test(voz)) voz = 'Jennifer';
    if (estilo && !ESTILOS_VALIDOS.includes(estilo)) estilo = null;
    const mCliente = sanearModelo(body.modelo);
    const modeloTts = (mCliente && /^playai/i.test(mCliente)) ? mCliente : 'playai-tts';
    try {
      let r = null, ultimoTxt = '';
      for (let intento = 0; intento < 4 && !r; intento++){
        const payload = { model: modeloTts, voice: voz,
          response_format: String(body.formato || 'mp3'), input: texto };
        if (estilo) payload.style = estilo;
        if (body.speed) payload.speed = Math.min(1.6, Math.max(0.6, Number(body.speed) || 1));
        const rr = await fetch('https://api.groq.com/openai/v1/audio/speech', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + key }, body: JSON.stringify(payload) });
        if (rr.ok){ r = rr; break; }
        ultimoTxt = (await rr.text().catch(()=>'')).slice(0,180);
        const s = rr.status;
        if ((s === 401 || s === 403) && colaClavesTts.length){ key = colaClavesTts.shift(); intento--; continue; }
        if (s === 404 || s === 400 || s === 422) continue;
        if ((s === 429 || s >= 500) && intento < 3){ await new Promise(z => setTimeout(z, 500)); continue; }
        log('groq tts', s, ultimoTxt.slice(0,140));
        return json(res, (s === 401 || s === 403) ? 503 : 502, { ok:false, error:(s === 401 || s === 403) ? 'sin_clave' : 'groq_fallo', detalle: ultimoTxt }, req);
      }
      if (!r) return json(res, 502, { ok:false, error:'groq_fallo', detalle: ultimoTxt }, req);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control':'no-store' });
      return res.end(buf);
    } catch(e){ return json(res, 502, { ok:false, error:'tts_no_disponible', detalle:String(e.message).slice(0,160) }, req); }
  }

  /* ── estáticos ── */
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok:false, error:'metodo_no_permitido' }, req);
  let p = decodeURIComponent(u.pathname);
  if (p === '/admin' || p === '/admin/') p = '/admin.html';
  const privado = (p === '/admin.html');
  if (p === '/boleto' || p === '/boleto/') p = '/index.html';
  let file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (p.endsWith('/')) file = path.join(file, 'index.html');
  let code = 200;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()){
    if (fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    else { file = path.join(ROOT, '404.html'); code = 404; if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); } }
  }
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const etag = '"' + stat.size + '-' + Math.round(stat.mtimeMs) + '"';
  const heads = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'ETag': etag,
    'Cache-Control': ext === '.html' ? 'public, max-age=0, must-revalidate' : (p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': privado ? 'no-referrer' : 'strict-origin-when-cross-origin',
    'X-Robots-Tag': privado ? 'noindex, nofollow, noarchive' : undefined,
    'X-Frame-Options': 'SAMEORIGIN'
  };
  if (!heads['X-Robots-Tag']) delete heads['X-Robots-Tag'];
  if (privado) heads['Cache-Control'] = 'no-store';
  if (req.headers['if-none-match'] === etag){ res.writeHead(304, heads); return res.end(); }
  let buf = fs.readFileSync(file);
  const aceptan = String(req.headers['accept-encoding'] || '');
  if (buf.length > 1024 && /\.(html|css|js|svg|json|xml|webmanifest|txt)$/.test(ext) && /gzip/.test(aceptan)){
    buf = zlib.gzipSync(buf, { level: 9 }); heads['Content-Encoding'] = 'gzip'; heads['Vary'] = 'Accept-Encoding';
  }
  heads['Content-Length'] = buf.length;
  res.writeHead(code, heads);
  res.end(req.method === 'HEAD' ? undefined : buf);
});

server.listen(PORT, () => {
  log(`TapaTech listo en http://localhost:${PORT}`);
  const avisoPin = process.env.ADMIN_PIN ? 'definido por env' : 'por defecto "cambia-este-pin" — ¡CÁMBIALO!';
  log('Panel: http://localhost:' + PORT + '/admin.html  (PIN ' + avisoPin + ')');
  log(`BD: ${LEADS}`);
});
