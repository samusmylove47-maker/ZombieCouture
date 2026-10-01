// Second-wave shot templates: verse 2 (the atelier), pre-chorus 2 (the runway), chorus 2 (the rosette), the bridge (tea party, the arm, the sky),
// the final chorus (the finale, the crane), the outro and the end card.  Same contract as shots.js (docs/FILM_RUNTIME.md): a template is a PURE function
// of F; it names the set, the rig, who stands where doing what, the light, text / threads / props.  They add themselves to TEMPLATES.
import { clamp, lerp, smooth, smoother, hash } from '../util.js';
import { TEMPLATES, PI, TAU, cam, faceAt, faceCam, headOf, headY, kick, crowdIds, onFront, machineSlot, CROWD16 } from './shots.js';

const AT = (F, n) => F.slot('atelier.' + n);                                   // an atelier slot
const at2 = (s, dx = 0, dz = 0, rotY) => ({ x: s.x + dx, y: s.y || 0, z: s.z + dz, rotY: rotY ?? s.rotY ?? 0 });
const look = (from, to) => faceAt(from, to);
const mixAct = (F, name, over) => (a) => { const P = F.act(name, a); return { ...P, pose: { ...P.pose, ...(typeof over === 'function' ? over(a, P) : over) } }; };

// ======================================================================================= VERSE 2 (the atelier fitting room; everyone is alive now)
// One stage, eleven fast cuts on the lyric.  z0 is the zombie on the platform for the whole verse (the "star" fitting); Pip works round her.
const QUEUE = [1, 3, 4, 6, 2, 5];                                                  // who waits for a fitting, front of the line first
const waiter = (F, n, act = 'liveBop', o = {}) => F.cast('z' + QUEUE[n], AT(F, 'waitLine' + n), act, { k: 1, seed: hash(n * 3.3 + 0.4), look: F.args.gaze ?? { x: AT(F, 'platform').x, z: AT(F, 'platform').z }, lookAmt: 0.55, ...o });
const starAt = (F) => AT(F, 'platform');                                            // the zombie being fitted
const pipHem = (F, dx = 0.62, dz = 0.55) => { const P = starAt(F), q = { x: P.x + dx, z: P.z + dz }; return { x: q.x, y: P.y, z: q.z, rotY: faceAt(q, P) }; };
// Pip stands on the FLOOR beside the platform (never inside the zombie's skirt: her head is huge): dx, dz from the platform centre, facing it
const pipFloor = (F, dx = 1.2, dz = 0.3) => { const P = starAt(F), q = { x: P.x + dx, z: P.z + dz }; return { x: q.x, y: 0, z: q.z, rotY: faceAt(q, P) }; };
const jab = (tp, seed = 0, T = 1.5) => { const f = (((tp / T + seed) % 1) + 1) % 1, j = (c) => Math.max(0, Math.sin(PI * clamp((f - c) / 0.14))); return Math.max(j(0.1), j(0.3)) * (f < 0.6 ? 1 : 0); };

// fitEstablish (B, 5.7 s instrumental): the whole room in one slow dolly.  Pip pins a hem on the platform, the zombie on it preens, the queue waits and bops.
TEMPLATES.fitEstablish = (F) => ({
  set: 'atelier', light: 'atelier',
  rig: F.rig('atelier.fitWide', () => cam([76.6, 2.5, 4.6], [82.3, 1.0, -0.6], 52)),
  cast: [
    F.cast('z0', starAt(F), 'preen', { k: 1, seed: 0.2, look: 'pip', lookAmt: 0.5 }),
    F.cast('pip', pipFloor(F, F.args.pdx ?? 1.22, F.args.pdz ?? 0.32), 'pipPin', { seed: 0.3, sing: true }),
    waiter(F, 0), waiter(F, 1, 'sway'), waiter(F, 2), waiter(F, 3, 'sway'), waiter(F, 4), waiter(F, 5, 'sway'),
  ],
});

// fitMedium (B, 1.9 s, the last bar before the vocal): medium on the platform; Pip is behind the zombie with the tape round its waist, peeking out beside it.
TEMPLATES.fitMedium = (F) => {
  const P = starAt(F), A = F.args, q = { x: P.x + (A.px ?? 0.5), z: P.z + (A.pz ?? -0.52) };
  return {
    set: 'atelier', light: 'atelier',
    rig: F.rig('atelier.fitTwo', () => cam([81.4, 1.35, 4.0], [80, 1.2, 0.1], 40)),
    cast: [F.cast('z0', P, 'preen', { k: 1, seed: 0.6, look: 'cam', lookAmt: 0.6 }), F.cast('pip', { x: q.x, y: P.y, z: q.z, rotY: A.pr ?? 0.25 }, 'pipMeasure', { seed: 0.12, sing: true, look: 'cam', lookAmt: 0.4 })],
  };
};

// rackPan (A, "Old prom dress"): slow pan along the rack of tiny gowns; a small zombie reaches into it at the start and slides out of frame.
TEMPLATES.rackPan = (F) => {
  const A = F.args, R0 = AT(F, 'rackFront'), p = smoother(F.p);
  const reach = (a) => { const P = F.act('liveBop', a); return { ...P, pose: { ...P.pose, shR: [-2.3, 0, 0.18], elR: [-0.1, 0, -0.05], shL: [-0.4, 0, -0.5], head: [-0.25, 0.3, 0.05] } }; };
  const x = lerp(A.x0 ?? 2.9, A.x1 ?? 5.9, p), zc = A.zc ?? 0.2;
  return {
    set: 'atelier', light: 'atelier',
    rig: () => cam([80 + x - 0.3, A.y ?? 1.25, zc], [80 + x + 0.25, 1.1, -4.1], A.fov ?? 40),
    cast: [F.cast('z2', { x: 80 + (A.zx ?? 3.75), y: 0, z: A.zz ?? -3.25, rotY: PI + 0.15 }, reach, { k: 1, seed: 0.3 })],
  };
};

// tulleCU (A, "some tulle from the craft store"): the cutting table, the tulle unrolling, the scissors snipping on the beat, the tape measure.
TEMPLATES.tulleCU = (F) => ({
  set: 'atelier', light: 'atelier',
  rig: F.rig('atelier.tableCU', () => cam([76.3, 1.95, -0.55], [74.25, 0.99, -0.85], 36)),
  post: { band: 0.3, tilt: 2.4, focusY: 0.5 },
  cast: [],
});

// laceMacro (A, "Stitched on lace collars"): chest-height close-up of the star's collar; Pip leans in from the left, pinning the lace on.
TEMPLATES.laceMacro = (F) => {
  const P = starAt(F), A = F.args, p = smooth(F.p), q = { x: P.x + (A.px ?? -0.66), z: P.z + (A.pz ?? 0.32) };
  const collar = (a) => { const P0 = F.act('pipPin', a), j = jab(a.tp, 0.1); return { ...P0, pose: { ...P0.pose, body: [0.22, 0, 0], head: [0.1, -0.35, -0.05], shR: [-1.42 - 0.1 * j, 0, -0.1], elR: [-0.7 - 0.45 * j, 0, 0.05], shL: [-1.25, 0, 0.3], elL: [-0.7, 0, -0.1] }, dz: 0, dy: 0 }; };
  return {
    set: 'atelier', light: 'atelier',
    rig: () => cam([lerp(80.25, 80.1, p), A.y ?? 1.62, lerp(2.15, 1.85, p)], [80.0, 1.58, 0], A.fov ?? 34),
    post: { band: 0.28, tilt: 2.6, focusY: 0.5 },
    cast: [F.cast('z0', P, 'preen', { k: 1, seed: 0.9, look: 'pip', lookAmt: 0.4 }), F.cast('pip', { x: q.x, y: P.y, z: q.z, rotY: faceAt(q, P) }, collar, { seed: 0.1 })],
  };
};

// hemPinCU (A, "added a little more"): floor-level macro of the hem, pins going in, the star's shoe tapping the beat.
TEMPLATES.hemPinCU = (F) => {
  const P = starAt(F), A = F.args, p = smooth(F.p), q = { x: P.x + (A.px ?? -0.62), z: P.z + (A.pz ?? 0.3) };
  return {
    set: 'atelier', light: 'atelier',
    rig: () => cam([lerp(81.15, 80.85, p), A.y ?? 0.66, lerp(2.5, 2.2, p)], [80.0, A.ly ?? 0.8, 0.05], A.fov ?? 38),
    post: { band: 0.22, tilt: 3.0, focusY: 0.5 },
    cast: [F.cast('z0', P, 'liveBop', { k: 1, seed: 0.0, look: 'pip', lookAmt: 0.3 }), F.cast('pip', pipFloor(F, A.pdx ?? -1.22, A.pdz ?? 0.36), 'pipPin', { seed: 0.4, sing: true })],
  };
};

// swayLine (B, "They sway when I'm finished"): front-on at waist height; the platform, both podiums and the head of the queue sway, arms stretched wide.
TEMPLATES.swayLine = (F) => {
  const P = starAt(F), L = AT(F, 'platformL'), Rr = AT(F, 'platformR'), A = F.args, p = smooth(F.p), cx = 80 + lerp(A.x0 ?? 2.4, A.x1 ?? 1.7, p);
  return {
    set: 'atelier', light: 'atelier',
    rig: () => cam([cx, A.y ?? 1.05, A.z ?? 4.7], [cx, 1.0, 0], A.fov ?? 48),
    cast: [
      F.cast('z0', P, 'sway', { k: 1, seed: 0.0, look: 'cam', lookAmt: 0.5 }), F.cast('z' + QUEUE[1], L, 'sway', { k: 1, seed: 0.04, look: 'cam', lookAmt: 0.5 }), F.cast('z' + QUEUE[4], Rr, 'sway', { k: 1, seed: 0.02, look: 'cam', lookAmt: 0.5 }),
      ...[0, 1, 2].map((n) => waiter(F, n, 'sway', { seed: 0.01 * n, look: 'cam', lookAmt: 0.5 })),
    ],
  };
};

