/* Estado de la app: vive en localStorage (fuente de verdad local). Los
   módulos importan `state` y lo mutan; `save()` guarda, reprograma avisos y
   widget (hooks.afterPersist) y avisa a la sincronización (hooks.onSave). */
import { migrate } from './core/model.js';

export const STORE_KEY = 'pendientes.v2';

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem('pendientes.v1');
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { /* datos corruptos: arrancar de cero */ }
  return migrate({});
}

export const state = load();
export const isFirstRun = () => !localStorage.getItem(STORE_KEY) && !localStorage.getItem('pendientes.v1');

export const hooks = { afterPersist: [], onSave: [] };

// Guarda en el dispositivo y reprograma avisos/widget. No toca la nube.
export function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sin lugar */ }
  hooks.afterPersist.forEach(f => f());
}
export function save() {
  persist();
  hooks.onSave.forEach(f => f());
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// `u` = última modificación (ms). La usa la sincronización para decidir qué
// versión gana.
export const touch = (o) => { if (o) o.u = Date.now(); return o; };
// Tumba: lo borrado no revive desde otro dispositivo.
export const tomb = (id, at = Date.now()) => { state.trash[id] = at; };

export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
}

// Lo que viaja a la nube. `notified` y `snoozed` quedan afuera a propósito:
// son memoria local de qué avisos ya sonaron en ESTE dispositivo.
export const syncPayload = () => ({
  tasks: state.tasks, lists: state.lists, notes: state.notes, prices: state.prices,
  archive: state.archive, trash: state.trash,
});

export function applyPayload(p) {
  replaceState(migrate({ ...p, notified: state.notified, snoozed: state.snoozed }));
}
