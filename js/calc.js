/* Cálculos de la plataforma (sin pantalla): estadísticas, sabermetría, MVP, cumpleaños y reglas del brazo.
   Se carga antes que la app y también lo usan las pruebas (tests/calc.test.mjs). No usa el DOM. */
const BAT = [['ab','AB'],['r','R'],['h','H'],['d','2B'],['t','3B'],['hr','HR'],['rbi','RBI'],['bb','BB'],['so','SO'],['hbp','HBP'],['sf','SF'],['sh','SH'],['sb','SB'],['cs','CS'],['onb','EB'],['bases','BT']];

const FLD = [['ec','EC'],['po','PO'],['a','A'],['e','E'],['dp','DP']];

const PIT = [['h','H'],['r','C'],['er','CL'],['bb','BB'],['so','K'],['hbp','BG'],['wp','WP'],['hr','HR'],['np','LZ']];

const BATK = BAT.map(x => x[0]), FLDK = FLD.map(x => x[0]), PITK = PIT.map(x => x[0]);

const RES = {
  H1: { lab: 'Hit sencillo', g: 'Hit', ab: 1, hit: 1, reach: 1 },
  H2: { lab: 'Hit doble', g: 'Hit', ab: 1, hit: 2, reach: 2 },
  H3: { lab: 'Hit triple', g: 'Hit', ab: 1, hit: 3, reach: 3 },
  HR: { lab: 'Home run (cuadrangular)', g: 'Hit', ab: 1, hit: 4, reach: 4 },
  BB: { lab: 'Base por bolas', g: 'Embasado', bb: 1, reach: 1 },
  BBI: { lab: 'Base por bolas intencional', g: 'Embasado', bb: 1, reach: 1 },
  BG: { lab: 'Base por golpe', g: 'Embasado', hbp: 1, reach: 1 },
  E: { lab: 'Embasado por error (anota quién: E6)', g: 'Embasado', ab: 1, reach: 1 },
  BO: { lab: 'Bola ocupada / jugada de selección', g: 'Embasado', ab: 1, reach: 1 },
  K: { lab: 'Ponche tirándole', g: 'Out', ab: 1, so: 1, out: 1 },
  KC: { lab: 'Ponche cantado', g: 'Out', ab: 1, so: 1, out: 1 },
  O: { lab: 'Out: rodado, elevado o línea (anota la jugada)', g: 'Out', ab: 1, out: 1 },
  DP: { lab: 'Rodado de doble play', g: 'Out', ab: 1, out: 1 },
  FS: { lab: 'Fly de sacrificio', g: 'Out', sf: 1, out: 1 },
  TS: { lab: 'Toque de sacrificio', g: 'Out', sh: 1, out: 1 },
};

const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function fmtRate(x, dig = 3) { if (x == null || !isFinite(x)) return '—'; const s = x.toFixed(dig); return x < 1 && x >= 0 ? s.replace(/^0/, '') : s; }

const num = v => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };

const sumA = a => (a || []).reduce((s, v) => s + num(v), 0);

const zero = keys => Object.fromEntries(keys.map(k => [k, 0]));

function ipToOuts(s) { s = String(s ?? '').trim(); if (!s) return 0; const m = s.match(/^(\d+)(?:\.(\d))?$/); if (!m) return NaN; const f = +(m[2] || 0); if (f > 2) return NaN; return (+m[1]) * 3 + f; }

const outsToIp = o => Math.floor(o / 3) + '.' + (o % 3);

function applyPA(b, pa) {
  const R = RES[pa.res]; if (!R) return;
  b.pa = (b.pa || 0) + 1;
  if (R.ab) b.ab++;
  if (R.hit) { b.h++; if (R.hit === 2) b.d++; if (R.hit === 3) b.t++; if (R.hit === 4) b.hr++; }
  if (R.bb) b.bb++; if (R.hbp) b.hbp++; if (R.so) b.so++; if (R.sf) b.sf++; if (R.sh) b.sh++;
  if (num(pa.reach) === 4) b.r++;
  b.bases = (b.bases || 0) + num(pa.reach); if (num(pa.reach) >= 1) b.onb = (b.onb || 0) + 1;
  b.rbi += num(pa.rbi); b.sb += num(pa.sb); if (pa.cs) b.cs++;
}

