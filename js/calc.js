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
        out.push({ gid: g.id, date: g.date, inn, slot: x.si, pid: pidAt(slots[x.si], inn), outs: Math.min(outs, 2), lead: j === 0, on: num(x.pa.reach) > 0, scored: num(x.pa.reach) === 4, res: x.pa.res, play: x.pa.play || '' });
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
