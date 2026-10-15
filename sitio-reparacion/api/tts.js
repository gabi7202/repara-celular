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
    /* PlayAI exige voces INGLESES con `style`. Si llega una voz es-MX (Dalia…) o
       un estilo inválido, Groq responde 4xx y el TTS moría entero. Normalizamos: */
    const VOCES_PLAYAI = ['Chipmunk','Doodle','Caramel','Juniper','Stephen','Peter','Peanut','Bodega','Felix','Mango','Eric','Snips','Skye','Plaid','Astern'];
    const ESTILOS_VALIDOS = ['Cheerful','Sincere','Efficient','Lively'];
    let voz = String(b.voice || 'Jennifer');
    let estilo = b.style ? String(b.style).slice(0, 30) : null;
    if (/^es[-_]/i.test(voz) || !/^[A-Z][a-z]+$/.test(voz)) voz = 'Jennifer';           /* voz Edge → usa la default de PlayAI */
    if (estilo && !ESTILOS_VALIDOS.includes(estilo)) estilo = null;
    const modelos = [String(b.modelo || 'playai-tts'), 'playai-tts'].filter((v, i, a) => a.indexOf(v) === i);
    let r = null, ultimoTxt = '';
    for (let intento = 0; intento < 4 && !r; intento++){
      const payload = { model: modelos[Math.min(intento, modelos.length - 1)], voice: voz,
        response_format: String(b.formato || 'mp3'), input: texto };
      if (estilo) payload.style = estilo;
      if (b.speed) payload.speed = Math.min(1.6, Math.max(0.6, Number(b.speed) || 1));
      const rr = await fetch(GROQ + '/audio/speech', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + key }, body: JSON.stringify(payload) });
      if (rr.ok){ r = rr; break; }
      ultimoTxt = (await rr.text().catch(() => '')).slice(0, 180);
      const s = rr.status;
      if (s === 404 || s === 400 || s === 422) continue;                                  /* modelo/voz no existe: siguiente vuelta corrige */
      if ((s === 429 || s >= 500) && intento < 3){ await new Promise(z => setTimeout(z, 500)); continue; } /* sobrecarga: reintenta */
      const e = new Error('groq_' + s + ': ' + ultimoTxt); e.status = 502; e.code = 'groq_fallo'; throw e;
    }
    if (!r){ const e = new Error('groq_tts_no_disponible: ' + ultimoTxt); e.status = 502; e.code = 'groq_fallo'; throw e; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(buf);
  } catch(e){ return json(res, e.status || 500, { ok:false, error: e.code || 'error', detalle: (e.message || '').slice(0, 200) }); }
};
