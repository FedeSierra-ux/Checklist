/* Notificaciones + integración nativa (Capacitor / APK) y avisos web.
   En el APK las notificaciones se programan en el sistema (suenan con la app
   cerrada) y traen botones "Completar" y "Posponer 1 h"; tocarlas abre la
   tarea. En la web son notificaciones del service worker mientras la app vive. */
import { state, persist } from '../store.js';
import { ui, app, $ } from './ctx.js';
import { ymd, addDays, taskDate, reminderAt, reminderBody } from '../core/dates.js';
import { toast } from './toast.js';
import { completeTask, byPrioDate } from './tasks.js';
import { openSheet } from './task-sheet.js';

const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const LN = () => Cap?.Plugins?.LocalNotifications;
const Prefs = () => Cap?.Plugins?.Preferences;
// Capacitor inyecta un proxy en Capacitor.Plugins por cada plugin nativo
// registrado; registerPlugin() sólo existe si se carga el bundle JS de
// @capacitor/core, que esta app no usa. Por eso vamos primero por Plugins.
const WidgetBridge = () => Cap?.Plugins?.WidgetBridge
  || (Cap?.registerPlugin ? Cap.registerPlugin('WidgetBridge') : null);
const Haptics = () => Cap?.Plugins?.Haptics;

const SNOOZE_MS = 60 * 60000;

// Vibración corta al completar / posponer. Nativo: plugin Haptics; web: vibrate.
export function haptic() {
  try {
    if (isNative && Haptics()) Haptics().impact({ style: 'LIGHT' });
    else if (navigator.vibrate) navigator.vibrate(10);
  } catch (e) { /* ignore */ }
}

export function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000 || 1;
}

// Cuándo suena: lo pospuesto desde la notificación, o el recordatorio normal.
function alarmAt(t) {
  const snz = state.snoozed[t.id];
  if (snz && snz > Date.now()) return snz;
  return reminderAt(t);
}

// ---------- Nativo ----------
let actionsReady = false;
async function ensureActionTypes() {
  if (actionsReady) return;
  await LN().registerActionTypes({
    types: [{ id: 'TASK', actions: [{ id: 'done', title: 'Completar' }, { id: 'snooze', title: 'Posponer 1 h' }] }],
  });
  actionsReady = true;
}

// Programa TODAS las notificaciones futuras en el sistema. Disparan aunque
// la app esté cerrada (AlarmManager).
let schedTimer = null;
export function scheduleNative() {
  if (!isNative || !LN()) return;
  clearTimeout(schedTimer);
  schedTimer = setTimeout(doSchedule, 300);       // varias escrituras seguidas → una sola
}
async function doSchedule() {
  const ln = LN();
  try {
    const perm = await ln.checkPermissions();
    if (perm.display !== 'granted') return;
    await ensureActionTypes();
    const pending = await ln.getPending();
    if (pending.notifications?.length) await ln.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    const now = Date.now();
    const list = [];
    state.tasks.filter(t => !t.done && t.date).forEach(t => {
      const at = alarmAt(t);
      if (at == null || at < now + 5000) return;
      const snoozed = state.snoozed[t.id] === at;
      list.push({
        id: hashId(t.id),
        title: '⏰ ' + t.title,
        body: (snoozed ? 'Pospuesta · ' : '') + reminderBody(t, at),
        schedule: { at: new Date(at), allowWhileIdle: true },
        smallIcon: 'ic_stat_icon',
        actionTypeId: 'TASK',
        extra: { taskId: t.id },
      });
    });
    if (list.length) await ln.schedule({ notifications: list });
  } catch (e) { /* silencioso */ }
}

// Abre una tarea que llegó desde afuera (notificación o widget).
export function openTaskFromOutside(id) {
  if (!state.tasks.some(x => x.id === id)) return;
  if (ui.query) app.closeSearch?.();
  if (ui.view !== 'semana' && ui.view !== 'mes') { ui.view = 'semana'; app.render(); }
  openSheet(id);
}

function snoozeReminder(id) {
  if (!state.tasks.some(x => x.id === id)) return;
  state.snoozed[id] = Date.now() + SNOOZE_MS;
  persist();
  toast('⏰ Te aviso de nuevo en 1 hora');
}

// Botones de la notificación. actionId: 'done' | 'snooze' | 'tap'.
export function handleNotifAction(actionId, taskId) {
  if (!taskId) return;
  if (actionId === 'done') completeTask(taskId);
  else if (actionId === 'snooze') snoozeReminder(taskId);
  else openTaskFromOutside(taskId);
}

// ---------- Widget ----------
// Espeja los pendientes de la próxima semana (y lo vencido) en Preferences
// (SharedPreferences) con su fecha: el widget filtra "hoy" él solo, así a la
// medianoche muestra lo del día nuevo aunque la app no se abra.
export async function syncWidget() {
  if (!isNative || !Prefs()) return;
  const limit = ymd(addDays(new Date(), 7));
  const items = state.tasks
    .filter(t => !t.done && t.date && t.date <= limit)
    .sort(byPrioDate)
    .slice(0, 40)
    .map(t => ({ id: t.id, title: t.title, time: t.time || '', priority: t.priority || 0, date: t.date }));
  try {
    await Prefs().set({ key: 'widget_tasks', value: JSON.stringify(items) });
    await Prefs().set({ key: 'widget_updated', value: String(Date.now()) });
    const wb = WidgetBridge();
    if (wb?.refresh) await Promise.resolve(wb.refresh()).catch(() => {});
  } catch (e) { /* silencioso */ }
}