// mirrorShot (B, "arms stretched out wide"): the platform against the three-panel mirror, everyone throws their arms wide.
TEMPLATES.mirrorShot = (F) => {
  const P = starAt(F), L = AT(F, 'platformL'), Rr = AT(F, 'platformR');
  return {
    set: 'atelier', light: 'atelier',
    rig: F.rig('atelier.mirror', () => cam([81.7, 1.5, 3.5], [80, 1.3, -2.4], 46)),
    cast: [
      F.cast('z0', P, 'poseWide', { k: 1, look: 'cam', lookAmt: 0.6 }), F.cast('z' + QUEUE[1], L, 'poseWide', { k: 1, t0: 0.08, look: 'cam', lookAmt: 0.5 }), F.cast('z' + QUEUE[4], Rr, 'poseWide', { k: 1, t0: 0.16, look: 'cam', lookAmt: 0.5 }),
    ],
  };
};

// the caption pair (braaains / pride): a bust of the star on the left third, the embroidery hanging in the air to her right at the same distance, facing the lens
const captionRig = (F) => {
  const P = starAt(F), A = F.args, p = smooth(F.p), at = { x: P.x, y: P.y, z: P.z, rotY: 0 };
  const dist = A.dist ?? 3.0, fov = A.fov ?? 30, hd = headOf('z0', at);
  const cpos = [P.x + (A.cx ?? 0.55), hd[1] + (A.cy ?? -0.12), P.z + dist - 0.15 * p], look = [P.x + (A.cx ?? 0.55), hd[1] + (A.lookDy ?? -0.2), P.z];
  const tpos = [P.x + (A.tx ?? 0.98), hd[1] + (A.ty ?? 0.02), P.z + (A.tz ?? 0.55)], ry = Math.atan2(cpos[0] - tpos[0], cpos[2] - tpos[2]);
  return { at, cam: { pos: cpos, look, fov }, tpos, ry, scale: A.textScale ?? 0.36 };
};

// braainsCaption (B, "Moaning braaains"): a zombie moaning, its embroidered moan stitching itself across the frame.
TEMPLATES.braainsCaption = (F) => {
  const C = captionRig(F);
  return {
    set: 'atelier', light: 'atelier', rig: () => C.cam, post: { band: 0.24, tilt: 2.0, focusY: 0.5 },
    text: [{ id: 'braaains', p: smooth(clamp((F.u.t - 0.05) / (F.dur * 0.7))), pos: C.tpos, rotY: C.ry, scale: C.scale }],
    cast: [F.cast('z0', C.at, 'deadMoan', { k: 1, moan: true, sing: 'any', look: 'cam', lookAmt: 0.5, face: { emote: 'moan', emoteK: 0.8 } })],
  };
};

// unpickPride (B, "but I think they meant"): the seam ripper unpicks "braaains" and "pride" is stitched in its place; the moan turns into a proud grin.
TEMPLATES.unpickPride = (F) => {
  const C = captionRig(F), up = smooth(clamp(F.u.t / (F.dur * 0.5))), st = smooth(clamp((F.u.t - F.dur * 0.42) / (F.dur * 0.5)));
  return {
    set: 'atelier', light: 'atelier', rig: () => C.cam, post: { band: 0.24, tilt: 2.0, focusY: 0.5 },
    text: [{ id: 'braaains', p: 1, unpick: up, pos: C.tpos, rotY: C.ry, scale: C.scale }, { id: 'pride', p: st, pos: C.tpos, rotY: C.ry, scale: C.scale }],
    cast: [F.cast('z0', C.at, 'poseWide', { k: 1, look: 'cam', lookAmt: 0.6, face: { emote: up < 0.9 ? 'moan' : 'proud', emoteK: 1 } })],
  };
};

// prideWide (B, "pride"): the line-up stands proud, arms wide; Pip, at the left end, presents them.
TEMPLATES.prideWide = (F) => {
  const P = starAt(F), L = AT(F, 'platformL'), Rr = AT(F, 'platformR'), p = smooth(F.p), A = F.args;
  const cam0 = { x: 80 + lerp(3.4, 2.6, p), z: lerp(4.7, 4.1, p) }, pq = { x: P.x - (A.pdx ?? 2.9), z: P.z + (A.pdz ?? 1.6) };
  return {
    set: 'atelier', light: 'atelier', confetti: F.conf(0.0),
    rig: () => cam([cam0.x, 1.15, cam0.z], [80.9, 1.2, 0], 54),
    cast: [
      F.cast('z0', P, 'poseWide', { k: 1, look: 'cam', lookAmt: 0.5 }), F.cast('z' + QUEUE[1], L, 'poseWide', { k: 1, look: 'cam', lookAmt: 0.5 }), F.cast('z' + QUEUE[4], Rr, 'poseWide', { k: 1, look: 'cam', lookAmt: 0.5 }),
      ...[0, 1, 2].map((n) => waiter(F, n, 'poseWide', { look: 'cam', lookAmt: 0.5 })),
      F.cast('pip', { x: pq.x, y: 0, z: pq.z, rotY: faceAt(pq, { x: cam0.x, z: cam0.z }) - 0.2 }, 'pipPresent', { sing: true, look: 'cam', lookAmt: 0.5 }),
    ],
  };
};

// ======================================================================================= PRE-CHORUS 2 (the runway in the mall, alive)
// The catwalk is the mall_runway extension: a 12 m stem and a T, curtain and monogram at the far end, plush audience, photo pit, chasing footlights, sweeping spots.
// path(s, lane) walks a model along it (s 0..1 = curtain to the T); strut's stride follows the metres actually walked.
const RUNWAY_L = 12.0;
const rwE = (F) => F.ext('mall_runway');
const rwPath = (F, s, lane) => { const E = rwE(F); if (E) return E.path(s, lane); const p = F.at(6 + 12 * s, lane); return { x: p.x, y: 0, z: p.z, rotY: 0 }; };
const rwW = (F, x, y, z) => { const E = rwE(F); return E ? E.anchors.W(x, y, z) : F.pos(z, x, y); };
// a model striding along the stem: s0 = where she is at the shot start, speed m/s, lane -1..1 (+-0.6 m)
const strutter = (F, who, s0, lane, o = {}) => {
  const sp = o.speed ?? 1.45, d = sp * F.up, s = Math.min(o.sMax ?? 1, s0 + d / RUNWAY_L), at = rwPath(F, s, lane);
  return F.cast(who, { x: at.x, y: at.y, z: at.z, rotY: at.rotY }, 'strut', { k: 1, seed: hash(o.seed ?? (s0 * 7.7 + lane)), args: { dist: d + s0 * RUNWAY_L, hands: o.hands ?? 'hip' }, look: o.look, lookAmt: o.lookAmt ?? 0.5, sing: o.sing, face: o.face });
};
const RW_FRAME = { set: 'mall', ext: ['mall_runway'], light: 'mall_runway' };

// runwayLow (B, "No more biting, no more screams"): low tracking shot in FRONT of the line of models (three-quarter faces, skirts, the curtain and its monogram far behind);
// the camera backs away at the walking pace; the catwalk lights come up.  args.mode 'side' = alongside instead.
TEMPLATES.runwayLow = (F) => {
  const A = F.args, sp = A.speed ?? 1.45, zl = (A.z0 ?? 4.6) + sp * F.u.t, side = A.mode === 'side';           // zl = the lead model's z now
  const models = [['z1', 0, 0.55, 'swing'], ['z6', -1.55, -0.6, 'hip'], ['z0', -3.1, 0.5, 'hip'], ['z5', -4.3, -0.5, 'swing']];
  const rig = side
    ? () => ({ pos: rwW(F, A.cx ?? 2.1, A.cy ?? 0.55, zl - 1.0), look: rwW(F, -0.2, 1.0, zl - 0.5), fov: A.fov ?? 44 })
    : () => ({ pos: rwW(F, A.cx ?? 2.0, A.cy ?? 0.5, zl + (A.dz ?? 4.0)), look: rwW(F, A.lx ?? -0.15, A.ly ?? 1.2, zl - (A.ahead ?? 1.2)), fov: A.fov ?? 46 });
  return {
    ...RW_FRAME, rig,
    cast: models.map(([who, off, lane, hands], i) => strutter(F, who, ((A.z0 ?? 4.6) + off - 0.5) / RUNWAY_L, lane, { speed: sp, hands, seed: 0.13 * i + 0.2, look: 'cam', lookAmt: 0.35 })),
  };
};

// runwayHeadOn (B, "Just catwalk struts"): a long lens down the stem: the star model strides straight at the camera, two more behind her.
TEMPLATES.runwayHeadOn = (F) => {
  const A = F.args, E = rwE(F);
  return {
    ...RW_FRAME,
    rig: E ? E.rigs.headOn : () => ({ pos: rwW(F, 0.05, 1.62, 19), look: rwW(F, 0, 1.45, 6), fov: 30 }),
    cast: [strutter(F, 'z1', (A.s0 ?? 0.5), 0.0, { hands: 'hip', look: 'cam', lookAmt: 0.3, seed: 0.1 }), strutter(F, 'z6', 0.36, -1.0, { hands: 'swing', seed: 0.5 }), strutter(F, 'z0', 0.3, 1.0, { hands: 'hip', seed: 0.9 }), strutter(F, 'z4', 0.12, -0.6, { hands: 'swing', seed: 0.3 }), strutter(F, 'z3', 0.08, 0.6, { hands: 'hip', seed: 0.6 })],
  };
};

