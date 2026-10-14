/* PATCH/DELETE /api/leads/:id  (requiere ?pin=) */
const { sb, json, pinOk, ESTADOS } = require('../_lib');
module.exports = async function handler(req, res) {
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
    const t = process.env.SUPABASE_TABLE || 'leads';
    const id = req.query.id;
    const filtro = `/${t}?or=(id.eq.${encodeURIComponent(id)},folio.eq.${encodeURIComponent(id)})`;
    if (req.method === 'PATCH'){
      const body = req.body || {};
      const patch = { updated_at: new Date().toISOString() };
      if (body.estado) patch.estado = ESTADOS.includes(body.estado) ? body.estado : 'nuevo';
      if (body.notas !== undefined) patch.notas = String(body.notas).slice(0, 1000);
      const rows = await sb(filtro, { method:'PATCH', headers:{ Prefer:'return=representation' }, body: JSON.stringify(patch) });
      return json(res, 200, { ok:true, lead: (rows && rows[0]) || null });
    }
    if (req.method === 'DELETE'){
      await sb(filtro, { method:'DELETE' });
      return json(res, 200, { ok:true, borrado: id });
    }
    res.setHeader('Allow','PATCH,DELETE'); return json(res, 405, { ok:false });
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
