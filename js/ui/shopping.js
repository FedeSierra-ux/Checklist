/* Compras: listas (con cantidad, pasillos, orden y acciones en bloque) y
   Precios en la misma pestaña. Cada ítem de una lista muestra dónde está
   más barato si hay precios cargados para ese producto. */
import { state, save, uid, touch, tomb } from '../store.js';
import { ui, app, $, pref, showOverlay, hideOverlay, ICON_TRASH } from './ctx.js';
import { parseYmd, ymd, shortDate } from '../core/dates.js';
import { esc, hl, parseItem, itemKey, matches } from '../core/text.js';
import { toast } from './toast.js';
import { emptyBox } from './tasks.js';

const money = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const kgFmt = (n) => (+(+n).toFixed(3)).toLocaleString('es-AR') + ' kg';
const perKg = (p) => p.price / p.qty;
const byOrder = (a, b) => (a.o ?? 0) - (b.o ?? 0);
const NO_AISLE = 'Otros';
const ICON_PRICE = '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.8 7 7c0 4.5 10 2.5 10 7 0 2.2-2.2 3.5-5 3.5s-5-1.1-5-3"/></svg>';
const ICON_CART = '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.4 12.6a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6"/></svg>';
const HANDLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

export const pendingItems = () => state.lists.reduce((n, l) => n + l.items.filter(i => !i.done).length, 0);

// Producto → precio por kilo más barato registrado.
function priceIndex() {
  const idx = new Map();
  state.prices.forEach(p => {
    const k = itemKey(p.product);
    const cur = idx.get(k);
    if (!cur || perKg(p) < perKg(cur)) idx.set(k, p);
  });
  return idx;
}

// ---------- Render ----------
function segHTML() {
  const n = pendingItems();
  const tab = (id, label, extra = '') => `<button type="button" role="tab" class="seg-btn${ui.shopTab === id ? ' on' : ''}" data-shoptab="${id}" aria-selected="${ui.shopTab === id}">${label}${extra}</button>`;
  return `<div class="seg" role="tablist" aria-label="Compras">${tab('listas', 'Listas', n ? ` <span class="cnt">${n}</span>` : '')}${tab('precios', 'Precios')}</div>`;
}

export function renderCompras(c) {
  c.innerHTML = segHTML() + (ui.shopTab === 'precios' ? preciosHTML() : listasHTML());
}

function itemHTML(list, it, idx, q = '', draggable = true) {
  const k = itemKey(it.text);
  const best = idx.get(k);
  const hint = best
    ? `<button type="button" class="price-hint" data-act="goto-price" data-key="${esc(k)}">Más barato en ${esc(best.place)} · ${money(perKg(best))}/kg</button>` : '';
  return `<div class="shop-item ${it.done ? 'done' : ''}" data-list="${list.id}" data-item="${it.id}">
      ${draggable ? `<span class="drag-h" title="Arrastrar para ordenar" aria-hidden="true">${HANDLE}</span>` : ''}
      <button type="button" class="sck ${it.done ? 'done' : ''}" data-act="shop-toggle" aria-label="${it.done ? 'Destildar' : 'Tildar'} ${esc(it.text)}"></button>
      <div class="shop-body">
        <div class="shop-main" data-act="item-edit" role="button" tabindex="0" aria-label="Editar ${esc(it.text)}">${it.qty ? `<b class="qty">${esc(it.qty)}</b>` : ''}<span class="shop-tx">${hl(it.text, q)}</span></div>
        ${hint}
      </div>
      <button type="button" class="rm" data-act="shop-del" aria-label="Quitar ${esc(it.text)}">&times;</button>
    </div>`;
}