const slotFilled = s => !!(s && (s.pid || s.name || s.num));

function lineupLen(slots) { let L = slots.length; while (L > 0 && !slotFilled(slots[L - 1])) L--; return L || slots.length; }

function derive(p) {
  p.pa = p.ab + p.bb + p.hbp + p.sf + p.sh; p.s1 = p.h - p.d - p.t - p.hr;
  p.tb = p.s1 + 2 * p.d + 3 * p.t + 4 * p.hr;
  const obpD = p.ab + p.bb + p.hbp + p.sf;
  p.avg = p.ab ? p.h / p.ab : NaN; p.obp = obpD ? (p.h + p.bb + p.hbp) / obpD : NaN; p.slg = p.ab ? p.tb / p.ab : NaN;
  p.ops = obpD ? (isNaN(p.obp) ? 0 : p.obp) + (isNaN(p.slg) ? 0 : p.slg) : NaN;
  p.iso = p.ab ? p.slg - p.avg : NaN;
  const bD = p.ab - p.so - p.hr + p.sf; p.babip = bD > 0 ? (p.h - p.hr) / bD : NaN;
  p.woba = obpD ? (.69 * p.bb + .72 * p.hbp + .89 * p.s1 + 1.27 * p.d + 1.62 * p.t + 2.10 * p.hr) / obpD : NaN;
  p.onb = p.onb || 0; p.bases = p.bases || 0; p.onbp = p.pa ? p.onb / p.pa : NaN; p.bpt = p.pa ? p.bases / p.pa : NaN; p.contact = p.pa ? (p.pa - p.so) / p.pa : NaN;
  p.kp = p.pa ? p.so / p.pa : NaN; p.bbp = p.pa ? p.bb / p.pa : NaN; p.sbp = (p.sb + p.cs) ? p.sb / (p.sb + p.cs) : NaN;
  return p;
}

function indPA(gs) {
  const r = { games: 0, inns: 0, loOn: 0, loOnSc: 0, loOff: 0, loOffSc: 0, outs: [[0, 0], [0, 0], [0, 0]], reached: 0, scored: 0, lob: 0, innRuns: 0, big: 0 };
  gs.forEach(g => {
    const sh = g.sheet; if (!sh || !sh.cells || !Object.keys(sh.cells).length) return; r.games++;
    const L = lineupLen(sh.slots || []) || 9; let start = 0;
    for (let inn = 1; inn <= (g.inns || 9); inn++) {
      const pas = [];
      Object.entries(sh.cells).forEach(([k, arr]) => { const [si, i] = k.split('_').map(Number); if (i === inn) (arr || []).forEach((pa, idx) => { if (RES[pa.res]) pas.push({ si, idx, pa }); }); });
      if (!pas.length) continue;
      pas.sort((a, b) => a.idx - b.idx || ((a.si - start + L) % L) - ((b.si - start + L) % L));
      r.inns++; let outs = 0, runs = 0;
      pas.forEach(({ pa }) => {
        const reach = num(pa.reach), b = r.outs[Math.min(outs, 2)]; b[0]++; if (reach > 0) { b[1]++; r.reached++; }
        if (reach === 4) { r.scored++; runs++; } else if (reach > 0 && !num(pa.out)) r.lob++;
        if (num(pa.out)) outs++;
      });
      if (runs > 0) r.innRuns++; if (runs >= 3) r.big++;
      if (num(pas[0].pa.reach) > 0) { r.loOn++; if (runs > 0) r.loOnSc++; } else { r.loOff++; if (runs > 0) r.loOffSc++; }
      start = (pas[pas.length - 1].si + 1) % L;
    }
  });
  return r;
}

function ageOn(birth, at) {
  const b = String(birth || '').match(/^(\d{4})-(\d{2})-(\d{2})/), a = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!b || !a) return null;
  const y = a[1] - b[1] - (a[2] + a[3] < b[2] + b[3] ? 1 : 0); return y >= 0 && y < 80 ? y : null;
}

