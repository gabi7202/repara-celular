const { json, tieneSupabase } = require('./_lib');
const { vapidListo } = require('./_push');
/* Diagnóstico de Lupita SIN exponer la clave: forma, longitud y prefijo/sufijo
   permiten detectar errores típicos de Vercel (copiar con espacios, pegar la
   clave equivocada, o definir la variable solo en Preview y no en Production). */
function estadoGroq(){
  const k = process.env.GROQ_API_KEY;
  if (!k) return { estado:'FALTA_GROQ_API_KEY', pista:'Vercel → Settings → Environment Variables → añade GROQ_API_KEY con Scope PRODUCTION (+ Preview) y haz Redeploy.' };
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
  groq: process.env.GROQ_API_KEY ? 'conectada' : 'FALTA_GROQ_API_KEY',
  groq_detalle: estadoGroq(),
  /* push: el SW lee push_public_x/y para suscribirse (solo coordenadas
     PÚBLICAS — la privada jamás sale del servidor) */
  push: vapidListo() ? 'listo' : 'FALTA_VAPID (node tools/gen-vapid.js --env)',
  push_public_x: vapidListo() ? (process.env.VAPID_PUBLIC_KEY || '') : '',
  push_public_y: vapidListo() ? (process.env.VAPID_PUBLIC_Y || '') : '',
  node: process.version
});
