const { json } = require('./_lib');
module.exports = (req, res) => json(res, 200, { ok:true, ts:new Date().toISOString(), backend: process.env.SUPABASE_URL ? 'supabase' : 'sin_configurar' });
