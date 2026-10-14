/* POST /api/tts → 1) webhook TTS gratuito (Edge neuronal es-MX) o 2) PlayAI vía Groq.
   Devuelve audio binario listo para reproducir. */
const { json, groqKey } = require('./_lib');
const GROQ = 'https://api.groq.com/openai/v1';
module.exports = async function handler(req, res) {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
  try {
    const b = req.body || {};
    const texto = String(b.text || '').slice(0, 1200);
    if (!texto) return json(res, 400, { ok:false, error:'texto_faltante' });
    const hook = process.env.TTS_WEBHOOK || '';
    if (hook){
      try {
        const rh = await fetch(hook, { method:'POST', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ text: texto, voice: b.voice || 'es-MX-DaliaNeural', rate: b.rate || '+2%',
            pitch: b.pitch || '+4Hz', volume: b.volume || '100', format: b.formato || 'mp3', ssml: b.ssml || null }) });
        if (rh.ok){
          const buf = Buffer.from(await rh.arrayBuffer());
          if (buf.length > 400){
            res.setHeader('Content-Type', rh.headers.get('content-type') || 'audio/mpeg');
            res.setHeader('Cache-Control','no-store');
            return res.status(200).send(buf);
          }
        }
      } catch(e){ /* caemos a Groq */ }
    }
    const key = groqKey(req);
    const payload = { model: String(b.modelo || 'playai-tts'), voice: String(b.voice || 'Jennifer'),
      response_format: String(b.formato || 'mp3'), input: texto };
    if (b.style) payload.style = String(b.style).slice(0, 30);
    if (b.speed) payload.speed = Math.min(1.6, Math.max(0.6, Number(b.speed) || 1));
    const r = await fetch(GROQ + '/audio/speech', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + key }, body: JSON.stringify(payload) });
    if (!r.ok){ const t = await r.text(); const e = new Error('groq_' + r.status + ': ' + t.slice(0,180)); e.status = 502; throw e; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(buf);
  } catch(e){ return json(res, e.status || 500, { ok:false, error: e.code || 'error', detalle: e.message }); }
};
