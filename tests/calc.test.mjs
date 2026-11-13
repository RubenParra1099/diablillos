// Pruebas de js/calc.js con los 9 juegos de referencia (tests/fixture.json). Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../js/calc.js', import.meta.url), 'utf8') + '\n;this.C = { BATK, FLDK, PITK, num, zero, derive, applyPA, indPA, paList, splitOf, rollingBat, mvpScores, pythag, pitchMax, restDays, pitchStatus, parsePlay, sprayOf, rivalKey, ageOn, bdayInfo, ipToOuts, outsToIp, fmtRate, sprayPoint, playFromPoint, sprayCat, liveState, batOutcomes, bbTypes, batTrends };', ctx);
const C = ctx.C;
const fx = JSON.parse(fs.readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
const games = Object.entries(fx.games).map(([id, g]) => ({ id, ...g })).sort((a, b) => a.date.localeCompare(b.date));
const near = (a, b, tol = 5e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} no es ${b}`);
const batOf = pid => { const t = C.zero(C.BATK); games.forEach(g => (g.lines || []).filter(l => l.pid === pid).forEach(l => C.BATK.forEach(k => t[k] += C.num(l[k])))); return C.derive(t); };

test('wOBA, OBP y SLG del mejor bateador (p03)', () => {
  const p = batOf('p03');
  assert.equal(p.pa, 45); near(p.woba, .893); near(p.obp, .711); near(p.slg, 1.475); near(p.avg, .675);
});

test('récord esperado (pitagórico)', () => {
  let rs = 0, ra = 0; games.forEach(g => { rs += g.us.reduce((a, v) => a + C.num(v), 0); ra += g.them.reduce((a, v) => a + C.num(v), 0); });
  assert.equal(rs, 81); assert.equal(ra, 38);
  near(C.pythag(rs, ra), .800, 1e-3); near(C.pythag(rs, ra) * games.length, 7.2, .05);
});

test('primer turno de la entrada y OBP por outs (hoja de anotación)', () => {
  const r = C.indPA(games);
  assert.equal(r.inns, 73); assert.equal(r.loOn, 32); assert.equal(r.loOnSc, 21); assert.equal(r.loOff, 41); assert.equal(r.loOffSc, 11);
  assert.equal(JSON.stringify(r.outs), JSON.stringify([[150, 77], [141, 69], [106, 41]]));
  assert.equal(r.reached, 187); assert.equal(r.scored, 81);
});

test('lista de turnos: mismo orden que indPA y jugador correcto', () => {
  const pl = C.paList(games);
  assert.equal(pl.length, 397); assert.equal(pl.filter(x => x.lead).length, 73);
  assert.equal(pl.filter(x => x.scored).length, 81);
  const s = C.splitOf(pl, x => x.outs === 2); assert.equal(s.n, 106); assert.equal(s.on, 41);
  assert.equal(pl.filter(x => x.pid === 'p03').length, 45);
});

test('MVP del 17 de octubre: p03 con 16 puntos', () => {
  const g = games.find(x => x.date === '2026-10-17'), r = C.mvpScores(g);
  assert.equal(r[0].pid, 'p03'); assert.equal(r[0].pts, 16); assert.equal(r[0].bat, 16);
});

test('MVP pitcher del 3 de octubre: 13 puntos', () => {
  const r = C.mvpScores(games.find(x => x.date === '2026-10-03'));
  assert.equal(r[0].pid, 'p10'); assert.equal(r[0].pts, 13); assert.equal(r[0].pit, 13);
});

test('reglas del brazo: máximo por edad y descanso', () => {
  assert.equal(C.pitchMax(8), 50); assert.equal(C.pitchMax(10), 75); assert.equal(C.pitchMax(12), 85); assert.equal(C.pitchMax(16), 95); assert.equal(C.pitchMax(18), 105); assert.equal(C.pitchMax(null), null);
  assert.equal(C.restDays(20, 12), 0); assert.equal(C.restDays(21, 12), 1); assert.equal(C.restDays(50, 12), 2); assert.equal(C.restDays(65, 12), 3); assert.equal(C.restDays(66, 12), 4);
  assert.equal(C.restDays(70, 16), 3); assert.equal(C.restDays(76, 16), 4); assert.equal(C.restDays(30, 16), 0);
  const st = C.pitchStatus([{ date: '2026-11-07', np: 70, age: 12 }], '2026-11-08');
  assert.equal(st.rest, 4); assert.equal(st.availableOn, '2026-11-12'); assert.equal(st.ok, false); assert.equal(st.week, 70);
  assert.equal(C.pitchStatus([{ date: '2026-11-07', np: 70, age: 12 }], '2026-11-12').ok, true);
  assert.equal(C.pitchStatus([{ date: '2026-11-08', np: 30, age: 12 }], '2026-11-08').last, null);
  assert.equal(C.pitchStatus([{ date: '2026-11-08', np: 30, age: 12 }], '2026-11-08', true).ok, false);
});

test('lectura de jugadas anotadas', () => {
  const t = s => { const r = C.parsePlay(s); return r && `${r.zone}${r.type}${r.field}`; };
  assert.equal(t('6-3'), '6groundL'); assert.equal(t('F8'), '8flyC'); assert.equal(t('L6'), '6lineL'); assert.equal(t('3U'), '3groundR');
  assert.equal(t('P4'), '4popR'); assert.equal(t('E5'), '5errorL'); assert.equal(t('5-4-3'), '5groundL'); assert.equal(t(''), null);
  const sp = C.sprayOf(C.paList(games).filter(x => x.play));
  assert.equal(sp.n, 172); assert.equal(sp.zones[6], 46);
});

test('tendencia móvil de 3 juegos', () => {
  const lines = games.map(g => (g.lines || []).find(l => l.pid === 'p03')).filter(Boolean);
  const r = C.rollingBat(lines, 3); assert.equal(r.length, lines.length);
  const t = C.zero(C.BATK); lines.slice(-3).forEach(l => C.BATK.forEach(k => t[k] += C.num(l[k]))); C.derive(t);
  near(r[r.length - 1].woba, t.woba, 1e-9);
});

test('edad, cumpleaños, rivales y entradas', () => {
  assert.equal(C.ageOn('2014-05-01', '2026-11-08'), 12); assert.equal(C.ageOn('2014-11-09', '2026-11-08'), 11); assert.equal(C.ageOn('', '2026-11-08'), null);
  const b = C.bdayInfo('2016-11-12', '2026-11-08'); assert.equal(b.age, 10); assert.equal(b.days, 4); assert.equal(b.date, '2026-11-12');
  assert.equal(C.bdayInfo('2016-11-06', '2026-11-08').days, -2);
  assert.equal(C.rivalKey('  Tóros  '), C.rivalKey('toros'));
  assert.equal(C.ipToOuts('5.2'), 17); assert.equal(C.outsToIp(17), '5.2'); assert.ok(Number.isNaN(C.ipToOuts('5.3')));
});

test('mapa de batazos: punto exacto, aproximado y sector', () => {
  assert.equal(C.sprayPoint({ res: 'K', play: '' }, 'k'), null);
  assert.equal(C.sprayPoint({ res: 'BB', loc: { a: 0, d: .5 } }, 'k'), null);
  const ex = C.sprayPoint({ res: 'H2', loc: { a: 27, d: .9 } }, 'k');
  assert.equal(ex.approx, false); assert.equal(ex.sec, 'R'); assert.equal(ex.cat, 'H2');
  assert.equal(C.sprayPoint({ res: 'H1', loc: { a: -20, d: .6 } }, 'k').sec, 'L');
  assert.equal(C.sprayPoint({ res: 'H1', loc: { a: 10, d: .6 } }, 'k').sec, 'C');
  const ap = C.sprayPoint({ res: 'O', play: 'F8' }, 'k'); assert.equal(ap.approx, true); assert.equal(ap.sec, 'C'); assert.ok(ap.d > .7);
  assert.deepEqual({ ...C.sprayPoint({ res: 'O', play: '6-3' }, 'a') }, { ...C.sprayPoint({ res: 'O', play: '6-3' }, 'a') }, 'el mismo turno siempre cae en el mismo lugar');
  assert.ok(C.sprayPoint({ res: 'HR', play: 'F7' }, 'k').d > 1);
  // reparto de p03 con lo anotado: 6 izquierdo, 3 central, 8 derecho
  const pts = C.paList(games).filter(x => x.pid === 'p03').map(x => C.sprayPoint(x, x.key)).filter(Boolean), c = { L: 0, C: 0, R: 0 }; pts.forEach(p => c[p.sec]++);
  assert.equal(JSON.stringify(c), JSON.stringify({ L: 6, C: 3, R: 8 }));
});

test('jugada sugerida desde el punto tocado', () => {
  assert.equal(C.playFromPoint(28, .9, 'O'), 'F9'); assert.equal(C.playFromPoint(-30, .9, 'H2'), 'F7'); assert.equal(C.playFromPoint(0, .6, 'H1'), 'L8');
  assert.equal(C.playFromPoint(-18, .4, 'O'), '6-3'); assert.equal(C.playFromPoint(18, .4, 'DP'), '4-6-3'); assert.equal(C.playFromPoint(38, .35, 'O'), '3U');
  assert.equal(C.playFromPoint(-38, .35, 'E'), 'E5'); assert.equal(C.playFromPoint(0, .2, 'O'), '1-3'); assert.equal(C.sprayCat('BO'), 'O');
});

test('juego en vivo: entrada, outs, corredores y quién sigue', () => {
  const slots = Array.from({ length: 9 }, (_, i) => ({ pid: 'p' + i })), oslots = Array.from({ length: 9 }, () => ({ num: '', name: '' }));
  const base = { ha: 'L', inns: 7, mode: 'trad', us: { slots, cells: {} }, them: { slots: oslots, cells: {}, runs: Array(7).fill('') } };
  let s = C.liveState(base);
  assert.equal(s.started, false); assert.equal(s.inn, 1); assert.equal(s.half, 'top'); assert.equal(s.side, 'them');
  // El rival anotó 1 en la alta de la 1a (escrito a mano): ahora batea el local
  s = C.liveState({ ...base, them: { ...base.them, runs: ['1', '', '', '', '', '', ''] } });
  assert.equal(s.half, 'bot'); assert.equal(s.side, 'us'); assert.equal(s.outs, 0); assert.equal(s.next.us, 0);
  assert.equal(s.plays.length, 1); assert.equal(s.plays[0].manual, true); assert.equal(s.plays[0].runs, 1);
  // Sencillo, ponche y doble que impulsa: corredor en 2a, 1 out, sigue el 4o
  const cells = { '0_1': [{ res: 'H1', reach: 4 }], '1_1': [{ res: 'K', out: 1 }], '2_1': [{ res: 'H2', reach: 2, rbi: 1 }] };
  s = C.liveState({ ...base, us: { slots, cells }, them: { ...base.them, runs: ['1'] } });
  assert.equal(s.inn, 1); assert.equal(s.half, 'bot'); assert.equal(s.outs, 1);
  assert.deepEqual([...s.bases], [null, 2, null]); assert.equal(s.next.us, 3);
  assert.deepEqual([...s.plays.filter(p => !p.manual).map(p => p.si)], [0, 1, 2]);
  // Dos outs más cierran la entrada: pasa a la alta de la 2a sin corredores
  const c3 = { ...cells, '3_1': [{ res: 'O', out: 2 }], '4_1': [{ res: 'O', out: 3 }] };
  s = C.liveState({ ...base, us: { slots, cells: c3 }, them: { ...base.them, runs: ['1'] } });
  assert.equal(s.inn, 2); assert.equal(s.half, 'top'); assert.equal(s.side, 'them'); assert.deepEqual([...s.bases], [null, null, null]); assert.equal(s.next.us, 5);
  // Como visitantes batean en la alta; la hoja del rival manda sobre lo escrito a mano
  s = C.liveState({ ...base, ha: 'V', us: { slots, cells: c3 }, them: { slots: oslots, cells: { '0_1': [{ res: 'BB', reach: 1 }] }, runs: ['5'] } });
  assert.equal(s.inn, 1); assert.equal(s.half, 'bot'); assert.equal(s.side, 'them'); assert.deepEqual([...s.bases], [0, null, null]); assert.equal(s.next.them, 1);
  // Chupón: la entrada se cierra al batear los N del turno, no por outs
  s = C.liveState({ ...base, ha: 'V', mode: 'chupon', bpi: 2, us: { slots, cells: { '0_1': [{ res: 'O', out: 1 }], '1_1': [{ res: 'H1', reach: 1 }] } } });
  assert.equal(s.half, 'bot'); assert.equal(s.side, 'them');
});

test('ficha: en qué terminan los turnos, tipo de batazo y tendencias', () => {
  const o = C.batOutcomes({ ab: 52, h: 19, d: 5, t: 1, hr: 2, bb: 7, hbp: 1, sf: 1, sh: 1, so: 9 });
  assert.deepEqual({ ...o }, { pa: 62, h: 19, onb: 8, sac: 2, so: 9, inplay: 24, s1: 11, d: 5, t: 1, hr: 2 });
  const bt = C.bbTypes([{ play: '6-3' }, { play: 'F8' }, { play: 'P4' }, { play: 'L7' }, { play: 'E6' }, { play: '' }]);
  assert.deepEqual({ ...bt }, { n: 4, ground: 1, fly: 2, line: 1 });
  const mk = x => C.derive({ ...C.zero(C.BATK), ...x });
  const team = mk({ ab: 400, h: 100, d: 15, t: 3, hr: 4, bb: 40, so: 100, sb: 30, cs: 10 });
  const b = mk({ ab: 52, h: 19, d: 5, t: 1, hr: 2, bb: 7, hbp: 1, sf: 1, sh: 1, so: 5, sb: 5, cs: 1 });
  // 10 turnos abriendo entrada (2 en base) y 10 sin abrir (8 en base); 12 batazos, 7 al izquierdo
  const pas = [...Array.from({ length: 10 }, (_, i) => ({ lead: true, outs: 0, on: i < 2, play: i < 7 ? 'L7' : '' })), ...Array.from({ length: 10 }, (_, i) => ({ lead: false, outs: 1, on: i < 8, play: i < 5 ? 'F8' : '' }))];
  const tr = C.batTrends({ b, team, recent: { ab: 10, h: 6 }, pas });
  const ks = tr.map(x => x.k);
  assert.equal(ks[0], 'hot'); assert.ok(ks.includes('power') && ks.includes('contact') && ks.includes('speed'));
  assert.ok(tr.length <= 5); assert.equal(tr[tr.length - 1].tone === 'warn' || !tr.some(x => x.tone === 'warn'), true);
  assert.equal(tr.find(x => x.k === 'hot').v, '.600');
  // Sin turnos suficientes no sale nada
  assert.equal(C.batTrends({ b: mk({ ab: 8, h: 4 }), team, pas: [] }).length, 0);
  // La de abrir la entrada sale si no la tapan las buenas
  const tr2 = C.batTrends({ b: mk({ ab: 30, h: 8, bb: 2, so: 6 }), team, pas });
  assert.ok(tr2.some(x => x.k === 'lead' && x.tone === 'warn' && x.v === '20%')); assert.ok(tr2.some(x => x.k === 'spray' && x.title === 'Batea al jardín izquierdo'));
});
