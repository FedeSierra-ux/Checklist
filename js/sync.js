/* Tudu — sincronización entre dispositivos (PC ⇆ celular).
 *
 * Modelo: un "código de sincronización" (largo y aleatorio) identifica tu
 * espacio en Firestore (Firebase). Todos los dispositivos que tengan el mismo código
 * comparten tareas y listas. No hay cuentas ni login: el código ES la llave,
 * así que tratalo como una contraseña.
 *
 * La app sigue funcionando 100% offline: localStorage es siempre la fuente de
 * verdad local y la nube es un espejo que se concilia cuando hay red.
 *
 * Conciliación: merge por ítem con marca de tiempo (`u`) y tumbas (`trash`),
 * así dos dispositivos que editaron cosas distintas no se pisan y lo borrado
 * en uno no "revive" desde el otro.
 */
(() => {
  'use strict';

  const CFG_KEY = 'tudu.sync.fb';   // antes 'tudu.sync.cfg' (Supabase)
  const CODE_KEY = 'tudu.sync.code';
  const LAST_KEY = 'tudu.sync.last';
  const POLL_MS = 25000;        // sondeo mientras la app está a la vista
  const PUSH_DEBOUNCE = 1200;   // espera tras un cambio local antes de subir
  const TRASH_TTL = 90 * 86400000; // las tumbas se podan a los 90 días

  let hooks = null;             // { getState, applyRemote, onStatus }
  let busy = false;
  let pushTimer = null;
  let pollTimer = null;
  let lastError = '';

  // ---------- Config y código ----------
  // Firebase: alcanza con el Project ID y la Web API key (ambos públicos por
  // diseño; lo que protege los datos son las reglas de firestore.rules).
  function fileCfg() {
    const c = window.TUDU_SYNC_CONFIG || {};
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
    (window.crypto || window.msCrypto).getRandomValues(n);
    const raw = [...n].map(v => abc[v % abc.length]).join('');
    return `tudu-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
  }
  function normalizeCode(code) {
    return (code || '').trim().toLowerCase().replace(/\s+/g, '');
  }
  function validCode(code) {
    return /^[a-z0-9-]{16,64}$/.test(normalizeCode(code));
  }

  // ---------- Red (Firestore REST) ----------
  // Sin SDK: la API REST alcanza y la app sigue sin paso de build.
  function docUrl(path) {
    const { project, key } = getConfig();
    if (!project || !key) throw new Error('Falta configurar Firebase.');
    return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}?key=${encodeURIComponent(key)}`;
  }

  // Devuelve el documento, o null si no existe.
  async function fsReq(method, path, body) {
    let res;
    try {
      res = await fetch(docUrl(path), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Sin conexión.');
    }
    if (res.ok) return method === 'DELETE' ? null : res.json().catch(() => null);
    const txt = await res.text().catch(() => '');
    let msg = '';
    try { msg = JSON.parse(txt).error.message || ''; } catch (e) { /* ignore */ }
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
  async function remoteGet(code) {
    const doc = await fsReq('GET', `rooms/${normalizeCode(code)}`);
    const raw = doc && doc.fields && doc.fields.data && doc.fields.data.stringValue;
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { throw new Error('Los datos de la nube están dañados.'); }
  }
  async function remotePut(code, payload) {
    const data = JSON.stringify(payload);
    if (data.length > 900000) throw new Error('Los datos superan el límite de Firestore (1 MB por espacio).');
    await fsReq('PATCH', `rooms/${normalizeCode(code)}`, {
      fields: { data: { stringValue: data }, u: { integerValue: String(Date.now()) } },
    });
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
    const url = `data:${mime};base64,${b64}`;
    srcCache.set(path, url);
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
  new MutationObserver(() => hydrate(document)).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Merge ----------
  const stamp = (o) => Number(o && o.u) || 0;
  const isDead = (o, trash) => trash[o.id] != null && trash[o.id] >= stamp(o);

  function mergeTrash(a = {}, b = {}) {
    const out = { ...a };
    for (const [id, ts] of Object.entries(b)) {
      if (!(out[id] >= ts)) out[id] = ts;
    }
    const cutoff = Date.now() - TRASH_TTL;
    for (const [id, ts] of Object.entries(out)) if (ts < cutoff) delete out[id];
    return out;
  }

  // Une dos colecciones por id quedándose con la versión más nueva de cada una.
  function mergeItems(a = [], b = [], trash) {
    const by = new Map();
    for (const it of [...a, ...b]) {
      if (!it || !it.id) continue;
      const prev = by.get(it.id);
      if (!prev || stamp(it) > stamp(prev)) by.set(it.id, { ...it });
    }
    return [...by.values()].filter(it => !isDead(it, trash));
  }

  function mergeLists(a = [], b = [], trash) {
    const by = new Map();
    const order = [];
    for (const l of [...a, ...b]) {
      if (!l || !l.id) continue;
      const prev = by.get(l.id);
      if (!prev) { by.set(l.id, { ...l, items: [...(l.items || [])] }); order.push(l.id); continue; }
      const win = stamp(l) > stamp(prev) ? l : prev;
      by.set(l.id, { ...win, items: mergeItems(prev.items, l.items, trash) });
    }
    return order.map(id => by.get(id))
      .filter(l => !isDead(l, trash))
      .map(l => ({ ...l, items: (l.items || []).filter(i => !isDead(i, trash)) }));
  }

  function mergeState(local, remote) {
    const trash = mergeTrash(local.trash, remote.trash);
    return {
      tasks: mergeItems(local.tasks, remote.tasks, trash),
      lists: mergeLists(local.lists, remote.lists, trash),
      notes: mergeItems(local.notes, remote.notes, trash),
      prices: mergeItems(local.prices, remote.prices, trash),
      trash,
    };
  }

  // Serialización estable (ordenada) sólo para comparar si algo cambió.
  function canon(p) {
    const sortById = (arr) => [...(arr || [])].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    return JSON.stringify({
      tasks: sortById(p.tasks).map(t => ({ ...t, subtasks: sortById(t.subtasks) })),
      lists: sortById(p.lists).map(l => ({ ...l, items: sortById(l.items) })),
      notes: sortById(p.notes),
      prices: sortById(p.prices),
      trash: Object.fromEntries(Object.entries(p.trash || {}).sort()),
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
    };
  }
  function emit() { if (hooks && hooks.onStatus) hooks.onStatus(status()); }

  // ---------- Ciclo de sincronización ----------
  async function syncNow({ silent = true } = {}) {
    if (!isOn() || busy || !hooks) return status();
    busy = true; lastError = ''; emit();
    try {
      const code = getCode();
      const local = hooks.getState();
      const remote = await remoteGet(code);
      const merged = remote ? mergeState(local, remote) : local;

      if (canon(merged) !== canon(local)) hooks.applyRemote(merged);
      if (!remote || canon(merged) !== canon(remote)) await remotePut(code, merged);

      localStorage.setItem(LAST_KEY, String(Date.now()));
      return status();
    } catch (e) {
      lastError = e.message || 'Error de sincronización';
      if (!silent) throw e;
      return status();
    } finally {
      busy = false; emit();
    }
  }

  // Primera conexión: el usuario decide qué hacer con lo que ya tiene.
  //   merge → une los dos lados      pull → la nube manda
  //   push  → este dispositivo manda
  async function connect(code, mode = 'merge') {
    code = normalizeCode(code);
    if (!validCode(code)) throw new Error('El código no es válido (16+ caracteres, letras, números y guiones).');
    if (!hasConfig()) throw new Error('Falta configurar Firebase.');

    const local = hooks.getState();
    const remote = await remoteGet(code);

    let result;
    if (mode === 'push' || !remote) result = local;
    else if (mode === 'pull') result = remote;
    else result = mergeState(local, remote);

    await remotePut(code, result);
    localStorage.setItem(CODE_KEY, code);
    localStorage.setItem(LAST_KEY, String(Date.now()));
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
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
    window.addEventListener('online', () => syncNow());
    startPolling();
    if (isOn()) syncNow();
    emit();
  }

  window.TuduSync = {
    init, status, syncNow, connect, disconnect, schedulePush,
    uploadImage, deleteImage, imageSrc,
    getConfig, setConfig, hasConfig, configIsFromFile,
    getCode, generateCode, normalizeCode, validCode, isOn,
    // exportados para pruebas
    _mergeState: mergeState,
  };
})();
