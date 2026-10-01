// Shared by sets/sky.js (the quilt world) and sets/mall_roof.js (the roof): palette, sun geometry, math helpers,
// the patchwork painter, the "bold front" shader patch, and the sky colour ramps.  Pure helpers, no scene access.
import * as THREE from 'three';

export const PI = Math.PI, TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const sstep = (a, b, x) => smooth((x - a) / (b - a));
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function mkrng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export const hex = (c) => '#' + new THREE.Color(c).getHexString();   // note: sRGB hex of an sRGB number
export const hexs = (n) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ geometry of the world
// The finale axis: from the sewing machine (hub) toward the pedestal, about (0.58, 0.81) in (x, z).  The crane pulls out along +F0
// and ends looking back along -F0; the sun sits on the horizon a little to the right of that final view.
export const F0 = (() => { const l = Math.hypot(0.58, 0.81); return { x: 0.58 / l, z: 0.81 / l }; })();
export const H_VIEW_END = Math.atan2(-F0.x, -F0.z);                 // heading (dir = (sin h, cos h)) of the final crane view
export const SUN_HEADING = H_VIEW_END - 0.34;                        // ~24 degrees to the right of the final view (right = heading - 90 deg)
export const SUN_DIR = { x: Math.sin(SUN_HEADING), z: Math.cos(SUN_HEADING) };
export const SUN_DIST = 330;
export const SUN_ELEV = 0.05;                                      // rad: sun button centre when fully risen (about 2.9 degrees: it sits on the horizon)
export const SUN_R = 27;                                            // button radius in metres at SUN_DIST (about 4.7 degrees)
export const MOON_DIR = (() => { const v = new THREE.Vector3(-0.5, 0.8, 0.38).normalize(); return v; })();
export const MOON_R = 15;
export const QUILT = { y: -0.35, half: 350, tile: 90, block: 30, patch: 6 };
// keep-flat rectangles (buildings): x0, x1, z0, z1 (metres)
export const FLAT = [[-47, 47, -47, 47], [69, 91, -9, 9]];

// ------------------------------------------------------------------ palette (candy pastel)
export const P = {
  pink: [0xffb6d5, 0xff9ecb, 0xffc9de], hot: [0xff5fa8, 0xff2f86], lilac: [0xd9a7ff, 0xc9b6ff, 0xe6ccff], mint: [0xb6ffd6, 0xa3f0c4, 0xcdf7e0],
  sky: [0xa8e6ff, 0xbdeeff, 0x94d6f5], butter: [0xfff0a6, 0xffe066, 0xfff6c2], peach: [0xffc9a8, 0xffd9a8, 0xffb896], cream: [0xfff4e0, 0xfffaf0], coral: [0xff8a6a],
};
export const FAMILIES = [
  [P.pink[0], P.cream[0], P.mint[0], P.pink[1]],
  [P.sky[0], P.butter[0], P.cream[0], P.lilac[1]],
  [P.lilac[0], P.pink[0], P.peach[1], P.cream[0]],
  [P.mint[0], P.sky[1], P.butter[0], P.cream[1]],
  [P.peach[0], P.butter[1], P.cream[0], P.pink[2]],
  [P.sky[2], P.lilac[2], P.mint[2], P.cream[0]],
];

// ------------------------------------------------------------------ sky colours (linear THREE.Color), dawn 0 = dusk .. 1 = sunrise
const C = (h) => new THREE.Color(h);
const DUSK = { zen: C(0x241f5c), up: C(0x3f3382), mid: C(0x8a5aa6), low: C(0xe08aa4), hor: C(0xffb391) };
const DAWN = { zen: C(0xb99be0), up: C(0xe9a6cf), mid: C(0xffb9b0), low: C(0xffd2a0), hor: C(0xffe6b4) };
export function skyRamp(dawn) {
  const k = smooth(dawn), o = {};
  for (const n of ['zen', 'up', 'mid', 'low', 'hor']) o[n] = DUSK[n].clone().lerp(DAWN[n], k);
  return o;
}

// ------------------------------------------------------------------ canvas helpers
export function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function lumOf(h) { const c = new THREE.Color(h); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }

