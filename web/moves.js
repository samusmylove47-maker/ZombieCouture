// MOVES: procedural acting for Pip and the zombies.  Every act is a pure function of a = { t, tp, dur, k, beat, phase, pulse, seed, amp, side, args }
// and returns a pose record P (FILM.md section 11).  No state, no Math.random: a pose is a function of its arguments only.
//
// Conventions (body frame, radians, three.js 'XYZ' Euler):
//   shoulder  x < 0 swings the arm forward, x > 0 back; z = lateral raise (shR z > 0 and shL z < 0 lift the arm outward).  z = +-pi is straight up.
//   elbow     z adds to the shoulder's z for an arm held out sideways (shR z + elR z > 0 = forearm points up/out); x < 0 bends the forearm forward.
//   head      x > 0 nods (looks down), y > 0 turns toward +x (the R side, screen right when facing the camera), z > 0 tips the top of the head toward -x.
//   hips      x < 0 swings a leg forward.  body / root lean x > 0 = forward, roll z > 0 = top toward -x.  The body pivots at the FEET (root origin).
//   "R" = the rig's shR / legR = local +x.  Acts are written for side = +1 (primary limb R) and mirrored when side = -1.
// Extra P fields (all optional; applyPose understands them): sq (squash/stretch, -0.2..0.2), dys (root drop in body-scale units, seated acts).
import { LIVE, DEAD } from './cast.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIn = (x) => Math.pow(clamp(x), 3);
const snap = (x) => 1 - Math.pow(1 - clamp(x), 5);              // very fast start, long settle: the stop-motion "pop"
const back = (x) => { x = clamp(x); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };   // overshoots then settles
const fract = (x) => x - Math.floor(x);
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const seg = (k, a, b) => clamp((k - a) / (b - a));                // 0..1 progress of k inside [a, b]
const hw = (x, g = 1.7) => clamp(Math.sin(x) * g, -1, 1);         // sine with held extremes: poses that stop, then snap to the next
// damped spring step response: 0 -> 1 with overshoot (t seconds, freq Hz, zeta damping).  Follow-through for pops and settles.
const spring = (t, freq = 3, zeta = 0.32) => {
  if (t <= 0) return 0;
  const w = TAU * freq, wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
};
// damped oscillation that starts at 1 and rings out: knocks, wobbles
const ring = (t, freq = 2.2, decay = 3.2) => (t < 0 ? 0 : Math.exp(-decay * t) * Math.cos(TAU * freq * t));
const EZ = { lin: (x) => x, io: smooth, out: easeOut, in: easeIn, snap, back, step: (x) => (x >= 1 ? 1 : 0) };

// ------------------------------------------------------------------ pose records
const JK = ['shL', 'shR', 'elL', 'elR', 'head', 'body', 'legL', 'legR'];
const NUM = ['dx', 'dy', 'dz', 'yaw', 'lean', 'roll', 'sq', 'dys'];
export function rec(pose = {}, o = {}) {
  const p = {};
  for (const k of JK) p[k] = pose[k] ? [pose[k][0] || 0, pose[k][1] || 0, pose[k][2] || 0] : [0, 0, 0];
  const r = { pose: p, face: o.face || {}, attach: o.attach || {} };
  for (const k of NUM) r[k] = o[k] || 0;
  return r;
}
const mixFace = (a, b, k) => {
  const o = k < 0.5 ? { ...a } : { ...b };
  for (const key of ['mouth', 'brow']) if (a[key] != null && b[key] != null) o[key] = lerp(a[key], b[key], k); else if (a[key] != null || b[key] != null) o[key] = (a[key] ?? 0) * (1 - k) + (b[key] ?? 0) * k;
  if (a.look || b.look) { const la = a.look || [0, 0], lb = b.look || [0, 0]; o.look = [lerp(la[0], lb[0], k), lerp(la[1], lb[1], k)]; }
  return o;
};
export function mixRec(A, B, k) {
  const o = { pose: {} };
  for (const j of JK) { const a = A.pose[j] || [0, 0, 0], b = B.pose[j] || [0, 0, 0]; o.pose[j] = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  for (const f of NUM) o[f] = lerp(A[f] || 0, B[f] || 0, k);
  o.face = mixFace(A.face || {}, B.face || {}, k); o.attach = k < 0.5 ? (A.attach || {}) : (B.attach || {});
  return o;
}
// keyframes: [[x, record, ease?], ...] ascending in x.  The ease belongs to the segment that ARRIVES at that key.
function track(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (x >= last[0]) return last[1];
  let i = 0; while (keys[i + 1][0] < x) i++;
  const [x0, A] = keys[i], [x1, B, e] = keys[i + 1];
  const f = (typeof e === 'function' ? e : EZ[e || 'io'])((x - x0) / (x1 - x0));
  return mixRec(A, B, f);
}
// add a delta record on top of a base (pose angles and root fields add; face/attach: delta wins where set)
function addRec(A, D, s = 1) {
  const o = { pose: {} };
  for (const j of JK) { const a = A.pose[j] || [0, 0, 0], d = D.pose?.[j] || [0, 0, 0]; o.pose[j] = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s]; }
  for (const f of NUM) o[f] = (A[f] || 0) + (D[f] || 0) * s;
  o.face = { ...(A.face || {}), ...(D.face || {}) }; o.attach = { ...(A.attach || {}), ...(D.attach || {}) };
  return o;
}
const sym = (shx, shz, elx = 0, elz = 0) => ({ shL: [shx, 0, -shz], shR: [shx, 0, shz], elL: [elx, 0, -elz], elR: [elx, 0, elz] });

export function mirrorPose(P) {
  const m = (v) => [v[0], -v[1], -v[2]];
  const p = P.pose || {}, pm = {};
  pm.shL = p.shR && m(p.shR); pm.shR = p.shL && m(p.shL); pm.elL = p.elR && m(p.elR); pm.elR = p.elL && m(p.elL);
  pm.legL = p.legR && m(p.legR); pm.legR = p.legL && m(p.legL);
  pm.head = p.head && m(p.head); pm.body = p.body && m(p.body);
  for (const k of Object.keys(pm)) if (!pm[k]) delete pm[k];
  const o = { ...P, pose: pm, dx: -(P.dx || 0), yaw: -(P.yaw || 0), roll: -(P.roll || 0) };
  if (P.face) { o.face = { ...P.face }; if (P.face.look) o.face.look = [-P.face.look[0], P.face.look[1]]; }
  if (P.attach) o.attach = { handL: P.attach.handR ?? null, handR: P.attach.handL ?? null };
  return o;
}
// blend two acts' records (crossfade between acts: shamble -> hop -> bop).  k 0..1, ease optional
export function easeAct(A, B, k, ease = smooth) {
  const f = ease(clamp(k));
  const a = A.pose && A.pose.shL && A.dx !== undefined ? A : rec(A.pose, A), b = B.pose && B.pose.shL && B.dx !== undefined ? B : rec(B.pose, B);
  return mixRec(a, b, f);
}
// seconds since a switch (a frame is a function of the time since the act began): convenience for blending in over `len` s
export const easeIn01 = (t, len = 0.25) => smooth(t / len);

// ------------------------------------------------------------------ argument normalisation and the registry
const BPM_DEFAULT = 130;
function norm(a = {}) {
  const t = a.t ?? a.tp ?? 0, tp = a.tp ?? t;
  const args = a.args || {};
  const dur = a.dur ?? Infinity;
  const beat = a.beat ?? tp * BPM_DEFAULT / 60;
  const n = {
    t, tp, dur, beat, args,
    kp: isFinite(dur) && dur > 0 ? clamp(tp / dur) : 0,
    k: a.k ?? (isFinite(dur) && dur > 0 ? clamp(t / dur) : 0),
    phase: a.phase ?? (beat % 4 + 4) % 4,
    pulse: a.pulse ?? Math.exp(-fract(beat) * 5),
    seed: a.seed ?? 0, amp: a.amp ?? 1, side: a.side ?? 1,
  };
  n.f = fract(beat);                 // position inside the beat
  n.bi = Math.floor(beat);           // beat index
  return n;
}


// ------------------------------------------------------------------ arm clearance
// Forward kinematics of the arms (body frame, three.js XYZ eulers) tested against the head ball and the dress silhouette.  An arm that pokes through is
// pushed out with a few Newton steps on (shoulder x, z, elbow x, z), the smallest change that clears it (cheap: it only runs when something penetrates).
// Poses that are meant to touch the face or the skirt rest on the surface within the tolerance (th, tt).
const rot3 = (e, x, y, z) => {           // Rx * Ry * Rz * v
  const cx = Math.cos(e[0]), sx = Math.sin(e[0]), cy = Math.cos(e[1]), sy = Math.sin(e[1]), cz = Math.cos(e[2]), sz = Math.sin(e[2]);
  const x1 = cz * x - sz * y, y1 = sz * x + cz * y, x2 = cy * x1 + sy * z, z2 = -sy * x1 + cy * z;
  return [x2, cx * y1 - sx * z2, sx * y1 + cx * z2];
};
const PROF = [[0.5, 0.42], [0.57, 0.415], [0.65, 0.42], [0.73, 0.37], [0.83, 0.30], [0.92, 0.20], [0.965, 0.15], [1.0, 0.158], [1.07, 0.158], [1.14, 0.14], [1.19, 0.09]];
const profR = (y) => {
  if (y < PROF[0][0] || y > PROF[PROF.length - 1][0]) return 0;
  let i = 0; while (PROF[i + 1][0] < y) i++;
  const [y0, r0] = PROF[i], [y1, r1] = PROF[i + 1]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
};
const CLR = { hy: 1.4, hr: 0.335, th: 0.02, tt: 0.03, ps: 1 };
function armErr(s, sh, el, o) {
  const Sx = s * 0.165, Sy = 1.115, u = rot3(sh, 0, -0.215, 0), w = rot3(el, 0, -0.215, 0), f = rot3(sh, w[0], w[1], w[2]);
  const Ex = Sx + u[0], Ey = Sy + u[1], Ez = u[2];
  let e2 = 0;
  const test = (x, y, z, r, torso) => {
    const ph = o.hr + r - Math.hypot(x, y - o.hy, z) - o.th; if (ph > 0) e2 += ph * ph;
    if (torso) { const pr = profR(y) * o.ps; if (pr > 0) { const pt = pr + r - Math.hypot(x, z) - o.tt; if (pt > 0) e2 += pt * pt; } }
  };
  test(Sx + u[0] * 0.5, Sy + u[1] * 0.5, u[2] * 0.5, 0.031, false);
  test(Ex, Ey, Ez, 0.031, true);
  test(Ex + f[0] * 0.34, Ey + f[1] * 0.34, Ez + f[2] * 0.34, 0.028, true);
  test(Ex + f[0] * 0.67, Ey + f[1] * 0.67, Ez + f[2] * 0.67, 0.028, true);
  test(Ex + f[0], Ey + f[1], Ez + f[2], 0.043, true);
  return Math.sqrt(e2);
}
function clearArm(s, sh, el, o) {
  const q = [sh[0], sh[2], el[0], el[2]], ev = (v) => armErr(s, [v[0], sh[1], v[1]], [v[2], el[1], v[3]], o);
  let e = ev(q); if (e <= 0) return null;
  for (let it = 0; it < 16 && e > 0.003; it++) {
    const g = [0, 0, 0, 0]; let gg = 0;
    for (let i = 0; i < 4; i++) { const h = 0.02, v0 = q[i]; q[i] = v0 + h; const ep = ev(q); q[i] = v0 - h; const em = ev(q); q[i] = v0; g[i] = (ep - em) / (2 * h); gg += g[i] * g[i]; }
    if (gg < 1e-9) break;
    let ok = false;
    for (const sc of [1, 0.5, 0.25]) {
      const v = q.map((x, i) => x - clamp(sc * e * g[i] / gg, -0.25, 0.25)), e2 = ev(v);
      if (e2 < e) { for (let i = 0; i < 4; i++) q[i] = v[i]; e = e2; ok = true; break; }
    }
    if (!ok) break;
  }
  return [[q[0], sh[1], q[1]], [q[2], el[1], q[3]]];
}
// clearArms(pose, opts) -> the same pose object when nothing pokes through, else a copy with the arms moved out.  opts: { hy (head centre y), hr (head radius), th, tt (tolerances, m), ps (dress width scale) }
export function clearArms(pose, opts) {
  const o = opts ? { ...CLR, ...opts } : CLR, z3 = [0, 0, 0];
  let out = pose;
  for (const [s, a, b] of [[-1, 'shL', 'elL'], [1, 'shR', 'elR']]) {
    const r = clearArm(s, pose[a] || z3, pose[b] || z3, o);
    if (r) { if (out === pose) out = { ...pose }; out[a] = r[0]; out[b] = r[1]; }
  }
  return out;
}

