/* GET /api/leads.csv?pin= → descarga CSV (Excel/Sheets). Funciona con local o Supabase. */
const { sb, tieneSupabase, json, pinOk, LEADS_F, leerJsonl } = require('./_lib');
const COLS = ['created_at','folio','tipo','estado','nombre','telefono','email','equipo','marca','modelo','falla','detalle','domicilio','colonia','contacto','cita_fecha','cita_hora','rango_precio','origen','utm','notas'];
const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
module.exports = async function handler(req, res) {
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
    let rows;
    if (tieneSupabase()){
      rows = await sb(`/${process.env.SUPABASE_TABLE || 'leads'}?select=*&order=created_at.desc&limit=5000`);
    } else {
      rows = leerJsonl(LEADS_F()).sort((a,b) => String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,5000);
    }
    const csv = '\uFEFF' + [COLS.join(',')].concat(rows.map(r => COLS.map(c => esc(r[c])).join(','))).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="leads.csv"');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(csv);
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
