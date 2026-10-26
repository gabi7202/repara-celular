/* POST /api/stt → Groq Whisper (audio en base64 dentro de JSON, sin multipart).
   Con fallback de modelos: si "whisper-large-v3-turbo" se jubila o la cuenta no
   lo tiene, probamos automáticamente "whisper-large-v3" y reintentamos 5xx/429.
   Además devolvemos el modelo realmente usado para depuración desde /admin. */
const { json } = require('./_lib');
const { groqKey, sttConFallback, corregirSTT } = require('./_groq');

/* Vocabulario que le "soplamos" a Whisper (initial_prompt) para que NUNCA
   transcriba el nombre del taller como "tapatech": siempre TapaTech + Tapachula. */
const PROMPT_VOCABULARIO = 'Reparaciones en el taller TapaTech de Tapachula, Chiapas. Celulares iPhone, Samsung, Xiaomi, Motorola, laptops, consolas. Pantalla, batería, puerto de carga, cotización, diagnóstico, WhatsApp.';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); return json(res, 405, { ok:false }); }
  try {
    const key = groqKey(req);
    const b = req.body || {};
    if (!b.audio_base64) return json(res, 400, { ok:false, error:'audio_faltante' });
    const buf = Buffer.from(String(b.audio_base64).replace(/^data:[^,]+,/, '').slice(0, 5.5 * 1024 * 1024), 'base64');
    if (!buf.length) return json(res, 400, { ok:false, error:'audio_vacio' });
    const mime = String(b.mime || 'audio/webm');
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const formFactory = (model) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
      fd.append('model', model);
      fd.append('language', String(b.idioma || 'es').slice(0, 8));
      fd.append('response_format', 'json');
      fd.append('temperature', '0');
      /* Groq SOLO acepta file, url, language, model, prompt, response_format,
         temperature y timestamp_granularities[]. Enviar los umbrales clásicos de
         OpenAI (no_speech_threshold, compression_ratio_threshold,
         logprob_threshold) devuelve 400 "unknown param" y rompía el STT.
         El filtro de ruido se hace en el cliente antes de llegar aquí. */
      /* refuerzo de vocabulario: Whisper sesga la transcripción hacia estas palabras */
      fd.append('prompt', String(b.vocabulario || PROMPT_VOCABULARIO).slice(0, 400));
      return fd;
    };
    const d = await sttConFallback(formFactory, b.modelo || 'whisper-large-v3-turbo', key);
    /* capa final: si aun así escribió "tapatech", se corrige antes de devolverlo */
    const txt = corregirSTT(d.text || '');
    return json(res, 200, { ok:true, text: txt, idioma: d.language || 'es', modelo: d._modelo_usado || '' });
  } catch(e){
    const status = e.status || e.groqStatus || 500;
    let code = e.code || 'error';
    if (e.groqStatus === 401 || e.groqStatus === 403) code = 'clave_invalida';
    else if (/groq_/.test(e.message || '')) code = 'groq_fallo';
    return json(res, status >= 400 && status < 600 ? status : 500, { ok:false, error: code, detalle: (e.message || '').slice(0, 200) });
  }
};
