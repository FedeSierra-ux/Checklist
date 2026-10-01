/* Hoja de nueva/editar tarea. A la vista: título, fecha, hora y prioridad.
   Etiquetas, repetición, subtareas y aviso viven en "Más opciones". */
import { state, save, uid, touch } from '../store.js';
import { ui, app, $, $$, showOverlay, hideOverlay } from './ctx.js';
import { ymd, parseYmd, shortDate, dowShort } from '../core/dates.js';
import { parseQuick } from '../core/parse.js';
import { cleanRepeat, firstOnOrAfter, describeRepeat } from '../core/repeat.js';
import { esc } from '../core/text.js';
import { toast } from './toast.js';
import { maybeAskNotify } from './native.js';
import { delTask } from './tasks.js';

const PRIO_LABEL = { 1: 'Baja', 2: 'Media', 3: 'Alta' };
const UNIT_LABEL = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'], year: ['año', 'años'] };
const REMIND_LABEL = { 0: 'aviso a la hora', 30: 'aviso 30 min antes', 180: 'aviso 3 h antes', 1440: 'aviso 1 día antes' };

let editingId = null;
let origDate = null;
let draftSubs = [];
let draftRep = null;
let onSaved = null;            // p. ej. borrar la nota que se convirtió en tarea

const overlay = () => $('#sheetOverlay');

export function openSheet(id = null, preset = {}) {
  editingId = id;
  const t = id ? state.tasks.find(x => x.id === id) : null;
  onSaved = preset.onSaved || null;
  origDate = t ? t.date || null : null;
  $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
  $('#fTitle').value = t ? t.title : (preset.title || '');
  $('#fDate').value = t ? (t.date || '') : (preset.date || '');
  $('#fTime').value = t ? (t.time || '') : '';
  setTags(t ? t.tags || [] : preset.tags || []);
  $('#fRemind').value = String(t ? (t.remind ?? 60) : 60);
  setPrio(t ? (t.priority || 0) : 0);
  draftSubs = (t ? t.subtasks || [] : preset.subtasks || []).map(s => ({ ...s }));
  draftRep = t && t.repeat ? { ...t.repeat, days: t.repeat.days ? [...t.repeat.days] : undefined } : null;
  renderDraftSubs(); renderTagChips(); renderRepeat();
  $('#parseHint').textContent = '';
  $('#sheetDelete').hidden = !id;
  setMore(!!(draftSubs.length || draftRep || currentTags().length));
  showOverlay(overlay());
  setTimeout(() => $('#fTitle').focus(), 250);
}

export function hideSheet() {
  hideOverlay(overlay());
  editingId = null; draftSubs = []; draftRep = null; onSaved = null;
}

function setMore(open) {
  $('#moreBox').hidden = !open;
  $('#moreToggle').setAttribute('aria-expanded', String(open));
  $('#moreToggle').classList.toggle('open', open);
  updateSummary();
}

// Resumen de lo que hay en "Más opciones", para no tener que abrirlo.
function updateSummary() {
  const bits = [];
  const tags = currentTags();
  if (tags.length) bits.push(tags.map(t => '#' + t).join(' '));
  if (draftRep) bits.push('↻ ' + describeRepeat(anchored(draftRep)));
  if (draftSubs.length) bits.push(`${draftSubs.length} ${draftSubs.length === 1 ? 'paso' : 'pasos'}`);
  const r = Number($('#fRemind').value);
  if (r !== 60 && REMIND_LABEL[r]) bits.push(REMIND_LABEL[r]);
  $('#moreSummary').textContent = bits.join(' · ');
}

// --- Prioridad ---
function setPrio(p) { $$('.pchip').forEach(c => c.classList.toggle('on', +c.dataset.p === p)); }
function getPrio() { const el = $('.pchip.on'); return el ? +el.dataset.p : 0; }

// --- Etiquetas (reemplazan a las categorías fijas) ---
function currentTags() {
  return [...new Set($('#fTags').value.split(/[\s,]+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean))];
}
function setTags(list) { $('#fTags').value = list.map(t => '#' + t).join(' '); }

