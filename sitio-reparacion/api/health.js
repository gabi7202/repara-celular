const { json, tieneSupabase } = require('./_lib');
module.exports = (req, res) => json(res, 200, { ok:true, ts:new Date().toISOString(), backend: tieneSupabase() ? 'supabase' : 'local' });
