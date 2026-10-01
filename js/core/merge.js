/* Conciliación entre dispositivos: merge por ítem con marca de tiempo (`u`)
   y tumbas (`trash`), así dos dispositivos que editaron cosas distintas no
   se pisan y lo borrado en uno no "revive" desde el otro. Puro. */
import { capArchive } from './model.js';

export const TRASH_TTL = 90 * 86400000;     // las tumbas se podan a los 90 días

export const stamp = (o) => Number(o && o.u) || 0;
export const isDead = (o, trash) => trash[o.id] != null && trash[o.id] >= stamp(o);

// Con la misma marca de tiempo gana siempre la misma versión (no la "local"),
// para que dos dispositivos no se pasen la pelota subiendo cada uno la suya.
function newer(a, b) {
  const sa = stamp(a), sb = stamp(b);
  if (sa !== sb) return sa > sb;
  return JSON.stringify(a) > JSON.stringify(b);
}

export function mergeTrash(a = {}, b = {}, now = Date.now()) {
  const out = { ...a };
  for (const [id, ts] of Object.entries(b)) if (!(out[id] >= ts)) out[id] = ts;
  const cutoff = now - TRASH_TTL;
  for (const [id, ts] of Object.entries(out)) if (ts < cutoff) delete out[id];
  return out;
}

// Une dos colecciones por id quedándose con la versión más nueva de cada una.
export function mergeItems(a = [], b = [], trash = {}) {
  const by = new Map();
  for (const it of [...a, ...b]) {
    if (!it || !it.id) continue;
    const prev = by.get(it.id);
    if (!prev || newer(it, prev)) by.set(it.id, { ...it });
  }
  return [...by.values()].filter(it => !isDead(it, trash));
}

export function mergeLists(a = [], b = [], trash = {}) {
  const by = new Map();
  const order = [];
  for (const l of [...a, ...b]) {
    if (!l || !l.id) continue;
    const prev = by.get(l.id);
    if (!prev) { by.set(l.id, { ...l, items: [...(l.items || [])] }); order.push(l.id); continue; }
    const head = (x) => ({ ...x, items: undefined });
    const win = newer(head(l), head(prev)) ? l : prev;
    by.set(l.id, { ...win, items: mergeItems(prev.items, l.items, trash) });
  }
  return order.map(id => by.get(id))
    .filter(l => !isDead(l, trash))
    .map(l => ({ ...l, items: (l.items || []).filter(i => !isDead(i, trash)) }));
}

export function mergeState(local, remote, now = Date.now()) {
  const trash = mergeTrash(local.trash, remote.trash, now);
  const archive = capArchive(mergeItems(local.archive, remote.archive, trash), now);
  // Una tarea archivada en otro dispositivo deja de estar en `tasks`, salvo
  // que se haya reactivado después (su `u` es más nuevo que el archivo).
  const archivedAt = new Map(archive.map(a => [a.id, stamp(a)]));
  const tasks = mergeItems(local.tasks, remote.tasks, trash)
    .filter(t => !(archivedAt.has(t.id) && archivedAt.get(t.id) >= stamp(t)));
  return {
    tasks,
    lists: mergeLists(local.lists, remote.lists, trash),
    notes: mergeItems(local.notes, remote.notes, trash),
    prices: mergeItems(local.prices, remote.prices, trash),
    archive,
    trash,
  };
}

// Serialización estable (ordenada) sólo para comparar si algo cambió.
export function canon(p) {
  const sortById = (arr) => [...(arr || [])].sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return JSON.stringify({
    tasks: sortById(p.tasks).map(t => ({ ...t, subtasks: sortById(t.subtasks) })),
    lists: sortById(p.lists).map(l => ({ ...l, items: sortById(l.items) })),
    notes: sortById(p.notes),
    prices: sortById(p.prices),
    archive: sortById(p.archive),
    trash: Object.fromEntries(Object.entries(p.trash || {}).sort()),
  });
}

export const sizeOf = (p) => JSON.stringify(p).length;

// Si el estado no entra en el documento, se recortan las entradas más viejas
// del archivo (y se entierran, para que otro dispositivo no las devuelva).
export function fitToLimit(p, max, now = Date.now()) {
  let size = sizeOf(p);
  if (size <= max) return { payload: p, trimmed: 0 };
  const arch = [...(p.archive || [])].sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
  const trash = { ...(p.trash || {}) };
  let trimmed = 0;
  while (size > max && arch.length) {
    const drop = arch.splice(0, Math.max(1, Math.ceil(arch.length * 0.1)));
    drop.forEach(a => { trash[a.id] = Math.max(now, stamp(a)); });
    trimmed += drop.length;
    size = sizeOf({ ...p, archive: arch, trash });
  }
  return { payload: { ...p, archive: arch, trash }, trimmed };
}
