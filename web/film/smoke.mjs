// Browser-free smoke test of web/film/shots.js and shots2.js: every template, for every shot that uses it, at 7 times each.
//   node web/film/smoke.mjs [data/shots.standin.json]     (needs only node; about 1 s; run it after every template edit, before spending a render)
// It copies shots.js next to stubbed cast.js / util.js, takes the REAL helper object FB out of film.js (text slice), and checks that each template
// returns a sane frame: no throw, finite numbers everywhere, cast entries with who/at/act, a camera (rig name / function / object) whose fallback works,
// and the same frame twice for the same input (purity).
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const tmp = path.join(root, 'out', 'filmcore_smoke_pkg');
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'web', 'film'), { recursive: true });
for (const f of ['shots.js', 'shots2.js']) if (fs.existsSync(path.join(root, 'web/film', f))) fs.copyFileSync(path.join(root, 'web/film', f), path.join(tmp, 'web/film', f));
fs.writeFileSync(path.join(tmp, 'web/util.js'), fs.readFileSync(path.join(root, 'web/util.js'), 'utf8').replace(/import \* as THREE from 'three';/, 'const THREE = { Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } } };'));
const zvSrc = fs.readFileSync(path.join(root, 'web/cast.js'), 'utf8'); const zvStart = zvSrc.indexOf('export const ZV');
let zvBlock = zvSrc.slice(zvStart, zvSrc.indexOf('\n];', zvStart) + 3);
fs.writeFileSync(path.join(tmp, 'web/cast.js'), zvBlock.length > 30 ? zvBlock : 'export const ZV = Array.from({ length: 16 }, () => ({ height: 1 }));');
const { TEMPLATES, CROWD16 } = await import(pathToFileURL(path.join(tmp, 'web/film/shots.js')).href);
if (fs.existsSync(path.join(tmp, 'web/film/shots2.js'))) await import(pathToFileURL(path.join(tmp, 'web/film/shots2.js')).href);        // the second wave adds itself to TEMPLATES
const U = await import(pathToFileURL(path.join(tmp, 'web/util.js')).href);
const { clamp, lerp, smooth, hash } = U;

// ---- real FB out of film.js
const src = fs.readFileSync(path.join(root, 'web/film/film.js'), 'utf8');
const a = src.indexOf('const FB = {};'), b = src.indexOf('// ------------------------------------------------------------------------------------------------ rigs');
const fbSrc = src.slice(a, b);
const ax = { x: 0.579, z: 0.815 }, tn = { x: -0.815, z: 0.579 }, O = { x: 0, z: 0 };
const warns = [];
const warn = (m) => warns.push(m);
const slotFor = (name) => { const h = hash(name.length * 3.1 + name.charCodeAt(name.length - 1)); return { x: 10 * h - 5, z: 8 * hash(h * 7) - 2, y: 0, rotY: 6 * hash(h * 3) - 3 }; };
const mkSet = (nm) => ({ slots: new Proxy({}, { get: (_, k) => (typeof k === 'string' ? slotFor(nm + '.' + k) : undefined) }), rigs: {} });
const mall = { anchors: { at: (r, l) => ({ x: O.x + ax.x * r + tn.x * l, z: O.z + ax.z * r + tn.z * l }), u: ax, tn }, slots: mkSet('mall').slots };
const sets = {}; const setOf = (n) => (sets[n] ||= mkSet(n));
const S = { mall, atelier: mkSet('atelier'), card: mkSet('card') }, EXT = {};
const TIMING = fs.existsSync(path.join(root, 'data/timing.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'data/timing.json'), 'utf8')) : { lines: [], words: [] };
const T = { lines: TIMING.lines, words: TIMING.words, beatAt: (t) => t * 2, timeOfBeat: (b) => b / 2, barPos: (t) => ({ bar: Math.floor(t / 2), beat: (t * 2) % 4 }), beatPulse: (t) => Math.max(0, 1 - ((t * 2) % 1) * 3), env: () => 0.3, sing: () => ({ on: false, open: 0 }), sectionById: (id) => ({ start: 0 }) };
const Rat = (t) => (t - 30) * 1.0, tOfR = (r) => r + 30, K_RAMP = 1.5;
const findRig = () => null;
const makeFB = new Function('mall', 'setOf', 'S', 'EXT', 'warn', 'findRig', 'O', 'T', 'Rat', 'tOfR', 'CROWD16', 'lerp', 'clamp', 'smooth', 'hash', 'K_RAMP', 'ax', 'tn', 'walkAt', `${fbSrc}\nreturn FB;`);
const walkAt = (points, speed, t, ahead) => { const P = points.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p)); const d = speed * t; const k = Math.min(1, d / 20); return { x: lerp(P[0].x, P[P.length - 1].x, k), z: lerp(P[0].z, P[P.length - 1].z, k), rotY: 0, dist: d, done: k >= 1 }; };
const FB = makeFB(mall, setOf, S, EXT, warn, findRig, O, T, Rat, tOfR, CROWD16, lerp, clamp, smooth, hash, K_RAMP, ax, tn, walkAt);

const shotsFile = process.argv[2] || 'data/shots.standin.json';
const J = JSON.parse(fs.readFileSync(path.join(root, shotsFile), 'utf8'));
const shots = J.shots.map((s, i) => ({ ...s, i, dur: s.t1 - s.t0 }));
const cam = { position: { x: 0, y: 1.6, z: 12 }, fov: 40 };

