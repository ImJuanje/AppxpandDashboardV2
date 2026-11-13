/* ============================================================
   AppXpand · API de la plataforma (Netlify Functions + Netlify Blobs)
   ------------------------------------------------------------
   Todas las rutas cuelgan de /api/*
   Variables de entorno (Netlify → Site configuration → Environment variables):
     ADMIN_CODE      (obligatoria) tu código de administrador. Mínimo 8 caracteres.
     SESSION_SECRET  (opcional)    clave para firmar sesiones. Si no existe, se
                                   deriva de ADMIN_CODE.
   ============================================================ */
import { getStore } from '@netlify/blobs';
import { createHash, createHmac, timingSafeEqual, randomInt, randomUUID } from 'node:crypto';
import { KB_SEED, KB_PATCHES } from './kb-seed.mjs';

export const config = { path: '/api/*' };

const STATUSES = ['nuevo', 'contactado', 'reunion', 'propuesta', 'ganado', 'perdido'];
const TYPES = ['Peluquería o estética', 'Restaurante o bar', 'Tienda', 'Servicios (reformas, talleres, clínicas…)', 'Otro'];
const SERVICES = ['Página web', 'Optimización de perfil de Google', 'Paquete lanzadera', 'Por definir'];
const CITIES = ['Albacete', 'Ciudad Real', 'Alicante', 'Otra'];
const NEWS_CATS = ['aviso', 'novedad', 'info', 'top'];
const MAX_POSTS = 200;
const KB_SECTIONS = ['servicios', 'objeciones', 'faq', 'precios', 'descuentos', 'cierre', 'normas'];
const KB_GROUPS = ['precio', 'necesidad', 'confianza', 'otras'];   // solo para la sección «objeciones»
const MAX_KB = 300;
const ADMIN = { id: 'admin', name: 'Admin', role: 'admin' };

