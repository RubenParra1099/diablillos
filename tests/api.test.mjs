// Pruebas de api/data.js contra un Postgres real en memoria (PGlite): versiones, conflicto, sincronización, límite de intentos y enlaces para papás. Correr con: npm test
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const src = fs.readFileSync(new URL('../api/data.js', import.meta.url), 'utf8').replace("import pg from 'pg';", "import pg from './pgshim.mjs';");
const tmp = new URL('./.api-prueba.mjs', import.meta.url); fs.writeFileSync(tmp, src);
process.env.DIABLILLOS_DB_URL = 'postgres://prueba@pglite/mem'; process.env.EDIT_KEY = 'clave';
const { default: handler } = await import(tmp.href); fs.unlinkSync(tmp);
let cookie = '';
async function call(body, query = {}, opts = {}) {
  const req = { method: body ? 'POST' : 'GET', body: body || undefined, query, url: '/api/data?' + new URLSearchParams(query), headers: { cookie: opts.noCookie ? '' : cookie, 'x-forwarded-for': opts.ip || '10.0.0.1', 'x-forwarded-proto': 'https' } };
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
  await handler(req, res);
  const sc = res.h['Set-Cookie']; if (sc && !opts.noCookie) { const v = sc.split(';')[0]; cookie = v.endsWith('=') ? '' : v; }
  return { code: res.code, ...res.body };
}
const ok = (name, cond, extra = '') => test(name, () => assert.ok(cond, name + ' ' + extra));

let r = await call({ op: 'setup', key: 'clave', email: 'coach@x.mx', name: 'Coach', password: 'secreta123' });
ok('alta del primer administrador', r.code === 200);
r = await call({ op: 'adminTeamSave', name: 'Diablillos', category: 'Infantil' }); const team = r.id;
ok('equipo creado', r.code === 200 && team);

// R2 versiones y conflicto
r = await call({ op: 'put', team, col: 'roster', id: 'p1', data: { name: 'Ana' }, base: null }); const vr = r.version;
ok('alta de jugador devuelve versión', r.code === 200 && /^\d+$/.test(vr), vr);
await call({ op: 'put', team, col: 'roster', id: 'p2', data: { name: 'Beto' }, base: null });
const game = { date: '2026-11-01', opp: 'Toros', us: ['1'], them: ['0'], lines: [{ pid: 'p1', ab: 3, h: 2 }, { pid: 'p2', ab: 3, h: 0 }], pit: [{ pid: 'p2', outs: 9, np: 40 }], sheet: { slots: [{ pid: 'p1' }, { pid: 'p2' }], cells: { '0_1': [{ res: 'H1', reach: 4 }] } } };
r = await call({ op: 'put', team, col: 'games', id: 'g1', data: game, base: null }); const v1 = r.version;
r = await call(null, { team });
ok('la carga trae la versión de cada registro', r.ver.games.g1 === v1 && r.ver.roster.p1 === vr && !r.partial);
const now0 = r.now;
r = await call({ op: 'put', team, col: 'games', id: 'g1', data: { ...game, notes: 'edición del coach' }, base: v1 }); const v2 = r.version;
ok('guardar con la versión vigente funciona', r.code === 200 && v2 !== v1);
r = await call({ op: 'put', team, col: 'games', id: 'g1', data: { ...game, notes: 'edición del papá' }, base: v1 });
ok('guardar sobre una versión vieja da conflicto', r.code === 409 && r.error === 'conflict' && r.current.notes === 'edición del coach' && r.by === 'Coach' && r.version === v2, JSON.stringify({ code: r.code, by: r.by }));
r = await call({ op: 'put', team, col: 'games', id: 'g1', data: { ...game, notes: 'edición del papá' }, force: true });
ok('"Guardar la mía" sobrescribe', r.code === 200);
r = await call({ op: 'put', team, col: 'games', id: 'gNuevo', data: game, base: null });
ok('registro nuevo con base null', r.code === 200);
r = await call({ op: 'put', team, col: 'games', id: 'gNuevo', data: game, base: null });
ok('si alguien ya creó ese id, también avisa', r.code === 409);

