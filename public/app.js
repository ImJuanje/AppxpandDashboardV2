/* ============================================================
   AppXpand · Plataforma de comerciales
   ------------------------------------------------------------
   Los datos y los accesos viven en el servidor (Netlify Functions +
   Netlify Blobs, ver netlify/functions/api.mjs). Este archivo solo
   pinta la interfaz y habla con /api/*. Los permisos (qué ve cada
   comercial) los impone el servidor, no el navegador.
   ============================================================ */
(() => {
  'use strict';

  const CFG = window.CRM_CONFIG || {};
  const BASE_TITLE = document.title;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Catálogos (los mismos que el formulario de la web) ---------- */
  const STATUSES = [
    { id: 'nuevo',      label: 'Nuevo',      color: '#8d9bb5' },
    { id: 'contactado', label: 'Contactado', color: '#1aa3d6' },
    { id: 'reunion',    label: 'Reunión',    color: '#7c5ce0' },
    { id: 'propuesta',  label: 'Propuesta',  color: '#e59a1f' },
    { id: 'ganado',     label: 'Ganado',     color: '#22a05a' },
    { id: 'perdido',    label: 'Perdido',    color: '#e05252' }
  ];
  const ST = Object.fromEntries(STATUSES.map(s => [s.id, s]));
  const OPEN = ['nuevo', 'contactado', 'reunion', 'propuesta'];
  const TYPES = ['Peluquería o estética', 'Restaurante o bar', 'Tienda', 'Servicios (reformas, talleres, clínicas…)', 'Otro'];
  const SERVICES = ['Página web', 'Optimización de perfil de Google', 'Paquete lanzadera', 'Por definir'];
  const CITIES = ['Albacete', 'Ciudad Real', 'Alicante', 'Otra'];
  const FOLLOW = [
    ['', 'Todos'], ['vencido', 'Vencidos'], ['hoy', 'Para hoy'], ['semana', 'Próximos 7 días'], ['sin', 'Sin fecha']
  ];
  const SORTS = [
    ['updated', 'Última actividad'], ['follow', 'Próximo seguimiento'], ['value', 'Mayor valor'],
    ['name', 'Nombre (A-Z)'], ['created', 'Más recientes']
  ];
  const EMPTY_FILTERS = { q: '', status: '', service: '', type: '', city: '', owner: '', follow: '', sort: 'updated' };

  /* ---------- Estado ---------- */
  const SESSION_KEY = 'appxpand_crm_session_v2';
  const state = {
    token: null,
    user: null,
    users: [],
    data: { clients: [] },
    view: 'resumen',
    cview: 'lista',
    resumenOwner: '',
    editingId: null,
    editingBase: '',
    filters: { ...EMPTY_FILTERS },
    posts: [],
    ranking: null,
    settings: { showRanking: true },
    newsFilter: '',
    newsSeen: '',
    newsMarks: new Set(),
    chat: freshChat()
  };
  const isAdmin = () => !!state.user && state.user.role === 'admin';

  /* ---------- Utilidades ---------- */
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDay = s => s ? parseDay(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
  const fmtDT = iso => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const money = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const userById = id => state.users.find(u => u.id === id);
  const ownerName = id => (userById(id) || {}).name || 'Sin asignar';
  const phoneDigits = p => {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 9) d = '34' + d;
    return d;
  };
  const statusLabel = id => (ST[id] || ST.nuevo).label;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  /* ============================================================
     API
     ============================================================ */
  class ApiError extends Error {
    constructor(status, message, handled = false) { super(message); this.status = status; this.handled = handled; }
  }
  let busy = 0;
  /* quiet = true → no enseña la barra de carga (sondeos en segundo plano) */
  async function api(method, path, body, quiet) {
    if (!quiet) { busy++; document.body.classList.add('busy'); }
    try {
      let res;
      try {
        res = await fetch('/api/' + path, {
          method,
          headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch { throw new ApiError(0, 'Sin conexión con el servidor. Inténtalo de nuevo.'); }

      let data = null;
      try { data = await res.json(); } catch { /* sin cuerpo JSON */ }

      if (!res.ok) {
        if (res.status === 401 && state.token) {
          logout('Tu sesión ha caducado. Vuelve a entrar.');
          throw new ApiError(401, 'Sesión caducada', true);
        }
        const msg = (data && data.error) ||
          (res.status === 404 ? 'La API no está activa. Comprueba que la función de Netlify esté desplegada.' : `Error del servidor (${res.status}).`);
        throw new ApiError(res.status, msg);
      }
      return data;
    } finally {
      if (!quiet && --busy <= 0) { busy = 0; document.body.classList.remove('busy'); }
    }
  }
  const fail = e => { if (!e.handled) toast(e.message || 'Algo ha fallado.'); };

  /* ============================================================
     SESIÓN
     ============================================================ */
  function readSession() {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const s = JSON.parse(store.getItem(SESSION_KEY));
        if (s && s.token && s.exp > Date.now()) return s;
      } catch { /* ignorar */ }
    }
    return null;
  }
  function writeSession(s, remember) {
    clearSession();
    try { (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignorar */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch { /* ignorar */ }
  }

  function showLoginError(msg) {
    const e = $('#loginError');
    e.textContent = msg || ''; e.hidden = !msg;
  }

  async function onLogin(ev) {
    ev.preventDefault();
    const code = $('#code').value.trim();
    if (!code) { showLoginError('Introduce tu código de alta.'); return; }
    const btn = $('#loginForm button[type=submit]');
    btn.disabled = true;
    try {
      const remember = $('#remember').checked;
      const r = await api('POST', 'login', { code, remember });
      writeSession({ token: r.token, exp: r.exp }, remember);
      showLoginError('');
      $('#code').value = '';
      await start(r.token);
    } catch (e) {
      if (!e.handled) showLoginError(e.message);
      $('#code').select();
    } finally { btn.disabled = false; }
  }

  function logout(msg) {
    stopPolling();
    clearSession();
    if ($('#clientDialog').open) $('#clientDialog').close();
    if ($('#newsDialog').open) $('#newsDialog').close();
    state.token = null; state.user = null; state.users = []; state.data = { clients: [] }; state.editingId = null;
    state.posts = []; state.ranking = null; state.newsMarks = new Set();
    clearTimeout(chatTimer); state.chat = freshChat(); document.title = BASE_TITLE;
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    showLoginError(typeof msg === 'string' ? msg : '');
    $('#code').focus();
  }

  /* ============================================================
     ARRANQUE Y DATOS
     ============================================================ */
  function applySync(d) {
    state.user = d.user;
    state.users = d.users || [d.user];
    state.data.clients = d.clients || [];
    state.posts = d.posts || [];
    state.ranking = d.ranking || null;
    state.settings = d.settings || { showRanking: true };
  }

  async function start(token) {
    state.token = token;
    applySync(await api('GET', 'sync'));

    state.view = 'resumen';
    state.cview = 'lista';
    state.resumenOwner = '';
    state.filters = { ...EMPTY_FILTERS };
    state.newsFilter = '';
    state.newsSeen = readSeen();
    state.newsMarks = new Set();
    $('#filters').classList.remove('is-open');
    $('#toggleFilters').setAttribute('aria-expanded', 'false');

    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = isAdmin() ? 'Administrador' : 'Comercial';
    $('#userAvatar').textContent = initials(state.user.name);
    $$('[data-admin]').forEach(el => { el.hidden = !isAdmin(); });
    $('#fOwnerWrap').hidden = !isAdmin();
    $('#resumenOwnerWrap').hidden = !isAdmin();

    buildFilterControls();
    syncUserControls();
    switchView('resumen');
    startPolling();
    state.chat = freshChat();
    pollChat();
  }

  async function refresh(silent) {
    if (!state.token) return;
    try {
      applySync(await api('GET', 'sync', undefined, silent));
      syncUserControls();
      if (!$('#clientDialog').open && !$('#newsDialog').open) renderCurrent();
    } catch (e) { if (!silent) fail(e); }
  }

  let pollTimer;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (!document.hidden && state.user && !busy) refresh(true); }, (CFG.refreshSeconds || 60) * 1000);
  }
  function stopPolling() { clearInterval(pollTimer); }

  const allVisible = () => isAdmin() ? state.data.clients : state.data.clients.filter(c => c.owner === state.user.id);
  const upsertClient = c => {
    const i = state.data.clients.findIndex(x => x.id === c.id);
    if (i >= 0) state.data.clients[i] = c; else state.data.clients.push(c);
  };

  /* ---------- Seguimiento ---------- */
  function followState(c) {
    if (!OPEN.includes(c.status)) return 'cerrado';
    if (!c.next) return 'sin';
    const t = todayStr();
    if (c.next < t) return 'vencido';
    if (c.next === t) return 'hoy';
    if (c.next <= todayStr(7)) return 'semana';
    return 'futuro';
  }
  function followHTML(c) {
    const f = followState(c);
    if (f === 'cerrado' || f === 'sin') return '<span class="muted">—</span>';
    if (f === 'vencido') return `<span class="pill pill--red">Vencido · ${fmtDay(c.next)}</span>`;
    if (f === 'hoy') return '<span class="pill pill--amber">Hoy</span>';
    if (f === 'semana') return `<span class="pill pill--blue">${fmtDay(c.next)}</span>`;
    return `<span>${fmtDay(c.next)}</span>`;
  }

  /* ---------- Estadísticas ---------- */
  function stats(list) {
    const s = { total: list.length, open: 0, won: 0, lost: 0, pipeline: 0, wonValue: 0, overdue: 0, last: '' };
    list.forEach(c => {
      if (OPEN.includes(c.status)) { s.open++; s.pipeline += Number(c.value) || 0; }
      if (c.status === 'ganado') { s.won++; s.wonValue += Number(c.value) || 0; }
      if (c.status === 'perdido') s.lost++;
      if (followState(c) === 'vencido') s.overdue++;
      if (c.updatedAt > s.last) s.last = c.updatedAt;
    });
    s.conv = s.won + s.lost ? Math.round(s.won / (s.won + s.lost) * 100) : null;
    return s;
  }

  /* ============================================================
     NAVEGACIÓN
     ============================================================ */
  function switchView(v) {
    if (v === 'equipo' && !isAdmin()) v = 'resumen';
    state.view = v;
    if (v !== 'news') state.newsMarks = new Set();
    $('#viewResumen').hidden = v !== 'resumen';
    $('#viewClientes').hidden = v !== 'clientes';
    $('#viewNews').hidden = v !== 'news';
    $('#viewChat').hidden = v !== 'chat';
    if (v === 'chat') chatEnter();
    $('#viewEquipo').hidden = v !== 'equipo';
    $$('#tabs button').forEach(b => {
      if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderCurrent();
    scheduleChat();
    window.scrollTo({ top: 0 });
  }
  function renderCurrent() {
    if (!state.user) return;
    if (state.view === 'resumen') renderResumen();
    else if (state.view === 'clientes') renderClientes();
    else if (state.view === 'news') renderNews();
    else if (state.view === 'chat') renderChat();
    else renderEquipo();
    updateNewsBadge();
  }

  /* ============================================================
     RESUMEN
     ============================================================ */
  function renderResumen() {
    $('#resumenTitle').textContent = `Hola, ${state.user.name}`;
    renderNewsBanner();
    let list = allVisible();
    if (isAdmin()) {
      $('#resumenOwner').value = state.resumenOwner;
      if (state.resumenOwner) list = list.filter(c => c.owner === state.resumenOwner);
      $('#resumenSub').textContent = state.resumenOwner ? `Resumen de ${ownerName(state.resumenOwner)}.` : 'Resumen de todo el equipo comercial.';
    } else {
      $('#resumenSub').textContent = 'Este es el estado de tu cartera de clientes.';
    }

    const s = stats(list);
    const kpis = [
      ['Clientes', s.total, ''],
      ['En curso', s.open, ''],
      ['Ganados', s.won, 'kpi--ok'],
      ['Valor en curso', money(s.pipeline), ''],
      ['Conversión', s.conv === null ? '—' : s.conv + ' %', ''],
      ['Seguimientos vencidos', s.overdue, s.overdue ? 'kpi--alert' : '']
    ];
    $('#kpis').innerHTML = kpis.map(([l, v, c]) => `<div class="kpi ${c}"><span>${l}</span><strong>${v}</strong></div>`).join('');

    const max = Math.max(1, ...STATUSES.map(st => list.filter(c => c.status === st.id).length));
    $('#funnel').innerHTML = STATUSES.map(st => {
      const n = list.filter(c => c.status === st.id).length;
      return `<div class="funnel__row"><span>${st.label}</span><div class="funnel__bar"><i style="width:${n / max * 100}%;--c:${st.color}"></i></div><b>${n}</b></div>`;
    }).join('');

    const pending = list
      .filter(c => OPEN.includes(c.status) && c.next && c.next <= todayStr(7))
      .sort((a, b) => a.next.localeCompare(b.next)).slice(0, 6);
    $('#followList').innerHTML = pending.length
      ? pending.map(c => `<button type="button" class="follow-item" data-id="${esc(c.id)}">
          <span><strong>${esc(c.business)}</strong><small>${esc(c.contact || statusLabel(c.status))}${isAdmin() ? ' · ' + esc(ownerName(c.owner)) : ''}</small></span>${followHTML(c)}</button>`).join('')
      : '<p class="empty">No hay seguimientos pendientes esta semana.</p>';
  }

  /* ============================================================
     CLIENTES · filtros
     ============================================================ */
  function fillSelect(sel, items, allLabel) {
    const opts = items.map(i => Array.isArray(i) ? i : [i, i]);
    sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
      opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  }
  function buildFilterControls() {
    fillSelect($('#fStatus'), STATUSES.map(s => [s.id, s.label]), 'Todos');
    fillSelect($('#fService'), SERVICES, 'Todos');
    fillSelect($('#fType'), TYPES, 'Todos');
    fillSelect($('#fCity'), CITIES, 'Todos');
    fillSelect($('#fFollow'), FOLLOW);
    fillSelect($('#fSort'), SORTS);
    syncFilterInputs();
  }
  /* Selectores que dependen de la lista de usuarios (se reconstruyen al refrescar) */
  function syncUserControls() {
    const list = state.users.map(u => [u.id, u.name]);
    const keep = [$('#fOwner').value, $('#resumenOwner').value];
    fillSelect($('#fOwner'), list, 'Todos');
    fillSelect($('#resumenOwner'), list, 'Todo el equipo');
    $('#fOwner').value = state.filters.owner || (list.some(([id]) => id === keep[0]) ? keep[0] : '');
    $('#resumenOwner').value = state.resumenOwner || (list.some(([id]) => id === keep[1]) ? keep[1] : '');
  }
  function syncFilterInputs() {
    const f = state.filters;
    $('#fQ').value = f.q; $('#fStatus').value = f.status; $('#fService').value = f.service; $('#fType').value = f.type;
    $('#fCity').value = f.city; $('#fOwner').value = f.owner; $('#fFollow').value = f.follow; $('#fSort').value = f.sort;
  }
  function readFilterInputs() {
    state.filters = {
      q: $('#fQ').value.trim(), status: $('#fStatus').value, service: $('#fService').value, type: $('#fType').value,
      city: $('#fCity').value, owner: isAdmin() ? $('#fOwner').value : '', follow: $('#fFollow').value, sort: $('#fSort').value
    };
  }
  function activeFilterCount() {
    const f = state.filters;
    return ['q', 'status', 'service', 'type', 'city', 'owner', 'follow'].filter(k => f[k]).length;
  }

  function filteredClients() {
    const f = state.filters;
    const q = norm(f.q);
    const list = allVisible().filter(c => {
      if (f.status && c.status !== f.status) return false;
      if (f.service && c.service !== f.service) return false;
      if (f.type && c.type !== f.type) return false;
      if (f.city && c.city !== f.city) return false;
      if (f.owner && c.owner !== f.owner) return false;
      if (f.follow) {
        const fs = followState(c);
        if (f.follow === 'sin') { if (!(OPEN.includes(c.status) && !c.next)) return false; }
        else if (f.follow === 'semana') { if (!['hoy', 'semana', 'vencido'].includes(fs)) return false; }
        else if (fs !== f.follow) return false;
      }
      if (q) {
        const hay = norm([c.business, c.contact, c.phone, c.email, c.notes, c.city, c.service].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const by = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.business.localeCompare(b.business, 'es'),
      value: (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0),
      follow: (a, b) => (a.next || '9999').localeCompare(b.next || '9999')
    };
    return list.sort(by[f.sort] || by.updated);
  }

  /* ============================================================
     CLIENTES · render
     ============================================================ */
  function renderClientes() {
    const list = filteredClients();
    const total = allVisible().length;
    $('#count').textContent = list.length === total ? `${total} cliente${total === 1 ? '' : 's'}` : `${list.length} de ${total} clientes`;
    const n = activeFilterCount();
    $('#filterBadge').hidden = !n; $('#filterBadge').textContent = n;
    $$('[data-cview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cview === state.cview)));

    const out = $('#clientsOut');
    if (!list.length) {
      out.innerHTML = total
        ? '<div class="card"><p class="empty">Ningún cliente coincide con los filtros.</p></div>'
        : '<div class="card"><p class="empty">Todavía no hay clientes. Pulsa «+ Nuevo cliente» para añadir el primero.</p></div>';
      return;
    }
    out.innerHTML = state.cview === 'lista' ? tableHTML(list) : boardHTML(list);
  }

  function quickActions(c) {
    const a = [];
    if (c.phone) a.push(`<a class="qa" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">Llamar</a>`);
    if (phoneDigits(c.phone)) a.push(`<a class="qa qa--wa" href="https://wa.me/${phoneDigits(c.phone)}" target="_blank" rel="noopener">WhatsApp</a>`);
    if (c.email) a.push(`<a class="qa" href="mailto:${esc(c.email)}">Email</a>`);
    return a.join('');
  }

  function tableHTML(list) {
    const admin = isAdmin();
    const rows = list.map(c => `
      <tr class="row" data-id="${esc(c.id)}" tabindex="0">
        <td class="c-main" data-label="Negocio"><strong>${esc(c.business)}</strong><small>${esc(c.type || '')}${c.city ? ' · ' + esc(c.city) : ''}</small></td>
        <td data-label="Contacto"><span>${esc(c.contact || '—')}<small>${esc(c.phone || c.email || '')}</small></span></td>
        <td data-label="Servicio">${esc(c.service || '—')}</td>
        <td data-label="Estado"><span class="badge st-${esc(c.status)}">${statusLabel(c.status)}</span></td>
        <td data-label="Valor">${c.value ? money(c.value) : '—'}</td>
        <td data-label="Seguimiento">${followHTML(c)}</td>
        ${admin ? `<td data-label="Comercial">${esc(ownerName(c.owner))}</td>` : ''}
        <td class="c-act">${quickActions(c)}</td>
      </tr>`).join('');
    return `<table class="tbl"><thead><tr>
      <th>Negocio</th><th>Contacto</th><th>Servicio</th><th>Estado</th><th>Valor</th><th>Seguimiento</th>${admin ? '<th>Comercial</th>' : ''}<th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function boardHTML(list) {
    const admin = isAdmin();
    const cols = STATUSES.map(st => {
      const items = list.filter(c => c.status === st.id);
      const sum = items.reduce((a, c) => a + (Number(c.value) || 0), 0);
      const cards = items.length ? items.map(c => `
        <article class="kcard" data-id="${esc(c.id)}" tabindex="0">
          <strong>${esc(c.business)}</strong>
          <small>${esc(c.contact || c.type || '')}</small>
          ${admin ? `<small>👤 ${esc(ownerName(c.owner))}</small>` : ''}
          <div class="kmeta"><span>${c.value ? money(c.value) : ''}</span>${followHTML(c)}</div>
        </article>`).join('') : '<p class="empty">Sin clientes</p>';
      return `<section class="col" aria-label="${st.label}">
        <div class="col__head"><span class="badge st-${st.id}">${st.label}</span><small>${items.length}${sum ? ' · ' + money(sum) : ''}</small></div>
        <div class="col__list">${cards}</div></section>`;
    }).join('');
    return `<div class="board">${cols}</div>`;
  }

  /* ============================================================
     CHAT INTERNO · General + conversación privada admin ↔ comercial
     Sin conexión permanente: la pantalla pregunta al servidor cada pocos segundos
     (5 s con el chat abierto, 45 s si estás en otra pestaña, nada si la ventana está oculta).
     ============================================================ */
  function freshChat() { return { channels: [], open: '', msgs: {}, cursor: {}, more: {}, loaded: {}, total: 0, sig: '' }; }

  let chatTimer = null;
  let chatBusy = false;
  let chatAgain = false;
  const wide = () => window.matchMedia('(min-width: 900px)').matches;
  const chatOpenNow = () => state.view === 'chat' && !document.hidden;

  const chatHM = ts => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const chatWhen = ts => new Date(ts).toDateString() === new Date().toDateString()
    ? chatHM(ts) : new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  function chatDay(ts) {
    const d = new Date(ts).toDateString();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d === new Date().toDateString()) return 'Hoy';
    if (d === y.toDateString()) return 'Ayer';
    return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }
  const chatText = s => esc(s)
    .replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
  function sortChannels(list) {
    const rest = list.filter(c => c.kind !== 'general').sort((a, b) => b.lastTs - a.lastTs || a.name.localeCompare(b.name, 'es'));
    return [...list.filter(c => c.kind === 'general'), ...rest];
  }

  function scheduleChat() {
    clearTimeout(chatTimer);
    if (!state.user || document.hidden) return;
    chatTimer = setTimeout(pollChat, state.view === 'chat' ? 5000 : 45000);
  }

  function applyChatEvents(id, events) {
    const list = state.chat.msgs[id] || (state.chat.msgs[id] = []);
    for (const ev of events) {
      if (ev.type === 'msg') { if (!list.some(m => m.id === ev.id)) list.push(ev); }
      else if (ev.type === 'del') { const i = list.findIndex(m => m.id === ev.target); if (i >= 0) list.splice(i, 1); }
    }
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  function updateChatBadge() {
    const n = state.chat.total;
    const b = $('#chatBadge');
    b.hidden = !n; b.textContent = n;
    document.title = (n ? `(${n}) ` : '') + BASE_TITLE;
  }

  async function pollChat() {
    if (!state.user) return;
    if (chatBusy) { chatAgain = true; return; }
    chatBusy = true;
    const c = state.chat;
    let again = false;
    try {
      const open = chatOpenNow() ? c.open : '';
      const hadCursor = !!(open && c.cursor[open]);
      let q = '';
      if (open) { q = '?open=' + encodeURIComponent(open); if (hadCursor) q += '&after=' + encodeURIComponent(c.cursor[open]); }
      const r = await api('GET', 'chat/poll' + q, undefined, true);
      if (!state.user || c !== state.chat) return;

      c.channels = sortChannels(r.channels);
      if (r.open && r.open.id === c.open) {
        const id = r.open.id;
        if (!hadCursor) { c.msgs[id] = []; c.more[id] = !!r.open.hasMore; }
        applyChatEvents(id, r.open.events);
        if (r.open.cursor) c.cursor[id] = r.open.cursor;
        c.loaded[id] = true;
      }
      if (!c.open && wide() && state.view === 'chat' && c.channels.length) { c.open = c.channels[0].id; again = true; }
      c.total = c.channels.reduce((n, ch) => n + (ch.id === c.open && chatOpenNow() ? 0 : ch.unread), 0);
      updateChatBadge();
      if (state.view === 'chat') renderChat();
    } catch (e) { /* silencioso: se reintenta en el siguiente ciclo */ }
    finally {
      chatBusy = false;
      const redo = again || chatAgain;
      chatAgain = false;
      scheduleChat();
      if (redo) pollChat();
    }
  }

  function chatEnter() {
    const c = state.chat;
    if (!c.open && wide() && c.channels.length) c.open = c.channels[0].id;
    $('#chatHint').textContent = isAdmin()
      ? 'Canal general del equipo y conversación privada con cada comercial.'
      : 'Canal general del equipo y conversación privada con administración.';
    pollChat();
  }

  function openChannel(id) {
    const c = state.chat;
    c.open = id; c.sig = '';
    renderChat();
    pollChat();
    if (wide()) $('#chatInput').focus();
  }

  function renderChat() {
    const c = state.chat;
    $('#chat').classList.toggle('is-thread', !!c.open);
    $('#chatList').innerHTML = c.channels.length
      ? c.channels.map(ch => `<button type="button" class="chat-item${ch.id === c.open ? ' is-active' : ''}" data-chan="${esc(ch.id)}">
          <span class="avatar chat-av">${ch.kind === 'general' ? '#' : esc(initials(ch.name))}</span>
          <span class="chat-item__txt"><strong>${esc(ch.name)}</strong><small>${ch.kind === 'general' ? 'Todo el equipo' : 'Privado'}${ch.lastTs ? ' · ' + chatWhen(ch.lastTs) : ''}</small></span>
          ${ch.unread && ch.id !== c.open ? `<span class="tab-badge">${ch.unread}</span>` : ''}</button>`).join('')
      : '<p class="empty">Cargando conversaciones…</p>';

    const ch = c.channels.find(x => x.id === c.open);
    $('#chatTitle').textContent = ch ? ch.name : '';
    $('#chatSub').textContent = !ch ? '' : ch.kind === 'general' ? 'Todo el equipo'
      : isAdmin() ? 'Conversación privada' : 'Conversación privada con administración';
    $('#chatForm').hidden = !ch;
    renderChatMsgs();
  }

  function renderChatMsgs() {
    const c = state.chat;
    const box = $('#chatMsgs');
    if (!c.open) { c.sig = ''; box.innerHTML = '<p class="empty chat__empty">Elige una conversación.</p>'; return; }
    const list = c.msgs[c.open] || [];
    const sig = [c.open, list.length, list.at(-1) ? list.at(-1).id : '', c.more[c.open] ? 1 : 0, c.loaded[c.open] ? 1 : 0].join('|');
    if (sig === c.sig) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90 || c.sig.split('|')[0] !== c.open;
    c.sig = sig;

    let html = c.more[c.open] ? '<button type="button" class="chat__more" id="chatMore">Cargar mensajes anteriores</button>' : '';
    let prev = null;
    for (const m of list) {
      const day = new Date(m.ts).toDateString();
      const sameDay = prev && new Date(prev.ts).toDateString() === day;
      if (!sameDay) html += `<div class="chat__day">${chatDay(m.ts)}</div>`;
      const mine = m.from === state.user.id;
      const cont = sameDay && prev.from === m.from && m.ts - prev.ts < 5 * 60e3;
      const canDel = mine || isAdmin();
      html += `<div class="msg${mine ? ' msg--me' : ''}${cont ? ' msg--cont' : ''}">
        ${!mine && !cont ? `<span class="msg__name">${esc(m.fromName)}${m.fromRole === 'admin' ? ' <em>Admin</em>' : ''}</span>` : ''}
        <div class="msg__text">${chatText(m.text)}</div>
        <span class="msg__meta"><time>${chatHM(m.ts)}</time>${canDel ? `<button type="button" class="msg__del" data-del="${esc(m.id)}" aria-label="Borrar mensaje">✕</button>` : ''}</span>
      </div>`;
      prev = m;
    }
    if (!list.length) html += `<p class="empty chat__empty">${c.loaded[c.open] ? 'Aún no hay mensajes. ¡Escribe el primero!' : 'Cargando mensajes…'}</p>`;
    box.innerHTML = html;
    if (near) box.scrollTop = box.scrollHeight;
  }

  async function sendChat(ev) {
    ev.preventDefault();
    const c = state.chat;
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text || !c.open) return;
    const id = c.open;
    const btn = $('#chatForm button[type=submit]');
    btn.disabled = true;
    try {
      const m = await api('POST', 'chat/send', { channel: id, text }, true);
      input.value = ''; input.style.height = '';
      applyChatEvents(id, [m]);
      c.sig = '';
      renderChat();
      const box = $('#chatMsgs'); box.scrollTop = box.scrollHeight;
      input.focus();
      pollChat();
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }

  async function loadOlder() {
    const c = state.chat;
    const id = c.open;
    const first = (c.msgs[id] || [])[0];
    if (!first) return;
    try {
      const r = await api('GET', `chat/history?channel=${encodeURIComponent(id)}&before=${encodeURIComponent(first.id)}`, undefined, true);
      const box = $('#chatMsgs');
      const h = box.scrollHeight;
      applyChatEvents(id, r.events);
      c.more[id] = !!r.hasMore;
      c.sig = '';
      renderChatMsgs();
      box.scrollTop = box.scrollHeight - h;
    } catch (e) { fail(e); }
  }

  async function deleteChatMsg(msgId) {
    const c = state.chat;
    const id = c.open;
    if (!confirm('¿Borrar este mensaje para todos?')) return;
    try {
      await api('DELETE', `chat/${encodeURIComponent(id)}/${encodeURIComponent(msgId)}`, undefined, true);
      c.msgs[id] = (c.msgs[id] || []).filter(m => m.id !== msgId);
      c.sig = '';
      renderChat();
    } catch (e) { fail(e); }
  }

  /* ============================================================
     APPXNEWS · tablón interno
     ============================================================ */
  const NEWS_CATS = [
    { id: 'aviso',   label: 'Aviso',          plural: 'Avisos' },
    { id: 'novedad', label: 'Novedad',        plural: 'Novedades' },
    { id: 'info',    label: 'Información',    plural: 'Información' },
    { id: 'top',     label: 'Reconocimiento', plural: 'Reconocimientos' }
  ];
  const MEDALS = ['🥇', '🥈', '🥉'];
  const catLabel = id => (NEWS_CATS.find(c => c.id === id) || NEWS_CATS[2]).label;
  const touched = p => p.updatedAt || p.createdAt;
  const seenKey = () => 'appxnews_seen_' + (state.user ? state.user.id : '');
  const readSeen = () => { try { return localStorage.getItem(seenKey()) || ''; } catch { return ''; } };
  const sortPosts = () => state.posts.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));

  /* «Sin leer»: publicaciones de otros más nuevas que la última vez que se abrió AppXnews
     (en este dispositivo). La primera vez solo cuentan las de los últimos 14 días. */
  function unreadPosts() {
    if (!state.user) return [];
    const base = state.newsSeen || new Date(Date.now() - 14 * 864e5).toISOString();
    return state.posts.filter(p => p.author !== state.user.id && touched(p) > base);
  }
  function markNewsSeen() {
    const latest = state.posts.reduce((m, p) => (touched(p) > m ? touched(p) : m), '');
    if (latest && latest > state.newsSeen) {
      state.newsSeen = latest;
      try { localStorage.setItem(seenKey(), latest); } catch { /* ignorar */ }
    }
  }
  function updateNewsBadge() {
    const n = state.view === 'news' ? 0 : unreadPosts().length;
    const b = $('#newsBadge');
    b.hidden = !n; b.textContent = n;
  }
  function renderNewsBanner() {
    const n = unreadPosts().length;
    const el = $('#newsBanner');
    el.hidden = !n;
    if (n) el.textContent = n === 1
      ? '📣 Tienes 1 publicación nueva en AppXnews. Ver ahora →'
      : `📣 Tienes ${n} publicaciones nuevas en AppXnews. Ver ahora →`;
  }

  /* Texto de la publicación → HTML seguro: párrafos, listas con «- » y enlaces http(s) */
  function richText(s) {
    const link = t => t.replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return String(s || '').split(/\n{2,}/).map(block => {
      const lines = block.split('\n').filter(l => l.trim() !== '');
      if (!lines.length) return '';
      if (lines.every(l => /^\s*[-•]\s+/.test(l)))
        return '<ul>' + lines.map(l => '<li>' + link(esc(l.replace(/^\s*[-•]\s+/, ''))) + '</li>').join('') + '</ul>';
      return '<p>' + lines.map(l => link(esc(l))).join('<br>') + '</p>';
    }).join('');
  }

  function renderRanking() {
    const card = $('#rankCard');
    const r = state.ranking;
    if (!r) { card.hidden = true; return; }
    card.hidden = false;
    const [y, m] = r.month.split('-').map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const on = state.settings.showRanking !== false;
    $('#rankTitle').textContent = `🏆 Top comerciales · ${monthName}`;
    $('#rankToggle').checked = on;
    $('#rankList').innerHTML = r.list.length
      ? r.list.map((e, i) => `<li class="rank-item${e.id === state.user.id ? ' me' : ''}">
          <span class="${i < 3 ? 'medal' : 'pos'}">${i < 3 ? MEDALS[i] : i + 1}</span>
          <span><strong>${esc(e.name)}</strong>${e.id === state.user.id ? ' <small>(tú)</small>' : ''}</span>
          <span class="rank-n">${e.won} ${e.won === 1 ? 'cierre' : 'cierres'}${isAdmin() && e.value ? `<small>${money(e.value)}</small>` : ''}</span></li>`).join('')
      : '<li class="empty">Aún no hay cierres este mes. ¡El primero se lleva la medalla! 🥇</li>';
    $('#rankNote').textContent = isAdmin()
      ? (on ? 'Se calcula solo con los clientes que pasan a «Ganado» durante el mes. Los comerciales lo ven sin importes.'
            : 'Ahora mismo los comerciales NO ven este ranking.')
      : 'Se calcula con los clientes que pasan a «Ganado» durante el mes.';
  }

  function postHTML(p) {
    const edited = p.updatedAt && p.updatedAt !== p.createdAt;
    return `<article class="post post--${esc(p.category)}${p.pinned ? ' is-pinned' : ''}">
      <header class="post__head">
        <span class="cat cat--${esc(p.category)}">${esc(catLabel(p.category))}</span>
        ${p.pinned ? '<span class="pin-tag">📌 Fijado</span>' : ''}
        ${state.newsMarks.has(p.id) ? '<span class="pill-new">Nuevo</span>' : ''}
        <time datetime="${esc(p.createdAt)}">${fmtDT(p.createdAt)}${edited ? ' · editado' : ''}</time>
      </header>
      <h3>${esc(p.title)}</h3>
      <div class="post__body">${richText(p.body)}</div>
      <footer class="post__foot"><small>Publicado por ${esc(p.authorName || 'Admin')}</small>
        ${isAdmin() ? `<button type="button" class="btn btn--ghost btn--sm" data-edit="${esc(p.id)}">Editar</button>` : ''}</footer>
    </article>`;
  }

  function renderNews() {
    unreadPosts().forEach(p => state.newsMarks.add(p.id));
    renderRanking();

    const f = state.newsFilter;
    $('#newsChips').innerHTML = [{ id: '', plural: 'Todo' }, ...NEWS_CATS]
      .map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${f === c.id}">${c.plural}</button>`).join('');

    const list = state.posts.filter(p => !f || p.category === f);
    $('#newsList').innerHTML = list.length
      ? list.map(postHTML).join('')
      : `<div class="card"><p class="empty">${state.posts.length
          ? 'No hay publicaciones en esta categoría.'
          : (isAdmin() ? 'Todavía no has publicado nada. Pulsa «+ Nueva publicación» para empezar.'
                       : 'Todavía no hay publicaciones. Cuando haya novedades las verás aquí.')}</p></div>`;
    markNewsSeen();
    updateNewsBadge();
  }

  /* ---------- Editor de publicaciones (admin) ---------- */
  const ndlg = () => $('#newsDialog');
  let editingPost = null;

  function openPost(id) {
    if (!isAdmin()) return;
    const p = id ? state.posts.find(x => x.id === id) : null;
    if (id && !p) return;
    editingPost = id || null;
    fillSelect($('#pCat'), NEWS_CATS.map(c => [c.id, c.label]));
    $('#newsDlgTitle').textContent = p ? 'Editar publicación' : 'Nueva publicación';
    $('#newsDlgSub').textContent = p ? `Publicada el ${fmtDT(p.createdAt)}` : '';
    $('#pTitle').value = p ? p.title : '';
    $('#pCat').value = p ? p.category : 'novedad';
    $('#pPinned').checked = p ? !!p.pinned : false;
    $('#pBody').value = p ? p.body : '';
    $('#newsError').hidden = true;
    $('#newsDelete').hidden = !p;
    if (!ndlg().open) ndlg().showModal();
    if (!p) $('#pTitle').focus();
  }
  function closePost() { if (ndlg().open) ndlg().close(); editingPost = null; }

  async function savePost(ev) {
    ev.preventDefault();
    const title = $('#pTitle').value.trim();
    const body = $('#pBody').value.trim();
    const err = $('#newsError');
    if (!title || !body) { err.textContent = !title ? 'Escribe un título.' : 'Escribe el contenido.'; err.hidden = false; return; }
    err.hidden = true;
    const payload = { title, body, category: $('#pCat').value, pinned: $('#pPinned').checked };
    const btn = $('#newsForm button[type=submit]');
    btn.disabled = true;
    try {
      const id = editingPost;
      const p = id ? await api('PUT', `news/${encodeURIComponent(id)}`, payload) : await api('POST', 'news', payload);
      const i = state.posts.findIndex(x => x.id === p.id);
      if (i >= 0) state.posts[i] = p; else state.posts.push(p);
      sortPosts();
      closePost();
      renderCurrent();
      toast(id ? 'Publicación actualizada' : 'Publicado en AppXnews');
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && !e.handled) { err.textContent = e.message; err.hidden = false; } else fail(e);
    } finally { btn.disabled = false; }
  }

  async function deletePost() {
    const id = editingPost;
    const p = state.posts.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`¿Eliminar «${p.title}»? Dejará de verse para todo el equipo.`)) return;
    try {
      await api('DELETE', `news/${encodeURIComponent(id)}`);
      state.posts = state.posts.filter(x => x.id !== id);
      closePost();
      renderCurrent();
      toast('Publicación eliminada');
    } catch (e) { fail(e); }
  }

  async function toggleRanking(ev) {
    const on = ev.target.checked;
    try {
      state.settings = await api('PUT', 'settings', { showRanking: on });
      renderNews();
      toast(on ? 'Los comerciales ya ven el ranking' : 'Ranking oculto para los comerciales');
    } catch (e) { ev.target.checked = !on; fail(e); }
  }

  /* ============================================================
     EQUIPO (admin)
     ============================================================ */
  function renderEquipo() {
    const members = state.users.filter(u => u.role === 'comercial' || state.data.clients.some(c => c.owner === u.id));
    if (!members.length) {
      $('#teamOut').innerHTML = '<p class="empty">Todavía no hay comerciales. Crea el primero con el generador de códigos.</p>';
      return;
    }
    const rows = members.map(u => {
      const s = stats(state.data.clients.filter(c => c.owner === u.id));
      const manage = u.id !== 'admin'
        ? `<button class="btn btn--ghost btn--sm" type="button" data-reset="${esc(u.id)}">Nuevo código</button>
           <button class="btn btn--danger-ghost btn--sm" type="button" data-deluser="${esc(u.id)}">Dar de baja</button>`
        : '';
      return `<tr>
        <td class="t-name"><div class="t-who"><span class="avatar">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><small>${u.role === 'admin' ? 'Administrador' : 'Comercial'}</small></div></div></td>
        <td data-label="Clientes">${s.total}</td>
        <td data-label="En curso">${s.open}</td>
        <td data-label="Ganados">${s.won}</td>
        <td data-label="Valor en curso">${money(s.pipeline)}</td>
        <td data-label="Conversión">${s.conv === null ? '—' : s.conv + ' %'}</td>
        <td data-label="Vencidos">${s.overdue ? `<span class="pill pill--red">${s.overdue}</span>` : '0'}</td>
        <td data-label="Última actividad">${s.last ? fmtDT(s.last) : '—'}</td>
        <td class="t-act"><div class="t-btns"><button class="btn btn--ghost btn--sm" type="button" data-owner="${esc(u.id)}">Ver clientes</button>${manage}</div></td>
      </tr>`;
    }).join('');
    $('#teamOut').innerHTML = `<table class="team"><thead><tr>
      <th>Comercial</th><th>Clientes</th><th>En curso</th><th>Ganados</th><th>Valor en curso</th><th>Conversión</th><th>Vencidos</th><th>Última actividad</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function showCode(msg, code) {
    $('#genMsg').textContent = msg;
    $('#genCode').textContent = code;
    $('#genOut').hidden = false;
    $('#genOut').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function generateCode(ev) {
    ev.preventDefault();
    const name = $('#genName').value.trim();
    if (!name) return;
    const btn = $('#genForm button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('POST', 'users', { name, role: $('#genRole').value });
      $('#genName').value = '';
      await refresh(true);
      showCode(`Código de alta para ${r.user.name} (entrégaselo en privado):`, r.code);
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  }
  async function resetUserCode(id) {
    const u = userById(id); if (!u) return;
    if (!confirm(`¿Generar un código nuevo para ${u.name}? El anterior dejará de funcionar.`)) return;
    try {
      const r = await api('POST', `users/${encodeURIComponent(id)}/reset`);
      showCode(`Nuevo código para ${r.user.name}:`, r.code);
    } catch (e) { fail(e); }
  }
  async function removeUser(id) {
    const u = userById(id); if (!u) return;
    if (!confirm(`¿Dar de baja a ${u.name}? Perderá el acceso y sus clientes pasarán a ti.`)) return;
    try {
      await api('DELETE', `users/${encodeURIComponent(id)}`);
      await refresh(true);
      toast(`${u.name} dado de baja`);
    } catch (e) { fail(e); }
  }

  /* ============================================================
     DIÁLOGO DE CLIENTE
     ============================================================ */
  const dlg = () => $('#clientDialog');
  function closeDialog() { if (dlg().open) dlg().close(); state.editingId = null; }

  function openClient(id) {
    const c = id ? state.data.clients.find(x => x.id === id) : null;
    if (id && !c) return;
    state.editingId = id || null;
    state.editingBase = c ? c.updatedAt : '';

    fillSelect($('#cType'), TYPES); fillSelect($('#cService'), SERVICES);
    fillSelect($('#cCity'), CITIES); fillSelect($('#cStatus'), STATUSES.map(s => [s.id, s.label]));
    fillSelect($('#cOwner'), state.users.map(u => [u.id, u.name]));

    $('#dlgTitle').textContent = c ? c.business : 'Nuevo cliente';
    $('#dlgSub').textContent = c ? `Alta: ${fmtDT(c.createdAt)} · Lleva: ${ownerName(c.owner)}` : '';
    $('#cBusiness').value = c ? c.business : '';
    $('#cContact').value = c ? c.contact : '';
    $('#cPhone').value = c ? c.phone : '';
    $('#cEmail').value = c ? c.email : '';
    $('#cType').value = c ? (c.type || TYPES[0]) : TYPES[0];
    $('#cService').value = c ? (c.service || SERVICES[3]) : SERVICES[3];
    $('#cCity').value = c ? (c.city || CITIES[0]) : CITIES[0];
    $('#cStatus').value = c ? c.status : 'nuevo';
    $('#cValue').value = c && c.value ? c.value : '';
    $('#cNext').value = c ? (c.next || '') : '';
    $('#cNotes').value = c ? c.notes : '';
    $('#cOwnerWrap').hidden = !isAdmin();
    $('#cOwner').value = c ? c.owner : (isAdmin() ? (state.users.find(u => u.role === 'comercial') || state.user).id : state.user.id);
    $('#formError').hidden = true;
    $('#dlgDelete').hidden = !c;
    $('#logSection').hidden = !c;
    $('#logInput').value = '';
    const q = $('#dlgQuick');
    const qa = c ? quickActions(c) : '';
    q.innerHTML = qa; q.hidden = !qa;
    if (c) renderLog(c);

    if (!dlg().open) dlg().showModal();
    if (!c) $('#cBusiness').focus();
  }

  function renderLog(c) {
    const items = (c.log || []).slice().reverse();
    $('#logList').innerHTML = items.length
      ? items.map(l => `<li class="${l.type === 'nota' ? '' : 'sys'}">${esc(l.text)}<small>${fmtDT(l.t)} · ${esc(ownerName(l.by))}</small></li>`).join('')
      : '<li class="sys">Sin actividad todavía.</li>';
  }

  async function saveClient(ev) {
    ev.preventDefault();
    const business = $('#cBusiness').value.trim();
    const err = $('#formError');
    if (!business) { err.textContent = 'El nombre del negocio es obligatorio.'; err.hidden = false; $('#cBusiness').focus(); return; }
    const email = $('#cEmail').value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'El email no parece válido.'; err.hidden = false; $('#cEmail').focus(); return; }
    err.hidden = true;

    const body = {
      business, contact: $('#cContact').value.trim(), phone: $('#cPhone').value.trim(), email,
      type: $('#cType').value, service: $('#cService').value, city: $('#cCity').value, status: $('#cStatus').value,
      value: Math.max(0, Number($('#cValue').value) || 0), next: $('#cNext').value || '', notes: $('#cNotes').value.trim(),
      owner: isAdmin() ? $('#cOwner').value : state.user.id
    };
    const id = state.editingId;
    const btn = $('#clientForm button[type=submit]');
    btn.disabled = true;
    try {
      const c = id
        ? await api('PUT', `clients/${encodeURIComponent(id)}`, { ...body, base: state.editingBase })
        : await api('POST', 'clients', body);
      upsertClient(c);
      closeDialog();
      renderCurrent();
      toast(id ? 'Cliente actualizado' : 'Cliente añadido');
    } catch (e) {
      if (e.status === 409) {
        toast(e.message);
        await refresh(true);
        openClient(id);
      } else if (e.status === 404 && id) {
        toast('Este cliente ya no existe.');
        closeDialog();
        await refresh(true);
      } else if (e.status >= 400 && e.status < 500 && !e.handled) {
        err.textContent = e.message; err.hidden = false;
      } else fail(e);
    } finally { btn.disabled = false; }
  }

  async function addNote() {
    const input = $('#logInput');
    const text = input.value.trim();
    const id = state.editingId;
    if (!text || !id) return;
    $('#logAdd').disabled = true;
    try {
      const c = await api('POST', `clients/${encodeURIComponent(id)}/notes`, { text });
      upsertClient(c);
      state.editingBase = c.updatedAt;
      input.value = '';
      renderLog(c);
      toast('Nota añadida');
    } catch (e) { fail(e); } finally { $('#logAdd').disabled = false; }
  }

  async function deleteClient() {
    const id = state.editingId;
    const c = state.data.clients.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`¿Eliminar a «${c.business}»? Esta acción no se puede deshacer.`)) return;
    try {
      await api('DELETE', `clients/${encodeURIComponent(id)}`);
      state.data.clients = state.data.clients.filter(x => x.id !== id);
      closeDialog();
      renderCurrent();
      toast('Cliente eliminado');
    } catch (e) { fail(e); }
  }

  /* ============================================================
     EXPORTAR / IMPORTAR (admin) y datos de ejemplo
     ============================================================ */
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  function exportCsv() {
    const list = filteredClients();
    if (!list.length) { toast('No hay clientes que exportar'); return; }
    const head = ['Negocio', 'Contacto', 'Teléfono', 'Email', 'Tipo', 'Servicio', 'Ciudad', 'Estado', 'Valor (€)', 'Próximo seguimiento', 'Comercial', 'Notas', 'Alta'];
    const rows = list.map(c => [c.business, c.contact, c.phone, c.email, c.type, c.service, c.city, statusLabel(c.status), c.value || '', c.next, ownerName(c.owner), c.notes, c.createdAt.slice(0, 10)]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
    download(`clientes-appxpand-${todayStr()}.csv`, csv, 'text/csv;charset=utf-8');
  }
  function exportJson() {
    download(`appxpand-crm-${todayStr()}.json`,
      JSON.stringify({ app: 'appxpand-crm', version: 2, exportedAt: new Date().toISOString(), clients: state.data.clients }, null, 2), 'application/json');
  }

  async function sendImport(clients) {
    const total = { added: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < clients.length; i += 100) {
      const r = await api('POST', 'import', { clients: clients.slice(i, i + 100) });
      total.added += r.added; total.updated += r.updated; total.skipped += r.skipped;
    }
    await refresh(true);
    return total;
  }
  function importJson(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let d;
      try { d = JSON.parse(reader.result); } catch { toast('Archivo no válido'); return; }
      if (!d || !Array.isArray(d.clients)) { toast('Archivo no válido'); return; }
      try {
        const r = await sendImport(d.clients);
        toast(`Restaurado: ${r.added} nuevos, ${r.updated} actualizados`);
      } catch (e) { fail(e); }
    };
    reader.readAsText(file);
  }

  async function loadDemo() {
    if (!confirm('Se añadirán clientes de ejemplo a los que ya tienes. ¿Continuar?')) return;
    const reps = state.users.filter(u => u.role === 'comercial');
    const owners = reps.length ? reps : [state.user];
    const D = [
      ['Peluquería Estilo', 'Carmen López', 'Peluquería o estética', 'Paquete lanzadera', 'Albacete', 'contactado', 330, 1],
      ['Bar La Plaza', 'Andrés Ruiz', 'Restaurante o bar', 'Optimización de perfil de Google', 'Ciudad Real', 'reunion', 450, 3],
      ['Taller Hermanos Gil', 'Pedro Gil', 'Servicios (reformas, talleres, clínicas…)', 'Página web', 'Alicante', 'propuesta', 600, -2],
      ['Boutique Aurora', 'Lucía Marín', 'Tienda', 'Paquete lanzadera', 'Albacete', 'nuevo', 330, 0],
      ['Clínica Dental Sonríe', 'Dra. Vidal', 'Servicios (reformas, talleres, clínicas…)', 'Optimización de perfil de Google', 'Alicante', 'ganado', 520, ''],
      ['Restaurante El Olivo', 'Jorge Peña', 'Restaurante o bar', 'Página web', 'Ciudad Real', 'perdido', 700, ''],
      ['Estética Bella', 'Marina Soto', 'Peluquería o estética', 'Paquete lanzadera', 'Alicante', 'contactado', 330, 5],
      ['Ferretería Central', 'Luis Cano', 'Tienda', 'Página web', 'Albacete', 'reunion', 550, -4],
      ['Reformas Mediterráneo', 'Raúl Ferrer', 'Servicios (reformas, talleres, clínicas…)', 'Paquete lanzadera', 'Alicante', 'propuesta', 330, 2],
      ['Cafetería Dulce Luna', 'Eva Torres', 'Restaurante o bar', 'Paquete lanzadera', 'Albacete', 'ganado', 330, ''],
      ['Barbería Clásica', 'Iván Mora', 'Peluquería o estética', 'Optimización de perfil de Google', 'Ciudad Real', 'nuevo', 400, 4],
      ['Floristería Margarita', 'Rosa Gil', 'Tienda', 'Por definir', 'Albacete', 'contactado', 0, -1]
    ];
    const clients = D.map(([business, contact, type, service, city, status, value, off], i) => {
      const t = new Date(Date.now() - (i + 1) * 36e5 * 7).toISOString();
      const owner = owners[i % owners.length].id;
      return {
        id: uid(), business, contact, phone: '600 00 00 ' + pad(10 + i), email: '', type, service, city, status, value,
        next: off === '' || !OPEN.includes(status) ? '' : todayStr(off), notes: 'Cliente de ejemplo.', owner,
        createdAt: t, updatedAt: t, log: [{ t, by: owner, type: 'estado', text: 'Cliente creado' }]
      };
    });
    try { await sendImport(clients); toast('Datos de ejemplo cargados'); } catch (e) { fail(e); }
  }
  async function wipeAll() {
    if (!confirm('¿Borrar TODOS los clientes de la plataforma? No se puede deshacer.')) return;
    if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
    try { await api('DELETE', 'clients'); await refresh(true); toast('Todos los clientes borrados'); } catch (e) { fail(e); }
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  function bind() {
    $('#loginForm').addEventListener('submit', onLogin);
    $('#toggleCode').addEventListener('click', () => {
      const i = $('#code'); i.type = i.type === 'password' ? 'text' : 'password';
    });
    $('#logoutBtn').addEventListener('click', () => logout());

    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-view]'); if (b) switchView(b.dataset.view);
    });
    $('#resumenOwner').addEventListener('change', e => { state.resumenOwner = e.target.value; renderResumen(); });
    $('#followList').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) openClient(b.dataset.id); });

    // Filtros
    const refilter = () => { readFilterInputs(); renderClientes(); };
    $('#fQ').addEventListener('input', refilter);
    ['#fStatus', '#fService', '#fType', '#fCity', '#fOwner', '#fFollow', '#fSort'].forEach(s => $(s).addEventListener('change', refilter));
    $('#clearFilters').addEventListener('click', () => {
      state.filters = { ...EMPTY_FILTERS };
      syncFilterInputs(); renderClientes();
    });
    $('#toggleFilters').addEventListener('click', () => {
      const open = $('#filters').classList.toggle('is-open');
      $('#toggleFilters').setAttribute('aria-expanded', String(open));
    });
    $$('[data-cview]').forEach(b => b.addEventListener('click', () => { state.cview = b.dataset.cview; renderClientes(); }));
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#newClient').addEventListener('click', () => openClient(null));

    // Abrir cliente desde lista/tablero
    const openFromEvent = e => {
      if (e.target.closest('a')) return;
      const el = e.target.closest('[data-id]'); if (el) openClient(el.dataset.id);
    };
    $('#clientsOut').addEventListener('click', openFromEvent);
    $('#clientsOut').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-id]')) openFromEvent(e); });

    // Equipo
    $('#teamOut').addEventListener('click', e => {
      const own = e.target.closest('[data-owner]');
      if (own) {
        state.filters = { ...EMPTY_FILTERS, owner: own.dataset.owner };
        syncFilterInputs(); switchView('clientes'); return;
      }
      const rs = e.target.closest('[data-reset]'); if (rs) { resetUserCode(rs.dataset.reset); return; }
      const del = e.target.closest('[data-deluser]'); if (del) removeUser(del.dataset.deluser);
    });
    $('#genForm').addEventListener('submit', generateCode);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      const txt = $(b.dataset.copy).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Copiado'), () => toast('No se pudo copiar'));
    });
    $('#exportAll').addEventListener('click', exportJson);
    $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
    $('#loadDemo').addEventListener('click', loadDemo);
    $('#wipeAll').addEventListener('click', wipeAll);

    // Chat
    $('#chatList').addEventListener('click', e => { const b = e.target.closest('[data-chan]'); if (b) openChannel(b.dataset.chan); });
    $('#chatBack').addEventListener('click', () => { state.chat.open = ''; state.chat.sig = ''; renderChat(); });
    $('#chatForm').addEventListener('submit', sendChat);
    $('#chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); sendChat(e); }
    });
    $('#chatInput').addEventListener('input', e => { const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 120) + 'px'; });
    $('#chatMsgs').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'); if (d) { deleteChatMsg(d.dataset.del); return; }
      if (e.target.closest('#chatMore')) loadOlder();
    });

    // AppXnews
    $('#newPost').addEventListener('click', () => openPost(null));
    $('#newsList').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) openPost(b.dataset.edit); });
    $('#newsChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { state.newsFilter = b.dataset.cat; renderNews(); } });
    $('#rankToggle').addEventListener('change', toggleRanking);
    $('#newsBanner').addEventListener('click', () => switchView('news'));
    $('#newsForm').addEventListener('submit', savePost);
    $('#newsDlgClose').addEventListener('click', closePost);
    $('#newsCancel').addEventListener('click', closePost);
    $('#newsDelete').addEventListener('click', deletePost);
    ndlg().addEventListener('click', e => { if (e.target === ndlg()) closePost(); });
    ndlg().addEventListener('close', () => { editingPost = null; });

    // Diálogo
    $('#clientForm').addEventListener('submit', saveClient);
    $('#dlgClose').addEventListener('click', closeDialog);
    $('#dlgCancel').addEventListener('click', closeDialog);
    $('#dlgDelete').addEventListener('click', deleteClient);
    $('#logAdd').addEventListener('click', addNote);
    $('#logInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
    dlg().addEventListener('click', e => { if (e.target === dlg()) closeDialog(); });
    dlg().addEventListener('close', () => { state.editingId = null; });

    // Al volver a la pestaña, traer lo último
    document.addEventListener('visibilitychange', () => {
      if (!state.user) return;
      if (document.hidden) { clearTimeout(chatTimer); return; }
      if (!busy) refresh(true);
      pollChat();
    });
  }

  /* ---------- Arranque ---------- */
  bind();
  const saved = readSession();
  if (saved) {
    start(saved.token).catch(e => { logout(e.handled ? undefined : e.message); });
  } else $('#code').focus();
})();
