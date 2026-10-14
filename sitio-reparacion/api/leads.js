/* POST /api/leads  → guarda un lead (público)
   GET  /api/leads  → lista (requiere ?pin=)
   Backend default: filesystem efímero de la función (/tmp/tapatech/leads.jsonl).
   Si defines SUPABASE_URL + SUPABASE_SERVICE_KEY, cambia automáticamente a Supabase. */
const { sb, tieneSupabase, json, pinOk, ip, normalizar, webhook, LEADS_F, leerJsonl, anexarJsonl } = require('./_lib');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS'){ res.setHeader('Allow','GET,POST,OPTIONS'); return res.status(204).end(); }

    if (req.method === 'POST'){
      const lead = normalizar(req.body || {}, ip(req));
      if (!lead.nombre && lead.tipo !== 'cotizacion' && lead.tipo !== 'boleto')
        return json(res, 400, { ok:false, error:'nombre_requerido' });
      let r = lead;
      if (tieneSupabase()){
        const rows = await sb('/' + (process.env.SUPABASE_TABLE || 'leads'), { method:'POST', headers:{ Prefer:'return=representation' }, body: JSON.stringify(lead) });
        r = (rows && rows[0]) || lead;
      } else {
        anexarJsonl(LEADS_F(), lead);
      }
      webhook(r);
      return json(res, 201, { ok:true, id: r.id, folio: r.folio, backend: tieneSupabase() ? 'supabase' : 'local' });
    }

    if (req.method === 'GET'){
      if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
      const q = req.query || {};
      let leads;
      if (tieneSupabase()){
        let path = '/' + (process.env.SUPABASE_TABLE || 'leads') + '?select=*&order=created_at.desc&limit=' + Math.min(parseInt(q.limit || '500', 10) || 500, 2000);
        if (q.tipo)   path += '&tipo=eq.' + encodeURIComponent(q.tipo);
        if (q.estado) path += '&estado=eq.' + encodeURIComponent(q.estado);
        if (q.desde)  path += '&created_at=gte.' + encodeURIComponent(q.desde);
        if (q.q){
          const t = encodeURIComponent(q.q);
          path += `&or=(nombre.ilike.*${t}*,telefono.ilike.*${t}*,modelo.ilike.*${t}*,folio.ilike.*${t}*,falla.ilike.*${t}*)`;
        }
        leads = await sb(path);
      } else {
        leads = leerJsonl(LEADS_F()).sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||'')));
        const lim = Math.min(parseInt(q.limit || '500', 10) || 500, 2000);
        if (q.tipo)   leads = leads.filter(l => l.tipo === q.tipo);
        if (q.estado) leads = leads.filter(l => l.estado === q.estado);
        if (q.desde)  leads = leads.filter(l => String(l.created_at||'') >= q.desde);
        if (q.q){ const t = q.q.toLowerCase(); leads = leads.filter(l => ['nombre','telefono','modelo','folio','falla'].some(k => String(l[k]||'').toLowerCase().includes(t))); }
        leads = leads.slice(0, lim);
      }
      return json(res, 200, { ok:true, total: leads.length, leads, backend: tieneSupabase() ? 'supabase' : 'local' });
    }
    res.setHeader('Allow','GET,POST,OPTIONS'); return json(res, 405, { ok:false, error:'metodo_no_permitido' });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