// dashed polyline on a 2d context (running stitch)
export function dashed(g, pts, dash, gap, width, col, closed = true) {
  g.save(); g.strokeStyle = col; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([dash, gap]);
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (closed) g.closePath(); g.stroke(); g.restore();
}
export function tri(g, a, b, c, col) { g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill(); }
export function heartPath(g, cx, cy, s) {
  g.beginPath(); g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.5, cy + s * 0.1, cx - s * 0.9, cy - s * 1.0, cx, cy - s * 0.35);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 1.0, cx + s * 1.5, cy + s * 0.1, cx, cy + s * 0.9); g.closePath();
}
export function starPath(g, cx, cy, ro, ri, n = 5, rot = -PI / 2) {
  g.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro, a = rot + i * PI / n; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath();
}

// ------------------------------------------------------------------ the patchwork tile
// Paints one tile of quilt: `blocks` x `blocks` large blocks, each `sub` x `sub` small patches, sashing between blocks, running stitches.
// Returns { col, hgt } canvases (colour, and a grey height map for bump: domes per patch, pinched seams).  `tileM` metres per tile.
export function paintQuilt(size, o = {}) {
  const { blocks = 3, sub = 5, tileM = 90, seed = 11, fam = FAMILIES, sash = 1.5, stitchScale = 1, hearts = true } = o;
  const col = canvas(size), hgt = canvas(size), g = col.getContext('2d'), h = hgt.getContext('2d'), R = mkrng(seed);
  const B = size / blocks, S = B / sub, pxm = size / tileM;
  g.fillStyle = hexs(P.cream[0]); g.fillRect(0, 0, size, size);
  h.fillStyle = '#3a3a3a'; h.fillRect(0, 0, size, size);
  const pick = (a) => a[Math.floor(R() * a.length) % a.length];
  const layouts = ['checker', 'pinwheel', 'diamond', 'hourglass', 'rings', 'geese', 'checker', 'pinwheel', 'diamond'];
  // a dome in the height map for a patch rectangle
  const dome = (x, y, w, hh, amp = 1) => {
    const cx = x + w / 2, cy = y + hh / 2, r = Math.hypot(w, hh) * 0.5;
    const gr = h.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(255,255,255,${0.75 * amp})`); gr.addColorStop(0.7, `rgba(150,150,150,${0.5 * amp})`); gr.addColorStop(1, 'rgba(60,60,60,0.3)');
    h.fillStyle = gr; h.fillRect(x, y, w, hh);
  };
  const quiltStitch = (x, y, s, base, kind) => {
    const dark = lumOf(base) > 0.72, sc = dark ? 'rgba(200,120,155,0.62)' : 'rgba(255,250,235,0.7)';
    const ins = s * 0.2, dsh = 0.32 * pxm * stitchScale, gap = 0.26 * pxm * stitchScale, wd = Math.max(1.6, 0.075 * pxm * stitchScale);
    if (kind === 'diamond') {
      const m = s / 2; dashed(g, [[x + m, y + ins * 1.6], [x + s - ins * 1.6, y + m], [x + m, y + s - ins * 1.6], [x + ins * 1.6, y + m]], dsh, gap, wd, sc);
      dashed(g, [[x + m, y + s * 0.36], [x + s * 0.64, y + m], [x + m, y + s * 0.64], [x + s * 0.36, y + m]], dsh, gap, wd, sc);
    } else {
      dashed(g, [[x + ins, y + ins], [x + s - ins, y + ins], [x + s - ins, y + s - ins], [x + ins, y + s - ins]], dsh, gap, wd, sc);
      if (kind === 'x') { dashed(g, [[x + ins, y + ins], [x + s - ins, y + s - ins]], dsh, gap, wd, sc, false); dashed(g, [[x + s - ins, y + ins], [x + ins, y + s - ins]], dsh, gap, wd, sc, false); }
    }
  };

  for (let bi = 0; bi < blocks; bi++) for (let bj = 0; bj < blocks; bj++) {
    const f = fam[(bi * 5 + bj * 3 + Math.floor(R() * 3)) % fam.length], lay = layouts[(bi * blocks + bj + Math.floor(R() * 2)) % layouts.length];
    const bx = bi * B, by = bj * B;
    const accent = pick([P.hot[0], P.butter[1], P.coral[0], P.lilac[0]]);
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      const x = bx + i * S, y = by + j * S, s = S;
      const c1 = f[(i + j) % 2 ? 0 : 1], c2 = f[2 + ((i * 2 + j) % 2)], c3 = f[(i + j * 2) % 4];
      const ring = Math.min(i, j, sub - 1 - i, sub - 1 - j);
      let kind = 'sq';
      if (lay === 'checker') { g.fillStyle = hexs((i + j) % 2 ? c1 : c2); g.fillRect(x, y, s, s); kind = 'sq'; if ((i * 7 + j * 3) % 11 === 0) { g.fillStyle = hexs(accent); g.fillRect(x, y, s, s); } }
      else if (lay === 'pinwheel') {
        const a = (i % 2) + 2 * (j % 2), bg = hexs(f[a % 2 ? 1 : 0]), fg = hexs(f[2 + (a % 2)]);
        g.fillStyle = bg; g.fillRect(x, y, s, s); const o2 = [[[0, 0], [s, 0], [s, s]], [[s, 0], [s, s], [0, s]], [[s, s], [0, s], [0, 0]], [[0, s], [0, 0], [s, 0]]][a];
        tri(g, [x + o2[0][0], y + o2[0][1]], [x + o2[1][0], y + o2[1][1]], [x + o2[2][0], y + o2[2][1]], fg); kind = 'x';
      } else if (lay === 'diamond') {
        g.fillStyle = hexs(ring % 2 ? f[1] : f[0]); g.fillRect(x, y, s, s); g.fillStyle = hexs((i + j) % 2 ? f[2] : f[3]);
        g.beginPath(); g.moveTo(x + s / 2, y + s * 0.08); g.lineTo(x + s * 0.92, y + s / 2); g.lineTo(x + s / 2, y + s * 0.92); g.lineTo(x + s * 0.08, y + s / 2); g.closePath(); g.fill(); kind = 'diamond';
      } else if (lay === 'hourglass') {
        g.fillStyle = hexs(f[1]); g.fillRect(x, y, s, s); const m = [x + s / 2, y + s / 2];
        tri(g, [x, y], [x + s, y], m, hexs((i + j) % 2 ? f[0] : f[2])); tri(g, [x, y + s], [x + s, y + s], m, hexs((i + j) % 2 ? f[0] : f[2])); tri(g, [x, y], [x, y + s], m, hexs((i + j) % 2 ? f[3] : f[1])); tri(g, [x + s, y], [x + s, y + s], m, hexs((i + j) % 2 ? f[3] : f[1])); kind = 'x';
      } else if (lay === 'rings') {
        g.fillStyle = hexs(f[ring % 3 === 0 ? 0 : ring % 3 === 1 ? 2 : 3]); g.fillRect(x, y, s, s); kind = 'sq';
      } else { // geese: half-square triangles pointing along rows
        g.fillStyle = hexs(f[j % 2 ? 1 : 2]); g.fillRect(x, y, s, s); tri(g, [x, y + s], [x + s, y + s], [x + s / 2, y], hexs(f[(i + j) % 2 ? 0 : 3])); kind = 'x';
      }
      // relief: one dome per small patch
      dome(x, y, s, s, lay === 'rings' && ring === 2 ? 1.2 : 1);
      quiltStitch(x, y, s, lay === 'rings' ? f[0] : f[1], kind);
    }
    // the centre of a "rings" block carries a heart, of a "diamond" block a star (patches in the shape of hearts and stars)
    if (hearts && (lay === 'rings' || lay === 'checker' || lay === 'diamond')) {
      const cx = bx + B / 2, cy = by + B / 2;
      g.fillStyle = hexs(lay === 'diamond' ? P.butter[1] : P.hot[0]); g.strokeStyle = 'rgba(255,250,235,0.95)'; g.lineWidth = 0.12 * pxm; g.setLineDash([0.4 * pxm, 0.3 * pxm]); g.lineCap = 'round';
      if (lay === 'diamond') starPath(g, cx, cy, S * 0.95, S * 0.42, 5); else heartPath(g, cx, cy - S * 0.1, S * 0.62);
      g.fill(); g.stroke(); g.setLineDash([]);
      h.fillStyle = 'rgba(255,255,255,0.35)'; h.beginPath(); h.arc(cx, cy, S * 0.8, 0, TAU); h.fill();
    }
  }
  // small seams: darker groove + cream running stitch, on the patch grid (the shader adds crisp stitches near the camera)
  const seamG = 'rgba(120,80,120,0.30)';
  g.save(); g.lineCap = 'butt';
  for (let k = 0; k <= blocks * sub; k++) {
    if (k % sub === 0) continue; const p = k * S;
    g.strokeStyle = seamG; g.lineWidth = 0.2 * pxm; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    h.strokeStyle = 'rgba(25,25,25,0.85)'; h.lineWidth = 0.34 * pxm; h.beginPath(); h.moveTo(p, 0); h.lineTo(p, size); h.moveTo(0, p); h.lineTo(size, p); h.stroke();
  }
  g.restore();
  // sashing between large blocks: wide cream strip with coral running stitches down the middle and cream stitches along both edges
  for (let k = 0; k <= blocks; k++) {
    const p = k * B, w = sash * pxm;
    for (const [horiz, off] of [[0, 0], [1, 0]]) {
      const a = horiz ? [0, p] : [p, 0], b = horiz ? [size, p] : [p, size];
      g.strokeStyle = hexs(k % 2 ? P.pink[2] : P.cream[1]); g.lineWidth = w; g.lineCap = 'butt'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      h.strokeStyle = 'rgba(235,235,235,0.95)'; h.lineWidth = w * 0.72; h.beginPath(); h.moveTo(a[0], a[1]); h.lineTo(b[0], b[1]); h.stroke();
      h.strokeStyle = 'rgba(30,30,30,0.9)'; h.lineWidth = w * 0.16; for (const s2 of [-1, 1]) { h.beginPath(); const d = s2 * w * 0.48; h.moveTo(a[0] + (horiz ? 0 : d), a[1] + (horiz ? d : 0)); h.lineTo(b[0] + (horiz ? 0 : d), b[1] + (horiz ? d : 0)); h.stroke(); }
      const dsh = 1.15 * pxm, gap = 0.75 * pxm;
      g.setLineDash([dsh, gap]); g.lineCap = 'round';
      g.strokeStyle = hexs(P.coral[0]); g.lineWidth = 0.34 * pxm; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.setLineDash([0.55 * pxm, 0.45 * pxm]); g.strokeStyle = hexs(P.hot[0]); g.lineWidth = 0.16 * pxm;
      for (const s2 of [-1, 1]) { const d = s2 * w * 0.4; g.beginPath(); g.moveTo(a[0] + (horiz ? 0 : d), a[1] + (horiz ? d : 0)); g.lineTo(b[0] + (horiz ? 0 : d), b[1] + (horiz ? d : 0)); g.stroke(); }
      g.setLineDash([]);
    }
  }
  return { col, hgt };
}

// ------------------------------------------------------------------ shader patches applied on top of stitchify()
// 1) a bold front band (the stock band is 0.2 m wide; from 100 m up it must be metres wide) that scales with FRONT.uFrontWidth
// 2) aerial haze toward the horizon colour, and a fade to haze at the edge of the world
const BAND_OLD = 'band = 1.0 - smoothstep(0.05, 0.13, abs(edge - 0.03));';
const GLOW_OLD = 'glowb = (1.0 - smoothstep(0.0, 0.55, abs(edge - 0.03))) * 0.22;';
export function boldHaze(mat, U, key = 'qb1') {
  const base = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => prevKey.call(mat) + key;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    Object.assign(sh.uniforms, { uHaze: U.haze, uHazeD: U.hazeD, uHazeK: U.hazeK });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeD, uHazeK;')
      .replace(BAND_OLD, 'float scBs = 1.0 + max(0.0, uFrontWidth - 0.55) * 3.0; band = 1.0 - smoothstep(0.05 * scBs, 0.13 * scBs, abs(edge - 0.03 * scBs));')
      .replace(GLOW_OLD, 'glowb = (1.0 - smoothstep(0.0, 0.55 * scBs, abs(edge - 0.03 * scBs))) * 0.22;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          float scD = length(vWPos - cameraPosition);
          float scH = uHazeK * (1.0 - exp(-pow(scD / uHazeD, 1.4)));
          scH = max(scH, smoothstep(250.0, 340.0, length(vWPos.xz)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(scH, 0.0, 1.0));
        }`);
  };
  mat.needsUpdate = true;
  return mat;
}

// ------------------------------------------------------------------ the pink band for cameras high above the world (a 0.55 m band is invisible from 100 m up).  R = front radius in metres
export function aerialFront(R) {
  const r = Math.max(R ?? 60, 20), k = smooth((r - 25) / 120);
  return { width: lerp(4.5, 8.0, k), noise: lerp(2.5, 6.5, k), dash: clamp(Math.round(TAU * r / lerp(8, 12, k)), 24, 720), thread: new THREE.Color(1.0, 0.36, 0.66) };
}