// runwayPit (B, "and fashion dreams"): from the photo pit at the T: the star strikes her pose, two models flank her, Pip (the designer) presents them from the end of the T;
// flashes pop from the pit (at most 3 a second).
TEMPLATES.runwayPit = (F) => {
  const A = F.args, E = rwE(F), END = E ? E.anchors.END : 13.3;
  const stand = (x, z, rot = 0) => { const q = E ? E.anchors.Wp(x, z) : F.at(END, x); return { x: q.x, y: 0.22, z: q.z, rotY: (E ? E.anchors.rotY : 0) + rot }; };
  const hero = stand(0, END), l = stand(-1.35, END - 0.6), r = stand(1.35, END - 0.6);
  const camW = E ? E.anchors.Wp(0.8, E.anchors.PIT_Z + 2.0) : F.at(END + 5, 0);
  const ps = stand(A.pipX ?? 2.3, END - 0.1), toward = { x: (hero.x + camW.x * 1.4) / 2.4, z: (hero.z + camW.z * 1.4) / 2.4 };      // Pip turns to the lens and her models
  const pipAt = { x: ps.x, y: 0.22, z: ps.z, rotY: faceAt(ps, toward) };
  return {
    ...RW_FRAME,
    rig: E ? E.rigs.photoPit : () => ({ pos: rwW(F, 1.0, 1.72, 18), look: rwW(F, -0.2, 1.2, 12.7), fov: 44 }),
    cast: [
      F.cast('z1', hero, 'runwayLook', { k: 1, seed: 0.2, look: 'cam', lookAmt: 0.4 }),
      F.cast('z5', l, 'runwayPose', { k: 1, seed: 0.5, t0: 0.12 }), F.cast('z3', r, 'runwayPose', { k: 1, seed: 0.8, t0: 0.24 }),
      F.cast('pip', pipAt, 'pipPresent', { sing: true, look: 'cam', lookAmt: 0.5, t0: 0.2 }),
    ],
  };
};

// the roof opens (chorus 3): 0 closed .. 1 open, piecewise on the film clock (the sunriseRoof shot swings it wide on the last "we're all beautiful" build)
const ROOF_KEYS = [[131.6, 0.12], [137.0, 0.40], [138.75, 0.92], [141.0, 1.0]];
export const roofAt = (t) => { if (t <= ROOF_KEYS[0][0]) return 0; for (let i = 1; i < ROOF_KEYS.length; i++) { const [t1, v1] = ROOF_KEYS[i], [t0, v0] = ROOF_KEYS[i - 1]; if (t <= t1) return lerp(v0, v1, smooth(clamp((t - t0) / (t1 - t0)))); } return 1; };

// ======================================================================================= twirlCU (chorus 1, "twirling": the skirt flaring, close)
// One of the five twirlers of twirlLow from a hip-height camera inside the ring; the skirt opens like a bell as she turns.
TEMPLATES.twirlCU = (F) => {
  const p = smooth(F.p), A = F.args, ctr = F.at(6.2, 0.4), ids = [0, 1, 2, 3, 4], cyc = F.beatSec() * 4;
  const ring = ids.map((i, n) => { const ang = (n / ids.length) * TAU + 0.4, pos = { x: ctr.x + Math.sin(ang) * 2.1, z: ctr.z + Math.cos(ang) * 2.1 }; return { i, n, pos, ph: (((F.u.t - n * 0.15) % cyc) + cyc) % cyc }; });
  const hero = ring[A.who ?? 1], dx = ctr.x - hero.pos.x, dz = ctr.z - hero.pos.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const d = lerp(2.3, 1.7, p), cx = hero.pos.x + ux * d + uz * 0.55, cz = hero.pos.z + uz * d - ux * 0.55;
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => cam([cx, lerp(0.6, 0.95, p), cz], [hero.pos.x, lerp(1.0, 1.2, p), hero.pos.z], 42),
    cast: ring.map((r) => F.cast('z' + r.i, { ...r.pos, y: 0, rotY: faceAt(r.pos, ctr) }, 'poseTwirl', { k: 1, seed: hash(r.n * 3.3), t0: F.u.t - r.ph, dur: cyc, args: { n: r.n } })),
  };
};

// ======================================================================================= CHORUS 2 (the whole mall is a party: the rosette, the carousel, the lockstep line, the hits)
const PEDS = (F) => F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25));
const ros = (F) => F.ext('mall_rosette');
// the pedestal's own frame: f = unit vector from the pedestal toward the hub (the cameras stand on that side), r = screen-right of a camera there looking at the pedestal;
// xz(a, b) = a m toward the hub, b m to the screen-right; w(a, b, y) the same as [x, y, z]
export const pedFrame = (F) => {
  const P = PEDS(F), d = Math.hypot(F.O.x - P.x, F.O.z - P.z) || 1, f = { x: (F.O.x - P.x) / d, z: (F.O.z - P.z) / d }, r = { x: f.z, z: -f.x };
  const xz = (a, b) => ({ x: P.x + f.x * a + r.x * b, z: P.z + f.z * a + r.z * b });
  return { P, f, r, rotY: Math.atan2(f.x, f.z), xz, w: (a, b, y = 0) => { const q = xz(a, b); return [q.x, y, q.z]; }, polar: (rad, ang, y = 0) => { const q = xz(Math.cos(ang) * rad, Math.sin(ang) * rad); return [q.x, y, q.z]; } };
};
const PARTY_ACTS = ['liveBop', 'clap', 'wave', 'cheer', 'liveBop', 'clap', 'spinArms', 'liveBop', 'wave', 'clap', 'cheer', 'liveBop', 'spinArms', 'clap', 'wave'];
const partyAct = (i, v = 2) => PARTY_ACTS[(i * 2 + v) % PARTY_ACTS.length];
// n zombies in the rosette's rings around the pedestal (Pip has the pedestal), all doing `act`; `angle` turns the rings (they counter-rotate), face 'in' | 'out' | 'tangent'
const ringCast = (F, ids, act, o = {}) => {
  const E = ros(F), n = ids.length, PF = pedFrame(F);
  const pos = E ? E.rings(n, o.angle ?? 0, { centre: false, face: o.face ?? 'in' }) : ids.map((_, i) => { const a = i / n * TAU, q = PF.xz(Math.cos(a) * 2.6, Math.sin(a) * 2.6); return { x: q.x, z: q.z, rotY: a + PI, ring: 1 + (i % 2) }; });
  return ids.map((id, i) => F.cast('z' + id, { x: pos[i].x, y: 0, z: pos[i].z, rotY: pos[i].rotY }, typeof act === 'function' ? act(id, i, pos[i]) : act, { k: 1, seed: hash(id * 2.9 + 0.3), look: o.look, lookAmt: o.lookAmt ?? 0.5, args: o.args, sing: o.sing, t0: o.t0 }));
};
// the carousel: the rings turn (neighbours the other way, at other speeds), everybody WALKS round facing along the circle, the gait phase follows the distance walked so no foot slides.
// The angle runs on the film clock, so the rings keep turning across cuts.
const RING_R = [0, 1.75, 3.3, 4.55], RING_S = [0, 1.0, 0.75, 0.55], CAR = 0.6;
const carousel = (F, ids, o = {}) => {
  const a = (o.rate ?? CAR) * F.tp, E = ros(F), pos = E ? E.rings(ids.length, a, { centre: false, face: 'tangent' }) : null;
  return ids.map((id, i) => {
    const q = pos ? pos[i] : { x: 0, z: 0, rotY: 0, ring: 1 };
    return F.cast('z' + id, { x: q.x, y: 0, z: q.z, rotY: q.rotY }, 'strut', { k: 1, seed: hash(id * 2.9 + 0.3), look: o.look ?? 'cam', lookAmt: o.lookAmt ?? 0.5, args: { dist: RING_R[q.ring] * RING_S[q.ring] * a, hands: i % 2 ? 'swing' : 'wide' } });
  });
};
const pipOnPed = (F, act = 'pipSing', o = {}) => { const P = PEDS(F); return F.cast('pip', { x: P.x, y: P.y, z: P.z, rotY: o.rotY ?? pedFrame(F).rotY }, act, { sing: true, args: { style: o.style ?? 'bright' }, look: o.look ?? 'cam', lookAmt: 0.4, ...o.extra }); };
const ROSETTE = (F, extra = {}) => ({ set: 'mall', ext: ['mall_rosette'], light: 'mall_rosette', confetti: F.conf(0.0), ...extra });