function bdayInfo(birth, from = today()) {
  const b = String(birth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!b) return null;
  const t = new Date(from + 'T12:00:00'); let y = t.getFullYear();
  const at = yy => new Date(`${yy}-${b[2]}-${b[3]}T12:00:00`);
  let d = at(y); if ((d - t) / 864e5 < -3) d = at(++y);
  return { date: `${y}-${b[2]}-${b[3]}`, age: y - +b[1], days: Math.round((d - t) / 864e5) };
}

function mvpScores(g) {
  const m = {}, P = pid => m[pid] ||= { pid, bat: 0, pit: 0, fld: 0, b: null, p: null };
  (g.lines || []).forEach(l => {
    if (!l.pid) return; const x = P(l.pid), s1 = num(l.h) - num(l.d) - num(l.t) - num(l.hr);
    x.b ||= zero([...BATK, ...FLDK]); [...BATK, ...FLDK].forEach(k => x.b[k] += num(l[k]));
    x.bat += s1 + 2 * num(l.d) + 3 * num(l.t) + 4 * num(l.hr) + num(l.r) + num(l.rbi) + num(l.bb) + num(l.hbp) + num(l.sb) - num(l.cs) - .5 * num(l.so);
    x.fld += num(l.dp) - num(l.e);
  });
  (g.pit || []).forEach(p => {
    if (!p.pid) return; const x = P(p.pid); x.p = p;
    x.pit += .5 * num(p.outs) + num(p.so) + (p.dec === 'G' || p.dec === 'S' ? 2 : 0) - .5 * (num(p.h) + num(p.bb) + num(p.hbp)) - (num(p.r) - num(p.er)) - 2 * num(p.er);
  });
  const st = (x, k) => x.b ? x.b[k] : 0;
  return Object.values(m).map(x => ({ ...x, pts: x.bat + x.pit + x.fld })).sort((a, b) => b.pts - a.pts || st(b, 'rbi') - st(a, 'rbi') || st(b, 'h') - st(a, 'h'));
}


