#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   tools/gen-vapid.js — genera el par de claves VAPID (Web Push)
   Sin dependencias: usa crypto de Node (≥18).

   Uso:
     node tools/gen-vapid.js            → imprime las env vars listas
     node tools/gen-vapid.js --env      → agrega/actualiza .env (si existe)

   Qué hacer con la salida:
     1. Local:  pega las líneas en sitio-reparacion/.env
     2. Vercel: Settings → Environment Variables → agrega las 3 (Production)
     3. Reinicia / redepliega. Verifica con GET /api/health → push:"listo"
   ═══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const vars = [
  ['VAPID_PUBLIC_KEY', pub.x],
  ['VAPID_PUBLIC_Y', pub.y],
  ['VAPID_PRIVATE_KEY', JSON.stringify({ d: priv.d, x: priv.x, y: priv.y })],
];

console.log('# ── Claves VAPID generadas ' + new Date().toISOString() + ' ──');
for (const [k, v] of vars) console.log(`${k}=${v}`);
console.log('# Opcional (contacto exigido por algunos servicios):');
console.log('VAPID_SUBJECT=mailto:admin@tapatech.mx');

if (process.argv.includes('--env')) {
  const f = path.join(__dirname, '..', '.env');
  let txt = '';
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { /* no existe aún */ }
  for (const [k, v] of vars) {
    const re = new RegExp('^' + k + '=.*$', 'm');
    if (re.test(txt)) txt = txt.replace(re, `${k}=${v}`);
    else txt += `\n${k}=${v}`;
  }
  if (!/^VAPID_SUBJECT=.*$/m.test(txt)) txt += '\nVAPID_SUBJECT=mailto:admin@tapatech.mx';
  fs.writeFileSync(f, txt.trimStart());
  console.error('\n✔ Claves escritas/actualizadas en ' + f + ' (recuerda: .env nunca se sube a Git)');
}