// partyWide (B, chorus 2 bar 1): from behind Pip on her pedestal the whole mall dances toward us: a fan of fifteen in mixed moves, faces to the lens, confetti; a crane down over her shoulder.
const FAN = [[2.8, -2.3], [2.7, 2.1], [4.4, -3.9], [4.5, -1.3], [4.3, 1.4], [4.6, 3.8], [6.1, -5.0], [6.2, -2.6], [6.0, 0.1], [6.3, 2.7], [6.1, 5.2], [7.8, -3.6], [7.9, -1.1], [7.7, 1.5], [8.0, 4.0]];
TEMPLATES.partyWide = (F) => {
  const PF = pedFrame(F), p = smooth(F.p), A = F.args, v = A.v ?? 2;
  const dancers = crowdIds(0, 15).map((i) => { const [a, b] = FAN[(i * 7) % 15], q = PF.xz(a, b); return F.cast('z' + i, { x: q.x, y: 0, z: q.z, rotY: faceAt(q, PF.P) + (hash(i * 1.37) - 0.5) * 0.6 }, partyAct(i, v), { k: 1, seed: hash(i * 2.1 + 0.2), look: 'cam', lookAmt: 0.45 }); });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.0), rig: () => cam(PF.w(lerp(-4.0, -2.6, p), A.cb ?? 1.5, lerp(3.2, 2.0, p)), PF.w(4.6, -0.3, lerp(1.0, 1.15, p)), A.fov ?? 54),
    cast: [pipOnPed(F, 'pipSing', { rotY: PF.rotY + (A.pr ?? 0.55) }), ...dancers],
  };
};

// rosetteTop (B, 1.4 s): straight down on the floor rosette that stitches itself on while the rings of dancers walk round; a slow spin of the picture.
TEMPLATES.rosetteTop = (F) => {
  const A = F.args, E = ros(F), draw = smooth(clamp(F.p * 1.05));
  const rig = E ? (u) => { const r = E.rigs.top(u); return { ...r, fov: A.fov ?? 50, roll: (A.roll0 ?? -0.25) + (A.roll1 ?? 0.35) * F.p }; } : () => cam(PEDS(F) ? [PEDS(F).x, 10.6, PEDS(F).z + 0.02] : [0, 10, 0], [PEDS(F).x, 0, PEDS(F).z], 50);
  return { ...ROSETTE(F, { args: { draw } }), rig, cast: [pipOnPed(F, 'pipPresent'), ...carousel(F, crowdIds(0, 15))] };
};

// petalLow (B, 1.8 s): low across the walking rings toward Pip, the petals stitched on the floor between the dancers' feet.
TEMPLATES.petalLow = (F) => {
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p), A = F.args;
  return { ...ROSETTE(F, { args: { draw: 1 } }), rig: () => cam(PF.polar(lerp(6.4, 5.5, p), lerp(-0.55, 0.12, p), lerp(0.55, 0.9, p)), [P.x, P.y + 1.25, P.z], A.fov ?? 46), cast: [pipOnPed(F, 'pipSing'), ...carousel(F, crowdIds(0, 15))] };
};

// whipRing (B, 1.5 s, comes in on a whip): the camera slides across the front of the walking rings at speed, Pip turning in the middle.
TEMPLATES.whipRing = (F) => {
  const PF = pedFrame(F), P = PF.P, k = smooth(F.p), A = F.args;
  return { ...ROSETTE(F, { args: { draw: 1 } }), rig: () => cam(PF.polar(6.7, lerp(-1.0, 1.0, k), lerp(1.55, 1.15, k)), [P.x, P.y + 1.15, P.z], A.fov ?? 44), cast: [pipOnPed(F, 'pipSing', { rotY: PF.rotY + lerp(0.5, -0.5, k) }), ...carousel(F, crowdIds(0, 15), { rate: A.rate ?? 0.75 })] };
};

// rosetteTilt (B, 1.1 s, "ribbons too"): the oblique crane over the rings; arms windmill, ribbons of confetti.
TEMPLATES.rosetteTilt = (F) => {
  const E = ros(F);
  return { ...ROSETTE(F, { args: { draw: 1 } }), rig: E ? E.rigs.topTilt : () => cam([PEDS(F).x, 7, PEDS(F).z + 6], [PEDS(F).x, 0.2, PEDS(F).z], 46), cast: [pipOnPed(F, 'pipSing'), ...ringCast(F, crowdIds(0, 15), () => 'spinArms', { angle: F.args.ang ?? 0.3 })] };
};

// lockstepFront (B, v 2 chorus 2 | v 3 the finale): a line of dancers in lockstep, marching toward the lens on the beat; the floor rosette behind them.
TEMPLATES.lockstepFront = (F) => {
  const A = F.args, v = A.v ?? 2, PF = pedFrame(F), t = F.u.t, N = v === 3 ? 9 : 7, adv = A.adv ?? 0.55;
  const a0 = A.a0 ?? 6.4, aL = a0 - adv * t, cA = aL + (A.dist ?? 5.2), row2 = v === 3;
  const order = [2, 5, 3, 0, 1, 4, 6, 3, 5].slice(0, N);
  const slots = order.map((id, i) => { const front = !row2 || i < 5, ii = row2 ? (front ? i : i - 5) : i, cnt = row2 ? (front ? 5 : 4) : N, b = (ii - (cnt - 1) / 2) * 1.12, a = aL + (front ? 0 : 1.15), q = PF.xz(a, b); return { id, x: q.x, z: q.z }; });
  return {
    set: 'mall', ext: ['mall_rosette'], light: v === 3 ? ['mall_rosette', 'mall_roof'] : 'mall_rosette', confetti: F.conf(0.0), args: { draw: 1, roof: v === 3 ? roofAt(F.t) : 0 },
    rig: () => cam(PF.w(cA, A.cb ?? 0.0, A.cy ?? 1.05), PF.w(aL, 0, A.ly ?? 1.0), A.fov ?? 44),
    cast: slots.map((s) => F.cast('z' + s.id, { x: s.x, y: 0, z: s.z, rotY: PF.rotY }, 'lockstep', { k: 1, seed: 0.5, look: 'cam', lookAmt: 0.5 })),
  };
};

// twirlRing (B, v 2 | v 3): low camera swinging round a ring of twirling dancers, Pip singing on the pedestal.
TEMPLATES.twirlRing = (F) => {
  const A = F.args, v = A.v ?? 2, PF = pedFrame(F), P = PF.P, p = smooth(F.p), n = v === 3 ? 12 : 9, ids = crowdIds(0, n), cyc = F.beatSec() * 4;
  const E = ros(F), pos = E ? E.rings(n, 0, { centre: false, face: 'in' }) : ids.map((_, i) => ({ x: P.x + Math.sin(i) * 3, z: P.z + Math.cos(i) * 3, rotY: 0 }));
  const ring = ids.map((id, i) => { const ph = (((F.u.t - i * 0.11) % cyc) + cyc) % cyc; return F.cast('z' + id, { x: pos[i].x, y: 0, z: pos[i].z, rotY: pos[i].rotY }, 'poseTwirl', { k: 1, seed: hash(id * 3.3), t0: F.u.t - ph, dur: cyc, args: { n: i } }); });
  return { ...ROSETTE(F, { args: { draw: 1, roof: v === 3 ? roofAt(F.t) : 0 }, light: v === 3 ? ['mall_rosette', 'mall_roof'] : 'mall_rosette' }), rig: () => cam(PF.polar(A.r ?? 5.6, lerp(A.a0 ?? -0.5, A.a1 ?? 0.5, p), A.h ?? 0.6), [P.x, A.ly ?? 1.1, P.z], A.fov ?? 46), cast: [pipOnPed(F, 'pipSing'), ...ring] };
};

// pipHero2 (B, v 2 | v 3): Pip on the pedestal, arms wide, the rings dancing round her; a low orbit that pushes in.  v 3 belts it.
TEMPLATES.pipHero2 = (F) => {
  const A = F.args, v = A.v ?? 2, PF = pedFrame(F), P = PF.P, p = smooth(F.p), n = v === 3 ? 15 : 12;
  return {
    ...ROSETTE(F, { args: { draw: 1, roof: v === 3 ? roofAt(F.t) : 0 }, light: v === 3 ? ['mall_rosette', 'mall_roof'] : 'mall_rosette' }),
    rig: () => cam(PF.polar(lerp(A.r0 ?? 5.8, A.r1 ?? 4.7, p), lerp(A.a0 ?? -0.55, A.a1 ?? 0.45, p), lerp(A.h0 ?? 2.3, A.h1 ?? 1.95, p)), [P.x, P.y + 1.4, P.z], A.fov ?? 38),
    cast: [pipOnPed(F, 'pipSing', { style: v === 3 ? 'belt' : 'bright' }), ...ringCast(F, crowdIds(0, n), (id) => (id % 2 ? 'poseWide' : 'cheer'), { angle: A.ang ?? 0.15, look: 'cam', lookAmt: 0.6 })],
  };
};

// bopLine (B, chorus 1 | v 2 chorus 2): a V of zombies bopping toward the lens, arms in the air on the offbeats; a low camera up close.
TEMPLATES.bopLine = (F) => {
  const A = F.args, v = A.v ?? 1, PF = pedFrame(F), t = F.u.t, adv = 0.7;
  const ids = v === 2 ? [3, 1, 5, 2, 4, 0, 6] : [2, 4, 1, 3, 5];
  const slots = ids.map((id, i) => { const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? -1 : 1), a = 5.6 + Math.abs(k) * 0.9 - adv * t, q = PF.xz(a, k * 1.15); return { id, x: q.x, z: q.z }; });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.0), rig: () => cam(PF.w(lerp(10.8, 9.8, F.p), (A.cb ?? 0.3), A.cy ?? 0.6), PF.w(4.8, 0, A.ly ?? 1.2), A.fov ?? 54),
    cast: slots.map((s, i) => F.cast('z' + s.id, { x: s.x, y: 0, z: s.z, rotY: PF.rotY }, i % 3 === 1 ? 'clap' : 'liveBop', { k: 1, seed: hash(s.id * 1.7 + i), look: 'cam', lookAmt: 0.5 })),
  };
};

