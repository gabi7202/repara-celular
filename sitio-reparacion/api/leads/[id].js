/* PATCH/DELETE /api/leads/:id  (requiere ?pin=) — funciona con local y Supabase */
const { sb, tieneSupabase, json, pinOk, ESTADOS, LEADS_F, leerJsonl, escribirJsonl } = require('../_lib');
module.exports = async function handler(req, res) {
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
    const id = req.query.id;
    if (tieneSupabase()){
      const t = process.env.SUPABASE_TABLE || 'leads';
      const filtro = `/${t}?or=(id.eq.${encodeURIComponent(id)},folio.eq.${encodeURIComponent(id)})`;
      if (req.method === 'PATCH'){
        const body = req.body || {};
        const patch = { updated_at: new Date().toISOString() };
        if (body.estado) patch.estado = ESTADOS.includes(body.estado) ? body.estado : 'nuevo';
        if (body.notas !== undefined) patch.notas = String(body.notas).slice(0, 1000);
        const rows = await sb(filtro, { method:'PATCH', headers:{ Prefer:'return=representation' }, body: JSON.stringify(patch) });
        return json(res, 200, { ok:true, lead: (rows && rows[0]) || null });
      }
      if (req.method === 'DELETE'){ await sb(filtro, { method:'DELETE' }); return json(res, 200, { ok:true, borrado: id }); }
      res.setHeader('Allow','PATCH,DELETE'); return json(res, 405, { ok:false });
    }
    /* modo local: reescribir el jsonl filtrando/editando la línea coincidente */
    let all = leerJsonl(LEADS_F());
    const match = l => String(l.id) === String(id) || String(l.folio) === String(id);
    if (req.method === 'PATCH'){
      const body = req.body || {};
      let hit = null;
      all = all.map(l => {
        if (!match(l)) return l;
        const upd = Object.assign({}, l, { updated_at: new Date().toISOString() });
        if (body.estado && ESTADOS.includes(body.estado)) upd.estado = body.estado;
        if (body.notas !== undefined) upd.notas = String(body.notas).slice(0, 1000);
        hit = upd; return upd;
      });
      escribirJsonl(LEADS_F(), all);
      return json(res, 200, { ok:true, lead: hit });
    }
    if (req.method === 'DELETE'){
      const before = all.length;
      all = all.filter(l => !match(l));
      escribirJsonl(LEADS_F(), all);
      return json(res, 200, { ok:true, borrado: id, eliminados: before - all.length });
    }
    res.setHeader('Allow','PATCH,DELETE'); return json(res, 405, { ok:false });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
