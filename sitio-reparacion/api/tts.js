/* POST /api/tts → webhook gratuito Edge TTS. El navegador es el único respaldo. */
const { json } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'metodo_no_permitido' });
  }

  const body = req.body || {};
  const text = String(body.text || '').trim().slice(0, 1200);
  if (!text) return json(res, 400, { ok: false, error: 'texto_faltante' });

  const webhook = String(process.env.TTS_WEBHOOK || '').trim();
  if (!webhook) return json(res, 503, { ok: false, error: 'tts_webhook_no_configurado' });
  const rate = /^[-+]?\d{1,2}%$/.test(String(body.rate || '')) ? String(body.rate) : '+2%';
  const pitch = /^[-+]?\d{1,3}Hz$/i.test(String(body.pitch || '')) ? String(body.pitch) : '+6Hz';
  const volume = /^\d{1,3}%?$/.test(String(body.volume || '')) ? String(body.volume) : '100';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let upstream;
  try {
    upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: String(body.voice || 'es-MX-DaliaNeural'),
        rate,
        pitch,
        volume,
        format: 'mp3'
      }),
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    console.warn('[tts] Edge TTS no respondió:', String(error && error.message || error).slice(0, 160));
    return json(res, timedOut ? 504 : 502, {
      ok: false,
      error: timedOut ? 'tts_webhook_timeout' : 'tts_webhook_no_disponible'
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 160);
    console.warn('[tts] Edge TTS respondió HTTP ' + upstream.status + ': ' + detail);
    return json(res, 502, { ok: false, error: 'tts_webhook_fallo', estado: upstream.status });
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  if (audio.length <= 400) {
    console.warn('[tts] Edge TTS respondió con audio vacío o incompleto.');
    return json(res, 502, { ok: false, error: 'tts_webhook_audio_vacio' });
  }

  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(audio);
};
