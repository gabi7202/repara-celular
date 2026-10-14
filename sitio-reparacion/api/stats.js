/* GET /api/stats?pin= → métricas agregadas */
const { sb, json, pinOk } = require('./_lib');
module.exports = async function handler(req, res) {
  try {
    if (!pinOk(req)) return json(res, 401, { ok:false, error:'pin_invalido' });
    const t = process.env.SUPABASE_TABLE || 'leads';
    const all = await sb(`/${t}?select=tipo,estado,equipo,falla,domicilio,cita_fecha,created_at&limit=5000`);
    const hoy = new Date().toISOString().slice(0,10);
    const d7 = new Date(Date.now() - 7*864e5).toISOString().slice(0,10);
    const por = k => all.reduce((a,r) => (a[r[k]||'—'] = (a[r[k]||'—']||0)+1, a), {});
    return json(res, 200, { ok:true, stats:{
      total: all.length,
      hoy: all.filter(r => (r.created_at||'').slice(0,10) === hoy).length,
      ultimos7: all.filter(r => (r.created_at||'').slice(0,10) >= d7).length,
      por_tipo: por('tipo'), por_estado: por('estado'), por_equipo: por('equipo'), por_falla: por('falla'),
      domicilio: all.filter(r => r.domicilio).length,
      con_cita: all.filter(r => r.cita_fecha).length,
      conversion: { autorizados: all.filter(r => ['autorizado','en_reparacion','entregado'].includes(r.estado)).length,
                    perdidos: all.filter(r => r.estado === 'perdido').length }
    }});
  } catch(e){ return json(res, e.status || 500, { ok:false, error:e.message }); }
};
