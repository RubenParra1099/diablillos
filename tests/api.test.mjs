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
  const req = { method: body ? 'POST' : 'GET', body: body || undefined, query, url: '/api/data?' + new URLSearchParams(query), headers: { cookie: opts.noCookie ? '' : cookie, 'x-forwarded-for': opts.ip || '10.0.0.1', 'x-forwarded-proto': 'https', 'user-agent': opts.ua || '' } };
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; }, end(b) { this.raw = b; } };
  await handler(req, res);
  const sc = res.h['Set-Cookie']; if (sc && !opts.noCookie) { const v = sc.split(';')[0]; cookie = v.endsWith('=') ? '' : v; }
  return { code: res.code || res.statusCode, ...res.body, raw: res.raw, headers: res.h };
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
ok('viajan solo los totales de bateo del equipo', g.tl && g.tl.ab === 6 && g.tl.h === 2 && Object.keys(g.tl).length === 12, JSON.stringify(g.tl));
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
r = await call(null, { home: '1' });
ok('el inicio trae los equipos con sus totales y sin datos de juegos', r.home && r.me.teams.length === 3 && r.stats[team].players === 2 && r.stats[team].games === 1 && r.stats[team].last === "2026-11-01" && r.stats[team3].games === 0 && !r.games && !r.roster, JSON.stringify(r.stats));
const hs = r.stats[team];
ok('el inicio trae récord, último marcador y racha', hs.season === '2026' && hs.w === 1 && hs.l === 0 && hs.lastGame.opp === 'Toros' && hs.lastGame.us === 1 && hs.lastGame.them === 0 && hs.form.join() === 'G', JSON.stringify(hs));

// Paquetes (Básico, Gold, Pro) y vigencia de la licencia
r = await call(null, { team });
ok('un equipo nuevo empieza en Gold y sin vencer', r.team.plan === 'gold' && !r.team.expired, r.team.plan);
await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', plan: 'basico' });
r = await call({ op: 'shareCreate', team, pid: 'p1' });
ok('en Básico no se crea enlace para papás', r.code === 403 && r.error === 'plan');
await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', plan: 'gold', expires: '2020-01-01' });
r = await call(null, { team });
ok('la licencia vencida se marca', r.team.plan === 'gold' && r.team.expired && r.team.expires === '2020-01-01');
ok('el administrador puede seguir corrigiendo un equipo vencido', r.canEdit === true);
r = await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', expires: 'mañana' });
ok('una fecha de vencimiento inválida se rechaza', r.code === 400 && r.error === 'bad_date');
await call({ op: 'adminUserSave', email: 'captura@x.mx', name: 'Capturista', password: 'temporal123', teams: [{ team, role: 'editor' }] });
await call({ op: 'login', email: 'captura@x.mx', password: 'temporal123' }, {}, { ip: '10.0.1.1' });
r = await call(null, { team });
ok('con la licencia vencida, Captura queda en solo lectura', r.team.id === team && r.canEdit === false);
r = await call({ op: 'put', team, col: 'roster', id: 'p9', data: { name: 'Nuevo' }, base: null });
ok('con la licencia vencida, Captura no puede guardar', r.code === 403);
await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.1.2' });
await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', expires: '' });
r = await call(null, { team });
ok('al quitar el vencimiento vuelve a estar vigente', !r.team.expired && r.team.expires === '' && r.canEdit);

