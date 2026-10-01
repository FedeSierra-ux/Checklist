/* Tareas: filas, vistas Semana y Mes, archivo y acciones (completar,
   posponer, borrar) con "Deshacer". */
import { state, save, uid, touch, tomb } from '../store.js';
import { ui, app, $, reducedMotion, showOverlay, hideOverlay, pref,
  ICON_TRASH, ICON_CHECK, ICON_REPEAT } from './ctx.js';
import { DIAS, MESES, pad, ymd, parseYmd, startOfDay, addDays, taskDate, humanDue,
  shortDate, dowShort } from '../core/dates.js';
import { advancePast, describeRepeat } from '../core/repeat.js';
import { logEntry, weekStats, ARCHIVE_AFTER_DAYS } from '../core/model.js';
import { esc, hl } from '../core/text.js';
import { toast } from './toast.js';
import { haptic } from './native.js';
import { openSheet } from './task-sheet.js';

export const byPrioDate = (a, b) => (b.priority || 0) - (a.priority || 0)
  || ((taskDate(a) || Infinity) - (taskDate(b) || Infinity));

const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const SUB_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 11l3 3L20 6"/></svg>';

const tagsHTML = (tags, q) => (tags || []).map(tg =>
  `<button type="button" class="tag" data-tag="${esc(tg)}">#${hl(tg, q.replace(/^#/, ''))}</button>`).join('');

// "Mañana" si posponer la lleva a mañana; "+1 día" si ya era a futuro.
const snoozeLabel = (t) => (!t.date || t.date <= ymd(new Date())) ? 'Mañana' : '+1 día';

export function rowHTML(t, q = '') {
  const due = humanDue(t);
  const subs = t.subtasks || [];
  const subDone = subs.filter(s => s.done).length;
  const meta = [];
  if (subs.length) meta.push(`<button type="button" class="subcount" data-act="expand" aria-expanded="${!!ui.expanded[t.id]}">${SUB_ICON}${subDone}/${subs.length}</button>`);
  if (t.repeat) meta.push(`<span class="rep">${ICON_REPEAT}${esc(describeRepeat(t.repeat))}</span>`);
  meta.push(tagsHTML(t.tags, q));
  const metaHTML = meta.join('');
  const subsBlock = (ui.expanded[t.id] && subs.length) ? `<div class="subs">${subs.map(s =>
    `<div class="subrow ${s.done ? 'done' : ''}"><button type="button" class="sck ${s.done ? 'done' : ''}" data-act="subtoggle" data-sid="${s.id}" aria-label="Marcar paso"></button><span>${esc(s.text)}</span></div>`
  ).join('')}</div>` : '';
  const overdue = due && due.cls === 'due' ? ' overdue' : '';
  const pri = (!t.done && t.priority === 3) ? ' pri3' : '';
  return `<div class="row ${t.done ? 'done' : ''}${overdue}${pri}" data-id="${t.id}">
      <div class="swipe-bg done-hint">✓ Completar</div>
      <div class="swipe-actions"><button type="button" class="sa-snooze" data-act="snooze" tabindex="-1">${snoozeLabel(t)}</button><button type="button" class="sa-del" data-act="del" tabindex="-1" aria-label="Eliminar">🗑</button></div>
      <div class="row-surface">
        <button type="button" class="ck ${t.done ? 'done' : ''} p${t.priority || 0}" data-act="toggle" aria-label="${t.done ? 'Reactivar' : 'Completar'}"></button>
        <div class="main" data-act="edit" role="button" tabindex="0" aria-label="Editar ${esc(t.title)}">
          <div class="line1"><span class="tx">${hl(t.title, q)}</span>${due ? `<span class="when ${due.cls}">${due.label}</span>` : ''}</div>
          ${metaHTML ? `<div class="meta">${metaHTML}</div>` : ''}
          ${subsBlock}
        </div>
        <button type="button" class="del" data-act="del" aria-label="Eliminar">${ICON_TRASH}</button>
      </div>
    </div>`;
}

// Fila de una tarea archivada: tocar el círculo la reactiva.
export function archRowHTML(a, q = '') {
  const when = a.doneAt ? `✓ ${shortDate(new Date(a.doneAt))}` : '';
  const meta = (a.rec ? `<span class="rep">${ICON_REPEAT}repetición</span>` : '') + tagsHTML(a.tags, q);
  return `<div class="row done arch" data-arch="${esc(a.id)}">
      <div class="row-surface">
        <button type="button" class="ck done" data-act="arch-restore" ${a.rec ? 'disabled aria-label="Repetición completada"' : 'aria-label="Reactivar"'}></button>
        <div class="main">
          <div class="line1"><span class="tx">${hl(a.title, q)}</span><span class="when">${when}</span></div>
          ${meta ? `<div class="meta">${meta}</div>` : ''}
        </div>
      </div>
    </div>`;
}