function renderTagChips() {
  const freq = new Map();
  [...state.tasks, ...state.archive].forEach(t => (t.tags || []).forEach(g => freq.set(g, (freq.get(g) || 0) + 1)));
  const cur = currentTags();
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 14);
  const all = [...new Set([...top, ...cur])];
  const box = $('#tagChips');
  box.innerHTML = all.map(g =>
    `<button type="button" class="tchip${cur.includes(g) ? ' on' : ''}" data-tag="${esc(g)}" aria-pressed="${cur.includes(g)}">#${esc(g)}</button>`).join('');
  box.hidden = !all.length;
}

// --- Repetición ---
const baseDate = () => $('#fDate').value || ymd(new Date());
// Completa la regla con el día de la fecha elegida (para mostrarla/guardarla).
function anchored(r) {
  const out = { ...r };
  if (out.unit === 'week' && !(out.days && out.days.length)) out.days = [parseYmd(baseDate()).getDay()];
  if (out.unit === 'month' && !out.md) out.md = parseYmd(baseDate()).getDate();
  return cleanRepeat(out);                      // días ordenados de lunes a domingo
}

function renderRepeat() {
  const unit = draftRep ? draftRep.unit : '';
  $$('.rchip').forEach(c => { const on = c.dataset.rep === unit; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
  $('#repDetail').hidden = !draftRep;
  if (draftRep) {
    const n = draftRep.every || 1;
    if (document.activeElement !== $('#repEvery')) $('#repEvery').value = n;
    $('#repUnit').textContent = UNIT_LABEL[unit][n === 1 ? 0 : 1];
    $('#repDays').hidden = unit !== 'week';
    const days = anchored(draftRep).days || [];
    $$('#repDays button').forEach(b => {
      const on = days.includes(+b.dataset.d);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }
  $('#repHint').textContent = draftRep ? '↻ Se repite ' + describeRepeat(anchored(draftRep)) : '';
  updateSummary();
}

// --- Subtareas ---
function renderDraftSubs() {
  $('#subsEditor').innerHTML = draftSubs.map((s, i) =>
    `<div class="se-row"><span>${esc(s.text)}</span><button type="button" data-i="${i}" aria-label="Quitar paso">&times;</button></div>`).join('');
  updateSummary();
}
function addDraftSub() {
  const inp = $('#subInput');
  const v = inp.value.trim();
  if (!v) return;
  draftSubs.push({ id: uid(), text: v, done: false });
  inp.value = ''; renderDraftSubs(); inp.focus();
}

// Vista previa de lo que se entendió del texto.
function parseHint() {
  const p = parseQuick($('#fTitle').value);
  const bits = [];
  if (p.date && (p.explicitDate || p.repeat || p.time)) { const d = parseYmd(p.date); bits.push(`📅 ${dowShort(d)} ${shortDate(d)}`); }
  if (p.time) bits.push('🕑 ' + p.time);
  if (p.repeat) bits.push('↻ ' + describeRepeat(p.repeat));
  if (p.priority) bits.push('⚑ ' + PRIO_LABEL[p.priority]);
  if (p.tags.length) bits.push(p.tags.map(t => '#' + t).join(' '));
  $('#parseHint').textContent = bits.length ? 'Detecté: ' + bits.join(' · ') : '';
}

function submit(e) {
  e.preventDefault();
  const raw = $('#fTitle').value.trim();
  if (!raw) return;
  const p = parseQuick(raw);
  const title = p.title || raw;
  const tags = [...new Set([...currentTags(), ...p.tags])];
  const fieldDate = $('#fDate').value || null;
  // Lo escrito en el título manda sobre los campos: es lo último que se tocó.
  let date = p.explicitDate ? p.date : (fieldDate || p.date || null);
  const time = p.time || $('#fTime').value || null;
  let repeat = cleanRepeat(p.repeat || draftRep);
  if (repeat) {
    if (!date) date = ymd(new Date());
    // Si se cambió la fecha de una mensual, el día del mes sigue a la fecha.
    if (repeat.unit === 'month' && !p.repeat && fieldDate && fieldDate !== origDate) repeat.md = parseYmd(fieldDate).getDate();
    repeat = cleanRepeat({ ...repeat, ...anchoredFor(repeat, date) });
    date = firstOnOrAfter(repeat, date);
  } else if (time && !date) {
    date = ymd(new Date());
  }
  const data = {
    title, date, time, tags,
    priority: p.priority != null ? p.priority : getPrio(),
    subtasks: draftSubs,
    remind: Number($('#fRemind').value),
  };
  const wasEditing = !!editingId;
  const cb = onSaved;
  let id = editingId;
  if (wasEditing) {
    const t = state.tasks.find(x => x.id === editingId);
    if (t) {
      Object.assign(t, data);
      if (repeat) t.repeat = repeat; else delete t.repeat;
      touch(t);
      delete state.notified[t.id]; delete state.snoozed[t.id];
    }
  } else {
    id = uid();
    state.tasks.push({ id, done: false, u: Date.now(), ...data, ...(repeat ? { repeat } : {}) });
  }
  save(); hideSheet();
  if (ui.view === 'mes' && date) ui.selectedDay = date;
  app.render();
  if (cb) cb(id);
  else toast(wasEditing ? 'Tarea actualizada' : 'Tarea agregada');
  maybeAskNotify();
}

function anchoredFor(r, date) {
  const out = {};
  if (r.unit === 'week' && !(r.days && r.days.length)) out.days = [parseYmd(date).getDay()];
  if (r.unit === 'month' && !r.md) out.md = parseYmd(date).getDate();
  return out;
}

export function initTaskSheet() {
  $('#taskForm').addEventListener('submit', submit);
  $('#fTitle').addEventListener('input', parseHint);
  $('#sheetCancel').addEventListener('click', hideSheet);
  overlay().addEventListener('click', (e) => { if (e.target === overlay()) hideSheet(); });
  $('#sheetDelete').addEventListener('click', () => {
    if (!editingId) return;
    const id = editingId;
    hideSheet();
    delTask(id);                     // con "Deshacer", sin confirm()
  });
  $('#moreToggle').addEventListener('click', () => setMore($('#moreBox').hidden));
  $$('.pchip').forEach(c => c.addEventListener('click', () => setPrio(+c.dataset.p)));

  $('#tagChips').addEventListener('click', (e) => {
    const b = e.target.closest('.tchip');
    if (!b) return;
    const cur = currentTags();
    const g = b.dataset.tag;
    setTags(cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g]);
    renderTagChips(); updateSummary();
  });
  $('#fTags').addEventListener('input', () => {
    const cur = currentTags();
    $$('.tchip').forEach(c => c.classList.toggle('on', cur.includes(c.dataset.tag)));
    updateSummary();
  });

  $('#repChips').addEventListener('click', (e) => {
    const b = e.target.closest('.rchip');
    if (!b) return;
    const unit = b.dataset.rep;
    draftRep = unit ? { every: draftRep && draftRep.unit === unit ? draftRep.every : 1, unit } : null;
    renderRepeat();
  });
  $('#repEvery').addEventListener('input', () => {
    if (!draftRep) return;
    draftRep.every = Math.min(99, Math.max(1, parseInt($('#repEvery').value, 10) || 1));
    renderRepeat();
  });
  $('#repDays').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b || !draftRep) return;
    const d = +b.dataset.d;
    const days = anchored(draftRep).days || [];
    draftRep.days = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    if (!draftRep.days.length) delete draftRep.days;
    renderRepeat();
  });
  $('#fDate').addEventListener('change', () => { if (draftRep) renderRepeat(); });
  $('#fRemind').addEventListener('change', updateSummary);

  $('#subsEditor').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    draftSubs.splice(+b.dataset.i, 1); renderDraftSubs();
  });
  $('#subAddBtn').addEventListener('click', addDraftSub);
  $('#subInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDraftSub(); } });
}
