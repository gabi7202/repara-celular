const fs = require('fs');
const path = require('path');
const { json, tieneSupabase } = require('./_lib');
const { esPlaceholder, CANDIDATOS_CHAT } = require('./_groq');

/* Diagnóstico de Lupita SIN exponer la clave: formato, longitud y prefijo
   permiten detectar errores típicos de Vercel (copiar con espacios, pegar la
   clave equivocada, o definir la variable solo en Preview y no en Production). */
function estadoGroq(){
  const k = process.env.GROQ_API_KEY_AGENTE || process.env.GROQ_API_KEY;
  if (!k || esPlaceholder(k)) return { estado:'FALTA_GROQ_API_KEY', pista:'Añade una clave Groq válida en Vercel → Settings → Environment Variables y haz Redeploy.' };
  const limpia = String(k).trim();
  const info = { longitud: limpia.length, empieza_gsk: /^gsk_/i.test(limpia), espacios_dentro: /\s/.test(limpia), fuente: process.env.GROQ_API_KEY_AGENTE ? 'GROQ_API_KEY_AGENTE' : 'GROQ_API_KEY' };
  if (!info.empieza_gsk) return { estado:'formato_inusual', info, pista:'Las claves de Groq empiezan con "gsk_". Verifica que pegaste la clave de console.groq.com/keys y no otra.' };
  if (info.espacios_dentro || String(k) !== limpia) info.pista = 'La clave tiene espacios dentro o al inicio/final — bórrala y vuelve a pegarla sin espacios.';
  return Object.assign({ estado:'conectada', info }, info.pista ? { pista: info.pista } : {});
}

/* Cuánto pesa el prompt maestro: si crece demasiado, cada turno se acerca al
   límite gratuito de Groq (8 000 TPM en gpt-oss-20b). */
function infoPrompt(){
  try {
    const crudo = fs.readFileSync(path.join(__dirname, '..', 'datos', 'prompt-agente.md'), 'utf8');
    const i = crudo.lastIndexOf('===PROMPT==='), j = i >= 0 ? crudo.indexOf('===FIN===', i) : -1;
    const p = (i >= 0 && j > i) ? crudo.slice(i + 12, j).trim() : crudo.trim();
    return { ok: !!p, caracteres: p.length, tokens_aprox: Math.round(p.length / 4.5) };
  } catch (e) {
    return { ok:false, caracteres:0, tokens_aprox:0, error:String(e.message || e).slice(0, 100) };
  }
}

function infoTts(){
  const hook = String(process.env.TTS_WEBHOOK || '').trim();
  if (!hook) return { estado:'respaldo_navegador', pista:'Sin TTS_WEBHOOK, Lupita usa la voz del navegador. Para la voz Edge, configura un webhook HTTPS público.' };
  try { return { estado:'webhook_configurado', host: new URL(hook).host }; }
  catch (e) { return { estado:'webhook_invalido', pista:'TTS_WEBHOOK no es una URL válida.' }; }
}

function datosSalud(){
  const groq = estadoGroq();
  return {
    ok: true,
    version: '2026-10-26-chat-tpm',
    ts: new Date().toISOString(),
    backend: tieneSupabase() ? 'supabase' : 'local',
    almacenamiento: tieneSupabase() ? 'supabase' : 'temporal (/tmp de Vercel)',
    groq: groq.estado === 'conectada' ? 'conectada' : 'FALTA_GROQ_API_KEY',
    groq_detalle: groq,
    modelo_chat: process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b',
    modelos_respaldo: CANDIDATOS_CHAT,
    prompt: infoPrompt(),
    tts: infoTts(),
    aviso_tpm: 'gpt-oss-20b/120b tienen 8 000 TPM en el plan gratuito; el prompt se envía una sola vez y se cachea.',
    node: process.version
  };
}

module.exports = (req, res) => json(res, 200, datosSalud());
module.exports.datos = datosSalud;