// `kind`: 'due' pinta la marca en rojo; 'today' agranda el bloque de Hoy,
// que es lo primero que uno mira al abrir la app.
function sectionHTML(label, arr, kind = '') {
  if (!arr.length) return '';
  return `<div class="sec${kind ? ` ${kind}` : ''}"><span class="lead">${label}</span><span class="count">${arr.length}</span></div>`
    + `<div class="secbody${kind === 'today' ? ' today' : ''}">${arr.map(t => rowHTML(t)).join('')}</div>`;
}

export function emptyBox(title, desc, icon = ICON_EMPTY) {
  return `<div class="empty">${icon}<b>${title}</b><p>${desc}</p></div>`;
}
const ICON_EMPTY = '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

export function renderSemana(c) {
  const now = new Date(), today = startOfDay(now), tomorrow = addDays(today, 1);
  const b = { venc: [], hoy: [], man: [], sem: [], sin: [], hechas: [] };
  state.tasks.forEach(t => {
    if (t.done) { b.hechas.push(t); return; }
    const dt = taskDate(t);
    if (!dt) { b.sin.push(t); return; }
    if (dt < now) { b.venc.push(t); return; }
    const day = startOfDay(dt);
    if (+day === +today) b.hoy.push(t);
    else if (+day === +tomorrow) b.man.push(t);
    else b.sem.push(t);
  });
  ['venc', 'hoy', 'man', 'sem', 'sin'].forEach(k => b[k].sort(byPrioDate));
  b.hechas.sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));

  if (!state.tasks.length && !state.archive.length) {
    c.innerHTML = emptyBox('Todo en orden', 'No tenés tareas pendientes. Tocá el + para agregar una.');
    return;
  }

  // Progreso de ESTA semana (no de toda la historia).
  const { done, total } = weekStats(state, now);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const prog = total ? `<div class="week-prog" aria-label="Esta semana: ${done} de ${total} hechas">
      <div class="bar"><i style="width:${pct}%"></i></div><span class="pct">${done}/${total}</span></div>` : '';

  // Hoy va primero y destacado; lo vencido lo precede porque ya es tarde.
  const hoyVacio = (!b.hoy.length && !b.venc.length)
    ? `<div class="today-clear">${ICON_CHECK}<span>Hoy no tenés nada pendiente</span></div>` : '';

  // Completadas: plegadas por defecto; se archivan solas a los 7 días.
  let hechas = '';
  if (b.hechas.length) {
    hechas = `<button type="button" class="sec sec-toggle${ui.showDone ? ' open' : ''}" data-act="toggle-done" aria-expanded="${ui.showDone}">
        <span class="lead">Completadas</span><span class="count">${b.hechas.length}${CHEV}</span></button>`
      + (ui.showDone ? `<div class="secbody">${b.hechas.map(t => rowHTML(t)).join('')}</div>
          <p class="arch-note">Se archivan solas a los ${ARCHIVE_AFTER_DAYS} días.</p>` : '');
  }
  const arch = state.archive.length
    ? `<button type="button" class="arch-link" data-act="open-archive">Ver archivo (${state.archive.length})</button>` : '';

  c.innerHTML = prog
    + sectionHTML('Vencidas', b.venc, 'due')
    + sectionHTML('Hoy', b.hoy, 'today') + hoyVacio
    + sectionHTML('Mañana', b.man)
    + sectionHTML('Próximas', b.sem) + sectionHTML('Sin fecha', b.sin)
    + hechas + arch;
}

// ---------- Mes ----------
export function renderMes(c) {
  const y = ui.calMonth.getFullYear(), m = ui.calMonth.getMonth();
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const todayStr = ymd(new Date());
  const map = {};
  state.tasks.forEach(t => { if (t.date) (map[t.date] = map[t.date] || []).push(t); });
  state.archive.forEach(a => { if (a.date) (map[a.date] = map[a.date] || []).push({ ...a, done: true }); });
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div class="cell out" aria-hidden="true"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
    const arr = map[ds] || [];
    const pendTasks = arr.filter(t => !t.done);
    const pend = pendTasks.length, dn = arr.length - pend;
    const maxP = pendTasks.reduce((mx, t) => Math.max(mx, t.priority || 0), 0);
    const pips = arr.length ? `<span class="pips">${pend ? `<i class="p${maxP}"></i>` : ''}${dn ? '<i class="done"></i>' : ''}</span>` : '';
    const cls = ['cell', 'cur'];
    if (ds === todayStr) cls.push('today');
    if (ds === ui.selectedDay) cls.push('sel');
    const label = `${d} de ${MESES[m]}${pend ? `, ${pend} pendiente${pend > 1 ? 's' : ''}` : ''}`;
    cells += `<button type="button" class="${cls.join(' ')}" data-day="${ds}" aria-label="${label}" aria-pressed="${ds === ui.selectedDay}">${d}${pips}</button>`;
  }
  c.innerHTML = `<div class="cal">
      <div class="cal-head"><h3>${MESES[m]} ${y}</h3>
        <div class="cal-nav">
          <button type="button" data-cal="prev" aria-label="Mes anterior">‹</button>
          <button type="button" data-cal="today" class="cal-today">Hoy</button>
          <button type="button" data-cal="next" aria-label="Mes siguiente">›</button>
        </div></div>
      <div class="m-head" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="m-grid">${cells}</div></div><div id="dayDetail"></div>`;
  renderDayDetail();
}

