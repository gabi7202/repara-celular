/* POST /api/eventos → analítica propia. Guarda en /tmp/tapatech/eventos.jsonl
   (o Supabase si defines las env vars). */
const { sb, tieneSupabase, json, ip, EVENTOS_F, anexarJsonl } = require('./_lib');
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
    const b = req.body || {};
    const ev = {
      ev: String(b.event || b.ev || '').slice(0, 60),
      data: b.data || b.payload || {},
      pagina: String(b.pagina || '').slice(0, 200),
      ip: ip(req), created_at: new Date().toISOString()
    };
    if (tieneSupabase()){
      await sb('/' + (process.env.SUPABASE_EVENTS_TABLE || 'eventos'), { method:'POST', body: JSON.stringify(ev) });
    } else {
      anexarJsonl(EVENTOS_F(), ev);
    }
    return json(res, 201, { ok:true });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
