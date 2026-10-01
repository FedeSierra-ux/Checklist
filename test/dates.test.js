import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYmd, ymd, humanDue, reminderAt, reminderBody } from '../js/core/dates.js';

test('parseYmd es hora local (en AR no corre la fecha al día anterior)', () => {
  // `npm test` corre con TZ=America/Argentina/Buenos_Aires.
  assert.equal(parseYmd('2026-10-01').getDate(), 1);
  assert.equal(ymd(parseYmd('2026-12-31')), '2026-12-31');
});

test('humanDue', () => {
  const now = new Date(2026, 9, 1, 10, 0);
  assert.deepEqual(humanDue({ date: '2026-10-01', time: '18:00' }, now), { label: 'Hoy 18:00', cls: 'today' });
  assert.deepEqual(humanDue({ date: '2026-10-02' }, now), { label: 'Mañana', cls: '' });
  assert.deepEqual(humanDue({ date: '2026-09-30' }, now), { label: 'Vencida · ayer', cls: 'due' });
  assert.deepEqual(humanDue({ date: '2026-09-27' }, now), { label: 'Vencida · hace 4 días', cls: 'due' });
  assert.deepEqual(humanDue({ date: '2026-10-01', time: '09:00' }, now), { label: 'Vencida 09:00', cls: 'due' });
});

test('aviso de una tarea sin hora: a las 9 (no a las 22:59)', () => {
  const at = new Date(reminderAt({ date: '2026-10-05', remind: 60 }));
  assert.equal(at.getHours(), 9);
  assert.equal(at.getDate(), 5);
  const dayBefore = new Date(reminderAt({ date: '2026-10-05', remind: 1440 }));
  assert.equal(dayBefore.getDate(), 4);
});

test('texto de la notificación según cuándo suena (bug "Vence hoy")', () => {
  const t = { date: '2026-10-05', time: '18:00' };
  assert.equal(reminderBody({ ...t, remind: 1440 }), 'Vence mañana a las 18:00');
  assert.equal(reminderBody({ ...t, remind: 30 }), 'Vence en 30 min (18:00)');
  assert.equal(reminderBody({ ...t, remind: 180 }), 'Vence hoy a las 18:00');
  assert.equal(reminderBody({ ...t, remind: 0 }), 'Vence ahora (18:00)');
  assert.equal(reminderBody({ date: '2026-10-05', remind: 1440 }), 'Vence mañana');
  assert.equal(reminderBody({ date: '2026-10-05', remind: 60 }), 'Vence hoy');
});