export const ACTS = {};
export const ACT_INFO = {};
// def(name, info, fn)  info = { g: group, loop: bool, dur: default one-shot length (s), args: 'documented args', mirror: true, doc }
function def(name, info, fn) {
  const raw = (a) => {
    const n = norm(a);
    if (!isFinite(n.dur) && info.dur) { n.dur = info.dur; n.kp = clamp(n.tp / n.dur); }
    let P = fn(n);
    P = P.pose && P.dx !== undefined ? P : rec(P.pose, P);
    if (info.mirror !== false && n.side < 0) P = mirrorPose(P);
    if (!ACT_INFO[name].free) { const cp = clearArms(P.pose); if (cp !== P.pose) P = { ...P, pose: cp }; }
    return P;
  };
  ACTS[name] = raw; ACT_INFO[name] = { loop: !info.dur, mirror: true, ...info };
}
export function act(name, a) {
  const f = ACTS[name];
  if (!f) throw new Error(`moves: unknown act "${name}". Known: ${Object.keys(ACTS).join(', ')}`);
  return f(a || {});
}
export const actNames = () => Object.keys(ACTS);

// ------------------------------------------------------------------ applying a record to a character
// c = makePip()/makeZombie() record, base = { x, y, z, rotY }.  Sets joints, position (root offsets are in the base heading frame), rotation and squash.
export function applyPose(c, base, P) {
  const o = c.obj, J = o.userData.J;
  const hs = J.head && J.head.scale ? J.head.scale.x : 1, hp = J.head ? J.head.position.y : 1.14;
  const p = P.free ? (P.pose || {}) : clearArms(P.pose || {}, { hr: 0.335 * hs, hy: hp + (1.4 - hp) * hs, ps: 0.72 + 0.28 * smooth(c.K ? c.K.value : 1) });
  const set = (j, v) => { if (j) j.rotation.set(v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0); };
  set(J.shL, p.shL); set(J.shR, p.shR); set(J.elL, p.elL); set(J.elR, p.elR); set(J.head, p.head); set(J.body, p.body); set(J.legL, p.legL); set(J.legR, p.legR);
  const s = o.scale.x, sq = P.sq || 0;               // squash and stretch goes on the body group (it holds everything and pivots at the feet), so a caller that sets the root scale afterwards cannot wipe it
  if (J.body) J.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
  const ry = base.rotY || 0, sn = Math.sin(ry), cs = Math.cos(ry), dx = P.dx || 0, dz = P.dz || 0;
  o.position.set((base.x || 0) + dx * cs + dz * sn, (base.y || 0) + (P.dy || 0) + (P.dys || 0) * s, (base.z || 0) - dx * sn + dz * cs);
  o.rotation.order = 'YXZ';
  o.rotation.set(P.lean || 0, ry + (P.yaw || 0), P.roll || 0);
  c.hint = { face: P.face || {}, attach: P.attach || {}, P };
}

// ------------------------------------------------------------------ walking paths
// points: [[x, z], ...] or [{x, z}, ...].  Constant speed along a polyline whose corners are rounded with arcs of radius opts.radius (m, default 0.6).
// t = seconds since the walk began (opts.start = metres already walked).  Returns { x, z, rotY, dist, done, len, curv } (curv: signed turn rate, rad per metre, + = turning toward +x).
export function walkPath(points, speed, t, opts = {}) {
  const P = points.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z }));
  const pts = P.filter((p, i) => i === 0 || Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) > 1e-6);
  const s0 = (opts.start || 0) + Math.max(0, speed * t);
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, z: pts[0]?.z ?? 0, rotY: opts.rotY ?? 0, dist: 0, done: true, len: 0, curv: 0 };
  const R = opts.radius ?? 0.6, dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z); return { x: (b.x - a.x) / l, z: (b.z - a.z) / l, l }; };
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.z * Math.sin(a), z: v.x * Math.sin(a) + v.z * Math.cos(a) });
  const pieces = []; let cur = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], u1 = dir(cur, p);
    let A = p, next = null;
    if (i < pts.length - 1) {
      const u2 = dir(p, pts[i + 1]);
      const psi = Math.atan2(u1.x * u2.z - u1.z * u2.x, u1.x * u2.x + u1.z * u2.z), ap = Math.abs(psi);
      if (ap > 1e-3 && ap < PI - 0.05) {
        const room = Math.min(u1.l, u2.l) * 0.5;
        const r = Math.min(R, room / Math.tan(ap / 2)), d = r * Math.tan(ap / 2);
        A = { x: p.x - u1.x * d, z: p.z - u1.z * d };
        const sg = Math.sign(psi), C = { x: A.x + sg * -u1.z * r, z: A.z + sg * u1.x * r };
        next = { A, C, r, psi, u1, arcLen: r * ap, B: { x: p.x + u2.x * d, z: p.z + u2.z * d } };
      }
    }
    const ll = Math.hypot(A.x - cur.x, A.z - cur.z);
    if (ll > 1e-9) pieces.push({ type: 'line', a: cur, u: u1, len: ll });
    if (next) { pieces.push({ type: 'arc', ...next, len: next.arcLen }); cur = next.B; } else cur = p;
  }
  const len = pieces.reduce((s, q) => s + q.len, 0), s = clamp(s0, 0, len);
  let acc = 0, out = null;
  for (const q of pieces) {
    if (s <= acc + q.len + 1e-9 || q === pieces[pieces.length - 1]) {
      const d = clamp(s - acc, 0, q.len);
      if (q.type === 'line') out = { x: q.a.x + q.u.x * d, z: q.a.z + q.u.z * d, rotY: Math.atan2(q.u.x, q.u.z), curv: 0 };
      else { const ang = Math.sign(q.psi) * d / q.r, v = rot({ x: q.A.x - q.C.x, z: q.A.z - q.C.z }, ang), h = rot(q.u1, ang); out = { x: q.C.x + v.x, z: q.C.z + v.z, rotY: Math.atan2(h.x, h.z), curv: -Math.sign(q.psi) / q.r }; }
      break;
    }
    acc += q.len;
  }
  return { ...out, dist: s, done: s0 >= len - 1e-6, len };
}
export const pathLength = (points, radius) => walkPath(points, 1, 0, { radius }).len;

// ================================================================== DEAD (grey, un-sewn): slow, stooped, off the beat, never symmetrical
const twitch = (f) => (f < 0.05 ? f / 0.05 : f < 0.12 ? 1 - (f - 0.05) / 0.07 : 0);          // a quick jerk inside a 12% window
const lag = (w, d) => Math.sin(w - d);
// gait: phase in cycles from metres walked (args.dist) or from time at a default speed.  step = metres per step at scale 1 (leg length 0.58).
const gaitPhase = (n, step, speed) => { const sc = n.args.scale ?? 1; const d = n.args.dist ?? n.tp * (n.args.speed ?? speed); return d / (2 * step * sc) + n.seed; };
const plant = (th) => -0.58 * (1 - Math.cos(th));       // root drop that keeps a rigid straight leg swung by th on the floor

def('deadStand', { g: 'dead', args: 'seed', doc: 'idle: sway, head loll, arms hanging forward, an occasional twitch' }, (n) => {
  const { tp, seed, amp } = n, w = tp * 0.95 + seed * 20;
  const s1 = Math.sin(w), s2 = Math.sin(w * 0.61 + 1.3), s3 = Math.sin(w * 0.37 + 2.1);
  const win = (tp + seed * 7) / 3.1, tw = hash(Math.floor(win) + seed * 31) < 0.55 ? twitch(fract(win)) : 0, tj = hash(Math.floor(win) * 3.1 + seed) - 0.5;
  return {
    pose: {
      shL: [-0.66 + 0.10 * s2, 0, -0.18 + 0.05 * s1], elL: [-0.34 - 0.06 * s1, 0, 0.04], shR: [-0.5 - 0.09 * s1, 0, 0.22 + 0.04 * s2], elR: [-0.46, 0, 0],
      head: [0.46 + 0.06 * s2 + 0.14 * tw, 0.16 * s3 + 0.7 * tw * tj, 0.15 * s1 + 0.2 * tw], body: [0.2 + 0.03 * s2, 0.05 * s3, 0],
      legL: [-0.05, 0, -0.05], legR: [0.07, 0, 0.06],
    },
    roll: 0.035 * s1 * amp, dy: -0.004, dx: 0.012 * s1,
  };
});

def('deadShamble', { g: 'dead', args: 'dist (m walked, drives the legs) | speed (m/s, default 0.26); scale (body scale, default 1)', doc: 'dragging lurch, slow; walking or in place' }, (n) => {
  const { seed, amp } = n, ph = gaitPhase(n, 0.30, 0.26), w = TAU * ph, s = Math.sin(w), c = Math.cos(w);
  const lurch = Math.pow(Math.max(0, Math.sin(w - 0.6)), 2);
  return {
    pose: {
      shL: [-1.22 + 0.11 * lag(w, -0.5), 0, -0.1], elL: [-0.2 + 0.12 * c, 0, 0], shR: [-0.95 - 0.1 * lag(w, -0.5 - PI), 0, 0.16], elR: [-0.32 - 0.1 * c, 0, 0],
      head: [0.44 + 0.1 * lag(w, 1.1), 0.15 * lag(w, 0.7), 0.16 * lag(w, 1.4)], body: [0.2 + 0.07 * lurch + 0.02 * c, 0.09 * c, 0],
      legL: [-0.34 * s, -0.09 * c, 0], legR: [0.22 * lag(w, 0.35), -0.09 * c, 0],
    },
    roll: 0.06 * s * amp, dx: 0.02 * s, dy: plant(0.32 * Math.abs(s)) * 0.8 - 0.006 * lurch,
  };
});

def('deadPressGlass', { g: 'dead', args: 'seed', doc: 'both palms up against a pane, forehead near it, slow slide down and a lift back' }, (n) => {
  const { tp, seed } = n, f = fract(tp / 4.6 + seed), sl = f < 0.8 ? smooth(f / 0.8) : 1 - snap((f - 0.8) / 0.2), w = tp * 1.3 + seed * 9;
  const mo = 0.5 + 0.5 * Math.sin(tp * 1.7 + seed * 5);
  return {
    pose: {
      shL: [-2.05 + 0.38 * sl, 0, -0.34 - 0.04 * sl], elL: [-0.22 - 0.1 * sl, 0, 0], shR: [-2.0 + 0.4 * (sl * 0.9 + 0.1 * Math.sin(w)), 0, 0.34 + 0.04 * sl], elR: [-0.24 - 0.08 * sl, 0, 0],
      head: [0.22 + 0.06 * sl, 0.08 * Math.sin(w * 0.7), 0.1 * Math.sin(w * 0.5)], body: [0.1 + 0.06 * sl, 0, 0], legL: [-0.04, 0, -0.04], legR: [0.06, 0, 0.05],
    },
    dy: -0.03 * sl, dz: 0.02 * sl, roll: 0.02 * Math.sin(w * 0.6), face: { emote: 'moan', mouth: 0.25 + 0.45 * mo },
  };
});

def('deadScratch', { g: 'dead', args: 'seed', doc: 'arms alternate scraping downward, claws curling, head jitters at 12 Hz' }, (n) => {
  const { tp, seed, amp } = n, T = 1.15, fr = fract(tp / T + seed);
  const scr = (f) => (f < 0.7 ? smooth(f / 0.7) : 1 - snap((f - 0.7) / 0.3));
  const a = scr(fr), b = scr(fract(fr + 0.5)), q = Math.floor(tp * 12 + 1e-6), j = (k) => hash(q * 1.7 + k + seed * 40) - 0.5;
  return {
    pose: {
      shL: [-2.3 + 1.15 * a, 0, -0.3], elL: [-0.15 - 0.5 * a, 0, 0], shR: [-2.3 + 1.15 * b, 0, 0.3], elR: [-0.15 - 0.5 * b, 0, 0],
      head: [0.22 + 0.1 * j(1), 0.22 * j(2), 0.2 * j(3)], body: [0.2 + 0.05 * (a + b), 0.04 * (a - b), 0], legL: [-0.06, 0, -0.05], legR: [0.05, 0, 0.05],
    },
    dx: 0.02 * (a - b) + 0.008 * j(4), dy: -0.01 * (a + b), roll: 0.03 * (b - a) * amp, face: { emote: 'moan', mouth: 0.2 + 0.25 * Math.abs(j(5) * 2) },
  };
});

