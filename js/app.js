/* Pendientes — tareas con prioridad, vista Hoy, subtareas, etiquetas, búsqueda.
   Corre como web (PWA) y dentro del APK (Capacitor): en ese caso usa
   notificaciones nativas del sistema (disparan con la app cerrada) y
   sincroniza datos para el widget de pantalla de inicio. */
(() => {
  'use strict';

  const STORE_KEY = 'pendientes.v2';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const PRIO_LABEL = { 0: '', 1: 'Baja', 2: 'Media', 3: 'Alta' };

  // ---------- State ----------
  let state = load();
  let view = 'hoy';
  let calMonth = new Date(); calMonth.setDate(1);
  let selectedDay = null;
  let editingId = null;
  let draftSubs = [];        // subtareas mientras se edita
  let expanded = {};         // id -> bool (subtareas desplegadas)
  let query = '';

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return migrate(JSON.parse(raw));
      const old = localStorage.getItem('pendientes.v1');
      if (old) return migrate(JSON.parse(old));
    } catch (e) { /* ignore */ }
    return { tasks: [], lists: [], notified: {} };
  }
  function migrate(s) {
    s.tasks = (s.tasks || []).map(t => ({
      priority: 0, tags: [], subtasks: [], ...t,
    }));
    s.lists = s.lists || [];
    s.notified = s.notified || {};
    return s;
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    scheduleNative();
    syncWidget();
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Date helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  function taskDate(t) {
    if (!t.date) return null;
    const [y, m, d] = t.date.split('-').map(Number);
    const [hh, mm] = (t.time || '23:59').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
  }
  function weekRange(base = new Date()) {
    const d = startOfDay(base);
    const dow = (d.getDay() + 6) % 7;
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  function humanDue(t) {
    const dt = taskDate(t);
    if (!dt) return null;
    const now = new Date();
    const today = startOfDay(now), day = startOfDay(dt);
    const diff = Math.round((day - today) / 86400000);
    const hora = t.time ? ` ${t.time}` : '';
    let label, cls = '';
    if (dt < now && !t.done) { label = 'Vencida' + (t.time ? ` ${t.time}` : ''); cls = 'due'; }
    else if (diff === 0) { label = 'Hoy' + hora; cls = 'today'; }
    else if (diff === 1) { label = 'Mañana' + hora; }
    else if (diff > 1 && diff <= 6) { label = DIAS[dt.getDay()].slice(0, 3) + hora; }
    else { label = `${dt.getDate()} ${MESES[dt.getMonth()].slice(0, 3)}` + hora; }
    return { label, cls };
  }

  // ---------- Natural language quick-add ----------
  // Extrae #etiquetas, !prioridad y hoy/mañana + hora del texto.
  function parseQuick(text) {
    let title = text;
    const tags = [];
    let priority = null, date = null, time = null;
    title = title.replace(/#([\wáéíóúñ]+)/gi, (_, t) => { tags.push(t.toLowerCase()); return ''; });
    title = title.replace(/!(alta|media|baja|[1-3])/gi, (_, p) => {
      const map = { alta: 3, media: 2, baja: 1, '1': 1, '2': 2, '3': 3 };
      priority = map[p.toLowerCase()]; return '';
    });
    const t = new Date();
    if (/\bhoy\b/i.test(title)) { date = ymd(t); title = title.replace(/\bhoy\b/i, ''); }
    else if (/\bmañana\b/i.test(title)) { const d = new Date(t); d.setDate(d.getDate() + 1); date = ymd(d); title = title.replace(/\bmañana\b/i, ''); }
    else if (/\bpasado\b/i.test(title)) { const d = new Date(t); d.setDate(d.getDate() + 2); date = ymd(d); title = title.replace(/\bpasado( mañana)?\b/i, ''); }
    const hm = title.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (hm) { time = `${pad(+hm[1])}:${hm[2]}`; title = title.replace(hm[0], ''); }
    const pm = title.match(/\b(\d{1,2})\s?(am|pm)\b/i);
    if (pm && !time) { let h = +pm[1] % 12; if (/pm/i.test(pm[2])) h += 12; time = `${pad(h)}:00`; title = title.replace(pm[0], ''); }
    return { title: title.replace(/\s{2,}/g, ' ').trim(), tags, priority, date, time };
  }

  // ---------- Rendering ----------
  const content = $('#content');

  let closeSwipe = null;
  function render() {
    updateTop();
    if (closeSwipe) closeSwipe();
    const flipFirst = reducedMotion() ? null : captureRects();
    if (query) renderSearch();
    else if (view === 'hoy') renderHoy();
    else if (view === 'semana') renderSemana();
    else if (view === 'mes') renderMes();
    else renderCompras();
    if (flipFirst) flipPlay(flipFirst);
    checkWebReminders();
  }
  // FLIP: mide posiciones antes de re-render y anima el reacomodo de las filas.
  function captureRects() {
    const m = new Map();
    content.querySelectorAll('.row[data-id]').forEach(r => m.set(r.dataset.id, r.getBoundingClientRect().top));
    return m;
  }
  function flipPlay(first) {
    content.querySelectorAll('.row[data-id]').forEach(r => {
      const prev = first.get(r.dataset.id); if (prev == null) return;
      const dy = prev - r.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) return;
      r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
    });
  }

  function updateTop() {
    const now = new Date();
    $('#topDay').textContent = `${DIAS[now.getDay()]} · ${now.getDate()} ${MESES[now.getMonth()].slice(0, 3)}`;
    const titles = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', compras: 'Compras' };
    $('#topTitle').textContent = query ? 'Buscar' : titles[view];
    $$('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('#progressWrap').classList.toggle('hide', view === 'compras' || view === 'mes' || !!query);
    $('#fab').style.display = (view === 'mes' && !query) ? 'none' : 'flex';
  }

  const byPrioDate = (a, b) => (b.priority || 0) - (a.priority || 0) || ((taskDate(a) || Infinity) - (taskDate(b) || Infinity));

  function rowHTML(t) {
    const due = humanDue(t);
    const subs = t.subtasks || [];
    const subDone = subs.filter(s => s.done).length;
    const meta = [];
    if (subs.length) meta.push(`<button class="subcount" data-act="expand"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 11l3 3L20 6"/></svg>${subDone}/${subs.length}</button>`);
    if (t.cat && t.cat !== 'General') meta.push(`<span class="chip">${esc(t.cat)}</span>`);
    (t.tags || []).forEach(tg => meta.push(`<span class="tag" data-tag="${esc(tg)}">#${esc(tg)}</span>`));
    const subsBlock = (expanded[t.id] && subs.length) ? `<div class="subs">${subs.map(s =>
      `<div class="subrow ${s.done ? 'done' : ''}"><button class="sck ${s.done ? 'done' : ''}" data-act="subtoggle" data-sid="${s.id}" aria-label="Marcar paso"></button><span>${esc(s.text)}</span></div>`
    ).join('')}</div>` : '';
    const overdue = due && due.cls === 'due' ? ' overdue' : '';
    const pri = (!t.done && t.priority === 3) ? ' pri3' : '';
    return `<div class="row ${t.done ? 'done' : ''}${overdue}${pri}" data-id="${t.id}">
        <div class="swipe-bg done-hint">✓ Completar</div>
        <div class="swipe-actions"><button class="sa-snooze" data-act="snooze" tabindex="-1">Mañana</button><button class="sa-del" data-act="del" tabindex="-1" aria-label="Eliminar">🗑</button></div>
        <div class="row-surface">
          <button class="ck ${t.done ? 'done' : ''} p${t.priority || 0}" data-act="toggle" aria-label="${t.done ? 'Reactivar' : 'Completar'}"></button>
          <div class="main" data-act="edit">
            <div class="line1"><span class="tx">${esc(t.title)}</span>${due ? `<span class="when ${due.cls}">${due.label}</span>` : ''}</div>
            ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
            ${subsBlock}
          </div>
          <button class="del" data-act="del" aria-label="Eliminar"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
        </div>
      </div>`;
  }

  function sectionHTML(label, arr) {
    if (!arr.length) return '';
    const due = /vencid/i.test(label) ? ' due' : '';
    return `<div class="sec${due}"><span class="lead">${label}</span><span class="count">${arr.length}</span></div>` + arr.map(rowHTML).join('');
  }

  function renderHoy() {
    const now = new Date(), today = startOfDay(now);
    const todayStr = ymd(now);
    const pend = state.tasks.filter(t => !t.done);
    const overdue = pend.filter(t => { const d = taskDate(t); return d && d < now && ymd(d) !== todayStr; }).sort(byPrioDate);
    const hoy = pend.filter(t => t.date === todayStr).sort(byPrioDate);
    const done = state.tasks.filter(t => t.done && t.date === todayStr);
    updateProgress(done.length, hoy.length + done.length);
    let html = sectionHTML('Vencidas', overdue) + sectionHTML('Hoy', hoy) + sectionHTML('Completadas hoy', done);
    content.innerHTML = html || `<div class="empty">
      <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <b>Día despejado</b><p>No tenés nada para hoy ni vencido. Disfrutá.</p></div>`;
  }

  function renderSemana() {
    const { start, end } = weekRange();
    const now = new Date(), today = startOfDay(now);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const b = { venc: [], hoy: [], man: [], sem: [], sin: [], hechas: [] };
    state.tasks.forEach(t => {
      if (t.done) { b.hechas.push(t); return; }
      const dt = taskDate(t);
      if (!dt) { b.sin.push(t); return; }
      if (dt < now) { b.venc.push(t); return; }
      const day = startOfDay(dt);
      if (+day === +today) b.hoy.push(t);
      else if (+day === +tomorrow) b.man.push(t);
      else b.sem.push(t);
    });
    Object.values(b).forEach(a => a.sort(byPrioDate));
    updateProgress(b.hechas.length, state.tasks.length);
    const html = sectionHTML('Vencidas', b.venc) + sectionHTML('Hoy', b.hoy) + sectionHTML('Mañana', b.man)
      + sectionHTML('Próximas', b.sem) + sectionHTML('Sin fecha', b.sin) + sectionHTML('Completadas', b.hechas);
    content.innerHTML = html || emptyBox('Todo en orden', 'No tenés tareas pendientes. Tocá el + para agregar una.');
  }

  function renderMes() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const startPad = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const todayStr = ymd(new Date());
    const map = {};
    state.tasks.forEach(t => { if (t.date) (map[t.date] = map[t.date] || []).push(t); });
    let cells = '';
    for (let i = 0; i < startPad; i++) cells += `<div class="cell out"></div>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
      const arr = map[ds] || [];
      const pendTasks = arr.filter(t => !t.done);
      const pend = pendTasks.length, dn = arr.length - pend;
      const maxP = pendTasks.reduce((m, t) => Math.max(m, t.priority || 0), 0);
      let pips = arr.length ? '<div class="pips">' + (pend ? `<i class="p${maxP}"></i>` : '') + (dn ? '<i class="done"></i>' : '') + '</div>' : '';
      const cls = ['cell', 'cur']; if (ds === todayStr) cls.push('today'); if (ds === selectedDay) cls.push('sel');
      cells += `<div class="${cls.join(' ')}" data-day="${ds}">${d}${pips}</div>`;
    }
    content.innerHTML = `<div class="cal">
        <div class="cal-head"><h3>${MESES[m]} ${y}</h3>
          <div class="cal-nav"><button data-cal="prev" aria-label="Anterior">‹</button><button data-cal="today" aria-label="Hoy">•</button><button data-cal="next" aria-label="Siguiente">›</button></div></div>
        <div class="m-head"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div class="m-grid">${cells}</div></div><div id="dayDetail"></div>`;
    renderDayDetail();
  }
  function renderDayDetail() {
    const box = $('#dayDetail'); if (!box) return;
    if (!selectedDay) { box.innerHTML = `<div class="empty" style="padding:30px 20px"><p>Tocá un día para ver o agregar sus tareas.</p></div>`; return; }
    const [y, mo, d] = selectedDay.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    const tasks = state.tasks.filter(t => t.date === selectedDay).sort(byPrioDate);
    box.innerHTML = `<div class="sec"><span class="lead">${DIAS[dt.getDay()]} ${d} de ${MESES[mo - 1]}</span><span class="count">${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'}</span></div>`
      + (tasks.length ? tasks.map(rowHTML).join('') : `<div class="empty" style="padding:22px"><p>Nada agendado.</p></div>`)
      + `<button class="btn primary" id="addForDay" style="margin-top:12px">+ Agregar tarea para este día</button>`;
  }

  function renderCompras() {
    if (!state.lists.length) { content.innerHTML = emptyBox('Sin listas', 'Creá tu primera lista de compras con el botón +.'); return; }
    content.innerHTML = state.lists.map(list => {
      const done = list.items.filter(i => i.done).length;
      const items = list.items.map(it => `<div class="shop-item ${it.done ? 'done' : ''}" data-list="${list.id}" data-item="${it.id}">
          <button class="sck ${it.done ? 'done' : ''}" data-act="shop-toggle" aria-label="Marcar"></button>
          <span>${esc(it.text)}</span><button class="rm" data-act="shop-del" aria-label="Quitar">&times;</button></div>`).join('');
      return `<div class="shop-list" data-list="${list.id}">
          <div class="shop-head"><h3>${esc(list.name)}</h3><span class="badge">${done}/${list.items.length}</span>
            <button class="del-list" data-act="list-del" aria-label="Eliminar lista"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button></div>
          ${items}
          <form class="shop-add" data-list="${list.id}"><input type="text" placeholder="Agregar ítem…" autocomplete="off" aria-label="Nuevo ítem"><button type="submit" aria-label="Agregar">+</button></form>
        </div>`;
    }).join('');
  }

  function renderSearch() {
    const q = query.toLowerCase().replace(/^#/, '');
    const isTag = query.startsWith('#');
    const res = state.tasks.filter(t => {
      if (isTag) return (t.tags || []).some(tg => tg.includes(q));
      return t.title.toLowerCase().includes(q) || (t.tags || []).some(tg => tg.includes(q)) || (t.cat || '').toLowerCase().includes(q);
    }).sort(byPrioDate);
    content.innerHTML = res.length
      ? `<div class="sec"><span class="lead">Resultados</span><span class="count">${res.length}</span></div>` + res.map(rowHTML).join('')
      : `<div class="empty" style="padding:44px 20px"><b>Sin resultados</b><p>No hay tareas que coincidan con "${esc(query)}".</p></div>`;
  }

  function emptyBox(title, desc) {
    return `<div class="empty">
      <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <b>${title}</b><p>${desc}</p></div>`;
  }
  function updateProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressPct').textContent = `${done}/${total}`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Content interactions ----------
  content.addEventListener('click', (e) => {
    const calBtn = e.target.closest('[data-cal]');
    if (calBtn) {
      const d = calBtn.dataset.cal;
      if (d === 'prev') calMonth.setMonth(calMonth.getMonth() - 1);
      else if (d === 'next') calMonth.setMonth(calMonth.getMonth() + 1);
      else { calMonth = new Date(); calMonth.setDate(1); selectedDay = ymd(new Date()); }
      renderMes(); return;
    }
    const cell = e.target.closest('.cell[data-day]');
    if (cell) { selectedDay = selectedDay === cell.dataset.day ? null : cell.dataset.day; renderMes(); return; }
    if (e.target.id === 'addForDay') { openSheet(null, selectedDay); return; }

    const tagEl = e.target.closest('.tag[data-tag]');
    if (tagEl) { openSearch('#' + tagEl.dataset.tag); return; }

    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'shop-toggle' || act === 'shop-del') {
      const row = actEl.closest('.shop-item'); shopItem(row.dataset.list, row.dataset.item, act === 'shop-toggle' ? 'toggle' : 'del'); return;
    }
    if (act === 'list-del') { delList(actEl.closest('.shop-list').dataset.list); return; }

    const card = actEl.closest('.row'); if (!card) return;
    const id = card.dataset.id;
    if (act === 'toggle') toggleTask(id, card);
    else if (act === 'edit') openSheet(id);
    else if (act === 'del') delTask(id);
    else if (act === 'snooze') snoozeTask(id);
    else if (act === 'expand') { expanded[id] = !expanded[id]; render(); }
    else if (act === 'subtoggle') toggleSub(id, actEl.dataset.sid);
  });

  content.addEventListener('submit', (e) => {
    const form = e.target.closest('.shop-add'); if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input'); const text = input.value.trim(); if (!text) return;
    const list = state.lists.find(l => l.id === form.dataset.list);
    if (list) { list.items.push({ id: uid(), text, done: false }); save(); renderCompras(); }
  });

  // ---------- Task actions ----------
  function toggleTask(id, rowEl) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const willDone = !t.done;
    haptic();
    // Al completar: dibujar el tilde, tachar y deslizar afuera antes de reordenar.
    if (willDone && rowEl && !reducedMotion()) {
      rowEl.classList.add('completing');
      setTimeout(() => rowEl.classList.add('slideout'), 330);
      setTimeout(() => {
        t.done = true; delete state.notified[id];
        save(); render(); toast('✓ Completada');
      }, 630);
      return;
    }
    t.done = willDone; if (t.done) delete state.notified[id];
    save(); render(); toast(t.done ? '✓ Completada' : 'Reactivada');
  }
  function delTask(id) {
    state.tasks = state.tasks.filter(x => x.id !== id); delete state.notified[id];
    save(); render(); toast('Tarea eliminada');
  }
  // Posponer: mover la fecha al día siguiente (si no tenía, la agenda para mañana).
  function snoozeTask(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const base = t.date ? new Date(t.date + 'T00:00') : new Date();
    base.setDate(base.getDate() + 1);
    t.date = ymd(base); delete state.notified[id];
    haptic(); save(); render(); toast('→ Pospuesta a mañana');
  }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  }
  function toggleSub(id, sid) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const s = (t.subtasks || []).find(x => x.id === sid); if (!s) return;
    s.done = !s.done; save(); render();
  }
  function shopItem(listId, itemId, action) {
    const list = state.lists.find(l => l.id === listId); if (!list) return;
    if (action === 'toggle') { const it = list.items.find(i => i.id === itemId); if (it) it.done = !it.done; }
    else list.items = list.items.filter(i => i.id !== itemId);
    save(); renderCompras();
  }
  function delList(id) {
    const list = state.lists.find(l => l.id === id);
    if (list && !confirm(`¿Eliminar la lista "${list.name}"?`)) return;
    state.lists = state.lists.filter(l => l.id !== id); save(); renderCompras();
  }

  // ---------- Sheet ----------
  const overlay = $('#sheetOverlay'), form = $('#taskForm');

  function openSheet(id = null, presetDate = null) {
    editingId = id;
    if (view === 'compras' && !id) { openListSheet(); return; }
    $('.task-only').style.display = '';
    const t = id ? state.tasks.find(x => x.id === id) : null;
    $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
    $('#fTitle').value = t ? t.title : '';
    $('#fDate').value = t ? (t.date || '') : (presetDate || '');
    $('#fTime').value = t ? (t.time || '') : '';
    $('#fTags').value = t ? (t.tags || []).map(x => '#' + x).join(' ') : '';
    $('#fRemind').value = t ? String(t.remind ?? 60) : '60';
    setPrio(t ? (t.priority || 0) : 0);
    const cat = t ? (t.cat || 'General') : 'General';
    $$('.cchip').forEach(c => c.classList.toggle('on', c.dataset.cat === cat));
    draftSubs = t ? (t.subtasks || []).map(s => ({ ...s })) : [];
    renderDraftSubs();
    $('#parseHint').textContent = '';
    $('#sheetDelete').hidden = !id;
    showSheet(); setTimeout(() => $('#fTitle').focus(), 250);
  }
  function openListSheet() {
    $('.task-only').style.display = 'none';
    $('#sheetTitle').textContent = 'Nueva lista de compras';
    $('#fTitle').value = ''; $('#fTitle').placeholder = 'Ej: Supermercado';
    $('#sheetDelete').hidden = true;
    editingId = '__list__'; showSheet(); setTimeout(() => $('#fTitle').focus(), 250);
  }
  function setPrio(p) { $$('.pchip').forEach(c => c.classList.toggle('on', +c.dataset.p === p)); }
  function getPrio() { const el = $('.pchip.on'); return el ? +el.dataset.p : 0; }
  function renderDraftSubs() {
    $('#subsEditor').innerHTML = draftSubs.map((s, i) =>
      `<div class="se-row"><span>${esc(s.text)}</span><button type="button" data-i="${i}" aria-label="Quitar">&times;</button></div>`).join('');
  }
  $('#subsEditor').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    draftSubs.splice(+b.dataset.i, 1); renderDraftSubs();
  });
  function addDraftSub() {
    const inp = $('#subInput'); const v = inp.value.trim(); if (!v) return;
    draftSubs.push({ id: uid(), text: v, done: false }); inp.value = ''; renderDraftSubs(); inp.focus();
  }
  $('#subAddBtn').addEventListener('click', addDraftSub);
  $('#subInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDraftSub(); } });

  function showSheet() { overlay.hidden = false; }
  function hideSheet() { overlay.hidden = true; $('#fTitle').placeholder = 'Ej: mañana 15:00 pedir turno #salud'; editingId = null; draftSubs = []; }

  // Vista previa de escritura natural
  $('#fTitle').addEventListener('input', () => {
    if (editingId === '__list__') return;
    const p = parseQuick($('#fTitle').value);
    const bits = [];
    if (p.date) bits.push('📅 ' + p.date);
    if (p.time) bits.push('🕑 ' + p.time);
    if (p.priority) bits.push('⚑ ' + PRIO_LABEL[p.priority]);
    if (p.tags.length) bits.push(p.tags.map(t => '#' + t).join(' '));
    $('#parseHint').textContent = bits.length ? 'Detecté: ' + bits.join(' · ') : '';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#fTitle').value.trim(); if (!raw) return;

    if (editingId === '__list__') {
      state.lists.unshift({ id: uid(), name: raw, items: [] });
      save(); hideSheet(); renderCompras(); toast('Lista creada'); return;
    }

    const p = parseQuick(raw);
    const title = p.title || raw;
    // Etiquetas: del campo + las parseadas del texto
    const fieldTags = $('#fTags').value.split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean);
    const tags = [...new Set([...fieldTags, ...p.tags])];
    const data = {
      title,
      date: $('#fDate').value || p.date || null,
      time: $('#fTime').value || p.time || null,
      priority: (p.priority != null ? p.priority : getPrio()),
      cat: ($('.cchip.on') || {}).dataset?.cat || 'General',
      tags,
      subtasks: draftSubs,
      remind: Number($('#fRemind').value),
    };
    if (editingId) { const t = state.tasks.find(x => x.id === editingId); Object.assign(t, data); delete state.notified[t.id]; }
    else state.tasks.push({ id: uid(), done: false, ...data });
    save(); hideSheet();
    if (view === 'mes' && data.date) selectedDay = data.date;
    render(); toast(editingId ? 'Tarea actualizada' : 'Tarea agregada'); maybeAskNotify();
  });

  $$('.pchip').forEach(c => c.addEventListener('click', () => setPrio(+c.dataset.p)));
  $$('.cchip').forEach(c => c.addEventListener('click', () => { $$('.cchip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }));
  $('#sheetCancel').addEventListener('click', hideSheet);
  $('#sheetDelete').addEventListener('click', () => {
    if (!editingId || editingId === '__list__') return;
    const t = state.tasks.find(x => x.id === editingId);
    if (t && !confirm(`¿Eliminar "${t.title}"?`)) return;
    const id = editingId; hideSheet(); delTask(id);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideSheet(); });

  // ---------- Nav / search ----------
  $$('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
    view = btn.dataset.view; closeSearch(false);
    if (view === 'mes' && !selectedDay) selectedDay = ymd(new Date());
    render();
  }));
  $('#fab').addEventListener('click', () => openSheet());

  const searchbar = $('#searchbar'), searchInput = $('#searchInput');
  function openSearch(preset = '') {
    searchbar.hidden = false; $('#searchBtn').classList.add('active');
    searchInput.value = preset; query = preset; render();
    if (!preset) setTimeout(() => searchInput.focus(), 50);
  }
  function closeSearch(rerender = true) {
    searchbar.hidden = true; $('#searchBtn').classList.remove('active');
    searchInput.value = ''; query = ''; if (rerender) render();
  }
  $('#searchBtn').addEventListener('click', () => searchbar.hidden ? openSearch() : closeSearch());
  $('#searchClear').addEventListener('click', () => closeSearch());
  searchInput.addEventListener('input', () => { query = searchInput.value.trim(); render(); });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2200); }

  // ============================================================
  //  Notificaciones + integración nativa (Capacitor / APK)
  // ============================================================
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const LocalNotifications = () => Cap?.Plugins?.LocalNotifications;
  const Preferences = () => Cap?.Plugins?.Preferences;
  const WidgetBridge = (isNative && Cap.registerPlugin) ? Cap.registerPlugin('WidgetBridge') : null;
  const Haptics = () => Cap?.Plugins?.Haptics;

  // Vibración corta al completar / posponer. Nativo: plugin Haptics; web: vibrate.
  function haptic() {
    try {
      if (isNative && Haptics()) Haptics().impact({ style: 'LIGHT' });
      else if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) { /* ignore */ }
  }

  function reminderTime(t) {
    const dt = taskDate(t); if (!dt) return null;
    return dt.getTime() - (t.remind ?? 60) * 60000;
  }

  // --- Nativo: programa TODAS las notificaciones futuras en el sistema.
  // Disparan aunque la app esté cerrada (AlarmManager). ---
  async function scheduleNative() {
    if (!isNative || !LocalNotifications()) return;
    const LN = LocalNotifications();
    try {
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') { const r = await LN.requestPermissions(); if (r.display !== 'granted') return; }
      // limpiar programadas anteriores
      const pending = await LN.getPending();
      if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      const now = Date.now();
      const toSchedule = [];
      state.tasks.filter(t => !t.done && t.date).forEach(t => {
        const at = reminderTime(t);
        if (at == null || at < now + 5000) return;
        toSchedule.push({
          id: hashId(t.id),
          title: '⏰ ' + t.title,
          body: (t.time ? `Vence hoy ${t.time}` : 'Vence hoy') + (t.cat && t.cat !== 'General' ? ` · ${t.cat}` : ''),
          schedule: { at: new Date(at), allowWhileIdle: true },
          smallIcon: 'ic_stat_icon',
        });
      });
      if (toSchedule.length) await LN.schedule({ notifications: toSchedule });
    } catch (e) { /* silencioso */ }
  }
  function hashId(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2000000000 || 1; }

  // --- Widget: espeja los pendientes de hoy en Preferences (SharedPreferences)
  //     para que el widget nativo los lea. ---
  async function syncWidget() {
    if (!isNative || !Preferences()) return;
    const todayStr = ymd(new Date());
    const now = new Date();
    const items = state.tasks
      .filter(t => !t.done && (t.date === todayStr || (taskDate(t) && taskDate(t) < now)))
      .sort(byPrioDate)
      .slice(0, 10)
      .map(t => ({ id: t.id, title: t.title, time: t.time || '', priority: t.priority || 0 }));
    try {
      await Preferences().set({ key: 'widget_tasks', value: JSON.stringify(items) });
      await Preferences().set({ key: 'widget_updated', value: String(Date.now()) });
      if (WidgetBridge?.refresh) WidgetBridge.refresh().catch(() => {});
    } catch (e) { /* silencioso */ }
  }
  // Al volver a la app, aplicar cambios hechos desde el widget (marcar hecho).
  async function pullWidgetChanges() {
    if (!isNative || !Preferences()) return;
    try {
      const { value } = await Preferences().get({ key: 'widget_toggle' });
      if (value) {
        const t = state.tasks.find(x => x.id === value);
        if (t) { t.done = true; }
        await Preferences().remove({ key: 'widget_toggle' });
        save(); render();
      }
    } catch (e) { /* silencioso */ }
  }

  // --- Web fallback: notificaciones mientras la pestaña vive ---
  function checkWebReminders() {
    if (isNative) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    state.tasks.forEach(t => {
      if (t.done || !t.date) return;
      const dt = taskDate(t); const at = reminderTime(t);
      if (now >= at && now <= dt.getTime() + 120000 && state.notified[t.id] !== 'pre') {
        const mins = Math.round((dt.getTime() - now) / 60000);
        const detail = mins > 1 ? `Vence en ${mins} min` : (mins >= 0 ? 'Vence ahora' : 'Está por vencer');
        webNotify('⏰ ' + t.title, `${detail} · ${t.cat || 'Tarea'}`, 'task-' + t.id);
        state.notified[t.id] = 'pre'; localStorage.setItem(STORE_KEY, JSON.stringify(state));
      }
    });
  }
  function webNotify(title, body, tag) {
    try {
      if (navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, tag, icon: 'icons/icon-192.png' }));
      else new Notification(title, { body, tag });
    } catch (e) { /* ignore */ }
  }

  const notifBtn = $('#notifBtn');
  function updateNotifBtn() {
    if (isNative) { notifBtn.classList.add('active'); return; }
    notifBtn.classList.toggle('active', 'Notification' in window && Notification.permission === 'granted');
  }
  async function requestNotify() {
    if (isNative) { await scheduleNative(); toast('🔔 Avisos activados'); updateNotifBtn(); return true; }
    if (!('Notification' in window)) { toast('Tu navegador no soporta avisos'); return false; }
    if (Notification.permission === 'denied') { toast('Los avisos están bloqueados'); return false; }
    const res = await Notification.requestPermission(); updateNotifBtn();
    if (res === 'granted') { toast('🔔 Avisos activados'); checkWebReminders(); return true; }
    return false;
  }
  notifBtn.addEventListener('click', requestNotify);
  function maybeAskNotify() {
    if (isNative) { scheduleNative(); return; }
    if ('Notification' in window && Notification.permission === 'default' && !sessionStorage.getItem('askedNotify')) {
      sessionStorage.setItem('askedNotify', '1'); setTimeout(requestNotify, 600);
    }
  }
  setInterval(checkWebReminders, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pullWidgetChanges(); checkWebReminders(); render(); } });
  if (isNative && Cap.Plugins?.App) Cap.Plugins.App.addListener?.('resume', () => { pullWidgetChanges(); render(); });

  // ---------- Install (PWA fallback) ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

  // ============================================================
  //  Gestos: swipe (completar / posponer / eliminar) y drag al día
  // ============================================================

  // --- Swipe en filas de tareas (Hoy / Semana / búsqueda) ---
  (function swipe() {
    const OPEN = -140;           // px que se abre para revelar acciones
    let row = null, surf = null, id = null, x0 = 0, y0 = 0, dx = 0, mode = null, tx0 = 0, consumed = false;
    let openRow = null;

    function reset() {
      if (openRow) {
        const s = openRow.querySelector('.row-surface');
        if (s) s.style.transform = '';
        openRow.classList.remove('show-done'); openRow = null;
      }
    }
    closeSwipe = reset;

    content.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = e.target.closest('.row[data-id]');
      if (!r || r.closest('#dayDetail')) { return; }        // en el calendario manda el drag
      if (e.target.closest('.swipe-actions')) return;        // dejar que el botón haga lo suyo
      if (openRow && openRow !== r) reset();
      row = r; surf = r.querySelector('.row-surface'); id = r.dataset.id;
      x0 = e.clientX; y0 = e.clientY;
      dx = 0; mode = null; tx0 = (openRow === r) ? OPEN : 0;
    });

    content.addEventListener('pointermove', (e) => {
      if (!row || !surf) return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (mode === null) {
        if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
        mode = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
        if (mode === 'h') surf.classList.add('swiping');
      }
      if (mode !== 'h') { row = null; surf = null; return; }
      e.preventDefault();
      let t = tx0 + ddx;
      if (t > 0) { t = Math.min(t, 120); row.classList.add('show-done'); }
      else { t = Math.max(t, OPEN - 30); row.classList.remove('show-done'); }
      dx = t; surf.style.transform = `translateX(${t}px)`;
    });

    function finish() {
      if (!row || !surf) { row = null; surf = null; return; }
      const r = row, s = surf, theId = id; row = null; surf = null;
      s.classList.remove('swiping');
      if (mode !== 'h') return;                     // fue un tap: lo maneja el click
      consumed = true;
      if (dx > 80) {                                // → completar
        s.style.transform = ''; r.classList.remove('show-done');
        if (openRow === r) openRow = null;
        toggleTask(theId, r);
      } else if (dx < -70) {                        // ← revelar acciones
        s.style.transform = `translateX(${OPEN}px)`; openRow = r;
      } else {                                      // no alcanzó: volver
        s.style.transform = ''; r.classList.remove('show-done');
        if (openRow === r) openRow = null;
      }
    }
    content.addEventListener('pointerup', finish);
    content.addEventListener('pointercancel', () => {
      if (surf) surf.classList.remove('swiping');
      if (surf) surf.style.transform = (openRow === row) ? `translateX(${OPEN}px)` : '';
      row = null; surf = null;
    });

    // Un tap fuera cierra las acciones abiertas.
    document.addEventListener('pointerdown', (e) => {
      if (openRow && !e.target.closest('.row[data-id]')) reset();
    });
    // Evita que el click posterior a un swipe dispare toggle/edit.
    content.addEventListener('click', (e) => {
      if (consumed) { e.stopPropagation(); e.preventDefault(); consumed = false; }
    }, true);
  })();

  // --- Drag de una tarea a otro día (vista Mes, sobre el detalle del día) ---
  (function dragToDay() {
    let src = null, id = null, ghost = null, timer = null, active = false, sx = 0, sy = 0;

    content.addEventListener('pointerdown', (e) => {
      if (view !== 'mes') return;
      const r = e.target.closest('#dayDetail .row[data-id]');
      if (!r || e.target.closest('.swipe-actions')) return;
      src = r; id = r.dataset.id; sx = e.clientX; sy = e.clientY; active = false;
      timer = setTimeout(() => startDrag(), 320);            // long-press
    });
    function startDrag() {
      if (!src) return;
      active = true; haptic(); src.classList.add('dragging');
      const t = state.tasks.find(x => x.id === id);
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost'; ghost.textContent = t ? t.title : '';
      document.body.appendChild(ghost); moveGhost(sx, sy);
    }
    function moveGhost(x, y) { if (ghost) { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y - 12) + 'px'; } }
    function cellUnder(x, y) { const el = document.elementFromPoint(x, y); return el ? el.closest('.cell[data-day]') : null; }

    content.addEventListener('pointermove', (e) => {
      if (!src) return;
      if (!active) {
        if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { clearTimeout(timer); src = null; }
        return;
      }
      e.preventDefault(); moveGhost(e.clientX, e.clientY);
      const cell = cellUnder(e.clientX, e.clientY);
      document.querySelectorAll('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
      if (cell) cell.classList.add('drop-target');
    });
    function end(e) {
      clearTimeout(timer);
      const wasActive = active;
      if (active) {
        const cell = cellUnder(e.clientX, e.clientY);
        if (cell) {
          const t = state.tasks.find(x => x.id === id);
          if (t && t.date !== cell.dataset.day) {
            t.date = cell.dataset.day; delete state.notified[id];
            selectedDay = cell.dataset.day; haptic(); save();
            toast('Movida al ' + cell.dataset.day.slice(8) + '/' + cell.dataset.day.slice(5, 7));
          }
        }
      }
      cleanup(wasActive);
    }
    function cleanup(rerender) {
      if (ghost) { ghost.remove(); ghost = null; }
      document.querySelectorAll('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
      if (src) src.classList.remove('dragging');
      src = null; active = false;
      if (rerender) renderMes();
    }
    content.addEventListener('pointerup', end);
    content.addEventListener('pointercancel', () => { clearTimeout(timer); cleanup(false); });
  })();

  // ---------- Seed ----------
  function seed() {
    if (localStorage.getItem(STORE_KEY) || localStorage.getItem('pendientes.v1')) return;
    const today = new Date();
    const mk = (off, time, title, cat, priority, tags = [], subtasks = []) => {
      const d = new Date(today); d.setDate(d.getDate() + off);
      return { id: uid(), title, cat, priority, tags, subtasks, date: ymd(d), time, done: false, remind: 60 };
    };
    state.tasks = [
      mk(0, '18:00', 'Pedir turno médico', 'Salud', 3, ['salud'], [
        { id: uid(), text: 'Buscar cobertura', done: false },
        { id: uid(), text: 'Llamar a la clínica', done: false },
        { id: uid(), text: 'Confirmar horario', done: false },
      ]),
      mk(0, null, 'Comprar regalo de mamá', 'General', 2, ['casa']),
      mk(1, '10:00', 'Llamar al dentista', 'Salud', 1, ['salud']),
      mk(3, null, 'Entregar informe mensual', 'Trabajo', 2, ['trabajo']),
      { id: uid(), title: 'Pagar factura de luz', cat: 'Trámites', priority: 0, tags: [], subtasks: [], date: ymd(today), time: null, done: true, remind: 60 },
    ];
    state.lists = [{ id: uid(), name: 'Supermercado', items: [
      { id: uid(), text: 'Leche', done: false }, { id: uid(), text: 'Pan', done: false }, { id: uid(), text: 'Café', done: true },
    ] }];
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  // ---------- Init ----------
  seed();
  updateNotifBtn();
  render();
  scheduleNative();
  syncWidget();
  pullWidgetChanges();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
