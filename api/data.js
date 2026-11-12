// API de la plataforma de box score: usuarios, equipos, roster y juegos en Postgres.
// Variables de entorno (Vercel → Settings → Environment Variables):
//   DIABLILLOS_DB_URL  cadena de conexión de Postgres (Neon). Si no existe, se usa DATABASE_URL o POSTGRES_URL
//   EDIT_KEY           clave de instalación: solo se usa para crear el primer administrador
//   AUTH_SECRET        opcional: secreto para firmar las sesiones (si falta, se deriva de la cadena de conexión)
//
// Roles: admin (bs_users.is_admin) ve, corrige y administra todo (equipos y usuarios).
//        supervisor (bs_users.is_supervisor) ve y corrige todos los equipos, pero no administra usuarios ni equipos.
//        Por equipo: 'editor' (captura) o 'viewer' (solo lectura).
import pg from 'pg';
import crypto from 'node:crypto';

const DB_URL = process.env.DIABLILLOS_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update('bs-session:' + DB_URL).digest('hex');
const TABLES = { roster: 'bs_roster', games: 'bs_games' };
const MAX_DOC = 600 * 1024;
const SESSION_DAYS = 30;
const COOKIE = 'bs_session';

let pool, ready;
function getPool() {
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
    pool = new pg.Pool({ connectionString: DB_URL, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
  }
  return pool;
}
async function db() {
  const p = getPool();
  if (!ready) {
    ready = p.query(`
      create table if not exists bs_roster (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      create table if not exists bs_games  (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      create table if not exists bs_config (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
      alter table bs_roster add column if not exists team_id text;
      alter table bs_games  add column if not exists team_id text;
      create index if not exists bs_roster_team on bs_roster(team_id);
      create index if not exists bs_games_team  on bs_games(team_id);
      create table if not exists bs_teams (id text primary key, name text not null, category text not null default '', data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
      create table if not exists bs_users (id text primary key, email text not null unique, name text not null default '', pass_hash text not null,
        is_admin boolean not null default false, active boolean not null default true, must_change boolean not null default true,
        created_at timestamptz not null default now(), last_login timestamptz);
      create table if not exists bs_members (user_id text not null references bs_users(id) on delete cascade, team_id text not null references bs_teams(id) on delete cascade,
        role text not null check (role in ('editor','viewer')), primary key (user_id, team_id));
      alter table bs_users add column if not exists is_supervisor boolean not null default false;
      create table if not exists bs_login_fail (k text primary key, n int not null default 0, first_at timestamptz not null default now(), locked_until timestamptz);
      create table if not exists bs_shares (token text primary key, team_id text not null references bs_teams(id) on delete cascade, pid text not null,
        created_by text, created_at timestamptz not null default now(), revoked boolean not null default false);
      create index if not exists bs_shares_team on bs_shares(team_id, pid);
      alter table bs_teams add column if not exists slug text;
      create unique index if not exists bs_teams_slug on bs_teams(slug);
    `).then(() => fillSlugs(p)).catch(e => { ready = null; throw e; });
  }
  await ready;
  return p;
}

/* ---------- dirección de cada equipo: boxscoremx.vercel.app/<slug> ---------- */
const RESERVED = new Set(['api', 'js', 'tests', 'admin', 'login', 'index', 'app', 'www', 'static', 'assets', 'p']);
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
const okSlug = s => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s) && !RESERVED.has(s);
// Primer slug libre: nombre, luego nombre-categoría, luego nombre-2, nombre-3…
async function freeSlug(c, name, category, exceptId) {
  const base = slugify(name) || 'equipo', tries = [base, slugify(base + '-' + category), ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)];
  for (const s of tries) if (okSlug(s) && !(await c.query('select 1 from bs_teams where slug = $1 and id <> $2', [s, exceptId || ''])).rows[0]) return s;
  return base + '-' + crypto.randomBytes(3).toString('hex');
}
// Equipos creados antes de que existieran las direcciones
async function fillSlugs(c) {
  const rows = (await c.query('select id, name, category from bs_teams where slug is null order by created_at')).rows;
  for (const t of rows) await c.query('update bs_teams set slug = $2 where id = $1', [t.id, await freeSlug(c, t.name, t.category, t.id)]);
}