export function renderDayDetail() {
  const box = $('#dayDetail');
  if (!box) return;
  if (!ui.selectedDay) {
    box.innerHTML = '<div class="empty slim"><p>Tocá un día para ver o agregar sus tareas.</p></div>';
    return;
  }
  const dt = parseYmd(ui.selectedDay);
  const tasks = state.tasks.filter(t => t.date === ui.selectedDay).sort(byPrioDate);
  const arch = state.archive.filter(a => a.date === ui.selectedDay);
  const n = tasks.length + arch.length;
  box.innerHTML = `<div class="sec"><span class="lead">${DIAS[dt.getDay()]} ${dt.getDate()} de ${MESES[dt.getMonth()]}</span><span class="count">${n} ${n === 1 ? 'tarea' : 'tareas'}</span></div>`
    + (n ? tasks.map(t => rowHTML(t)).join('') + arch.map(a => archRowHTML(a)).join('')
      : '<div class="empty slim"><p>Nada agendado.</p></div>')
    + '<button type="button" class="btn primary block" id="addForDay">+ Agregar tarea para este día</button>';
}

// ---------- Acciones ----------
const completing = new Set();

// Completar. Si es repetida, avanza a la próxima fecha y deja registro en el
// archivo; si no, queda tildada en "Completadas".
export function completeTask(id, { rowEl = null, silent = false } = {}) {
  const t0 = state.tasks.find(x => x.id === id);
  if (!t0 || t0.done || completing.has(id)) return;
  completing.add(id);
  haptic();
  const before = JSON.parse(JSON.stringify(t0));
  const apply = () => {
    completing.delete(id);
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    let msg = '✓ Completada', logId = null;
    if (t.repeat) {
      const today = ymd(new Date());
      logId = uid();
      state.archive.unshift(logEntry(t, logId));
      t.date = advancePast(t.repeat, t.date || today, today);
      (t.subtasks || []).forEach(s => { s.done = false; });
      const next = parseYmd(t.date);
      msg = `✓ Hecha · vuelve el ${dowShort(next)} ${shortDate(next)}`;
    } else {
      t.done = true;
      t.doneAt = Date.now();
    }
    touch(t);
    delete state.notified[id];
    delete state.snoozed[id];
    save(); app.render();
    if (!silent) toast(msg, { undo: () => undoComplete(id, before, logId) });
  };
  if (rowEl && !reducedMotion()) {
    rowEl.classList.add('completing');
    setTimeout(() => rowEl.classList.add('slideout'), 330);
    setTimeout(apply, 630);
  } else apply();
}

function undoComplete(id, before, logId) {
  const idx = state.tasks.findIndex(x => x.id === id);
  const restored = { ...before, u: Date.now() };
  if (idx >= 0) state.tasks[idx] = restored; else state.tasks.push(restored);
  if (logId) { state.archive = state.archive.filter(a => a.id !== logId); tomb(logId); }
  save(); app.render();
}

// Los "Deshacer" buscan por id al momento de deshacer: si en el medio llegó
// una sincronización, el objeto original ya no es el que está en el estado.
const taskById = (id) => state.tasks.find(x => x.id === id);

export function reactivateTask(id) {
  const t = taskById(id);
  if (!t || !t.done) return;
  const doneAt = t.doneAt;
  t.done = false; delete t.doneAt; touch(t);
  save(); app.render();
  toast('Reactivada', {
    undo: () => { const x = taskById(id); if (!x) return; x.done = true; x.doneAt = doneAt; touch(x); save(); app.render(); },
  });
}

export function toggleTask(id, rowEl) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.done) reactivateTask(id); else completeTask(id, { rowEl });
}

export function delTask(id) {
  const idx = state.tasks.findIndex(x => x.id === id);
  if (idx < 0) return;
  const t = state.tasks[idx];
  state.tasks.splice(idx, 1);
  tomb(id); delete state.notified[id]; delete state.snoozed[id];
  save(); app.render();
  toast('Tarea eliminada', {
    undo: () => {
      delete state.trash[id];
      state.tasks.splice(Math.min(idx, state.tasks.length), 0, { ...t, u: Date.now() + 1 });
      save(); app.render();
    },
  });
}

