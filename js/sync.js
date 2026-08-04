/* Tudu — sincronización entre dispositivos (PC ⇆ celular).
 *
 * Modelo: un "código de sincronización" (largo y aleatorio) identifica tu
 * espacio en Supabase. Todos los dispositivos que tengan el mismo código
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

  const CFG_KEY = 'tudu.sync.cfg';
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
  function fileCfg() {
    const c = window.TUDU_SYNC_CONFIG || {};
    return { url: (c.url || '').trim(), key: (c.anonKey || '').trim() };
  }
  function getConfig() {
    const f = fileCfg();
    if (f.url && f.key) return f;
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        return { url: (c.url || '').trim().replace(/\/+$/, ''), key: (c.key || '').trim() };
      }
    } catch (e) { /* ignore */ }
    return { url: '', key: '' };
  }
  function setConfig(url, key) {
    url = (url || '').trim().replace(/\/+$/, '');
    key = (key || '').trim();
    if (!url || !key) throw new Error('Faltan la URL y la clave del proyecto.');
    if (!/^https:\/\/[\w.-]+/.test(url)) throw new Error('La URL tiene que empezar con https://');
    localStorage.setItem(CFG_KEY, JSON.stringify({ url, key }));
  }
  const hasConfig = () => { const c = getConfig(); return !!(c.url && c.key); };
  const configIsFromFile = () => { const f = fileCfg(); return !!(f.url && f.key); };

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

  // ---------- Red (RPC de Supabase) ----------
  async function rpc(fn, body) {
    const { url, key } = getConfig();
    if (!url || !key) throw new Error('Falta configurar Supabase.');
    // `apikey` alcanza para entrar como rol anónimo. El Bearer sólo se manda
    // con las claves viejas (JWT, empiezan con eyJ): las nuevas
    // (sb_publishable_…) no son JWT y no tienen por qué pasar por ese parser.
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

    let res;
    try {
      res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('Sin conexión.');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 404) throw new Error('Falta correr supabase/schema.sql en tu proyecto.');
      if (res.status === 401 || res.status === 403) throw new Error('La clave del proyecto no es válida.');
      throw new Error(txt.slice(0, 140) || `Error ${res.status}`);
    }
    return res.json().catch(() => null);
  }

  async function remoteGet(code) {
    const rows = await rpc('sync_pull', { p_code: normalizeCode(code) });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row && row.data ? row.data : null;
  }
  async function remotePut(code, payload) {
    await rpc('sync_push', { p_code: normalizeCode(code), p_data: payload });
  }

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
    if (!hasConfig()) throw new Error('Falta configurar Supabase.');

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
    getConfig, setConfig, hasConfig, configIsFromFile,
    getCode, generateCode, normalizeCode, validCode, isOn,
    // exportados para pruebas
    _mergeState: mergeState,
  };
})();
