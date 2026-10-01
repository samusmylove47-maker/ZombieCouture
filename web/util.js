// Small pure helpers shared by sets, shots and the film.  Everything here is a pure function of its arguments.
import * as THREE from 'three';
export const PI = Math.PI, TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeIn = (x) => Math.pow(clamp(x), 3);
export const easeInOut = smooth;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
// deterministic hash in [0,1): the ONLY source of "randomness" allowed in per-frame code (never Math.random)
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const hash2 = (a, b) => hash(a * 12.9898 + b * 78.233);
export const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
export const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// facing angle (about +y, 0 = facing +z) from point a to point b
export const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
export const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
// piecewise-linear keyframes: keys = [[t, value], ...] ascending in t; value may be a number or an array
export function keys(ks, t, ease = smooth) {
  if (t <= ks[0][0]) return ks[0][1];
  if (t >= ks[ks.length - 1][0]) return ks[ks.length - 1][1];
  let i = 0; while (ks[i + 1][0] < t) i++;
  const [t0, a] = ks[i], [t1, b] = ks[i + 1], k = ease((t - t0) / (t1 - t0));
  return Array.isArray(a) ? a.map((x, j) => lerp(x, b[j], k)) : lerp(a, b, k);
}
