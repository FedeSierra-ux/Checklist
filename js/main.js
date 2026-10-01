/* Tudu — punto de entrada. Arma la interfaz con los módulos de js/ui y la
   conecta con el estado (store.js), la sincronización (sync.js) y lo nativo.
   Corre como web (PWA) y dentro del APK (Capacitor), sin paso de build:
   son módulos ES que el navegador carga tal cual. */
import { state, persist, hooks, isFirstRun, syncPayload, applyPayload, uid, save } from './store.js';
import { ui, app, $, $$, reducedMotion } from './ui/ctx.js';
import { DIAS, MESES, ymd, addDays, taskDate } from './core/dates.js';
import { archiveOld } from './core/model.js';
import { initToast } from './ui/toast.js';
import { renderSemana, renderMes, handleTaskClick, initArchiveSheet } from './ui/tasks.js';
import { openSheet, initTaskSheet, hideSheet } from './ui/task-sheet.js';
import { renderCompras, handleShopClick, handleShopSubmit, initShopping, shopFab, pendingItems } from './ui/shopping.js';
import { renderNotas, handleNoteClick, initNotes, openNote, closeNoteEditor } from './ui/notes.js';
import { renderSearch } from './ui/search.js';
import { initGestures, closeSwipe } from './ui/gestures.js';
import { initNative, isNative, scheduleNative, syncWidget, pullWidgetChanges, checkWebReminders } from './ui/native.js';
import { initSyncPanel, renderSync } from './ui/sync-panel.js';
import { initServiceWorker } from './ui/sw-client.js';
import { Sync } from './sync.js';

const content = $('#content');
const TITLES = { semana: 'Esta semana', mes: 'Este mes', compras: 'Compras', notas: 'Notas' };

// ---------- Render ----------
function render() {
  updateTop();
  closeSwipe();
  const first = reducedMotion() ? null : captureRects();
  if (ui.query) renderSearch(content);
  else if (ui.view === 'semana') renderSemana(content);
  else if (ui.view === 'mes') renderMes(content);
  else if (ui.view === 'notas') renderNotas(content);
  else renderCompras(content);
  if (first) flipPlay(first);
  checkWebReminders();
}
app.render = render;
app.closeSearch = () => closeSearch(true);

// FLIP: mide posiciones antes de re-render y anima el reacomodo de las filas.
function captureRects() {
  const m = new Map();
  content.querySelectorAll('.row[data-id]').forEach(r => m.set(r.dataset.id, r.getBoundingClientRect().top));
  return m;
}
function flipPlay(first) {
  content.querySelectorAll('.row[data-id]').forEach(r => {
    const prev = first.get(r.dataset.id);
    if (prev == null) return;
    const dy = prev - r.getBoundingClientRect().top;
    if (Math.abs(dy) < 2) return;
    r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
  });
}

function setCnt(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !n; el.textContent = n || '';
}

function updateTop() {
  const now = new Date();
  $('#topDay').textContent = `${DIAS[now.getDay()]} · ${now.getDate()} ${MESES[now.getMonth()].slice(0, 3)}`;
  $('#topTitle').textContent = ui.query ? 'Buscar' : TITLES[ui.view];
  $$('.navc-btn').forEach(b => {
    const on = b.dataset.view === ui.view && !ui.query;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  });
  $('#fab').style.display = (ui.view === 'mes' && !ui.query) ? 'none' : 'flex';
  // En el chip va lo urgente (hoy + vencido), que es el número que importa.
  const todayStr = ymd(now);
  setCnt('cntSemana', state.tasks.filter(t => !t.done && (t.date === todayStr || (taskDate(t) && taskDate(t) < now))).length);
  setCnt('cntCompras', pendingItems());
  setCnt('cntNotas', state.notes.length);
}

// ---------- Navegación y búsqueda ----------
const searchbar = $('#searchbar'), searchInput = $('#searchInput');
function openSearch(preset = '') {
  searchbar.hidden = false; $('#searchBtn').classList.add('active');
  searchInput.value = preset; ui.query = preset; render();
  if (!preset) setTimeout(() => searchInput.focus(), 50);
}
function closeSearch(rerender = true) {
  searchbar.hidden = true; $('#searchBtn').classList.remove('active');
  searchInput.value = ''; ui.query = '';
  if (rerender) render();
}

function goTo(view) {
  ui.view = view;
  closeSearch(false);
  if (view === 'mes' && !ui.selectedDay) ui.selectedDay = ymd(new Date());
  render();
  window.scrollTo({ top: 0 });
}

