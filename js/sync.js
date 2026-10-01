/* Tudu — sincronización entre dispositivos (PC ⇆ celular).
 *
 * Modelo: un "código de sincronización" (largo y aleatorio) identifica tu
 * espacio en Firestore (Firebase). Todos los dispositivos que tengan el mismo
 * código comparten tareas y listas. No hay cuentas ni login: el código ES la
 * llave, así que tratalo como una contraseña.
 *
 * La app sigue funcionando 100% offline: localStorage es siempre la fuente de
 * verdad local y la nube es un espejo que se concilia cuando hay red. La
 * conciliación (merge por ítem, tumbas, archivo) vive en core/merge.js.
 *
 * Escrituras con precondición: se sube sólo si el documento sigue en la
 * versión que se leyó. Si otro dispositivo escribió en el medio, se vuelve a
 * leer y a mezclar en vez de pisarlo.
 */
import CONFIG from './sync-config.js';
import { mergeState, canon, fitToLimit, sizeOf } from './core/merge.js';
import { normalizePayload } from './core/model.js';

const CFG_KEY = 'tudu.sync.fb';   // antes 'tudu.sync.cfg' (Supabase)
const CODE_KEY = 'tudu.sync.code';
const LAST_KEY = 'tudu.sync.last';
const POLL_MS = 25000;            // sondeo mientras la app está a la vista
const PUSH_DEBOUNCE = 1200;       // espera tras un cambio local antes de subir
export const MAX_DOC = 900000;    // Firestore: 1 MiB por documento, con margen

let hooks = null;                 // { getState, applyRemote, onStatus }
let busy = false;
let again = false;                // hubo cambios mientras se sincronizaba
let pushTimer = null;
let pollTimer = null;
let lastError = '';
let lastSize = 0;

// ---------- Config y código ----------
// Firebase: alcanza con el Project ID y la Web API key (ambos públicos por
// diseño; lo que protege los datos son las reglas de firestore.rules).
function fileCfg() {
  const c = CONFIG || {};
  return { project: (c.projectId || '').trim(), key: (c.apiKey || '').trim() };
}
function getConfig() {
  const f = fileCfg();
  if (f.project && f.key) return f;
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      return { project: (c.project || '').trim(), key: (c.key || '').trim() };
    }
  } catch (e) { /* ignore */ }
  return { project: '', key: '' };
}
function setConfig(project, key) {
  project = (project || '').trim();
  key = (key || '').trim();
  if (!project || !key) throw new Error('Faltan el Project ID y la API key.');
  if (!/^[a-z0-9-]{4,40}$/.test(project)) throw new Error('El Project ID es algo como "tudu-1a2b3" (minúsculas, números y guiones).');
  if (!/^AIza[\w-]{30,}$/.test(key)) throw new Error('La API key de Firebase empieza con "AIza".');
  localStorage.setItem(CFG_KEY, JSON.stringify({ project, key }));
}
const hasConfig = () => { const c = getConfig(); return !!(c.project && c.key); };
const configIsFromFile = () => { const f = fileCfg(); return !!(f.project && f.key); };

const getCode = () => (localStorage.getItem(CODE_KEY) || '').trim();
const isOn = () => hasConfig() && !!getCode();
const lastSync = () => Number(localStorage.getItem(LAST_KEY) || 0);

// Código de 20 caracteres al azar (~100 bits): imposible de adivinar y
// legible para copiarlo a mano si hace falta.
function generateCode() {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789'; // sin l/1/0/o
  const n = new Uint32Array(20);
  crypto.getRandomValues(n);
  const raw = [...n].map(v => abc[v % abc.length]).join('');
  return `tudu-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}
const normalizeCode = (code) => (code || '').trim().toLowerCase().replace(/\s+/g, '');
const validCode = (code) => /^[a-z0-9-]{16,64}$/.test(normalizeCode(code));

// ---------- Red (Firestore REST) ----------
// Sin SDK: la API REST alcanza y la app sigue sin paso de build.
function docUrl(path, params = {}) {
  const { project, key } = getConfig();
  if (!project || !key) throw new Error('Falta configurar Firebase.');
  const qs = new URLSearchParams({ key, ...params });
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}?${qs}`;
}