// Mes natural en hora de España (para el ranking mensual)
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' });
const monthOf = iso => {
  const p = Object.fromEntries(MONTH_FMT.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}`;
};
const HOUR = 3600e3;
const MAX_IMPORT = 150;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- utilidades ---------- */
const sha = s => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isIso = s => typeof s === 'string' && !isNaN(Date.parse(s));
const isId = s => /^[\w-]{1,40}$/.test(s || '');
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function readBody(req) {
  try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; }
  catch { throw new HttpError(400, 'Petición no válida.'); }
}

/* ---------- secretos y sesiones ---------- */
function adminCode() {
  const c = (process.env.ADMIN_CODE || '').trim().toUpperCase();
  if (c.length < 8) throw new HttpError(500, 'Falta configurar la variable ADMIN_CODE en Netlify (mínimo 8 caracteres).');
  return c;
}
const secret = () => process.env.SESSION_SECRET || sha('sess|' + adminCode());

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret()).update(body).digest('base64url');
}
function verify(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEq(sig, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* ---------- usuarios ---------- */
const pub = u => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt || null });

/* La lista se guarda en un índice para no leer un archivo por usuario en cada petición.
   Se invalida (se borra) al crear o dar de baja a alguien. */
async function listUsers(db) {
  const cached = await db.get('idx/users', { type: 'json' });
  if (cached) return cached;
  const { blobs } = await db.list({ prefix: 'u/' });
  const users = await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })));
  const list = users.filter(Boolean).map(pub).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  await db.setJSON('idx/users', list);
  return list;
}
const slug = n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'usuario';

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L
  let r = '';
  for (let i = 0; i < 12; i++) r += A[randomInt(A.length)];
  return `${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8)}`;
}
async function freshCode(db) {
  for (;;) {
    const code = newCode(), h = sha(code);
    if (!(await db.get('h/' + h, { type: 'json' }))) return { code, h };
  }
}

async function createUser(db, name, role) {
  let id = slug(name);
  if (id === 'admin') id = 'admin2';
  const base = id;
  for (let i = 2; await db.get('u/' + id, { type: 'json' }); i++) id = base + i;
  const { code, h } = await freshCode(db);
  const user = { id, name, role, codeHash: h, createdAt: now() };
  await db.setJSON('u/' + id, user);
  await db.setJSON('h/' + h, { id });
  await db.delete('idx/users');
  return { user: pub(user), code };
}

async function resetUser(db, id) {
  const u = await db.get('u/' + id, { type: 'json' });
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');
  const { code, h } = await freshCode(db);
  await db.delete('h/' + u.codeHash);
  u.codeHash = h;
  await db.setJSON('u/' + id, u);
  await db.setJSON('h/' + h, { id });
  return { user: pub(u), code };
}

async function deleteUser(db, id) {
  const u = await db.get('u/' + id, { type: 'json' });
  if (!u) throw new HttpError(404, 'Usuario no encontrado.');
  await db.delete('u/' + id);
  await db.delete('h/' + u.codeHash);
  await db.delete('idx/users');
  await db.delete('r/' + id);
  await db.delete('ben/' + id);
  await db.delete('tp/' + id);
  // su conversación privada con administración desaparece con él
  const { blobs: dm } = await db.list({ prefix: chanPrefix('dm.' + id) });
  await Promise.all(dm.map(b => db.delete(b.key)));
  // sus clientes pasan al administrador
  const t = now();
  const clients = await allClients(db);
  await Promise.all(clients.filter(c => c.owner === id).map(c => {
    c.owner = 'admin';
    c.updatedAt = t;
    c.log = [...(c.log || []), { t, by: 'admin', type: 'estado', text: `Reasignado a ${ADMIN.name} (baja de ${u.name})` }].slice(-200);
    return db.setJSON('c/' + c.id, c);
  }));
}

/* ---------- login ---------- */
async function lockState(db, ip) {
  const l = await db.get('rl/' + ip, { type: 'json' });
  if (l && l.until > Date.now()) throw new HttpError(429, `Demasiados intentos. Espera ${Math.ceil((l.until - Date.now()) / 1000)} s.`);
  return l && Date.now() - (l.t || 0) < 15 * 60e3 ? l : { n: 0 };
}

async function login(req, ctx, db) {
  const { code, remember } = await readBody(req);
  const c = str(code, 64).toUpperCase();
  if (!c) throw new HttpError(400, 'Introduce tu código de alta.');
  const ip = String(ctx?.ip || 'unknown').replace(/[^\w.:-]/g, '_').slice(0, 60);
  const lock = await lockState(db, ip);

  let user = null;
  if (safeEq(sha(c), sha(adminCode()))) user = ADMIN;
  else {
    const ref = await db.get('h/' + sha(c), { type: 'json' });
    const u = ref && (await db.get('u/' + ref.id, { type: 'json' }));
    if (u) user = pub(u);
  }

  if (!user) {
    const n = (lock.n || 0) + 1;
    await db.setJSON('rl/' + ip, n >= 5 ? { n: 0, until: Date.now() + 60e3 } : { n, t: Date.now() });
    throw new HttpError(401, 'Código no válido. Revísalo o pídeselo al administrador.');
  }
  await db.delete('rl/' + ip);
  const exp = Date.now() + (remember ? 14 * 24 * HOUR : 12 * HOUR);
  // «v» ata la sesión al código vigente: si se genera uno nuevo, las sesiones antiguas dejan de valer
  const v = user.id === 'admin' ? sha(adminCode()).slice(0, 8) : sha(c).slice(0, 8);
  return json({ token: sign({ id: user.id, exp, v }), exp, user });
}

async function authenticate(req, db) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '');
  const p = m && verify(m[1]);
  if (!p) throw new HttpError(401, 'Sesión caducada. Vuelve a entrar.');
  if (p.id === 'admin') {
    if (p.v !== sha(adminCode()).slice(0, 8)) throw new HttpError(401, 'Sesión caducada. Vuelve a entrar.');
    return ADMIN;
  }
  const u = await db.get('u/' + p.id, { type: 'json' });
  if (!u || p.v !== u.codeHash.slice(0, 8)) throw new HttpError(401, 'Tu acceso ya no está activo. Vuelve a entrar.');
  return pub(u);
}
const isAdmin = u => u.role === 'admin';

/* ---------- clientes ---------- */
async function allClients(db) {
  const { blobs } = await db.list({ prefix: 'c/' });
  const list = await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })));
  return list.filter(Boolean);
}
async function getClient(db, id, user) {
  if (!isId(id)) throw new HttpError(404, 'Cliente no encontrado.');
  const c = await db.get('c/' + id, { type: 'json' });
  if (!c || (!isAdmin(user) && c.owner !== user.id)) throw new HttpError(404, 'Cliente no encontrado.');
  return c;
}

function cleanFields(b) {
  const business = str(b.business, 120);
  if (!business) throw new HttpError(400, 'El nombre del negocio es obligatorio.');
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El email no parece válido.');
  return {
    business,
    contact: str(b.contact, 80),
    phone: str(b.phone, 30),
    email,
    type: TYPES.includes(b.type) ? b.type : TYPES[4],
    service: SERVICES.includes(b.service) ? b.service : SERVICES[3],
    city: CITIES.includes(b.city) ? b.city : CITIES[3],
    status: STATUSES.includes(b.status) ? b.status : 'nuevo',
    value: Math.min(1e7, Math.max(0, Math.round(Number(b.value) || 0))),
    pack: [3, 6, 12].includes(Number(b.pack)) ? Number(b.pack) : 0,
    packValue: Math.min(1e6, Math.max(0, Math.round((Number(b.packValue) || 0) * 100) / 100)),
    next: isDay(String(b.next || '')) ? String(b.next) : '',
    notes: str(b.notes, 1500)
  };
}

async function resolveOwner(db, user, requested) {
  if (!isAdmin(user)) return user.id;
  const o = str(requested, 40);
  if (o === 'admin') return 'admin';
  if (o && isId(o) && (await db.get('u/' + o, { type: 'json' }))) return o;
  return user.id;
}
const nameOf = async (db, id) => (id === 'admin' ? ADMIN.name : (await db.get('u/' + id, { type: 'json' }))?.name || id);

async function createClient(req, user, db) {
  const b = await readBody(req);
  const f = cleanFields(b);
  const t = now();
  const c = {
    id: 'c' + randomUUID().replace(/-/g, '').slice(0, 16),
    ...f,
    owner: await resolveOwner(db, user, b.owner),
    wonAt: f.status === 'ganado' ? t : '',
    createdAt: t,
    updatedAt: t,
    log: [{ t, by: user.id, type: 'estado', text: 'Cliente creado' }]
  };
  await db.setJSON('c/' + c.id, c);
  return json(c, 201);
}

async function updateClient(req, id, user, db) {
  const cur = await getClient(db, id, user);
  const b = await readBody(req);
  if (b.base && b.base !== cur.updatedAt)
    throw new HttpError(409, 'Este cliente se ha modificado desde otro dispositivo. Se ha cargado la versión más reciente.');
  const f = cleanFields(b);
  const owner = await resolveOwner(db, user, b.owner ?? cur.owner);
  const t = now();
  const log = [...(cur.log || [])];
  if (cur.status !== f.status) log.push({ t, by: user.id, type: 'estado', text: `Estado: ${cur.status} → ${f.status}` });
  if (cur.owner !== owner) log.push({ t, by: user.id, type: 'estado', text: `Reasignado a ${await nameOf(db, owner)}` });
  // wonAt = momento en que el cliente pasó a «ganado» (para el ranking del mes)
  const wonAt = f.status === 'ganado' ? (cur.status === 'ganado' ? cur.wonAt || cur.updatedAt : t) : '';
  const c = { ...cur, ...f, owner, wonAt, updatedAt: t, webNew: false, log: log.slice(-200) };
  await db.setJSON('c/' + id, c);
  return json(c);
}

async function addNote(req, id, user, db) {
  const cur = await getClient(db, id, user);
  const text = str((await readBody(req)).text, 400);
  if (!text) throw new HttpError(400, 'La nota está vacía.');
  const t = now();
  const c = { ...cur, updatedAt: t, log: [...(cur.log || []), { t, by: user.id, type: 'nota', text }].slice(-200) };
  await db.setJSON('c/' + id, c);
  return json(c);
}

async function importClients(req, db) {
  const b = await readBody(req);
  if (!Array.isArray(b.clients)) throw new HttpError(400, 'Formato no válido.');
  if (b.clients.length > MAX_IMPORT) throw new HttpError(413, `Máximo ${MAX_IMPORT} clientes por envío.`);
  const owners = new Set(['admin', ...(await listUsers(db)).map(u => u.id)]);
  const t = now();
  let added = 0, updated = 0, skipped = 0;
  await Promise.all(b.clients.map(async raw => {
    let f;
    try { f = cleanFields(raw || {}); } catch { skipped++; return; }
    const id = str(raw.id, 40).replace(/[^\w-]/g, '') || 'c' + randomUUID().replace(/-/g, '').slice(0, 16);
    const created = isIso(raw.createdAt) ? raw.createdAt : t;
    const upd = isIso(raw.updatedAt) ? raw.updatedAt : created;
    const c = {
      id, ...f,
      owner: owners.has(raw.owner) ? raw.owner : 'admin',
      createdAt: created,
      updatedAt: upd,
      wonAt: f.status === 'ganado' ? (isIso(raw.wonAt) ? raw.wonAt : upd) : '',
      log: Array.isArray(raw.log)
        ? raw.log.slice(-200).map(l => ({
            t: isIso(l?.t) ? l.t : created,
            by: str(l?.by, 40),
            type: l?.type === 'nota' ? 'nota' : 'estado',
            text: str(l?.text, 400)
          }))
        : []
    };
    const cur = await db.get('c/' + id, { type: 'json' });
    if (!cur) { await db.setJSON('c/' + id, c); added++; }
    else if (c.updatedAt > cur.updatedAt) { await db.setJSON('c/' + id, c); updated++; }
    else skipped++;
  }));
  return json({ added, updated, skipped });
}

/* ---------- AppXnews: publicaciones, ajustes y ranking ---------- */
async function allPosts(db) {
  const { blobs } = await db.list({ prefix: 'n/' });
  const list = (await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })))).filter(Boolean);
  return list
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_POSTS);
}

function cleanPost(b) {
  const title = str(b.title, 120);
  if (!title) throw new HttpError(400, 'Escribe un título.');
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!body) throw new HttpError(400, 'Escribe el contenido de la publicación.');
  return { title, body, category: NEWS_CATS.includes(b.category) ? b.category : 'info', pinned: b.pinned === true };
}

async function createPost(req, user, db) {
  const f = cleanPost(await readBody(req));
  const t = now();
  const p = { id: 'n' + randomUUID().replace(/-/g, '').slice(0, 16), ...f, author: user.id, authorName: user.name, createdAt: t, updatedAt: t };
  await db.setJSON('n/' + p.id, p);
  return json(p, 201);
}

async function updatePost(req, id, db) {
  if (!isId(id)) throw new HttpError(404, 'Publicación no encontrada.');
  const cur = await db.get('n/' + id, { type: 'json' });
  if (!cur) throw new HttpError(404, 'Publicación no encontrada.');
  const p = { ...cur, ...cleanPost(await readBody(req)), updatedAt: now() };
  await db.setJSON('n/' + id, p);
  return json(p);
}

/* ---------- Centro de conocimiento (objeciones, FAQ, precios, descuentos…) ----------
   Cada entrada es un archivo «q/<id>» con: section, category (solo objeciones),
   question (título), answer, keywords (sinónimos para el buscador) y order.
   Todos los usuarios las leen (van dentro de /api/sync); solo el admin las edita. */
async function allKb(db) {
  const { blobs } = await db.list({ prefix: 'q/' });
  const list = (await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })))).filter(Boolean);
  return list
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, MAX_KB);
}

function cleanKb(b) {
  const question = str(b.question, 200);
  if (!question) throw new HttpError(400, 'Escribe el título de la entrada.');
  const answer = String(b.answer ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  if (!answer) throw new HttpError(400, 'Escribe el contenido de la entrada.');
  const section = KB_SECTIONS.includes(b.section) ? b.section : 'objeciones';
  const category = section === 'objeciones' ? (KB_GROUPS.includes(b.category) ? b.category : 'otras') : '';
  return { question, answer, section, category, keywords: str(b.keywords, 300) };
}

async function createKb(req, user, db) {
  const f = cleanKb(await readBody(req));
  const list = await allKb(db);
  if (list.length >= MAX_KB) throw new HttpError(400, `Has llegado al máximo de ${MAX_KB} entradas.`);
  const t = now();
  const q = {
    id: 'q' + randomUUID().replace(/-/g, '').slice(0, 16), ...f,
    order: list.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1,
    author: user.id, createdAt: t, updatedAt: t
  };
  await db.setJSON('q/' + q.id, q);
  return json(q, 201);
}

async function updateKb(req, id, db) {
  if (!isId(id)) throw new HttpError(404, 'Entrada no encontrada.');
  const cur = await db.get('q/' + id, { type: 'json' });
  if (!cur) throw new HttpError(404, 'Entrada no encontrada.');
  const q = { ...cur, ...cleanKb(await readBody(req)), updatedAt: now() };
  await db.setJSON('q/' + id, q);
  return json(q);
}

/* Recibe la lista completa de ids en el orden deseado y renumera. Si falta alguna
   (creada a la vez desde otro dispositivo) se queda al final. */
async function reorderKb(req, db) {
  const b = await readBody(req);
  if (!Array.isArray(b.ids)) throw new HttpError(400, 'Formato no válido.');
  const list = await allKb(db);
  const byId = new Map(list.map(f => [f.id, f]));
  const seq = [...new Set(b.ids.filter(isId))].filter(id => byId.has(id));
  const rest = list.map(f => f.id).filter(id => !seq.includes(id));
  await Promise.all([...seq, ...rest].map((id, i) => {
    const f = byId.get(id);
    return f.order === i ? null : db.setJSON('q/' + id, { ...f, order: i });
  }));
  return json(await allKb(db));
}

/* Contenido base (kb-seed.mjs): solo rellena las secciones que estén VACÍAS, así que nunca
   pisa ni duplica lo que ya hayas escrito. Los ids son fijos → repetirlo es inofensivo. */
async function seedKb(db) {
  const list = await allKb(db);
  const filled = new Set(list.map(e => e.section || 'objeciones'));
  const t = now();
  const first = list.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1;
  const todo = KB_SEED.filter(e => !filled.has(e.section));
  await Promise.all(todo.map((e, i) =>
    db.setJSON('q/' + e.id, { ...e, order: first + i, author: 'admin', createdAt: t, updatedAt: t })));
  await db.setJSON('s/kb-seeded', { at: t });
  return todo.length;
}

/* La primera vez que alguien entra y no hay nada, se carga el contenido base. Después, si
   borras entradas a propósito, no vuelve a aparecer solo. */
async function loadKb(db) {
  let list = await allKb(db);
  if (!list.length && !(await db.get('s/kb-seeded', { type: 'json' }))) {
    await seedKb(db);
    list = await allKb(db);
  }
  if (await applyKbPatches(db, list)) list = await allKb(db);
  return list;
}

/* Novedades de contenido (KB_PATCHES): se añaden una sola vez por «key» y quedan marcadas,
   así no pisan nada y, si las borras, no vuelven. Entran al principio de su sección. */
async function applyKbPatches(db, list) {
  let changed = false;
  const byId = new Map(list.map(e => [e.id, e]));
  for (const p of KB_PATCHES) {
    const flag = 's/kb-patch-' + p.key;
    if (await db.get(flag, { type: 'json' })) continue;
    const t = now(), base = p.base ?? -100;
    await Promise.all((p.entries || []).filter(e => !byId.has(e.id)).map((e, i) =>
      db.setJSON('q/' + e.id, { ...e, order: base + i, author: 'admin', createdAt: t, updatedAt: t })));
    // «updates»: se reescribe la entrada con el texto actual del contenido base, pero SOLO si
    // nadie la ha editado a mano (updatedAt == createdAt). Lo editado por ti nunca se pisa.
    await Promise.all((p.updates || []).map(id => {
      const cur = byId.get(id), src = KB_SEED.find(e => e.id === id);
      if (!cur || !src || cur.updatedAt !== cur.createdAt) return null;
      return db.setJSON('q/' + id, { ...cur, question: src.question, answer: src.answer, keywords: src.keywords });
    }));
    await db.setJSON(flag, { at: t });
    changed = true;
  }
  return changed;
}

async function getSettings(db) {
  const s = await db.get('s/settings', { type: 'json' });
  return { showRanking: s ? s.showRanking !== false : true };
}

/* Top comerciales del mes: clientes que pasaron a «ganado» este mes. Solo cuenta a los
   comerciales (no al admin). A los comerciales se les oculta el importe. */
function buildRanking(clients, users, forAdmin) {
  const month = monthOf(now());
  const by = new Map();
  for (const c of clients) {
    if (c.status !== 'ganado' || monthOf(c.wonAt || c.updatedAt) !== month) continue;
    const u = users.find(x => x.id === c.owner && x.role === 'comercial');
    if (!u) continue;
    const e = by.get(u.id) || { id: u.id, name: u.name, won: 0, value: 0 };
    e.won++;
    e.value += Number(c.value) || 0;
    by.set(u.id, e);
  }
  const list = [...by.values()]
    .sort((a, b) => b.won - a.won || b.value - a.value || a.name.localeCompare(b.name, 'es'))
    .slice(0, 5);
  return { month, list: forAdmin ? list : list.map(({ value, ...r }) => r) };
}

/* ---------- Chat interno ----------
   Dos tipos de conversación:
     «general»     → todo el equipo
     «dm.<id>»     → privada entre un comercial y la administración
   No existen chats entre comerciales. Cada mensaje es un archivo propio (sin conflictos
   de escritura) con clave «<ms 13 cifras>-<emisor>-<aleatorio>», que ordena por fecha. */
const CHAT_MAX_KEEP = 500;   // al superar esto se borran los más antiguos…
const CHAT_PRUNE_TO = 400;   // …hasta dejar este número
const CHAT_PAGE = 50;
const CHAT_TEXT = 1000;
let lastKeyTs = 0;

const chanPrefix = ch => 'm/' + ch + '/';
const isChatKey = k => /^\d{13}-[a-z0-9_]{1,30}-[0-9a-f]{6}$/.test(k || '');
const keyTs = k => Number(k.slice(0, 13));
const keySender = k => k.split('-')[1];
function chatKey(from) {
  const ts = Math.max(Date.now(), lastKeyTs + 1);
  lastKeyTs = ts;
  return `${String(ts).padStart(13, '0')}-${from}-${randomUUID().slice(0, 6)}`;
}

/* Conversaciones a las que tiene acceso este usuario */
async function chatChannels(user, db) {
  const general = { id: 'general', name: 'General', kind: 'general' };
  if (!isAdmin(user)) return [general, { id: 'dm.' + user.id, name: 'Administración', kind: 'dm' }];
  const reps = (await listUsers(db)).filter(u => u.role === 'comercial');
  return [general, ...reps.map(u => ({ id: 'dm.' + u.id, name: u.name, kind: 'dm' }))];
}
async function chatChannel(user, db, id) {
  const ch = (await chatChannels(user, db)).find(c => c.id === id);
  if (!ch) throw new HttpError(403, 'No tienes acceso a esa conversación.');
  return ch;
}
async function chanKeys(db, ch) {
  const p = chanPrefix(ch);
  const { blobs } = await db.list({ prefix: p });
  return blobs.map(b => b.key.slice(p.length)).filter(isChatKey).sort();
}
async function loadEvents(db, ch, keys) {
  const items = await Promise.all(keys.map(async k => [k, await db.get(chanPrefix(ch) + k, { type: 'json' })]));
  return items.filter(([, v]) => v).map(([k, v]) => (keySender(k) === '_del' ? { type: 'del', id: k, target: v.target } : { type: 'msg', ...v }));
}

async function chatPoll(user, db, url) {
  const chans = await chatChannels(user, db);
  const openId = url.searchParams.get('open') || '';
  if (openId && !chans.some(c => c.id === openId)) throw new HttpError(403, 'No tienes acceso a esa conversación.');
  const after = url.searchParams.get('after') || '';
  if (after && !isChatKey(after)) throw new HttpError(400, 'Cursor no válido.');

  const reads = (await db.get('r/' + user.id, { type: 'json' })) || {};
  const keysBy = await Promise.all(chans.map(c => chanKeys(db, c.id)));
  let dirty = false;

  const channels = chans.map((c, i) => {
    const keys = keysBy[i];
    const newest = keys.at(-1) || '';
    // el general empieza «leído» la primera vez; las privadas cuentan todo desde el principio
    if (reads[c.id] === undefined && c.kind === 'general') { reads[c.id] = newest; dirty = true; }
    if (c.id === openId && newest > (reads[c.id] || '')) { reads[c.id] = newest; dirty = true; }
    const rd = reads[c.id] || '';
    const unread = keys.filter(k => k > rd && keySender(k) !== user.id && keySender(k) !== '_del').length;
    const last = [...keys].reverse().find(k => keySender(k) !== '_del');
    return { id: c.id, name: c.name, kind: c.kind, unread, lastTs: last ? keyTs(last) : 0 };
  });
  if (dirty) await db.setJSON('r/' + user.id, reads);

  let open = null;
  if (openId) {
    const keys = keysBy[chans.findIndex(c => c.id === openId)];
    let pick, hasMore = false;
    if (after) pick = keys.filter(k => k > after);
    else {
      const msgs = keys.filter(k => keySender(k) !== '_del');
      hasMore = msgs.length > CHAT_PAGE;
      pick = msgs.slice(-CHAT_PAGE);
    }
    open = { id: openId, events: await loadEvents(db, openId, pick), cursor: keys.at(-1) || after, hasMore };
  }
  return json({ channels, open });
}

async function chatHistory(user, db, url) {
  const channel = url.searchParams.get('channel') || '';
  await chatChannel(user, db, channel);
  const before = url.searchParams.get('before') || '';
  if (!isChatKey(before)) throw new HttpError(400, 'Cursor no válido.');
  const keys = (await chanKeys(db, channel)).filter(k => keySender(k) !== '_del' && k < before);
  const pick = keys.slice(-CHAT_PAGE);
  return json({ events: await loadEvents(db, channel, pick), hasMore: keys.length > pick.length });
}

async function chatSend(req, user, db) {
  const b = await readBody(req);
  const channel = str(b.channel, 60);
  await chatChannel(user, db, channel);
  const text = String(b.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, CHAT_TEXT);
  if (!text) throw new HttpError(400, 'El mensaje está vacío.');
  const key = chatKey(user.id);
  const msg = { id: key, channel, ts: keyTs(key), from: user.id, fromName: user.name, fromRole: user.role, text };
  await db.setJSON(chanPrefix(channel) + key, msg);
  const keys = await chanKeys(db, channel);
  if (keys.length > CHAT_MAX_KEEP)
    await Promise.all(keys.slice(0, keys.length - CHAT_PRUNE_TO).map(k => db.delete(chanPrefix(channel) + k)));
  return json({ type: 'msg', ...msg }, 201);
}

/* Cada quien borra los suyos; el admin, cualquiera. Deja una «lápida» para que las demás
   pantallas lo quiten también la próxima vez que preguntan. */
async function chatDelete(user, db, channel, key) {
  await chatChannel(user, db, channel);
  if (!isChatKey(key) || keySender(key) === '_del') throw new HttpError(404, 'Mensaje no encontrado.');
  const msg = await db.get(chanPrefix(channel) + key, { type: 'json' });
  if (!msg) throw new HttpError(404, 'Mensaje no encontrado.');
  if (!isAdmin(user) && msg.from !== user.id) throw new HttpError(403, 'Solo puedes borrar tus mensajes.');
  await db.delete(chanPrefix(channel) + key);
  await db.setJSON(chanPrefix(channel) + chatKey('_del'), { target: key, by: user.id });
  return json({ ok: true });
}

/* ---------- enrutado ---------- */
/* ============================================================
   Comisiones, gastos y pagos
   ------------------------------------------------------------
   REGLAS (edítalas aquí si cambian):
   · Ciclo de pago: del día 29 al 28 (se paga el 28; el 29 se vuelve al tramo del 20 %).
   · Tramo según nº de ventas «ganado» del comercial en el ciclo.
   · retroactive = true  → el tramo alcanzado se aplica a TODAS las ventas del ciclo.
     retroactive = false → cada venta cobra el % del tramo de su posición (1.ª–5.ª al 20 %, 6.ª–10.ª al 25 %…).
   · Packs de mantenimiento prepago: se comisiona solo la parte de N meses (3→1, 6→2, 12→3).
   ============================================================ */
const PAY = {
  payDay: 28,
  retroactive: true,
  tiers: [{ to: 5, rate: 0.20 }, { to: 10, rate: 0.25 }, { to: 15, rate: 0.30 }, { to: Infinity, rate: 0.35 }],
  packCredit: { 3: 1, 6: 2, 12: 3 },
  maxExpense: 2000,
  maxAgeDays: 62,
  // Gastos que se desbloquean con el rendimiento (ventas en el ciclo actual o en el anterior) y tope por ciclo
  cats: {
    gasolina:     { label: 'Gasolina y peajes',                icon: '⛽', minSales: 1,  cap: 150 },
    tren:         { label: 'Tren, bus o taxi',                 icon: '🚆', minSales: 1,  cap: 150 },
    material:     { label: 'Material comercial',               icon: '🖨️', minSales: 1,  cap: 60 },
    dietas:       { label: 'Dietas y comidas con clientes',    icon: '🍽️', minSales: 3,  cap: 100 },
    evento:       { label: 'Eventos y networking',             icon: '🤝', minSales: 3,  cap: 80 },
    alojamiento:  { label: 'Alojamiento',                      icon: '🏨', minSales: 6,  cap: 120 },
    formacion:    { label: 'Formación',                        icon: '🎓', minSales: 6,  cap: 150 },
    otro:         { label: 'Otro gasto justificado',           icon: '📦', minSales: 6,  cap: 50 },
    herramientas: { label: 'Teléfono, internet o herramientas', icon: '📱', minSales: 10, cap: 40 }
  }
};
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_B64 = 2_800_000;

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sum = (list, f = x => x.amount) => r2(list.reduce((a, x) => a + (Number(f(x)) || 0), 0));
const rateFor = n => (PAY.tiers.find(t => n <= t.to) || PAY.tiers[PAY.tiers.length - 1]).rate;
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = iso => DAY_FMT.format(new Date(iso));
const dayAdd = (d, k) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + k)).toISOString().slice(0, 10); };
function cycleOf(day) {
  const [y, m0, d] = day.split('-').map(Number);
  const m = d > PAY.payDay ? m0 + 1 : m0;
  const end = new Date(Date.UTC(y, m - 1, PAY.payDay)).toISOString().slice(0, 10);
  const prevEnd = new Date(Date.UTC(y, m - 2, PAY.payDay)).toISOString().slice(0, 10);
  return { start: dayAdd(prevEnd, 1), end };
}

async function listPrefix(db, prefix) {
  const { blobs } = await db.list({ prefix });
  return (await Promise.all(blobs.map(b => db.get(b.key, { type: 'json' })))).filter(Boolean);
}
const loadPayData = async db => {
  const [clients, expenses, adjs, payouts, users, ben] = await Promise.all([
    allClients(db), listPrefix(db, 'x/'), listPrefix(db, 'adj/'), listPrefix(db, 'po/'), listUsers(db), listPrefix(db, 'ben/')
  ]);
  return { clients, expenses, adjs, payouts, ben, users: users.filter(u => u.role === 'comercial') };
};

/* Líneas de comisión de todas las ventas ganadas (de comerciales), con su ciclo y su tramo */
function saleLines(clients, ownerIds) {
  const groups = new Map();
  for (const c of clients) {
    if (c.status !== 'ganado' || !ownerIds.has(c.owner)) continue;
    const at = c.wonAt || c.updatedAt;
    const key = c.owner + '|' + cycleOf(dayOf(at)).end;
    (groups.get(key) || groups.set(key, []).get(key)).push({ c, at });
  }
  const out = [];
  for (const [key, arr] of groups) {
    const [owner, cycleEnd] = key.split('|');
    arr.sort((a, b) => a.at.localeCompare(b.at));
    arr.forEach(({ c, at }, i) => {
      const n = arr.length, rate = PAY.retroactive ? rateFor(n) : rateFor(i + 1);
      const pack = Number(c.pack) || 0, credit = PAY.packCredit[pack] || 0, packValue = Number(c.packValue) || 0;
      const packBase = pack && credit ? r2(packValue * credit / pack) : 0;
      const value = Number(c.value) || 0, base = r2(value + packBase);
      out.push({ kind: 'comision', clientId: c.id, business: c.business, owner, day: dayOf(at), cycleEnd, n, ordinal: i + 1,
        rate, value, pack, packValue, packCredit: credit, packBase, base, amount: r2(base * rate) });
    });
  }
  return out;
}

const capUsed = (expenses, owner, cat, cycleEnd) => sum(
  expenses.filter(e => e.owner === owner && e.cat === cat && e.status !== 'rechazado' && cycleOf(e.date).end === cycleEnd),
  e => (e.status === 'aprobado' ? e.approvedAmount : e.amount)
);

function personPay(u, d, today, lines) {
  const cur = cycleOf(today), prev = cycleOf(dayAdd(cur.start, -1));
  const mine = lines.filter(l => l.owner === u.id);
  const paid = new Set(d.payouts.filter(p => p.owner === u.id).flatMap(p => p.lines.filter(l => l.kind === 'comision').map(l => l.clientId)));
  const comm = mine.filter(l => !paid.has(l.clientId)).map(l => ({ ...l, open: l.cycleEnd > today }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const exp = d.expenses.filter(e => e.owner === u.id && e.status === 'aprobado' && !e.payoutId)
    .map(e => ({ kind: 'gasto', id: e.id, cat: e.cat, concept: e.concept, day: e.date, amount: e.approvedAmount }));
  const adj = d.adjs.filter(a => a.owner === u.id && !a.payoutId)
    .map(a => ({ kind: 'ajuste', id: a.id, concept: a.concept, day: a.day, amount: a.amount }));
  const salesCycle = mine.filter(l => l.cycleEnd === cur.end).length;
  const salesPrev = mine.filter(l => l.cycleEnd === prev.end).length;
  const idx = PAY.tiers.findIndex(t => salesCycle <= t.to);
  const next = PAY.tiers[idx + 1] ? { need: PAY.tiers[idx].to + 1 - salesCycle, rate: PAY.tiers[idx + 1].rate } : null;
  const eligible = Math.max(salesCycle, salesPrev);
  const modes = ((d.ben || []).find(b => b.owner === u.id) || {}).modes || {};
  return {
    id: u.id, name: u.name, salesCycle, salesPrev, rate: rateFor(salesCycle), next,
    due: r2(sum(comm.filter(l => !l.open)) + sum(exp) + sum(adj)),
    accrued: sum(comm.filter(l => l.open)),
    commissions: comm, expenses: exp, adjustments: adj,
    cats: Object.entries(PAY.cats).map(([id, c]) => {
      const mode = modes[id] || 'auto', perf = eligible >= c.minSales;
      return { id, ...c, mode, auto: perf, eligible: mode === 'on' || (mode !== 'off' && perf), used: capUsed(d.expenses, u.id, id, cur.end) };
    })
  };
}

async function buildPay(db, user) {
  const d = await loadPayData(db);
  const today = dayOf(now()), cycle = cycleOf(today);
  const admin = isAdmin(user);
  const team = admin ? d.users : d.users.filter(u => u.id === user.id);
  const lines = saleLines(d.clients, new Set(team.map(u => u.id)));
  const people = team.map(u => personPay(u, d, today, lines));
  const names = new Map(d.users.map(u => [u.id, u.name]));
  const mineOnly = x => admin || x.owner === user.id;
  const expenses = d.expenses.filter(mineOnly)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 150)
    .map(e => ({ ...e, ownerName: names.get(e.owner) || e.owner }));
  const payouts = d.payouts.filter(mineOnly).sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 80);
  return {
    today, cycle,
    rules: {
      payDay: PAY.payDay, retroactive: PAY.retroactive, packCredit: PAY.packCredit, maxExpense: PAY.maxExpense,
      tiers: PAY.tiers.map(t => ({ to: t.to === Infinity ? null : t.to, rate: t.rate })),
      cats: Object.entries(PAY.cats).map(([id, c]) => ({ id, ...c }))
    },
    people, expenses, payouts,
    totals: { due: sum(people, p => p.due), accrued: sum(people, p => p.accrued) }
  };
}

/* Índice de gastos pendientes de aprobar (para el aviso de la pestaña) */
async function pendingIds(db) {
  const idx = await db.get('idx/xp', { type: 'json' });
  if (idx) return idx;
  const ids = (await listPrefix(db, 'x/')).filter(e => e.status === 'pendiente').map(e => e.id);
  await db.setJSON('idx/xp', ids);
  return ids;
}
async function setPending(db, id, on) {
  const ids = (await pendingIds(db)).filter(x => x !== id);
  if (on) ids.push(id);
  await db.setJSON('idx/xp', ids);
}

async function createExpense(req, user, db) {
  if (isAdmin(user)) throw new HttpError(403, 'Los gastos los registran los comerciales.');
  const b = await readBody(req);
  const cat = PAY.cats[b.cat];
  if (!cat) throw new HttpError(400, 'Elige el tipo de gasto.');
  const concept = str(b.concept, 100);
  if (concept.length < 3) throw new HttpError(400, 'Describe el gasto (qué fue y para qué cliente o visita).');
  const amount = r2(Number(b.amount));
  if (!(amount > 0) || amount > PAY.maxExpense) throw new HttpError(400, `El importe debe estar entre 0,01 € y ${PAY.maxExpense} €.`);
  const today = dayOf(now()), date = str(b.date, 10);
  if (!isDay(date) || date > today) throw new HttpError(400, 'La fecha del gasto no es válida (no puede ser futura).');
  if (date < dayAdd(today, -PAY.maxAgeDays)) throw new HttpError(400, `Solo se aceptan gastos de los últimos ${PAY.maxAgeDays} días.`);
  const f = b.file;
  if (!f || !FILE_TYPES.includes(f.type) || typeof f.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(f.data))
    throw new HttpError(400, 'Adjunta el justificante (foto o PDF del ticket o factura).');
  if (f.data.length > MAX_FILE_B64) throw new HttpError(413, 'El justificante pesa demasiado (máx. 2 MB).');

  const d = await loadPayData(db);
  const lines = saleLines(d.clients, new Set([user.id]));
  const p = personPay({ id: user.id, name: user.name }, d, today, lines);
  const row = p.cats.find(c => c.id === b.cat);
  if (row.mode === 'off') throw new HttpError(403, `«${cat.label}» está desactivado para ti. Consúltalo con administración.`);
  if (!row.eligible) throw new HttpError(403, `«${cat.label}» se desbloquea al llegar a ${cat.minSales} ${cat.minSales === 1 ? 'venta' : 'ventas'} (en este ciclo o en el anterior). Llevas ${Math.max(p.salesCycle, p.salesPrev)}.`);
  const used = capUsed(d.expenses, user.id, b.cat, cycleOf(date).end);
  if (used + amount > cat.cap + 1e-9)
    throw new HttpError(409, `Superas el tope de «${cat.label}» para ese ciclo (${cat.cap} €; ya llevas ${used.toFixed(2).replace('.', ',')} € entre aprobados y pendientes).`);

  const id = 'x' + randomUUID().replace(/-/g, '').slice(0, 16);
  const e = {
    id, owner: user.id, cat: b.cat, concept, amount, date, note: str(b.note, 500),
    fileName: str(f.name, 80).replace(/[^\w. -]/g, '_') || 'justificante', fileType: f.type,
    status: 'pendiente', approvedAmount: 0, adminNote: '', decidedAt: '', decidedBy: '', payoutId: '', createdAt: now()
  };
  await db.setJSON('xf/' + id, { type: f.type, data: f.data });
  await db.setJSON('x/' + id, e);
  await setPending(db, id, true);
  return json(e, 201);
}

async function decideExpense(req, id, user, db) {
  if (!isId(id)) throw new HttpError(404, 'Gasto no encontrado.');
  const e = await db.get('x/' + id, { type: 'json' });
  if (!e) throw new HttpError(404, 'Gasto no encontrado.');
  if (e.payoutId) throw new HttpError(409, 'Este gasto ya está liquidado y no se puede cambiar.');
  const b = await readBody(req);
  const adminNote = str(b.adminNote, 300);
  if (b.decision === 'aprobado') {
    const amt = r2(b.approvedAmount ?? e.amount);
    if (!(amt > 0) || amt > e.amount) throw new HttpError(400, 'El importe aprobado debe ser mayor que 0 y no superar lo solicitado.');
    Object.assign(e, { status: 'aprobado', approvedAmount: amt, adminNote });
  } else if (b.decision === 'rechazado') {
    if (adminNote.length < 3) throw new HttpError(400, 'Indica el motivo del rechazo para que el comercial lo vea.');
    Object.assign(e, { status: 'rechazado', approvedAmount: 0, adminNote });
  } else if (b.decision === 'pendiente') {
    Object.assign(e, { status: 'pendiente', approvedAmount: 0, adminNote: '' });
  } else throw new HttpError(400, 'Decisión no válida.');
  e.decidedAt = e.status === 'pendiente' ? '' : now();
  e.decidedBy = e.status === 'pendiente' ? '' : user.id;
  await db.setJSON('x/' + id, e);
  await setPending(db, id, e.status === 'pendiente');
  return json(e);
}

async function deleteExpense(id, user, db) {
  if (!isId(id)) throw new HttpError(404, 'Gasto no encontrado.');
  const e = await db.get('x/' + id, { type: 'json' });
  if (!e || (!isAdmin(user) && e.owner !== user.id)) throw new HttpError(404, 'Gasto no encontrado.');
  if (e.payoutId) throw new HttpError(409, 'Este gasto ya está liquidado.');
  if (!isAdmin(user) && e.status !== 'pendiente') throw new HttpError(409, 'Solo puedes retirar gastos que aún están pendientes.');
  await db.delete('x/' + id);
  await db.delete('xf/' + id);
  await setPending(db, id, false);
  return json({ ok: true });
}

async function expenseFile(id, user, db) {
  if (!isId(id)) throw new HttpError(404, 'Justificante no encontrado.');
  const e = await db.get('x/' + id, { type: 'json' });
  if (!e || (!isAdmin(user) && e.owner !== user.id)) throw new HttpError(404, 'Justificante no encontrado.');
  const f = await db.get('xf/' + id, { type: 'json' });
  if (!f) throw new HttpError(404, 'Justificante no encontrado.');
  return new Response(Buffer.from(f.data, 'base64'), {
    headers: { 'Content-Type': f.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }
  });
}

async function createAdjustment(req, db) {
  const b = await readBody(req);
  const u = isId(b.owner) && (await db.get('u/' + b.owner, { type: 'json' }));
  if (!u || u.role !== 'comercial') throw new HttpError(400, 'Elige un comercial.');
  const concept = str(b.concept, 100), amount = r2(Number(b.amount));
  if (concept.length < 3) throw new HttpError(400, 'Escribe el concepto del ajuste.');
  if (!amount || Math.abs(amount) > 10000) throw new HttpError(400, 'Importe no válido (puede ser negativo para descontar).');
  const a = { id: 'a' + randomUUID().replace(/-/g, '').slice(0, 16), owner: u.id, concept, amount, day: dayOf(now()), payoutId: '', createdAt: now() };
  await db.setJSON('adj/' + a.id, a);
  return json(a, 201);
}
/* Beneficios por comercial: auto (por rendimiento) · on (activado) · off (desactivado). cat '*' = todos */
async function setBenefit(req, db) {
  const b = await readBody(req);
  const u = isId(b.owner) && (await db.get('u/' + b.owner, { type: 'json' }));
  if (!u || u.role !== 'comercial') throw new HttpError(400, 'Elige un comercial.');
  if (b.cat !== '*' && !PAY.cats[b.cat]) throw new HttpError(400, 'Beneficio no válido.');
  if (!['auto', 'on', 'off'].includes(b.mode)) throw new HttpError(400, 'Modo no válido.');
  const cur = (await db.get('ben/' + u.id, { type: 'json' })) || { owner: u.id, modes: {} };
  for (const id of b.cat === '*' ? Object.keys(PAY.cats) : [b.cat]) {
    if (b.mode === 'auto') delete cur.modes[id]; else cur.modes[id] = b.mode;
  }
  await db.setJSON('ben/' + u.id, cur);
  return json(cur);
}
async function deleteAdjustment(id, db) {
  if (!isId(id)) throw new HttpError(404, 'Ajuste no encontrado.');
  const a = await db.get('adj/' + id, { type: 'json' });
  if (!a) throw new HttpError(404, 'Ajuste no encontrado.');
  if (a.payoutId) throw new HttpError(409, 'Este ajuste ya está liquidado.');
  await db.delete('adj/' + id);
  return json({ ok: true });
}

/* Marca como pagado lo que se le debe a un comercial: comisiones de ciclos ya cerrados (hasta hoy),
   gastos aprobados y ajustes. Guarda una «foto» con el desglose. */
async function createPayout(req, db) {
  const b = await readBody(req);
  const d = await loadPayData(db);
  const u = d.users.find(x => x.id === b.owner);
  if (!u) throw new HttpError(400, 'Elige un comercial.');
  const today = dayOf(now());
  const p = personPay(u, d, today, saleLines(d.clients, new Set([u.id])));
  const lines = [...p.commissions.filter(l => !l.open), ...p.expenses, ...p.adjustments];
  if (!lines.length) throw new HttpError(400, 'No hay nada que liquidar ahora mismo.');
  const total = sum(lines);
  const id = 'p' + randomUUID().replace(/-/g, '').slice(0, 16);
  const po = { id, owner: u.id, ownerName: u.name, paidAt: now(), day: today, total, note: str(b.note, 200), lines };
  await db.setJSON('po/' + id, po);
  await Promise.all([
    ...p.expenses.map(l => db.get('x/' + l.id, { type: 'json' }).then(e => e && db.setJSON('x/' + l.id, { ...e, payoutId: id }))),
    ...p.adjustments.map(l => db.get('adj/' + l.id, { type: 'json' }).then(a => a && db.setJSON('adj/' + l.id, { ...a, payoutId: id })))
  ]);
  return json({ ok: true, payout: po }, 201);
}

/* ---------- Equipo en la web: perfil público y disponibilidad para citas ---------- */
const keyOk = req => {
  const k = (process.env.AGENDA_KEY || '').trim(), g = String(req.headers.get('x-agenda-key') || '');
  return k.length >= 16 && g.length === k.length && timingSafeEqual(Buffer.from(g), Buffer.from(k));
};
const tpDefaults = (id, name) => ({ id, name: id === 'admin' ? '' : name, zone: '', bio: '', photo: '', email: '', show: false, days: [1, 2, 3, 4, 5], from: '17:00', to: '19:00' });
const getTp = async (db, id, name) => ({ ...tpDefaults(id, name), ...((await db.get('tp/' + id, { type: 'json' })) || {}), id });
const teamPeople = async db => [{ id: 'admin', name: '' }, ...(await listUsers(db)).filter(u => u.role === 'comercial')];

async function teamList(db) {
  return Promise.all((await teamPeople(db)).map(async p => ({ ...(await getTp(db, p.id, p.name)), userName: p.name || 'Tú (administración)' })));
}
async function teamSave(req, id, db) {
  const known = (await teamPeople(db)).find(p => p.id === id);
  if (!known) throw new HttpError(404, 'Persona no encontrada.');
  const b = await readBody(req), cur = await getTp(db, id, known.name);
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const from = String(b.from || ''), to = String(b.to || '');
  if (!hhmm.test(from) || !hhmm.test(to) || from >= to) throw new HttpError(400, 'Revisa el horario: la hora de inicio debe ser anterior a la de fin.');
  if (b.show && !days.length) throw new HttpError(400, 'Marca al menos un día disponible.');
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El email no parece válido.');
  const name = str(b.name, 40);
  if (b.show && (!name || !email)) throw new HttpError(400, 'Para mostrarlo en la web necesita nombre público y email (el email no se publica, solo se usa para avisarle de las citas).');
  let photo = cur.photo;
  if (b.photo === '') photo = '';
  else if (typeof b.photo === 'string') {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > 90000) throw new HttpError(400, 'La foto no es válida o pesa demasiado.');
    photo = b.photo;
  }
  const tp = { id, name, zone: str(b.zone, 60), bio: str(b.bio, 160), photo, email, show: !!b.show, days, from, to };
  await db.setJSON('tp/' + id, tp);
  return json({ ...tp, userName: known.name || 'Tú (administración)' });
}

/* Público: quién sale en la web. Con la clave de la agenda (llamada servidor a servidor) incluye también el email. */
async function publicTeam(req, db) {
  const withEmail = keyOk(req), out = [];
  for (const p of await teamPeople(db)) {
    const t = await getTp(db, p.id, p.name);
    if (!t.show || !t.name) continue;
    const pubT = { id: t.id, name: t.name, zone: t.zone, bio: t.bio, photo: t.photo, days: t.days, from: t.from, to: t.to };
    if (withEmail) pubT.email = t.email;
    out.push(pubT);
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': withEmail ? 'no-store' : 'public, max-age=60' } });
}

/* Servidor a servidor: una cita agendada en la web crea el lead asignado a esa persona */
async function publicLead(req, db) {
  if (!keyOk(req)) throw new HttpError(401, 'No autorizado.');
  const b = await readBody(req);
  const rep = b.rep === 'admin' ? 'admin' : (isId(b.rep) && (await db.get('u/' + b.rep, { type: 'json' }))?.role === 'comercial' ? b.rep : '');
  if (!rep) throw new HttpError(400, 'Responsable no válido.');
  const t = now();
  let f, extra, logText;
  if (b.mode === 'request') {
    // Solicitud desde el formulario del asistente: ficha nueva, con aviso para quien la lleva
    const name = str(b.name, 80), msg = str(b.message, 600);
    if (name.length < 2) throw new HttpError(400, 'Falta el nombre.');
    f = cleanFields({
      business: str(b.business, 120) || name, contact: name, phone: str(b.phone, 30), email: str(b.email, 120),
      status: 'nuevo',
      notes: msg ? `Mensaje del cliente desde la web: ${msg}` : 'Solicitud de cita desde la web (sin mensaje).'
    });
    extra = { source: 'web', webNew: true };
    logText = 'Solicitud de cita recibida desde la web';
  } else {
    const when = Date.parse(b.when);
    f = cleanFields({
      business: str(b.name, 120), contact: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 120),
      status: 'reunion', next: isNaN(when) ? '' : dayOf(new Date(when).toISOString()),
      notes: `Cita agendada desde la web: ${str(b.label, 80)}.${b.meet ? ' Meet: ' + str(b.meet, 120) : ''}`
    });
    extra = { source: 'web', webNew: true };
    logText = 'Lead creado desde la web (cita agendada)';
  }
  const c = { id: 'c' + randomUUID().replace(/-/g, '').slice(0, 16), ...f, ...extra, owner: rep, wonAt: '', createdAt: t, updatedAt: t,
    log: [{ t, by: 'web', type: 'estado', text: logText }] };
  await db.setJSON('c/' + c.id, c);
  return json({ ok: true, id: c.id }, 201);
}

export default async (req, ctx) => {
  try {
    const db = getStore({ name: 'crm', consistency: 'strong' });
    const [res, id, sub] = new URL(req.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const m = req.method;

    if (res === 'login' && m === 'POST') return await login(req, ctx, db);

    if (res === 'public') {
      if (id === 'team' && m === 'GET') return await publicTeam(req, db);
      if (id === 'lead' && m === 'POST') return await publicLead(req, db);
      throw new HttpError(404, 'Ruta no encontrada.');
    }

    const user = await authenticate(req, db);
    const admin = isAdmin(user);
    const needAdmin = () => { if (!admin) throw new HttpError(403, 'Solo el administrador puede hacer esto.'); };

    if (res === 'sync' && m === 'GET') {
      const settings = await getSettings(db);
      const wantRanking = admin || settings.showRanking;
      const [users, clients, posts, kb] = await Promise.all([
        wantRanking ? listUsers(db) : [],
        allClients(db),
        allPosts(db),
        loadKb(db)
      ]);
      return json({
        user,
        users: admin ? [ADMIN, ...users] : [user],
        clients: admin ? clients : clients.filter(c => c.owner === user.id),
        posts,
        kb,
        settings,
        ranking: wantRanking ? buildRanking(clients, users, admin) : null,
        payPending: admin ? (await pendingIds(db)).length : 0
      });
    }

    if (res === 'news') {
      if (!id && m === 'POST') { needAdmin(); return await createPost(req, user, db); }
      if (id && !sub && m === 'PUT') { needAdmin(); return await updatePost(req, id, db); }
      if (id && !sub && m === 'DELETE') {
        needAdmin();
        if (!isId(id)) throw new HttpError(404, 'Publicación no encontrada.');
        await db.delete('n/' + id);
        return json({ ok: true });
      }
    }

    if (res === 'kb') {
      needAdmin();
      if (!id && m === 'POST') return await createKb(req, user, db);
      if (id === 'reorder' && !sub && m === 'POST') return await reorderKb(req, db);
      if (id === 'seed' && !sub && m === 'POST') { const added = await seedKb(db); return json({ added, kb: await allKb(db) }); }
      if (id && !sub && m === 'PUT') return await updateKb(req, id, db);
      if (id && !sub && m === 'DELETE') {
        if (!isId(id)) throw new HttpError(404, 'Entrada no encontrada.');
        await db.delete('q/' + id);
        return json({ ok: true });
      }
    }

    if (res === 'settings' && m === 'PUT') {
      needAdmin();
      const b = await readBody(req);
      await db.setJSON('s/settings', { showRanking: b.showRanking !== false });
      return json(await getSettings(db));
    }

    if (res === 'clients') {
      if (!id && m === 'POST') return await createClient(req, user, db);
      if (!id && m === 'DELETE') {
        needAdmin();
        const { blobs } = await db.list({ prefix: 'c/' });
        await Promise.all(blobs.map(b => db.delete(b.key)));
        return json({ ok: true, deleted: blobs.length });
      }
      if (id && sub === 'seen' && m === 'POST') {
        const cur = await getClient(db, id, user);
        if (cur.webNew) { cur.webNew = false; await db.setJSON('c/' + id, cur); }
        return json({ ok: true });
      }
      if (id && !sub && m === 'PUT') return await updateClient(req, id, user, db);
      if (id && !sub && m === 'DELETE') { await getClient(db, id, user); await db.delete('c/' + id); return json({ ok: true }); }
      if (id && sub === 'notes' && m === 'POST') return await addNote(req, id, user, db);
    }

    if (res === 'pay') {
      if (!id && m === 'GET') return json(await buildPay(db, user));
      if (id === 'adjustments') {
        needAdmin();
        if (!sub && m === 'POST') return await createAdjustment(req, db);
        if (sub && m === 'DELETE') return await deleteAdjustment(sub, db);
      }
      if (id === 'benefits' && !sub && m === 'PUT') { needAdmin(); return await setBenefit(req, db); }
      if (id === 'payouts' && !sub && m === 'POST') { needAdmin(); return await createPayout(req, db); }
    }

    if (res === 'team') {
      needAdmin();
      if (!id && m === 'GET') return json(await teamList(db));
      if (id && !sub && m === 'PUT') return await teamSave(req, id, db);
    }

    if (res === 'expenses') {
      if (!id && m === 'POST') return await createExpense(req, user, db);
      if (id && sub === 'file' && m === 'GET') return await expenseFile(id, user, db);
      if (id && !sub && m === 'PUT') { needAdmin(); return await decideExpense(req, id, user, db); }
      if (id && !sub && m === 'DELETE') return await deleteExpense(id, user, db);
    }

    if (res === 'chat') {
      if (id === 'poll' && m === 'GET') return await chatPoll(user, db, new URL(req.url));
      if (id === 'history' && m === 'GET') return await chatHistory(user, db, new URL(req.url));
      if (id === 'send' && m === 'POST') return await chatSend(req, user, db);
      if (id && sub && m === 'DELETE') return await chatDelete(user, db, id, sub);
    }

    if (res === 'import' && m === 'POST') { needAdmin(); return await importClients(req, db); }

    if (res === 'users') {
      needAdmin();
      if (!id && m === 'POST') {
        const b = await readBody(req);
        const name = str(b.name, 40);
        if (!name) throw new HttpError(400, 'Escribe el nombre del comercial.');
        return json(await createUser(db, name, b.role === 'admin' ? 'admin' : 'comercial'), 201);
      }
      if (id && !isId(id)) throw new HttpError(404, 'Usuario no encontrado.');
      if (id && sub === 'reset' && m === 'POST') return json(await resetUser(db, id));
      if (id && !sub && m === 'DELETE') { await deleteUser(db, id); return json({ ok: true }); }
    }

    throw new HttpError(404, 'Ruta no encontrada.');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Error interno del servidor.' }, 500);
  }
};
