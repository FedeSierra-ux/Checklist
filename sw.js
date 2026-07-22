/* Service Worker — cache offline para Pendientes */
const CACHE = 'pendientes-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Stale-while-revalidate para same-origin
  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res && res.status === 200 && request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Al tocar una notificación, enfocar la app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});