async function fsReq(method, path, body, params) {
  let res;
  try {
    res = await fetch(docUrl(path, params), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Sin conexión.');
  }
  if (res.ok) return method === 'DELETE' ? null : res.json().catch(() => null);
  const txt = await res.text().catch(() => '');
  let msg = '', st = '';
  try { const j = JSON.parse(txt).error; msg = j.message || ''; st = j.status || ''; } catch (e) { /* ignore */ }
  // Precondición fallida: otro dispositivo escribió entre la lectura y esta
  // escritura. No es un error para el usuario: se reintenta.
  if (params && (/FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED/.test(st) || (res.status === 404 && method === 'PATCH'))) {
    const e = new Error('Conflicto de versión.');
    e.conflict = true;
    throw e;
  }
  if (res.status === 404) {
    if (/database .* does not exist/i.test(msg)) throw new Error('Falta crear la base Firestore en tu proyecto de Firebase.');
    if (method === 'GET') return null;          // documento inexistente
  }
  if (res.status === 403) {
    if (/API key|api_key|API has not been used|disabled/i.test(msg)) throw new Error('La API key no es válida o la API de Firestore está deshabilitada.');
    throw new Error('Firestore rechazó el acceso: publicá las reglas de firebase/firestore.rules.');
  }
  if (res.status === 400 && /API key/i.test(msg)) throw new Error('La API key no es válida.');
  throw new Error((msg || txt).slice(0, 140) || `Error ${res.status}`);
}

// El estado viaja como un string JSON en un solo campo: evita traducir todo
// al formato tipado de Firestore y las reglas lo validan fácil.
// Devuelve { data, updateTime }; data = null si el espacio todavía no existe.
async function remoteGet(code) {
  const doc = await fsReq('GET', `rooms/${normalizeCode(code)}`);
  const raw = doc && doc.fields && doc.fields.data && doc.fields.data.stringValue;
  if (!raw) return { data: null, updateTime: doc ? doc.updateTime || null : null };
  try { return { data: JSON.parse(raw), updateTime: doc.updateTime || null }; }
  catch (e) { throw new Error('Los datos de la nube están dañados.'); }
}

// `updateTime`: string → sólo si el documento sigue en esa versión;
// null → sólo si todavía no existe; undefined → sin condición.
async function remotePut(code, payload, updateTime) {
  const data = JSON.stringify(payload);
  if (data.length > MAX_DOC) throw new Error('Los datos superan el límite de Firestore (1 MB por espacio).');
  const pre = updateTime === undefined ? undefined
    : updateTime ? { 'currentDocument.updateTime': updateTime } : { 'currentDocument.exists': 'false' };
  await fsReq('PATCH', `rooms/${normalizeCode(code)}`, {
    fields: { data: { stringValue: data }, u: { integerValue: String(Date.now()) } },
  }, pre);
}

// ---------- Imágenes (documentos de Firestore) ----------
// Firebase Storage ya no tiene plan gratis, así que cada imagen es un
// documento imgs/{id} con el JPEG en base64 (límite: 1 MB por documento).
// En las notas se guarda sólo `path` (el id); la app muestra
// <img data-img="path"> y acá se completa el src cuando aparece en pantalla.
const IMG_B64_MAX = 700000;

// Prefijo por espacio: el hash del código, no el código en claro.
async function codeFolder() {
  const data = new TextEncoder().encode('tudu:' + getCode());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
// 128 bits de azar: nadie adivina el id de una imagen.
function randomName() {
  const n = new Uint8Array(16);
  crypto.getRandomValues(n);
  return [...n].map(b => b.toString(16).padStart(2, '0')).join('');
}

const blobToB64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => bad(new Error('No se pudo leer la imagen.'));
  r.readAsDataURL(blob);
});

// Si la imagen no entra en un documento, se re-encoda cada vez más chica.
async function fitImage(blob) {
  let b64 = await blobToB64(blob);
  if (b64.length <= IMG_B64_MAX) return { b64, mime: blob.type || 'image/jpeg' };
  const bmp = await createImageBitmap(blob);
  for (const [lado, q] of [[1400, 0.75], [1200, 0.7], [1000, 0.65], [800, 0.6]]) {
    const esc = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const small = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (!small) break;
    b64 = await blobToB64(small);
    if (b64.length <= IMG_B64_MAX) { bmp.close?.(); return { b64, mime: 'image/jpeg' }; }
  }
  bmp.close?.();
  throw new Error('La imagen es demasiado grande.');
}

async function uploadImage(blob) {
  if (!isOn()) throw new Error('Activá la sincronización para adjuntar imágenes.');
  const { b64, mime } = await fitImage(blob);
  const path = `${await codeFolder()}-${randomName()}`;
  await fsReq('PATCH', `imgs/${path}`, {
    fields: { b64: { stringValue: b64 }, mime: { stringValue: mime } },
  });
  srcCache.set(path, `data:${mime};base64,${b64}`);
  return { path, url: '' };
}

// Best-effort: si falla, la imagen queda huérfana pero la app sigue andando.
async function deleteImage(path) {
  if (!path || !hasConfig() || !/^[0-9a-f]{24}-[0-9a-f]{32}$/.test(path)) return false;
  srcCache.delete(path);
  try { await fsReq('DELETE', `imgs/${path}`); return true; } catch (e) { return false; }
}

const srcCache = new Map();   // path → data: URL
const inflight = new Map();   // path → Promise

function fetchImage(path) {
  if (srcCache.has(path)) return Promise.resolve(srcCache.get(path));
  if (!inflight.has(path)) {
    inflight.set(path, fsReq('GET', `imgs/${path}`).then(doc => {
      const f = doc && doc.fields;
      const url = f && f.b64 ? `data:${(f.mime && f.mime.stringValue) || 'image/jpeg'};base64,${f.b64.stringValue}` : '';
      if (url) srcCache.set(path, url);
      return url;
    }).finally(() => inflight.delete(path)));
  }
  return inflight.get(path);
}

