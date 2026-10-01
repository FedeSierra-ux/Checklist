import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// El service worker precachea la app completa para que ande offline y para
// actualizarla de una (sin mezclar módulos viejos y nuevos). Si se agrega un
// archivo a js/ y no se lo suma a CORE, la app offline se rompe.
const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const core = [...sw.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('todos los módulos de js/ están en el precache', () => {
  const js = walk(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => './' + relative(root, f));
  const missing = js.filter(f => !core.includes(f));
  assert.deepEqual(missing, []);
});

test('el precache incluye la tipografía y el HTML', () => {
  for (const f of ['./index.html', './css/styles.css', './assets/fonts/manrope.woff2']) assert.ok(core.includes(f), f);
});

test('todo lo precacheado existe', () => {
  for (const f of core) {
    if (f === './') continue;
    assert.ok(statSync(join(root, f)).isFile(), f);
  }
});