def('deadReach', { g: 'dead', args: 'seed', doc: 'both arms forward, leaning in, arms pulse alternately' }, (n) => {
  const { tp, seed, amp } = n, w = tp * 1.6 + seed * 8, s = Math.sin(w), lean = 0.34 + 0.06 * Math.sin(w * 0.5 + 1);
  return {
    pose: {
      shL: [-1.5 - 0.11 * s * amp, 0, -0.2], elL: [-0.05 - 0.05 * s, 0, 0], shR: [-1.5 + 0.11 * s * amp, 0, 0.2], elR: [-0.05 + 0.05 * s, 0, 0],
      head: [0.1 + 0.05 * Math.sin(w * 0.5), 0.1 * Math.sin(w * 0.3), 0.12 * Math.sin(w * 0.4)], body: [lean, 0.04 * s, 0], legL: [-0.1, 0, -0.06], legR: [0.08, 0, 0.06],
    },
    dz: 0.05 * Math.sin(w * 0.5), roll: 0.03 * s, face: { emote: 'moan', mouth: 0.3 },
  };
});

def('deadHoldUp', { g: 'dead', args: 'seed', doc: 'holds a scrap of fabric high in the R hand (attach.handR = "scrap"), head tipped in a hopeful question' }, (n) => {
  const { tp, seed, amp } = n, w = tp * 1.5 + seed * 6, s = Math.sin(w), hop = hw(tp * 0.9 + seed * 5, 1.2);
  return {
    pose: {
      shR: [-0.4, 0, 2.5 + 0.05 * s], elR: [-0.2, 0, -0.1 + 0.32 * hw(w * 1.6, 1.3) * amp], shL: [-0.8 - 0.06 * s, 0, -0.2], elL: [-0.4, 0, 0.05],
      head: [0.14 + 0.1 * hop, 0.05 * s, -0.3 - 0.06 * hop], body: [0.12, 0, 0], legL: [-0.05, 0, -0.05], legR: [0.05, 0, 0.05],
    },
    roll: -0.04 - 0.02 * s, dy: 0.008 * Math.max(0, hop), attach: { handR: 'scrap' }, face: { emote: 'worried', brow: 0.6 },
  };
});

def('deadLean', { g: 'dead', args: 'seed', doc: 'leans toward Pip, curious; head tilts to one side, holds, snaps to the other (side = lean direction)' }, (n) => {
  const { tp, seed } = n, w = tp * 1.1 + seed * 7, tilt = hw(TAU * (tp / 3.4 + seed), 1.3), sw = Math.sin(w);
  return {
    pose: {
      shL: [-0.7 + 0.06 * sw, 0, -0.2], elL: [-0.4, 0, 0.05], shR: [-0.56 - 0.06 * sw, 0, 0.22], elR: [-0.5, 0, 0],
      head: [0.24 - 0.1 * Math.abs(tilt), 0.28 * tilt, -0.4 * tilt], body: [0.4 + 0.03 * sw, 0.07 * tilt, 0], legL: [-0.1, 0, -0.05], legR: [0.08, 0, 0.05],
    },
    roll: -0.05 + 0.02 * sw, dz: 0.05, dx: 0.03, face: { emote: 'worried', look: [0.4, 0.1] },
  };
});

def('deadMoan', { g: 'dead', args: 'moan (0..1 envelope from T.moan(t); default: an internal 4.6 s breath cycle), seed', doc: 'head back, jaw open (face.mouth = envelope, emote moan), arms drop and swing' }, (n) => {
  const { tp, seed } = n, T = 4.6, f = fract(tp / T + seed);
  const env = n.args.moan ?? (f < 0.15 ? smooth(f / 0.15) : f < 0.65 ? 1 : f < 0.85 ? 1 - smooth((f - 0.65) / 0.2) : 0);
  const m = smooth(env), w = tp * 1.4 + seed * 9, rock = Math.sin(w);
  const rest = rec({ shL: [-0.7, 0, -0.2], elL: [-0.35, 0, 0.05], shR: [-0.55, 0, 0.22], elR: [-0.45, 0, 0], head: [0.5, 0, 0.1], body: [0.2, 0, 0], legL: [-0.05, 0, -0.05], legR: [0.06, 0, 0.05] });
  const moan = rec({ shL: [0.05 + 0.08 * rock, 0, -0.5], elL: [-0.15, 0, -0.1], shR: [0.1 - 0.08 * rock, 0, 0.5], elR: [-0.15, 0, 0.1], head: [-0.62, 0.14 * rock, 0.05 * rock], body: [-0.08, 0, 0], legL: [-0.02, 0, -0.06], legR: [0.03, 0, 0.06] }, { dy: 0.008, roll: 0.02 * rock });
  const P = mixRec(rest, moan, m);
  P.face = { emote: m > 0.12 ? 'moan' : 'neutral', mouth: m };
  return P;
});

def('deadNoBite', { g: 'dead', dur: 3.4, args: 'dur (default 3.4 s); the mouth is P.face.mouth (0..1), emote moan -> shy -> smug', doc: 'the door gag: winds up, lunges toward Pip\'s hand mouth open, FREEZES, closes the mouth, straightens, politely tips the hat (R hand to the temple)' }, (n) => {
  const k = n.kp, w = n.tp * 1.2 + n.seed * 5;
  const dead = rec({ shL: [-1.1, 0, -0.1], elL: [-0.2, 0, 0], shR: [-1.0, 0, 0.14], elR: [-0.25, 0, 0], head: [0.42, 0.05, 0.1], body: [0.18, 0, 0], legL: [-0.05, 0, -0.04], legR: [0.06, 0, 0.05] });
  const wind = rec({ shL: [-0.7, 0, -0.2], elL: [-0.3, 0, 0], shR: [-0.6, 0, 0.2], elR: [-0.35, 0, 0], head: [0.05, 0, 0.05], body: [0.0, 0, 0], legL: [0.08, 0, -0.05], legR: [-0.08, 0, 0.05] }, { dz: -0.06, face: { emote: 'moan', mouth: 0.6 } });
  const lunge = rec({ shL: [-1.35, 0, -0.16], elL: [-0.25, 0, 0], shR: [-1.15, 0, 0.16], elR: [-0.3, 0, 0], head: [0.32, 0, -0.06], body: [0.5, 0, 0], legL: [-0.28, 0, -0.05], legR: [0.2, 0, 0.05] }, { dz: 0.14, dy: -0.01, face: { emote: 'moan', mouth: 1 } });
  const shy = rec({ shL: [-0.6, 0, -0.3], elL: [-0.4, 0, 0], shR: [-0.5, 0, 0.3], elR: [-0.4, 0, 0], head: [0.32, 0.16, -0.12], body: [0.26, 0, 0], legL: [-0.06, 0, -0.05], legR: [0.05, 0, 0.05] }, { dz: 0.12, face: { emote: 'shy', mouth: 0, look: [0.5, -0.2] } });
  const prim = rec({ shL: [-0.25, 0, -0.35], elL: [-0.35, 0, 0], shR: [-0.5, 0, 0.32], elR: [-0.4, 0, 0], head: [-0.06, 0, 0], body: [-0.02, 0, 0], legL: [0, 0, -0.03], legR: [0, 0, 0.03] }, { face: { emote: 'smug', mouth: 0 } });
  const tip = rec({ shL: [-0.25, 0, -0.35], elL: [-0.35, 0, 0], shR: [-0.11, 0, 2.48], elR: [-0.64, 0, 0.42], head: [0.28, 0, -0.24], body: [0.04, 0, 0], legL: [0, 0, -0.03], legR: [0, 0, 0.03] }, { dy: -0.01, face: { emote: 'smug', mouth: 0 } });
  const P = track([[0, dead], [0.1, dead], [0.22, wind, 'io'], [0.3, lunge, 'snap'], [0.56, lunge, 'lin'], [0.63, shy, 'snap'], [0.74, prim, 'io'], [0.84, prim, 'lin'], [0.9, tip, 'back'], [1, tip, 'lin']], k);
  const frozen = k > 0.3 && k < 0.56;
  if (!frozen && k < 0.3) return addRec(P, rec({ head: [0.02 * Math.sin(w), 0.03 * Math.sin(w * 1.3), 0] }, {}));
  return P;
});

def('deadLookUp', { g: 'dead', args: 'seed', doc: 'stares up at the sky, swaying on the spot, jaw slack' }, (n) => {
  const { tp, seed } = n, w = tp * 0.8 + seed * 11, s = Math.sin(w), c = Math.sin(w * 0.63 + 1);
  return {
    pose: {
      shL: [-0.5 + 0.08 * c, 0, -0.32], elL: [-0.3, 0, 0.05], shR: [-0.4 - 0.08 * c, 0, 0.34], elR: [-0.35, 0, 0],
      head: [-0.78 + 0.05 * c, 0.1 * s, 0.06 * s], body: [-0.12 + 0.03 * s, 0, 0], legL: [-0.02, 0, -0.06], legR: [0.03, 0, 0.06],
    },
    roll: 0.05 * s, dz: -0.02, face: { emote: 'moan', mouth: 0.3, look: [0, 0.9] },
  };
});

// ================================================================== ALIVE (made-over zombies and Pip): on the beat, arms wide, chin up
const hipR = { sh: [-0.09, 0, 1.24], el: [0.04, 0, -2.06] };            // R hand resting on the hip (solved with FK/IK on the rig)
const armsWide = (z = 1.42, elz = -0.18) => ({ shL: [0, 0, -z], shR: [0, 0, z], elL: [0, 0, -elz], elR: [0, 0, elz] });
const bounceUp = (f) => Math.pow(Math.sin(PI * f), 0.8);                // 0 on the beat (contact), 1 half a beat later

def('liveBop', { g: 'live', args: 'seed (decorrelates side/phase a little, still on the beat)', doc: 'upgrade of liveAct: arms wide, contact-and-rise bounce on every beat, alternating step-touch, head nods on the contact' }, (n) => {
  const { beat, seed, amp } = n, b = beat + seed * 0.16, f = fract(b), bi = Math.floor(b);
  const sgn = seed > 0.5 ? 1 : -1, alt = ((bi & 1) ? 1 : -1) * sgn, up = bounceUp(f), low = 1 - up, up2 = bounceUp(fract(b - 0.18));
  const sw = hw(PI * b, 1.4) * sgn;
  return {
    pose: {
      shL: [0, 0, -(1.2 + 0.7 * up * amp)], shR: [0, 0, 1.2 + 0.7 * up * amp], elL: [0, 0, 0.42 - 0.62 * up2 * amp], elR: [0, 0, -(0.42 - 0.62 * up2 * amp)],
      head: [-0.08 + 0.13 * low * amp, 0.16 * sw, 0.12 * sw], body: [0, 0, 0.05 * sw * amp],
      legL: [alt > 0 ? -0.34 * up * amp : 0.04, 0, -0.04], legR: [alt < 0 ? -0.34 * up * amp : 0.04, 0, 0.04],
    },
    dy: 0.07 * amp * up - 0.004, sq: -0.06 * amp * Math.pow(low, 3), roll: -0.05 * sw * amp, face: { emote: 'happy' },
  };
});

def('poseWide', { g: 'live', args: '-', doc: 'pride: arms thrown wide, chin up, chest out; pops in with overshoot then holds and breathes' }, (n) => {
  const s = spring(n.tp, 3.4, 0.28), br = Math.sin(n.tp * 2.4 + n.seed * 6);
  const z = lerp(1.05, 1.86, s), ez = lerp(0.3, 0.12, s);
  return {
    pose: { shL: [0, 0, -z], shR: [0, 0, z], elL: [0, 0, -ez], elR: [0, 0, ez], head: [lerp(0.0, -0.32, s) + 0.012 * br, 0.03 * br, 0.02 * Math.sin(n.tp * 1.3)], body: [lerp(0.03, -0.07, s), 0, 0], legL: [0, 0, -0.03 - 0.05 * s], legR: [0, 0, 0.03 + 0.05 * s] },
    dy: 0.018 * Math.min(1, s), sq: 0.03 * (s - 1) + 0.008 * br, face: { emote: 'proud' },
  };
});