// src inmediato si ya está en memoria (evita parpadeo al re-renderizar).
function imageSrc(im) {
  if (!im) return '';
  if (im.path && srcCache.has(im.path)) return srcCache.get(im.path);
  return '';
}

function hydrate(root) {
  if (!hasConfig()) return;
  root.querySelectorAll('img[data-img]:not([data-loaded])').forEach(img => {
    img.setAttribute('data-loaded', '1');
    fetchImage(img.getAttribute('data-img'))
      .then(url => { if (url) img.src = url; else img.classList.add('img-missing'); })
      .catch(() => { img.removeAttribute('data-loaded'); img.classList.add('img-missing'); });
  });
}

// ---------- Estado visible ----------
function status() {
  return {
    configured: hasConfig(),
    fromFile: configIsFromFile(),
    on: isOn(),
    code: getCode(),
    last: lastSync(),
    busy,
    error: lastError,
    size: lastSize,
    max: MAX_DOC,
  };
}
function emit() { if (hooks && hooks.onStatus) hooks.onStatus(status()); }

// Mezcla lo local con lo remoto y deja ambos lados iguales. Si el estado no
// entra en el documento, recorta lo más viejo del archivo.
function reconcile(remoteData) {
  // El estado local se lee DESPUÉS del fetch: lo que se cargó mientras
  // viajaba la red entra en la mezcla en vez de perderse.
  const local = normalizePayload(hooks.getState());
  const merged0 = remoteData ? mergeState(local, normalizePayload(remoteData)) : local;
  const { payload: merged } = fitToLimit(merged0, MAX_DOC);
  if (canon(merged) !== canon(hooks.getState())) hooks.applyRemote(merged);
  lastSize = sizeOf(merged);
  return merged;
}

// ---------- Ciclo de sincronización ----------
async function syncNow({ silent = true } = {}) {
  if (!isOn() || !hooks) return status();
  if (busy) { again = true; return status(); }
  busy = true; lastError = ''; emit();
  try {
    const code = getCode();
    for (let attempt = 0; ; attempt++) {
      const remote = await remoteGet(code);
      const merged = reconcile(remote.data);
      if (remote.data && canon(merged) === canon(normalizePayload(remote.data))) break;
      try {
        await remotePut(code, merged, remote.updateTime);
        break;
      } catch (e) {
        if (e.conflict && attempt < 4) continue;   // otro escribió: releer y mezclar
        throw e;
      }
    }
    localStorage.setItem(LAST_KEY, String(Date.now()));
    return status();
  } catch (e) {
    lastError = e.message || 'Error de sincronización';
    if (!silent) throw e;
    return status();
  } finally {
    busy = false; emit();
    if (again) { again = false; schedulePush(); }
  }
}

// Primera conexión: el usuario decide qué hacer con lo que ya tiene.
//   merge → une los dos lados      pull → la nube manda
//   push  → este dispositivo manda
async function connect(code, mode = 'merge') {
  code = normalizeCode(code);
  if (!validCode(code)) throw new Error('El código no es válido (16+ caracteres, letras, números y guiones).');
  if (!hasConfig()) throw new Error('Falta configurar Firebase.');

  const local = normalizePayload(hooks.getState());
  const remote = await remoteGet(code);

  let result;
  if (mode === 'push' || !remote.data) result = local;
  else if (mode === 'pull') result = normalizePayload(remote.data);
  else result = mergeState(local, normalizePayload(remote.data));
  result = fitToLimit(result, MAX_DOC).payload;

  await remotePut(code, result);
  localStorage.setItem(CODE_KEY, code);
  localStorage.setItem(LAST_KEY, String(Date.now()));
  lastSize = sizeOf(result);
  hooks.applyRemote(result);
  startPolling();
  emit();
  return status();
}

function disconnect() {
  localStorage.removeItem(CODE_KEY);
  localStorage.removeItem(LAST_KEY);
  stopPolling();
  lastError = '';
  emit();
}

// Se llama en cada save() de la app: sube el cambio en cuanto se aquieta.
function schedulePush() {
  if (!isOn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), PUSH_DEBOUNCE);
}

function startPolling() {
  stopPolling();
  if (!isOn()) return;
  pollTimer = setInterval(() => { if (!document.hidden) syncNow(); }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

function init(h) {
  hooks = h;
  new MutationObserver(() => hydrate(document)).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('online', () => syncNow());
  startPolling();
  if (isOn()) syncNow();
  emit();
}

export const Sync = {
  init, status, syncNow, connect, disconnect, schedulePush,
  uploadImage, deleteImage, imageSrc,
  getConfig, setConfig, hasConfig, configIsFromFile,
  getCode, generateCode, normalizeCode, validCode, isOn,
};
