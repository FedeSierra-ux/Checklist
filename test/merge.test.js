import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, mergeItems, canon, fitToLimit, sizeOf } from '../js/core/merge.js';

const NOW = Date.UTC(2026, 9, 1, 13);
const empty = () => ({ tasks: [], lists: [], notes: [], prices: [], archive: [], trash: {} });
const st = (o) => ({ ...empty(), ...o });

test('gana la versión más nueva de cada ítem', () => {
  const a = st({ tasks: [{ id: 't1', title: 'viejo', u: 1 }, { id: 't2', title: 'sólo A', u: 5 }] });
  const b = st({ tasks: [{ id: 't1', title: 'nuevo', u: 2 }, { id: 't3', title: 'sólo B', u: 5 }] });
  const m = mergeState(a, b, NOW);
  assert.deepEqual(m.tasks.map(t => t.title).sort(), ['nuevo', 'sólo A', 'sólo B']);
});

test('lo borrado no revive (tumbas)', () => {
  const a = st({ tasks: [], trash: { t1: NOW - 10 } });
  const b = st({ tasks: [{ id: 't1', title: 'x', u: NOW - 50 }] });
  assert.equal(mergeState(a, b, NOW).tasks.length, 0);
  // …salvo que se haya editado después de borrarla
  const c = st({ tasks: [{ id: 't1', title: 'x', u: NOW - 5 }] });
  assert.equal(mergeState(a, c, NOW).tasks.length, 1);
});

test('empates: los dos lados eligen lo mismo (sin ping-pong de escrituras)', () => {
  const x = { id: 'i', text: 'A', u: 7, o: 0 };
  const y = { id: 'i', text: 'A', u: 7, o: 3 };
  const ab = mergeItems([x], [y]);
  const ba = mergeItems([y], [x]);
  assert.deepEqual(ab, ba);
});

test('una tarea archivada en otro dispositivo sale de tasks', () => {
  const local = st({ tasks: [{ id: 't1', title: 'hecha', done: true, u: 100 }] });
  const remote = st({ archive: [{ id: 't1', title: 'hecha', doneAt: NOW - 8 * 864e5, u: 200 }] });
  const m = mergeState(local, remote, NOW);
  assert.equal(m.tasks.length, 0);
  assert.equal(m.archive.length, 1);
});

test('reactivar desde el archivo gana sobre la entrada archivada', () => {
  // Dispositivo A restauró: tumba a la entrada (NOW) y tarea con u = NOW + 1.
  const a = st({ tasks: [{ id: 't1', title: 'hecha', done: false, u: NOW + 1 }], trash: { t1: NOW } });
  const b = st({ archive: [{ id: 't1', title: 'hecha', doneAt: NOW - 8 * 864e5, u: NOW - 864e5 }] });
  const m = mergeState(a, b, NOW);
  assert.equal(m.tasks.length, 1);
  assert.equal(m.archive.length, 0);
});

test('listas: ítems se mezclan por id dentro de cada lista', () => {
  const a = st({ lists: [{ id: 'L', name: 'Súper', u: 1, items: [{ id: 'i1', text: 'pan', u: 1 }] }] });
  const b = st({ lists: [{ id: 'L', name: 'Súper', u: 1, items: [{ id: 'i2', text: 'leche', u: 1 }] }] });
  const m = mergeState(a, b, NOW);
  assert.deepEqual(m.lists[0].items.map(i => i.id).sort(), ['i1', 'i2']);
});

test('canon ignora el orden', () => {
  const a = st({ tasks: [{ id: '1', u: 1 }, { id: '2', u: 1 }] });
  const b = st({ tasks: [{ id: '2', u: 1 }, { id: '1', u: 1 }] });
  assert.equal(canon(a), canon(b));
});

test('fitToLimit recorta lo más viejo del archivo y lo entierra', () => {
  const archive = Array.from({ length: 200 }, (_, i) => ({ id: 'a' + i, title: 'x'.repeat(50), doneAt: NOW - i * 864e5, u: 1 }));
  const p = st({ tasks: [{ id: 't', title: 'importante', u: 1 }], archive });
  const max = sizeOf(p) - 3000;
  const { payload, trimmed } = fitToLimit(p, max, NOW);
  assert.ok(trimmed > 0);
  assert.ok(sizeOf(payload) <= max);
  assert.equal(payload.tasks.length, 1);                       // las tareas no se tocan
  assert.ok(payload.archive.every(a => a.doneAt >= NOW - (200 - trimmed) * 864e5));
  assert.ok(payload.trash['a199']);                            // lo recortado queda enterrado
  assert.equal(fitToLimit(p, sizeOf(p)).trimmed, 0);
});

test('las tumbas de más de 90 días se podan', () => {
  const m = mergeState(st({ trash: { viejo: NOW - 91 * 864e5, nuevo: NOW - 864e5 } }), st(), NOW);
  assert.deepEqual(Object.keys(m.trash), ['nuevo']);
});
