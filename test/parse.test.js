import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../js/core/parse.js';

// Jueves 1 de octubre de 2026, 10:00 (hora local).
const NOW = new Date(2026, 9, 1, 10, 0);
const p = (text) => parseQuick(text, NOW);

test('etiquetas, prioridad, mañana y hora', () => {
  const r = p('mañana 15:00 pedir turno #salud !alta');
  assert.equal(r.title, 'pedir turno');
  assert.deepEqual(r.tags, ['salud']);
  assert.equal(r.priority, 3);
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.time, '15:00');
  assert.equal(r.explicitDate, true);
});

test('"pasado" suelto no es una fecha (bug)', () => {
  const r = p('revisar lo pasado');
  assert.equal(r.title, 'revisar lo pasado');
  assert.equal(r.date, null);
});

test('pasado mañana', () => {
  assert.equal(p('pasado mañana llamar').date, '2026-10-03');
});

test('días de la semana', () => {
  assert.equal(p('pagar alquiler el viernes').date, '2026-10-02');
  assert.equal(p('el jueves reunión').date, '2026-10-08');    // hoy es jueves: el que viene
  assert.equal(p('este jueves reunión').date, '2026-10-01');  // "este": hoy
  assert.equal(p('el lunes que viene dentista').date, '2026-10-05');
  assert.equal(p('Hacer TP para el MARTES').title, 'Hacer TP');
  assert.equal(p('comprar pan para el sábado').title, 'comprar pan');
});

test('en N días / semanas', () => {
  assert.equal(p('en 3 días renovar DNI').date, '2026-10-04');
  assert.equal(p('en una semana volver').date, '2026-10-08');
  assert.equal(p('en dos meses revisar').date, '2026-12-01');
});

test('fechas numéricas y con nombre de mes', () => {
  assert.equal(p('vence 15/10 seguro').date, '2026-10-15');
  assert.equal(p('cuota 30/09').date, '2027-09-30');           // ya pasó: año que viene
  assert.equal(p('turno 3/11/2026').date, '2026-11-03');
  assert.equal(p('cumple de Ana el 3 de noviembre').date, '2026-11-03');
  assert.equal(p('turno 12 oct').date, '2026-10-12');
  assert.equal(p('31/02 imposible').date, null);
});

test('una fracción con unidad no es fecha', () => {
  assert.equal(p('comprar 1/2 kg pan').date, null);
  assert.equal(p('1/2 kilo de queso').title, '1/2 kilo de queso');
});

test('horas: a las 5, de la mañana, y media, hs, pm', () => {
  assert.equal(p('llamar a las 5').time, '17:00');
  assert.equal(p('llamar a las 9').time, '09:00');
  assert.equal(p('a las 9 de la mañana gimnasio').time, '09:00');
  assert.equal(p('a las 9 de la mañana gimnasio').title, 'gimnasio');
  assert.equal(p('reunión a las 7 de la tarde').time, '19:00');
  assert.equal(p('a las 5 y media tomar té').time, '17:30');
  assert.equal(p('a las 17hs dentista').time, '17:00');
  assert.equal(p('llamar a mamá a las 5 pm').time, '17:00');
  assert.equal(p('cena 21:30').time, '21:30');
  assert.equal(p('al mediodía almuerzo').time, '12:00');
});

test('hora sin fecha: hoy si no pasó, si no mañana', () => {
  assert.equal(p('llamar a las 5').date, '2026-10-01');
  assert.equal(p('llamar a las 9').date, '2026-10-02');
  assert.equal(p('llamar a las 9').explicitDate, false);
});

test('"mañana a las 9" no confunde la fecha con "de la mañana"', () => {
  const r = p('mañana a las 9 dentista');
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.time, '09:00');
  assert.equal(r.title, 'dentista');
});

test('repeticiones', () => {
  let r = p('tomar pastilla todos los días a las 8');
  assert.deepEqual(r.repeat, { every: 1, unit: 'day' });
  assert.equal(r.date, '2026-10-02');                           // las 8 ya pasaron
  r = p('regar plantas cada 3 días');
  assert.deepEqual(r.repeat, { every: 3, unit: 'day' });
  assert.equal(r.date, '2026-10-01');
  r = p('pagar tarjeta cada mes el 10');
  assert.deepEqual(r.repeat, { every: 1, unit: 'month', md: 10 });
  assert.equal(r.date, '2026-10-10');
  assert.equal(r.title, 'pagar tarjeta');
  r = p('gimnasio todos los lunes y jueves');
  assert.deepEqual(r.repeat, { every: 1, unit: 'week', days: [1, 4] });
  assert.equal(r.date, '2026-10-01');
  r = p('sacar basura cada lunes');
  assert.deepEqual(r.repeat, { every: 1, unit: 'week', days: [1] });
  assert.equal(r.date, '2026-10-05');
  r = p('standup de lunes a viernes a las 9:30');
  assert.deepEqual(r.repeat.days, [1, 2, 3, 4, 5]);
  assert.equal(r.date, '2026-10-02');
  assert.equal(p('backup cada 2 semanas').repeat.every, 2);
  r = p('cumpleaños de mamá cada año el 5 de mayo');
  assert.equal(r.repeat.unit, 'year');
  assert.equal(r.date, '2027-05-05');
  assert.equal(r.title, 'cumpleaños de mamá');
});

test('no se come palabras del título', () => {
  assert.equal(p('Simultánea A').title, 'Simultánea A');
  assert.equal(p('Plan A mañana').title, 'Plan A');
  assert.equal(p('vitamina C a las 9').title, 'vitamina C');
  assert.equal(p('Llamar a Juan para el lunes a las 5').title, 'Llamar a Juan');
  assert.equal(p('ir a la plaza').title, 'ir a la plaza');
});

test('texto sin nada especial queda igual', () => {
  const r = p('Comprar regalo');
  assert.deepEqual(r, { title: 'Comprar regalo', tags: [], priority: null, date: null, time: null, repeat: null, explicitDate: false });
});
