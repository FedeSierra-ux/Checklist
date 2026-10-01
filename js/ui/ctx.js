/* Estado de la interfaz compartido entre módulos (vista, búsqueda, mes) y
   helpers de DOM. `app` se completa en main.js; los módulos lo usan para
   pedir un re-render sin importarse en círculo. */

export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => [...c.querySelectorAll(s)];

export function pref(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { /* modo privado */ }
  return null;
}

const firstOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };

export const ui = {
  view: 'semana',
  query: '',
  calMonth: firstOfMonth(),
  selectedDay: null,
  expanded: {},                                   // id → subtareas desplegadas
  showDone: pref('tudu.showDone') === '1',        // "Completadas" abierta
  shopTab: pref('tudu.shopTab') === 'precios' ? 'precios' : 'listas',
};

export const app = {
  render() {},
};

export const reducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);

// Abre/cierra hojas; Escape cierra la de arriba (ver main.js).
export function showOverlay(el) { el.hidden = false; }
export function hideOverlay(el) { el.hidden = true; }

export const ICON_TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
export const ICON_CHECK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L20 6"/></svg>';
export const ICON_REPEAT = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