// ---- the hits: Pip on the pedestal, a chevron of dancers stepped back behind her; one snap pose per beat, a new camera on every beat (eight beats in chorus 2, ten in the finale).
const CHEV = [[-0.8, 1.2], [-0.8, -1.2], [-1.6, 2.4], [-1.6, -2.4], [-2.4, 3.6], [-2.4, -3.6], [-3.2, 4.8], [-3.2, -4.8], [-4.2, 1.2], [-4.2, -1.2], [-4.8, 3.0], [-4.8, -3.0]];
const HIT_CAMS = [
  (PF, d) => cam(PF.w(6.2 - d, 0.8, 0.6), PF.w(-1.4, 0, 1.2), 40),                    // low wide from the front
  (PF, d) => cam(PF.w(4.4 - d, 2.6, 1.35), PF.w(-1.0, -0.2, 1.25), 34),                // three-quarter
  (PF, d) => cam(PF.w(3.2 - d, -0.5, 0.5), PF.w(-0.5, 0, 1.3), 38),                    // worm's eye on Pip
  (PF, d) => cam(PF.w(6.8 - d, -1.8, 2.6), PF.w(-1.5, 0, 1.0), 36),                    // high wide
  (PF, d) => cam(PF.w(2.3 - d, 0.35, 1.5), PF.w(0, 0, 1.55), 28),                      // Pip's face
  (PF, d) => cam(PF.w(-1.0, 5.6 - d, 0.45), PF.w(-1.6, 0, 1.15), 40),                  // along the V from its side
  (PF, d) => ({ pos: PF.w(-1.7, 0, 9.8 - d), look: PF.w(-2.0, 0, 0), fov: 50 }),                       // straight down on the V (an arrow pointing at the lens)
  (PF, d) => cam(PF.w(9.4 - d, 0.2, 3.0), PF.w(-2.0, 0, 1.0), 42),                     // the wide reveal
  (PF, d) => cam(PF.w(4.0 - d, -2.2, 0.8), PF.w(-1.6, 0.4, 1.3), 34),
  (PF, d) => cam(PF.w(3.0 - d, 0.6, 0.35), PF.w(-0.8, 0, 1.5), 42),
];
const hits = (F, v) => {
  const PF = pedFrame(F), nMax = v === 3 ? 9 : 7, n = clamp(F.beatNo, 0, nMax), tHit = Math.max(0, F.sinceBeatNo(n)), nd = v === 3 ? 12 : 8, ids = [1, 2, 3, 5, 0, 4, 6, 7, 8, 9, 10, 11].slice(0, nd);
  const pose = n % 4, order = v === 3 ? [0, 3, 1, 2, 5, 6, 4, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7];
  const cast = ids.map((id, i) => { const [a, b] = CHEV[i], q = PF.xz(a, b); return F.cast('z' + id, { x: q.x, y: 0, z: q.z, rotY: PF.rotY + Math.sign(b) * -0.12 }, 'poseCouture', { k: 1, seed: hash(id * 1.9), t0: F.u.t - tHit + 0.035 * i, args: { n: (pose + (i % 2)) % 4 }, look: 'cam', lookAmt: 0.6 }); });
  const cams = v === 3 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7], camFn = HIT_CAMS[cams[Math.min(n, cams.length - 1)] % HIT_CAMS.length];
  void order;
  return { ...ROSETTE(F, { args: { draw: 1, roof: v === 3 ? roofAt(F.t) : 0 }, light: v === 3 ? ['mall_rosette', 'mall_roof'] : 'mall_rosette' }), rig: () => camFn(PF, Math.min(tHit, 0.6) * 0.3), cast: [F.cast('pip', { x: PF.P.x, y: PF.P.y, z: PF.P.z, rotY: PF.rotY }, 'poseCouture', { sing: true, k: 1, t0: F.u.t - tHit, args: { n: pose }, look: 'cam', lookAmt: 0.5 }), ...cast] };
};
TEMPLATES.coutureHits2 = (F) => hits(F, 2);
TEMPLATES.coutureHits3 = (F) => hits(F, 3);

// confettiPeak (B, v 2 | v 3): a worm's-eye view of the party: the camera lies on the floor looking up past the dancers' skirts at Pip and the ceiling (v 3: the open sky), confetti everywhere.
TEMPLATES.confettiPeak = (F) => {
  const A = F.args, v = A.v ?? 2, PF = pedFrame(F), P = PF.P, p = smooth(F.p), n = v === 3 ? 12 : 9;
  const from = PF.polar(lerp(4.1, 3.4, p), lerp(0.35, -0.15, p), 0.22), to = [P.x, lerp(2.3, 3.2, p), P.z];
  return {
    ...ROSETTE(F, { args: { draw: 1, roof: v === 3 ? roofAt(F.t) : 0 }, light: v === 3 ? ['mall_rosette', 'mall_roof'] : 'mall_rosette' }),
    rig: () => cam(from, to, A.fov ?? 62),
    cast: [pipOnPed(F, v === 3 ? 'pipCheer' : 'pipSing'), ...ringCast(F, crowdIds(0, n), (id) => (id % 2 ? 'cheer' : 'hop'), { angle: A.ang ?? 0.9, args: undefined, look: 'cam', lookAmt: 0.5 })],
  };
};

// crowdCheer (B, 1.6 s): a tight group at the front, arms up, mouths open, straight at the lens from a low angle.
TEMPLATES.crowdCheer = (F) => {
  const A = F.args, PF = pedFrame(F), p = smooth(F.p), c = PF.xz(A.a ?? 5.8, 0), cam0 = PF.xz(lerp(10.9, 9.7, p), 0.3);
  const ids = [4, 0, 6, 2, 5, 3], pos = [[0, 0], [-1.05, 0.15], [1.0, 0.1], [-0.5, -1.0], [0.55, -1.05], [-1.7, -0.9]];
  const cast = ids.map((id, i) => { const q = PF.xz((A.a ?? 5.8) + pos[i][1] * -1.0, pos[i][0]); return F.cast('z' + id, { x: q.x, y: 0, z: q.z, rotY: faceAt(q, { x: cam0.x, z: cam0.z }) }, i % 3 === 2 ? 'wave' : 'cheer', { k: 1, seed: hash(id * 2.7), look: 'cam', lookAmt: 0.7 }); });
  void c;
  return { set: 'mall', light: 'mall', confetti: F.conf(0.0), rig: () => cam([cam0.x, lerp(0.55, 0.85, p), cam0.z], PF.w(A.a ?? 5.8, 0, 1.35), A.fov ?? 36), cast };
};

// adorableWide v 2 (B, 1.2 s): the horseshoe of dancers round Pip on the rosette, seen from a higher front angle, pushing in.
const adorable1 = TEMPLATES.adorableWide;
TEMPLATES.adorableWide = (F) => {
  if ((F.args.v ?? 1) !== 2) return adorable1(F);
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p), line = F.mall.formation?.horseshoe ? F.mall.formation.horseshoe(14) : null;
  const ent = crowdIds(0, 14).map((i) => { const s = line ? line[i] : (() => { const q = PF.xz(-3.4 * Math.cos(lerp(-1.1, 1.1, i / 13)), 4 * Math.sin(lerp(-1.1, 1.1, i / 13))); return { x: q.x, z: q.z, rotY: PF.rotY }; })(); return F.cast('z' + i, { x: s.x, y: 0, z: s.z, rotY: s.rotY }, 'poseWide', { k: 1, seed: hash(i * 2.3), t0: (i % 5) * 0.05 }); });
  return { ...ROSETTE(F, { args: { draw: 1 } }), rig: () => cam(PF.w(lerp(9.2, 7.0, p), lerp(1.4, 0.4, p), lerp(3.8, 2.9, p)), [P.x, 1.15, P.z], 44), cast: [pipOnPed(F, 'poseWide', { rotY: PF.rotY }), ...ent] };
};

// ======================================================================================= BRIDGE (the tea party: seven guests, the arm, the thread, the sky)
// Seven seats round the table in a horseshoe open toward the camera side.  Seat 6 (next to the open side) is the arm gag's zombie: her right arm pops off, rolls to the saucer,
// Pip (who has been standing beside her, hostess-fashion, since the start) picks it up and sews it back on with a bow (web/gags.js armGag; the film runtime runs it from frame.armGag).
// The gag clock is absolute (GAG_T0), so the three shots that cut it up (teaWide, armDrop, armSew) and the ones after it (threadLift, skyReveal) stay in step.
const TEA_WHO = [1, 3, 4, 5, 6, 7, 2];                                       // who sits at seat 0..6
const GAG_WHO = 'z2', GAG_T0 = 117.8, TEA_Y = 0.97;                         // the arm pops at GAG_T0 + 0.8 s = 118.6; the bow lands at GAG_T0 + 5.2 s = 123.0 (the start of threadLift)
const seatAt = (F, k) => AT(F, 'teaSeat' + k);
const gagSetup = (F, pipOff = [0.9, 0.2], extra = {}) => {
  const S = seatAt(F, 6), C = AT(F, 'platform'), s = headY(GAG_WHO) / 1.4, f = [Math.sin(S.rotY), Math.cos(S.rotY)], r = [Math.cos(S.rotY), -Math.sin(S.rotY)];
  const pip = { x: S.x + r[0] * pipOff[0] * s + f[0] * pipOff[1] * s, z: S.z + r[1] * pipOff[0] * s + f[1] * pipOff[1] * s };
  return { armGag: { who: GAG_WHO, t0: GAG_T0, saucer: { x: C.x + (S.x - C.x) * 0.44, z: S.z * 0.44 }, pip, tableY: TEA_Y, z1: 0.58, z2: 0.66, sewDist: 0.5, pickDist: 0.42, ...extra }, pip: { x: pip.x, y: 0, z: pip.z, rotY: faceAt(pip, S) } };
};
const GUEST_ACTS = ['sitSip', 'sitLaugh', 'sitLean', 'sitPassCup', 'sitIdle', 'sitSip'];
const teaGuests = (F, o = {}) => [
  ...TEA_WHO.slice(0, 6).map((id, k) => F.cast('z' + id, seatAt(F, k), o.acts?.[k] ?? GUEST_ACTS[k], { k: 1, seed: hash(k * 2.9 + 0.7), look: o.look ?? 'pip', lookAmt: 0.55, t0: -k * 0.35 })),
  F.cast(GAG_WHO, seatAt(F, 6), 'sitIdle', { k: 1, seed: 0.37, look: o.look ?? 'pip', lookAmt: 0.5, keepNear: true }),
];
const TEA = (F, extra = {}) => ({ set: 'atelier', mode: 'tea', light: 'atelier', ...extra, args: { mode: 'tea', skylight: 0, ...(extra.args || {}) } });

