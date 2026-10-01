/* Búsqueda global: tareas, notas, ítems de compras, precios y archivo, con
   lo encontrado resaltado. "#etiqueta" busca sólo por etiqueta. */
import { state } from '../store.js';
import { ui } from './ctx.js';
import { esc, matches } from '../core/text.js';
import { rowHTML, archRowHTML, byPrioDate } from './tasks.js';
import { searchNotesHTML } from './notes.js';
import { searchShopHTML, searchPricesHTML } from './shopping.js';

const sec = (label, n, html) => n
  ? `<div class="sec"><span class="lead">${label}</span><span class="count">${n}</span></div>${html}` : '';

export function renderSearch(c) {
  const raw = ui.query;
  const isTag = raw.startsWith('#');
  const q = raw.replace(/^#/, '').trim();
  if (!q) {
    c.innerHTML = '<div class="empty slim"><p>Buscá en tareas, notas, compras y precios. Con <b>#</b> buscás por etiqueta.</p></div>';
    return;
  }
  const byTag = (t) => (t.tags || []).some(tg => matches(tg, q));
  const hit = (t) => isTag ? byTag(t) : (matches(t.title, q) || byTag(t));
  const tasks = state.tasks.filter(hit).sort(byPrioDate);
  const arch = state.archive.filter(hit).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const none = { n: 0, html: '' };
  const notes = isTag ? none : searchNotesHTML(q);
  const shop = isTag ? none : searchShopHTML(q);
  const prices = isTag ? none : searchPricesHTML(q);

  const html = sec('Tareas', tasks.length, tasks.map(t => rowHTML(t, raw)).join(''))
    + sec('Notas', notes.n, notes.html)
    + sec('Compras', shop.n, shop.html)
    + sec('Precios', prices.n, prices.html)
    + sec('Archivadas', arch.length, arch.slice(0, 40).map(a => archRowHTML(a, raw)).join(''));
  c.innerHTML = html
    || `<div class="empty slim"><b>Sin resultados</b><p>Nada coincide con "${esc(raw)}".</p></div>`;
}
