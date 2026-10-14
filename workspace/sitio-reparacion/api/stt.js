/* POST /api/stt → Groq Whisper (audio en base64 dentro de JSON, sin multipart). */
const { json, groqKey } = require('./_lib');
const GROQ = 'https://api.groq.com/openai/v1';
module.exports = async function handler(req, res) {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
  try {
    const key = groqKey(req);
    const b = req.body || {};
    if (!b.audio_base64) return json(res, 400, { ok:false, error:'audio_faltante' });
    const buf = Buffer.from(String(b.audio_base64).slice(0, 5.5 * 1024 * 1024), 'base64');
    if (!buf.length) return json(res, 400, { ok:false, error:'audio_vacio' });
    const mime = String(b.mime || 'audio/webm');
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
    fd.append('model', String(b.modelo || 'whisper-large-v3-turbo').slice(0, 60));
    fd.append('language', String(b.idioma || 'es').slice(0, 8));
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    const r = await fetch(GROQ + '/audio/transcriptions', { method:'POST', headers:{ Authorization:'Bearer ' + key }, body: fd });
    const t = await r.text();
    if (!r.ok){ const e = new Error('groq_' + r.status + ': ' + t.slice(0,180)); e.status = r.status >= 500 ? 502 : r.status; throw e; }
    const d = JSON.parse(t);
    return json(res, 200, { ok:true, text: d.text || '', idioma: d.language || 'es' });
  } catch(e){ return json(res, e.status || 500, { ok:false, error: e.code || 'error', detalle: e.message }); }
};
