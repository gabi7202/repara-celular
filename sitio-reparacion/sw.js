/* Service Worker de TapaTech: actualización del sitio y notificaciones
   disparadas por acciones explícitas del usuario. No suscribe a campañas. */
/* ═══ AUTO-UPDATE: este service worker se revalida solo en cada navegación.
   Cuando Vercel publica una nueva versión del sitio, la próxima visita ya
   muestra los cambios (sin "sitio viejo" ni caché atrapada). ═══ */
const SW_VER = '2026-10-19-t-icon';

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

/* Prueba manual del aviso desde la propia página. */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'lupita:test') {
    self.registration.showNotification(d.titulo || 'Lupita 💛 TapaTech', {
      body: d.cuerpo || 'Esta es una prueba de aviso discreto.',
      tag: 'lupita-test', icon: '/assets/lupita-mascota.svg', badge: '/assets/icon-192.png',
      silent: true, data: { url: '/' }
    });
  }
});

/* Clic en una notificación autorizada → abrir o reenfocar el sitio */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  })());
});