const bad = [];
const scan = (v, where, depth = 0) => {                    // every number finite; cast entries sane
  if (depth > 6 || v == null) return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(`${where}: non-finite number`); return; }
  if (typeof v === 'function' || typeof v === 'string' || typeof v === 'boolean') return;
  if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${where}[${i}]`, depth + 1)); return; }
  if (typeof v === 'object') for (const k of Object.keys(v)) { if (k === 'cam') continue; scan(v[k], `${where}.${k}`, depth + 1); }
};
const stable = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? '<fn>' : x));
const mkF = (shot, tt, tpp) => {
  const ts = tt - shot.t0, dur = shot.dur, u = { t: ts, p: clamp(ts / dur), dur, mode: undefined };
  const beat = T.beatAt(tt), beatP = T.beatAt(tpp);
  const c2 = { t: tt, tp: tpp, beat, bar: 0, phase: 0, pulse: 0.3, beatP, pulseP: 0.3, env: {}, alive: tt >= J.aliveAt ? 1 : 0, R: Rat(tpp), Rl: Rat(tt), ignited: Rat(tpp) >= 0, cam, args: shot.args || {}, pip: { x: 0, z: 0 }, section: shot.section, confetti: 0 };
  const F = Object.create(FB);
  Object.assign(F, { sec0: 0, b0: Math.round(T.beatAt(shot.t0)), beatNo: Math.floor(beat + 0.12) - Math.round(T.beatAt(shot.t0)), t: tt, tp: tpp, up: Math.max(0, tpp - shot.t0), u, p: u.p, dur, c2, args: shot.args || {}, shot, section: shot.section, T, R: c2.R, Rl: c2.Rl, alive: c2.alive, aliveLight: c2.alive, aliveAt: J.aliveAt, tq: Math.floor(tpp * 12 + 1e-6), b: beat - T.beatAt(shot.t0), bp: beatP - T.beatAt(shot.t0), beat, beatP, motion: 'ones', portrait: false, cam });
  return { F, u, c2 };
};

const tpls = Object.keys(TEMPLATES).filter((k) => k !== '__missing');
let n = 0, camChecked = 0;
const used = new Set();
for (const shot of shots) {
  const tpl = TEMPLATES[shot.tpl];
  if (!tpl) continue;
  used.add(shot.tpl);
  for (const p of [0, 0.02, 0.2, 0.5, 0.8, 0.98, 0.9999]) {
    const tt = shot.t0 + p * shot.dur;
    for (const mode of ['ones', 'twos']) {
      const tpp = mode === 'ones' ? tt : Math.max(Math.floor(tt * 12 + 1e-6) / 12, shot.t0);
      const w = `${shot.id}/${shot.tpl}@${p}/${mode}`;
      let f1, f2;
      try {
        const A = mkF(shot, tt, tpp); f1 = tpl(A.F);
        const B = mkF(shot, tt, tpp); f2 = tpl(B.F);
        n++;
        if (!f1 || typeof f1 !== 'object') { bad.push(`${w}: returned ${typeof f1}`); continue; }
        if (stable(f1) !== stable(f2)) bad.push(`${w}: two calls with the same input gave different frames`);
        scan(f1, w);
        for (const e of f1.cast || []) {
          if (!e.who) bad.push(`${w}: cast entry without who`);
          if (!e.at || !['x', 'y', 'z', 'rotY'].every((k) => typeof e.at[k] === 'number')) bad.push(`${w}: cast ${e.who} has a bad at ${JSON.stringify(e.at)}`);
          if (typeof e.act !== 'string' && typeof e.act !== 'function') bad.push(`${w}: cast ${e.who} act is ${typeof e.act}`);
        }
        for (const e of f1.text || []) if (!e.id) bad.push(`${w}: text entry without id`);
        for (const e of f1.threads || []) if (!e.id) bad.push(`${w}: thread entry without id`);
        for (const e of f1.props || []) if (!e.id) bad.push(`${w}: prop entry without id`);
        // camera: rig string with the set's rigs missing -> fall back to the template's own fallback camera; a function or object is evaluated
        let rig = f1.rig;
        if (typeof rig === 'function') { const r = rig(A.u, A.c2); camChecked++; scan(r, w + '.rig()'); if (!r || !Array.isArray(r.pos) || !Array.isArray(r.look)) bad.push(`${w}: rig() returned no pos/look`); }
        else if (rig && typeof rig === 'object') { camChecked++; if (!Array.isArray(rig.pos) || !Array.isArray(rig.look)) bad.push(`${w}: rig object without pos/look`); }
        else if (!rig) bad.push(`${w}: frame has no rig`);
        if (f1.post) scan(f1.post, w + '.post');
      } catch (e) {
        bad.push(`${w}: THROWS ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`);
      }
    }
  }
}
const missing = tpls.filter((k) => !used.has(k));
console.log(`templates exported: ${tpls.length}; frames checked: ${n}; cameras evaluated: ${camChecked}; templates never used by ${shotsFile}: ${missing.join(', ') || 'none'}`);
const uniq = [...new Set(warns)];
console.log(`warnings from the helpers (${uniq.length} distinct):`, uniq.slice(0, 8));
if (bad.length) { const seen = new Set(); const show = bad.filter((b) => { const k = b.replace(/@[\d.]+\/(ones|twos)/, ''); if (seen.has(k)) return false; seen.add(k); return true; }); console.log(`PROBLEMS: ${bad.length} (${show.length} distinct)`); show.slice(0, 40).forEach((b) => console.log('  ' + b)); process.exitCode = 1; }
else console.log('no problems found');
