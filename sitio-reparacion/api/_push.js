/* ══════════════════════════════════════════════════════════════════════
   _push.js — Web Push nativo (VAPID) SIN dependencias externas
   ──────────────────────────────────────────────────────────────────────
   Usa solo los módulos de Node: crypto + fetch (Node ≥ 18). No requiere
   el paquete «web-push» ni Firebase.

   Flujo:
     1. tools/gen-vapid.js genera VAPID_PUBLIC_KEY / VAPID_PUBLIC_Y /
        VAPID_PRIVATE_KEY (JWK {d,x,y}).
     2. El service worker (sw.js) se suscribe con la clave pública y envía
        el endpoint + p256dh + auth a /api/visitas (accion:'suscribir').
     3. pushAvisarLupita() cifra el payload (aes128gcm) y lo POSTea al
        endpoint del navegador con un JWT VAPID firmado con EC P-256.

   Claves privadas: SOLO en el servidor (env vars). Nunca viajan al cliente.
   ══════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');

/* ── utilidades base64url ──────────────────────────────────────────── */
const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4), 'base64');

/* ── claves VAPID (JWK → objeto crypto KeyObject) ──────────────────── */
function vapidListo(){ return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }
function keyPublica(){
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: process.env.VAPID_PUBLIC_KEY, y: process.env.VAPID_PUBLIC_Y }, format: 'jwk' });
}
function keyPrivada(){
  /* La clave privada se guarda como JWK {d,x,y}. Si VAPID_PRIVATE_KEY viene
     como string plano (solo "d"), recomponemos con x/y de la pública. */
  let priv = process.env.VAPID_PRIVATE_KEY;
  try { const j = JSON.parse(priv); if (j.d) return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: j.d, x: j.x || process.env.VAPID_PUBLIC_KEY, y: j.y || process.env.VAPID_PUBLIC_Y }, format: 'jwk' }); } catch (e) {}
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: process.env.VAPID_PUBLIC_KEY, y: process.env.VAPID_PUBLIC_Y }, format: 'jwk' });
}

/* ── JWT de autenticación VAPID (RFC 8292, ES256) ──────────────────── */
/* DER(SEQUENCE{INTEGER r, INTEGER s}) → r||s crudo de 64 bytes.
   Recorremos TODAS las secuencias anidadas: OpenSSL a veces envuelve la
   firma en una segunda SEQUENCE, y un parser ingenuo leía longitud negativa
   (Buffer.alloc(-N)) y reventaba el envío. */
function derFirmaAJose(der){
  let i = 0;
  while (i < der.length){
    if (der[i] !== 0x30) break;                    /* fuera de SEQUENCE */
    let len = der[i+1]; i += 2;
    if (len & 0x80){ const n = len & 0x7f; len = der.readUIntBE(i, n); i += n; }
    if (der[i] !== 0x02) break;                    /* INTEGER r esperado */
    const rlen = der[i+1]; const r = der.slice(i+2, i+2+rlen); i += 2 + rlen;
    if (der[i] !== 0x02) break;                    /* INTEGER s esperado */
    const slen = der[i+1]; const s = der.slice(i+2, i+2+slen);
    const pad = b => Buffer.concat([Buffer.alloc(Math.max(0, 32 - b.length), 0), b]).subarray(-32);
    return Buffer.concat([pad(r.subarray(-32)), pad(s.subarray(-32))]);
  }
  throw new Error('der_firma_invalida');
}

function jwtVapid(audience){
  const header  = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const claim = b64u(JSON.stringify({ aud: audience, exp, sub: process.env.VAPID_SUBJECT || 'mailto:admin@tapatech.mx' }));
  const signing = header + '.' + claim;
  const der = crypto.sign('sha256', Buffer.from(signing), { key: keyPrivada(), dsaEncoding: 'der' });
  return signing + '.' + b64u(derFirmaAJose(der));
}

/* ── claves de la suscripción → coordenadas JWK P-256 ───────────────
   PushManager.subscribe() entrega keys.p256dh en BASE64URL: punto EC raw
   sin comprimir = 0x04 || x(32) || y(32). Aceptamos también hex por robustez. */
function puntoEc(b64uOrHex){
  const s = String(b64uOrHex);
  let raw;
  if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 128){
    raw = Buffer.from(s.replace(/^04/, ''), 'hex');                /* hex: x||y */
  } else {
    const buf = b64uToBuf(s);                                       /* base64url */
    raw = (buf.length === 65 && buf[0] === 0x04) ? buf.subarray(1) : buf;
  }
  if (raw.length < 64) throw new Error('p256dh_invalido');
  return { x: b64u(raw.subarray(0, 32)), y: b64u(raw.subarray(32, 64)) };
}

function hmac(key, data){ return crypto.createHmac('sha256', key).update(data).digest(); }

/* ── envío real de la notificación push ────────────────────────────────
   Pasos (RFC 8292 + RFC 8188 aes128gcm):
     1. JWT VAPID firmado con la privada EC → header Authorization junto
        con la clave pública del servidor:  vapid t=<jwt>, k=<b64url(pub)>
     2. ECDH efímero servidor↔suscritor → clave compartida
     3. HKDF-SHA256 → CEK (16B) + nonce (12B)
     4. AES-128-GCM sobre el payload (+ padding byte 0x02)
     5. POST al endpoint con Content-Encoding: aes128gcm
   El suscriptor (navegador) descifra con su privada + auth secret. */