def('poseHip', { g: 'live', args: '-', doc: 'R hand on hip, L arm up with the wrist curled, head tilt, weight on one leg' }, (n) => {
  const s = spring(n.tp, 3.8, 0.34), br = Math.sin(n.tp * 2.2 + n.seed * 5);
  const ready = rec({ ...armsWide(0.9, -0.2), head: [0, 0, 0], legL: [0, 0, -0.03], legR: [0, 0, 0.03] });
  const hit = rec({ shR: hipR.sh, elR: hipR.el, shL: [0, 0, -2.25], elL: [0, 0, -0.7], head: [-0.2, -0.14, 0.24], body: [-0.03, 0, 0.06], legL: [0.05, 0, -0.03], legR: [-0.12, 0, 0.16] }, { roll: 0.07, dx: 0.04, yaw: 0.18, face: { emote: 'smug' } });
  const P = mixRec(ready, hit, Math.min(1.25, s));
  P.dy = 0.012 * br; return P;
});

def('poseCurtsy', { g: 'live', dur: 1.9, args: 'dur', doc: 'hands lift the skirt, one leg tucked behind, dip and bow the head, hold, rise with a flourish' }, (n) => {
  const up = rec({ ...armsWide(0.55, -0.1), head: [-0.05, 0, 0], legL: [0, 0, -0.03], legR: [0, 0, 0.03] }, { face: { emote: 'happy' } });
  const dip = rec({ shL: [0, 0, -0.42], shR: [0, 0, 0.42], elL: [-0.1, 0, 0.05], elR: [-0.1, 0, -0.05], head: [0.42, 0, 0.08], body: [0.16, 0, 0], legL: [-0.12, 0, 0.05], legR: [0.5, 0, -0.12] }, { dy: -0.17, sq: -0.08, face: { emote: 'shy' } });
  const fin = rec({ ...armsWide(0.95, -0.25), head: [-0.2, 0, 0.1], body: [-0.03, 0, 0], legL: [0, 0, -0.05], legR: [0.1, 0, 0.06] }, { dy: 0.02, face: { emote: 'proud' } });
  return track([[0, up], [0.12, up], [0.34, dip, 'io'], [0.6, dip, 'lin'], [0.84, fin, 'back'], [1, fin, 'io']], n.kp);
});

def('poseTwirl', { g: 'live', dur: 1.0, args: 'dur; turns (integer, default 1)', doc: 'full turns about y: wind-up, hop, spin with arms out, overshoot and settle.  yaw ends at 2*pi*turns (the same facing); it returns 0 once the act is over' }, (n) => {
  const k = n.kp, turns = Math.max(1, Math.round(n.args.turns ?? 1)), wind = 0.14, full = TAU * turns;
  let yaw;
  if (k < wind) yaw = -0.3 * smooth(k / wind);
  else if (k < 0.9) yaw = lerp(-0.3, full + 0.12, smooth((k - wind) / (0.9 - wind)));
  else yaw = lerp(full + 0.12, full, smooth((k - 0.9) / 0.1));
  const air = Math.sin(PI * seg(k, 0.12, 0.62)), lift = Math.sin(PI * seg(k, 0.1, 0.88)), dip = k < wind ? smooth(k / wind) : 0;
  return {
    pose: { ...armsWide(1.5 + 0.1 * air, -0.1), head: [-0.12, 0.0, 0.1], body: [0.04, 0, 0], legL: [-0.1 * air, 0, -0.04], legR: [0.5 * air, 0, 0.04] },
    yaw: k >= 1 ? 0 : yaw, dy: 0.13 * air - 0.03 * dip, lean: 0.04 * lift, roll: -0.09 * lift, sq: -0.06 * dip + 0.03 * air, face: { emote: 'happy' },
  };
});

// four fashion hit poses; args.n picks one (0..3, modulo 4).  Each pops in from a ready stance with a springy overshoot, then holds and breathes.
const HITS = [
  () => rec({ shR: hipR.sh, elR: hipR.el, shL: [0, 0, -2.3], elL: [0, 0, -0.75], head: [-0.24, -0.16, 0.26], body: [-0.04, 0, 0.07], legL: [0.06, 0, -0.03], legR: [-0.14, 0, 0.17] }, { roll: 0.08, dx: 0.05, yaw: 0.28, face: { emote: 'smug' } }),                       // A: diva
  () => rec({ shL: [0.15, 0, -2.6], shR: [0.15, 0, 2.6], elL: [0, 0, 0.1], elR: [0, 0, -0.1], head: [-0.34, 0, 0], body: [-0.1, 0, 0], legL: [0.0, 0, -0.06], legR: [0.75, 0, 0.1] }, { dy: 0.07, lean: -0.05, face: { emote: 'happy' } }),                                    // B: jazz V, one heel kicked up
  () => rec({ shR: [-1.47, 0, 0.38], elR: [-1.49, 0, 0.13], shL: [-1.47, 0, -0.38], elL: [-1.49, 0, -0.13], head: [0.05, 0, 0.3], body: [0.05, 0, -0.05], legL: [0, 0, 0.1], legR: [0, 0, -0.1] }, { dy: -0.025, sq: -0.04, roll: -0.05, face: { emote: 'shy' } }), // C: hands framing the face, knees in
  () => rec({ shR: hipR.sh, elR: hipR.el, shL: [-0.09, 0, -1.24], elL: [0.04, 0, 2.06], head: [-0.26, 0.12, 0], body: [-0.05, 0, 0], legL: [0, 0, -0.17], legR: [0, 0, 0.17] }, { dy: -0.02, yaw: -0.22, face: { emote: 'proud' } }),                                     // D: power stance
];
def('poseCouture', { g: 'live', args: 'n (0..3: diva, jazz V, cheeky frame, power stance)', doc: 'a snap hit pose for each "couture"; call once per hit with t = time since that hit' }, (n) => {
  const i = ((Math.round(n.args.n ?? 0) % 4) + 4) % 4, s = spring(n.tp, 4.4, 0.36), br = Math.sin(n.tp * 2.6 + n.seed * 5);
  const ready = rec({ ...armsWide(0.7, -0.2), head: [0.0, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] }, { dy: -0.03, sq: -0.05 });
  const P = mixRec(ready, HITS[i](), Math.min(1.3, s));
  P.dy += 0.008 * br; P.pose.head[0] += 0.015 * br; return P;
});

def('sway', { g: 'live', args: 'seed (phase)', doc: 'verse-2 sway: arms stretched wide, weight rolls side to side over 4 beats with held extremes, head lolls late' }, (n) => {
  const { beat, seed, amp } = n, w = TAU * (beat / 4 + seed), S = hw(w, 1.5), Sl = hw(w - 0.7, 1.3), C = Math.cos(w);
  return {
    pose: {
      shL: [0, 0, -(1.5 - 0.12 * S)], shR: [0, 0, 1.5 + 0.12 * S], elL: [0, 0, 0.3 - 0.22 * Sl], elR: [0, 0, -(0.3 + 0.22 * Sl)],
      head: [-0.06 + 0.04 * C, 0.2 * Sl, 0.24 * Sl], body: [0, 0.06 * S, 0], legL: [S > 0 ? -0.12 : 0.05, 0, -0.05], legR: [S < 0 ? -0.12 : 0.05, 0, 0.05],
    },
    roll: -0.09 * S * amp, dx: 0.06 * S * amp, dy: 0.01 * (1 - Math.abs(S)), face: { emote: 'happy' },
  };
});

