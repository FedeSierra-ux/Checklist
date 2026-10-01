/* Service worker — cache offline de Tudu (sólo web; en el APK no se usa).
 *
 * No hay que subir ninguna versión a mano. Los archivos de la app (CORE) se
 * guardan juntos en un cache "tudu-app-<fecha>". Cada vez que se abre la app
 * se revisan contra la red (con ETag: casi siempre es un 304 sin descargar
 * nada); si alguno cambió, se baja el juego COMPLETO a un cache nuevo, se
 * pasa a usar ese y se avisa a la página ("Hay una versión nueva ·
 * Actualizar"). Así nunca se mezclan módulos de dos versiones distintas.
 *
 * Si agregás un archivo a js/, sumalo a CORE (hay un test que lo verifica).
 */
const PREFIX = 'tudu-app-';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './assets/fonts/manrope.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/store.js',
  './js/sync.js',
  './js/sync-config.js',
  './js/core/dates.js',
  './js/core/merge.js',
  './js/core/model.js',
  './js/core/parse.js',
  './js/core/repeat.js',
  './js/core/text.js',
  './js/ui/ctx.js',
  './js/ui/gestures.js',
  './js/ui/native.js',
  './js/ui/notes.js',
  './js/ui/search.js',
  './js/ui/shopping.js',
  './js/ui/sw-client.js',
  './js/ui/sync-panel.js',
  './js/ui/task-sheet.js',
  './js/ui/tasks.js',
  './js/ui/toast.js',
];
const CHECK_EVERY = 5 * 60000;      // no revisar más de una vez cada 5 min
let lastCheck = 0;
let checking = null;
let replacing = false;              // había otra versión antes de esta instalación

const abs = (u) => new URL(u, self.registration.scope).href;
const CORE_URLS = new Set(CORE.map(abs));

async function currentCacheName() {
  const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX)).sort();
  return keys[keys.length - 1] || null;
}

// Baja todos los archivos a la vez; si alguno falla, no se toca nada.
async function fetchAll() {
  const res = await Promise.all(CORE.map(u => fetch(u, { cache: 'no-cache' })));
  if (res.some(r => !r.ok)) throw new Error('descarga incompleta');
  return res;
}

async function install() {
  replacing = (await caches.keys()).some(k => k.startsWith(PREFIX) || k.startsWith('tudu-v'));
  const res = await fetchAll();
  const cache = await caches.open(PREFIX + Date.now());
  await Promise.all(CORE.map((u, i) => cache.put(abs(u), res[i])));
}

async function cleanup(keep) {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== keep).map(k => caches.delete(k)));
}

async function notify(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach(c => c.postMessage(msg));
}

// ¿Cambió algo en el servidor? Compara el contenido de cada archivo.
async function checkForUpdate() {
  const name = await currentCacheName();
  if (!name) return;
  const cache = await caches.open(name);
  const fresh = await fetchAll();
  let changed = false;
  for (let i = 0; i < CORE.length && !changed; i++) {
    const old = await cache.match(abs(CORE[i]));
    if (!old) { changed = true; break; }
    const [a, b] = await Promise.all([old.clone().arrayBuffer(), fresh[i].clone().arrayBuffer()]);
    if (a.byteLength !== b.byteLength) { changed = true; break; }
    const va = new Uint8Array(a), vb = new Uint8Array(b);
    for (let j = 0; j < va.length; j++) if (va[j] !== vb[j]) { changed = true; break; }
  }
  if (!changed) return;
  const next = PREFIX + Date.now();
  const nc = await caches.open(next);
  await Promise.all(CORE.map((u, i) => nc.put(abs(u), fresh[i])));
  await cleanup(next);
  await notify({ type: 'update-ready' });
}

function maybeCheck(force = false) {
  if (checking || (!force && Date.now() - lastCheck < CHECK_EVERY)) return checking;
  lastCheck = Date.now();
  checking = checkForUpdate().catch(() => {}).finally(() => { checking = null; });
  return checking;
}

self.addEventListener('install', (e) => {
  e.waitUntil(install().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const name = await currentCacheName();
    if (name) await cleanup(name);
    await self.clients.claim();
    // Si este SW reemplazó a otro con la app abierta, avisar que hay versión nueva.
    if (replacing) await notify({ type: 'update-ready' });
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;     // Firestore & cía: red directa

  // Navegación: siempre index.html del cache (sirve offline y con #hash/?query).
  const key = request.mode === 'navigate' ? abs('./index.html') : url.origin + url.pathname;
  e.respondWith((async () => {
    const name = await currentCacheName();
    const cache = name ? await caches.open(name) : null;
    if (request.mode === 'navigate') e.waitUntil(maybeCheck());
    const hit = cache && await cache.match(key);
    if (hit) return hit;
    try {
      const res = await fetch(request);
      // Lo que no es CORE (íconos extra, etc.) se guarda al pasar.
      if (cache && res.ok && !CORE_URLS.has(key)) cache.put(key, res.clone());
      return res;
    } catch (err) {
      if (request.mode === 'navigate' && cache) {
        const fallback = await cache.match(abs('./index.html'));
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});

// La página pide revisar al volver de segundo plano (una PWA puede quedar
// abierta días).
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'check') e.waitUntil(maybeCheck(!!e.data.force) || Promise.resolve());
});

// Notificaciones: botones "Completar" / "Posponer 1 h" y tap (abre la tarea).
self.addEventListener('notificationclick', (e) => {
  const action = e.action || 'tap';
  const taskId = e.notification.data && e.notification.data.taskId;
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list[0];
    if (client) {
      if (taskId) client.postMessage({ type: 'notif', action, taskId });
      if ('focus' in client && action === 'tap') return client.focus();
      return undefined;
    }
    const url = taskId ? `./index.html#notif=${action}:${encodeURIComponent(taskId)}` : './index.html';
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
  })());
});
