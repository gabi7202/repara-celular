/* ═══════════════════════════════════════════════════════════════════
   Service Worker de TapaTech — "Lupita te avisa" (remarketing propio)
   Sin Firebase ni costos: usa las Notification API nativas del navegador.
   El cliente queda asociado por IP + huella (hash) en /api/visitas;
   Lupita decide si enviar 1 notificación discreta al día o una cada 3 días.
   Las notificaciones SOLO se envían con permiso otorgado y frecuencia
   limitada por el servidor (nunca spam).
   ═══════════════════════════════════════════════════════════════════ */
/* ═══ AUTO-UPDATE: este service worker se revalida solo en cada navegación.
   Cuando Vercel publica una nueva versión del sitio, la próxima visita ya
   muestra los cambios (sin "sitio viejo" ni caché atrapada). ═══ */
const SW_VER = '2026-10-21-push-vapid-1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  /* limpia cachés antiguas de versiones previas */
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== 'tapatech-v1').map(k => caches.delete(k)));
  await self.clients.claim();
})()));

/* Cada vez que la página pide actualizar (navegación), el SW comprueba si hay
   versión nueva y se auto-reemplaza sin intervención del usuario. */
async function checkForUpdate() {
  try {
    const reg = await self.registration.update();
    if (reg.installing || reg.waiting) return; /* ya hay nueva esperando */
  } catch (e) {}
}
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'lupita:check-update') checkForUpdate();
});

/* Mensaje desde la página: {type:'lupita:registrar', vapid} → suscribe este SW.
   La clave VAPID pública llega como coordenadas JWK (x,y) en base64url; se
   reconstruye el punto EC raw 0x04||x||y que exige PushManager.subscribe(). */
async function vapidAplicacionServerKey(){
  try{
    const r = await fetch('/api/health'); const j = await r.json();
    const x = j && j.push_public_x, y = j && j.push_public_y;
    if(!x || !y) return null;
    const dec = (s) => { s = String(s).replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; const bin = atob(s); const u = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
    const raw = new Uint8Array(65); raw[0] = 4; raw.set(dec(x), 1); raw.set(dec(y), 33);
    return raw;
  }catch(e){ return null; }
}
self.addEventListener('message', async (e) => {
  const d = e.data || {};
  if (d.type === 'lupita:registrar') {
    try {
      if (Notification.permission !== 'granted') throw new Error('sin_permiso');
      let key = d.vapid || undefined;
      if (!key) key = (await vapidAplicacionServerKey()) || undefined;
      /* reutilizar suscripción existente si ya la tenemos (evita churn) */
      let sub = await self.registration.pushManager.getSubscription();
      if (!sub || !sub.endpoint) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/visitas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'suscribir', endpoint: sub.endpoint, keys: sub.keys, hash: d.hash || '' })
      });
    } catch (err) { /* sin VAPID/permiso el push no funciona; registramos visita simple */
      try { await fetch('/api/visitas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'visita', hash: d.hash || '' }) }); } catch(e2){}
    }
  }
  if (d.type === 'lupita:test') {
    self.registration.showNotification(d.titulo || 'Lupita 💛 TapaTech', {
      body: d.cuerpo || 'Esta es una prueba de aviso discreto.',
      tag: 'lupita-test', icon: '/assets/lupita-mascota.svg', badge: '/assets/icon-192.png',
      silent: true, data: { url: '/' }
    });
  }
});

/* ═══ PUSH RECIBIDO (VAPID) — descifrado lo hace el navegador; aquí solo
   leemos el JSON {titulo, cuerpo, url} y mostramos la notificación.
   Nunca enviamos nada si no hay permiso explícito otorgado. ═══ */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { try { d = { cuerpo: e.data && e.data.text() }; } catch (e2) {} }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Lupita 💛 TapaTech', {
    body: d.cuerpo || 'Tu cotización sigue guardada en TapaTech.',
    tag: 'lupita-push', icon: '/assets/lupita-mascota.svg', badge: '/assets/icon-192.png',
    silent: true, data: { url: d.url || '/', id: d.id || '' }
  }));
});

/* Si el usuario cancela la suscripción desde la UI del navegador, avisamos
   al servidor para limpiar el endpoint y no intentar enviarle nunca más. */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try { await fetch('/api/visitas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'unsubscribe', endpoint: (e.oldSubscription && e.oldSubscription.endpoint) || '' }) }); } catch (err) {}
  })());
});

/* Clic en la notificación → abrir/reenfocar el sitio (y registrar conversión) */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    try { await fetch('/api/visitas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'clic_notif', id: (e.notification.data && e.notification.data.id) || '' }) }); } catch (err) {}
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  })());
});
