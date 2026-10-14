/* Helpers compartidos por las funciones de Vercel (los archivos con _ no se enrutan).
   Backend: Supabase (Postgres) vía REST con la SERVICE KEY (solo servidor). */
const ESTADOS = ['nuevo','contactado','cotizado','autorizado','en_reparacion','entregado','perdido'];
const TIPOS   = ['diagnostico','cotizacion','callback','cita','oferta','boleto','otro'];

function cfg(){
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY'), { status: 500 });
  return { base: url.replace(/\/$/, '') + '/rest/v1', key, table: process.env.SUPABASE_TABLE || 'leads' };
}
async function sb(path, opts = {}){
  const c = cfg();
  const r = await fetch(c.base + path, Object.assign({
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' }
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
module.exports = { sb, cfg, json, pinOk, ip, normalizar, webhook, ESTADOS, TIPOS };

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