function listasHTML() {
  if (!state.lists.length) return emptyBox('Sin listas', 'Creá tu primera lista de compras con el botón +.', ICON_CART);
  const idx = priceIndex();
  return state.lists.map(list => {
    const items = [...list.items].sort(byOrder);
    const done = items.filter(i => i.done).length;
    let body;
    if (items.some(i => i.aisle)) {
      // Agrupado por pasillo (alfabético; lo que no tiene pasillo, al final).
      const groups = new Map();
      items.forEach(it => {
        const k = (it.aisle || '').trim() || NO_AISLE;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      });
      const keys = [...groups.keys()].sort((a, b) => (a === NO_AISLE) - (b === NO_AISLE) || a.localeCompare(b, 'es'));
      body = keys.map(k => `<div class="aisle"><div class="aisle-h">${esc(k)}</div>${groups.get(k).map(it => itemHTML(list, it, idx)).join('')}</div>`).join('');
    } else {
      body = `<div class="aisle">${items.map(it => itemHTML(list, it, idx)).join('')}</div>`;
    }
    const bulk = done
      ? `<div class="shop-bulk"><button type="button" data-act="shop-uncheck">Destildar todo</button><button type="button" data-act="shop-clear">Borrar tildados (${done})</button></div>` : '';
    return `<div class="shop-list" data-list="${list.id}">
        <div class="shop-head"><h3>${esc(list.name)}</h3><span class="badge">${done}/${items.length}</span>
          <button type="button" class="del-list" data-act="list-del" aria-label="Eliminar lista ${esc(list.name)}">${ICON_TRASH}</button></div>
        ${body}${bulk}
        <form class="shop-add" data-list="${list.id}"><input type="text" placeholder="Agregar… (ej: 2 kg papas)" autocomplete="off" aria-label="Nuevo ítem en ${esc(list.name)}"><button type="submit" aria-label="Agregar">+</button></form>
      </div>`;
  }).join('');
}

function priceRowHTML(p, best, q = '') {
  const d = parseYmd(p.date);          // local, no UTC: si no, en AR sale un día antes
  return `<div class="price${best ? ' best' : ''}" data-price="${p.id}" data-act="price-edit" role="button" tabindex="0">
      <div class="price-main">
        <div class="price-place">${hl(p.place, q)}${best ? '<span class="price-badge">Más barato</span>' : ''}</div>
        <div class="price-sub">${kgFmt(p.qty)} · ${money(p.price)} · ${shortDate(d)}</div>
      </div>
      <div class="price-kg"><b>${money(perKg(p))}</b><small>por kg</small></div>
    </div>`;
}

