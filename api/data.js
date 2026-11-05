// API de datos de la plataforma Diablillos: roster, juegos y nombre del equipo en Postgres.
// Variables de entorno (Vercel → Settings → Environment Variables):
//   DIABLILLOS_DB_URL  cadena de conexión de Postgres (Neon). Si no existe, se usa DATABASE_URL o POSTGRES_URL
//   EDIT_KEY      clave para capturar y modificar datos (obligatoria para escribir)
//   VIEW_KEY      opcional: si existe, también se pide una clave para ver los datos
import pg from 'pg';

// DIABLILLOS_DB_URL tiene prioridad: ninguna integración de Vercel la crea ni la reemplaza
const URL = process.env.DIABLILLOS_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const TABLES = { roster: 'bs_roster', games: 'bs_games' };
const MAX_DOC = 600 * 1024; // un jugador con foto o un juego completo caben de sobra

let pool, ready;
function getPool() {
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)|host=\//.test(URL);
    pool = new pg.Pool({ connectionString: URL, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
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
    `).catch(e => { ready = null; throw e; });
  }
  await ready;
  return p;
}
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_.:@+~-]{1,80}$/.test(id);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const send = (res, code, body) => { res.setHeader('Cache-Control', 'no-store'); res.status(code).json(body); };

async function upsert(c, table, id, data) {
  const json = JSON.stringify(data);
  if (json.length > MAX_DOC) { const e = new Error('too_big'); e.status = 413; throw e; }
  await c.query(`insert into ${table} (id, data, updated_at) values ($1, $2::jsonb, now())
                 on conflict (id) do update set data = excluded.data, updated_at = now()`, [id, json]);
}

export default async function handler(req, res) {
  if (!URL) return send(res, 500, { error: 'no_db', message: 'Falta conectar la base de datos (DATABASE_URL).' });
  const editKey = process.env.EDIT_KEY || '', viewKey = process.env.VIEW_KEY || '';
  const key = String(req.headers['x-key'] || '');
  const canEdit = !!editKey && key === editKey;
  const canView = !viewKey || canEdit || key === viewKey;
  try {
    const p = await db();
    if (req.method === 'GET') {
      if (!canView) return send(res, 401, { error: 'view_key', message: 'Se necesita la clave para ver los datos.' });
      const [r, g, c, info] = await Promise.all([
        p.query('select id, data from bs_roster'),
        p.query('select id, data from bs_games'),
        p.query("select data from bs_config where id = 'team'"),
        p.query('select current_database() as db'),
      ]);
      let endpoint = ''; try { endpoint = new globalThis.URL(URL).hostname.split('.')[0].replace(/-pooler$/, ''); } catch {}
      return send(res, 200, {
        team: c.rows[0] ? c.rows[0].data.name : null,
        roster: Object.fromEntries(r.rows.map(x => [x.id, x.data])),
        games: Object.fromEntries(g.rows.map(x => [x.id, x.data])),
        canEdit, needsEditKey: !editKey,
        db: { name: info.rows[0].db, endpoint },
      });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.op === 'check') return send(res, 200, { canEdit, canView, needsEditKey: !editKey });
    if (!editKey) return send(res, 503, { error: 'no_edit_key', message: 'Falta configurar EDIT_KEY en Vercel.' });
    if (!canEdit) return send(res, 401, { error: 'edit_key', message: 'Clave de captura incorrecta.' });

    if (body.op === 'put' || body.op === 'del') {
      const table = TABLES[body.col];
      if (!table || !validId(body.id)) return send(res, 400, { error: 'bad_request' });
      if (body.op === 'put') { if (!isObj(body.data)) return send(res, 400, { error: 'bad_request' }); await upsert(p, table, body.id, body.data); }
      else await p.query(`delete from ${table} where id = $1`, [body.id]);
      return send(res, 200, { ok: true });
    }
    if (body.op === 'team') {
      const name = String(body.name || '').trim().slice(0, 60) || 'Mi equipo';
      await upsert(p, 'bs_config', 'team', { name });
      return send(res, 200, { ok: true });
    }
    if (body.op === 'import') {
      const roster = isObj(body.roster) ? body.roster : {}, games = isObj(body.games) ? body.games : {};
      const client = await p.connect();
      try {
        await client.query('begin');
        for (const [id, d] of Object.entries(roster)) if (validId(id) && isObj(d)) await upsert(client, 'bs_roster', id, d);
        for (const [id, d] of Object.entries(games)) if (validId(id) && isObj(d)) await upsert(client, 'bs_games', id, d);
        if (body.team) await upsert(client, 'bs_config', 'team', { name: String(body.team).slice(0, 60) });
        await client.query('commit');
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
      finally { client.release(); }
      return send(res, 200, { ok: true, roster: Object.keys(roster).length, games: Object.keys(games).length });
    }
    return send(res, 400, { error: 'bad_op' });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.status === 413 ? 'too_big' : 'server', message: e.status === 413 ? 'El registro es demasiado grande.' : 'Error en el servidor.' });
  }
}
