/* Modelo de datos: forma del estado, migraciones y archivo de completadas.
   Puro (sin DOM ni localStorage) para poder probarlo en Node. */
import { weekRange, taskDate } from './dates.js';
import { cleanRepeat } from './repeat.js';

const DAY = 86400000;
// Las completadas quedan a la vista una semana y después pasan al archivo
// (compacto: sin subtareas ni avisos). El archivo guarda un año, con tope,
// para que el documento sincronizado no crezca sin límite.
export const ARCHIVE_AFTER_DAYS = 7;
export const ARCHIVE_KEEP_DAYS = 365;
export const ARCHIVE_MAX = 1500;

export function emptyState() {
  return { tasks: [], lists: [], notes: [], prices: [], archive: [], notified: {}, trash: {}, snoozed: {} };
}

// "Trámites" (categoría vieja) → "trámites" (etiqueta).
export const catToTag = (cat) => String(cat).trim().toLowerCase().replace(/\s+/g, '-');

// Normaliza una tarea, venga de este dispositivo o de otro con una versión
// vieja de la app. No toca `u`: así dos dispositivos llegan a lo mismo.
export function normTask(t, now = Date.now()) {
  const out = { priority: 0, tags: [], subtasks: [], u: now, ...t };
  out.tags = [...(out.tags || [])];
  if ('cat' in out) {
    if (out.cat && out.cat !== 'General') {
      const tag = catToTag(out.cat);
      if (!out.tags.includes(tag)) out.tags.push(tag);
    }
    delete out.cat;
  }
  if (out.done && !out.doneAt) out.doneAt = out.u || now;
  if (!out.done) delete out.doneAt;
  if (out.repeat) {
    const r = cleanRepeat(out.repeat);
    if (r) out.repeat = r; else delete out.repeat;
  }
  return out;
}

// Los ítems llevan `o` (orden) para que reordenar sincronice bien.
export function normList(l, now = Date.now()) {
  return { u: now, ...l, items: (l.items || []).map((i, idx) => ({ u: now, o: idx, ...i })) };
}

export function normalizePayload(p, now = Date.now()) {
  return {
    tasks: (p.tasks || []).map(t => normTask(t, now)),
    lists: (p.lists || []).map(l => normList(l, now)),
    notes: (p.notes || []).map(n => ({ u: now, pinned: false, imgs: [], ...n })),
    prices: (p.prices || []).map(x => ({ u: now, ...x })),
    archive: p.archive || [],
    trash: p.trash || {},
  };
}

export function migrate(s = {}, now = Date.now()) {
  return {
    ...emptyState(),
    ...normalizePayload(s, now),
    notified: s.notified || {},
    snoozed: s.snoozed || {},
  };
}

// --- Archivo ---
export function archEntry(t, now = Date.now()) {
  const e = { id: t.id, title: t.title, tags: t.tags || [], doneAt: t.doneAt || now, u: Math.max(now, (t.u || 0) + 1) };
  if (t.date) e.date = t.date;
  if (t.time) e.time = t.time;
  if (t.priority) e.priority = t.priority;
  return e;
}

// Registro de una repetición completada (la tarea en sí avanzó de fecha).
export function logEntry(t, id, now = Date.now()) {
  return { ...archEntry({ ...t, id, doneAt: now }, now), rec: t.id };
}

export function capArchive(arr = [], now = Date.now()) {
  const keep = now - ARCHIVE_KEEP_DAYS * DAY;
  return arr.filter(a => (a.doneAt || 0) >= keep)
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    .slice(0, ARCHIVE_MAX);
}

// Mueve al archivo las completadas hace más de una semana. Devuelve cuántas.
export function archiveOld(state, now = Date.now()) {
  const cutoff = now - ARCHIVE_AFTER_DAYS * DAY;
  const keep = now - ARCHIVE_KEEP_DAYS * DAY;
  const stay = [];
  let n = 0;
  for (const t of state.tasks) {
    if (t.done && (t.doneAt || 0) < cutoff) {
      if ((t.doneAt || 0) >= keep) state.archive.push(archEntry(t, now));
      else state.trash[t.id] = Math.max(now, t.u || 0);   // demasiado vieja: se va
      n++;
    } else stay.push(t);
  }
  if (n) {
    state.tasks = stay;
    state.archive = capArchive(state.archive, now);
  }
  return n;
}

// Progreso de ESTA semana: lo completado en la semana (incluidas las
// repeticiones) sobre eso + lo pendiente que vence hasta el domingo.
export function weekStats(state, now = new Date()) {
  const { start, end } = weekRange(now);
  const inWeek = (ms) => ms >= +start && ms <= +end;
  let done = 0, pending = 0;
  for (const t of state.tasks) {
    if (t.done) { if (inWeek(t.doneAt || 0)) done++; }
    else { const d = taskDate(t); if (d && d <= end) pending++; }
  }
  for (const a of state.archive || []) if (inWeek(a.doneAt || 0)) done++;
  return { done, total: done + pending };
}
