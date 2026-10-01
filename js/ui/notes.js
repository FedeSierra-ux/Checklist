/* Notas: texto libre (la primera línea es el título), casillas "- [ ] algo"
   que se tildan desde la tarjeta, links que se pueden tocar, imágenes y
   "Convertir en tarea". */
import { state, save, uid, touch, tomb } from '../store.js';
import { app, $, showOverlay, hideOverlay, ICON_TRASH } from './ctx.js';
import { agoLabel } from '../core/dates.js';
import { esc, hl, richText, noteLines, toggleNoteLine, isCheckLine, checkText, matches } from '../core/text.js';
import { toast } from './toast.js';
import { Sync } from '../sync.js';
import { openSheet } from './task-sheet.js';

const MAX_LINES = 6;
const byNote = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.u || 0) - (a.u || 0);

// Título y renglones del cuerpo. Si la nota arranca con una casilla, es una
// lista: se titula "Lista" y la primera casilla queda en el cuerpo.
export function noteParts(n) {
  const all = noteLines(n.text);
  const firstIsCheck = !!(all[0] && all[0].check);
  const title = firstIsCheck ? 'Lista' : ((all[0] && all[0].text.trim()) || 'Nota sin título');
  const body = (firstIsCheck ? all : all.slice(1)).filter(l => l.check || l.text.trim());
  return { title, body, checks: all.filter(l => l.check) };
}

// Las imágenes nuevas viven en Firestore: se pintan con data-img y sync.js
// completa el src. Las viejas (con url http) se muestran tal cual.
function imgAttrs(im) {
  if (im.url) return `src="${esc(im.url)}"`;
  const src = Sync.imageSrc(im) || '';
  return `${src ? `src="${esc(src)}" data-loaded="1" ` : ''}data-img="${esc(im.path)}"`;
}

export function noteCardHTML(n, q = '') {
  const { title, body, checks } = noteParts(n);
  const shown = body.slice(0, MAX_LINES);
  const lines = shown.map(l => l.check
    ? `<div class="ncheck${l.done ? ' done' : ''}"><button type="button" class="nbox" data-act="note-check" data-line="${l.i}" aria-pressed="${l.done}" aria-label="${l.done ? 'Destildar' : 'Tildar'}"></button><span class="ntx">${richText(l.text, q)}</span></div>`
    : `<p class="nline">${richText(l.text, q)}</p>`).join('');
  const more = body.length > MAX_LINES ? `<span class="nmore">+${body.length - MAX_LINES} más</span>` : '';
  const imgs = n.imgs || [];
  const tira = imgs.length
    ? `<div class="note-imgs${imgs.length === 1 ? ' solo' : ''}">${imgs.slice(0, 4).map((im, i) =>
        `<img ${imgAttrs(im)} alt="" loading="lazy" data-act="note-zoom" data-i="${i}">`).join('')}
       ${imgs.length > 4 ? `<span class="note-more">+${imgs.length - 4}</span>` : ''}</div>`
    : '';
  const done = checks.filter(l => l.done).length;
  return `<div class="note${n.pinned ? ' pinned' : ''}" data-note="${n.id}">
      <div class="note-main">
        <div class="note-t" data-act="note-edit" role="button" tabindex="0">${hl(title, q)}</div>
        ${lines ? `<div class="note-b" data-act="note-edit">${lines}${more}</div>` : ''}
        ${tira}
        <span class="note-when" data-act="note-edit">${checks.length ? `☑ ${done}/${checks.length} · ` : ''}${agoLabel(n.u)}</span>
      </div>
      <div class="note-acts">
        <button type="button" class="note-pin ${n.pinned ? 'on' : ''}" data-act="note-pin" aria-label="${n.pinned ? 'Desfijar' : 'Fijar'}" title="${n.pinned ? 'Desfijar' : 'Fijar arriba'}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="${n.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/></svg>
        </button>
        <button type="button" class="note-del" data-act="note-del" aria-label="Eliminar nota">${ICON_TRASH}</button>
      </div>
    </div>`;
}