async function pushEnviar(sub, titulo, cuerpo, url){
  if (!vapidListo()) { const e = new Error('sin_vapid'); e.code = 'sin_vapid'; throw e; }
  const payload = JSON.stringify({ titulo: titulo || 'Lupita 💛 TapaTech', cuerpo: cuerpo || '', url: url || '/', ts: Date.now() });
  const u = new URL(sub.endpoint);
  const jwt = jwtVapid(u.protocol + '//' + u.host);
  const pubK = keyPublica().export({ format: 'jwk' });
  const k = b64u(Buffer.concat([Buffer.from([4]), b64uToBuf(pubK.x), b64uToBuf(pubK.y)]));

  const par = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubS = par.publicKey.export({ format: 'jwk' });
  const recv = puntoEc(String(sub.keys.p256dh));
  const shared = crypto.diffieHellman({
    privateKey: par.privateKey,
    publicKey: crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: recv.x, y: recv.y }, format: 'jwk' })
  });
  const saltB64u = crypto.randomBytes(16).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const authB = b64uToBuf(String(sub.keys.auth));
  const ikm = Buffer.concat([shared, Buffer.from('WebPush: info\u0000', 'ascii'), b64uToBuf(String(sub.keys.p256dh)), authB]);
  const prk = hmac(b64uToBuf(saltB64u), ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\u0000', 'ascii'), Buffer.from([0])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\u0000', 'ascii'), Buffer.from([0])])).subarray(0, 12);
  const pubkeyRaw = Buffer.concat([Buffer.from([4]), b64uToBuf(pubS.x), b64uToBuf(pubS.y)]);
  const ctx = Buffer.concat([b64uToBuf(saltB64u), Buffer.from([0, 0, 0x80, 0]), Buffer.from([pubkeyRaw.length]), pubkeyRaw]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  c.setAAD(ctx);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const bodyBuf = Buffer.concat([ctx, ct]);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400', 'Urgency': 'low', 'Crypto-Key': 'k=' + k,
      'Authorization': `vapid t=${jwt}, k=${k}`
    },
    body: bodyBuf
  });
  if (res.status === 404 || res.status === 410) { const e = new Error('expired'); e.expired = true; throw e; }
  if (!res.ok) { const t = await res.text().catch(() => ''); const e = new Error('push_' + res.status + ': ' + t.slice(0, 160)); e.status = res.status; throw e; }
  return res;
}

/* ── decisión de negocio: ¿avisarle a este visitante por push? ─────── */
/* Se llama CUANDO EL SW CONFIRMA que ya mostró la notificación in-page
   (no desde el POST de visita, para no quemar el periodo de frecuencia
   antes de que el aviso in-page tenga oportunidad de salir). */
async function pushAvisarLupita(v, motivo){
  if (!v || !v.push || !v.push.endpoint || !v.push.keys) return { enviado: false, motivo: 'sin_suscripcion' };
  if (v.convirtio) return { enviado: false, motivo: 'convirtio' };
  const now = Date.now();
  const MS_PERIOD = (process.env.LUPITA_FREQ || 'dia').toLowerCase() === '3dias' ? 3 * 864e5 : 864e5;
  if ((now - Number(v.ultimo_aviso || 0)) < MS_PERIOD) return { enviado: false, motivo: 'frecuencia' };
  if ((v.avisos_push || 0) >= 5) return { enviado: false, motivo: 'tope_5' };

  const MSGS = [
    { t: 'Lupita · TapaTech', c: 'Hola 👋 tu cotización sigue guardada. Diagnóstico gratis y garantía escrita de 30 días.' },
    { t: 'Lupita · TapaTech', c: 'Tu pantalla puede quedar como nueva en 40 min aquí en Tapachula. Escríbenos y la cotizamos al instante.' },
    { t: 'Tip de Lupita', c: '¿Sigues con ese detalle del celular? Te esperamos con diagnóstico sin costo.' }
  ];
  let m = MSGS[Math.floor(Math.random() * MSGS.length)];
  if (v.ctx && v.ctx.falla) m = { t: 'Lupita · TapaTech', c: 'Me quedé pensando en tu "' + v.ctx.falla + '". Ya tienes cotización lista — ¿la confirmamos?' };

  try {
    await pushEnviar(v.push, m.t, m.c, '/');
    v.ultimo_aviso = now;
    v.avisos = (v.avisos || 0) + 1;
    v.avisos_push = (v.avisos_push || 0) + 1;
    v.contexto_aviso = m.c.slice(0, 120);
    return { enviado: true, msg: m };
  } catch (e) {
    if (e.expired) v.push = null;               /* endpoint muerto: limpiar */
    return { enviado: false, motivo: e.message };
  }
}

module.exports = { vapidListo, pushEnviar, pushAvisarLupita, b64u, b64uToBuf };
