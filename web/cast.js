// The cast: Pip (the designer, always alive) and the undead clientele. Pose vocabulary and simple procedural acting.
import * as THREE from 'three';
import { buildCharacter, pose } from './chars.js';
const PI = Math.PI;

export const GOWNS = [
  [0xffb6d5, 0xffd9ea, 0xffffff], [0xc9b6ff, 0xe4d9ff, 0xffffff], [0xa8e6ff, 0xd3f3ff, 0xffffff],
  [0xfff0a6, 0xfff8d6, 0xffffff], [0xb6ffd6, 0xdcffec, 0xffffff], [0xffc9a8, 0xffe3d1, 0xffffff],
];
export const ZV = [   // zombie variants: no two alike
  { skin: 0x86cf9c, skin2: 0xa9b9dd, hair: 0x8a7a96, hatKind: 'pillbox', hat: 0xff9ecb, bodice: 0xd9a7ff, patch: 0x9fe3ff, button: 0xffd45e, height: 1.0, headScale: 1.0 },
  { skin: 0xa3d1ac, skin2: 0xd2b9d8, hair: 0x6f8a7e, hatKind: 'cone', bodice: 0xff9ecb, patch: 0xffd08a, button: 0xff9ecb, height: 1.22, headScale: 0.9 },
  { skin: 0x9fcfc4, skin2: 0xb9d8c2, hair: 0x9a7f86, hatKind: 'none', bodice: 0x9fe3ff, patch: 0xb6ffd6, button: 0xa8e6ff, height: 0.8, headScale: 1.18, stuffing: true },
  { skin: 0xc0b8e0, skin2: 0xa9d4a0, hair: 0x8a7a96, hatKind: 'pillbox', hat: 0xa8e6ff, bodice: 0xffe066, patch: 0xffd08a, height: 1.05, headScale: 1.0 },
  { skin: 0xa9d4a0, skin2: 0xa9b9dd, hair: 0x6f8a7e, hatKind: 'none', bodice: 0xd9a7ff, patch: 0x9fe3ff, button: 0xffd45e, height: 1.12, headScale: 0.95, stuffing: true },
  { skin: 0xc4dc9e, skin2: 0xd2b9d8, hair: 0x9a7f86, hatKind: 'pillbox', hat: 0xd9a7ff, bodice: 0xff9ecb, patch: 0xb6ffd6, height: 0.92, headScale: 1.08 },
  { skin: 0x9fd0b8, skin2: 0xb9d8c2, hair: 0x8a7a96, hatKind: 'cone', bodice: 0xffe066, patch: 0x9fe3ff, button: 0xff9ecb, height: 1.0, headScale: 1.0, stuffing: true },
];

// A zombie with its own makeover state K.value (0 = raggedy and dead, 1 = dressed and alive)
export function makeZombie(M, i, extra = {}) {
  const K = { value: 0 };
  const v = ZV[i % ZV.length];
  const obj = buildCharacter(M, { zombie: true, uK: K, sock: 0xffffff, shoe: [0xd9a7ff, 0xff9ecb, 0xa8e6ff][i % 3], bow: [0xff6fb5, 0x8a5cff][i % 2], dress: GOWNS[i % GOWNS.length], zigHem: i % 2 === 0, ...v, ...extra });
  return { obj, K, kind: 'zombie', i };
}

export function makePip(M, extra = {}) {
  const K = { value: 1 };
  const obj = buildCharacter(M, {
    uK: K, skin: 0xf2bb95, hair: 0x4b2418, streak: 0xff4fa3, eye: 0x6a3dff, dress: [0xfff3fa, 0xffd0e8, 0xffffff], bodice: 0xff2f86, bow: 0xff2f86,
    shoe: 0xff2f86, sock: 0xffffff, sockTrim: 0xff2f86, wink: true, tape: true, scrunchie: 0xffe066, ...extra,
  });
  return { obj, K, kind: 'pip' };
}

// ---- poses -------------------------------------------------------------------------------------------
export const LIVE = { shL: [0.0, 0, -1.42], elL: [0, 0, 0.18], shR: [0.0, 0, 1.42], elR: [0, 0, -0.18], head: [-0.08, 0, 0], body: [0, 0, 0], legL: [0, 0, 0], legR: [0, 0, 0] };   // "arms stretched out wide": pride
export const DEAD = { shL: [-1.28, 0, -0.1], elL: [-0.15, 0, 0], shR: [-1.15, 0, 0.14], elR: [-0.2, 0, 0], head: [0.42, 0, 0.12], body: [0.16, 0, 0], legL: [0, 0, 0], legR: [0, 0, 0] };   // lurch

const KEYS = ['shL', 'elL', 'shR', 'elR', 'head', 'body', 'legL', 'legR'];
export function lerpPose(a, b, k) {
  const o = {};
  for (const key of KEYS) { const A = a[key] || [0, 0, 0], B = b[key] || [0, 0, 0]; o[key] = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]; }
  return o;
}
export const addPose = (p, d) => { const o = {}; for (const key of KEYS) { const A = p[key] || [0, 0, 0], D = d[key] || [0, 0, 0]; o[key] = [A[0] + D[0], A[1] + D[1], A[2] + D[2]]; } return o; };
export const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// The dead shamble: slow, stiff, dragging. t in seconds, ph a personal phase.
export function deadAct(t, ph = 0) {
  const s = Math.sin(t * 2.1 + ph), c = Math.cos(t * 2.1 + ph);
  return { pose: addPose(DEAD, { shL: [0.06 * s, 0, 0], shR: [-0.06 * s, 0, 0], head: [0.05 * c, 0.12 * s, 0.05 * s], body: [0.02 * s, 0, 0.05 * s], legL: [0.32 * s, 0, 0], legR: [-0.32 * s, 0, 0] }), bob: 0.0, sway: 0.03 * s };
}

// The alive bop: arms wide, chin up, bouncing on the beat. beat = beats elapsed (fractional).
export function liveAct(beat, ph = 0, amp = 1) {
  const b = beat + ph, f = b % 1, bounce = Math.abs(Math.sin(PI * f));
  const side = Math.sin(PI * b * 0.5);             // sway every two beats
  return { pose: addPose(LIVE, { shL: [0, 0, -0.14 * bounce * amp], shR: [0, 0, 0.14 * bounce * amp], elL: [0, 0, 0.12 * side * amp], elR: [0, 0, 0.12 * side * amp], head: [0.02 * bounce, 0.16 * side * amp, 0.13 * side * amp], body: [0, 0, 0.06 * side * amp], legL: [0.12 * bounce * amp, 0, 0], legR: [-0.12 * bounce * amp, 0, 0] }), bob: 0.06 * bounce * amp, sway: 0.05 * side * amp };
}

// Apply an act to a character record: pose + root bob/sway. base = {x,z,rotY}
export function applyAct(c, act, base) {
  pose(c.obj, act.pose);
  c.obj.position.set(base.x, (base.y || 0) + act.bob, base.z);
  c.obj.rotation.set(0, base.rotY, act.sway);
}

// makeover state from the front: 0 ahead of the thread, 1 fully sewn. `lead` = how far (m) the thread takes to climb the body.
export function makeoverK(R, dist, lead = 1.5) {
  return Math.min(1, Math.max(0, (R - dist) / lead + 0.0));
}