// Juego en vivo
r = await call({ op: 'livePut', team, snap: { status: 'live' } });
ok('sin enlace no se puede transmitir', r.code === 404 && r.error === 'live_off');
r = await call({ op: 'liveLink', team }); const ltok = r.token;
ok('se crea el enlace en vivo', r.code === 200 && ltok && ltok.length >= 20);
r = await call({ op: 'liveLink', team });
ok('pedirlo otra vez devuelve el mismo', r.token === ltok);
r = await call(null, { team });
ok('la carga del coach incluye el enlace en vivo', r.live === ltok);
r = await call(null, { live: ltok }, { noCookie: true });
ok('antes de transmitir el enlace abre sin juego', r.code === 200 && r.live && r.snap === null && r.team.name === 'Diablillos');
r = await call({ op: 'livePut', team, snap: { status: 'live', inn: 3, line: { us: ['1', '0', '2'] } } });
ok('el coach sube el marcador', r.code === 200);
r = await call(null, { live: ltok }, { noCookie: true });
ok('los papás ven el marcador sin usuario', r.snap && r.snap.inn === 3 && r.snap.line.us[2] === '2' && r.ago >= 0);
r = await call({ op: 'livePut', team, snap: { big: 'x'.repeat(100 * 1024) } });
ok('un marcador demasiado grande se rechaza', r.code === 413);
r = await call({ op: 'livePut', team, snap: 'texto' });
ok('un marcador que no es objeto se rechaza', r.code === 400);
await call({ op: 'adminUserSave', email: 'lectura@x.mx', name: 'Lectura', password: 'temporal123', teams: [{ team, role: 'viewer' }] });
await call({ op: 'login', email: 'lectura@x.mx', password: 'temporal123' }, {}, { ip: '10.0.2.1' });
r = await call({ op: 'livePut', team, snap: { status: 'live' } });
ok('un usuario de solo lectura no puede transmitir', r.code === 403);
await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.2.2' });
await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', plan: 'basico' });
r = await call(null, { live: ltok }, { noCookie: true });
ok('en Básico el enlace en vivo deja de abrir', r.code === 404 && r.error === 'live_gone');
r = await call({ op: 'liveLink', team });
ok('en Básico no se crea enlace en vivo', r.code === 403 && r.error === 'plan');
await call({ op: 'adminTeamSave', id: team, name: 'Diablillos', category: 'Infantil', plan: 'gold' });
r = await call({ op: 'liveRevoke', team });
r = await call(null, { live: ltok }, { noCookie: true });
ok('al desactivarlo, el enlace anterior ya no abre', r.code === 404);
r = await call({ op: 'liveLink', team });
ok('el enlace nuevo es distinto', r.code === 200 && r.token !== ltok);

