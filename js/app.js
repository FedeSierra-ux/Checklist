/* Pendientes — PWA de tareas con vencimientos, mes y listas de compras. */
(() => {
  'use strict';

  const STORE_KEY = 'pendientes.v1';
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ---------- State ----------
  let state = load();
  let view = 'semana';
  let calMonth = new Date();
  calMonth.setDate(1);
  let selectedDay = null; // 'YYYY-MM-DD'
  let editingId = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { tasks: [], lists: [], notified: {} };
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
    // Semana lunes → domingo
    const d = startOfDay(base);
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  function humanDue(t) {
    const dt = taskDate(t);
    if (!dt) return null;
    const now = new Date();
    const today = startOfDay(now);
    const day = startOfDay(dt);
    const diffDays = Math.round((day - today) / 86400000);
    const hasTime = !!t.time;
    const hora = hasTime ? ` ${t.time}` : '';
    let label, cls;
    if (dt < now && !t.done) { label = 'Vencida' + (hasTime ? ` · ${t.time}` : ''); cls = 'due'; }
    else if (diffDays < 0) { label = 'Venció'; cls = 'due'; }
    else if (diffDays === 0) { label = 'Vence hoy' + hora; cls = 'today'; }
    else if (diffDays === 1) { label = 'Mañana' + hora; cls = 'today'; }
    else if (diffDays <= 6) { label = DIAS[dt.getDay()].slice(0, 3) + hora; cls = 'soon'; }
    else { label = `${dt.getDate()} ${MESES[dt.getMonth()].slice(0, 3)}` + hora; cls = 'soon'; }
    return { label, cls };
  }

  // ---------- Rendering ----------
  const content = $('#content');

  function render() {
    updateTop();
    if (view === 'semana') renderSemana();
    else if (view === 'mes') renderMes();
    else renderCompras();
    checkReminders();
  }

  function updateTop() {
    const now = new Date();
    $('#topDay').textContent = `${DIAS[now.getDay()]} · ${now.getDate()} ${MESES[now.getMonth()].slice(0, 3)}`;
    const titles = { semana: 'Esta semana', mes: 'Este mes', compras: 'Compras' };
    $('#topTitle').textContent = titles[view];
    $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $$('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('#progressWrap').classList.toggle('hide', view === 'compras');
    $('#fab').style.display = view === 'mes' ? 'none' : 'flex';
  }

  function taskCardHTML(t) {
    const due = humanDue(t);
    const chips = [];
    if (due) chips.push(`<span class="chip ${due.cls}"><span class="dot"></span>${due.label}</span>`);
    if (t.done) chips.push('<span class="chip ok">Hecho</span>');
    if (t.cat && t.cat !== 'General') chips.push(`<span class="chip cat">${esc(t.cat)}</span>`);
    return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
        <button class="check ${t.done ? 'done' : ''}" data-act="toggle" aria-label="Marcar"></button>
        <div class="body" data-act="edit">
          <div class="t">${esc(t.title)}</div>
          ${chips.length ? `<div class="meta">${chips.join('')}</div>` : ''}
        </div>
        <button class="del" data-act="del" aria-label="Eliminar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </div>`;
  }

  function renderSemana() {
    const { start, end } = weekRange();
    const now = new Date();
    const tasks = state.tasks.slice();

    // Buckets: Vencidas, Hoy, Mañana, Resto de la semana, Sin fecha, Hechas
    const buckets = {
      vencidas: [], hoy: [], manana: [], semana: [], sinfecha: [], hechas: []
    };
    const today = startOfDay(now);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    tasks.forEach(t => {
      if (t.done) { buckets.hechas.push(t); return; }
      const dt = taskDate(t);
      if (!dt) { buckets.sinfecha.push(t); return; }
      if (dt < now) { buckets.vencidas.push(t); return; }
      const day = startOfDay(dt);
      if (+day === +today) buckets.hoy.push(t);
      else if (+day === +tomorrow) buckets.manana.push(t);
      else if (dt >= start && dt <= end) buckets.semana.push(t);
      else buckets.semana.push(t); // futuras también, ordenadas por fecha
    });

    const byDate = (a, b) => (taskDate(a) || 0) - (taskDate(b) || 0);
    Object.values(buckets).forEach(arr => arr.sort(byDate));

    // Progreso: tareas de la semana (con y sin fecha) marcadas hoy
    const total = tasks.filter(t => !t.done).length + buckets.hechas.length;
    const doneCount = buckets.hechas.length;
    updateProgress(doneCount, total);

    const sections = [
      ['Vencidas', buckets.vencidas],
      ['Hoy', buckets.hoy],
      ['Mañana', buckets.manana],
      ['Próximas', buckets.semana],
      ['Sin fecha', buckets.sinfecha],
      ['Completadas', buckets.hechas],
    ];

    let html = '';
    let any = false;
    for (const [label, arr] of sections) {
      if (!arr.length) continue;
      any = true;
      html += `<div class="group-label">${label}<span class="count">${arr.length}</span></div>`;
      html += arr.map(taskCardHTML).join('');
    }
    content.innerHTML = any ? html : emptyHTML('semana');
  }

  function renderMes() {
    updateProgress(0, 0);
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7; // lunes=0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = ymd(new Date());

    // Mapear tareas por día
    const map = {};
    state.tasks.forEach(t => {
      if (!t.date) return;
      (map[t.date] = map[t.date] || []).push(t);
    });

    let cells = '';
    for (let i = 0; i < startPad; i++) cells += `<div class="cell out"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
      const dayTasks = map[ds] || [];
      const pending = dayTasks.filter(t => !t.done).length;
      const done = dayTasks.length - pending;
      let pips = '';
      if (dayTasks.length) {
        pips = '<div class="pips">';
        if (pending) pips += '<i></i>';
        if (done) pips += '<i class="done"></i>';
        pips += '</div>';
      }
      const cls = ['cell', 'cur'];
      if (ds === todayStr) cls.push('today');
      if (ds === selectedDay) cls.push('sel');
      cells += `<div class="${cls.join(' ')}" data-day="${ds}">${d}${pips}</div>`;
    }

    const html = `<div class="cal">
        <div class="cal-head">
          <h3>${MESES[m]} ${y}</h3>
          <div class="cal-nav">
            <button data-cal="prev" aria-label="Mes anterior">‹</button>
            <button data-cal="today" aria-label="Hoy">•</button>
            <button data-cal="next" aria-label="Mes siguiente">›</button>
          </div>
        </div>
        <div class="m-head"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div class="m-grid">${cells}</div>
      </div>
      <div id="dayDetail"></div>`;
    content.innerHTML = html;
    renderDayDetail();
  }

  function renderDayDetail() {
    const box = $('#dayDetail');
    if (!box) return;
    if (!selectedDay) {
      box.innerHTML = `<div class="empty" style="padding:32px 20px">
        <p>Tocá un día para ver o agregar sus tareas.</p></div>`;
      return;
    }
    const [y, mo, d] = selectedDay.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    const tasks = state.tasks.filter(t => t.date === selectedDay).sort((a, b) => (taskDate(a) || 0) - (taskDate(b) || 0));
    const header = `<div class="group-label">${DIAS[dt.getDay()]} ${d} de ${MESES[mo - 1]}
      <span class="count">${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'}</span></div>`;
    const body = tasks.length
      ? tasks.map(taskCardHTML).join('')
      : `<div class="empty" style="padding:24px 20px"><p>Nada agendado.</p></div>`;
    const addBtn = `<button class="btn primary" id="addForDay" style="margin-top:10px">+ Agregar tarea para este día</button>`;
    box.innerHTML = header + body + addBtn;
  }

  function renderCompras() {
    updateProgress(0, 0);
    if (!state.lists.length) {
      content.innerHTML = emptyHTML('compras');
      return;
    }
    let html = '';
    state.lists.forEach(list => {
      const done = list.items.filter(i => i.done).length;
      const items = list.items.map(it => `
        <div class="shop-item ${it.done ? 'done' : ''}" data-list="${list.id}" data-item="${it.id}">
          <button class="check ${it.done ? 'done' : ''}" data-act="shop-toggle" aria-label="Marcar"></button>
          <span>${esc(it.text)}</span>
          <button class="rm" data-act="shop-del" aria-label="Quitar">&times;</button>
        </div>`).join('');
      html += `<div class="shop-list" data-list="${list.id}">
          <div class="shop-head">
            <h3>${esc(list.name)}</h3>
            <span class="badge">${done}/${list.items.length}</span>
            <button class="del-list" data-act="list-del" aria-label="Eliminar lista">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
          ${items}
          <form class="shop-add" data-list="${list.id}">
            <input type="text" placeholder="Agregar ítem…" autocomplete="off" aria-label="Nuevo ítem">
            <button type="submit" aria-label="Agregar ítem">+</button>
          </form>
        </div>`;
    });
    content.innerHTML = html;
  }

  function emptyHTML(v) {
    const map = {
      semana: ['Todo en orden', 'No tenés tareas pendientes. Tocá el + para agregar una.'],
      compras: ['Sin listas', 'Creá tu primera lista de compras con el botón +.'],
    };
    const [title, desc] = map[v];
    return `<div class="empty">
      <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <b>${title}</b><p>${desc}</p></div>`;
  }

  function updateProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressPct').textContent = `${done}/${total}`;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Events: content delegation ----------
  content.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    // Calendar nav
    const calBtn = e.target.closest('[data-cal]');
    if (calBtn) {
      const dir = calBtn.dataset.cal;
      if (dir === 'prev') calMonth.setMonth(calMonth.getMonth() - 1);
      else if (dir === 'next') calMonth.setMonth(calMonth.getMonth() + 1);
      else { calMonth = new Date(); calMonth.setDate(1); selectedDay = ymd(new Date()); }
      renderMes();
      return;
    }
    const cell = e.target.closest('.cell[data-day]');
    if (cell) {
      selectedDay = selectedDay === cell.dataset.day ? null : cell.dataset.day;
      renderMes();
      return;
    }
    if (e.target.id === 'addForDay') { openSheet(null, selectedDay); return; }

    if (!actEl) return;
    const act = actEl.dataset.act;

    if (act === 'toggle' || act === 'edit' || act === 'del') {
      const card = actEl.closest('.task');
      const id = card.dataset.id;
      if (act === 'toggle') toggleTask(id);
      else if (act === 'edit') openSheet(id);
      else if (act === 'del') delTask(id);
      return;
    }
    if (act === 'shop-toggle' || act === 'shop-del') {
      const row = actEl.closest('.shop-item');
      shopItemAction(row.dataset.list, row.dataset.item, act === 'shop-toggle' ? 'toggle' : 'del');
      return;
    }
    if (act === 'list-del') {
      const listId = actEl.closest('.shop-list').dataset.list;
      delList(listId);
      return;
    }
  });

  // Shopping add-item forms
  content.addEventListener('submit', (e) => {
    const form = e.target.closest('.shop-add');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const list = state.lists.find(l => l.id === form.dataset.list);
    if (list) { list.items.push({ id: uid(), text, done: false }); save(); renderCompras(); }
  });

  // ---------- Task actions ----------
  function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    if (t.done) delete state.notified[id];
    save();
    render();
    toast(t.done ? '✓ Tarea completada' : 'Reactivada');
  }
  function delTask(id) {
    state.tasks = state.tasks.filter(x => x.id !== id);
    delete state.notified[id];
    save();
    render();
    toast('Tarea eliminada');
  }

  // ---------- Shopping actions ----------
  function shopItemAction(listId, itemId, action) {
    const list = state.lists.find(l => l.id === listId);
    if (!list) return;
    if (action === 'toggle') {
      const it = list.items.find(i => i.id === itemId);
      if (it) it.done = !it.done;
    } else {
      list.items = list.items.filter(i => i.id !== itemId);
    }
    save();
    renderCompras();
  }
  function delList(id) {
    const list = state.lists.find(l => l.id === id);
    if (list && !confirm(`¿Eliminar la lista "${list.name}"?`)) return;
    state.lists = state.lists.filter(l => l.id !== id);
    save();
    renderCompras();
  }

  // ---------- Sheet (create/edit) ----------
  const overlay = $('#sheetOverlay');
  const form = $('#taskForm');

  function openSheet(id = null, presetDate = null) {
    editingId = id;
    if (view === 'compras') { openListSheet(); return; }
    // Task sheet
    $('#taskFields').style.display = '';
    $('#catField').style.display = '';
    $('#remindField').style.display = '';
    let t = id ? state.tasks.find(x => x.id === id) : null;
    $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
    $('#fTitle').value = t ? t.title : '';
    $('#fDate').value = t ? (t.date || '') : (presetDate || '');
    $('#fTime').value = t ? (t.time || '') : '';
    $('#fRemind').value = t ? String(t.remind ?? 60) : '60';
    const cat = t ? (t.cat || 'General') : 'General';
    $$('.cchip').forEach(c => c.classList.toggle('on', c.dataset.cat === cat));
    showSheet();
    setTimeout(() => $('#fTitle').focus(), 250);
  }

  function openListSheet() {
    $('#taskFields').style.display = 'none';
    $('#catField').style.display = 'none';
    $('#remindField').style.display = 'none';
    $('#sheetTitle').textContent = 'Nueva lista de compras';
    $('#fTitle').value = '';
    $('#fTitle').placeholder = 'Ej: Supermercado';
    editingId = '__list__';
    showSheet();
    setTimeout(() => $('#fTitle').focus(), 250);
  }

  function showSheet() { overlay.hidden = false; }
  function hideSheet() {
    overlay.hidden = true;
    $('#fTitle').placeholder = 'Ej: Pedir turno médico';
    editingId = null;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#fTitle').value.trim();
    if (!title) return;

    if (editingId === '__list__') {
      state.lists.unshift({ id: uid(), name: title, items: [] });
      save(); hideSheet(); renderCompras(); toast('Lista creada');
      return;
    }

    const cat = ($('.cchip.on') || {}).dataset?.cat || 'General';
    const data = {
      title,
      date: $('#fDate').value || null,
      time: $('#fTime').value || null,
      cat,
      remind: Number($('#fRemind').value),
    };

    if (editingId) {
      const t = state.tasks.find(x => x.id === editingId);
      Object.assign(t, data);
      delete state.notified[t.id]; // reprogramar aviso
    } else {
      state.tasks.push({ id: uid(), done: false, ...data });
    }
    save(); hideSheet();
    // Si estamos en mes, mantener día seleccionado
    if (view === 'mes' && data.date) selectedDay = data.date;
    render();
    toast(editingId ? 'Tarea actualizada' : 'Tarea agregada');
    maybeAskNotify();
  });

  $$('.cchip').forEach(c => c.addEventListener('click', () => {
    $$('.cchip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
  }));

  $('#sheetCancel').addEventListener('click', hideSheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideSheet(); });

  // ---------- Tabs / nav ----------
  $$('.tab, .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      if (view === 'mes' && !selectedDay) selectedDay = ymd(new Date());
      render();
    });
  });

  $('#fab').addEventListener('click', () => openSheet());

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------- Notifications ----------
  const notifBtn = $('#notifBtn');

  function updateNotifBtn() {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    notifBtn.classList.toggle('active', granted);
  }

  async function requestNotify() {
    if (!('Notification' in window)) { toast('Tu navegador no soporta avisos'); return false; }
    if (Notification.permission === 'granted') { updateNotifBtn(); return true; }
    if (Notification.permission === 'denied') { toast('Los avisos están bloqueados en el navegador'); return false; }
    const res = await Notification.requestPermission();
    updateNotifBtn();
    if (res === 'granted') { toast('🔔 Avisos activados'); checkReminders(); return true; }
    return false;
  }

  notifBtn.addEventListener('click', requestNotify);

  function maybeAskNotify() {
    if ('Notification' in window && Notification.permission === 'default') {
      if (!sessionStorage.getItem('askedNotify')) {
        sessionStorage.setItem('askedNotify', '1');
        setTimeout(requestNotify, 600);
      }
    }
  }

  function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
        });
      } else {
        new Notification(title, { body, tag });
      }
    } catch (e) { /* ignore */ }
  }

  // Revisa vencimientos y dispara avisos locales (mientras la app está abierta / en background).
  function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    state.tasks.forEach(t => {
      if (t.done) return;
      const dt = taskDate(t);
      if (!dt) return;
      const remindMs = (t.remind ?? 60) * 60000;
      const fireAt = dt.getTime() - remindMs;
      const already = state.notified[t.id];
      // Disparar si estamos dentro de la ventana [fireAt, vencimiento+2min] y no se avisó
      if (now >= fireAt && now <= dt.getTime() + 120000 && already !== 'pre') {
        const when = t.time ? `hoy ${t.time}` : 'hoy';
        const mins = Math.round((dt.getTime() - now) / 60000);
        const detail = mins > 1 ? `Vence en ${mins} min` : (mins >= 0 ? 'Vence ahora' : 'Está por vencer');
        notify(`⏰ ${t.title}`, `${detail} · ${t.cat || 'Tarea'}`, 'task-' + t.id);
        state.notified[t.id] = 'pre';
        save();
      }
    });
  }

  // Resumen al abrir (una vez al día)
  function dailySummary() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const key = 'summary-' + ymd(new Date());
    if (state.notified[key]) return;
    const now = new Date();
    const today = ymd(now);
    const dueToday = state.tasks.filter(t => !t.done && t.date === today).length;
    const overdue = state.tasks.filter(t => { const d = taskDate(t); return !t.done && d && d < now; }).length;
    if (dueToday + overdue > 0) {
      const parts = [];
      if (dueToday) parts.push(`${dueToday} para hoy`);
      if (overdue) parts.push(`${overdue} vencida${overdue > 1 ? 's' : ''}`);
      notify('Pendientes de hoy', parts.join(' · '), 'daily');
      state.notified[key] = 1;
      save();
    }
  }

  // Poll cada 60s mientras la pestaña esté viva
  setInterval(checkReminders, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); render(); } });

  // ---------- Install (PWA) ----------
  let deferredPrompt = null;
  const banner = $('#installBanner');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('installDismissed')) banner.hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) { banner.hidden = true; return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.hidden = true;
  });
  $('#installClose').addEventListener('click', () => {
    banner.hidden = true;
    localStorage.setItem('installDismissed', '1');
  });
  window.addEventListener('appinstalled', () => { banner.hidden = true; toast('¡Instalada! 🎉'); });

  // ---------- Seed de ejemplo (solo primera vez) ----------
  function seedIfEmpty() {
    if (localStorage.getItem(STORE_KEY)) return;
    const today = new Date();
    const t = (offsetDays, time, title, cat) => {
      const d = new Date(today); d.setDate(d.getDate() + offsetDays);
      return { id: uid(), title, cat, date: ymd(d), time, done: false, remind: 60 };
    };
    state.tasks = [
      t(0, '18:00', 'Pedir turno médico', 'Salud'),
      t(1, '10:00', 'Llamar al dentista', 'Salud'),
      t(3, null, 'Entregar informe mensual', 'Trabajo'),
      { id: uid(), title: 'Pagar factura de luz', cat: 'Trámites', date: ymd(today), time: null, done: true, remind: 60 },
    ];
    state.lists = [
      { id: uid(), name: 'Supermercado', items: [
        { id: uid(), text: 'Leche', done: false },
        { id: uid(), text: 'Pan', done: false },
        { id: uid(), text: 'Café', done: true },
      ] },
    ];
    save();
  }

  // ---------- Init ----------
  seedIfEmpty();
  updateNotifBtn();
  render();
  dailySummary();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline opcional */ });
    });
  }
})();
