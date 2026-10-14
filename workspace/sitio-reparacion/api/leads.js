/* POST /api/leads  → guarda un lead (público)
   GET  /api/leads  → lista (requiere ?pin=)  */
const { sb, json, pinOk, ip, normalizar, webhook } = require('./_lib');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS'){ res.setHeader('Allow','GET,POST,OPTIONS'); return res.status(204).end(); }

    if (req.method === 'POST'){
      const lead = normalizar(req.body || {}, ip(req));
      if (!lead.nombre && lead.tipo !== 'cotizacion' && lead.tipo !== 'boleto')
        return json(res, 400, { ok:false, error:'nombre_requerido' });
      const rows = await sb('/' + (process.env.SUPABASE_TABLE || 'leads'), { method:'POST', headers:{ Prefer:'return=representation' }, body: JSON.stringify(lead) });
      const r = (rows && rows[0]) || lead;
      webhook(r);
      return json(res, 201, { ok:true, id: r.id, folio: r.folio });
    }

    if (req.method === 'GET'){
      if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
      const q = req.query || {};
      let path = '/' + (process.env.SUPABASE_TABLE || 'leads') + '?select=*&order=created_at.desc&limit=' + Math.min(parseInt(q.limit || '500', 10) || 500, 2000);
      if (q.tipo)   path += '&tipo=eq.' + encodeURIComponent(q.tipo);
      if (q.estado) path += '&estado=eq.' + encodeURIComponent(q.estado);
      if (q.desde)  path += '&created_at=gte.' + encodeURIComponent(q.desde);
      if (q.q){
        const t = encodeURIComponent(q.q);
        path += `&or=(nombre.ilike.*${t}*,telefono.ilike.*${t}*,modelo.ilike.*${t}*,folio.ilike.*${t}*,falla.ilike.*${t}*)`;
      }
      const leads = await sb(path);
      return json(res, 200, { ok:true, total: leads.length, leads });
    }
    res.setHeader('Allow','GET,POST,OPTIONS'); return json(res, 405, { ok:false, error:'metodo_no_permitido' });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