// Entradas a la plataforma
const tz = 'America/Mexico_City';
r = await call({ op: 'adminVisits', days: 30, tz });
const coachId = (await call({ op: 'adminList' })).users.find(u => u.email === 'coach@x.mx').id;
ok('cada inicio de sesión queda registrado', r.code === 200 && r.rows.filter(v => v.user === coachId && v.kind === 'login').length === 2 && r.total.logins === 4, JSON.stringify(r.total));
ok('las peticiones de una sesión no crean entradas de visita extra', r.rows.filter(v => v.kind === 'visit').length === 1, r.rows.map(v => v.kind).join());
const n0 = r.total.n;
await call({ op: 'login', email: 'lectura@x.mx', password: 'temporal123' }, {}, { ip: '10.0.3.1', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile' });
await call(null, { team });
await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.3.2' });
r = await call({ op: 'adminVisits', days: 1, tz });
const lect = r.rows.find(v => v.kind === 'login' && v.device.startsWith('Celular'));
ok('se registra el dispositivo', lect && lect.device === 'Celular · iPhone/iPad', lect && lect.device);
ok('el total del periodo suma las nuevas entradas', r.total.n === n0 + 2 && r.daily.length === 1 && r.daily[0].n === r.total.n, JSON.stringify(r.daily));
r = await call({ op: 'adminVisits', days: 30, tz, user: lect.user });
ok('se filtra por usuario', r.rows.length >= 1 && r.rows.every(v => v.user === lect.user) && r.total.users === 1);
r = await call({ op: 'adminList' });
ok('la lista de usuarios trae entradas de 30 días y la última', r.users.find(u => u.id === lect.user).visits30 >= 1 && r.users.find(u => u.id === lect.user).lastSeen);
r = await call({ op: 'adminVisits', days: 30, tz, before: r.users.length ? '1' : '' });
ok('el cursor pagina hacia atrás', r.code === 200 && r.rows.length === 0 && !r.more && !r.daily);
await call({ op: 'login', email: 'lectura@x.mx', password: 'temporal123' }, {}, { ip: '10.0.3.3' });
r = await call({ op: 'adminVisits', days: 30, tz });
ok('solo un administrador ve las entradas', r.code === 403);
await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.3.4' });

// Fotos: no viajan en la carga del equipo, se piden aparte
const png = 'data:image/png;base64,' + Buffer.from('foto-de-prueba').toString('base64');
r = await call({ op: 'put', team, col: 'roster', id: 'pf', data: { name: 'Con Foto', photo: png }, base: null });
ok('se guarda un jugador con foto', r.code === 200);
r = await call(null, { team });
const purl = r.roster.pf.photo;
ok('la carga trae la dirección de la foto y no la foto', typeof purl === 'string' && purl.startsWith('/api/data?photo=pf&') && !JSON.stringify(r.roster).includes('base64'), purl);
const pq = Object.fromEntries(new URLSearchParams(purl.split('?')[1]));
r = await call(null, pq);
ok('la foto se descarga aparte', r.code === 200 && Buffer.from(r.raw).toString() === 'foto-de-prueba' && r.headers['Content-Type'] === 'image/png' && /immutable/.test(r.headers['Cache-Control']));
let vp = (await call(null, { team })).ver.roster.pf;
r = await call({ op: 'put', team, col: 'roster', id: 'pf', data: { name: 'Con Foto Editado', photo: purl }, base: vp });
r = await call(null, pq);
ok('editar al jugador sin cambiar la foto la conserva', Buffer.from(r.raw || '').toString() === 'foto-de-prueba');
r = await call(null, { team });
ok('la dirección cambia al editar al jugador', r.roster.pf.photo !== purl && r.roster.pf.name === 'Con Foto Editado');
r = await call({ op: 'put', team, col: 'roster', id: 'pf', data: { name: 'Sin Foto' }, base: r.ver.roster.pf });
r = await call(null, pq);
ok('quitar la foto la borra', r.code === 404);
r = await call(null, { photo: 'pf', team: 'otro-equipo' });
ok('no se piden fotos de un equipo sin acceso', r.code === 404);

// Copia en la nube del box score en curso
r = await call(null, { team });
ok('sin box score en curso la carga trae draft vacío', r.draft === null);
const myId = (await call(null, { team })).me.id;
r = await call({ op: 'draftPut', team, draft: { opp: 'X' }, at: 1, owner: 'otro' });
ok('una copia de otro usuario se rechaza', r.code === 409 && r.error === 'owner');
r = await call({ op: 'draftPut', team, owner: myId, draft: { opp: 'Toros', cells: { '0_1': [{ res: 'H1' }] } }, at: 1000 });
ok('se guarda el box score en curso', r.code === 200);
r = await call(null, { team });
ok('la carga lo devuelve para recuperarlo', r.draft && r.draft.at === 1000 && r.draft.draft.opp === 'Toros');
await call({ op: 'draftPut', team, owner: myId, draft: { opp: 'Viejo' }, at: 500 });
r = await call(null, { team });
ok('una copia más vieja no pisa a la nueva', r.draft.draft.opp === 'Toros');
r = await call(null, { team, since: r.now });
ok('la carga parcial no lo repite', !('draft' in r));
await call({ op: 'draftDel', team, at: 900 });
r = await call(null, { team });
ok('borrar con una marca anterior no borra la copia más nueva', r.draft && r.draft.at === 1000);
await call({ op: 'draftDel', team, at: 2000 });
r = await call(null, { team });
ok('al guardar el juego se borra la copia', r.draft === null);
r = await call({ op: 'draftPut', team, draft: 'x' });
ok('un box score que no es objeto se rechaza', r.code === 400);
await call({ op: 'login', email: 'lectura@x.mx', password: 'temporal123' }, {}, { ip: '10.0.4.1' });
r = await call({ op: 'draftPut', team, draft: { opp: 'X' }, at: 1 });
ok('un usuario de solo lectura no guarda box score en curso', r.code === 403);
await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.4.2' });

// Eliminar un equipo con datos
await call({ op: 'put', team: team2, col: 'roster', id: 'px', data: { name: 'Uno' }, base: null });
r = await call({ op: 'adminTeamDelete', id: team2 });
ok('un equipo con datos no se borra sin confirmación', r.code === 409 && r.error === 'not_empty');
r = await call({ op: 'adminTeamDelete', id: team2, force: true });
r = await call({ op: 'adminList' });
ok('con confirmación se borra el equipo y sus jugadores', !r.teams.some(t => t.id === team2));
r = await call({ op: 'put', team, col: 'roster', id: 'px', data: { name: 'Reusa id' }, base: null });
ok('el jugador borrado ya no existe', r.code === 200);

// R4 límite de intentos
await call({ op: 'logout' });
for (let i = 0; i < 10; i++) { r = await call({ op: 'login', email: 'coach@x.mx', password: 'mala' + i }, {}, { ip: '10.0.0.' + (i + 2) }); }
ok('10 intentos fallidos responden "incorrectos"', r.code === 401);
r = await call({ op: 'login', email: 'coach@x.mx', password: 'secreta123' }, {}, { ip: '10.0.0.99' });
ok('el 11º intento queda bloqueado aunque la contraseña sea buena', r.code === 429 && r.error === 'locked', r.message);
r = await call({ op: 'login', email: 'otro@x.mx', password: 'x' }, {}, { ip: '10.0.0.9' });
ok('otro correo desde otra IP no se bloquea', r.code === 401);
console.log('\nTodas las pruebas de la API pasaron.');