// Posponer un día: desde hoy si estaba vencida o era para hoy (no desde la
// fecha vieja, que la dejaba vencida igual).
export function snoozeTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const today = ymd(new Date());
  const prev = t.date || null;
  const base = t.date && t.date > today ? t.date : today;
  t.date = ymd(addDays(parseYmd(base), 1));
  touch(t); delete state.notified[id]; delete state.snoozed[id];
  haptic(); save(); app.render();
  const d = parseYmd(t.date);
  const label = t.date === ymd(addDays(new Date(), 1)) ? 'mañana' : `${dowShort(d)} ${shortDate(d)}`;
  toast(`→ Pospuesta a ${label}`, {
    undo: () => { const x = taskById(id); if (!x) return; x.date = prev; touch(x); save(); app.render(); },
  });
}

export function toggleSub(id, sid) {
  const t = state.tasks.find(x => x.id === id);
  const s = t && (t.subtasks || []).find(x => x.id === sid);
  if (!s) return;
  s.done = !s.done; touch(s); touch(t);
  save(); app.render();
}

export function restoreArchived(id) {
  const a = state.archive.find(x => x.id === id);
  if (!a || a.rec) return;
  const now = Date.now();
  state.archive = state.archive.filter(x => x.id !== id);
  tomb(id, now);                                   // mata la entrada del archivo…
  state.tasks.push({                               // …pero no a la tarea (u posterior)
    id, title: a.title, tags: a.tags || [], priority: a.priority || 0,
    date: a.date || null, time: a.time || null, subtasks: [], remind: 60, done: false, u: now + 1,
  });
  save(); app.render();
  if (!$('#archOverlay').hidden) renderArchive();
  toast('Reactivada');
}

// ---------- Archivo ----------
function renderArchive() {
  const box = $('#archList');
  const list = [...state.archive].sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
  if (!list.length) { box.innerHTML = '<div class="empty slim"><p>El archivo está vacío.</p></div>'; return; }
  const groups = new Map();
  list.forEach(a => {
    const d = new Date(a.doneAt || 0);
    const k = `${MESES[d.getMonth()]} ${d.getFullYear()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  });
  box.innerHTML = [...groups].map(([k, arr]) =>
    `<div class="sec"><span class="lead">${k}</span><span class="count">${arr.length}</span></div>${arr.map(a => archRowHTML(a)).join('')}`).join('');
}
export function openArchive() { renderArchive(); showOverlay($('#archOverlay')); }

// ---------- Clicks en el contenido ----------
// Devuelve true si el click era de tareas.
export function handleTaskClick(e) {
  const calBtn = e.target.closest('[data-cal]');
  if (calBtn) {
    const d = calBtn.dataset.cal;
    const cm = ui.calMonth;
    if (d === 'prev') cm.setMonth(cm.getMonth() - 1);
    else if (d === 'next') cm.setMonth(cm.getMonth() + 1);
    else { ui.calMonth = new Date(); ui.calMonth.setDate(1); ui.selectedDay = ymd(new Date()); }
    app.render(); return true;
  }
  const cell = e.target.closest('.cell[data-day]');
  if (cell) { ui.selectedDay = ui.selectedDay === cell.dataset.day ? null : cell.dataset.day; app.render(); return true; }
  if (e.target.closest('#addForDay')) { openSheet(null, { date: ui.selectedDay }); return true; }

  const actEl = e.target.closest('[data-act]');
  if (!actEl) return false;
  const act = actEl.dataset.act;
  if (act === 'toggle-done') { ui.showDone = !ui.showDone; pref('tudu.showDone', ui.showDone ? '1' : '0'); app.render(); return true; }
  if (act === 'open-archive') { openArchive(); return true; }
  if (act === 'arch-restore') { restoreArchived(actEl.closest('[data-arch]').dataset.arch); return true; }

  const card = actEl.closest('.row[data-id]');
  if (!card) return false;
  const id = card.dataset.id;
  if (act === 'toggle') toggleTask(id, card);
  else if (act === 'edit') openSheet(id);
  else if (act === 'del') delTask(id);
  else if (act === 'snooze') snoozeTask(id);
  else if (act === 'expand') { ui.expanded[id] = !ui.expanded[id]; app.render(); }
  else if (act === 'subtoggle') toggleSub(id, actEl.dataset.sid);
  else return false;
  return true;
}

export function initArchiveSheet() {
  const ov = $('#archOverlay');
  $('#archClose').addEventListener('click', () => hideOverlay(ov));
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { hideOverlay(ov); return; }
    const b = e.target.closest('[data-act="arch-restore"]');
    if (b) restoreArchived(b.closest('[data-arch]').dataset.arch);
  });
}
