/* Avisos cortos y "Deshacer". Cada acción que borra o completa algo pasa
   una función `undo`; si en 5 segundos no se toca, corre `commit` (por
   ejemplo, borrar del servidor las imágenes de una nota eliminada). */
import { esc } from '../core/text.js';

let timer = null;
let pending = null;              // { undo, commit }

const el = () => document.getElementById('toast');

function hide() {
  const t = el();
  if (t) t.hidden = true;
  clearTimeout(timer);
}

// Confirma la acción pendiente (ya no se puede deshacer).
export function flushUndo() {
  const p = pending;
  pending = null;
  if (p && p.commit) p.commit();
}

export function toast(msg, { undo = null, commit = null } = {}) {
  flushUndo();
  const t = el();
  if (!t) return;
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button type="button" class="toast-undo">Deshacer</button>' : '');
  t.classList.toggle('has-undo', !!undo);
  t.hidden = false;
  if (undo) pending = { undo, commit };
  clearTimeout(timer);
  timer = setTimeout(() => { hide(); flushUndo(); }, undo ? 5000 : 2200);
}

export function initToast() {
  el().addEventListener('click', (e) => {
    if (!e.target.closest('.toast-undo')) return;
    const p = pending;
    pending = null;
    hide();
    if (p) p.undo();
  });
  // Si la app se va a segundo plano, lo pendiente se confirma.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushUndo(); });
  window.addEventListener('pagehide', flushUndo);
}
