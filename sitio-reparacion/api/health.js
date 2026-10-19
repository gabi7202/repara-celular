const { json, tieneSupabase } = require('./_lib');
const { esPlaceholder } = require('./_groq');
/* Diagnóstico de Lupita SIN exponer la clave: formato, longitud y prefijo
   permiten detectar errores típicos de Vercel (copiar con espacios, pegar la
   clave equivocada, o definir la variable solo en Preview y no en Production). */
function estadoGroq(){
  const k = process.env.GROQ_API_KEY;
  if (!k || esPlaceholder(k)) return { estado:'FALTA_GROQ_API_KEY', pista:'Añade una clave Groq válida en Vercel → Settings → Environment Variables y haz Redeploy.' };
  const limpia = String(k).trim();
  const info = { longitud: limpia.length, empieza_gsk: /^gsk_/i.test(limpia), espacios_dentro: /\s/.test(limpia) };
  if (!info.empieza_gsk) return Object.assign({ estado:'formato_inusual', info, pista:'Las claves de Groq empiezan con "gsk_". Verifica que pegaste la clave de console.groq.com/keys y no otra.' }, {});
  if (info.espacios_dentro || String(k) !== limpia) info.pista = 'La clave tiene espacios dentro o al inicio/final — bórrala y vuelve a pegarla sin espacios.';
  return Object.assign({ estado:'conectada', info }, info.pista ? { pista: info.pista } : {});
}
module.exports = (req, res) => json(res, 200, {
  ok: true,
  ts: new Date().toISOString(),
  backend: tieneSupabase() ? 'supabase' : 'local',
  groq: process.env.GROQ_API_KEY && !esPlaceholder(process.env.GROQ_API_KEY) ? 'conectada' : 'FALTA_GROQ_API_KEY',
  groq_detalle: estadoGroq(),
  node: process.version
});