function priceGroups(filter = () => true) {
  const groups = new Map();
  state.prices.forEach(p => {
    const k = itemKey(p.product);
    if (!groups.has(k)) groups.set(k, { key: k, name: p.product, items: [] });
    groups.get(k).items.push(p);
  });
  return [...groups.values()]
    .filter(g => g.items.some(filter) || filter({ product: g.name, place: '' }))
    .map(g => ({ ...g, items: g.items.sort((a, b) => perKg(a) - perKg(b) || b.date.localeCompare(a.date)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function priceGroupHTML(g, q = '') {
  const min = perKg(g.items[0]);
  const multi = g.items.length > 1;
  const max = perKg(g.items[g.items.length - 1]);
  const ahorro = multi && max > min ? `<span class="badge">Ahorrás ${money(max - min)}/kg</span>` : '';
  return `<div class="price-group" data-pkey="${esc(g.key)}">
      <div class="shop-head"><h3>${hl(g.name, q)}</h3>${ahorro}</div>
      ${g.items.map(p => priceRowHTML(p, multi && perKg(p) === min, q)).join('')}
    </div>`;
}

function preciosHTML() {
  const groups = priceGroups();
  if (!groups.length) {
    return emptyBox('Sin precios', 'Cargá lo que pagaste (producto, kilos, lugar y precio) con el +. Si el producto está en una lista, ahí vas a ver dónde conviene.', ICON_PRICE);
  }
  return groups.map(g => priceGroupHTML(g)).join('');
}

// ---------- Búsqueda ----------
export function searchShopHTML(q) {
  const idx = priceIndex();
  const rows = [];
  state.lists.forEach(list => [...list.items].sort(byOrder).forEach(it => {
    if (matches(it.text, q) || matches(it.aisle || '', q)) rows.push({ list, it });
  }));
  if (!rows.length) return { n: 0, html: '' };
  return {
    n: rows.length,
    html: `<div class="shop-list search">${rows.map(({ list, it }) =>
      `<div class="shop-from">${esc(list.name)}</div>${itemHTML(list, it, idx, q, false)}`).join('')}</div>`,
  };
}
export function searchPricesHTML(q) {
  const groups = priceGroups(p => matches(p.product, q) || matches(p.place, q));
  return { n: groups.length, html: groups.map(g => priceGroupHTML(g, q)).join('') };
}

// ---------- Acciones de listas ----------
const findList = (id) => state.lists.find(l => l.id === id);

function rememberedAisle(text) {
  const k = itemKey(text);
  let best = null;
  state.lists.forEach(l => l.items.forEach(i => {
    if (i.aisle && itemKey(i.text) === k && (!best || (i.u || 0) > (best.u || 0))) best = i;
  }));
  return best ? best.aisle : '';
}

function addItem(listId, raw) {
  const list = findList(listId);
  const { text, qty } = parseItem(raw);
  if (!list || !text) return;
  const aisle = rememberedAisle(text);          // el pasillo se recuerda por producto
  const o = list.items.reduce((m, i) => Math.max(m, i.o ?? 0), -1) + 1;
  list.items.push({ id: uid(), text, ...(qty ? { qty } : {}), ...(aisle ? { aisle } : {}), done: false, o, u: Date.now() });
  save(); app.render();
  const inp = document.querySelector(`.shop-add[data-list="${listId}"] input`);
  if (inp) inp.focus();
}

function toggleItem(listId, itemId) {
  const it = findList(listId)?.items.find(i => i.id === itemId);
  if (!it) return;
  it.done = !it.done; touch(it);
  save(); app.render();
}

function delItem(listId, itemId) {
  const list = findList(listId);
  const idx = list ? list.items.findIndex(i => i.id === itemId) : -1;
  if (idx < 0) return;
  const it = list.items[idx];
  list.items.splice(idx, 1); tomb(itemId);
  save(); app.render();
  toast(`"${it.text}" quitado`, {
    undo: () => {
      const l = findList(listId);
      if (!l) return;
      delete state.trash[itemId];
      l.items.push({ ...it, u: Date.now() + 1 });
      save(); app.render();
    },
  });
}

function delList(id) {
  const idx = state.lists.findIndex(l => l.id === id);
  if (idx < 0) return;
  const list = state.lists[idx];
  state.lists.splice(idx, 1); tomb(id);
  save(); app.render();
  toast(`Lista "${list.name}" eliminada`, {
    undo: () => {
      delete state.trash[id];
      state.lists.splice(Math.min(idx, state.lists.length), 0, { ...list, u: Date.now() + 1 });
      save(); app.render();
    },
  });
}

// Para reusar la lista del súper cada semana.
function uncheckAll(listId) {
  const list = findList(listId);
  if (!list) return;
  const was = list.items.filter(i => i.done).map(i => i.id);
  list.items.forEach(i => { if (i.done) { i.done = false; touch(i); } });
  save(); app.render();
  toast('Lista destildada', {
    undo: () => {
      (findList(listId)?.items || []).forEach(i => { if (was.includes(i.id)) { i.done = true; touch(i); } });
      save(); app.render();
    },
  });
}

function clearChecked(listId) {
  const list = findList(listId);
  if (!list) return;
  const gone = list.items.filter(i => i.done);
  if (!gone.length) return;
  list.items = list.items.filter(i => !i.done);
  gone.forEach(i => tomb(i.id));
  save(); app.render();
  toast(`${gone.length} ${gone.length === 1 ? 'ítem borrado' : 'ítems borrados'}`, {
    undo: () => {
      const l = findList(listId);
      if (!l) return;
      const now = Date.now() + 1;
      gone.forEach(i => { delete state.trash[i.id]; l.items.push({ ...i, u: now }); });
      save(); app.render();
    },
  });
}

// ---------- Hoja: nueva lista ----------
export function openListSheet() {
  $('#lName').value = '';
  showOverlay($('#listOverlay'));
  setTimeout(() => $('#lName').focus(), 250);
}

// ---------- Hoja: editar ítem ----------
let editingItem = null;            // { listId, itemId }
function openItem(listId, itemId) {
  const it = findList(listId)?.items.find(i => i.id === itemId);
  if (!it) return;
  editingItem = { listId, itemId };
  $('#iText').value = it.text;
  $('#iQty').value = it.qty || '';
  $('#iAisle').value = it.aisle || '';
  const aisles = [...new Set(state.lists.flatMap(l => l.items.map(i => (i.aisle || '').trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#aisleList').innerHTML = aisles.map(a => `<option value="${esc(a)}">`).join('');
  const best = priceIndex().get(itemKey(it.text));
  $('#iHint').textContent = best ? `Más barato en ${best.place}: ${money(perKg(best))}/kg` : '';
  showOverlay($('#itemOverlay'));
}
function closeItem() { hideOverlay($('#itemOverlay')); editingItem = null; }

// ---------- Precios ----------
let editingPrice = null;
function fillDatalists() {
  const uniq = (f) => [...new Set(state.prices.map(f))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#pProductList').innerHTML = uniq(p => p.product).map(v => `<option value="${esc(v)}">`).join('');
  $('#pPlaceList').innerHTML = uniq(p => p.place).map(v => `<option value="${esc(v)}">`).join('');
}
function updatePriceHint() {
  const q = parseFloat($('#pQty').value), pr = parseFloat($('#pPrice').value);
  $('#pHint').textContent = (q > 0 && pr >= 0) ? `Sale ${money(pr / q)} por kg` : '';
}
export function openPrice(id = null, product = '') {
  editingPrice = id;
  const p = id ? state.prices.find(x => x.id === id) : null;
  $('#priceTitle').textContent = p ? 'Editar precio' : 'Nuevo precio';
  $('#pProduct').value = p ? p.product : product;
  $('#pPlace').value = p ? p.place : '';
  $('#pQty').value = p ? p.qty : '';
  $('#pPrice').value = p ? p.price : '';
  $('#priceDelete').hidden = !p;
  fillDatalists(); updatePriceHint();
  showOverlay($('#priceOverlay'));
  setTimeout(() => $(product ? '#pPlace' : '#pProduct').focus(), 250);
}
function closePrice() { hideOverlay($('#priceOverlay')); editingPrice = null; }
function delPrice(id) {
  const idx = state.prices.findIndex(x => x.id === id);
  if (idx < 0) return;
  const p = state.prices[idx];
  state.prices.splice(idx, 1); tomb(id);
  closePrice(); save(); app.render();
  toast(`Precio de ${p.product} eliminado`, {
    undo: () => { delete state.trash[id]; state.prices.push({ ...p, u: Date.now() + 1 }); save(); app.render(); },
  });
}

function gotoPrice(key) {
  ui.shopTab = 'precios'; pref('tudu.shopTab', 'precios');
  app.render();
  const el = document.querySelector(`.price-group[data-pkey="${CSS.escape(key)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }
}

// FAB en Compras: lista nueva o precio nuevo según la solapa.
export function shopFab() {
  if (ui.shopTab === 'precios') openPrice(); else openListSheet();
}

// ---------- Eventos ----------
export function handleShopClick(e) {
  const tab = e.target.closest('[data-shoptab]');
  if (tab) { ui.shopTab = tab.dataset.shoptab; pref('tudu.shopTab', ui.shopTab); app.render(); return true; }
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return false;
  const act = actEl.dataset.act;
  if (act === 'price-edit') { openPrice(actEl.closest('[data-price]').dataset.price); return true; }
  if (act === 'goto-price') { gotoPrice(actEl.dataset.key); return true; }
  const listEl = actEl.closest('[data-list]');
  if (!listEl) return false;
  const listId = listEl.dataset.list;
  const itemEl = actEl.closest('.shop-item');
  if (act === 'shop-toggle') toggleItem(listId, itemEl.dataset.item);
  else if (act === 'shop-del') delItem(listId, itemEl.dataset.item);
  else if (act === 'item-edit') openItem(listId, itemEl.dataset.item);
  else if (act === 'list-del') delList(listId);
  else if (act === 'shop-uncheck') uncheckAll(listId);
  else if (act === 'shop-clear') clearChecked(listId);
  else return false;
  return true;
}

export function handleShopSubmit(e) {
  const form = e.target.closest('.shop-add');
  if (!form) return false;
  e.preventDefault();
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (text) addItem(form.dataset.list, text);
  return true;
}

// Reordenar arrastrando la manija (dentro del mismo pasillo).
function initReorder(content) {
  let drag = null;
  const isItem = (n) => n && n.classList && n.classList.contains('shop-item');
  content.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.drag-h');
    if (!h) return;
    const el = h.closest('.shop-item');
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drag = { el, group: el.parentElement, y: e.clientY };
    el.classList.add('reordering');
  });
  content.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const { el, group } = drag;
    const mid = () => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    el.style.transform = `translateY(${e.clientY - drag.y}px)`;
    const next = isItem(el.nextElementSibling) ? el.nextElementSibling : null;
    const prev = isItem(el.previousElementSibling) ? el.previousElementSibling : null;
    if (next) {
      const r = next.getBoundingClientRect();
      if (mid() > r.top + r.height / 2) { group.insertBefore(next, el); drag.y += r.height; }
    }
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (mid() < r.top + r.height / 2) { group.insertBefore(el, prev); drag.y -= r.height; }
    }
    el.style.transform = `translateY(${e.clientY - drag.y}px)`;
  });
  const end = () => {
    if (!drag) return;
    const { el, group } = drag;
    drag = null;
    el.classList.remove('reordering');
    el.style.transform = '';
    const list = findList(el.dataset.list);
    if (!list) return;
    const ids = [...group.querySelectorAll('.shop-item')].map(x => x.dataset.item);
    const byId = new Map(list.items.map(it => [it.id, it]));
    const i = ids.indexOf(el.dataset.item);
    const it = byId.get(el.dataset.item), before = byId.get(ids[i - 1]), after = byId.get(ids[i + 1]);
    let o = it.o;
    if (before && after) o = ((before.o ?? 0) + (after.o ?? 0)) / 2;
    else if (before) o = (before.o ?? 0) + 1;
    else if (after) o = (after.o ?? 0) - 1;
    if (o !== it.o) { it.o = o; touch(it); save(); }
    app.render();
  };
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', end);
}

export function initShopping(content) {
  initReorder(content);

  const listOv = $('#listOverlay');
  $('#listCancel').addEventListener('click', () => hideOverlay(listOv));
  listOv.addEventListener('click', (e) => { if (e.target === listOv) hideOverlay(listOv); });
  $('#listForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#lName').value.trim();
    if (!name) return;
    state.lists.unshift({ id: uid(), name, items: [], u: Date.now() });
    ui.shopTab = 'listas';
    hideOverlay(listOv); save(); app.render(); toast('Lista creada');
    const inp = document.querySelector('.shop-add input');
    if (inp) inp.focus();
  });

  const itemOv = $('#itemOverlay');
  $('#itemCancel').addEventListener('click', closeItem);
  itemOv.addEventListener('click', (e) => { if (e.target === itemOv) closeItem(); });
  $('#itemDelete').addEventListener('click', () => {
    if (!editingItem) return;
    const { listId, itemId } = editingItem;
    closeItem(); delItem(listId, itemId);
  });
  $('#itemForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingItem) return;
    const it = findList(editingItem.listId)?.items.find(i => i.id === editingItem.itemId);
    const text = $('#iText').value.trim();
    if (it && text) {
      it.text = text;
      const qty = $('#iQty').value.trim(), aisle = $('#iAisle').value.trim();
      if (qty) it.qty = qty; else delete it.qty;
      if (aisle) it.aisle = aisle; else delete it.aisle;
      touch(it); save(); app.render();
    }
    closeItem();
  });

  const priceOv = $('#priceOverlay');
  $('#priceCancel').addEventListener('click', closePrice);
  priceOv.addEventListener('click', (e) => { if (e.target === priceOv) closePrice(); });
  $('#priceDelete').addEventListener('click', () => { if (editingPrice) delPrice(editingPrice); });
  $('#pQty').addEventListener('input', updatePriceHint);
  $('#pPrice').addEventListener('input', updatePriceHint);
  $('#priceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const product = $('#pProduct').value.trim(), place = $('#pPlace').value.trim();
    const qty = parseFloat($('#pQty').value), price = parseFloat($('#pPrice').value);
    if (!product || !place || !(qty > 0) || !(price >= 0)) { toast('Revisá los datos'); return; }
    // Si ya existe el producto (con otra mayúscula, tilde o en plural), se reusa su nombre.
    const prev = state.prices.find(x => itemKey(x.product) === itemKey(product));
    const data = { product: prev ? prev.product : product, place, qty, price };
    if (editingPrice) { const p = state.prices.find(x => x.id === editingPrice); Object.assign(p, data); touch(p); }
    else state.prices.push({ id: uid(), date: ymd(new Date()), u: Date.now(), ...data });
    closePrice(); save(); app.render();
  });
}