/* ---------- utilidades ---------- */
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_.:@+~-]{1,80}$/.test(id);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const newId = p => p + crypto.randomBytes(6).toString('hex');
const normEmail = e => String(e || '').trim().toLowerCase();
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;
function fail(status, error, message) { const e = new Error(message || error); e.status = status; e.code = error; throw e; }
function send(res, code, body, extraHeaders = {}) {
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(code).json(body);
}
function hashPass(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPass(pw, stored) {
  try {
    const [alg, s, k] = String(stored).split('$'); if (alg !== 'scrypt') return false;
    const key = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(k, 'base64');
    return want.length === key.length && crypto.timingSafeEqual(want, key);
  } catch { return false; }
}
const goodPass = pw => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  const [body, mac] = String(token || '').split('.'); if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function sessionCookie(req, value, maxAge) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
const VER = "(extract(epoch from updated_at) * 1000000)::bigint::text";
// base: versión que tenía abierta quien guarda (null = registro nuevo). Si no coincide, alguien más guardó antes.
async function upsertDoc(c, table, id, teamId, data, base) {
  const json = JSON.stringify(data);
  if (json.length > MAX_DOC) fail(413, 'too_big', 'El registro es demasiado grande.');
  // El id es único en toda la tabla: no permitir pisar un registro de otro equipo
  const prev = (await c.query(`select team_id, data, ${VER} as v from ${table} where id = $1`, [id])).rows[0];
  if (prev && prev.team_id && prev.team_id !== teamId) fail(403, 'forbidden', 'Ese registro pertenece a otro equipo.');
  if (base !== undefined && prev && String(base || '') !== prev.v) {
    const e = new Error('Otra persona guardó este registro mientras lo editabas.'); e.status = 409; e.code = 'conflict';
    e.extra = { current: prev.data, version: prev.v, by: (prev.data && prev.data._by) || '' }; throw e;
  }
  const row = (await c.query(`insert into ${table} (id, team_id, data, updated_at) values ($1, $2, $3::jsonb, now())
                 on conflict (id) do update set data = excluded.data, team_id = excluded.team_id, updated_at = now() returning ${VER} as v`, [id, teamId, json])).rows[0];
  return row.v;
}
// Vista para papás: solo el jugador compartido; de los demás no viajan nombres ni líneas
function shareGame(g, pid) {
  const keep = ['date', 'no', 'liga', 'opp', 'ha', 'inns', 'us', 'them', 'themH', 'themE', 'mode', 'bpi'];
  const o = Object.fromEntries(keep.filter(k => g[k] !== undefined).map(k => [k, g[k]]));
  o.lines = (g.lines || []).filter(l => l.pid === pid);
  o.pit = (g.pit || []).filter(p => p.pid === pid);
  if (g.sheet && Array.isArray(g.sheet.slots)) {
    const mask = v => v === pid ? pid : (v ? 'x' : '');
    o.sheet = { slots: g.sheet.slots.map(s => ({ pid: mask(s.pid), pos: s.pid === pid ? s.pos : '', sub: s.sub ? { pid: mask(s.sub.pid), pos: s.sub.pid === pid ? s.sub.pos : '', from: s.sub.from } : null })), cells: g.sheet.cells || {} };
  }
  return o;
}
const clientIp = req => String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim().slice(0, 60) || 'desconocida';

/* ---------- sesión y permisos ---------- */
async function loadUser(p, req) {
  const s = verify(readCookie(req, COOKIE)); if (!s) return null;
  const u = (await p.query('select id, email, name, is_admin, is_supervisor, active, must_change, pass_hash from bs_users where id = $1', [s.uid])).rows[0];
  if (!u || !u.active) return null;
  // La sesión deja de valer si cambió la contraseña
  if (s.ph !== u.pass_hash.slice(-12)) return null;
  const teams = (u.is_admin || u.is_supervisor)
    ? (await p.query(`select t.id, t.name, t.category, t.slug, t.data, $1::text as role, (m.user_id is not null) as own
                      from bs_teams t left join bs_members m on m.team_id = t.id and m.user_id = $2
                      order by (m.user_id is null), t.name`, [u.is_admin ? 'admin' : 'supervisor', u.id])).rows
    : (await p.query('select t.id, t.name, t.category, t.slug, t.data, m.role from bs_members m join bs_teams t on t.id = m.team_id where m.user_id = $1 order by t.name', [u.id])).rows;
  return { id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, isSupervisor: !u.is_admin && u.is_supervisor, mustChange: u.must_change, ph: u.pass_hash, teams };
}
const roleIn = (u, teamId) => { const t = u.teams.find(t => t.id === teamId); return t ? t.role : null; };
const canRead = (u, teamId) => !!roleIn(u, teamId);
const canWrite = (u, teamId) => ['admin', 'supervisor', 'editor'].includes(roleIn(u, teamId));
const teamColors = d => (d && d.colors && typeof d.colors === 'object') ? d.colors : null;
const teamLook = d => ({ logo: (d && d.logo) || '', colors: teamColors(d), wordmark: (d && d.wordmark) || '', font: (d && d.font) || 'default', lettering: (d && d.lettering) || null, mode: (d && d.mode === 'chupon') ? 'chupon' : 'trad' });
const publicTeam = t => ({ id: t.id, name: t.name, category: t.category, slug: t.slug || '', ...teamLook(t.data), role: t.role, own: t.own !== false });
const publicMe = u => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, isSupervisor: u.isSupervisor, mustChange: u.mustChange, teams: u.teams.map(publicTeam) });

