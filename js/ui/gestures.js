/* Gestos: swipe en las filas de tareas (→ completar, ← posponer/eliminar)
   y arrastrar una tarea a otro día en la vista Mes. */
import { state, save, touch } from '../store.js';
import { ui } from './ctx.js';
import { toggleTask, renderMes } from './tasks.js';
import { haptic } from './native.js';
import { toast } from './toast.js';
import { parseYmd, shortDate } from '../core/dates.js';

export let closeSwipe = () => {};

export function initGestures(content, rerender) {
  swipe(content);
  dragToDay(content, rerender);
}

function swipe(content) {
  const OPEN = -140;           // px que se abre para revelar acciones
  let row = null, surf = null, id = null, x0 = 0, y0 = 0, dx = 0, mode = null, tx0 = 0, consumed = false;
  let openRow = null;

  function reset() {
    if (openRow) {
      const s = openRow.querySelector('.row-surface');
      if (s) s.style.transform = '';
      openRow.classList.remove('show-done'); openRow = null;
    }
  }
  closeSwipe = reset;

  content.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = e.target.closest('.row[data-id]');
    if (!r || r.closest('#dayDetail')) return;            // en el calendario manda el drag
    if (e.target.closest('.swipe-actions')) return;       // dejar que el botón haga lo suyo
    if (openRow && openRow !== r) reset();
    row = r; surf = r.querySelector('.row-surface'); id = r.dataset.id;
    x0 = e.clientX; y0 = e.clientY;
    dx = 0; mode = null; tx0 = (openRow === r) ? OPEN : 0;
  });

  content.addEventListener('pointermove', (e) => {
    if (!row || !surf) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (mode === null) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
      mode = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (mode === 'h') surf.classList.add('swiping');
    }
    if (mode !== 'h') { row = null; surf = null; return; }
    e.preventDefault();
    let t = tx0 + ddx;
    if (t > 0) { t = Math.min(t, 120); row.classList.add('show-done'); }
    else { t = Math.max(t, OPEN - 30); row.classList.remove('show-done'); }
    dx = t; surf.style.transform = `translateX(${t}px)`;
  });

  function finish() {
    if (!row || !surf) { row = null; surf = null; return; }
    const r = row, s = surf, theId = id;
    row = null; surf = null;
    s.classList.remove('swiping');
    if (mode !== 'h') return;                     // fue un tap: lo maneja el click
    consumed = true;
    if (dx > 80) {                                // → completar
      s.style.transform = ''; r.classList.remove('show-done');
      if (openRow === r) openRow = null;
      toggleTask(theId, r);
    } else if (dx < -70) {                        // ← revelar acciones
      s.style.transform = `translateX(${OPEN}px)`; openRow = r;
    } else {                                      // no alcanzó: volver
      s.style.transform = ''; r.classList.remove('show-done');
      if (openRow === r) openRow = null;
    }
  }
  content.addEventListener('pointerup', finish);
  content.addEventListener('pointercancel', () => {
    if (surf) surf.classList.remove('swiping');
    if (surf) surf.style.transform = (openRow === row) ? `translateX(${OPEN}px)` : '';
    row = null; surf = null;
  });

  // Un tap fuera cierra las acciones abiertas.
  document.addEventListener('pointerdown', (e) => {
    if (openRow && !e.target.closest('.row[data-id]')) reset();
  });
  // Evita que el click posterior a un swipe dispare toggle/edit.
  content.addEventListener('click', (e) => {
    if (consumed) { e.stopPropagation(); e.preventDefault(); consumed = false; }
  }, true);
}

// Drag de una tarea a otro día (vista Mes, sobre el detalle del día).
function dragToDay(content) {
  let src = null, id = null, ghost = null, timer = null, active = false, sx = 0, sy = 0;

  content.addEventListener('pointerdown', (e) => {
    if (ui.view !== 'mes') return;
    const r = e.target.closest('#dayDetail .row[data-id]');
    if (!r || e.target.closest('.swipe-actions')) return;
    src = r; id = r.dataset.id; sx = e.clientX; sy = e.clientY; active = false;
    timer = setTimeout(startDrag, 320);            // long-press
  });
  function startDrag() {
    if (!src) return;
    active = true; haptic(); src.classList.add('dragging');
    const t = state.tasks.find(x => x.id === id);
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost'; ghost.textContent = t ? t.title : '';
    document.body.appendChild(ghost); moveGhost(sx, sy);
  }
  function moveGhost(x, y) { if (ghost) { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y - 12) + 'px'; } }
  const cellUnder = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.closest('.cell[data-day]') : null; };

  content.addEventListener('pointermove', (e) => {
    if (!src) return;
    if (!active) {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { clearTimeout(timer); src = null; }
      return;
    }
    e.preventDefault(); moveGhost(e.clientX, e.clientY);
    const cell = cellUnder(e.clientX, e.clientY);
    document.querySelectorAll('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
    if (cell) cell.classList.add('drop-target');
  });
  function end(e) {
    clearTimeout(timer);
    const wasActive = active;
    if (active) {
      const cell = cellUnder(e.clientX, e.clientY);
      const t = cell && state.tasks.find(x => x.id === id);
      if (t && t.date !== cell.dataset.day) {
        const prev = t.date;
        t.date = cell.dataset.day; touch(t); delete state.notified[id];
        ui.selectedDay = cell.dataset.day; haptic(); save();
        toast('Movida al ' + shortDate(parseYmd(t.date)), {
          undo: () => {
            const x = state.tasks.find(y => y.id === t.id);
            if (!x) return;
            x.date = prev; touch(x); ui.selectedDay = prev; save(); renderMes(content);
          },
        });
      }
    }
    cleanup(wasActive);
  }
  function cleanup(rerender) {
    if (ghost) { ghost.remove(); ghost = null; }
    document.querySelectorAll('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
    if (src) src.classList.remove('dragging');
    src = null; active = false;
    if (rerender) renderMes(content);
  }
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', () => { clearTimeout(timer); cleanup(false); });
}
