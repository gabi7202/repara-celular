const { json, tieneSupabase } = require('./_lib');
/* Incluye el estado de GROQ_API_KEY para diagnosticar a Lupita sin exponer la clave. */
module.exports = (req, res) => json(res, 200, {
  ok: true,
  ts: new Date().toISOString(),
  backend: tieneSupabase() ? 'supabase' : 'local',
  groq: process.env.GROQ_API_KEY ? 'conectada' : 'FALTA_GROQ_API_KEY'
});
