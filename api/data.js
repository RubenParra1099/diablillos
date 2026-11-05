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
    `).catch(e => { ready = null; throw e; });
  }
  await ready;
  return p;
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
async function upsertDoc(c, table, id, teamId, data) {
  const json = JSON.stringify(data);
  if (json.length > MAX_DOC) fail(413, 'too_big', 'El registro es demasiado grande.');
  // El id es único en toda la tabla: no permitir pisar un registro de otro equipo
  const prev = await c.query(`select team_id from ${table} where id = $1`, [id]);
  if (prev.rows[0] && prev.rows[0].team_id && prev.rows[0].team_id !== teamId) fail(403, 'forbidden', 'Ese registro pertenece a otro equipo.');
  await c.query(`insert into ${table} (id, team_id, data, updated_at) values ($1, $2, $3::jsonb, now())
                 on conflict (id) do update set data = excluded.data, team_id = excluded.team_id, updated_at = now()`, [id, teamId, json]);
}

/* ---------- sesión y permisos ---------- */
async function loadUser(p, req) {
  const s = verify(readCookie(req, COOKIE)); if (!s) return null;
  const u = (await p.query('select id, email, name, is_admin, is_supervisor, active, must_change, pass_hash from bs_users where id = $1', [s.uid])).rows[0];
  if (!u || !u.active) return null;
  // La sesión deja de valer si cambió la contraseña
  if (s.ph !== u.pass_hash.slice(-12)) return null;
  const teams = (u.is_admin || u.is_supervisor)
    ? (await p.query('select id, name, category, data, $1::text as role from bs_teams order by name', [u.is_admin ? 'admin' : 'supervisor'])).rows
    : (await p.query('select t.id, t.name, t.category, t.data, m.role from bs_members m join bs_teams t on t.id = m.team_id where m.user_id = $1 order by t.name', [u.id])).rows;
  return { id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, isSupervisor: !u.is_admin && u.is_supervisor, mustChange: u.must_change, ph: u.pass_hash, teams };
}
const roleIn = (u, teamId) => { const t = u.teams.find(t => t.id === teamId); return t ? t.role : null; };
const canRead = (u, teamId) => !!roleIn(u, teamId);
const canWrite = (u, teamId) => ['admin', 'supervisor', 'editor'].includes(roleIn(u, teamId));
const teamColors = d => (d && d.colors && typeof d.colors === 'object') ? d.colors : null;
const teamLook = d => ({ logo: (d && d.logo) || '', colors: teamColors(d), wordmark: (d && d.wordmark) || '', font: (d && d.font) || 'default', lettering: (d && d.lettering) || null });
const publicTeam = t => ({ id: t.id, name: t.name, category: t.category, ...teamLook(t.data), role: t.role });
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
        const row = (await p.query('select pass_hash from bs_users where id = $1', [uid])).rows[0];
        const token = sign({ uid, ph: row.pass_hash.slice(-12), exp: Date.now() + SESSION_DAYS * 864e5 });
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
      finally { client.release(); }
    }

    if (op === 'login') {
      const email = normEmail(b.email);
      const u = (await p.query('select id, pass_hash, active from bs_users where email = $1', [email])).rows[0];
      if (!u || !u.active || !checkPass(b.password, u.pass_hash)) { await new Promise(r => setTimeout(r, 600)); fail(401, 'bad_login', 'Correo o contraseña incorrectos.'); }
      await p.query('update bs_users set last_login = now() where id = $1', [u.id]);
      const token = sign({ uid: u.id, ph: u.pass_hash.slice(-12), exp: Date.now() + SESSION_DAYS * 864e5 });
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    }
    if (op === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });

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
      let teamId = String(q.team || '');
      if (!canRead(me, teamId)) teamId = me.teams[0] ? me.teams[0].id : '';
      const out = { me: publicMe(me), team: null, roster: {}, games: {}, canEdit: false };
      if (teamId) {
        const [r, g] = await Promise.all([
          p.query('select id, data from bs_roster where team_id = $1', [teamId]),
          p.query('select id, data from bs_games where team_id = $1', [teamId]),
        ]);
        out.team = publicTeam(me.teams.find(t => t.id === teamId));
        out.roster = Object.fromEntries(r.rows.map(x => [x.id, x.data]));
        out.games = Object.fromEntries(g.rows.map(x => [x.id, x.data]));
        out.canEdit = canWrite(me, teamId);
      }
      return send(res, 200, out);
    }

    // ---- escritura de datos de un equipo
    if (['put', 'del', 'import', 'teamName'].includes(op)) {
      const teamId = String(b.team || '');
      if (!canWrite(me, teamId)) fail(403, 'forbidden', 'Tu usuario no puede modificar los datos de este equipo.');
      if (op === 'put' || op === 'del') {
        const table = TABLES[b.col];
        if (!table || !validId(b.id)) fail(400, 'bad_request');
        if (op === 'put') { if (!isObj(b.data)) fail(400, 'bad_request'); await upsertDoc(p, table, b.id, teamId, b.data); }
        else await p.query(`delete from ${table} where id = $1 and team_id = $2`, [b.id, teamId]);
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
        const [teams, users, members] = await Promise.all([
          p.query(`select t.id, t.name, t.category, t.data, t.created_at,
                     (select count(*)::int from bs_roster r where r.team_id = t.id) as players,
                     (select count(*)::int from bs_games g where g.team_id = t.id) as games,
                     (select max(g.data->>'date') from bs_games g where g.team_id = t.id) as last_game
                   from bs_teams t order by t.name`),
          p.query('select id, email, name, is_admin, is_supervisor, active, must_change, last_login, created_at from bs_users order by name, email'),
          p.query('select user_id, team_id, role from bs_members'),
        ]);
        return send(res, 200, {
          teams: teams.rows.map(t => ({ id: t.id, name: t.name, category: t.category, ...teamLook(t.data), players: t.players, games: t.games, lastGame: t.last_game })),
          users: users.rows.map(u => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin, isSupervisor: !u.is_admin && u.is_supervisor, active: u.active, mustChange: u.must_change, lastLogin: u.last_login,
            teams: members.rows.filter(m => m.user_id === u.id).map(m => ({ team: m.team_id, role: m.role })) })),
        });
      }
      if (op === 'adminTeamSave') {
        const name = String(b.name || '').trim().slice(0, 60); if (!name) fail(400, 'bad_request', 'Escribe el nombre del equipo.');
        const category = String(b.category || '').trim().slice(0, 60);
        const logo = typeof b.logo === 'string' && b.logo.startsWith('data:image/') && b.logo.length < 300 * 1024 ? b.logo : (b.logo === '' ? '' : undefined);
        const wordmark = typeof b.wordmark === 'string' && b.wordmark.startsWith('data:image/') && b.wordmark.length < 420 * 1024 ? b.wordmark : (b.wordmark === '' ? '' : undefined);
        const font = ['default','script','brush','college','slab','gothic','western','modern','lobster','damion','grandhotel','leckerli','sansita','bevan','dafoe'].includes(b.font) ? b.font : undefined;
        const lettering = isObj(b.lettering) ? { tail: b.lettering.tail === 'thick' ? 'thick' : !!b.lettering.tail, fill: ['team', 'solid'].includes(b.lettering.fill) ? b.lettering.fill : 'white', tilt: !!b.lettering.tilt } : undefined;
        const hex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
        const colors = b.colors === null ? null : (isObj(b.colors) && hex(b.colors.primary) ? { primary: hex(b.colors.primary), secondary: hex(b.colors.secondary) || '#8d9096' } : undefined);
        if (b.id) {
          if (!validId(b.id)) fail(400, 'bad_request');
          const cur = (await p.query('select data from bs_teams where id = $1', [b.id])).rows[0];
          if (!cur) fail(404, 'not_found', 'Ese equipo ya no existe.');
          const data = { ...(cur.data || {}) };
          if (logo !== undefined) { if (logo) data.logo = logo; else delete data.logo; }
          if (colors !== undefined) { if (colors) data.colors = colors; else delete data.colors; }
          if (wordmark !== undefined) { if (wordmark) data.wordmark = wordmark; else delete data.wordmark; }
          if (font !== undefined) data.font = font;
          if (lettering !== undefined) data.lettering = lettering;
          await p.query('update bs_teams set name = $2, category = $3, data = $4::jsonb where id = $1', [b.id, name, category, JSON.stringify(data)]);
          return send(res, 200, { ok: true, id: b.id });
        }
        const id = newId('t');
        const data = {}; if (logo) data.logo = logo; if (colors) data.colors = colors; if (wordmark) data.wordmark = wordmark; if (font) data.font = font; if (lettering) data.lettering = lettering;
        await p.query('insert into bs_teams (id, name, category, data) values ($1, $2, $3, $4::jsonb)', [id, name, category, JSON.stringify(data)]);
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
        const teams = Array.isArray(b.teams) ? b.teams.filter(m => validId(m.team) && ['editor', 'viewer'].includes(m.role)) : [];
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
      if (op === 'adminUserDelete') {
        if (!validId(b.id) || b.id === me.id) fail(400, 'self', 'No puedes borrar tu propia cuenta.');
        await p.query('delete from bs_users where id = $1', [b.id]);
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.code : 'server', message: e.status ? e.message : 'Error en el servidor.' });
  }
}
