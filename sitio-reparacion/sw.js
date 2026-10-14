/* ═══════════════════════════════════════════════════════════════════
   Service Worker de TapaTech — "Lupita te avisa" (remarketing propio)
   Sin Firebase ni costos: usa las Notification API nativas del navegador.
   El cliente queda asociado por IP + huella (hash) en /api/visitas;
   Lupita decide si enviar 1 notificación discreta al día o una cada 3 días.
   Las notificaciones SOLO se envían con permiso otorgado y frecuencia
   limitada por el servidor (nunca spam).
   ═══════════════════════════════════════════════════════════════════ */
const CACHE = 'tapatech-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* Mensaje desde la página: {type:'lupita:registrar'} → suscribe este SW */
self.addEventListener('message', async (e) => {
  const d = e.data || {};
  if (d.type === 'lupita:registrar') {
    try {
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: d.vapid || undefined });
      await fetch('/api/visitas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'suscribir', endpoint: sub.endpoint, keys: sub.keys })
      });
    } catch (err) { /* sin VAPID el push no funciona; igual registramos visita simple */ 
      try { await fetch('/api/visitas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'visita' }) }); } catch(e2){}
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
