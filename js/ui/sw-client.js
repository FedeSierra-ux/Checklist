/* Service worker del lado de la app: registrarlo (sólo en la web), mostrar
   "Hay una versión nueva · Actualizar" y recibir clicks de notificaciones.
   En el APK no se usa: los archivos ya vienen dentro de la app y un SW viejo
   serviría la versión anterior después de actualizar el APK. */
import { $ } from './ctx.js';
import { handleNotifAction } from './native.js';

export function initServiceWorker(isNative) {
  if (!('serviceWorker' in navigator)) return;
  if (isNative) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
    return;
  }
  if (!location.protocol.startsWith('http')) return;

  $('#updateBtn').addEventListener('click', () => location.reload());
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'update-ready') $('#updateBar').hidden = false;
    else if (d.type === 'notif') handleNotifAction(d.action, d.taskId);
  });
  // Una PWA puede quedar abierta días: al volver, pedir que revise.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) navigator.serviceWorker.controller?.postMessage({ type: 'check' });
  });
  window.addEventListener('load', () => {
    // updateViaCache 'none': el navegador siempre revisa sw.js en la red.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });

  // Click en una notificación con la app cerrada: el SW la abre con
  // #notif=acción:id.
  const m = location.hash.match(/^#notif=(\w+):(.+)$/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => handleNotifAction(m[1], decodeURIComponent(m[2])), 300);
  }
}
