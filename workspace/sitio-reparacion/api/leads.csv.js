/* GET /api/leads.csv?pin= → descarga CSV (Excel/Sheets) */
const { sb, json, pinOk } = require('./_lib');
const COLS = ['created_at','folio','tipo','estado','nombre','telefono','email','equipo','marca','modelo','falla','detalle','domicilio','colonia','contacto','cita_fecha','cita_hora','rango_precio','origen','utm','notas'];
const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
module.exports = async function handler(req, res) {
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
    const t = process.env.SUPABASE_TABLE || 'leads';
    const rows = await sb(`/${t}?select=*&order=created_at.desc&limit=5000`);
    const csv = '\uFEFF' + [COLS.join(',')].concat(rows.map(r => COLS.map(c => esc(r[c])).join(','))).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="leads.csv"');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(csv);
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