def('clap', { g: 'live', args: 'rate (claps per beat, default 1)', doc: 'hands meet in front of the chest exactly on the beat (held closed one frame), open between; head nod and small bounce' }, (n) => {
  const r = n.args.rate ?? 1, f = fract(n.beat * r + n.seed * 0.1);
  const closed = f < 0.12 ? 1 : Math.max(smooth((f - 0.72) / 0.28), 0);
  const open = { shR: [-1.24, 0, 0.66], elR: [-0.49, 0, -0.02] }, shut = { shR: [-1.05, 0, -0.17], elR: [-1.13, 0, -0.35] };
  const a = f < 0.12 ? 1 : closed;                     // 1 = closed
  const zsh = lerp(open.shR[2], shut.shR[2], a), xsh = lerp(open.shR[0], shut.shR[0], a), xel = lerp(open.elR[0], shut.elR[0], a), zel = lerp(open.elR[2], shut.elR[2], a);
  const up = bounceUp(fract(n.beat + n.seed * 0.1));
  return {
    pose: { shR: [xsh, 0, zsh], elR: [xel, 0, zel], shL: [xsh, 0, -zsh], elL: [xel, 0, -zel], head: [0.05 + 0.08 * (1 - up), 0, 0], body: [0.03, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    dy: 0.03 * up * n.amp, sq: -0.03 * (1 - up) * (1 - up), face: { emote: 'happy' },
  };
});

def('cheer', { g: 'live', args: 'seed', doc: 'arms up in a splayed V, a jump on every beat, fists pumping alternately, head back' }, (n) => {
  const { beat, seed, amp } = n, b = beat + seed * 0.12, f = fract(b), up = bounceUp(f), low = 1 - up, alt = (Math.floor(b) & 1) ? 1 : -1;
  return {
    pose: {
      shL: [0, 0, -(2.5 + 0.12 * (alt > 0 ? 1 : 0) + 0.16 * up)], shR: [0, 0, 2.5 + 0.12 * (alt < 0 ? 1 : 0) + 0.16 * up], elL: [0, 0, 0.12 + 0.3 * low], elR: [0, 0, -(0.12 + 0.3 * low)],
      head: [-0.32 + 0.12 * low, 0.05 * alt, 0.06 * alt], body: [-0.06, 0, 0], legL: [0.28 * up, 0, -0.04], legR: [0.2 * up, 0, 0.04],
    },
    dy: 0.15 * amp * up, sq: 0.05 * up - 0.09 * Math.pow(low, 4), roll: -0.03 * alt, face: { emote: 'happy' },
  };
});

def('wave', { g: 'live', args: '-', doc: 'R hand up waving from the elbow, two waves then a pause; the other arm relaxed out of the skirt; head tips toward the wave' }, (n) => {
  const { tp, seed } = n, T = 2.4, f = fract(tp / T + seed), burst = f < 0.75 ? 1 : 0, wv = hw(TAU * 2.3 * tp + seed * 4, 1.3) * burst;
  return {
    pose: { shR: [0, 0, 2.1], elR: [0, 0, 1.0 + 0.42 * wv], shL: [0.05, 0, -0.62], elL: [-0.2, 0, -0.05], head: [-0.05, 0.1, -0.18], body: [0, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    roll: -0.03 + 0.02 * wv, dy: 0.008 * Math.abs(wv), face: { emote: 'happy' },
  };
});

def('lockstep', { g: 'live', args: 'none (identical for every dancer: seed is ignored).  Needs phase (0..4, bar position)', doc: 'Busby Berkeley: an 8-count of crisp arm and leg hits, snapping on each beat, holding between' }, (n) => {
  const ph = n.phase, bi = Math.floor(ph) & 3, fb = ph - Math.floor(ph);
  const H = [
    rec({ shL: [0, 0, -2.45], shR: [0, 0, 2.45], elL: [0, 0, 0.1], elR: [0, 0, -0.1], head: [-0.2, 0, 0], legL: [-0.5, 0, -0.03], legR: [0.05, 0, 0.03] }, { dy: 0.03, face: { emote: 'happy' } }),
    rec({ ...armsWide(1.6, -0.05), head: [-0.12, 0.2, 0], legL: [0.02, 0, -0.03], legR: [-0.5, 0, 0.03] }, { dy: 0.03, face: { emote: 'happy' } }),
    rec({ shL: [-1.25, 0, -0.45], shR: [-1.25, 0, 0.45], elL: [-0.15, 0, 0], elR: [-0.15, 0, 0], head: [-0.05, -0.2, 0], legL: [-0.5, 0, -0.03], legR: [0.05, 0, 0.03] }, { dy: 0.03, face: { emote: 'happy' } }),
    rec({ ...armsWide(0.85, -0.1), head: [-0.1, 0, 0], legL: [0.1, 0, -0.06], legR: [0.1, 0, 0.06] }, { dy: 0.09, sq: 0.04, face: { emote: 'happy' } }),
  ];
  const prev = H[(bi + 3) & 3], cur = H[bi];
  return mixRec(prev, cur, snap(fb / 0.2));
});

def('kickLine', { g: 'live', args: 'none (seed ignored so the whole line kicks together)', doc: 'Rockette kick line: arms out to the neighbours, alternate legs kick high on the beat, small lean back' }, (n) => {
  const b = n.beat, f = fract(b), bi = Math.floor(b), kick = f < 0.15 ? snap(f / 0.15) : f < 0.6 ? 1 : 1 - smooth((f - 0.6) / 0.3), even = (bi & 1) === 0;
  return {
    pose: { ...armsWide(1.27, -0.04), head: [-0.14, 0, 0], body: [-0.05 * kick, 0, 0], legL: [even ? -1.32 * kick : 0.0, 0, -0.03], legR: [even ? 0.0 : -1.32 * kick, 0, 0.03] },
    dy: 0.025 * kick, lean: -0.05 * kick, roll: (even ? 1 : -1) * 0.03 * kick, face: { emote: 'happy' },
  };
});

def('spinArms', { g: 'live', args: 'dir (1 or -1)', doc: 'both arms windmill on a cone (opposed, one turn per two beats), body turned three-quarters so the circles show from the front; bouncing body' }, (n) => {
  const d = n.args.dir ?? 1, ang = PI * n.beat * d, up = bounceUp(fract(n.beat));
  return {
    pose: { shL: [-ang, 0, -0.72], shR: [-ang - PI, 0, 0.72], elL: [0, 0, 0], elR: [0, 0, 0], head: [-0.06 + 0.08 * (1 - up), 0.12 * Math.sin(ang), 0], body: [0, 0.08 * Math.sin(ang), 0], legL: [-0.15 * up, 0, -0.04], legR: [0.05, 0, 0.04] },
    dy: 0.06 * up, sq: -0.04 * Math.pow(1 - up, 3), roll: 0.03 * Math.sin(ang), yaw: 0.5, face: { emote: 'happy' },
  };
});

def('hop', { g: 'live', dur: 0.62, args: 'dur (default 0.62); height (m, default 0.3); from ("dead" default | "live")', doc: 'the makeover hop: crouch anticipation, spring with a stretch, arms fly up, land with a squash, rebound and settle to the LIVE pose' }, (n) => {
  const H = n.args.height ?? 0.3, from = n.args.from === 'live' ? rec(LIVE) : rec(DEAD);
  const crouch = rec({ shL: [0.55, 0, -0.5], shR: [0.55, 0, 0.5], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0], head: [0.36, 0, 0], body: [0.16, 0, 0], legL: [0.06, 0, -0.1], legR: [0.06, 0, 0.1] }, { dy: -0.075, sq: -0.15 });
  const rise = rec({ shL: [0, 0, -2.2], shR: [0, 0, 2.2], elL: [0, 0, 0.1], elR: [0, 0, -0.1], head: [-0.22, 0, 0], body: [-0.08, 0, 0], legL: [0.18, 0, -0.03], legR: [0.18, 0, 0.03] }, { dy: H * 0.55, sq: 0.11 });
  const apex = rec({ shL: [0, 0, -2.45], shR: [0, 0, 2.45], elL: [0, 0, 0.2], elR: [0, 0, -0.2], head: [-0.3, 0, 0], body: [-0.1, 0, 0], legL: [-0.32, 0, -0.06], legR: [-0.32, 0, 0.06] }, { dy: H, sq: 0.04 });
  const land = rec({ shL: [0, 0, -1.4], shR: [0, 0, 1.4], elL: [0, 0, 0.55], elR: [0, 0, -0.55], head: [0.18, 0, 0], body: [0.1, 0, 0], legL: [0.05, 0, -0.12], legR: [0.05, 0, 0.12] }, { dy: -0.04, sq: -0.17 });
  const reb = rec({ shL: [0, 0, -1.7], shR: [0, 0, 1.7], elL: [0, 0, -0.1], elR: [0, 0, 0.1], head: [-0.16, 0, 0], body: [-0.03, 0, 0], legL: [0, 0, -0.05], legR: [0, 0, 0.05] }, { dy: 0.045, sq: 0.05 });
  const fin = rec(LIVE, { face: { emote: 'happy' } });
  return track([[0, from], [0.05, from], [0.19, crouch, 'io'], [0.36, rise, 'snap'], [0.47, apex, 'out'], [0.68, land, 'in'], [0.83, reb, 'out'], [1, fin, 'back']], n.kp);
});

def('preen', { g: 'live', args: 'seed', doc: 'looks down, pats the skirt (hands alternate), then chin up in a small proud sway' }, (n) => {
  const T = 2.6, f = fract(n.tp / T + n.seed), pat = (c) => Math.max(0, Math.sin(PI * clamp((f - c) / 0.11)));
  const look = smooth(seg(f, 0.06, 0.2)) * (1 - smooth(seg(f, 0.72, 0.84))), proud = smooth(seg(f, 0.74, 0.86)) * (1 - smooth(seg(f, 0.94, 1)));
  const pl = pat(0.24), pr = pat(0.38), pl2 = pat(0.52), pr2 = pat(0.62), L = Math.max(pl, pl2), R = Math.max(pr, pr2);
  const relaxL = [0.05, 0, -0.62], relaxR = [0.05, 0, 0.62];
  const skirtR = [0.0, 0, 0.43 + 0.03 * R], skirtL = [0.0, 0, -(0.43 + 0.03 * L)];
  const aH = smooth(seg(f, 0.1, 0.22)) * (1 - smooth(seg(f, 0.7, 0.8)));
  const sh = (a, b) => a.map((v, i) => lerp(v, b[i], aH));
  return {
    pose: { shL: sh(relaxL, skirtL), shR: sh(relaxR, skirtR), elL: [-0.1, 0, 0.05], elR: [-0.1, 0, -0.05], head: [-0.05 + 0.42 * look - 0.3 * proud, 0.08 * look, 0.06 * proud], body: [0.06 * look - 0.03 * proud, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    roll: -0.06 * proud, dy: 0.02 * proud - 0.012 * (L + R), sq: -0.02 * (L + R) + 0.015 * proud, face: { emote: proud > 0.4 ? 'proud' : 'happy' },
  };
});

// ------------------------------------------------------------------ catwalk
def('strut', { g: 'live', args: 'dist (m walked) | speed (default 0.85 m/s); scale (default 1); hands ("hip" default | "swing" | "wide")', doc: 'catwalk: chin up, hips swing, crossing feet, R hand near the hip, L arm swings opposite the legs, root bob per step' }, (n) => {
  const ph = gaitPhase(n, 0.44, 0.85), w = TAU * ph, s = Math.sin(w), c = Math.cos(w), hands = n.args.hands ?? 'hip', amp = n.amp;
  const A = 0.44 * amp, cross = (v) => Math.max(0, v);
  let arms;
  if (hands === 'wide') arms = { shL: [0.2 * s, 0, -1.25], shR: [-0.2 * s, 0, 1.25], elL: [0, 0, 0.1], elR: [0, 0, -0.1] };
  else if (hands === 'swing') arms = { shL: [0.34 * s, 0, -0.62], shR: [-0.34 * s, 0, 0.62], elL: [-0.25 - 0.12 * s, 0, 0.05], elR: [-0.25 + 0.12 * s, 0, -0.05] };
  else arms = { shR: [hipR.sh[0], 0, hipR.sh[2] + 0.02 * c], elR: hipR.el, shL: [0.3 * s, 0, -0.55], elL: [-0.28 - 0.12 * s, 0, 0.05] };
  return {
    pose: { ...arms, head: [-0.16, -0.08 * s, 0.06 * s], body: [-0.02, 0, 0], legL: [-A * s, 0, 0.12 * cross(s)], legR: [A * s, 0, -0.12 * cross(-s)] },
    dx: -0.04 * s * amp, roll: -0.05 * s * amp, yaw: 0.07 * s * amp, dy: 0.6 * plant(A * Math.abs(s)) + 0.006, lean: -0.03, face: { emote: 'smug', look: [0, 0] },
  };
});

def('runwayTurn', { g: 'live', dur: 1.1, args: 'dur; angle (default pi)', doc: 'the end-of-runway pivot: weight shift, snap round on the toes, hip pop and a chin toss.  yaw ends at `angle`: add it to the heading afterwards' }, (n) => {
  const ang = n.args.angle ?? PI, k = n.kp;
  const stand = rec({ shR: hipR.sh, elR: hipR.el, shL: [0, 0, -0.55], elL: [-0.25, 0, 0.05], head: [-0.16, 0, 0], body: [-0.02, 0, 0], legL: [-0.1, 0, 0.05], legR: [0.1, 0, 0.0] }, { face: { emote: 'smug' } });
  const wind = rec({ shR: hipR.sh, elR: hipR.el, shL: [0.25, 0, -0.75], elL: [-0.3, 0, 0], head: [-0.12, 0.1, 0], body: [0, 0, 0], legL: [0.12, 0, 0.1], legR: [-0.2, 0, -0.14] }, { yaw: -0.16, dy: -0.02, roll: 0.03, face: { emote: 'smug' } });
  const mid = rec({ shR: hipR.sh, elR: hipR.el, shL: [-0.3, 0, -1.0], elL: [-0.2, 0, 0.1], head: [-0.16, -0.15, 0], body: [0, 0, 0], legL: [-0.3, 0, 0.15], legR: [0.3, 0, -0.1] }, { yaw: ang * 0.55, dy: 0.03, face: { emote: 'smug' } });
  const done = rec({ shR: hipR.sh, elR: hipR.el, shL: [0.1, 0, -1.0], elL: [-0.1, 0, 0.1], head: [-0.32, 0.0, 0.22], body: [-0.05, 0, 0.0], legL: [0.04, 0, -0.02], legR: [-0.18, 0, 0.18] }, { yaw: ang + 0.12, roll: 0.1, dx: 0.05, face: { emote: 'proud' } });
  const set = rec({ shR: hipR.sh, elR: hipR.el, shL: [0.1, 0, -0.9], elL: [-0.1, 0, 0.1], head: [-0.28, 0, 0.18], body: [-0.04, 0, 0], legL: [0.04, 0, -0.02], legR: [-0.16, 0, 0.16] }, { yaw: ang, roll: 0.08, dx: 0.04, face: { emote: 'proud' } });
  return track([[0, stand], [0.14, wind, 'io'], [0.36, mid, 'snap'], [0.62, done, 'out'], [0.8, set, 'io'], [1, set, 'lin']], k);
});

def('runwayPose', { g: 'live', args: '-', doc: 'the T at the end of the runway: hand on hip, one foot crossed in front, chin high, three-quarter turn; snaps in then holds and breathes' }, (n) => {
  const s = spring(n.tp, 3.6, 0.36), br = Math.sin(n.tp * 2.1 + n.seed * 5);
  const pre = rec({ shR: hipR.sh, elR: hipR.el, shL: [0, 0, -0.55], elL: [-0.2, 0, 0.05], head: [-0.1, 0, 0], legL: [-0.1, 0, 0.0], legR: [0.1, 0, 0] });
  const hit = rec({ shR: hipR.sh, elR: hipR.el, shL: [0.14, 0, -0.95], elL: [-0.1, 0, 0.12], head: [-0.3, 0.12, 0.18], body: [-0.04, 0, 0], legL: [0.06, 0, -0.03], legR: [-0.3, 0, 0.16] }, { yaw: 0.3, roll: 0.06, dx: 0.04, lean: -0.03, face: { emote: 'smug', look: [0.3, 0] } });
  const P = mixRec(pre, hit, Math.min(1.2, s)); P.dy = 0.008 * br; P.pose.head[0] += 0.01 * br; return P;
});

def('runwayLook', { g: 'live', args: '-', doc: 'held runway pose while the head snaps to the photographers, left then right, on every second beat; eyes lead' }, (n) => {
  const P = ACTS.runwayPose({ ...n, t: 9, tp: 9, args: {} }), look = hw(PI * n.beat / 2 + n.seed * 3, 4), pop = 1 - smooth(fract(n.beat / 2 + 0.5) * 6);
  const o = addRec(P, rec({ head: [0.06 * pop, 0.55 * look, -0.06 * look] }, { dy: 0.01 * pop }));
  o.face = { emote: 'smug', look: [0.9 * look, 0.05] }; return o;
});

// ================================================================== PIP
const bellyL = { shL: [-0.55, 0, 0.05], elL: [-1.33, 0, 0.42] }, bellyR = { shR: [-0.55, 0, -0.05], elR: [-1.33, 0, -0.42] };     // hands clasped at the waist bow
const chestR = { shR: [-0.5, 0, 0.01], elR: [-1.82, 0, -0.46] }, chestL = { shL: [-0.5, 0, -0.01], elL: [-1.82, 0, 0.46] };       // a hand on the heart
const mouthR = { shR: [-1.23, 0, 0.05], elR: [-1.37, 0, -0.29] }, mouthL = { shL: [-1.23, 0, -0.05], elL: [-1.37, 0, 0.29] };     // hands to the mouth

def('pipIdle', { g: 'pip', args: 'mood: "calm" (default) | "nervous" | "kind"', doc: 'Pip standing: breathing, weight shifts, slow glances; hands clasped at the waist' }, (n) => {
  const { tp, seed } = n, mood = n.args.mood ?? 'calm', w = tp * 0.85 + seed * 10, br = Math.sin(w), wt = Math.sin(w * 0.31 + 1), g = hw(tp * 0.5 + seed * 7, 1.4);
  const nerv = mood === 'nervous', fid = nerv ? hw(tp * 3.1, 1.2) : 0;
  return {
    pose: { ...bellyR, ...bellyL, elR: [-1.33 + 0.12 * fid, 0, -0.42], elL: [-1.33 - 0.12 * fid, 0, 0.42], head: [0.02 * br + (nerv ? 0.08 : 0), (nerv ? 0.5 : 0.28) * g, mood === 'kind' ? -0.12 : 0.03 * wt], body: [0.01 * br, 0, 0], legL: [0.03 * wt, 0, -0.03], legR: [-0.03 * wt, 0, 0.03] },
    roll: 0.012 * wt, dx: 0.012 * wt, sq: 0.006 * br, face: { emote: nerv ? 'worried' : mood === 'kind' ? 'happy' : 'neutral', look: [0.5 * g, 0] },
  };
});

const flinchRec = (n, dirS) => {
  const k = n.kp, d = dirS, idle = rec({ ...bellyR, ...bellyL, head: [0.02, 0, 0] });
  const hit = rec({ ...mouthR, ...mouthL, shR: [-1.15, 0, 0.27], shL: [-1.15, 0, -0.27], head: [0.12, 0.55 * d, 0.22 * d], body: [-0.2, 0.1 * d, 0], legL: [0.02, 0, -0.06], legR: [0.38, 0, 0.06] }, { dz: -0.13, dy: 0.01, roll: 0.03 * d, face: { emote: 'gasp', look: [-0.6 * d, 0] } });
  const trem = 0.012 * Math.sin(n.tp * 60);
  const rel = rec({ shR: [-0.9, 0, 0.35], shL: [-0.9, 0, -0.35], elR: [-1.0, 0, -0.3], elL: [-1.0, 0, 0.3], head: [0.06, 0.3 * d, 0.1 * d], body: [-0.08, 0.04 * d, 0], legL: [0, 0, -0.04], legR: [0.2, 0, 0.04] }, { dz: -0.1, face: { emote: 'worried', look: [-0.3 * d, 0] } });
  const P = track([[0, idle], [0.07, hit, 'snap'], [0.55, hit, 'lin'], [0.9, rel, 'io'], [1, rel, 'lin']], k);
  if (k > 0.07 && k < 0.55) { P.dx += trem; P.pose.head[2] += trem * 2; }
  return P;
};
def('pipFlinch', { g: 'pip', dur: 1.0, args: 'dur', doc: 'a start: both hands snap up to the face, step back, head whipped away (side = the way the head turns); trembles, then eases' }, (n) => flinchRec(n, 1));
def('flinch', { g: 'other', dur: 0.9, args: 'dur', doc: 'the same start for any character (zombies at a loud noise)' }, (n) => flinchRec(n, 1));

def('pipListen', { g: 'pip', args: '-', doc: 'head turned to a noise (side = which way), a hand to the heart, freezes with tiny breaths and a raised brow' }, (n) => {
  const s = spring(n.tp, 3, 0.4), br = Math.sin(n.tp * 2.3);
  return {
    pose: { ...chestR, shL: [-0.35, 0, -0.5], elL: [-0.4, 0, 0.05], head: [-0.04 + 0.01 * br, 0.78 * s, -0.12 * s], body: [0.0, 0.16 * s, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    yaw: 0.16 * s, lean: 0.03 * s, dz: 0.02 * s, face: { emote: 'worried', brow: 0.5, look: [0.85, 0] },
  };
});

const sewRec = (b, ph) => {   // b: beat; the needle end of the machine is on Pip's front
  const s = Math.sin(PI * b * 2), c = Math.cos(PI * b), sb = Math.sin(PI * b), pl = ph;
  return rec({ shR: [-1.05 + 0.17 * s, 0, 0.32], elR: [-0.85 - 0.28 * s, 0, -0.1], shL: [-1.02 + 0.22 * c, 0, -0.42 - 0.1 * sb], elL: [-0.9 + 0.2 * sb, 0, 0.1], head: [0.5 + 0.05 * s + 0.07 * pl, 0.03 * sb, 0.03 * sb], body: [0.3 + 0.04 * pl, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] }, { dy: -0.016 * pl, roll: 0.012 * sb, face: { emote: 'neutral', look: [0, -0.6] } });
};
def('pipSew', { g: 'pip', args: '-', doc: 'at the machine: leaning in, head down, R hand feeds the fabric, L hand cranks the wheel; everything rides the beat' }, (n) => sewRec(n.beat + n.seed * 0.1, n.pulse));

def('pipSewLook', { g: 'pip', dur: 2.0, args: 'dur', doc: 'looks up from the sewing to the camera with a wink (emote happy), holds, goes back to work' }, (n) => {
  const live = sewRec(n.beat, n.pulse), still = sewRec(0.3, 0);
  const look = addRec(still, rec({ head: [-0.55, -0.1, 0.2], body: [-0.15, 0, -0.03] }, { dy: 0.015, face: { emote: 'happy', look: [0, 0.3] } }));
  return track([[0, live], [0.16, look, 'snap'], [0.72, look, 'lin'], [0.92, still, 'io'], [1, live, 'io']], n.kp);
});

def('pipPin', { g: 'pip', args: '-', doc: 'bent double over a hem: R hand dabs pins (jab-jab-pause), L hand steadies the fabric; attach.handR = "pin"' }, (n) => {
  const { tp, seed } = n, T = 1.5, f = fract(tp / T + seed), jab = (c) => Math.max(0, Math.sin(PI * clamp((f - c) / 0.14)));
  const j = Math.max(jab(0.1), jab(0.3)) * (f < 0.6 ? 1 : 0);
  const w = tp * 1.1 + seed * 9;
  return {
    pose: { shR: [-0.55 - 0.16 * j, 0, 0.12], elR: [-0.42 - 0.62 * j, 0, -0.02], shL: [-0.6 - 0.04 * j, 0, -0.3], elL: [-0.3, 0, 0.1], head: [0.32 + 0.05 * Math.sin(w) + 0.08 * j, 0.06 * Math.sin(w * 0.7), 0.05], body: [0.56 + 0.07 * j, 0, 0], legL: [0.06, 0, -0.05], legR: [-0.16, 0, 0.05] },
    dy: -0.015, dz: 0.03 + 0.012 * j, roll: 0.02 * Math.sin(w * 0.5), attach: { handR: 'pin' }, face: { emote: 'neutral', look: [0, -0.7] },
  };
});

def('pipMeasure', { g: 'pip', args: '-', doc: 'arms spread as if holding the tape around someone; squeezes in, reads the number with a nod, opens again; attach.handL/R = "tape"' }, (n) => {
  const T = 3.6, f = fract(n.tp / T + n.seed), sq = smooth(seg(f, 0.35, 0.5)) * (1 - smooth(seg(f, 0.7, 0.82))), rd = smooth(seg(f, 0.5, 0.58)) * (1 - smooth(seg(f, 0.68, 0.74)));
  const zsh = lerp(0.6, 0.28, sq), xsh = -1.28;
  return {
    pose: { shR: [xsh, 0, zsh], elR: [-0.25 - 0.3 * sq, 0, -0.35], shL: [xsh, 0, -zsh], elL: [-0.25 - 0.3 * sq, 0, 0.35], head: [0.1 + 0.32 * rd, 0.1 * Math.sin(n.tp * 0.9), 0.12 * (1 - rd)], body: [0.12 + 0.08 * sq, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    dy: -0.012 * sq, attach: { handL: 'tape', handR: 'tape' }, face: { emote: 'neutral', look: [0, -0.4 * rd] },
  };
});

def('pipSnip', { g: 'pip', args: '-', doc: 'R forearm scissors chop (bursts of three snips), L hand holds the cloth, head cocked; attach.handR = "scissors"' }, (n) => {
  const { tp, seed } = n, T = 1.7, f = fract(tp / T + seed), burst = f < 0.55, ch = burst ? hw(TAU * 3.4 * f / 1 + 0.5, 1.5) : -1;
  const c = clamp(0.5 + 0.5 * ch);
  return {
    pose: { shR: [-1.2, 0, 0.26], elR: [-0.75 - 0.5 * c, 0, -0.1], shL: [-1.12, 0, -0.32], elL: [-0.55, 0, 0.1], head: [0.24, 0.05, 0.26], body: [0.16, 0, 0], legL: [0, 0, -0.04], legR: [0, 0, 0.04] },
    dy: -0.005 * c, roll: -0.02, attach: { handR: 'scissors' }, face: { emote: 'neutral', look: [0.1, -0.5] },
  };
});

def('pipPresent', { g: 'pip', dur: 1.5, args: 'dur', doc: 'ta-da: hands gather, tiny crouch, arms sweep out to the sides with overshoot, chin up, big smile, small hop' }, (n) => {
  const gather = rec({ shR: [-1.0, 0, -0.05], shL: [-1.0, 0, 0.05], elR: [-1.2, 0, -0.35], elL: [-1.2, 0, 0.35], head: [0.12, 0, 0], body: [0.1, 0, 0], legL: [0.05, 0, -0.06], legR: [0.05, 0, 0.06] }, { dy: -0.05, sq: -0.06, face: { emote: 'neutral' } });
  const ta = rec({ shR: [0, 0, 1.85], shL: [0, 0, -1.85], elR: [0, 0, -0.05], elL: [0, 0, 0.05], head: [-0.32, 0.12, -0.1], body: [-0.1, 0, 0], legL: [0.0, 0, -0.06], legR: [0.15, 0, 0.08] }, { dy: 0.1, sq: 0.06, yaw: 0.18, face: { emote: 'happy' } });
  const set = rec({ shR: [0, 0, 1.66], shL: [0, 0, -1.66], elR: [0, 0, -0.08], elL: [0, 0, 0.08], head: [-0.28, 0.1, -0.08], body: [-0.07, 0, 0], legL: [0, 0, -0.05], legR: [0.05, 0, 0.06] }, { dy: 0.01, yaw: 0.14, face: { emote: 'happy' } });
  return track([[0, gather], [0.16, gather, 'lin'], [0.42, ta, 'snap'], [0.6, set, 'back'], [1, set, 'lin']], n.kp);
});

def('pipSing', { g: 'pip', args: 'style: "soft" | "bright" (default) | "belt";  emph (0..1: raises the free hand on emotional words; default follows the phrase pulse)', doc: 'lead singer: chest up, small head bob and shoulder sway on the beat; the mouth is the film\'s (visemes)' }, (n) => {
  const st = n.args.style ?? 'bright', { beat, amp } = n, f = fract(beat), up = bounceUp(f), low = 1 - up, alt = (Math.floor(beat) & 1) ? 1 : -1, sw = hw(PI * beat / 2, 1.3);
  const emph = n.args.emph ?? (0.5 + 0.5 * Math.sin(beat * PI / 4 + 1)) * 0.6;
  if (st === 'soft') {
    return { pose: { ...chestR, ...chestL, head: [0.04 * low + 0.04, 0.08 * sw, -0.16 + 0.05 * sw], body: [-0.03, 0.03 * sw, 0], legL: [0, 0, -0.04], legR: [0.03, 0, 0.04] }, roll: -0.025 * sw, dy: 0.006 * up, face: { emote: 'worried', look: [0.2 * sw, 0.1] } };
  }
  if (st === 'belt') {
    const arm = 1.9 + 0.5 * emph;
    return {
      pose: { shR: [0, 0, arm], elR: [0, 0, -0.1], shL: [-0.2, 0, -0.9 - 0.3 * emph], elL: [-1.5, 0, 0.4], head: [-0.32 - 0.05 * up, 0.1 * sw, -0.1 * sw], body: [-0.12, 0, 0], legL: [0.06, 0, -0.1], legR: [-0.14, 0, 0.14] },
      dy: 0.03 * up * amp, sq: 0.03 * up - 0.03 * Math.pow(low, 4), roll: -0.04 * sw, lean: -0.02, yaw: 0.1 * sw, face: { emote: 'proud' },
    };
  }
  return {   // bright
    pose: { shR: [-0.3, 0, 0.75 + 0.35 * emph], elR: [-0.9, 0, -0.1], shL: [-0.5, 0, -0.35], elL: [-1.4, 0, 0.45], head: [-0.1 + 0.1 * low, 0.1 * alt, 0.12 * alt], body: [-0.04, 0, 0], legL: [alt > 0 ? -0.2 * up : 0.03, 0, -0.04], legR: [alt < 0 ? -0.2 * up : 0.03, 0, 0.04] },
    dy: 0.045 * up * amp, sq: -0.04 * Math.pow(low, 3), roll: -0.05 * alt * up, face: { emote: 'happy' },
  };
});

def('pipCheer', { g: 'pip', args: '-', doc: 'arms up in a V, a big jump on every beat (bigger than the crowd\'s cheer), fist pump, head back' }, (n) => {
  const P = ACTS.cheer({ ...n, seed: 0, args: {} }); P.dy *= 1.25; P.pose.head[0] -= 0.05; return P;
});

def('pipPointUp', { g: 'pip', dur: 2.0, args: 'dur', doc: 'the needle and thread raised to the sky: the R arm rises straight up, head back, up on her toes, L hand on her heart; attach.handR = "needle"' }, (n) => {
  const s = smooth(seg(n.kp, 0.05, 0.6)), tr = n.kp > 0.75 ? 0.012 * Math.sin(n.tp * 40) : 0;
  return {
    pose: { shR: [-0.06 * s, 0, lerp(0.5, 2.88, s)], elR: [0, 0, lerp(-0.1, 0.02, s)], ...chestL, head: [lerp(0.05, -0.62, s), 0.05, -0.05 * s], body: [-0.1 * s, 0, 0], legL: [0.04 * s, 0, -0.05], legR: [-0.05 * s, 0, 0.05] },
    dy: 0.03 * s, sq: 0.035 * s, dx: tr, attach: { handR: 'needle' }, face: { emote: 'awe', look: [0.1, 0.9] },
  };
});

def('pipThread', { g: 'pip', dur: 2.6, args: 'dur', doc: 'threading the needle: needle held up to the light in the R hand, thread in the L, squinting, a wobble, a triumphant nod; attach.handR = "needle"' }, (n) => {
  const k = n.kp, wob = 0.03 * Math.sin(n.tp * 9) * (1 - smooth(seg(k, 0.55, 0.65))), ok = smooth(seg(k, 0.62, 0.72)) * (1 - smooth(seg(k, 0.9, 1)));
  return {
    pose: { shR: [-2.38 + wob, 0, 0.05], elR: [-0.48, 0, -0.07], shL: [-1.88, 0, 0.12 - wob], elL: [-0.84, 0, 0.16], head: [-0.16 + 0.3 * ok, 0.06 * Math.sin(n.tp * 2), 0.12], body: [-0.05, 0, 0], legL: [0, 0, -0.04], legR: [0.03, 0, 0.04] },
    roll: -0.02, attach: { handR: 'needle' }, face: { emote: ok > 0.4 ? 'happy' : 'worried', look: [0.1, 0.4] },
  };
});

def('pipSewArm', { g: 'pip', args: '-', doc: 'sewing an arm back on: both hands busy at the socket; R hand pulls the thread up and out, L steadies; attach.handR = "needle"' }, (n) => {
  const b = n.beat * 2, pull = hw(PI * b + n.seed, 1.4) * 0.5 + 0.5, w = n.tp * 1.2;
  return {
    pose: { shR: [-1.15, 0, 0.35], elR: [-1.05 + 0.5 * pull, 0, -0.2], shL: [-1.2, 0, -0.3], elL: [-0.7, 0, 0.1], head: [0.42 + 0.03 * Math.sin(w), 0.1 * Math.sin(w * 0.5), 0.05], body: [0.2, 0, 0], legL: [0, 0, -0.04], legR: [0.04, 0, 0.04] },
    dy: -0.006 * pull, attach: { handR: 'needle' }, face: { emote: 'neutral', look: [0.1, -0.5] },
  };
});

def('pipRelieved', { g: 'pip', dur: 2.4, args: 'dur', doc: 'a long exhale: shoulders drop, head tips back then forward, a hand to the heart, a small smile' }, (n) => {
  const tense = rec({ shR: [-1.0, 0, 0.35], shL: [-1.0, 0, -0.35], elR: [-1.1, 0, -0.3], elL: [-1.1, 0, 0.3], head: [0.0, 0.2, 0.05], body: [-0.05, 0, 0], legL: [0, 0, -0.05], legR: [0.1, 0, 0.05] }, { dz: -0.05, sq: 0.02, face: { emote: 'worried' } });
  const out = rec({ ...chestR, shL: [-0.3, 0, -0.55], elL: [-0.3, 0, 0.05], head: [-0.28, 0, -0.1], body: [-0.06, 0, 0], legL: [0, 0, -0.04], legR: [0.02, 0, 0.04] }, { dy: 0.0, sq: 0.03, face: { emote: 'happy' } });
  const low = rec({ ...chestR, shL: [-0.25, 0, -0.6], elL: [-0.3, 0, 0.05], head: [0.2, -0.1, -0.12], body: [0.05, 0, 0], legL: [0, 0, -0.04], legR: [0.02, 0, 0.04] }, { dy: -0.02, sq: -0.03, face: { emote: 'happy' } });
  return track([[0, tense], [0.12, tense, 'lin'], [0.38, out, 'io'], [0.72, low, 'io'], [1, low, 'lin']], n.kp);
});

def('pipDecide', { g: 'pip', dur: 2.2, args: 'dur; a side of +1 looks toward +x', doc: 'looks over at the machine (head then body turn), the worry melts into a slow smile: emote worried -> proud' }, (n) => {
  const idle = rec({ ...bellyR, ...bellyL, head: [0.05, 0, 0] }, { face: { emote: 'worried' } });
  const look = rec({ ...bellyR, ...bellyL, head: [0.0, 0.7, -0.1], body: [0, 0.14, 0] }, { yaw: 0.2, face: { emote: 'worried', look: [0.9, 0] } });
  const smile = rec({ ...chestR, shL: [-0.35, 0, -0.5], elL: [-0.4, 0, 0.05], head: [-0.12, 0.66, -0.1], body: [-0.02, 0.14, 0], legL: [0, 0, -0.04], legR: [0.02, 0, 0.04] }, { yaw: 0.22, sq: 0.02, face: { emote: 'proud', look: [0.9, 0.1] } });
  return track([[0, idle], [0.2, idle, 'lin'], [0.45, look, 'io'], [0.7, look, 'lin'], [0.9, smile, 'io'], [1, smile, 'lin']], n.kp);
});

// ================================================================== SEATED (the caller puts the root at the SEAT height; dys sinks the skirt onto it)
const SITY = -0.56;
const lapR = { shR: [-0.51, 0, 0.03], elR: [-0.68, 0, -0.05] }, lapL = { shL: [-0.51, 0, -0.03], elL: [-0.68, 0, 0.05] };
const sitLegs = { legL: [-1.12, 0, -0.08], legR: [-1.12, 0, 0.08] };
const sitBase = (over = {}, o = {}) => rec({ ...lapR, ...lapL, ...sitLegs, head: [0.0, 0, 0], body: [0, 0, 0], ...over }, { dys: SITY, ...o });

def('sitIdle', { g: 'seated', args: 'seed', doc: 'seated, hands in the lap, upright; breathes, shifts, glances slowly.  The caller sets base.y = seat height' }, (n) => {
  const { tp, seed } = n, w = tp * 0.8 + seed * 10, br = Math.sin(w), g = hw(tp * 0.4 + seed * 6, 1.4);
  const P = sitBase({ head: [0.02 * br, 0.32 * g, 0.03 * br], body: [0.015 * br, 0.05 * g, 0] }, { sq: 0.006 * br, roll: 0.012 * Math.sin(w * 0.4), face: { emote: 'neutral', look: [0.4 * g, 0] } });
  return P;
});

def('sitSip', { g: 'seated', dur: 4.0, args: 'dur', doc: 'lifts the cup to the mouth in the R hand (attach.handR = "cup"), a small sip nod, lowers it again' }, (n) => {
  const rest = sitBase({}, { attach: { handR: 'cup' }, face: { emote: 'neutral' } });
  const up = sitBase({ shR: [-1.35, 0, -0.13], elR: [-1.17, 0, -0.24], head: [-0.02, 0.04, 0.0], body: [-0.02, 0, 0] }, { attach: { handR: 'cup' }, face: { emote: 'happy' } });
  const sip = sitBase({ shR: [-1.4, 0, -0.13], elR: [-1.3, 0, -0.24], head: [-0.16, 0.04, 0.04], body: [-0.05, 0, 0] }, { attach: { handR: 'cup' }, face: { emote: 'happy' } });
  return track([[0, rest], [0.1, rest, 'lin'], [0.36, up, 'io'], [0.5, sip, 'out'], [0.62, up, 'io'], [0.9, rest, 'io'], [1, rest, 'lin']], n.kp);
});

def('sitLaugh', { g: 'seated', args: 'seed', doc: 'shoulders shake on alternate poses, head back, a hand on the belly, rocking' }, (n) => {
  const q = Math.floor(n.tp * 12 + 1e-6), sg = (q & 1) ? 1 : -1, rock = Math.sin(n.tp * 3.1 + n.seed * 6);
  return sitBase({ shR: [-0.36, 0, 0.07], elR: [-1.35, 0, -0.39], head: [-0.34 + 0.06 * sg, 0.06 * sg, 0.06 * sg], body: [-0.1 + 0.08 * rock, 0, 0.035 * sg], shL: [-0.51, 0, -0.03 + 0.05 * sg] },
    { dy: 0.008 * sg, sq: 0.012 * sg, roll: 0.02 * sg, face: { emote: 'happy', mouth: 0.9 } });
});

def('sitLean', { g: 'seated', args: 'side = the way to lean (+1 toward +x)', doc: 'leans toward the neighbour, head tipped, listening, one hand out on the table' }, (n) => {
  const w = n.tp * 0.9 + n.seed * 7, br = Math.sin(w), nod = hw(n.tp * 1.1 + n.seed, 1.5);
  return sitBase({ shR: [-0.9, 0, 0.4], elR: [-0.5, 0, -0.1], head: [0.02 + 0.05 * nod, 0.3, -0.24], body: [0.05, 0.12, 0] }, { roll: -0.15, yaw: 0.2, dx: 0.04, sq: 0.006 * br, face: { emote: 'happy', look: [0.7, 0] } });
});

def('sitIgnore', { g: 'seated', args: '-', doc: 'stares straight ahead, entirely unbothered: upright, hands in the lap, head locked; only a breath.  The comic centre of the arm gag' }, (n) => {
  const br = Math.sin(n.tp * 1.3);
  return sitBase({ head: [-0.02, 0, 0], body: [-0.01, 0, 0] }, { sq: 0.003 * br, face: { emote: 'neutral', look: [0, 0] } });
});

def('sitPassCup', { g: 'seated', dur: 2.4, args: 'dur', doc: 'holds the cup out to the neighbour (side), lets go at k = 0.5, hand returns to the lap; attach.handR = "cup" until the release' }, (n) => {
  const rest = sitBase({}, { attach: { handR: 'cup' }, face: { emote: 'neutral' } });
  const out = sitBase({ shR: [-0.75, 0, 1.05], elR: [-0.65, 0, -0.35], head: [0, 0.4, -0.1], body: [0.04, 0.2, 0] }, { attach: { handR: 'cup' }, yaw: 0.14, roll: -0.05, face: { emote: 'happy', look: [0.8, 0] } });
  const empty = { ...out, attach: {} };
  const back = sitBase({}, { face: { emote: 'happy' } });
  return track([[0, rest], [0.15, rest, 'lin'], [0.42, out, 'io'], [0.5, out, 'lin'], [0.52, empty, 'step'], [0.7, empty, 'lin'], [0.95, back, 'io'], [1, back, 'lin']], n.kp);
});

def('armless', { g: 'seated', args: 'seed', doc: 'sitIdle with the R arm limp at the side (after it has fallen off); keeps sitting calmly; the film hides the real arm' }, (n) => {
  const P = ACTS.sitIdle({ ...n, side: 1, args: {} }), w = n.tp * 0.9 + n.seed * 3;
  P.pose.shR = [0.03, 0, 0.62 + 0.01 * Math.sin(w)]; P.pose.elR = [-0.06, 0, 0.1]; P.roll += 0.02; return P;
});

// ================================================================== OTHERS
def('shy', { g: 'other', args: 'travel (max metres to advance, default unlimited); scale', doc: 'the last zombie: two small shuffling steps, stops, hides half the face behind the R arm, peeks, lowers it, shuffles again.  The advance is in P.dz (0.56 m per 5.6 s cycle): do not also walk the base' }, (n) => {
  const T = 5.6, cyc = Math.floor(n.tp / T), t0 = n.tp - cyc * T, per = 0.56, cap = n.args.travel ?? Infinity;
  const wk = clamp(t0 / 1.5), half = wk < 0.5 ? 0.5 * smooth(wk / 0.5) : 0.5 + 0.5 * smooth((wk - 0.5) / 0.5);
  const dzTot = per * (cyc + half), walking = t0 < 1.5 && (per * cyc) < cap - 1e-6 && dzTot < cap - 1e-6, dz = Math.min(dzTot, cap);
  const sc = wk * TAU, sn = Math.sin(sc), w = n.tp * 1.7 + n.seed * 6;
  const clasp = { ...bellyR, ...bellyL };
  const walk = rec({ ...clasp, head: [0.36 + (walking ? 0.05 * Math.cos(sc * 2) : 0), (walking ? 0.1 * sn : 0), 0.1], body: [0.2, 0, 0], legL: [walking ? -0.26 * sn : -0.03, 0, 0.07], legR: [walking ? 0.26 * sn : 0.03, 0, -0.07] }, { dy: walking ? -0.012 * Math.abs(sn) : 0, roll: walking ? 0.03 * sn : 0, face: { emote: 'shy', look: [0.2, -0.4] } });
  const hide = rec({ shR: [-1.81, 0, -0.12], elR: [-0.86, 0, -0.13], shL: [-0.55, 0, 0.05], elL: [-1.33, 0, 0.42], head: [0.22, -0.5, 0.12], body: [0.16, 0.16, 0], legL: [-0.03, 0, 0.09], legR: [0.03, 0, -0.09] }, { yaw: 0.28, roll: 0.03 * Math.sin(w), face: { emote: 'shy', look: [-0.6, -0.2] } });
  const peek = rec({ shR: [-1.72, 0, -0.14], elR: [-0.92, 0, -0.13], shL: [-0.55, 0, 0.05], elL: [-1.33, 0, 0.42], head: [0.02, 0.05, 0.2], body: [0.1, 0.06, 0], legL: [-0.03, 0, 0.09], legR: [0.03, 0, -0.09] }, { yaw: 0.16, dy: 0.012 * Math.max(0, Math.sin(w * 2)), face: { emote: 'shy', look: [0.7, 0.45] } });
  const low = rec({ ...clasp, head: [0.22, 0.1, 0.12], body: [0.12, 0, 0], legL: [-0.03, 0, 0.07], legR: [0.03, 0, -0.07] }, { yaw: 0.05, face: { emote: 'shy', look: [0.5, 0.2] } });
  const P = track([[0, walk], [1.5, walk, 'lin'], [1.9, low, 'io'], [2.5, hide, 'snap'], [3.1, hide, 'lin'], [3.35, peek, 'io'], [4.3, peek, 'lin'], [4.85, low, 'io'], [5.3, low, 'lin'], [5.6, walk, 'io']], t0);
  P.dz = dz; return P;
});

def('gasp', { g: 'other', dur: 1.4, args: 'dur', doc: 'a sharp inhale: hands fly to the mouth, head back, up on the toes, holds wide-eyed, sinks' }, (n) => {
  const idle = rec({ ...bellyR, ...bellyL, head: [0.05, 0, 0] });
  const hit = rec({ ...mouthR, ...mouthL, head: [-0.24, 0, 0], body: [-0.12, 0, 0], legL: [0, 0, -0.05], legR: [0.08, 0, 0.05] }, { dy: 0.05, sq: 0.05, dz: -0.03, face: { emote: 'gasp', mouth: 0.5 } });
  const rel = rec({ ...mouthR, ...mouthL, head: [-0.1, 0, 0.05], body: [-0.05, 0, 0], legL: [0, 0, -0.05], legR: [0.04, 0, 0.05] }, { dy: 0.01, face: { emote: 'gasp', mouth: 0.25 } });
  return track([[0, idle], [0.09, hit, 'snap'], [0.6, hit, 'lin'], [1, rel, 'io']], n.kp);
});

const armDir = (d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1, u = [d[0] / l, d[1] / l, d[2] / l], z = Math.asin(clamp(u[0], -1, 1)); return [Math.atan2(-u[2], -u[1]), 0, z]; };
def('pointAt', { g: 'other', mirror: false, args: 'target: [x, y, z] direction in the character\'s own frame (+z ahead, +x its R side, +y up); default [0.6, 0.1, 0.8]', doc: 'points a straight arm at a direction (the arm on that side), the head follows, the other hand rests; snaps out with a little overshoot' }, (n) => {
  const t = n.args.target ?? [0.6, 0.1, 0.8], right = t[0] >= 0, s = spring(n.tp, 3.6, 0.34), yawT = Math.atan2(t[0], t[2]);
  const a = armDir(t), lo = right ? [0.1, 0, 0.5] : [0.1, 0, -0.5];
  const up = (v) => [lerp(lo[0], v[0], s), 0, lerp(lo[2], v[2], s)];
  const P = rec({ [right ? 'shR' : 'shL']: up(a), [right ? 'elR' : 'elL']: [-0.06, 0, 0], [right ? 'shL' : 'shR']: [-0.2, 0, right ? -0.45 : 0.45], [right ? 'elL' : 'elR']: [-0.5, 0, 0], head: [-0.06, clamp(yawT, -1.1, 1.1) * 0.8 * s, 0], body: [0.04, 0, 0], legL: [0, 0, -0.04], legR: [0.03, 0, 0.04] },
    { yaw: clamp(yawT, -0.9, 0.9) * 0.25 * s, face: { emote: 'happy', look: [clamp(t[0], -1, 1), 0.1] } });
  return P;
});

def('bow', { g: 'other', dur: 2.2, args: 'dur', doc: 'a full bow: one hand across the belly, the other arm swept back, hold at the bottom, rise with a smile' }, (n) => {
  const up = rec({ ...chestR, shL: [-0.3, 0, -0.55], elL: [-0.3, 0, 0.05], head: [-0.1, 0, 0], legL: [0, 0, -0.04], legR: [0.02, 0, 0.04] }, { face: { emote: 'happy' } });
  const dn = rec({ shR: [-0.45, 0, 0.02], elR: [-1.55, 0, -0.4], shL: [0.75, 0, -0.55], elL: [-0.2, 0, 0.05], head: [0.5, 0, 0], body: [0.95, 0, 0], legL: [-0.08, 0, -0.04], legR: [0.22, 0, 0.06] }, { dy: -0.01, face: { emote: 'shy' } });
  const fin = rec({ ...chestR, shL: [-0.3, 0, -0.6], elL: [-0.3, 0, 0.05], head: [-0.2, 0, 0.05], body: [-0.03, 0, 0], legL: [0, 0, -0.04], legR: [0.02, 0, 0.04] }, { dy: 0.012, face: { emote: 'proud' } });
  return track([[0, up], [0.08, up, 'lin'], [0.42, dn, 'io'], [0.62, dn, 'lin'], [0.9, fin, 'back'], [1, fin, 'lin']], n.kp);
});

def('wobbleStand', { g: 'other', args: 'kick (initial push: +1 pushes the top toward +x, default = side); decay (default 3)', doc: 'a doll knocked over-centre and settling: roll and lean ring out, arms and head lag behind, small hops on the rebound' }, (n) => {
  const t = n.tp, kick = n.args.kick ?? n.side, dc = n.args.decay ?? 3, r = ring(t, 2.0, dc), r2 = ring(t - 0.09, 2.0, dc), l = ring(t, 1.6, dc * 0.9 + 0.3);
  return {
    pose: { shL: [0.3 * l, 0, -(0.55 - 0.5 * r2 * kick)], shR: [-0.3 * l, 0, 0.55 + 0.5 * r2 * kick], elL: [-0.2, 0, 0.1], elR: [-0.2, 0, -0.1], head: [0.2 * l, 0.15 * r2 * kick, 0.3 * ring(t - 0.15, 2.0, dc) * kick], body: [0, 0.1 * r2, 0], legL: [0.1 * r, 0, -0.06], legR: [-0.1 * r, 0, 0.06] },
    roll: -0.3 * r * kick, lean: 0.1 * l, dy: 0.02 * Math.abs(ring(t, 2.0, dc)) * (t < 0.6 ? 1 : 0), dx: 0.05 * r * kick, face: { emote: 'awe' },
  };
});

// ================================================================== small extras the story needs
def('pipOpenDoor', { g: 'pip', dur: 2.6, args: 'dur', doc: 'unlatches a door and pulls it open: hand to the latch, a tentative pull, steps back as it swings, then holds the handle; head lifts, gulp' }, (n) => {
  const idle = rec({ ...bellyR, ...bellyL, head: [0.02, 0, 0] }, { face: { emote: 'worried' } });
  const reach = rec({ shR: [-1.3, 0, 0.25], elR: [-0.3, 0, -0.1], shL: [-0.5, 0, -0.35], elL: [-0.9, 0, 0.2], head: [0.05, 0.1, 0], body: [0.12, 0, 0], legL: [-0.1, 0, -0.04], legR: [0.1, 0, 0.04] }, { dz: 0.06, face: { emote: 'worried' } });
  const pull = rec({ shR: [-0.95, 0, 0.35], elR: [-0.75, 0, -0.1], shL: [-0.5, 0, -0.35], elL: [-0.9, 0, 0.2], head: [-0.02, 0.15, 0.05], body: [-0.08, 0, 0], legL: [0.14, 0, -0.04], legR: [-0.06, 0, 0.04] }, { dz: -0.1, face: { emote: 'gasp' } });
  const hold = rec({ shR: [-0.7, 0, 0.5], elR: [-0.6, 0, -0.1], shL: [-0.5, 0, -0.4], elL: [-0.9, 0, 0.2], head: [-0.06, 0.05, 0], body: [-0.05, 0, 0], legL: [0.05, 0, -0.04], legR: [0.02, 0, 0.04] }, { dz: -0.14, face: { emote: 'worried' } });
  return track([[0, idle], [0.15, idle, 'lin'], [0.35, reach, 'io'], [0.5, reach, 'lin'], [0.68, pull, 'out'], [0.85, hold, 'io'], [1, hold, 'lin']], n.kp);
});

def('pipNeedleDown', { g: 'pip', dur: 1.6, args: 'dur', doc: 'lowers the raised needle with both hands to the fabric, holds, a tiny satisfied nod; attach.handR = "needle"' }, (n) => {
  const up = rec({ shR: [-0.06, 0, 2.88], elR: [0, 0, 0.02], ...chestL, head: [-0.5, 0, 0], body: [-0.1, 0, 0], legL: [0.04, 0, -0.05], legR: [-0.05, 0, 0.05] }, { dy: 0.03, sq: 0.03, attach: { handR: 'needle' }, face: { emote: 'awe' } });
  const down = rec({ shR: [-1.3, 0, 0.22], elR: [-0.9, 0, -0.15], shL: [-1.15, 0, -0.3], elL: [-0.85, 0, 0.1], head: [0.4, 0, 0.05], body: [0.22, 0, 0], legL: [0, 0, -0.04], legR: [0.04, 0, 0.04] }, { attach: { handR: 'needle' }, face: { emote: 'neutral', look: [0, -0.6] } });
  const nod = { ...down, pose: { ...down.pose, head: [0.5, 0, 0.05] } };
  return track([[0, up], [0.5, down, 'io'], [0.75, down, 'lin'], [0.85, nod, 'out'], [1, down, 'io']], n.kp);
});

def('pipWink', { g: 'pip', args: '-', doc: 'cute head tilt and shoulder pop, one hand by the cheek; the wink arc is part of her face, emote happy' }, (n) => {
  const s = spring(n.tp, 3.4, 0.34), br = Math.sin(n.tp * 2.2);
  return { pose: { shR: [-1.47 * s, 0, 0.38], elR: [-1.49 * s, 0, 0.13], shL: [-0.3, 0, -0.55], elL: [-0.3, 0, 0.05], head: [-0.06, 0.1, -0.26 * s + 0.01 * br], body: [0, 0, 0], legL: [0, 0, -0.04], legR: [0.03, 0, 0.04] }, roll: 0.03 * s, dy: 0.012 * s, face: { emote: 'happy', look: [0, 0] } };
});