/* ---------- Protección del brazo (Little League y Pitch Smart) ---------- */
// Máximo de lanzamientos por día según la edad
const PITCH_MAX = [[8, 50], [10, 75], [12, 85], [16, 95], [18, 105]];
function pitchMax(age) { if (age == null) return null; for (const [a, m] of PITCH_MAX) if (age <= a) return m; return 105; }
// Días de descanso obligatorios según lanzamientos (tabla de 14 años o menos y de 15 a 18)
function restDays(np, age) {
  const t = age != null && age >= 15 ? [[76, 4], [61, 3], [46, 2], [31, 1]] : [[66, 4], [51, 3], [36, 2], [21, 1]];
  for (const [n, d] of t) if (np >= n) return d; return 0;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
// Estado de un lanzador a una fecha: outings = [{ date, np, age }] de cualquier temporada.
// withToday: cuenta también lo lanzado ese mismo día (para el tablero de hoy)
function pitchStatus(outings, at, withToday) {
  const past = outings.filter(o => o.date && (withToday ? o.date <= at : o.date < at)).sort((a, b) => a.date.localeCompare(b.date)), last = past[past.length - 1];
  if (!last) return { last: null, rest: 0, availableOn: at, ok: true, week: 0 };
  const rest = last.np ? restDays(last.np, last.age) : 0, availableOn = addDays(last.date, rest + 1);
  const week = past.filter(o => daysBetween(o.date, at) <= 7).reduce((a, o) => a + (o.np || 0), 0);
  return { last, rest, availableOn, ok: at >= availableOn, week, noCount: !last.np };
}

/* ---------- Jugadas anotadas (6-3, F8, L6, P4, 3U, E5) ---------- */
// zona = número de la posición que tomó la bola; tipo = rodado, línea, elevado, elevado al cuadro o error
function parsePlay(play) {
  const p = String(play || '').toUpperCase().replace(/\s+/g, ''); const m = p.match(/[1-9]/); if (!m) return null;
  const zone = +m[0];
  const type = p[0] === 'F' ? 'fly' : p[0] === 'L' ? 'line' : p[0] === 'P' ? 'pop' : p[0] === 'E' ? 'error' : (/^\d-\d|^\dU/.test(p) || /^\d$/.test(p)) ? 'ground' : 'other';
  return { zone, type, field: [5, 6, 7].includes(zone) ? 'L' : [3, 4, 9].includes(zone) ? 'R' : 'C' };
}
// Reparto de batazos de una lista de turnos (cada uno con .play y opcionalmente .res)
function sprayOf(pas) {
  const z = {}, t = { ground: 0, line: 0, fly: 0, pop: 0, error: 0, other: 0 }, f = { L: 0, C: 0, R: 0 }; let n = 0;
  pas.forEach(pa => { const r = parsePlay(pa.play); if (!r) return; n++; z[r.zone] = (z[r.zone] || 0) + 1; t[r.type]++; f[r.field]++; });
  return { n, zones: z, types: t, fields: f };
}
// Récord esperado (pitagórico, exponente 1.83)
const pythag = (rs, ra) => rs + ra ? Math.pow(rs, 1.83) / (Math.pow(rs, 1.83) + Math.pow(ra, 1.83)) : NaN;
// Nombre de rival normalizado para agrupar (mayúsculas, acentos y espacios no cuentan)
const rivalKey = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

/* ---------- Turno por turno: jugador, entrada, outs y lugar en el orden ---------- */
const pidAt = (s, inn) => (s && s.sub && s.sub.pid && inn >= (num(s.sub.from) || 1)) ? s.sub.pid : (s ? s.pid : '');
// Mismo orden que indPA: cada entrada empieza después del último bateador de la anterior
function paList(gs) {
  const out = [];
  gs.forEach(g => {
    const sh = g.sheet; if (!sh || !sh.cells) return;
    const slots = sh.slots || [], L = lineupLen(slots) || 9; let start = 0;
    for (let inn = 1; inn <= (g.inns || 9); inn++) {
      const pas = [];
      Object.entries(sh.cells).forEach(([k, arr]) => { const [si, i] = k.split('_').map(Number); if (i === inn) (arr || []).forEach((pa, idx) => { if (RES[pa.res]) pas.push({ si, idx, pa }); }); });
      if (!pas.length) continue;
      pas.sort((a, b) => a.idx - b.idx || ((a.si - start + L) % L) - ((b.si - start + L) % L));
      let outs = 0;
      pas.forEach((x, j) => {
        out.push({ gid: g.id, date: g.date, inn, slot: x.si, pid: pidAt(slots[x.si], inn), outs: Math.min(outs, 2), lead: j === 0, on: num(x.pa.reach) > 0, scored: num(x.pa.reach) === 4, res: x.pa.res, play: x.pa.play || '', loc: x.pa.loc || null, key: g.id + '_' + inn + '_' + x.si + '_' + x.idx });
        if (num(x.pa.out)) outs++;
      });
      start = (pas[pas.length - 1].si + 1) % L;
    }
  });
  return out;
}
// Porcentaje de veces en base de un grupo de turnos
function splitOf(pas, pred) { const xs = pas.filter(pred), on = xs.filter(x => x.on).length; return { n: xs.length, on, pct: xs.length ? on / xs.length : NaN }; }
// Tendencia: wOBA, K% y BB% de los últimos w juegos, juego por juego (lines en orden de fecha)
function rollingBat(lines, w = 3) {
  return lines.map((_, i) => {
    const t = zero(BATK); lines.slice(Math.max(0, i - w + 1), i + 1).forEach(l => BATK.forEach(k => t[k] += num(l[k])));
    derive(t); return { woba: t.woba, kp: t.kp, bbp: t.bbp, pa: t.pa, avg: t.avg };
  });
}

/* ---------- Mapa de batazos con punto (spray chart) ---------- */
// Punto en el campo: a = grados desde la línea central (−45 línea de 3ª, 45 línea de 1ª); d = distancia (1 = la barda)
const NO_BIP = ['K', 'KC', 'BB', 'BBI', 'BG'];
const sprayCat = res => ['H1', 'H2', 'H3', 'HR'].includes(res) ? res : 'O';
const ZONE_A = { 1: 0, 2: 0, 3: 37, 4: 24, 5: -37, 6: -24, 7: -30, 8: 0, 9: 30 };
const secOfA = a => a < -15 ? 'L' : a > 15 ? 'R' : 'C';
const secOfZone = z => [5, 6, 7].includes(z) ? 'L' : [3, 4, 9].includes(z) ? 'R' : 'C';
// Desvío fijo por turno (siempre el mismo) para que los puntos aproximados no se encimen
const jitOf = (key, k) => { let h = 2166136261; const s = String(key) + ':' + k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000 - .5; };
// Punto exacto si se tocó el campo (pa.loc); si no, aproximado desde la jugada anotada. Sin batazo (K, BB, BG) no hay punto.
function sprayPoint(pa, key) {
  if (!pa || NO_BIP.includes(pa.res)) return null;
  const cat = sprayCat(pa.res);
  if (pa.loc && isFinite(pa.loc.a) && isFinite(pa.loc.d)) return { a: +pa.loc.a, d: +pa.loc.d, sec: secOfA(+pa.loc.a), cat, approx: false };
  const r = parsePlay(pa.play); if (!r) return null;
  const z = r.zone, j = k => jitOf(key, k);
  let a = ZONE_A[z] + j(1) * 9, d;
  if (cat === 'HR') d = 1.07 + j(2) * .05; else if (cat === 'H3') d = .91 + j(2) * .05; else if (cat === 'H2') d = .8 + j(2) * .09; else if (cat === 'H1') d = .61 + j(2) * .09;
  else if (r.type === 'fly' && z >= 7) d = .78 + j(3) * .11; else if (r.type === 'line') d = z >= 7 ? .63 : .44; else if (r.type === 'pop') d = .4 + j(4) * .08;
  else d = z === 1 ? .24 : (z === 3 || z === 5) ? .35 : .43 + j(5) * .05;
  if (cat !== 'O' && cat !== 'HR' && z <= 6) a = (a >= 0 ? 24 : -24) + j(6) * 6; // hit por el cuadro: sale entre jardineros
  return { a, d, sec: secOfZone(z), cat, approx: true };
}
// Jugada sugerida a partir del punto tocado (se puede corregir a mano)
function playFromPoint(a, d, res) {
  let z;
  if (d >= .5) z = a < -15 ? 7 : a > 15 ? 9 : 8;
  else if (d < .12) z = 2;
  else if (d < .3 && Math.abs(a) < 10) z = 1;
  else z = a < -28 ? 5 : a < 0 ? 6 : a <= 28 ? 4 : 3;
  if (['H1', 'H2', 'H3', 'HR'].includes(res)) return d >= .5 ? (d > .85 ? 'F' : 'L') + z : String(z);
  if (res === 'E') return 'E' + z;
  if (d >= .5 || res === 'FS') return 'F' + z;
  if (res === 'DP') return ({ 4: '4-6-3', 5: '5-4-3', 6: '6-4-3' })[z] || z + '-3';
  return z === 3 ? '3U' : z + '-3';
}

// Juego en vivo: en qué va el juego según la hoja que se está capturando.
// g: { ha, inns, mode, bpi, us: { slots, cells }, them: { slots, cells, runs } }; runs son las carreras del rival escritas a mano
// (cuando no se lleva su hoja). ha 'L' = somos locales: el rival batea en la alta.
// Devuelve la entrada y mitad actual, outs, corredores (turno del lineup en 1a, 2a y 3a), el turno que sigue de cada equipo y las jugadas en orden.
function sidePAs(slots, cells, inns) {
  const L = lineupLen(slots || []) || 9, list = []; let start = 0;
  for (let inn = 1; inn <= inns; inn++) {
    const pas = [];
    Object.entries(cells || {}).forEach(([k, arr]) => { const [si, i] = k.split('_').map(Number); if (i === inn) (arr || []).forEach((pa, idx) => { if (RES[pa.res]) pas.push({ si, idx, inn, pa }); }); });
    if (!pas.length) continue;
    pas.sort((a, b) => a.idx - b.idx || ((a.si - start + L) % L) - ((b.si - start + L) % L));
    list.push(...pas); start = (pas[pas.length - 1].si + 1) % L;
  }
  return { list, L };
}
function liveState(g) {
  const inns = g.inns || 9, ch = g.mode === 'chupon', bpi = Math.max(1, num(g.bpi) || 10);
  const first = g.ha === 'L' ? 'them' : 'us', second = first === 'us' ? 'them' : 'us';
  const S = { us: sidePAs(g.us.slots, g.us.cells, inns), them: sidePAs(g.them.slots, g.them.cells, inns) };
  const manual = !S.them.list.length, runs = (g.them && g.them.runs) || [];
  const typed = inn => String(runs[inn - 1] ?? '').trim() !== '';
  const info = (side, inn) => {
    const pas = S[side].list.filter(x => x.inn === inn), outs = Math.min(3, pas.filter(x => num(x.pa.out)).length);
    if (side === 'them' && manual) return { pas, outs: 0, active: typed(inn), done: typed(inn), manual: true };
    return { pas, outs, active: pas.length > 0, done: ch ? pas.length >= bpi : outs >= 3 };
  };
  const halves = [];
  for (let inn = 1; inn <= inns; inn++) halves.push({ inn, half: 'top', side: first }, { inn, half: 'bot', side: second });
  let last = -1; halves.forEach((h, j) => { if (info(h.side, h.inn).active) last = j; });
  let cur = Math.max(0, last), over = false;
  if (last >= 0 && info(halves[cur].side, halves[cur].inn).done) { if (cur + 1 < halves.length) cur++; else over = true; }
  const H = halves[cur], hi = info(H.side, H.inn), bases = [null, null, null];
  hi.pas.forEach(x => { const r = num(x.pa.reach); if (r >= 1 && r <= 3 && !num(x.pa.out)) bases[r - 1] = x.si; });
  const nextOf = side => { const l = S[side].list; return l.length ? (l[l.length - 1].si + 1) % S[side].L : 0; };
  const plays = [];
  halves.slice(0, Math.max(last, -1) + 1).forEach(h => {
    const x = info(h.side, h.inn);
    if (x.manual) { if (x.active) plays.push({ inn: h.inn, half: h.half, side: h.side, manual: true, runs: num(runs[h.inn - 1]) }); return; }
    x.pas.forEach(p => plays.push({ inn: h.inn, half: h.half, side: h.side, si: p.si, pa: p.pa }));
  });
  return { inn: H.inn, half: H.half, side: H.side, outs: hi.outs, pas: hi.pas.length, manual: !!hi.manual, bases, next: { us: nextOf('us'), them: nextOf('them') }, over, started: last >= 0, plays };
}

// Ficha: en qué terminan los turnos de un bateador (línea ya sumada) y cómo se reparten sus hits
function batOutcomes(b) {
  const pa = num(b.ab) + num(b.bb) + num(b.hbp) + num(b.sf) + num(b.sh), h = num(b.h), onb = num(b.bb) + num(b.hbp), sac = num(b.sf) + num(b.sh), so = num(b.so);
  const d = num(b.d), t = num(b.t), hr = num(b.hr);
  return { pa, h, onb, sac, so, inplay: Math.max(0, pa - h - onb - sac - so), s1: Math.max(0, h - d - t - hr), d, t, hr };
}
// Tipo de batazo según la jugada anotada (6-3 rodado, F8 elevado, L7 línea). Los elevados incluyen los de foul/pop (P).
function bbTypes(pas) { const t = sprayOf(pas).types; return { n: t.ground + t.fly + t.pop + t.line, ground: t.ground, fly: t.fly + t.pop, line: t.line }; }
// Tendencias del bateador comparado con el equipo. Solo salen cuando el dato es claro y tiene al menos minPA turnos.
// o: { b: línea de temporada (derive), team: línea del equipo (derive), recent: { ab, h } de sus últimos 3 juegos, pas: sus turnos (paList), minPA }
// Devuelve hasta 5, en orden: racha, buenas, informativas y de atención.
function batTrends(o) {
  const b = o.b, T = o.team, out = [], minPA = o.minPA || 15;
  if (!b || b.pa < minPA) return out;
  const pct = x => Math.round(100 * x) + '%', r3 = x => fmtRate(x), pas = o.pas || [];
  const rc = o.recent;
  if (rc && rc.ab >= 6 && isFinite(b.avg)) {
    const a3 = rc.h / rc.ab;
    if (a3 >= b.avg + .1) out.push({ k: 'hot', tone: 'hot', title: 'Viene en racha', txt: `${rc.h} de ${rc.ab} en sus últimos 3 juegos. Su temporada: ${r3(b.avg)}`, v: r3(a3) });
    else if (rc.ab >= 8 && a3 <= b.avg - .15) out.push({ k: 'cold', tone: 'warn', title: 'En bache', txt: `${rc.h} de ${rc.ab} en sus últimos 3 juegos. Su temporada: ${r3(b.avg)}`, v: r3(a3) });
  }
  const xbh = b.d + b.t + b.hr;
  if (isFinite(b.iso) && xbh >= 3 && b.iso >= Math.max(.15, (T.iso || 0) * 1.5)) out.push({ k: 'power', tone: 'good', title: 'Bateador de poder', txt: `${xbh} extrabases. Su ISO es ${r3(b.iso)}; el del equipo, ${r3(T.iso)}`, v: r3(b.iso) });
  if (isFinite(T.kp) && b.kp <= T.kp * .7) out.push({ k: 'contact', tone: 'good', title: 'Se poncha poco', txt: `${pct(b.kp)} de sus turnos. El equipo: ${pct(T.kp)}`, v: pct(b.kp) });
  else if (isFinite(T.kp) && b.kp >= .25 && b.kp >= T.kp * 1.4) out.push({ k: 'strikeouts', tone: 'warn', title: 'Se poncha seguido', txt: `${pct(b.kp)} de sus turnos. El equipo: ${pct(T.kp)}`, v: pct(b.kp) });
  if (isFinite(T.bbp) && b.bbp >= .12 && b.bbp >= T.bbp * 1.5) out.push({ k: 'eye', tone: 'good', title: 'Buen ojo', txt: `Recibe base por bolas en ${pct(b.bbp)} de sus turnos. El equipo: ${pct(T.bbp)}`, v: pct(b.bbp) });
  if (b.sb >= 4 && b.sbp >= .75) out.push({ k: 'speed', tone: 'good', title: 'Peligro en las bases', txt: `${b.sb} bases robadas en ${b.sb + b.cs} intentos`, v: String(b.sb) });
  const sp = sprayOf(pas.filter(x => x.play));
  if (sp.n >= 10) {
    const [f, n] = Object.entries(sp.fields).sort((a, c) => c[1] - a[1])[0];
    if (n / sp.n >= .45) out.push({ k: 'spray', tone: 'info', title: `Batea al jardín ${{ L: 'izquierdo', C: 'central', R: 'derecho' }[f]}`, txt: `${pct(n / sp.n)} de sus batazos van ${{ L: 'a la izquierda', C: 'al centro', R: 'a la derecha' }[f]}`, v: pct(n / sp.n) });
  }
  const cmp = (fa, fb, k, good, bad) => {
    const A = splitOf(pas, fa), B = splitOf(pas, fb); if (A.n < 6 || B.n < 6) return;
    if (A.pct >= B.pct + .2) out.push({ k, tone: 'good', title: good, txt: `Se embasa ${pct(A.pct)} ${good === 'Buen primer bat de la entrada' ? 'cuando es el primero' : 'con 2 outs'}; si no, ${pct(B.pct)}`, v: pct(A.pct) });
    else if (A.pct <= B.pct - .2) out.push({ k, tone: 'warn', title: bad, txt: `Se embasa ${pct(A.pct)} ${bad === 'Le cuesta abrir la entrada' ? 'cuando es el primero' : 'con 2 outs'}; si no, ${pct(B.pct)}`, v: pct(A.pct) });
  };
  cmp(x => x.lead, x => !x.lead, 'lead', 'Buen primer bat de la entrada', 'Le cuesta abrir la entrada');
  cmp(x => x.outs === 2, x => x.outs < 2, 'twoout', 'Rinde con 2 outs', 'Le cuesta con 2 outs');
  const order = { hot: 0, good: 1, info: 2, warn: 3 };
  return out.sort((a, c) => order[a.tone] - order[c.tone]).slice(0, 5);
}