// a camera across the table from seat k: `dist` m out along the line seat -> table centre (past the far seats), `side` m to the screen-right, height y, looking at the seat's shoulders (+ lookDy)
const seatRig = (F, k, dist, side, y, look = {}, fov = 30) => {
  const S = seatAt(F, k), C = AT(F, 'platform'), dx = C.x - S.x, dz = -S.z, L = Math.hypot(dx, dz) || 1, d = { x: dx / L, z: dz / L }, rt = { x: -d.z, z: d.x };
  return cam([S.x + d.x * dist + rt.x * side, y, S.z + d.z * dist + rt.z * side], [S.x + d.x * (look.fwd ?? 0) + rt.x * (look.side ?? 0), look.y ?? 1.05, S.z + d.z * (look.fwd ?? 0) + rt.z * (look.side ?? 0)], fov);
};

// teaWide (B, "We have tea parties"): the whole table from the open side, candles flickering; Pip stands beside the last guest, hostess-fashion.
TEMPLATES.teaWide = (F) => {
  const p = smooth(F.p), G = gagSetup(F, F.args.pipOff ?? GAG_PIP);
  return { ...TEA(F), rig: () => cam([lerp(78.5, 78.9, p), lerp(2.55, 2.35, p), lerp(4.5, 4.1, p)], [80.1, 0.95, -0.1], 48), armGag: G.armGag, cast: [F.cast('pip', G.pip, 'pipIdle', { sing: true, seed: 0.2, args: { mood: 'kind' }, look: { x: seatAt(F, 3).x, z: seatAt(F, 3).z }, lookAmt: 0.5 }), ...teaGuests(F)] };
};

// The gag is cut in three angles: (1) armDrop from the open side (SW), where the arm is seen in profile as it pops off, lands on the table's rim and rolls to the saucer; (2) armSew and (3) armStitch from inside the
// horseshoe (NNW), where Pip's face is toward the lens.  Pip waits behind Z's seat (GAG_PIP, zombie frame: right, forward = (0.53, -0.95)), out of the SW lens, and walks in when the arm has landed.
const GAG_PIP = [0.53, -0.95];
const gagCast = (F, G, S6, pipCam) => ({ armGag: { ...G.armGag, pipCam }, cast: [F.cast('pip', G.pip, 'pipIdle', { sing: true, seed: 0.2, args: { mood: 'kind' }, look: { x: S6.x, z: S6.z }, lookAmt: 0.6 }), ...teaGuests(F, { look: { x: S6.x, z: S6.z } })] });

// armDrop (B, "make amends"): close on the last guest as her arm pops off like a cork (it flies past her chin), lands on the table's rim and rolls to the saucer; she stays perfectly unbothered.
TEMPLATES.armDrop = (F) => {
  const p = smooth(F.p), G = gagSetup(F, F.args.pipOff ?? GAG_PIP), S6 = seatAt(F, 6);
  return { ...TEA(F, { args: { seat: 6 } }), rig: () => cam([lerp(79.9, 80.05, p), lerp(2.0, 1.92, p), lerp(2.9, 2.75, p)], [81.05, 1.05, 0.7], lerp(30, 28, p)), ...gagCast(F, G, S6, [[0, 0]]) };
};

// armSew (B, "A little thread", first half): a wider cut on the same side as armDrop: Pip (winking) hurries over, stoops across the table to the arm on the saucer, lifts it and carries it back to the socket.
// (From inside the horseshoe her head fills the lens during the stoop; from this side the whole beat reads: tested 4 cameras, see docs/NEXT.md.)
TEMPLATES.armSew = (F) => {
  const p = smooth(F.p), G = gagSetup(F, F.args.pipOff ?? GAG_PIP), S6 = seatAt(F, 6);
  return { ...TEA(F, { args: { seat: 6 } }), rig: () => cam([lerp(79.2, 79.5, p), lerp(2.2, 2.0, p), lerp(3.5, 3.2, p)], [lerp(81.2, 81.15, p), lerp(0.95, 1.0, p), 0.8], lerp(40, 34, p)), ...gagCast(F, G, S6, [[2.0, 0.5], [2.6, 0.75], [4.0, 0.75]]) };
};

// armStitch (B, "a little love"): a two-shot from high on the far side of the table (the camera looks down over the tea things): Z faces us, Pip stands behind her shoulder, winking, stitching;
// the bow pops and sparkles at the last frames.  (Every camera lower than this, or on the open side, is filled by Pip's head or Z's own: tested from 9 positions, see docs/NEXT.md.)
TEMPLATES.armStitch = (F) => {
  const p = smooth(F.p), G = gagSetup(F, F.args.pipOff ?? GAG_PIP), S6 = seatAt(F, 6);
  return { ...TEA(F, { args: { seat: 6 } }), rig: () => cam([lerp(79.8, 79.6, p), 2.35, lerp(0.7, 0.55, p)], [81.3, 1.05, lerp(0.75, 0.8, p)], lerp(32, 30, p)), ...gagCast(F, G, S6, [[3.4, 0.7], [5.6, 0.7]]) };
};

// ---- the thread of light (threadLift, skyReveal): it leaves the needle Pip holds up, climbs through the ceiling (the skylight slides open as it arrives) and on into the sky
const SKY_C = { x: 80, z: 0 };                                                                // the skylight's centre
const sockOf = (S) => ({ x: S.x + Math.cos(S.rotY) * 0.12 - Math.sin(S.rotY) * 0.023, z: S.z - Math.sin(S.rotY) * 0.12 - Math.cos(S.rotY) * 0.023 });      // the gag zombie's shoulder joint (scale 0.8)
// Pip after the repair, at her rest spot facing Z's shoulder, raises her right hand with the needle: the shoulder is 0.165 to her right and 1.115 up, the arm reaches 0.43
const needleUp = (G, S) => {
  const pip = G.armGag.pip, sk = sockOf(S), yaw = Math.atan2(sk.x - pip.x, sk.z - pip.z), f = [Math.sin(yaw), Math.cos(yaw)], r = [Math.cos(yaw), -Math.sin(yaw)];
  const H = [pip.x + r[0] * 0.46 + f[0] * 0.06, 1.115 + 0.24, pip.z + r[1] * 0.46 + f[1] * 0.06];       // out to her right, beside her (huge) head, not in front of it: 0.39 m from the shoulder
  return { H, tip: [H[0], H[1] + 0.13, H[2]] };
};
const LIFT_Y = [0, 0.35, 0.75, 1.25, 1.8, 2.4, 3.0, 3.7, 4.8, 7.4, 14.4, 38.4];              // heights above the needle tip of the 12 knots (index i of 11 = the reveal fraction i/11)
const LIFT_TOP = 7;                                                                           // knot 7 is just under the ceiling: reveal 7/11 = the tip at the skylight
const liftPts = (tip) => LIFT_Y.map((dy, i) => {
  const y = tip[1] + dy, h = smooth(clamp(dy / LIFT_Y[LIFT_TOP])), sway = 0.06 * Math.sin(i * 1.3) * Math.min(1, i / 4);
  return [lerp(tip[0], SKY_C.x + 0.55, h) + sway, y, lerp(tip[2], SKY_C.z - 0.3, h) - sway];
});
const U_NEEDLE = 6.5, U_RAISE = [6.05, 6.85];                                                 // gag clock: Pip starts to raise her hand at 6.05, the needle is there at 6.5