async function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

/* ---------- handler ---------- */
export default async function handler(req, res) {
  if (!DB_URL) return send(res, 500, { error: 'no_db', message: 'Falta conectar la base de datos (DIABLILLOS_DB_URL).' });
  try {
    const p = await db();
    const usersCount = Number((await p.query('select count(*)::int as n from bs_users')).rows[0].n);
    const b = req.method === 'POST' ? await body(req) : {};
    const op = req.method === 'GET' ? 'load' : b.op;

    // Primer arranque: crear el primer administrador con la clave de instalación (EDIT_KEY)
    if (usersCount === 0) {
      if (op !== 'setup') return send(res, 401, { error: 'setup', message: 'Crea la cuenta del primer administrador.', hasKey: !!process.env.EDIT_KEY });
      if (!process.env.EDIT_KEY) fail(503, 'no_edit_key', 'Falta configurar EDIT_KEY en Vercel.');
      if (String(b.key || '') !== process.env.EDIT_KEY) fail(401, 'bad_key', 'La clave de instalación no es correcta.');
      const email = normEmail(b.email); if (!okEmail(email)) fail(400, 'bad_email', 'Escribe un correo válido.');
      if (!goodPass(b.password)) fail(400, 'weak_password', 'La contraseña debe tener al menos 8 caracteres.');
      const client = await p.connect();
      try {
        await client.query('begin');
        const uid = newId('u');
        await client.query('insert into bs_users (id, email, name, pass_hash, is_admin, must_change) values ($1, $2, $3, $4, true, false)', [uid, email, String(b.name || '').slice(0, 80), hashPass(b.password)]);
        // Los datos que ya existían quedan en un primer equipo
        const orphan = Number((await client.query('select (select count(*) from bs_roster where team_id is null) + (select count(*) from bs_games where team_id is null) as n')).rows[0].n);
        const cfg = (await client.query("select data from bs_config where id = 'team'")).rows[0];
        if (orphan > 0 || cfg) {
          const tname = (cfg && cfg.data && cfg.data.name) || 'Mi equipo';
          const tid = (tname.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'equipo').slice(0, 40);
          await client.query('insert into bs_teams (id, name) values ($1, $2) on conflict (id) do nothing', [tid, tname]);
          await client.query('update bs_roster set team_id = $1 where team_id is null', [tid]);
          await client.query('update bs_games  set team_id = $1 where team_id is null', [tid]);
        }
        await client.query('commit');
        await fillSlugs(p);
        const row = (await p.query('select pass_hash from bs_users where id = $1', [uid])).rows[0];
        const token = sign({ uid, ph: row.pass_hash.slice(-12), exp: Date.now() + SESSION_DAYS * 864e5 });
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
      finally { client.release(); }
    }

    if (op === 'login') {
      const email = normEmail(b.email), keys = ['e:' + email, 'ip:' + clientIp(req)];
      // 5 intentos fallidos por correo (20 por dirección IP) en 15 minutos bloquean 15 minutos
      const locked = (await p.query('select 1 from bs_login_fail where k = any($1) and locked_until > now()', [keys])).rows[0];
      if (locked) fail(429, 'locked', 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.');
      const u = (await p.query('select id, pass_hash, active from bs_users where email = $1', [email])).rows[0];
      if (!u || !u.active || !checkPass(b.password, u.pass_hash)) {
        for (const k of keys) await p.query(`insert into bs_login_fail (k, n, first_at) values ($1, 1, now())
          on conflict (k) do update set n = case when bs_login_fail.first_at < now() - interval '15 minutes' then 1 else bs_login_fail.n + 1 end,
            first_at = case when bs_login_fail.first_at < now() - interval '15 minutes' then now() else bs_login_fail.first_at end,
            locked_until = case when (case when bs_login_fail.first_at < now() - interval '15 minutes' then 1 else bs_login_fail.n + 1 end) >= $2 then now() + interval '15 minutes' else null end`,
          [k, k.startsWith('e:') ? 5 : 20]);
        await new Promise(r => setTimeout(r, 600)); fail(401, 'bad_login', 'Correo o contraseña incorrectos.');
      }
      await p.query('delete from bs_login_fail where k = $1', ['e:' + email]);
      await p.query('update bs_users set last_login = now() where id = $1', [u.id]);
      const token = sign({ uid: u.id, ph: u.pass_hash.slice(-12), exp: Date.now() + SESSION_DAYS * 864e5 });
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (op === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    if (op === 'load') {
      const q0 = req.query || Object.fromEntries(new URLSearchParams(String(req.url || '').split('?')[1] || ''));
      if (q0.share) {
        const sh = (await p.query('select s.team_id, s.pid, t.name, t.category, t.data from bs_shares s join bs_teams t on t.id = s.team_id where s.token = $1 and not s.revoked', [String(q0.share).slice(0, 80)])).rows[0];
        if (!sh) fail(404, 'share_gone', 'Este enlace ya no está disponible. Pide uno nuevo al coach.');
        const [pr, gr] = await Promise.all([
          p.query('select data from bs_roster where id = $1 and team_id = $2', [sh.pid, sh.team_id]),
          p.query('select id, data from bs_games where team_id = $1', [sh.team_id]),
        ]);
        if (!pr.rows[0]) fail(404, 'share_gone', 'Este jugador ya no está en el roster.');
        return send(res, 200, { share: true, pid: sh.pid, team: { id: sh.team_id, name: sh.name, category: sh.category, ...teamLook(sh.data) },
          roster: { [sh.pid]: pr.rows[0].data }, games: Object.fromEntries(gr.rows.map(x => [x.id, shareGame(x.data, sh.pid)])) });
      }
    }

    const me = await loadUser(p, req);
    if (!me) fail(401, 'auth', 'Inicia sesión para continuar.');

    if (op === 'password') {
      if (!checkPass(b.current, me.ph)) fail(401, 'bad_password', 'La contraseña actual no es correcta.');
      if (!goodPass(b.password)) fail(400, 'weak_password', 'La contraseña nueva debe tener al menos 8 caracteres.');
      const h = hashPass(b.password);
      await p.query('update bs_users set pass_hash = $2, must_change = false where id = $1', [me.id, h]);
      const token = sign({ uid: me.id, ph: h.slice(-12), exp: Date.now() + SESSION_DAYS * 864e5 });
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }

    if (op === 'load') {
      const q = req.query || Object.fromEntries(new URLSearchParams(String(req.url || '').split('?')[1] || ''));
      let teamId = String(q.team || ''), slugMiss = false;
      // Si se abrió boxscoremx.vercel.app/<slug>, ese equipo manda (si el usuario tiene acceso)
      if (q.slug) { const t = me.teams.find(t => t.slug === String(q.slug).toLowerCase()); if (t) teamId = t.id; else slugMiss = true; }
      // Inicio de la plataforma (boxscoremx.vercel.app sin equipo): solo los equipos del usuario y sus totales
      if (q.home === '1') {
        const ids = me.teams.map(t => t.id);
        const [r, g] = await Promise.all([
          p.query('select team_id, count(*)::int as n from bs_roster where team_id = any($1) group by team_id', [ids]),
          p.query(`select team_id, count(*)::int as n, max(data->>'date') as last from bs_games where team_id = any($1) group by team_id`, [ids]),
        ]);
        const stats = Object.fromEntries(ids.map(id => [id, { players: 0, games: 0, last: null }]));
        r.rows.forEach(x => stats[x.team_id].players = x.n); g.rows.forEach(x => Object.assign(stats[x.team_id], { games: x.n, last: x.last }));
        return send(res, 200, { me: publicMe(me), home: true, stats });
      }
      if (!canRead(me, teamId)) teamId = me.teams[0] ? me.teams[0].id : '';
      const since = /^\d{1,20}$/.test(String(q.since || '')) && q.team === teamId ? String(q.since) : '';
      const out = { me: publicMe(me), team: null, roster: {}, games: {}, ver: { roster: {}, games: {} }, canEdit: false, partial: !!since, slugMiss,
        now: (await p.query('select (extract(epoch from now()) * 1000000)::bigint::text as v')).rows[0].v };
      if (teamId) {
        const cond = since ? 'team_id = $1 and updated_at > to_timestamp($2::numeric / 1000000)' : 'team_id = $1', args = since ? [teamId, since] : [teamId];
        const [r, g] = await Promise.all([
          p.query(`select id, data, ${VER} as v from bs_roster where ${cond}`, args),
          p.query(`select id, data, ${VER} as v from bs_games where ${cond}`, args),
        ]);
        out.team = publicTeam(me.teams.find(t => t.id === teamId));
        out.roster = Object.fromEntries(r.rows.map(x => [x.id, x.data])); r.rows.forEach(x => out.ver.roster[x.id] = x.v);
        out.games = Object.fromEntries(g.rows.map(x => [x.id, x.data])); g.rows.forEach(x => out.ver.games[x.id] = x.v);
        if (since) {
          // ids vigentes, para saber qué se borró
          const [ri, gi] = await Promise.all([p.query('select id from bs_roster where team_id = $1', [teamId]), p.query('select id from bs_games where team_id = $1', [teamId])]);
          out.ids = { roster: ri.rows.map(x => x.id), games: gi.rows.map(x => x.id) };
        }
        out.canEdit = canWrite(me, teamId);
        if (out.canEdit) out.shares = Object.fromEntries((await p.query('select pid, token from bs_shares where team_id = $1 and not revoked', [teamId])).rows.map(x => [x.pid, x.token]));
      }
      return send(res, 200, out);
    }

    // ---- escritura de datos de un equipo
    if (['put', 'del', 'import', 'teamName', 'shareCreate', 'shareRevoke'].includes(op)) {
      const teamId = String(b.team || '');
      if (!canWrite(me, teamId)) fail(403, 'forbidden', 'Tu usuario no puede modificar los datos de este equipo.');
      if (op === 'put' || op === 'del') {
        const table = TABLES[b.col];
        if (!table || !validId(b.id)) fail(400, 'bad_request');
        if (op === 'put') {
          if (!isObj(b.data)) fail(400, 'bad_request'); if (table === 'bs_games') b.data._by = me.name || me.email;
          const v = await upsertDoc(p, table, b.id, teamId, b.data, b.force ? undefined : ('base' in b ? b.base : undefined));
          return send(res, 200, { ok: true, version: v });
        }
        await p.query(`delete from ${table} where id = $1 and team_id = $2`, [b.id, teamId]);
        return send(res, 200, { ok: true });
      }
      if (op === 'shareCreate') {
        if (!validId(b.pid) || !(await p.query('select 1 from bs_roster where id = $1 and team_id = $2', [b.pid, teamId])).rows[0]) fail(404, 'not_found', 'Ese jugador no está en el roster.');
        const cur = (await p.query('select token from bs_shares where team_id = $1 and pid = $2 and not revoked', [teamId, b.pid])).rows[0];
        if (cur) return send(res, 200, { ok: true, token: cur.token });
        const token = crypto.randomBytes(18).toString('base64url');
        await p.query('insert into bs_shares (token, team_id, pid, created_by) values ($1, $2, $3, $4)', [token, teamId, b.pid, me.id]);
        return send(res, 200, { ok: true, token });
      }
      if (op === 'shareRevoke') {
        if (!validId(b.pid)) fail(400, 'bad_request');
        await p.query('update bs_shares set revoked = true where team_id = $1 and pid = $2', [teamId, b.pid]);
        return send(res, 200, { ok: true });
      }
      if (op === 'teamName') {
        const name = String(b.name || '').trim().slice(0, 60); if (!name) fail(400, 'bad_request');
        await p.query('update bs_teams set name = $2 where id = $1', [teamId, name]);
        return send(res, 200, { ok: true });
      }
      if (op === 'import') {
        const roster = isObj(b.roster) ? b.roster : {}, games = isObj(b.games) ? b.games : {};
        const client = await p.connect();
        try {
          await client.query('begin');
          for (const [id, d] of Object.entries(roster)) if (validId(id) && isObj(d)) await upsertDoc(client, 'bs_roster', id, teamId, d);
          for (const [id, d] of Object.entries(games)) if (validId(id) && isObj(d)) await upsertDoc(client, 'bs_games', id, teamId, d);
          await client.query('commit');
        } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
        finally { client.release(); }
        return send(res, 200, { ok: true, roster: Object.keys(roster).length, games: Object.keys(games).length });
      }
    }

    // ---- administración (solo admins)
    if (op && op.startsWith('admin')) {
      if (!me.isAdmin) fail(403, 'forbidden', 'Solo un administrador puede hacer esto.');
      if (op === 'adminList') {
        const [teams, users, members, recent, week] = await Promise.all([
          p.query(`select t.id, t.name, t.category, t.slug, t.data, t.created_at,
                     (select count(*)::int from bs_roster r where r.team_id = t.id) as players,
                     (select count(*)::int from bs_games g where g.team_id = t.id) as games,
                     (select max(g.data->>'date') from bs_games g where g.team_id = t.id) as last_game
                   from bs_teams t order by t.name`),
          p.query('select id, email, name, is_admin, is_supervisor, active, must_change, last_login, created_at from bs_users order by name, email'),
          p.query('select user_id, team_id, role from bs_members'),
          p.query(`select team_id, data->>'date' as date, data->>'opp' as opp, data->>'ha' as ha, data->'us' as us, data->'them' as them, data->>'_by' as by
                   from bs_games order by data->>'date' desc nulls last, updated_at desc limit 8`),
          p.query(`select count(*)::int as n from bs_games where data->>'date' >= to_char(current_date - 7, 'YYYY-MM-DD')`),
        ]);
        return send(res, 200, {
          teams: teams.rows.map(t => ({ id: t.id, name: t.name, category: t.category, slug: t.slug || '', ...teamLook(t.data), players: t.players, games: t.games, lastGame: t.last_game })),
          users: users.rows.map(u => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, isSupervisor: !u.is_admin && u.is_supervisor, active: u.active, mustChange: u.must_change, lastLogin: u.last_login,
            teams: members.rows.filter(m => m.user_id === u.id).map(m => ({ team: m.team_id, role: m.role })) })),
          recent: recent.rows.map(g => ({ team: g.team_id, date: g.date, opp: g.opp, ha: g.ha, us: Array.isArray(g.us) ? g.us : [], them: Array.isArray(g.them) ? g.them : [], by: g.by || '' })),
          gamesWeek: week.rows[0].n,
        });
      }
      if (op === 'adminTeamSave') {
        const name = String(b.name || '').trim().slice(0, 60); if (!name) fail(400, 'bad_request', 'Escribe el nombre del equipo.');
        const category = String(b.category || '').trim().slice(0, 60);
        const logo = typeof b.logo === 'string' && b.logo.startsWith('data:image/') && b.logo.length < 300 * 1024 ? b.logo : (b.logo === '' ? '' : undefined);
        const wordmark = typeof b.wordmark === 'string' && b.wordmark.startsWith('data:image/') && b.wordmark.length < 420 * 1024 ? b.wordmark : (b.wordmark === '' ? '' : undefined);
        const font = ['default','script','brush','college','slab','gothic','western','modern','lobster','damion','grandhotel','leckerli','sansita','bevan','dafoe'].includes(b.font) ? b.font : undefined;
        const lettering = isObj(b.lettering) ? { tail: b.lettering.tail === 'thick' ? 'thick' : !!b.lettering.tail, fill: ['team', 'solid', 'varsity'].includes(b.lettering.fill) ? b.lettering.fill : 'white', tilt: !!b.lettering.tilt } : undefined;
        const mode = ['trad', 'chupon'].includes(b.mode) ? b.mode : undefined;
        const dup = (await p.query('select id from bs_teams where lower(trim(name)) = lower($1) and lower(trim(category)) = lower($2) and id <> $3', [name, category, String(b.id || '')])).rows[0];
        if (dup) fail(409, 'team_exists', 'Ya existe un equipo con ese nombre y categoría.');
        // Dirección: la que escribió el administrador o, si la dejó vacía, una libre a partir del nombre
        let slug = typeof b.slug === 'string' && b.slug.trim() ? slugify(b.slug) : '';
        if (slug) {
          if (!okSlug(slug)) fail(400, 'bad_slug', 'Esa dirección no se puede usar. Usa letras, números y guiones.');
          if ((await p.query('select 1 from bs_teams where slug = $1 and id <> $2', [slug, String(b.id || '')])).rows[0]) fail(409, 'slug_taken', 'Esa dirección ya la usa otro equipo.');
        }
        const hex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
        const colors = b.colors === null ? null : (isObj(b.colors) && hex(b.colors.primary) ? { primary: hex(b.colors.primary), secondary: hex(b.colors.secondary) || '#8d9096' } : undefined);
        if (b.id) {
          if (!validId(b.id)) fail(400, 'bad_request');
          const cur = (await p.query('select data, slug from bs_teams where id = $1', [b.id])).rows[0];
          if (!cur) fail(404, 'not_found', 'Ese equipo ya no existe.');
          const data = { ...(cur.data || {}) };
          if (logo !== undefined) { if (logo) data.logo = logo; else delete data.logo; }
          if (colors !== undefined) { if (colors) data.colors = colors; else delete data.colors; }
          if (wordmark !== undefined) { if (wordmark) data.wordmark = wordmark; else delete data.wordmark; }
          if (font !== undefined) data.font = font;
          if (lettering !== undefined) data.lettering = lettering;
          if (mode !== undefined) data.mode = mode;
          if (!slug && !cur.slug) slug = await freeSlug(p, name, category, b.id);
          await p.query('update bs_teams set name = $2, category = $3, data = $4::jsonb, slug = coalesce($5, slug) where id = $1', [b.id, name, category, JSON.stringify(data), slug || null]);
          return send(res, 200, { ok: true, id: b.id });
        }
        const id = newId('t');
        const data = {}; if (logo) data.logo = logo; if (colors) data.colors = colors; if (wordmark) data.wordmark = wordmark; if (font) data.font = font; if (lettering) data.lettering = lettering; if (mode) data.mode = mode;
        if (!slug) slug = await freeSlug(p, name, category, id);
        await p.query('insert into bs_teams (id, name, category, data, slug) values ($1, $2, $3, $4::jsonb, $5)', [id, name, category, JSON.stringify(data), slug]);
        return send(res, 200, { ok: true, id });
      }
      if (op === 'adminTeamDelete') {
        if (!validId(b.id)) fail(400, 'bad_request');
        const n = (await p.query('select (select count(*) from bs_roster where team_id = $1) + (select count(*) from bs_games where team_id = $1) as n', [b.id])).rows[0].n;
        if (Number(n) > 0) fail(409, 'not_empty', 'El equipo todavía tiene jugadores o juegos. Bórralos primero.');
        await p.query('delete from bs_teams where id = $1', [b.id]);
        return send(res, 200, { ok: true });
      }
      if (op === 'adminUserSave') {
        const email = normEmail(b.email); if (!okEmail(email)) fail(400, 'bad_email', 'Escribe un correo válido.');
        const name = String(b.name || '').trim().slice(0, 80);
        const level = ['admin', 'supervisor'].includes(b.level) ? b.level : (b.isAdmin ? 'admin' : 'user');
        const isAdmin = level === 'admin', isSup = level === 'supervisor', active = b.active !== false;
        const teams = (Array.isArray(b.teams) ? b.teams.filter(m => m && validId(m.team) && ['editor', 'viewer'].includes(m.role)) : []).map(m => ({ team: m.team, role: isAdmin || isSup ? 'editor' : m.role }));
        if (b.id === me.id && (!isAdmin || !active)) fail(400, 'self', 'No puedes quitarte a ti mismo el rol de administrador ni desactivarte.');
        const client = await p.connect();
        try {
          await client.query('begin');
          let id = b.id;
          if (id) {
            if (!validId(id)) fail(400, 'bad_request');
            await client.query('update bs_users set email = $2, name = $3, is_admin = $4, is_supervisor = $5, active = $6 where id = $1', [id, email, name, isAdmin, isSup, active]);
            if (b.password) { if (!goodPass(b.password)) fail(400, 'weak_password', 'La contraseña debe tener al menos 8 caracteres.'); await client.query('update bs_users set pass_hash = $2, must_change = true where id = $1', [id, hashPass(b.password)]); }
          } else {
            if (!goodPass(b.password)) fail(400, 'weak_password', 'Pon una contraseña temporal de al menos 8 caracteres.');
            id = newId('u');
            await client.query('insert into bs_users (id, email, name, pass_hash, is_admin, is_supervisor, active, must_change) values ($1, $2, $3, $4, $5, $6, $7, true)', [id, email, name, hashPass(b.password), isAdmin, isSup, active]);
          }
          await client.query('delete from bs_members where user_id = $1', [id]);
          for (const m of teams) await client.query('insert into bs_members (user_id, team_id, role) values ($1, $2, $3) on conflict (user_id, team_id) do update set role = excluded.role', [id, m.team, m.role]);
          await client.query('commit');
          return send(res, 200, { ok: true, id });
        } catch (e) {
          await client.query('rollback').catch(() => {});
          if (e.code === '23505') fail(409, 'email_taken', 'Ya existe un usuario con ese correo.');
          throw e;
        } finally { client.release(); }
      }
      if (op === 'adminTeamAccess') {
        if (!validId(b.team)) fail(400, 'bad_request');
        if (!(await p.query('select 1 from bs_teams where id = $1', [b.team])).rows[0]) fail(404, 'not_found', 'Ese equipo ya no existe.');
        const members = Array.isArray(b.members) ? b.members.filter(m => m && validId(m.user) && ['editor', 'viewer'].includes(m.role)) : [];
        const client = await p.connect();
        try {
          await client.query('begin');
          await client.query('delete from bs_members where team_id = $1', [b.team]);
          for (const m of members) await client.query('insert into bs_members (user_id, team_id, role) select $1, $2, $3 where exists (select 1 from bs_users where id = $1) on conflict (user_id, team_id) do update set role = excluded.role', [m.user, b.team, m.role]);
          await client.query('commit');
        } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
        finally { client.release(); }
        return send(res, 200, { ok: true });
      }
      if (op === 'adminUserReset') {
        if (!validId(b.id)) fail(400, 'bad_request');
        if (!goodPass(b.password)) fail(400, 'weak_password', 'La contraseña debe tener al menos 8 caracteres.');
        if (b.id === me.id) fail(400, 'self', 'Para tu propia cuenta usa “Cambiar contraseña”.');
        const r = await p.query('update bs_users set pass_hash = $2, must_change = true where id = $1', [b.id, hashPass(b.password)]);
        if (!r.rowCount) fail(404, 'not_found', 'Ese usuario ya no existe.');
        return send(res, 200, { ok: true });
      }
      if (op === 'adminUserActive') {
        if (!validId(b.id) || b.id === me.id) fail(400, 'self', 'No puedes desactivar tu propia cuenta.');
        await p.query('update bs_users set active = $2 where id = $1', [b.id, !!b.active]);
        return send(res, 200, { ok: true });
      }
      if (op === 'adminUserDelete') {
        if (!validId(b.id) || b.id === me.id) fail(400, 'self', 'No puedes borrar tu propia cuenta.');
        await p.query('delete from bs_users where id = $1', [b.id]);
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.code : 'server', message: e.status ? e.message : 'Error en el servidor.', ...(e.extra || {}) });
  }
}
