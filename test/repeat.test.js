import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDate, advancePast, firstOnOrAfter, describeRepeat, cleanRepeat } from '../js/core/repeat.js';

test('diaria y cada N días', () => {
  assert.equal(nextDate({ every: 1, unit: 'day' }, '2026-10-01'), '2026-10-02');
  assert.equal(nextDate({ every: 3, unit: 'day' }, '2026-10-30'), '2026-11-02');
});

test('semanal con días elegidos', () => {
  const lj = { every: 1, unit: 'week', days: [1, 4] };          // lunes y jueves
  assert.equal(nextDate(lj, '2026-10-05'), '2026-10-08');        // lun → jue
  assert.equal(nextDate(lj, '2026-10-08'), '2026-10-12');        // jue → lun
  assert.equal(nextDate({ every: 2, unit: 'week', days: [1] }, '2026-10-05'), '2026-10-19');
  assert.equal(nextDate({ every: 1, unit: 'week' }, '2026-10-01'), '2026-10-08');
  // domingo es el último día de la semana
  assert.equal(nextDate({ every: 1, unit: 'week', days: [0, 6] }, '2026-10-03'), '2026-10-04');
});

test('mensual anclada al día del mes (no se corre en meses cortos)', () => {
  const m31 = { every: 1, unit: 'month', md: 31 };
  assert.equal(nextDate(m31, '2026-01-31'), '2026-02-28');
  assert.equal(nextDate(m31, '2026-02-28'), '2026-03-31');
  assert.equal(nextDate({ every: 3, unit: 'month', md: 10 }, '2026-10-10'), '2027-01-10');
});

test('anual', () => {
  assert.equal(nextDate({ every: 1, unit: 'year' }, '2026-05-05'), '2027-05-05');
  assert.equal(nextDate({ every: 1, unit: 'year' }, '2028-02-29'), '2029-02-28');
});

test('advancePast: una diaria atrasada no deja varias vencidas', () => {
  assert.equal(advancePast({ every: 1, unit: 'day' }, '2026-09-28', '2026-10-01'), '2026-10-02');
  assert.equal(advancePast({ every: 1, unit: 'day' }, '2026-10-05', '2026-10-01'), '2026-10-06');
  assert.equal(advancePast({ every: 1, unit: 'week', days: [1] }, '2026-09-28', '2026-10-01'), '2026-10-05');
});

test('firstOnOrAfter ancla una regla nueva', () => {
  assert.equal(firstOnOrAfter({ every: 1, unit: 'week', days: [1] }, '2026-10-01'), '2026-10-05');
  assert.equal(firstOnOrAfter({ every: 1, unit: 'week', days: [4] }, '2026-10-01'), '2026-10-01');
  assert.equal(firstOnOrAfter({ every: 1, unit: 'month', md: 10 }, '2026-10-11'), '2026-11-10');
  assert.equal(firstOnOrAfter({ every: 1, unit: 'day' }, '2026-10-11'), '2026-10-11');
});

test('describeRepeat', () => {
  assert.equal(describeRepeat({ every: 1, unit: 'day' }), 'cada día');
  assert.equal(describeRepeat({ every: 3, unit: 'day' }), 'cada 3 días');
  assert.equal(describeRepeat({ every: 1, unit: 'week', days: [1, 4] }), 'cada lunes y jueves');
  assert.equal(describeRepeat({ every: 1, unit: 'week', days: [1, 2, 3, 4, 5] }), 'de lunes a viernes');
  assert.equal(describeRepeat({ every: 1, unit: 'month', md: 10 }), 'cada mes el 10');
  assert.equal(describeRepeat({ every: 2, unit: 'year' }), 'cada 2 años');
});

test('cleanRepeat descarta basura y ordena días de lunes a domingo', () => {
  assert.equal(cleanRepeat({ unit: 'hour' }), null);
  assert.deepEqual(cleanRepeat({ unit: 'week', every: '2', days: [0, 1, 1, 9] }), { every: 2, unit: 'week', days: [1, 0] });
  assert.deepEqual(cleanRepeat({ unit: 'month', every: 0, md: 40 }), { every: 1, unit: 'month', md: 31 });
});