// threadLift (B, "Turns the end of days", 4.3 s): opens on the repair (bow, sparkles, Z's nod; Pip steps back), Pip raises the needle, a thread of light lifts from its tip toward the ceiling; the camera follows it
// up (the last frame is the first frame of skyReveal's rig) as the skylight slides open and the room floods with dawn light.  The gag clock (GAG_T0) runs on, so the bow and the seam stay on Z.
TEMPLATES.threadLift = (F) => {
  const t = F.u.t, G = gagSetup(F, F.args.pipOff ?? GAG_PIP), S6 = seatAt(F, 6), N = needleUp(G, S6), K = (a) => smoother(clamp(a));
  const reveal = (LIFT_TOP / 11) * K((t - 1.35) / 1.95), sky = smooth(clamp((t - 1.7) / 2.5));
  const A = { pos: [79.6, 2.35, 0.55], look: [81.3, 1.05, 0.8], fov: 30 }, B = { pos: [80.4, 1.55, 1.95], look: [N.tip[0] - 0.1, N.tip[1] + 0.2, N.tip[2] - 0.05], fov: 42 }, C = { pos: [80.9, 1.6, 1.4], look: [80, 7.6, 0], fov: 52 };
  const e1 = K((t - 0.8) / 1.3), e2 = K((t - 1.9) / 2.4), mixv = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
  const pick = (k) => { const ab = { pos: mixv(A.pos, B.pos, e1), look: mixv(A.look, B.look, e1), fov: lerp(A.fov, B.fov, e1) }; return mixv([...ab.pos, ...ab.look, ab.fov], [...C.pos, ...C.look, C.fov], k); };
  const rigv = pick(e2);
  const armGag = {
    ...G.armGag, pipCam: [[3.4, 0.7], [5.6, 0.0]],
    pipHand: (u, g) => (u < U_RAISE[0] ? (u < 5.15 ? g.pipHand : [g.arm.pos[0], g.arm.pos[1] + 0.08, g.arm.pos[2]]) : N.H),
    pipHandK: (u) => (u < 5.15 ? 1 : u < 5.75 ? 1 - smooth((u - 5.15) / 0.6) : u < U_RAISE[0] ? 0 : smooth((u - U_RAISE[0]) / (U_RAISE[1] - U_RAISE[0]))),
    pipHeadX: (u) => -0.5 * smooth((u - 6.3) / 0.8),
    needle: (u) => (u >= U_NEEDLE ? { visible: true, pos: N.tip, dir: [0.05, 1, -0.05], scale: smooth((u - U_NEEDLE) / 0.25) } : null),
  };
  return {
    ...TEA(F, { args: { seat: 6, skylight: sky, dawn: lerp(0.08, 0.5, sky) }, also: ['sky'] }),
    rig: () => ({ pos: rigv.slice(0, 3), look: rigv.slice(3, 6), fov: rigv[6] }),
    armGag, threads: [{ id: 'lift', pts: liftPts(N.tip), reveal }],
    cast: [F.cast('pip', G.pip, 'pipIdle', { sing: true, seed: 0.2, args: { mood: 'kind' }, look: { x: S6.x, z: S6.z }, lookAmt: 0.6, face: { emote: 'happy', emoteK: 0.9 } }), ...teaGuests(F, { look: { x: S6.x, z: S6.z } })],
  };
};

// skyReveal (C, "above", 4.3 s): the camera rises from the table through the open skylight (atelier.skyRise) to the dusk sky over the atelier roof, with the thread of light rising beside it and on into the sky; the dusk turns
// toward dawn.  Nobody is in frame (everyone is below it), so the cast is empty.
TEMPLATES.skyReveal = (F) => {
  const G = gagSetup(F, F.args.pipOff ?? GAG_PIP), S6 = seatAt(F, 6), N = needleUp(G, S6), p = F.p, K = (a) => smoother(clamp(a));
  return {
    ...TEA(F, { args: { seat: 6, skylight: 1, dawn: lerp(0.5, 0.82, smooth(p)) }, also: ['sky'] }),
    rig: () => {       // rises along the thread through the open skylight and levels out over the roof to the horizon: never points down (atelier.skyRise would stare at the table for a second)
      const e = K(p), early = K(p / 0.45), late = K((p - 0.5) / 0.5), y = lerp(1.6, 9.4, e), pitch = lerp(75.4, -9, K((p - 0.08) / 0.72)) * PI / 180;
      const pos = [lerp(80.9, 80.0, early), y, lerp(1.4, 0.15, early) + 6.0 * late], hx = lerp(-0.54, -0.15, K(p / 0.6)), hz = -Math.sqrt(1 - hx * hx), L = 10;
      return cam(pos, [pos[0] + hx * Math.cos(pitch) * L, pos[1] + Math.sin(pitch) * L, pos[2] + hz * Math.cos(pitch) * L], lerp(52, 62, late));
    },
    post: { band: 0.55, tilt: 1.2, focusY: 0.5, bloom: 0.3 },
    threads: [{ id: 'lift', pts: liftPts(N.tip), reveal: (LIFT_TOP / 11) + (1 - LIFT_TOP / 11) * K(p / 0.75) }],
    cast: [],
  };
};

// ======================================================================================= THE FINALE (chorus 3: the roof opens on the sunrise; everyone is in the light)
// The same floor rosette and dancers as chorus 2, now under the roof that opens petal by petal (args.roof = roofAt(t)) with the sunrise key and its shaft of light on the pedestal.
// Light: mall_rosette + mall_roof.  Dancers stand behind Pip in the horseshoe (opening toward the camera) or in the rosette's rings.
const FIN = (F, extra = {}) => ROSETTE(F, { light: ['mall_rosette', 'mall_roof'], ...extra, args: { draw: 1, roof: roofAt(F.t), ...(extra.args || {}) } });
const FIN_HEAD = Math.atan2(0.58, 0.81);                                       // heading of the finale axis (hub -> pedestal -> the pull-out side): web/sets/sky_shared.js F0
const horse = (F, PF, n, act, o = {}) => {
  const line = F.mall.formation?.horseshoe ? F.mall.formation.horseshoe(n, o.toward ?? PF.xz(9, 0)) : null;
  return crowdIds(0, n).map((i) => {
    const s = line ? line[i] : (() => { const a = lerp(-1.1, 1.1, i / (n - 1)), q = PF.xz(-3.4 * Math.cos(a), 4 * Math.sin(a)); return { x: q.x, z: q.z, rotY: PF.rotY }; })();
    return F.cast('z' + i, { x: s.x, y: 0, z: s.z, rotY: s.rotY }, typeof act === 'function' ? act(i) : act, { k: 1, seed: hash(i * 2.3), t0: (i % 5) * 0.05, look: o.look ?? 'cam', lookAmt: 0.5 });
  });
};

// finaleWide (B, 1.9 s, comes in from a warm flash): the whole finale: Pip on the pedestal in the shaft of light, the horseshoe of fourteen behind her, arms wide, the roof just beginning to open; a rising push.
TEMPLATES.finaleWide = (F) => {
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p);
  return { ...FIN(F), rig: () => cam(PF.w(lerp(7.6, 5.6, p), lerp(1.3, 0.3, p), lerp(1.2, 2.2, p)), [P.x, lerp(1.5, 2.4, p), P.z], 50), cast: [pipOnPed(F, 'pipSing', { style: 'belt', rotY: PF.rotY }), ...horse(F, PF, 14, (i) => (i % 3 === 0 ? 'cheer' : 'poseWide'))] };
};

// finaleOrbit (B, 1.9 s): a slow orbit round the pedestal from low in front (the rings dance, Pip belts), rising a little.
TEMPLATES.finaleOrbit = (F) => {
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p);
  return { ...FIN(F), rig: () => cam(PF.polar(lerp(7.2, 6.4, p), lerp(-1.05, 0.5, p), lerp(1.3, 3.0, p)), [P.x, P.y + lerp(1.5, 1.3, p), P.z], 44), cast: [pipOnPed(F, 'pipSing', { style: 'belt' }), ...ringCast(F, crowdIds(0, 14), (id) => (id % 2 ? 'cheer' : 'spinArms'), { angle: 0.4, look: 'cam', lookAmt: 0.5 })] };
};

// finaleLow (B, 1.6 s): worm's-eye hero angle through the dancers' raised arms up at Pip, the open roof above her.
TEMPLATES.finaleLow = (F) => {
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p);
  return { ...FIN(F), rig: () => cam(PF.w(lerp(3.8, 3.0, p), lerp(-1.6, -0.7, p), 0.3), [P.x, P.y + lerp(1.7, 2.6, p), P.z], 56), cast: [pipOnPed(F, 'pipSing', { style: 'belt' }), ...ringCast(F, crowdIds(0, 14), 'cheer', { angle: 0.9, look: 'cam', lookAmt: 0.6 })] };
};

// sunriseRoof (B, 1.7 s, "...for the undead crew"): from the floor at the far wall, tilting up across the mall into the ceiling: the ten felt petals of the roof fold back from the hole and the sunrise comes in
// (clouds seen from below glow gold: args.cloudUnder), the shaft of light stands on the pedestal and the sign over the shops says it all.  Nobody is in frame.
TEMPLATES.sunriseRoof = (F) => {
  const E = F.ext('mall_roof'), p = smooth(F.p), A = E ? E.anchors : null, s = A ? A.sunDir : { x: 0.6, z: 0.8 }, c = A ? A.ped : PEDS(F), d = 8.5, el = lerp(42, 58, p) * PI / 180;
  const pos = [c.x - s.x * d, 1.0, c.z - s.z * d];
  return { ...FIN(F, { also: ['sky'], args: { dawn: 1, cloudUnder: 1 } }), rig: () => cam(pos, [pos[0] + s.x * Math.cos(el) * 40, pos[1] + Math.sin(el) * 40, pos[2] + s.z * Math.cos(el) * 40], 64), cast: [] };
};

