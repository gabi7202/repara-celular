/* Helpers compartidos por las funciones de Vercel (los archivos con _ no se enrutan).
   Backend SIN Supabase: almacenamiento en el filesystem efímero de la función
   (/tmp/leads.jsonl). En serverless los /tmp son por instancia y temporales —
   para historial duradero usa LEAD_WEBHOOK (WhatsApp/email) o reactiva SUPABASE_URL.
   Si defines SUPABASE_URL + SUPABASE_SERVICE_KEY como variables de entorno,
   este mismo código cambia automáticamente a Supabase (opcional, no obligatorio). */
const fs = require('fs');
const ESTADOS = ['nuevo','contactado','cotizado','autorizado','en_reparacion','entregado','perdido'];
const TIPOS   = ['diagnostico','cotizacion','callback','cita','oferta','boleto','otro'];

/* ── Almacenamiento local (default en Vercel gratis) ─────────────────── */
const DATA_DIR = process.env.DATA_DIR || '/tmp/tapatech';
const LEADS_F  = () => DATA_DIR + '/leads.jsonl';
const EVENTOS_F = () => DATA_DIR + '/eventos.jsonl';
function ensureDir(){ try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){} }
function leerJsonl(f){ try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch(e){ return null; } }).filter(Boolean); } catch(e){ return []; } }
function anexarJsonl(f, obj){ ensureDir(); fs.appendFileSync(f, JSON.stringify(obj) + '\n'); }
function escribirJsonl(f, arr){ ensureDir(); const tmp = f + '.tmp'; fs.writeFileSync(tmp, arr.map(x => JSON.stringify(x)).join('\n') + (arr.length ? '\n' : '')); fs.renameSync(tmp, f); }

/* ── Modo Supabase opcional (solo si las env vars existen) ───────────── */
function tieneSupabase(){ return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)); }
async function sb(path, opts = {}){
  const base = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(base + path, Object.assign({
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }
  }, opts));
  const txt = await r.text();
  let body = null; try { body = txt ? JSON.parse(txt) : null; } catch(e){ body = txt; }
  if (!r.ok) throw Object.assign(new Error('Supabase ' + r.status + ': ' + txt.slice(0, 200)), { status: 502 });
  return body;
}
const json = (res, code, obj) => { res.status(code); res.setHeader('Cache-Control','no-store'); return res.json(obj); };
const pinOk = req => (req.query && req.query.pin) === (process.env.ADMIN_PIN || 'cambia-este-pin');
const ip = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconocida';

function normalizar(b, ipAddr){
  const s = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));
  const out = {
    folio: s(b.folio, 40) || ('TT-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).slice(2,6).toUpperCase()),
    tipo: TIPOS.includes(b.tipo) ? b.tipo : 'otro',
    estado: ESTADOS.includes(b.estado) ? b.estado : 'nuevo',
    nombre: s(b.nombre, 120), telefono: s(String(b.telefono || '').replace(/\D/g,''), 15), telefono_texto: s(b.telefono_texto, 30),
    email: s(b.email, 160), equipo: s(b.equipo, 40), marca: s(b.marca, 60), modelo: s(b.modelo, 80),
    falla: s(b.falla, 140), detalle: s(b.detalle, 1200), domicilio: !!b.domicilio, colonia: s(b.colonia, 200),
    contacto: s(b.contacto, 20), cita_fecha: s(b.cita_fecha, 10), cita_hora: s(b.cita_hora, 5),
    servicio: s(b.servicio, 90), calidad: s(b.calidad, 40), rango_precio: s(b.rango_precio, 90), tiempo: s(b.tiempo, 40),
    extras: s(b.extras, 160), oferta: s(b.oferta, 160), consentimiento: !!b.consentimiento, notas: s(b.notas, 1000),
    origen: s(b.origen, 300), referrer: s(b.referrer, 300), pagina: s(b.pagina, 160), idioma: s(b.idioma, 12),
    pantalla: s(b.pantalla, 16), online: b.online === undefined ? null : !!b.online,
    utm: typeof b.utm === 'object' ? JSON.stringify(b.utm).slice(0,500) : s(b.utm, 500),
    ua: s(b.ua, 260), ip: ipAddr, created_at: b.created_at || new Date().toISOString()
  };
  if (out.telefono && out.telefono.length === 12 && out.telefono.startsWith('52')) out.telefono = out.telefono.slice(2);
  return out;
}
async function webhook(lead){
  const url = process.env.LEAD_WEBHOOK; if (!url) return;
  try {
    const texto = `🔔 Lead (${lead.tipo}) ${lead.folio}\n${lead.nombre || '—'} · ${lead.telefono || '—'}\n${[lead.equipo, lead.marca, lead.modelo].filter(Boolean).join(' ')}\nFalla: ${lead.falla || '—'}\n${lead.detalle || ''}${lead.domicilio ? '\nDomicilio: ' + (lead.colonia || '') : ''}${lead.cita_fecha ? '\nCita: ' + lead.cita_fecha + ' ' + (lead.cita_hora || '') : ''}`;
    await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ text: texto, lead }) });
  } catch(e){ console.error('webhook:', e.message); }
}
module.exports = { sb, tieneSupabase, json, pinOk, ip, normalizar, webhook, ESTADOS, TIPOS, DATA_DIR, LEADS_F, EVENTOS_F, leerJsonl, anexarJsonl, escribirJsonl };

/* ── Groq: clave solo en el servidor ─────────────────────────────────── */
const GROQ = 'https://api.groq.com/openai/v1';
function groqKey(req){
  const k = process.env.GROQ_API_KEY;
  if (!k) { const e = new Error('Define GROQ_API_KEY en las variables de entorno (gratis en console.groq.com).'); e.status = 503; e.code = 'sin_clave'; throw e; }
  return k;
}
async function groq(path, body, key, extraHeaders){
  const r = await fetch(GROQ + path, { method:'POST', headers: Object.assign({ 'Content-Type':'application/json', Authorization:'Bearer ' + key }, extraHeaders || {}), body });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok){ const t = await r.text(); const e = new Error('groq_' + r.status + ': ' + t.slice(0, 180)); e.status = r.status >= 500 ? 502 : r.status; throw e; }
  return ct.includes('json') ? r.json() : Buffer.from(await r.arrayBuffer());
}
module.exports.groq = groq;
module.exports.groqKey = groqKey;
