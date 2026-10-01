import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, hl, richText, noteLines, toggleNoteLine, parseItem, itemKey, noteTitleOf } from '../js/core/text.js';

test('esc', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('hl resalta sin importar tildes ni mayúsculas y escapa', () => {
  assert.equal(hl('Café con <leche>', 'cafe'), '<mark>Café</mark> con &lt;leche&gt;');
  assert.equal(hl('Pan y pan', 'PAN'), '<mark>Pan</mark> y <mark>pan</mark>');
  assert.equal(hl('nada', ''), 'nada');
  assert.equal(hl('comprar papas', 'r p'), 'compra<mark>r p</mark>apas');
});

test('richText convierte links (sin la puntuación final)', () => {
  assert.equal(richText('mirá www.ej.com/a.'),
    'mirá <a href="https://www.ej.com/a" target="_blank" rel="noopener noreferrer">www.ej.com/a</a>.');
  assert.match(richText('https://x.com?q=1&b=2'), /href="https:\/\/x\.com\?q=1&amp;b=2"/);
  assert.equal(richText('<b>no</b>'), '&lt;b&gt;no&lt;/b&gt;');
});

test('checklists en notas', () => {
  const lines = noteLines('Viaje\n- [ ] pasajes\n- [x] hotel\n[ ] seguro\ntexto');
  assert.deepEqual(lines.map(l => [l.check, l.done, l.text]), [
    [false, undefined, 'Viaje'], [true, false, 'pasajes'], [true, true, 'hotel'], [true, false, 'seguro'], [false, undefined, 'texto'],
  ]);
  assert.equal(toggleNoteLine('a\n- [ ] b', 1), 'a\n- [x] b');
  assert.equal(toggleNoteLine('a\n- [x] b', 1), 'a\n- [ ] b');
  assert.equal(toggleNoteLine('a\nb', 1), 'a\nb');
  assert.equal(noteTitleOf('- [ ] leche\npan'), 'leche');
});

test('cantidades en compras', () => {
  assert.deepEqual(parseItem('2 kg papas'), { text: 'papas', qty: '2 kg' });
  assert.deepEqual(parseItem('2kg de papas'), { text: 'papas', qty: '2 kg' });
  assert.deepEqual(parseItem('3 leche'), { text: 'leche', qty: '3' });
  assert.deepEqual(parseItem('leche x2'), { text: 'leche', qty: '2' });
  assert.deepEqual(parseItem('papas 1,5 kg'), { text: 'papas', qty: '1,5 kg' });
  assert.deepEqual(parseItem('1/2 kg queso'), { text: 'queso', qty: '1/2 kg' });
  assert.deepEqual(parseItem('2 lechugas'), { text: 'lechugas', qty: '2' });
  assert.deepEqual(parseItem('Pilas AA'), { text: 'Pilas AA', qty: '' });
});

test('itemKey iguala singular/plural, tildes y mayúsculas', () => {
  assert.equal(itemKey('Tomates'), itemKey('tomate'));
  assert.equal(itemKey('Limones'), itemKey('limón'));
  assert.equal(itemKey('panes'), itemKey('Pan'));
  assert.equal(itemKey('Carne picada'), itemKey('carne  picada'));
  assert.notEqual(itemKey('carne'), itemKey('carne picada'));
});