export function renderNotas(c) {
  if (!state.notes.length) {
    c.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>
      <b>Sin notas</b><p>Un lugar libre para ideas, links o listas. Tocá el + para escribir.</p></div>`;
    return;
  }
  c.innerHTML = `<div class="notes">${[...state.notes].sort(byNote).map(n => noteCardHTML(n)).join('')}</div>`;
}

export function searchNotesHTML(q) {
  const res = state.notes.filter(n => matches(n.text, q)).sort(byNote);
  return { n: res.length, html: res.length ? `<div class="notes">${res.map(n => noteCardHTML(n, q)).join('')}</div>` : '' };
}

// --- Imágenes de las notas ---
// Se achican antes de subir: una foto de 12 MP pasa de ~4 MB a ~300 KB, y a
// 1600px se sigue viendo bien en cualquier pantalla.
const IMG_MAX = 1600, IMG_QUALITY = 0.8;

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, IMG_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', IMG_QUALITY));
  // Si comprimir no ayudó (imágenes ya chicas), se sube la original.
  return (blob && blob.size < file.size) ? blob : file;
}

// --- Editor de notas (hoja aparte: una sola caja de texto) ---
let editingNote = null;
let draftImgs = [];       // imágenes de la nota que se está editando
let imgsSubidas = [];     // subidas en ESTA sesión de edición (para limpiar si cancela)

function renderDraftImgs() {
  const box = $('#noteImgs');
  box.classList.toggle('solo', draftImgs.length === 1);
  box.innerHTML = draftImgs.map((im, i) =>
    `<div class="thumb"><img ${imgAttrs(im)} alt="" loading="lazy">
       <button type="button" data-i="${i}" aria-label="Quitar imagen">&times;</button></div>`).join('');
  box.hidden = !draftImgs.length;
}

export function openNote(id = null) {
  editingNote = id;
  const n = id ? state.notes.find(x => x.id === id) : null;
  $('#noteTitle').textContent = n ? 'Editar nota' : 'Nueva nota';
  $('#noteText').value = n ? n.text : '';
  $('#noteDelete').hidden = !id;
  draftImgs = n ? (n.imgs || []).map(im => ({ ...im })) : [];
  imgsSubidas = [];
  renderDraftImgs();
  // Adjuntar necesita la sincronización (las imágenes viven en Firestore).
  const conSync = Sync.isOn();
  $('#noteAddImg').disabled = !conSync;
  $('#noteImgHint').textContent = conSync ? '' : 'Activá la sincronización (☁) para adjuntar imágenes.';
  showOverlay($('#noteOverlay'));
  setTimeout(() => $('#noteText').focus(), 250);
}

function closeNote(descartando = false) {
  hideOverlay($('#noteOverlay'));
  // Al cancelar, lo que se subió recién no queda ocupando lugar.
  if (descartando && imgsSubidas.length) imgsSubidas.forEach(p => Sync.deleteImage(p));
  editingNote = null; draftImgs = []; imgsSubidas = [];
}

async function pickImages(files) {
  if (!files || !files.length) return;
  const btn = $('#noteAddImg');
  const hint = $('#noteImgHint');
  btn.disabled = true;
  let n = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    n++;
    hint.textContent = `Subiendo ${n} de ${files.length}…`;
    try {
      const blob = await compressImage(file);
      const up = await Sync.uploadImage(blob);
      draftImgs.push({ id: uid(), path: up.path, url: up.url });
      imgsSubidas.push(up.path);
      renderDraftImgs();
    } catch (e) {
      hint.textContent = '⚠ ' + e.message;
      btn.disabled = false;
      return;
    }
  }
  hint.textContent = '';
  btn.disabled = false;
}

// Guarda lo que está en el editor. Devuelve el id de la nota (o null si
// quedó vacía y se borró).
function commitNote() {
  const text = $('#noteText').value.trim();
  if (!text && !draftImgs.length) {     // vaciar una nota existente = borrarla
    const id = editingNote;
    closeNote(true);
    if (id) removeNote(id, 'Nota eliminada');
    return null;
  }
  // Las imágenes que se sacaron de la nota se borran del servidor.
  const previas = editingNote ? ((state.notes.find(x => x.id === editingNote) || {}).imgs || []) : [];
  previas.filter(p => !draftImgs.some(d => d.path === p.path)).forEach(p => Sync.deleteImage(p.path));
  let id = editingNote;
  const n = id && state.notes.find(x => x.id === id);
  if (n) { n.text = text; n.imgs = draftImgs.map(im => ({ ...im })); touch(n); }
  else {
    id = uid();
    state.notes.unshift({ id, text, imgs: draftImgs.map(im => ({ ...im })), pinned: false, u: Date.now() });
  }
  imgsSubidas = [];                   // ya son parte de la nota, no se limpian
  closeNote();
  save(); app.render();
  return id;
}

function saveNote() {
  const era = editingNote;
  const id = commitNote();
  if (id) toast(era ? 'Nota actualizada' : 'Nota guardada');
}

// Quita la nota con "Deshacer"; las imágenes se borran del servidor recién
// cuando ya no se puede deshacer.
function removeNote(id, msg) {
  const idx = state.notes.findIndex(x => x.id === id);
  if (idx < 0) return;
  const n = state.notes[idx];
  state.notes.splice(idx, 1);
  tomb(id);
  save(); app.render();
  toast(msg, {
    undo: () => {
      delete state.trash[id];
      state.notes.splice(Math.min(idx, state.notes.length), 0, { ...n, u: Date.now() + 1 });
      save(); app.render();
    },
    commit: () => (n.imgs || []).forEach(im => Sync.deleteImage(im.path)),
  });
}

function delNote(id) {
  if (editingNote === id) { imgsSubidas = []; closeNote(); }
  removeNote(id, 'Nota eliminada');
}

function pinNote(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned; touch(n);
  save(); app.render(); toast(n.pinned ? '📌 Fijada arriba' : 'Desfijada');
}

function toggleCheck(id, line) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  n.text = toggleNoteLine(n.text, line); touch(n);
  save(); app.render();
}

// Primera línea → título; el resto (casillas o renglones) → subtareas.
// La nota se borra (con Deshacer) cuando se guarda la tarea; si tiene
// imágenes, queda.
function convertToTask() {
  if (!$('#noteText').value.trim()) { toast('Escribí algo primero'); return; }
  const id = commitNote();
  const n = id && state.notes.find(x => x.id === id);
  if (!n) return;
  const { title, body } = noteParts(n);
  const subtasks = body.map(l => ({ id: uid(), text: l.text.trim(), done: !!(l.check && l.done) })).filter(s => s.text);
  const keep = (n.imgs || []).length > 0;
  openSheet(null, {
    title: title === 'Nota sin título' ? '' : title,
    subtasks,
    onSaved: () => {
      if (keep) toast('Tarea creada · la nota queda porque tiene imágenes');
      else removeNote(id, 'Nota convertida en tarea');
    },
  });
}

// Casilla en el renglón actual (o la saca si ya tenía).
function toggleCheckLine() {
  const ta = $('#noteText');
  const v = ta.value, pos = ta.selectionStart;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  const nl = v.indexOf('\n', pos);
  const end = nl < 0 ? v.length : nl;
  const line = v.slice(start, end);
  const next = isCheckLine(line) ? checkText(line) : '- [ ] ' + line;
  ta.value = v.slice(0, start) + next + v.slice(end);
  const p = Math.max(start, pos + next.length - line.length);
  ta.focus(); ta.setSelectionRange(p, p);
}

// Enter en una casilla abre otra; Enter en una casilla vacía termina la lista.
function continueList(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  const ta = e.target;
  const v = ta.value, pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  const line = v.slice(start, pos);
  if (!isCheckLine(line)) return;
  e.preventDefault();
  if (!checkText(line).trim()) {
    ta.setRangeText('', start, pos, 'end');
  } else {
    ta.setRangeText('\n- [ ] ', pos, pos, 'end');
  }
}

export function zoomImage(src) {
  $('#imgViewerImg').src = src;
  $('#imgViewer').hidden = false;
}

export function handleNoteClick(e) {
  if (e.target.closest('a[href]')) return true;            // el link se abre solo
  const actEl = e.target.closest('[data-act]');
  const noteEl = actEl && actEl.closest('.note[data-note]');
  if (!noteEl) return false;
  const id = noteEl.dataset.note, act = actEl.dataset.act;
  if (act === 'note-zoom') zoomImage(actEl.src);
  else if (act === 'note-edit') openNote(id);
  else if (act === 'note-del') delNote(id);
  else if (act === 'note-pin') pinNote(id);
  else if (act === 'note-check') toggleCheck(id, +actEl.dataset.line);
  else return false;
  return true;
}

export function initNotes() {
  const ov = $('#noteOverlay');
  $('#noteCancel').addEventListener('click', () => closeNote(true));
  $('#noteSave').addEventListener('click', saveNote);
  $('#noteDelete').addEventListener('click', () => { if (editingNote) delNote(editingNote); });
  ov.addEventListener('click', (e) => { if (e.target === ov) closeNote(true); });
  $('#noteCheck').addEventListener('click', toggleCheckLine);
  $('#noteToTask').addEventListener('click', convertToTask);

  $('#noteAddImg').addEventListener('click', () => $('#noteFile').click());
  $('#noteFile').addEventListener('change', async (e) => {
    await pickImages([...e.target.files]);
    e.target.value = '';            // permite volver a elegir el mismo archivo
  });
  // Quitar una imagen del borrador (se borra del servidor recién al guardar).
  $('#noteImgs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) { draftImgs.splice(+b.dataset.i, 1); renderDraftImgs(); return; }
    const img = e.target.closest('img');
    if (img) zoomImage(img.src);
  });
  const text = $('#noteText');
  text.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter guarda sin sacar las manos del teclado.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); return; }
    continueList(e);
  });

  $('#imgViewer').addEventListener('click', () => {
    $('#imgViewer').hidden = true; $('#imgViewerImg').src = '';
  });
}

export const closeNoteEditor = () => closeNote(true);
