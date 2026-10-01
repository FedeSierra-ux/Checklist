/* Texto: escapar, resaltar búsquedas, links, checklists de notas y
   cantidades de la lista de compras. Puro. */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Escapa `text` y envuelve en <mark> lo que coincide con `q`, sin importar
// mayúsculas ni tildes ("cafe" encuentra "Café").
export function hl(text, q) {
  const src = String(text ?? '');
  const nq = norm(q);
  if (!nq) return esc(src);
  let n = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    for (const ch of norm(src[i]) || (/\s/.test(src[i]) ? ' ' : '')) { n += ch; map.push(i); }
  }
  let out = '', last = 0, from = 0, k;
  while ((k = n.indexOf(nq, from)) !== -1) {
    const a = map[k], b = map[k + nq.length - 1] + 1;
    out += `${esc(src.slice(last, a))}<mark>${esc(src.slice(a, b))}</mark>`;
    last = b; from = k + nq.length;
  }
  return out + esc(src.slice(last));
}

export const matches = (text, q) => norm(text).includes(norm(q));

// Links que se pueden tocar (+ resaltado). La puntuación final no es parte
// del link: "mirá www.ejemplo.com." no lleva el punto.
const URL_RX = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
export function richText(text, q = '') {
  const src = String(text ?? '');
  let out = '', last = 0;
  for (const m of src.matchAll(URL_RX)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (!url) continue;
    const a = m.index, b = a + url.length;
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    out += hl(src.slice(last, a), q)
      + `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${hl(url, q)}</a>`;
    last = b;
  }
  return out + hl(src.slice(last), q);
}

// --- Notas con checklist: renglones "- [ ] algo" / "- [x] hecho" ---
const CHECK_RX = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/;

export function noteLines(text) {
  return String(text ?? '').split('\n').map((raw, i) => {
    const m = raw.match(CHECK_RX);
    return m ? { i, check: true, done: m[1] !== ' ', text: m[2] } : { i, check: false, text: raw };
  });
}

export function toggleNoteLine(text, i) {
  const lines = String(text ?? '').split('\n');
  const m = lines[i] && lines[i].match(CHECK_RX);
  if (!m) return text;
  lines[i] = lines[i].replace(/\[( |x|X)\]/, m[1] === ' ' ? '[x]' : '[ ]');
  return lines.join('\n');
}

export const isCheckLine = (line) => CHECK_RX.test(line);
export const checkText = (line) => { const m = String(line).match(CHECK_RX); return m ? m[2] : line; };

// La primera línea es el título (sin la casilla si es un ítem).
export const noteTitleOf = (text) => checkText(String(text ?? '').split('\n')[0]).trim();

// --- Compras: "2 kg papas", "leche x2", "papas 2 kg" ---
const UNITS = 'kg|kilos?|g|gr|grs|gramos?|l|lts?|litros?|ml|cc|u|un|unid(?:ades)?|docenas?|paq(?:uetes?)?'
  + '|latas?|botellas?|cajas?|sobres?|frascos?|bolsas?|potes?|planchas?|atados?|maples?|rollos?';
const NUMQ = '\\d+(?:[.,]\\d+)?|\\d+\\/\\d+';
const R_LEAD = new RegExp(`^\\s*(${NUMQ})\\s*((?:${UNITS})(?![\\p{L}]))?\\.?\\s+(?:de\\s+)?(.+)$`, 'iu');
const R_X = new RegExp(`^(.+?)\\s+x\\s*(${NUMQ})\\s*((?:${UNITS})(?![\\p{L}]))?\\s*$`, 'iu');
const R_TAIL = new RegExp(`^(.+?)\\s+(${NUMQ})\\s*((?:${UNITS})(?![\\p{L}]))\\.?\\s*$`, 'iu');

export function parseItem(raw) {
  const s = String(raw ?? '').trim();
  const q = (n, u) => (u ? `${n} ${u.toLowerCase()}` : n).replace(/\s+/g, ' ');
  let m = s.match(R_LEAD);
  if (m) return { text: m[3].trim(), qty: q(m[1], m[2]) };
  m = s.match(R_X);
  if (m) return { text: m[1].trim(), qty: q(m[2], m[3]) };
  m = s.match(R_TAIL);
  if (m) return { text: m[1].trim(), qty: q(m[2], m[3]) };
  return { text: s, qty: '' };
}

// Clave para comparar productos: sin tildes, mayúsculas ni plural
// ("Tomates" = "tomate", "limones" = "limón", "panes" = "pan").
export function itemKey(s) {
  return norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(w => {
    if (w.length <= 3) return w;
    if (/[lnrdjy]es$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('s')) return w.slice(0, -1);
    return w;
  }).join(' ');
}
