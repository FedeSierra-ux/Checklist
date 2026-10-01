import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, normTask, archiveOld, weekStats, capArchive, ARCHIVE_MAX } from '../js/core/model.js';

const DAY = 864e5;

test('la categoría vieja pasa a ser etiqueta', () => {
  const t = normTask({ id: '1', title: 'x', cat: 'Trámites', tags: ['urgente'], u: 1 });
  assert.deepEqual(t.tags, ['urgente', 'trámites']);
  assert.ok(!('cat' in t));
  const g = normTask({ id: '2', title: 'y', cat: 'General', u: 1 });
  assert.deepEqual(g.tags, []);
  assert.equal(g.u, 1);                                        // no toca la marca de tiempo
});

test('migrate completa campos y ordena ítems', () => {
  const s = migrate({ tasks: [{ id: 't', title: 'x', done: true, u: 5 }], lists: [{ id: 'L', name: 'S', items: [{ id: 'a' }, { id: 'b' }] }] }, 100);
  assert.equal(s.tasks[0].doneAt, 5);
  assert.deepEqual(s.lists[0].items.map(i => i.o), [0, 1]);
  assert.deepEqual(s.archive, []);
  assert.deepEqual(s.snoozed, {});
});

test('archiveOld mueve las completadas hace más de 7 días', () => {
  const now = Date.UTC(2026, 9, 1);
  const s = migrate({ tasks: [
    { id: 'viejo', title: 'a', done: true, doneAt: now - 8 * DAY, u: now - 8 * DAY, tags: ['x'], subtasks: [{ id: 's' }] },
    { id: 'nuevo', title: 'b', done: true, doneAt: now - 2 * DAY, u: now },
    { id: 'pend', title: 'c', done: false, u: now },
    { id: 'antiguo', title: 'd', done: true, doneAt: now - 400 * DAY, u: 1 },
  ] }, now);
  assert.equal(archiveOld(s, now), 2);
  assert.deepEqual(s.tasks.map(t => t.id), ['nuevo', 'pend']);
  assert.equal(s.archive.length, 1);
  assert.equal(s.archive[0].id, 'viejo');
  assert.ok(!('subtasks' in s.archive[0]));                    // compacto
  assert.ok(s.archive[0].u > s.archive[0].doneAt);
  assert.ok(s.trash.antiguo);                                  // más de un año: se descarta
});

test('capArchive limita cantidad y antigüedad', () => {
  const now = Date.UTC(2026, 9, 1);
  const arr = Array.from({ length: ARCHIVE_MAX + 50 }, (_, i) => ({ id: String(i), doneAt: now - i * 60000 }));
  arr.push({ id: 'old', doneAt: now - 400 * DAY });
  const out = capArchive(arr, now);
  assert.equal(out.length, ARCHIVE_MAX);
  assert.ok(!out.some(a => a.id === 'old'));
});

test('weekStats cuenta sólo esta semana (no toda la historia)', () => {
  const now = new Date(2026, 9, 1, 12);                        // jueves
  const ms = (y, m, d) => new Date(y, m, d, 12).getTime();
  const s = migrate({ tasks: [
    { id: 'a', title: 'hecha hoy', done: true, doneAt: now.getTime(), u: 1 },
    { id: 'b', title: 'hecha semana pasada', done: true, doneAt: ms(2026, 8, 24), u: 1 },
    { id: 'c', title: 'pendiente viernes', date: '2026-10-02', u: 1 },
    { id: 'd', title: 'pendiente vencida', date: '2026-09-20', u: 1 },
    { id: 'e', title: 'pendiente mes que viene', date: '2026-11-02', u: 1 },
    { id: 'f', title: 'sin fecha', u: 1 },
  ], archive: [{ id: 'r', title: 'repetición', doneAt: ms(2026, 8, 29), u: 1, rec: 'x' }] });
  assert.deepEqual(weekStats(s, now), { done: 2, total: 4 });
});