// Al volver a la app: aplicar lo tildado en el widget y abrir la tarea tocada.
export async function pullWidgetChanges() {
  if (!isNative || !Prefs()) return;
  try {
    const { value } = await Prefs().get({ key: 'widget_toggle' });
    if (value) {
      // El widget acumula los ids tildados en un array; toleramos el formato
      // viejo (un solo id suelto) para no perder cambios al actualizar.
      let ids;
      try { const p = JSON.parse(value); ids = Array.isArray(p) ? p : [String(p)]; } catch (e) { ids = [value]; }
      await Prefs().remove({ key: 'widget_toggle' });
      ids.forEach(id => completeTask(id, { silent: true }));
      if (ids.length) toast(ids.length === 1 ? '✓ Completada desde el widget' : `✓ ${ids.length} completadas desde el widget`);
    }
    const open = await Prefs().get({ key: 'widget_open' });
    if (open.value) {
      await Prefs().remove({ key: 'widget_open' });
      openTaskFromOutside(open.value);
    }
  } catch (e) { /* silencioso */ }
}

// ---------- Web: avisos mientras la pestaña vive ----------
export function checkWebReminders() {
  if (isNative) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  let changed = false;
  state.tasks.forEach(t => {
    if (t.done || !t.date) return;
    const snz = state.snoozed[t.id];
    if (snz) {
      if (now >= snz) { webNotify(t, 'Pospuesta · ' + reminderBody(t, now)); delete state.snoozed[t.id]; changed = true; }
      return;
    }
    const at = reminderAt(t), dt = taskDate(t).getTime();
    if (now >= at && now <= dt + 120000 && state.notified[t.id] !== 'pre') {
      webNotify(t, reminderBody(t, now));
      state.notified[t.id] = 'pre';
      changed = true;
    }
  });
  if (changed) persist();
}

function webNotify(t, body) {
  const title = '⏰ ' + t.title;
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then(r => r.showNotification(title, {
        body, tag: 'task-' + t.id, icon: 'icons/icon-192.png', data: { taskId: t.id },
        actions: [{ action: 'done', title: 'Completar' }, { action: 'snooze', title: 'Posponer 1 h' }],
      }));
    } else {
      const n = new Notification(title, { body, tag: 'task-' + t.id, icon: 'icons/icon-192.png' });
      n.onclick = () => { window.focus(); openTaskFromOutside(t.id); n.close(); };
    }
  } catch (e) { /* ignore */ }
}

// ---------- Permiso / botón de la campana ----------
export function updateNotifBtn() {
  const b = $('#notifBtn');
  if (isNative) { b.classList.add('active'); return; }
  b.classList.toggle('active', 'Notification' in window && Notification.permission === 'granted');
}

export async function requestNotify() {
  if (isNative) {
    try {
      const r = await LN()?.requestPermissions();
      if (r && r.display !== 'granted') { toast('Los avisos están desactivados en Ajustes'); return false; }
    } catch (e) { /* ignore */ }
    scheduleNative(); toast('🔔 Avisos activados'); updateNotifBtn(); return true;
  }
  if (!('Notification' in window)) { toast('Tu navegador no soporta avisos'); return false; }
  if (Notification.permission === 'denied') { toast('Los avisos están bloqueados'); return false; }
  const res = await Notification.requestPermission();
  updateNotifBtn();
  if (res === 'granted') { toast('🔔 Avisos activados'); checkWebReminders(); return true; }
  return false;
}

// Después de guardar la primera tarea, pedir permiso una sola vez.
export function maybeAskNotify() {
  if (isNative) {
    if (!sessionStorage.getItem('askedNotify')) {
      sessionStorage.setItem('askedNotify', '1');
      LN()?.checkPermissions().then(p => { if (p.display !== 'granted') requestNotify(); }).catch(() => {});
    }
    scheduleNative();
    return;
  }
  if ('Notification' in window && Notification.permission === 'default' && !sessionStorage.getItem('askedNotify')) {
    sessionStorage.setItem('askedNotify', '1');
    setTimeout(requestNotify, 600);
  }
}

export function initNative() {
  $('#notifBtn').addEventListener('click', requestNotify);
  updateNotifBtn();
  setInterval(checkWebReminders, 60000);
  if (isNative) {
    // Los eventos de notificación quedan retenidos hasta que hay listener,
    // así que también llegan los de un arranque en frío.
    LN()?.addListener?.('localNotificationActionPerformed', (ev) => {
      handleNotifAction(ev?.actionId, ev?.notification?.extra?.taskId);
    });
    Cap.Plugins?.App?.addListener?.('resume', () => { pullWidgetChanges(); app.render(); });
    scheduleNative();
    syncWidget();
    pullWidgetChanges();
  }
}