function fab() {
  if (ui.query) openSheet();
  else if (ui.view === 'notas') openNote();
  else if (ui.view === 'compras') shopFab();
  else openSheet();
}

// Escape cierra lo de arriba de todo; "/" busca; "n" agrega.
const CLOSERS = { sheetOverlay: hideSheet, noteOverlay: closeNoteEditor };
function topOverlay() {
  const v = $('#imgViewer');
  if (!v.hidden) return v;
  return $$('.sheet-overlay').reverse().find(o => !o.hidden) || null;
}
function onKey(e) {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    const ov = topOverlay();
    if (ov) {
      e.preventDefault();
      (CLOSERS[ov.id] || ((el) => { el.hidden = true; }))(ov);
      if (ov.id === 'imgViewer') $('#imgViewerImg').src = '';
      return;
    }
    if (ui.query || !searchbar.hidden) { closeSearch(); return; }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || topOverlay()) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); fab(); }
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]:not(button)')) {
    e.preventDefault(); e.target.click();
  }
}

// ---------- Mantenimiento ----------
// Archiva las completadas viejas y limpia memoria local de avisos.
function housekeeping() {
  const n = archiveOld(state);
  const now = Date.now();
  for (const [id, ts] of Object.entries(state.snoozed)) if (ts < now - 86400000) delete state.snoozed[id];
  for (const id of Object.keys(state.notified)) if (!state.tasks.some(t => t.id === id)) delete state.notified[id];
  if (n) save();
}

// ---------- Ejemplo del primer arranque ----------
function seed() {
  const today = new Date();
  const mk = (off, time, title, priority, tags = [], subtasks = [], extra = {}) => ({
    id: uid(), title, priority, tags, subtasks, date: ymd(addDays(today, off)), time,
    done: false, remind: 60, u: Date.now(), ...extra,
  });
  state.tasks = [
    mk(0, '18:00', 'Pedir turno médico', 3, ['salud'], [
      { id: uid(), text: 'Buscar cobertura', done: false },
      { id: uid(), text: 'Llamar a la clínica', done: false },
      { id: uid(), text: 'Confirmar horario', done: false },
    ]),
    mk(0, null, 'Comprar regalo de mamá', 2, ['casa']),
    mk(1, '10:00', 'Llamar al dentista', 1, ['salud']),
    mk(3, null, 'Entregar informe mensual', 2, ['trabajo']),
    mk(0, null, 'Pagar factura de luz', 0, ['trámites'], [], { done: true, doneAt: Date.now() }),
  ];
  state.lists = [{ id: uid(), name: 'Supermercado', u: Date.now(), items: [
    { id: uid(), text: 'Leche', qty: '2', done: false, o: 0, u: Date.now() },
    { id: uid(), text: 'Pan', done: false, o: 1, u: Date.now() },
    { id: uid(), text: 'Café', done: true, o: 2, u: Date.now() },
  ] }];
  persist();
}

// ---------- Init ----------
function init() {
  if (isFirstRun()) seed();
  initToast();
  initTaskSheet();
  initArchiveSheet();
  initShopping(content);
  initNotes();
  initSyncPanel();
  initGestures(content);

  content.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.tag[data-tag]');
    if (tagEl) { openSearch('#' + tagEl.dataset.tag); return; }
    handleNoteClick(e) || handleTaskClick(e) || handleShopClick(e);
  });
  content.addEventListener('submit', (e) => { handleShopSubmit(e); });

  $$('.navc-btn').forEach(btn => btn.addEventListener('click', () => goTo(btn.dataset.view)));
  $('#fab').addEventListener('click', fab);
  $('#searchBtn').addEventListener('click', () => (searchbar.hidden ? openSearch() : closeSearch()));
  $('#searchClear').addEventListener('click', () => closeSearch());
  searchInput.addEventListener('input', () => { ui.query = searchInput.value.trim(); render(); });
  document.addEventListener('keydown', onKey);

  hooks.afterPersist.push(scheduleNative, syncWidget);
  hooks.onSave.push(() => Sync.schedulePush());

  housekeeping();
  render();
  initNative();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    housekeeping(); pullWidgetChanges(); render();
  });
  setInterval(housekeeping, 30 * 60000);

  Sync.init({
    getState: syncPayload,
    applyRemote: (p) => { applyPayload(p); persist(); render(); },
    onStatus: renderSync,
  });
  initServiceWorker(isNative);
}

init();