// pipBelt (A, 1.3 s, "Pastel pink and lace, ribbons too!"): Pip close from slightly below, belting it, the horseshoe cheering behind her, the roof's light behind her head, confetti in front of the lens.
TEMPLATES.pipBelt = (F) => {
  const PF = pedFrame(F), P = PF.P, p = smooth(F.p), at = { x: P.x, y: P.y, z: P.z, rotY: PF.rotY };
  return {
    ...FIN(F), post: { band: 0.24, tilt: 2.4, focusY: 0.5, bloom: 0.3 },
    rig: () => faceCam('pip', at, { dist: lerp(3.0, 2.2, p), side: lerp(0.5, 0.2, p), h: 1.1, lookDy: lerp(0.18, 0.05, p), fov: 30 }),
    cast: [F.cast('pip', at, 'pipSing', { sing: true, args: { style: 'belt' }, look: 'cam', lookAmt: 0.5 }), ...horse(F, PF, 14, 'cheer')],
  };
};

// finaleTop (B, 1.5 s): straight down on the floor rosette (mall_rosette.top) under the open roof: a bright disc of sun on Pip's pedestal, the rings walking; the picture turns the other way from chorus 2's.
TEMPLATES.finaleTop = (F) => {
  const E = ros(F), P = PEDS(F);
  const rig = E ? (u) => { const r = E.rigs.top(u); return { ...r, fov: 54, roll: 0.4 - 0.7 * F.p }; } : () => cam([P.x, 10.6, P.z + 0.02], [P.x, 0, P.z], 54);
  return { ...FIN(F), rig, cast: [pipOnPed(F, 'pipCheer'), ...carousel(F, crowdIds(0, 15), { rate: 0.9 })] };
};

// craneOut (C, 6.4 s, "We're all beautiful... forevermore!"): THE shot.  From the far side of the pedestal the camera rises over the horseshoe (waving goodbye, Pip singing the last note), through the open skylight, out over the roof,
// and pulls back until the mall is a patch in an enormous quilt: the pink ring of colour spreads over the grey.  (mall_roof.craneOut; the world is NOT alive: only what the front has crossed is coloured.)
TEMPLATES.craneOut = (F) => {
  const E = F.ext('mall_roof'), PF = pedFrame(F), P = PF.P, far = { x: P.x + Math.sin(FIN_HEAD) * 12, z: P.z + Math.cos(FIN_HEAD) * 12 };
  return {
    ...FIN(F, { also: ['sky'], alive: 0, args: { roof: 1, dawn: 1 } }),
    rig: E ? E.rigs.craneOut : () => cam([P.x + Math.sin(FIN_HEAD) * 7, 3.4, P.z + Math.cos(FIN_HEAD) * 7], [P.x, 1.4, P.z], 38),
    cast: [pipOnPed(F, 'pipSing', { style: 'belt', rotY: FIN_HEAD }), ...horse(F, PF, 14, (i) => (i % 2 ? 'wave' : 'poseWide'), { toward: far })],
  };
};

// ======================================================================================= OUTRO (fading moans, machine clicks; the last zombie)
// aerialQuilt (C, 1.9 s): the crane-out lands: a slow orbit round the finished mall at 70 m (sky.orbitWorld): the mall a cake on the quilt with its roof open like a flower, the pink ring of colour at the horizon.
const skyRig = (F, name, map, fallback) => { const r = F.rig(name, fallback); return (u, c2) => r({ ...u, p: map(u.p ?? F.p) }, c2); };
TEMPLATES.aerialQuilt = (F) => ({
  ...FIN(F, { also: ['sky'], alive: 0, args: { roof: 1, dawn: 1 } }),
  rig: skyRig(F, 'sky.orbitWorld', (p) => 0.1 + 0.5 * p, () => cam([PEDS(F).x + 150, 108, PEDS(F).z + 200], [PEDS(F).x, 0, PEDS(F).z], 46)), cast: [],
});

// horizonDrift (C, 1.3 s): ground level on the quilt, a gentle glide toward the felt sun coming up over the cushion hills (sky.horizon): the postcard of the finished world.
TEMPLATES.horizonDrift = (F) => ({
  ...FIN(F, { also: ['sky'], alive: 0, args: { roof: 1, dawn: 1 } }),
  rig: skyRig(F, 'sky.horizon', (p) => 0.1 + 0.25 * p, () => cam([PEDS(F).x + 40, 2.4, PEDS(F).z - 60], [PEDS(F).x, 30, PEDS(F).z + 300], 46)), cast: [],
});

// clickCU (A, 1.4 s): close on the presser foot and needle clicking on the beat in the machine's cold light (alive 0: the lamp pool is the only warmth); the macro rig pulled back a little so the seam and the fabric read.
TEMPLATES.clickCU = (F) => {
  const E = F.ext('machine_macro'), p = F.p;
  return {
    set: 'mall', ext: ['machine_macro'], light: 'machine_macro', alive: 0, flicker: 1, args: { needle: 1, lamp: 1 }, noRoof: true,
    rig: E ? (u) => { const r = E.rigs.clickCU(u), a = r.pos, b = r.look, k = lerp(2.3, 2.0, p); return { pos: [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, b[2] + (a[2] - b[2]) * k], look: b, fov: 28 }; } : () => { const c = F.at(0.9, 0.35); return cam([c.x, 1.2, c.z], [F.O.x - 0.3, 1.05, F.O.z], 24); },
    post: { band: 0.3, tilt: 3, focusY: 0.5, bloom: 0.3 }, cast: [],
  };
};

// the last un-sewn zombie (z7) walks up the axis to Pip at the machine, shy; she waits with a kind smile.  'hold' keeps it cloth-grey in the finished world; its 'k' (0..1) is the thread climbing it from the hem.
const SHY = { who: 'z7', rad0: 2.35, lat: 0.55, travel: 0.56, len: 3.58 };
const shyCast = (F, t0 = 0, k = 0, dz = SHY.travel) => {
  const pipAt = F.at(1.05, SHY.lat), zAt = F.at(SHY.rad0, SHY.lat), zIn = F.at(SHY.rad0 - dz, SHY.lat);
  return [
    F.cast('pip', { x: pipAt.x, y: 0, z: pipAt.z, rotY: faceAt(pipAt, zAt) }, 'pipIdle', { seed: 0.3, args: { mood: 'kind' }, look: { x: zIn.x, z: zIn.z }, lookAmt: 0.7, face: { emote: 'happy', emoteK: 0.7 } }),
    F.cast(SHY.who, { x: zAt.x, y: 0, z: zAt.z, rotY: faceAt(zAt, pipAt) }, 'shy', { k, hold: true, seed: 0.41, t0, args: { travel: SHY.travel }, look: { x: pipAt.x, z: pipAt.z }, lookAmt: 0.5 }),
  ];
};
const OUTRO = (F, extra = {}) => ({ set: 'mall', light: ['mall', 'mall_roof'], alive: 0.45, ...extra, args: { roof: 1, dawn: 1, ...(extra.args || {}) } });

// shyZombie (B, 3.6 s, "Zom...bie... couture..."): profile two-shot from the open side (+lateral; the brown pillar stands on the other side of Pip's bench): the last grey zombie shuffles in from the right, hides
// half its face behind its arm, peeks; Pip waits at the machine with a kind smile.
TEMPLATES.shyZombie = (F) => {
  const p = smooth(F.p), a = F.at(lerp(1.3, 1.5, p), lerp(3.5, 3.0, p)), b = F.at(lerp(1.6, 1.65, p), SHY.lat);
  return { ...OUTRO(F), rig: () => cam([a.x, lerp(1.05, 1.0, p), a.z], [b.x, 0.9, b.z], lerp(50, 44, p)), cast: shyCast(F, 0, 0) };
};

// needleDown (B, 2.8 s, the last shot before the card): the same side, closer: she holds the needle out, one tiny stitch, and the camera sinks to the zombie's feet as the first colour comes back there.  Cut to the warm dip and the card.
TEMPLATES.needleDown = (F) => {
  const p = smooth(F.p), a = F.at(1.3, lerp(2.5, 1.55, p)), b = F.at(lerp(1.45, 1.75, p), SHY.lat);
  const k = 0.2 * smooth(clamp((F.u.t - 0.8) / 1.5));
  const pip = shyCast(F, -SHY.len, k)[0];
  return {
    ...OUTRO(F), rig: () => cam([a.x, lerp(0.9, 0.3, p), a.z], [b.x, lerp(0.85, 0.3, p), b.z], lerp(38, 30, p)), post: { band: 0.3, tilt: 2.4, focusY: 0.5, bloom: 0.25 },
    cast: [{ ...pip, act: 'pipNeedleDown', t0: 0.2, args: undefined }, shyCast(F, -SHY.len, k)[1]],
  };
};

// ======================================================================================= END CARD
// card (A): the care label stitches itself on and the credits weave in line by line (card.card: args.reveal), held for the last two seconds.
TEMPLATES.card = (F) => ({ set: 'card', light: 'card', rig: 'card.card', args: { reveal: smooth(clamp(F.u.t / Math.max(1, F.dur - 2.2))) }, cast: [] });

// ------------------------------------------------------------------------ debug: every slot of a set as a numbered zombie, seen from above (not part of the film)
TEMPLATES.__atelierPlan = (F) => {
  const names = ['platform', 'platformL', 'platformR', 'rackFront', 'tableFront', 'machine', ...[0, 1, 2, 3, 4, 5].map((i) => 'waitLine' + i), ...[0, 1, 2, 3, 4, 5, 6].map((i) => 'teaSeat' + i)];
  const c = AT(F, 'platform');
  return {
    set: 'atelier', light: 'atelier', args: F.args,
    rig: () => cam([c.x + 0.01, F.args.h ?? 5.2, c.z + 0.01], [c.x, 0, c.z], F.args.fov ?? 95),
    cast: names.map((n, i) => F.cast('z' + (i % 16), AT(F, n), 'liveBop', { k: 1 })),
  };
};
