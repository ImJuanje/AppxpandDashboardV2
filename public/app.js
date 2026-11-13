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
    kb: [],
    kbSection: '',
    kbQ: '',
    kbOpen: new Map(),
    ranking: null,
    settings: { showRanking: true },
    newsFilter: '',
    newsSeen: '',
    newsMarks: new Set(),
    team: null, teamId: '', teamPhoto: undefined,
    pay: null, payAt: 0, payTab: 'resumen', payPending: 0, payOpen: new Set(), decId: '',
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
    if ($('#kbDialog').open) $('#kbDialog').close();
    state.kb = []; state.kbSection = ''; state.kbQ = ''; state.kbOpen = new Map(); $('#kbQ').value = '';
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
    state.kb = d.kb || [];
    state.ranking = d.ranking || null;
    state.settings = d.settings || { showRanking: true };
    state.payPending = d.payPending || 0;
  }

  async function start(token) {
    state.token = token;
    applySync(await api('GET', 'sync'));

    state.team = null;
    state.pay = null; state.payTab = 'resumen'; state.payOpen = new Set();
    state.view = 'resumen';
    state.cview = 'lista';
    state.resumenOwner = '';
    state.filters = { ...EMPTY_FILTERS };
    state.newsFilter = '';
    state.kbSection = ''; state.kbQ = ''; state.kbOpen = new Map(); $('#kbQ').value = '';
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
      const prevLeads = new Set(state.data.clients.filter(c => c.webNew).map(c => c.id));
      applySync(await api('GET', 'sync', undefined, silent));
      const fresh = state.data.clients.filter(c => c.webNew && !prevLeads.has(c.id));
      if (fresh.length) toast(fresh.length === 1 ? `🔔 Nuevo cliente desde la web: ${fresh[0].business}` : `🔔 ${fresh.length} clientes nuevos desde la web`);
      syncUserControls();
      if (!$('#clientDialog').open && !$('#newsDialog').open && !$('#kbDialog').open) renderCurrent();
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
    $('#viewKb').hidden = v !== 'kb';
    $('#viewChat').hidden = v !== 'chat';
    $('#viewPay').hidden = v !== 'pay';
    if (v === 'pay') state.payAt = 0;
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
    else if (state.view === 'kb') renderKb();
    else if (state.view === 'chat') renderChat();
    else if (state.view === 'pay') renderPay();
    else { renderEquipo(); renderTeamWeb(); }
    updateNewsBadge();
    updatePayBadge();
    updateLeadAlerts();
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
        <td class="c-main" data-label="Negocio"><strong>${esc(c.business)}</strong>${webTag(c)}<small>${esc(c.type || '')}${c.city ? ' · ' + esc(c.city) : ''}</small></td>
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
          <strong>${esc(c.business)}</strong>${webTag(c)}
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

  /* ---------- Modo oscuro ---------- */
  const curTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  function setTheme(t, noSave) {
    document.documentElement.setAttribute('data-theme', t);
    if (!noSave) { try { localStorage.setItem('appxpand_theme', t); } catch (e) { /* sin almacenamiento */ } }
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.textContent = t === 'dark' ? '☀' : '☾';
      b.setAttribute('aria-label', t === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      b.title = b.getAttribute('aria-label');
    });
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0a1224' : '#0b1b3a';
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
  /* Clientes nuevos desde la web: etiqueta, número rojo en la pestaña y aviso amarillo */
  const webLeads = () => allVisible().filter(c => c.webNew);
  const webTag = c => (c.source === 'web' && c.status === 'nuevo') ? '<span class="pill pill--web">Nuevo · web</span>' : '';
  function updateLeadAlerts() {
    const n = webLeads().length;
    const b = $('#leadBadge');
    if (b) { b.hidden = !n; b.textContent = n; }
    $$('.lead-banner').forEach(el => {
      el.hidden = !n;
      if (n) el.textContent = n === 1
        ? '🔔 Tienes un cliente nuevo interesado desde la web. Ver ahora →'
        : `🔔 Tienes ${n} clientes nuevos interesados desde la web. Ver ahora →`;
    });
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

  /* Texto → HTML seguro: párrafos, listas con «- », listas numeradas «1. », tablas «| a | b |»
     y enlaces http(s). Se usa en AppXnews y en el Centro comercial. */
  function richText(s) {
    const link = t => t.replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const cell = t => link(esc(t.trim()));
    const table = lines => {
      const rows = lines
        .map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|'))
        .filter(r => !r.every(c => /^\s*:?-{2,}:?\s*$/.test(c)));
      if (!rows.length) return '';
      const [head, ...body] = rows;
      return '<div class="rt-scroll"><table class="rt"><thead><tr>' + head.map(c => `<th>${cell(c)}</th>`).join('') + '</tr></thead>' +
        (body.length ? '<tbody>' + body.map(r => '<tr>' + r.map((c, i) => `<td data-label="${esc((head[i] || '').trim())}">${cell(c)}</td>`).join('') + '</tr>').join('') + '</tbody>' : '') +
        '</table></div>';
    };
    return String(s || '').split(/\n{2,}/).map(block => {
      const lines = block.split('\n').filter(l => l.trim() !== '');
      if (!lines.length) return '';
      if (lines.every(l => /^\s*\|/.test(l))) return table(lines);
      if (lines.every(l => /^\s*[-•]\s+/.test(l)))
        return '<ul>' + lines.map(l => '<li>' + link(esc(l.replace(/^\s*[-•]\s+/, ''))) + '</li>').join('') + '</ul>';
      if (lines.every(l => /^\s*\d+[.)]\s+/.test(l)))
        return '<ol>' + lines.map(l => '<li>' + link(esc(l.replace(/^\s*\d+[.)]\s+/, ''))) + '</li>').join('') + '</ol>';
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
     CENTRO COMERCIAL (centro de conocimiento)
     Todos lo leen; solo el administrador crea, edita, ordena y borra.
     Secciones: qué vendemos, objeciones, FAQ, precios, descuentos (interno),
     cierre de ventas y normativa. El buscador cruza todas a la vez.
     ============================================================ */
  const KB_SECTIONS = [
    { id: 'servicios',  icon: '🧭', name: 'Qué vendemos',          sub: 'Servicios y diferenciales',
      intro: 'Lo que ofrece AppXpand y en qué nos diferenciamos, para tenerlo claro antes de hablar con un cliente.', openAll: true },
    { id: 'objeciones', icon: '💬', name: 'Objeciones',            sub: 'Respuestas comerciales',
      intro: 'El objetivo no es enseñar a discutir con el cliente, sino ayudarte a entender qué hay detrás de cada objeción y responder con argumentos.', label: 'Respuesta recomendada' },
    { id: 'faq',        icon: '❓', name: 'Preguntas frecuentes',  sub: 'Dudas de clientes',
      intro: 'Preguntas que un cliente puede hacer durante una conversación comercial.' },
    { id: 'precios',    icon: '💶', name: 'Precios y packs',       sub: 'Tarifas y condiciones',
      intro: 'Consulta rápidamente qué puedes ofrecer.', openAll: true },
    { id: 'descuentos', icon: '🔒', name: 'Descuentos',            sub: 'Normativa interna',
      intro: 'Cuánto puedes bajar el precio y cuándo toca consultar a dirección.', internal: true, openAll: true },
    { id: 'cierre',     icon: '🤝', name: 'Cierre de ventas',      sub: 'Proceso comercial',
      intro: 'Cómo avanzar después de resolver las objeciones.', openAll: true },
    { id: 'normas',     icon: '📋', name: 'Normativa',             sub: 'Reglas del equipo',
      intro: 'Normas que nunca debemos olvidar.', openAll: true }
  ];
  const KB_BY = Object.fromEntries(KB_SECTIONS.map(x => [x.id, x]));
  const KB_GROUPS = [
    { id: 'precio',    label: 'Objeciones sobre el precio',                  short: 'Precio' },
    { id: 'necesidad', label: 'Objeciones sobre la necesidad',               short: 'Necesidad' },
    { id: 'confianza', label: 'Objeciones sobre confianza y funcionamiento', short: 'Confianza y funcionamiento' },
    { id: 'otras',     label: 'Otras objeciones',                            short: 'Otras' }
  ];
  const secOf = e => (KB_BY[e.section] ? e.section : 'objeciones');
  const grpOf = e => secOf(e) !== 'objeciones' ? '' : (KB_GROUPS.some(g => g.id === e.category) ? e.category : 'otras');
  const sortKb = () => state.kb.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const kbSiblings = e => state.kb.filter(x => secOf(x) === secOf(e) && grpOf(x) === grpOf(e));

  /* ---------- Buscador ----------
     Pensado para escribir como se habla: «es caro» → quita las palabras vacías («es»), busca
     «caro» y lo encuentra en el título, en las palabras clave que pone el admin o en el texto,
     tolerando acentos, plurales y género. Ordena por lo bien que encaja cada entrada. */
  const KB_STOP = new Set(('el la los las un una unos unas de del al a en y o u que es son soy ser esta este esto estan estoy me mi mis te tu ' +
    'se lo le les nos por para con sin no si ya muy mas como pero hay tengo tiene tienen tener quiero puedo puede pueden podeis hacer hace hacen ' +
    'dice dicen quiere dime cuando donde cual').split(' '));
  const words = t => norm(t).split(/[^a-z0-9]+/).filter(Boolean);
  const stemOf = t => (t.length >= 5 ? t.slice(0, -1) : t);
  const wordHit = (w, t) => w.startsWith(stemOf(t)) || (w.length >= 3 && t.startsWith(w) && t.length - w.length <= 2);

  function kbSearch(q) {
    let toks = words(q);
    const meaningful = toks.filter(t => !KB_STOP.has(t));
    toks = [...new Set(meaningful.length ? meaningful : toks)];
    if (!toks.length) return [];
    const phrase = norm(q).replace(/\s+/g, ' ').trim();
    const need = toks.length <= 2 ? 1 : Math.ceil(toks.length / 2);
    const out = [];
    state.kb.forEach((e, idx) => {
      const sec = KB_BY[secOf(e)];
      const grp = KB_GROUPS.find(g => g.id === grpOf(e));
      const tw = words(e.question), kw = words(e.keywords || ''), bw = words(e.answer);
      const sw = words(`${sec.name} ${sec.sub} ${grp ? grp.short : ''}`);
      let score = 0, matched = 0, top = 0;
      for (const t of toks) {
        const s1 = tw.some(w => wordHit(w, t)) ? 6 : kw.some(w => wordHit(w, t)) ? 5 : sw.some(w => wordHit(w, t)) ? 3 : bw.some(w => wordHit(w, t)) ? 1.5 : 0;
        if (s1) { matched++; score += s1; top = Math.max(top, s1); }
      }
      if (matched < need) return;
      if (matched === toks.length) score += 4;
      if (phrase.length > 2 && norm(e.question).includes(phrase)) score += 5;
      if (phrase.length > 2 && norm(e.keywords || '').includes(phrase)) score += 4;
      out.push({ e, score, top, idx });
    });
    out.sort((a, b) => b.score - a.score || a.idx - b.idx);
    // si hay coincidencias claras, se descartan las que solo aparecen de pasada en el texto
    const res = out.some(r => r.top >= 5) ? out.filter(r => r.top >= 3) : out;
    return res.slice(0, 25).map(r => r.e);
  }

  /* ---------- Pintado ---------- */
  function kbItemHTML(e, o) {
    const sec = KB_BY[secOf(e)];
    const id = esc(e.id);
    const open = o.searching || (state.kbOpen.has(e.id) ? state.kbOpen.get(e.id) : !!sec.openAll);
    const sibs = o.movable ? kbSiblings(e) : null;
    const pos = sibs ? sibs.indexOf(e) : -1;
    const edited = e.updatedAt && e.updatedAt !== e.createdAt;
    return `<details class="kb-item${sec.internal ? ' is-internal' : ''}" data-id="${id}"${open ? ' open' : ''}>
      <summary><span class="kb-item__t">${esc(e.question)}</span>${o.showSec ? `<span class="cat cat--kb">${sec.icon} ${esc(sec.name)}${sec.internal ? ' · interno' : ''}</span>` : ''}</summary>
      <div class="kb-item__a">
        ${sec.label ? `<p class="kb__label">${esc(sec.label)}</p>` : ''}
        <div class="post__body">${richText(e.answer)}</div>
      </div>
      ${isAdmin() ? `<div class="kb-item__admin">
        ${edited ? `<small class="muted" style="margin-right:auto">Editada ${fmtDT(e.updatedAt)}</small>` : ''}
        ${sibs ? `<button type="button" class="btn btn--ghost btn--sm" data-kb-up="${id}" aria-label="Subir"${pos === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn btn--ghost btn--sm" data-kb-down="${id}" aria-label="Bajar"${pos === sibs.length - 1 ? ' disabled' : ''}>↓</button>` : ''}
        <button type="button" class="btn btn--ghost btn--sm" data-kb-edit="${id}">Editar</button>
      </div>` : ''}
    </details>`;
  }

  function renderKb() {
    const q = state.kbQ.trim();
    const searching = norm(q).length >= 2;
    const out = $('#kbOut');

    if (searching) {
      const res = kbSearch(q);
      out.innerHTML = res.length
        ? `<p class="muted kb-count">${res.length} ${res.length === 1 ? 'resultado' : 'resultados'} para «${esc(q)}»</p>
           <div class="kb-list">${res.map(e => kbItemHTML(e, { searching: true, showSec: true })).join('')}</div>`
        : `<div class="card"><p class="empty">No hay resultados para «${esc(q)}». Prueba con otras palabras o consulta con dirección.</p></div>`;
      return;
    }

    const sec = KB_BY[state.kbSection];
    if (!sec) {   // portada: las secciones
      out.innerHTML = '<div class="kb-tiles">' + KB_SECTIONS.map(x => {
        const n = state.kb.filter(e => secOf(e) === x.id).length;
        return `<button type="button" class="kb-tile" data-kb-sec="${x.id}">
          ${x.internal ? '<span class="kb-tag">Interno</span>' : ''}
          <span class="kb-tile__icon" aria-hidden="true">${x.icon}</span>
          <strong>${esc(x.name)}</strong><small class="muted">${esc(x.sub)}</small>
          <span class="kb-tile__n">${n} ${n === 1 ? 'entrada' : 'entradas'}</span></button>`;
      }).join('') + '</div>';
      return;
    }

    const list = state.kb.filter(e => secOf(e) === sec.id);
    const opts = { searching: false, showSec: false, movable: isAdmin() };
    let body;
    if (!list.length) {
      body = `<div class="card"><p class="empty">${isAdmin()
        ? 'Esta sección está vacía. Pulsa «+ Nueva entrada» para añadir la primera.'
        : 'Todavía no hay contenido en esta sección.'}</p></div>`;
    } else if (sec.id === 'objeciones') {
      body = KB_GROUPS.map(g => {
        const items = list.filter(e => grpOf(e) === g.id);
        return items.length ? `<h4 class="kb__group">${esc(g.label)}</h4><div class="kb-list">${items.map(e => kbItemHTML(e, opts)).join('')}</div>` : '';
      }).join('');
    } else {
      body = `<div class="kb-list">${list.map(e => kbItemHTML(e, opts)).join('')}</div>`;
    }
    out.innerHTML = `<button type="button" class="kb-back" data-kb-home>← Todas las secciones</button>
      <div class="kb-sechead"><h3>${sec.icon} ${esc(sec.name)}</h3><p class="muted">${esc(sec.intro)}</p></div>
      ${sec.internal ? '<p class="kb-notice">🔒 Información interna y confidencial. Esta sección es exclusivamente para los comerciales: no debe compartirse con clientes.</p>' : ''}
      ${body}`;
  }

  /* ---------- Editor (admin) ---------- */
  const kdlg = () => $('#kbDialog');
  let editingKb = null;

  function kbEditorLabels() {
    const sct = $('#kSection').value;
    $('#kCatWrap').hidden = sct !== 'objeciones';
    $('#kQuestionLbl').textContent = sct === 'objeciones' ? 'Objeción del cliente *' : sct === 'faq' ? 'Pregunta *' : 'Título *';
    $('#kAnswerLbl').textContent = sct === 'objeciones' ? 'Respuesta recomendada *' : sct === 'faq' ? 'Respuesta *' : 'Contenido *';
  }

  function openKb(id) {
    if (!isAdmin()) return;
    const e = id ? state.kb.find(x => x.id === id) : null;
    if (id && !e) return;
    editingKb = id || null;
    fillSelect($('#kSection'), KB_SECTIONS.map(x => [x.id, x.name]));
    fillSelect($('#kCat'), KB_GROUPS.map(g => [g.id, g.short]));
    $('#kbDlgTitle').textContent = e ? 'Editar entrada' : 'Nueva entrada';
    $('#kbDlgSub').textContent = e ? `Creada el ${fmtDT(e.createdAt)}` : '';
    $('#kSection').value = e ? secOf(e) : (state.kbSection || 'objeciones');
    $('#kCat').value = e ? (grpOf(e) || 'otras') : 'precio';
    $('#kQuestion').value = e ? e.question : '';
    $('#kAnswer').value = e ? e.answer : '';
    $('#kKeywords').value = e ? (e.keywords || '') : '';
    $('#kbError').hidden = true;
    $('#kbDelete').hidden = !e;
    kbEditorLabels();
    if (!kdlg().open) kdlg().showModal();
    if (!e) $('#kQuestion').focus();
  }
  function closeKb() { if (kdlg().open) kdlg().close(); editingKb = null; }

  async function saveKb(ev) {
    ev.preventDefault();
    const question = $('#kQuestion').value.trim();
    const answer = $('#kAnswer').value.trim();
    const err = $('#kbError');
    if (!question || !answer) { err.textContent = !question ? 'Escribe el título.' : 'Escribe el contenido.'; err.hidden = false; return; }
    err.hidden = true;
    const payload = { question, answer, section: $('#kSection').value, category: $('#kCat').value, keywords: $('#kKeywords').value.trim() };
    const btn = $('#kbForm button[type=submit]');
    btn.disabled = true;
    try {
      const id = editingKb;
      const e = id ? await api('PUT', `kb/${encodeURIComponent(id)}`, payload) : await api('POST', 'kb', payload);
      const i = state.kb.findIndex(x => x.id === e.id);
      if (i >= 0) state.kb[i] = e; else state.kb.push(e);
      state.kbOpen.set(e.id, true);
      state.kbSection = secOf(e);   // se te lleva a la sección donde ha quedado
      sortKb();
      closeKb();
      renderCurrent();
      toast(id ? 'Entrada actualizada' : 'Entrada añadida');
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && !e.handled) { err.textContent = e.message; err.hidden = false; } else fail(e);
    } finally { btn.disabled = false; }
  }

  async function deleteKb() {
    const id = editingKb;
    const e = state.kb.find(x => x.id === id);
    if (!e) return;
    if (!confirm(`¿Eliminar «${e.question}»? Dejará de verse para todo el equipo.`)) return;
    try {
      await api('DELETE', `kb/${encodeURIComponent(id)}`);
      state.kb = state.kb.filter(x => x.id !== id);
      state.kbOpen.delete(id);
      closeKb();
      renderCurrent();
      toast('Entrada eliminada');
    } catch (e2) { fail(e2); }
  }

  /* Sube/baja una entrada intercambiándola con la vecina de su mismo grupo */
  async function moveKb(id, dir) {
    const e = state.kb.find(x => x.id === id);
    if (!e) return;
    const sibs = kbSiblings(e);
    const j = sibs.indexOf(e) + dir;
    if (j < 0 || j >= sibs.length) return;
    const ids = state.kb.map(x => x.id);
    const a = ids.indexOf(e.id), b = ids.indexOf(sibs[j].id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    const prev = state.kb;
    state.kb = ids.map(x => prev.find(f => f.id === x));   // se ve al instante…
    renderKb();
    try {
      state.kb = await api('POST', 'kb/reorder', { ids }, true);   // …y se confirma con el servidor
      renderKb();
    } catch (err) { state.kb = prev; renderKb(); fail(err); }
  }

  async function loadKbSeed() {
    if (!confirm('Se cargará el contenido base de AppXpand SOLO en las secciones del Centro comercial que estén vacías. No toca las que ya tienen contenido. ¿Continuar?')) return;
    try {
      const r = await api('POST', 'kb/seed');
      state.kb = r.kb;
      renderCurrent();
      toast(r.added ? `Cargadas ${r.added} entradas` : 'No hay secciones vacías: no se ha cargado nada');
    } catch (e) { fail(e); }
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
    $('#dlgSub').textContent = c ? `Alta: ${fmtDT(c.createdAt)} · Lleva: ${ownerName(c.owner)}${c.source === 'web' ? ' · Origen: web' : ''}` : '';
    if (c && c.webNew) {
      c.webNew = false; updateLeadAlerts();
      api('POST', 'clients/' + encodeURIComponent(c.id) + '/seen', undefined, true).catch(() => {});
    }
    $('#cBusiness').value = c ? c.business : '';
    $('#cContact').value = c ? c.contact : '';
    $('#cPhone').value = c ? c.phone : '';
    $('#cEmail').value = c ? c.email : '';
    $('#cType').value = c ? (c.type || TYPES[0]) : TYPES[0];
    $('#cService').value = c ? (c.service || SERVICES[3]) : SERVICES[3];
    $('#cCity').value = c ? (c.city || CITIES[0]) : CITIES[0];
    $('#cStatus').value = c ? c.status : 'nuevo';
    $('#cValue').value = c && c.value ? c.value : '';
    $('#cPack').value = c && c.pack ? String(c.pack) : '0';
    $('#cPackValue').value = c && c.packValue ? c.packValue : '';
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
      value: Math.max(0, Number($('#cValue').value) || 0), pack: Number($('#cPack').value) || 0, packValue: Math.max(0, Number($('#cPackValue').value) || 0), next: $('#cNext').value || '', notes: $('#cNotes').value.trim(),
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
     PAGOS Y GASTOS
     ============================================================ */
  const money2 = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const pct = r => Math.round(r * 100) + ' %';
  const fmtDayL = s => parseDay(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const catOf = id => ((state.pay && state.pay.rules.cats.find(c => c.id === id)) || { icon: '📦', label: id });
  const EXP_ST = { pendiente: ['Pendiente', 'pill--amber'], aprobado: ['Aprobado', 'pill--green'], rechazado: ['Rechazado', 'pill--red'] };

  async function loadPay(quiet) {
    try {
      state.pay = await api('GET', 'pay', undefined, quiet);
      state.payAt = Date.now();
      if (isAdmin()) state.payPending = state.pay.expenses.filter(e => e.status === 'pendiente').length;
      updatePayBadge();
      if (state.view === 'pay') renderPay(true);
    } catch (e) { if (!quiet) fail(e); }
  }
  function updatePayBadge() {
    const b = $('#payBadge'), n = isAdmin() ? state.payPending : 0;
    b.hidden = !n; b.textContent = n;
  }

  function tiersHTML(P, rate) {
    let from = 0;
    return '<div class="tiers">' + P.rules.tiers.map(t => {
      const label = t.to === null ? `${from}+` : `${from}–${t.to}`;
      from = (t.to || 0) + 1;
      return `<span class="tier${t.rate === rate ? ' is-on' : ''}"><b>${pct(t.rate)}</b><small>${label} ventas</small></span>`;
    }).join('') + '</div>';
  }

  /* Desglose: de qué venta o gasto viene cada euro */
  function payLinesHTML(d, canDelete) {
    const rows = [];
    d.commissions.forEach(l => {
      const pack = l.pack ? ` + pack de ${l.pack} meses (se abonan ${l.packCredit}: ${money2(l.packBase)})` : '';
      rows.push(`<tr class="row"><td class="c-main"><strong>${esc(l.business)}</strong>
        <small class="muted">Comisión de venta · ${fmtDay(l.day)}${l.open ? ' · ciclo en curso' : ''}</small></td>
        <td data-label="Base">${money2(l.base)}<small class="muted">${money2(l.value)}${esc(pack)}</small></td>
        <td data-label="Tramo">${plural(l.n, 'venta', 'ventas')} → ${pct(l.rate)}</td>
        <td data-label="Importe"><strong>${money2(l.amount)}</strong></td></tr>`);
    });
    d.expenses.forEach(l => {
      const c = catOf(l.cat);
      rows.push(`<tr class="row"><td class="c-main"><strong>${esc(l.concept)}</strong>
        <small class="muted">Gasto aprobado · ${c.icon} ${esc(c.label)} · ${fmtDay(l.day)}</small></td>
        <td data-label="Base">—</td><td data-label="Tramo">—</td>
        <td data-label="Importe"><strong>${money2(l.amount)}</strong></td></tr>`);
    });
    d.adjustments.forEach(l => {
      rows.push(`<tr class="row"><td class="c-main"><strong>${esc(l.concept)}</strong>
        <small class="muted">Ajuste de administración · ${fmtDay(l.day)}${canDelete ? ` · <a href="#" data-deladj="${esc(l.id)}">quitar</a>` : ''}</small></td>
        <td data-label="Base">—</td><td data-label="Tramo">—</td>
        <td data-label="Importe"><strong class="${l.amount < 0 ? 'neg' : ''}">${money2(l.amount)}</strong></td></tr>`);
    });
    if (!rows.length) return '<p class="empty">Todavía no hay nada acumulado.</p>';
    return `<table class="tbl ptbl"><thead><tr><th>Concepto</th><th>Base</th><th>Tramo</th><th>Importe</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  const countLines = p => p.commissions.length + p.expenses.length + p.adjustments.length;

  function personCard(P, p, admin) {
    const total = Math.round((p.due + p.accrued) * 100) / 100;
    const split = `Liquidable hoy <strong>${money2(p.due)}</strong>${p.accrued ? ` · Comisiones del ciclo en curso <strong>${money2(p.accrued)}</strong> <span class="muted">(el % puede subir si cierra más ventas)</span>` : ''}`;
    const nextTxt = p.next ? `${admin ? 'Le' : 'Te'} ${p.next.need === 1 ? 'falta' : 'faltan'} ${plural(p.next.need, 'venta', 'ventas')} para el ${pct(p.next.rate)}` : 'Tramo máximo alcanzado 🎉';
    return `<article class="card pay-person">
      <div class="pay-person__head">
        <div><h3>${admin ? esc(p.name) : 'Mi ciclo actual'}</h3>
          <p class="muted">${plural(p.salesCycle, 'venta', 'ventas')} este ciclo · ${nextTxt}</p></div>
        <div class="pay-total"><span>${admin ? 'Se le debe' : 'Te pagaremos el ' + fmtDayL(P.cycle.end)}</span><strong>${money2(total)}</strong></div>
      </div>
      ${tiersHTML(P, p.rate)}
      <p class="pay-split">${split}</p>
      ${admin ? `<div class="pay-actions">
        <button class="btn btn--ghost btn--sm" type="button" data-adj="${esc(p.id)}">➕ Ajuste o bono</button>
        <button class="btn btn--primary btn--sm" type="button" data-pay="${esc(p.id)}" ${p.due ? '' : 'disabled'}>✔ Marcar pagado ${p.due ? money2(p.due) : ''}</button>
      </div>` : ''}
      <details data-pid="${esc(p.id)}" ${state.payOpen.has(p.id) ? 'open' : ''}>
        <summary>Ver desglose (${plural(countLines(p), 'concepto', 'conceptos')})</summary>
        ${payLinesHTML(p, admin)}
      </details>
    </article>`;
  }

  function adminSummary(P) {
    const days = Math.round((parseDay(P.cycle.end) - parseDay(P.today)) / 864e5);
    const pend = P.expenses.filter(e => e.status === 'pendiente').length;
    const k = [
      [`Total a pagar el ${fmtDayL(P.cycle.end)}`, money2(P.totals.due + P.totals.accrued), ''],
      ['Liquidable hoy', money2(P.totals.due), ''],
      ['Gastos por aprobar', pend, pend ? 'kpi--alert' : ''],
      [days === 0 ? '¡Hoy es día de pago!' : 'Días para el pago', days === 0 ? '28' : days, days === 0 ? 'kpi--ok' : '']
    ];
    const kpis = '<div class="kpis kpis--4">' + k.map(([a, b, c]) => `<div class="kpi ${c}"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('') + '</div>';
    const note = `<p class="muted pay-note">Ciclo de ${fmtDay(P.cycle.start)} a ${fmtDay(P.cycle.end)}. El día ${P.rules.payDay} se paga y el siguiente día vuelven todos al tramo del ${pct(P.rules.tiers[0].rate)}. Las comisiones del ciclo en curso se pueden marcar como pagadas a partir del día ${P.rules.payDay}.</p>`;
    return kpis + note + (P.people.length ? P.people.map(p => personCard(P, p, true)).join('') : '<p class="empty">Aún no hay comerciales. Créalos en la pestaña Equipo.</p>');
  }

  function myIncome(P) {
    const p = P.people[0];
    if (!p) return '<p class="empty">No hay datos todavía.</p>';
    const rules = `<article class="card"><h3>Cómo se calcula tu comisión</h3>
      <p class="muted">Según las ventas que cierres en el ciclo (del ${fmtDay(P.cycle.start)} al ${fmtDay(P.cycle.end)}). El día ${P.rules.payDay} se cobra y el siguiente empieza de nuevo en el ${pct(P.rules.tiers[0].rate)}.</p>
      ${tiersHTML(P, p.rate)}
      <p class="muted">Packs de mantenimiento: 3 meses → se abona 1 mes · 6 meses → 2 meses · 12 meses → 3 meses (parte proporcional).</p></article>`;
    return personCard(P, p, false) + rules;
  }

  function expCard(e, admin) {
    const c = catOf(e.cat), st = EXP_ST[e.status];
    const act = [`<button class="btn btn--ghost btn--sm" type="button" data-file="${esc(e.id)}">📎 Justificante</button>`];
    if (admin && !e.payoutId) act.push(e.status === 'pendiente'
      ? `<button class="btn btn--primary btn--sm" type="button" data-review="${esc(e.id)}">Revisar</button>`
      : `<button class="btn btn--ghost btn--sm" type="button" data-reopen="${esc(e.id)}">Reabrir</button>`);
    if (!admin && e.status === 'pendiente') act.push(`<button class="btn btn--danger-ghost btn--sm" type="button" data-retire="${esc(e.id)}">Retirar</button>`);
    return `<article class="card exp">
      <div class="exp__top"><span>${c.icon} ${esc(c.label)}</span><span class="pill ${st[1]}">${e.payoutId ? 'Pagado' : st[0]}</span></div>
      <h4>${esc(e.concept)}</h4>
      <p class="muted">${admin ? esc(e.ownerName) + ' · ' : ''}${fmtDay(e.date)} · <strong>${money2(e.amount)}</strong>${e.status === 'aprobado' && e.approvedAmount !== e.amount ? ` (aprobado ${money2(e.approvedAmount)})` : ''}</p>
      ${e.note ? `<p>${esc(e.note)}</p>` : ''}
      ${e.adminNote ? `<p class="exp__msg">💬 ${esc(e.adminNote)}</p>` : ''}
      <div class="exp__act">${act.join('')}</div></article>`;
  }

  function adminExpenses(P) {
    const pend = P.expenses.filter(e => e.status === 'pendiente'), rest = P.expenses.filter(e => e.status !== 'pendiente');
    return `<h3 class="sub">Por aprobar (${pend.length})</h3>` +
      (pend.length ? pend.map(e => expCard(e, true)).join('') : '<p class="empty">No hay gastos pendientes. 🎉</p>') +
      (rest.length ? `<h3 class="sub">Ya revisados</h3>` + rest.map(e => expCard(e, true)).join('') : '');
  }

  function myExpenses(P) {
    const p = P.people[0];
    const tiles = p ? p.cats.map(c => `<div class="cat${c.eligible ? '' : ' is-locked'}"><span class="cat__i">${c.eligible ? c.icon : '🔒'}</span>
      <strong>${esc(c.label)}</strong>
      <small class="muted">${c.eligible ? `${money2(c.used)} de ${c.cap} € este ciclo` : c.mode === 'off' ? 'Desactivado por administración' : `Desde ${plural(c.minSales, 'venta', 'ventas')}`}</small></div>`).join('') : '';
    return `<div class="pay-bar"><p class="muted">Los gastos necesitan justificante y los aprueba administración. Los aprobados se suman a tu pago del ${fmtDayL(P.cycle.end)}.</p>
        <button class="btn btn--primary" type="button" data-addexp>➕ Añadir gasto</button></div>
      <div class="cats">${tiles}</div>
      <h3 class="sub">Mis gastos</h3>` +
      (P.expenses.length ? P.expenses.map(e => expCard(e, false)).join('') : '<p class="empty">Aún no has registrado gastos.</p>');
  }

  function historyView(P) {
    if (!P.payouts.length) return '<p class="empty">Todavía no hay pagos registrados.</p>';
    return P.payouts.map(po => {
      const d = { commissions: po.lines.filter(l => l.kind === 'comision'), expenses: po.lines.filter(l => l.kind === 'gasto'), adjustments: po.lines.filter(l => l.kind === 'ajuste') };
      return `<article class="card"><details>
        <summary class="po-sum"><span><strong>${esc(fmtDayL(po.day))}</strong>${isAdmin() ? ' · ' + esc(po.ownerName) : ''}</span><strong>${money2(po.total)}</strong></summary>
        ${po.note ? `<p class="muted">${esc(po.note)}</p>` : ''}${payLinesHTML(d, false)}</details></article>`;
    }).join('');
  }

  function benefitsView(P) {
    if (!P.people.length) return '<p class="empty">Aún no hay comerciales. Créalos en la pestaña Equipo.</p>';
    const opt = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
    return '<p class="muted pay-note">Activa o desactiva cada beneficio por comercial. «Auto» lo desbloquea según su rendimiento (ventas); «Activado» lo habilita siempre y «Desactivado» lo bloquea aunque tenga ventas.</p>' +
      P.people.map(p => `<article class="card"><div class="ben-head"><h3>${esc(p.name)}</h3>
        <div class="ben-all"><button class="btn btn--ghost btn--sm" type="button" data-benall="${esc(p.id)}|on">Activar todos</button>
        <button class="btn btn--ghost btn--sm" type="button" data-benall="${esc(p.id)}|off">Desactivar todos</button>
        <button class="btn btn--ghost btn--sm" type="button" data-benall="${esc(p.id)}|auto">Todos en auto</button></div></div>
        ${p.cats.map(c => `<div class="ben"><div><strong>${c.icon} ${esc(c.label)}</strong>
          <small class="muted">Tope ${c.cap} € por ciclo · auto desde ${plural(c.minSales, 'venta', 'ventas')} · <b class="${c.eligible ? 'ben--on' : 'ben--off'}">${c.eligible ? 'Disponible' : 'Bloqueado'}</b></small></div>
          <select data-ben="${esc(p.id)}|${c.id}" aria-label="${esc(c.label)} para ${esc(p.name)}">${opt('auto', c.mode, 'Auto')}${opt('on', c.mode, 'Activado')}${opt('off', c.mode, 'Desactivado')}</select></div>`).join('')}
      </article>`).join('');
  }

  function renderPay(noLoad) {
    const out = $('#payOut'), P = state.pay, admin = isAdmin();
    if (!P) { out.innerHTML = '<p class="empty">Cargando…</p>'; if (!noLoad) loadPay(true); return; }
    if (!noLoad && Date.now() - state.payAt > 20000) loadPay(true);
    const pend = P.expenses.filter(e => e.status === 'pendiente').length;
    const tabs = admin
      ? [['resumen', 'Resumen'], ['gastos', 'Gastos' + (pend ? ` <span class="tab-badge">${pend}</span>` : '')], ['beneficios', 'Beneficios'], ['historial', 'Historial']]
      : [['resumen', 'Mis ingresos'], ['gastos', 'Mis gastos'], ['historial', 'Historial']];
    if (!tabs.some(t => t[0] === state.payTab)) state.payTab = 'resumen';
    $('#paySeg').innerHTML = tabs.map(([id, l]) => `<button type="button" data-paytab="${id}" aria-pressed="${state.payTab === id}">${l}</button>`).join('');
    $('#paySub').textContent = `Ciclo del ${fmtDay(P.cycle.start)} al ${fmtDay(P.cycle.end)} · pago el ${fmtDayL(P.cycle.end)}`;
    out.innerHTML = state.payTab === 'resumen' ? (admin ? adminSummary(P) : myIncome(P))
      : state.payTab === 'gastos' ? (admin ? adminExpenses(P) : myExpenses(P))
      : state.payTab === 'beneficios' ? benefitsView(P)
      : historyView(P);
  }

  /* ---------- acciones ---------- */
  async function payAct(fn, okMsg) {
    try { await fn(); toast(okMsg); await loadPay(true); } catch (e) { fail(e); }
  }
  async function openFile(id) {
    const w = window.open('', '_blank');
    try {
      const r = await fetch(`/api/expenses/${encodeURIComponent(id)}/file`, { headers: { Authorization: 'Bearer ' + state.token } });
      if (!r.ok) throw new Error('No se pudo abrir el justificante.');
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location = url; else { const a = document.createElement('a'); a.href = url; a.download = 'justificante'; a.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (w) w.close(); toast(e.message); }
  }

  /* Diálogo: nuevo gasto (comercial) */
  const edlg = () => $('#expDialog');
  function openExp() {
    const p = state.pay.people[0];
    $('#xCat').innerHTML = p.cats.map(c => `<option value="${c.id}" ${c.eligible ? '' : 'disabled'}>${c.eligible ? c.icon + ' ' + esc(c.label) : '🔒 ' + esc(c.label) + (c.mode === 'off' ? ' (desactivado)' : ' (desde ' + plural(c.minSales, 'venta', 'ventas') + ')')}</option>`).join('');
    const first = p.cats.find(c => c.eligible);
    if (!first) { toast('Aún no tienes tipos de gasto desbloqueados. Se desbloquean al cerrar tu primera venta.'); return; }
    $('#xCat').value = first.id;
    $('#xConcept').value = ''; $('#xAmount').value = ''; $('#xNote').value = ''; $('#xFile').value = '';
    $('#xDate').value = state.pay.today; $('#xDate').max = state.pay.today;
    const d = new Date(parseDay(state.pay.today)); d.setDate(d.getDate() - 62);
    $('#xDate').min = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('#expError').hidden = true; capHint();
    edlg().showModal();
  }
  function capHint() {
    const c = state.pay.people[0].cats.find(x => x.id === $('#xCat').value);
    $('#xCapHint').textContent = c ? `Tope: ${c.cap} € por ciclo · llevas ${money2(c.used)} entre aprobados y pendientes.` : '';
  }
  const blobB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function filePayload(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 2e6) throw new Error('El PDF pesa más de 2 MB. Haz una foto del ticket en su lugar.');
      return { name: file.name, type: file.type, data: await blobB64(file) };
    }
    if (!/^image\//.test(file.type)) throw new Error('Formato no válido: sube una foto (JPG o PNG) o un PDF.');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen. Prueba con otra foto o un PDF.'); }
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
    return { name: (file.name || 'justificante').replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', data: await blobB64(blob) };
  }
  async function saveExp(e) {
    e.preventDefault();
    const err = $('#expError'), btn = $('#expForm button[type=submit]');
    const show = m => { err.textContent = m; err.hidden = false; };
    const f = $('#xFile').files[0];
    if (!f) return show('Adjunta el justificante (foto o PDF del ticket o factura).');
    btn.disabled = true;
    try {
      const file = await filePayload(f);
      await api('POST', 'expenses', {
        cat: $('#xCat').value, concept: $('#xConcept').value.trim(), amount: Number($('#xAmount').value),
        date: $('#xDate').value, note: $('#xNote').value.trim(), file
      });
      edlg().close(); toast('Gasto enviado. Administración lo revisará.'); await loadPay(true);
    } catch (x) { show(x.message || 'No se pudo enviar el gasto.'); }
    btn.disabled = false;
  }

  /* Diálogo: aprobar o rechazar (admin) */
  const ddlg = () => $('#decDialog');
  function openDec(id) {
    const x = state.pay.expenses.find(e => e.id === id); if (!x) return;
    state.decId = id;
    const c = catOf(x.cat);
    $('#decInfo').innerHTML = `<strong>${esc(x.ownerName)}</strong> · ${c.icon} ${esc(c.label)}<br>${esc(x.concept)}<br><span class="muted">${fmtDay(x.date)} · solicitado ${money2(x.amount)}</span>${x.note ? `<br>${esc(x.note)}` : ''}`;
    $('#dAmount').value = x.amount; $('#dAmount').max = x.amount; $('#dNote').value = '';
    $('#decError').hidden = true;
    ddlg().showModal();
  }
  async function decide(decision) {
    const err = $('#decError');
    try {
      await api('PUT', `expenses/${encodeURIComponent(state.decId)}`, { decision, approvedAmount: Number($('#dAmount').value), adminNote: $('#dNote').value.trim() });
      ddlg().close(); toast(decision === 'aprobado' ? 'Gasto aprobado: se suma a su pago.' : 'Gasto rechazado.'); await loadPay(true);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  }

  /* Diálogo: ajuste o bono (admin) */
  const adlg = () => $('#adjDialog');
  function openAdj(owner) {
    $('#aOwner').innerHTML = state.pay.people.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('#aOwner').value = owner; $('#aConcept').value = ''; $('#aAmount').value = ''; $('#adjError').hidden = true;
    adlg().showModal();
  }
  async function saveAdj(e) {
    e.preventDefault();
    const err = $('#adjError');
    try {
      await api('POST', 'pay/adjustments', { owner: $('#aOwner').value, concept: $('#aConcept').value.trim(), amount: Number($('#aAmount').value) });
      adlg().close(); toast('Ajuste añadido a su pago.'); await loadPay(true);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  }

  function bindPay() {
    $('#paySeg').addEventListener('click', e => {
      const b = e.target.closest('[data-paytab]'); if (!b) return;
      state.payTab = b.dataset.paytab; renderPay(true);
    });
    const out = $('#payOut');
    out.addEventListener('toggle', e => {
      const id = e.target.dataset && e.target.dataset.pid; if (!id) return;
      if (e.target.open) state.payOpen.add(id); else state.payOpen.delete(id);
    }, true);
    out.addEventListener('click', e => {
      const t = e.target.closest('[data-file],[data-review],[data-reopen],[data-retire],[data-pay],[data-adj],[data-deladj],[data-addexp],[data-benall]');
      if (!t) return;
      e.preventDefault();
      const d = t.dataset;
      if (d.file) openFile(d.file);
      else if (d.review) openDec(d.review);
      else if (d.reopen) payAct(() => api('PUT', `expenses/${encodeURIComponent(d.reopen)}`, { decision: 'pendiente' }), 'Gasto reabierto');
      else if (d.retire) { if (confirm('¿Retirar este gasto?')) payAct(() => api('DELETE', `expenses/${encodeURIComponent(d.retire)}`), 'Gasto retirado'); }
      else if (d.benall) {
        const [owner, mode] = d.benall.split('|');
        payAct(() => api('PUT', 'pay/benefits', { owner, cat: '*', mode }), 'Beneficios actualizados');
      }
      else if (d.adj) openAdj(d.adj);
      else if (d.deladj) { if (confirm('¿Quitar este ajuste?')) payAct(() => api('DELETE', `pay/adjustments/${encodeURIComponent(d.deladj)}`), 'Ajuste eliminado'); }
      else if (d.addexp !== undefined) openExp();
      else if (d.pay) {
        const p = state.pay.people.find(x => x.id === d.pay); if (!p || !p.due) return;
        if (confirm(`¿Marcar como pagados ${money2(p.due)} a ${p.name}?\nSe guardará el desglose en el historial.`))
          payAct(() => api('POST', 'pay/payouts', { owner: d.pay }), 'Pago registrado');
      }
    });
    out.addEventListener('change', e => {
      const t = e.target.closest('[data-ben]'); if (!t) return;
      const [owner, cat] = t.dataset.ben.split('|');
      payAct(() => api('PUT', 'pay/benefits', { owner, cat, mode: t.value }), 'Beneficio actualizado');
    });
    $('#expForm').addEventListener('submit', saveExp);
    $('#xCat').addEventListener('change', capHint);
    $('#expClose').addEventListener('click', () => edlg().close());
    $('#expCancel').addEventListener('click', () => edlg().close());
    $('#decClose').addEventListener('click', () => ddlg().close());
    $('#decApprove').addEventListener('click', () => decide('aprobado'));
    $('#decReject').addEventListener('click', () => decide('rechazado'));
    $('#adjForm').addEventListener('submit', saveAdj);
    $('#adjClose').addEventListener('click', () => adlg().close());
    $('#adjCancel').addEventListener('click', () => adlg().close());
  }

  /* ============================================================
     EQUIPO EN LA WEB
     ============================================================ */
  const DOW = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
  async function loadTeam() {
    try { state.team = await api('GET', 'team', undefined, true); renderTeamWeb(); } catch (e) { /* se reintenta al volver */ }
  }
  function renderTeamWeb() {
    const out = $('#teamWebOut');
    if (!out) return;
    if (!state.team) { out.innerHTML = '<p class="empty">Cargando…</p>'; loadTeam(); return; }
    out.innerHTML = state.team.map(t => {
      const days = DOW.filter(([d]) => t.days.includes(d)).map(([, l]) => l).join(' ');
      const av = t.photo ? `<img class="tw-av" src="${esc(t.photo)}" alt="">` : `<span class="tw-av tw-av--i">${esc((t.name || t.userName || '?').trim().charAt(0).toUpperCase())}</span>`;
      return `<div class="tw-row">${av}
        <div class="tw-main"><strong>${esc(t.name || t.userName)}</strong>
          <small class="muted">${esc(t.zone || 'Sin zona')} · ${days || 'sin días'} ${esc(t.from)}–${esc(t.to)}</small></div>
        <span class="pill ${t.show ? 'pill--green' : 'pill--amber'}">${t.show ? 'Visible en la web' : 'Oculto'}</span>
        <button class="btn btn--ghost btn--sm" type="button" data-teamedit="${esc(t.id)}">Editar</button></div>`;
    }).join('');
  }
  const tdlg = () => $('#teamDialog');
  function openTeam(id) {
    const t = state.team.find(x => x.id === id); if (!t) return;
    state.teamId = id; state.teamPhoto = undefined;
    $('#tmTitle').textContent = 'Perfil de ' + (t.userName);
    $('#tmName').value = t.name; $('#tmZone').value = t.zone; $('#tmBio').value = t.bio; $('#tmEmail').value = t.email;
    $('#tmFrom').value = t.from; $('#tmTo').value = t.to; $('#tmShow').checked = t.show;
    $('#tmFile').value = '';
    $('#tmPrev').innerHTML = t.photo ? `<img class="tw-av" src="${esc(t.photo)}" alt="">` : '';
    $('#tmDays').innerHTML = DOW.map(([d, l]) => `<label class="chk"><input type="checkbox" value="${d}" ${t.days.includes(d) ? 'checked' : ''}> ${l}</label>`).join('');
    $('#tmError').hidden = true;
    tdlg().showModal();
  }
  async function squarePhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('Sube una imagen (JPG o PNG).');
    let bmp; try { bmp = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen.'); }
    const s = Math.min(bmp.width, bmp.height), cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    cv.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256);
    return cv.toDataURL('image/jpeg', 0.82);
  }
  async function saveTeam(e) {
    e.preventDefault();
    const err = $('#tmError');
    try {
      const body = {
        name: $('#tmName').value.trim(), zone: $('#tmZone').value.trim(), bio: $('#tmBio').value.trim(), email: $('#tmEmail').value.trim(),
        from: $('#tmFrom').value, to: $('#tmTo').value, show: $('#tmShow').checked,
        days: [...$('#tmDays').querySelectorAll('input:checked')].map(i => Number(i.value))
      };
      if (state.teamPhoto !== undefined) body.photo = state.teamPhoto;
      await api('PUT', `team/${encodeURIComponent(state.teamId)}`, body);
      tdlg().close(); toast('Perfil guardado'); await loadTeam();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  }
  function bindTeam() {
    $('#teamWebOut').addEventListener('click', e => { const b = e.target.closest('[data-teamedit]'); if (b) openTeam(b.dataset.teamedit); });
    $('#teamForm').addEventListener('submit', saveTeam);
    $('#tmClose').addEventListener('click', () => tdlg().close());
    $('#tmCancel').addEventListener('click', () => tdlg().close());
    $('#tmFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { state.teamPhoto = await squarePhoto(f); $('#tmPrev').innerHTML = `<img class="tw-av" src="${state.teamPhoto}" alt="">`; $('#tmError').hidden = true; }
      catch (x) { $('#tmError').textContent = x.message; $('#tmError').hidden = false; e.target.value = ''; }
    });
    $('#tmNoPhoto').addEventListener('click', () => { state.teamPhoto = ''; $('#tmPrev').innerHTML = ''; $('#tmFile').value = ''; });
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
    document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => setTheme(curTheme() === 'dark' ? 'light' : 'dark')));
    setTheme(curTheme(), true);

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

    // Centro comercial
    $('#newKb').addEventListener('click', () => openKb(null));
    $('#kbQ').addEventListener('input', e => { state.kbQ = e.target.value; renderKb(); });
    $('#kbOut').addEventListener('click', e => {
      const sec = e.target.closest('[data-kb-sec]'); if (sec) { state.kbSection = sec.dataset.kbSec; renderKb(); window.scrollTo({ top: 0 }); return; }
      if (e.target.closest('[data-kb-home]')) { state.kbSection = ''; renderKb(); window.scrollTo({ top: 0 }); return; }
      const ed = e.target.closest('[data-kb-edit]'); if (ed) { openKb(ed.dataset.kbEdit); return; }
      const up = e.target.closest('[data-kb-up]'); if (up) { moveKb(up.dataset.kbUp, -1); return; }
      const dn = e.target.closest('[data-kb-down]'); if (dn) moveKb(dn.dataset.kbDown, 1);
    });
    // «toggle» no burbujea: se escucha en captura para recordar qué entradas abre o cierra cada uno
    $('#kbOut').addEventListener('toggle', e => {
      const d = e.target;
      if (!d.classList || !d.classList.contains('kb-item') || norm(state.kbQ.trim()).length >= 2) return;
      state.kbOpen.set(d.dataset.id, d.open);
    }, true);
    $('#kSection').addEventListener('change', kbEditorLabels);
    $('#kbForm').addEventListener('submit', saveKb);
    $('#kbDlgClose').addEventListener('click', closeKb);
    $('#kbCancel').addEventListener('click', closeKb);
    $('#kbDelete').addEventListener('click', deleteKb);
    $('#loadKb').addEventListener('click', loadKbSeed);
    kdlg().addEventListener('click', e => { if (e.target === kdlg()) closeKb(); });
    kdlg().addEventListener('close', () => { editingKb = null; });

    // AppXnews
    $('#newPost').addEventListener('click', () => openPost(null));
    $('#newsList').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) openPost(b.dataset.edit); });
    $('#newsChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { state.newsFilter = b.dataset.cat; renderNews(); } });
    $('#rankToggle').addEventListener('change', toggleRanking);
    $('#newsBanner').addEventListener('click', () => switchView('news'));
    $$('.lead-banner').forEach(el => el.addEventListener('click', () => switchView('clientes')));
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

    bindPay();
    bindTeam();

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