// U3 sincronización por cambios
r = await call(null, { team, since: now0 });
ok('carga parcial solo trae lo cambiado', r.partial && Object.keys(r.games).sort().join() === 'g1,gNuevo' && Object.keys(r.roster).length === 0 && r.ids.games.length === 2, Object.keys(r.games).join());
const now1 = r.now;
await call({ op: 'del', team, col: 'games', id: 'gNuevo' });
r = await call(null, { team, since: now1 });
ok('lo borrado desaparece de la lista de ids', r.partial && !r.ids.games.includes('gNuevo') && Object.keys(r.games).length === 0);

// U5 enlace para papás
r = await call({ op: 'shareCreate', team, pid: 'p1' }); const tok = r.token;
ok('se crea el enlace', r.code === 200 && tok && tok.length >= 20);
r = await call({ op: 'shareCreate', team, pid: 'p1' });
ok('pedirlo otra vez devuelve el mismo', r.token === tok);
r = await call(null, { team });
ok('la carga del coach incluye los enlaces activos', r.shares && r.shares.p1 === tok);
r = await call(null, { share: tok }, { noCookie: true });
const g = r.games && r.games.g1;
ok('el papá ve la ficha sin iniciar sesión', r.code === 200 && r.share && r.pid === 'p1' && Object.keys(r.roster).join() === 'p1');
ok('no viajan datos de otros niños', g.lines.length === 1 && g.lines[0].pid === 'p1' && g.pit.length === 0 && g.sheet.slots[1].pid === 'x' && !JSON.stringify(r).includes('Beto'));
r = await call({ op: 'shareRevoke', team, pid: 'p1' });
r = await call(null, { share: tok }, { noCookie: true });
ok('al desactivarlo deja de funcionar', r.code === 404 && r.error === 'share_gone');

// Dirección de cada equipo (boxscoremx.vercel.app/<slug>)
r = await call(null, { team });
ok('el equipo recibe su dirección a partir del nombre', r.team.slug === 'diablillos', r.team.slug);
r = await call({ op: 'adminTeamSave', name: 'Diablillos', category: 'Juvenil' }); const team2 = r.id;
r = await call({ op: 'adminTeamSave', name: 'Águilas', category: '' }); const team3 = r.id;
r = await call(null, { team });
const slugOf = id => r.me.teams.find(t => t.id === id).slug;
ok('mismo nombre en otra categoría usa nombre-categoría', slugOf(team2) === 'diablillos-juvenil', slugOf(team2));
ok('los acentos se quitan', slugOf(team3) === 'aguilas', slugOf(team3));
r = await call(null, { team, slug: 'aguilas' });
ok('abrir /aguilas carga ese equipo', r.team.id === team3 && !r.slugMiss);
r = await call(null, { team, slug: 'no-existe' });
ok('una dirección desconocida avisa y abre el equipo pedido', r.team.id === team && r.slugMiss);
r = await call({ op: 'adminTeamSave', id: team3, name: 'Águilas', category: '', slug: 'diablillos' });
ok('no se repite una dirección', r.code === 409 && r.error === 'slug_taken');
r = await call({ op: 'adminTeamSave', id: team3, name: 'Águilas', category: '', slug: 'api' });
ok('no se usan direcciones reservadas', r.code === 400 && r.error === 'bad_slug');
r = await call({ op: 'adminTeamSave', id: team3, name: 'Águilas Reales', category: '', slug: 'Las Águilas' });
r = await call(null, { team: team3 });
ok('el administrador puede cambiar la dirección', r.team.slug === 'las-aguilas' && r.team.name === 'Águilas Reales', r.team.slug);
r = await call({ op: 'adminTeamSave', id: team3, name: 'Otro nombre', category: '' });
r = await call(null, { team: team3 });
ok('renombrar el equipo no cambia su dirección', r.team.slug === 'las-aguilas', r.team.slug);

// R4 límite de intentos
await call({ op: 'logout' });
for (let i = 0; i < 5; i++) { r = await call({ op: 'login', email: 'coach@x.mx', password: 'mala' + i }, {}, { ip: '10.0.0.' + (i + 2) }); }
ok('5 intentos fallidos responden "incorrectos"', r.code === 401);
r = await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.0.9' });
ok('el 6º intento queda bloqueado aunque la contraseña sea buena', r.code === 429 && r.error === 'locked', r.message);
r = await call({ op: 'login', email: 'otro@x.mx', password: 'x' }, {}, { ip: '10.0.0.9' });
ok('otro correo desde otra IP no se bloquea', r.code === 401);
console.log('\nTodas las pruebas de la API pasaron.');
