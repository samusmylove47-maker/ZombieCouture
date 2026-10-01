// Embroidered text. The film's world is sewn, so its words are sewn too.
//
//   const Text = await buildText({ THREE, M, FRONT, root, hash, rng, quality });
//   const it = Text.item(id, { text, style: 'thread'|'satin'|'felt', color, color2, size, width, align, depth });
//   it.obj -> Group (caller parents and places it; centred on its own bounds, facing +z)
//   it.progress(p, t)   0..1 stitches in, reading order, bright leading stitch, travelling needle; p = 1 leaves the shimmering finished piece
//   it.unpick(p)        0..1 a seam ripper walks the word backwards, threads lift, curl and fall
//   it.progressWords(t, [{t0, t1}, ...])   word by word (items made with itemFromWords, or any item: words split on spaces)
//   it.setColor(c), it.setColor2(c), it.setVisible(v), it.bounds = {w, h}
//   Text.title() -> the embroidered "Zombie Couture" with rosette and parked needle
//
// 'thread' = satin-stitch fill. Each letter is rasterised, an exact distance transform gives the direction across the stroke at
// every pixel, and stitches are laid greedily from the stroke centre outwards: every stitch runs edge to edge across the stroke, on a
// slight slant, and covers a band so the next one is a pitch away. Caps fan out radially, junctions get filled by whatever is left.
// A running-stitch outline and a stitched drop-shadow line ride on top. All are InstancedMeshes: fill, outline, shadow, underlay.
//
// Everything is a pure function of (p, t): the only state kept is a record of which instances were last painted so they can be undone.
import * as THREE from 'three';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stitchify } from './stitch.js';
import { hash, clamp, smooth, lerp } from './util.js';

const PI = Math.PI;
const FONT_URL = '../assets/FredokaOne-Regular.ttf';
let _font = null;
export async function loadFont(url = FONT_URL) {
  if (_font) return _font;
  try { await document.fonts.load('64px Fredoka'); } catch (e) { /* canvas text elsewhere falls back; the outlines below do not need it */ }
  const json = await new Promise((res, rej) => new TTFLoader().load(url, res, undefined, rej));
  return (_font = new Font(json));
}

// ------------------------------------------------------------------ exact euclidean distance transform (Felzenszwalb)
function edt(inside, w, h) {
  const INF = 1e12, n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? INF : 0;
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; pass(w); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

// ------------------------------------------------------------------ satin fill of one glyph (glyph-local metres, y up)
// returns { stitches: [{x, y, ang, len, rel}], loops: [{pts, hole}], x0, y0, x1, y1 }
function satinFill(shapes, pitch, seed) {
  const loops = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const sh of shapes) {
    const { shape, holes } = sh.extractPoints(10);
    for (const [pts, hole] of [[shape, false], ...holes.map((h) => [h, true])]) {
      loops.push({ pts, hole });
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    }
  }
  if (!loops.length) return { stitches: [], loops, x0: 0, y0: 0, x1: 0, y1: 0 };
  const res = pitch / 5, MG = 4;
  const w = Math.ceil((x1 - x0) / res) + 2 * MG + 1, h = Math.ceil((y1 - y0) / res) + 2 * MG + 1;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.beginPath();
  const X = (x) => (x - x0) / res + MG, Y = (y) => (y1 - y) / res + MG;
  for (const l of loops) { l.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)))); g.closePath(); }
  g.fill('evenodd');
  const img = g.getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) inside[i] = img[i * 4] > 127 ? 1 : 0;
  const d = edt(inside, w, h);
  let rmax = 0; for (let i = 0; i < w * h; i++) if (d[i] > rmax) rmax = d[i];
  // gradient of the distance field (central differences)
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; gx[i] = d[i + 1] - d[i - 1]; gy[i] = d[i + w] - d[i - w]; }
  // candidates: inside pixels, centre of the stroke first (buckets of 1.5 px of distance, then raster order)
  const cand = []; for (let i = 0; i < w * h; i++) if (d[i] >= 1.0) cand.push(i);
  const bucket = (i) => Math.floor((rmax - d[i]) / 1.5);
  cand.sort((a, b) => (bucket(a) - bucket(b)) || (a - b));
  const cov = new Uint8Array(w * h), wc = 1.0 * pitch / res, maxHalf = 1.28 * rmax, slant = 0.2;
  const out = [], u = [0, 0];
  const reach = (px, py, ux, uy) => {
    let s = 0;
    while (s < maxHalf) { const ix = Math.round(px + ux * (s + 0.5)), iy = Math.round(py + uy * (s + 0.5)); if (ix < 0 || iy < 0 || ix >= w || iy >= h || d[iy * w + ix] < 0.5) break; s += 0.5; }
    return s;
  };
  let n = 0;
  for (const i of cand) {
    if (cov[i]) continue;
    const px = i % w, py = (i / w) | 0;
    let jxx = 0, jyy = 0, jxy = 0;                             // structure tensor: dominant direction of the distance gradient
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const j = (py + oy) * w + px + ox; if (j < 0 || j >= w * h) continue; jxx += gx[j] * gx[j]; jyy += gy[j] * gy[j]; jxy += gx[j] * gy[j]; }
    let th = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    if (jxx + jyy < 1e-4) th = 0; th += slant + (hash(seed + n * 1.7) - 0.5) * 0.07;
    u[0] = Math.cos(th); u[1] = Math.sin(th);
    const a = reach(px, py, -u[0], -u[1]), b = reach(px, py, u[0], u[1]);
    if (a + b < 1.2) { cov[i] = 1; continue; }
    const ax = px - u[0] * a, ay = py - u[1] * a, bx = px + u[0] * b, by = py + u[1] * b;
    // paint the band this stitch covers
    const r = Math.ceil(wc) + 1, minx = Math.max(0, Math.floor(Math.min(ax, bx)) - r), maxx = Math.min(w - 1, Math.ceil(Math.max(ax, bx)) + r);
    const miny = Math.max(0, Math.floor(Math.min(ay, by)) - r), maxy = Math.min(h - 1, Math.ceil(Math.max(ay, by)) + r);
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2), ex = ax + t * dx - x, ey = ay + t * dy - y;
      if (ex * ex + ey * ey <= wc * wc) cov[y * w + x] = 1;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    out.push({ x: x0 + (mx - MG) * res, y: y1 - (my - MG) * res, ang: Math.atan2(-(by - ay), bx - ax), len: (a + b) * res, rel: clamp(d[i] / rmax) });
    n++;
  }
  return { stitches: out, loops, x0, y0, x1, y1 };
}

// ------------------------------------------------------------------ polyline helpers
function loopDashes(pts, spacing) {          // evenly spaced samples on a closed polyline: [{x, y, tx, ty}]
  const n = pts.length; if (n < 3) return [];
  const cum = [0]; for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const total = cum[n]; if (total < spacing) return [];
  const k = Math.max(6, Math.round(total / spacing)), step = total / k;
  const at = (s) => {
    s = ((s % total) + total) % total; let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[(lo + 1) % n], f = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
    return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
  };
  const out = [];
  for (let j = 0; j < k; j++) {
    const s = (j + 0.5) * step, p = at(s), p0 = at(s - step * 0.3), p1 = at(s + step * 0.3);
    let tx = p1[0] - p0[0], ty = p1[1] - p0[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    out.push({ x: p[0], y: p[1], tx, ty });
  }
  return out;
}
const signedArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

// ------------------------------------------------------------------ shared geometry / small meshes
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _ax = new THREE.Vector3();
let _stitchGeo = null;
function stitchGeo() {
  if (_stitchGeo) return _stitchGeo;
  const g = new THREE.CapsuleGeometry(0.5, 1.0, 1, 6); g.rotateZ(PI / 2);       // total length 2 along x, radius 0.5
  g.scale(0.5, 1, 1);                                                              // total length 1
  return (_stitchGeo = g);
}
const K1 = { value: 1 };                       // text is never part of the dead world

function darker(c, k) { return new THREE.Color(c).multiplyScalar(k); }

// discard everything whose order key is above uP (extruded styles and the underlay)
function wipeify(mat, uP) {
  const base = mat.onBeforeCompile, key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key.call(mat) + 'wipe';
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r); sh.uniforms.uP = uP;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOrd; varying float vOrd;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOrd = aOrd;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOrd; uniform float uP;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vOrd > uP) discard;');
  };
  return mat;
}

// ------------------------------------------------------------------ the tools: a needle with a thread tail, and a seam ripper
export function makeNeedle(M, size, threadColor) {
  const prev = M.currentK; M.currentK = K1;
  const g = new THREE.Group(), L = size * 0.66, r = size * 0.026;
  const steel = stitchify(new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.16, metalness: 0.35, emissive: 0x8a93a8 }), K1);
  const gs = [];                                                                   // body, point and eye merged: one draw call
  { const gb = new THREE.CylinderGeometry(r, r * 0.9, L, 8); gb.translate(0, L * 0.5, 0); gs.push(gb);
    const gt = new THREE.ConeGeometry(r * 0.9, L * 0.16, 8); gt.rotateX(PI); gt.translate(0, -L * 0.08, 0); gs.push(gt);
    const ge = new THREE.TorusGeometry(r * 1.3, r * 0.4, 6, 12); ge.translate(0, L * 0.9, 0); gs.push(ge); }
  g.add(new THREE.Mesh(mergeGeometries(gs), steel));
  g.children.forEach((c) => { c.castShadow = false; c.receiveShadow = false; });
  // thread tail: an S-curve leaving the eye
  const tailGroup = new THREE.Group(); tailGroup.position.y = L * 0.9; g.add(tailGroup);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(size * 0.1, size * 0.22, 0.01), new THREE.Vector3(size * 0.02, size * 0.46, 0.0), new THREE.Vector3(size * 0.22, size * 0.66, -0.01), new THREE.Vector3(size * 0.34, size * 0.9, 0)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, size * 0.011, 5, false), M.thread(threadColor)); tail.castShadow = false; tailGroup.add(tail);
  g.userData = { tailGroup, tail, L };
  M.currentK = prev; return g;
}
// put a needle so that its point is at (tx, ty, tz); `lift` withdraws it along its own axis (the stab of a stitch)
export function placeNeedle(n, tx, ty, tz, ang, lift = 0) {
  const L = n.userData.L, sn = Math.sin(ang), cs = Math.cos(ang);
  n.rotation.set(0, 0, ang); n.position.set(tx - 0.16 * L * sn - sn * lift, ty + 0.16 * L * cs + cs * lift, tz);
}
let _sparkTex = null;
function sparkTex() {
  if (_sparkTex) return _sparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,250,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff';
  for (const a of [0, PI / 2]) { g.save(); g.translate(32, 32); g.rotate(a); g.beginPath(); g.moveTo(-31, 0); g.quadraticCurveTo(0, -2.2, 31, 0); g.quadraticCurveTo(0, 2.2, -31, 0); g.fill(); g.restore(); }
  _sparkTex = new THREE.CanvasTexture(c); _sparkTex.colorSpace = THREE.SRGBColorSpace; return _sparkTex;
}
function makeRipper(M, size) {
  const prev = M.currentK; M.currentK = K1;
  const g = new THREE.Group();
  const red = stitchify(new THREE.MeshStandardMaterial({ color: 0xe0344f, roughness: 0.3, emissive: 0x300810 }), K1), steel = stitchify(new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.16, metalness: 0.35, emissive: 0x8a93a8 }), K1);
  const s = size;
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(s * 0.05, s * 0.34, 4, 10), red); handle.position.y = s * 0.56;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.035, s * 0.05, s * 0.06, 12), steel); collar.position.y = s * 0.31;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.012, s * 0.012, s * 0.2, 8), steel); shaft.position.y = s * 0.2;
  const fork = new THREE.Mesh(new THREE.TorusGeometry(s * 0.05, s * 0.011, 6, 14, PI * 1.25), steel); fork.rotation.set(0, 0, PI * 0.9); fork.position.set(0, s * 0.07, 0);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(s * 0.026, 10, 8), red); ball.position.set(s * 0.045, s * 0.035, 0);
  // the hand crank on top: a small arm with a knob that orbits
  const crank = new THREE.Group(); crank.position.y = s * 0.78;
  const armM = new THREE.Mesh(new THREE.BoxGeometry(s * 0.16, s * 0.022, s * 0.022), steel); armM.position.x = s * 0.06;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(s * 0.03, 10, 8), stitchify(new THREE.MeshStandardMaterial({ color: 0xffd45e, roughness: 0.3, emissive: 0x403000 }), K1)); knob.position.set(s * 0.14, s * 0.03, 0);
  crank.add(armM, knob);
  g.add(handle, collar, shaft, fork, ball, crank);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  g.userData = { crank };
  M.currentK = prev; return g;
}

// ================================================================== buildText
export async function buildText(ctx) {
  const { M } = ctx;
  const font = await loadFont(ctx.fontUrl);
  const root = ctx.root || new THREE.Group();
  const Hb = new THREE.Box2();
  { const pts = font.generateShapes('H', 1)[0].getPoints(8); Hb.setFromPoints(pts); }
  const CAP = Hb.max.y - Hb.min.y || 0.7;                           // cap height / em
  const glyphs = font.data.glyphs, RES = font.data.resolution;
  const fillCache = new Map();
  const T = { font, root, items: new Map(), CAP };

  function layout(text, size, width, align, lineGap) {
    const em = size / CAP, sc = em / RES, adv = (c) => ((glyphs[c] || glyphs['?'] || { ha: RES * 0.5 }).ha) * sc;
    const lines = []; let wordIdx = 0;
    for (const raw of text.split('\n')) {
      const words = raw.split(' ').filter((s) => s.length);
      let cur = { glyphs: [], width: 0 };
      words.forEach((wd, wi) => {
        const ww = [...wd].reduce((a, c) => a + adv(c), 0), sp = adv(' ');
        if (cur.glyphs.length && cur.width + sp + ww > width) { lines.push(cur); cur = { glyphs: [], width: 0 }; }
        if (cur.glyphs.length) cur.width += sp;
        for (const c of wd) { cur.glyphs.push({ ch: c, x: cur.width, w: wordIdx }); cur.width += adv(c); }
        wordIdx++;
      });
      lines.push(cur);
    }
    const step = size * lineGap, W = Math.max(...lines.map((l) => l.width)), Ht = size + (lines.length - 1) * step;
    lines.forEach((l, k) => { l.x0 = align === 'left' ? -W / 2 : -l.width / 2; l.base = Ht / 2 - size - k * step; });
    return { lines, W, H: Ht, em, nWords: wordIdx };
  }

  // -------------------------------------------------------------- one item
  function makeItem(id, spec, wordList) {
    const S = {
      text: spec.text ?? (wordList ? wordList.join(' ') : ''), style: spec.style ?? 'thread', color: spec.color ?? 0xff5fa8, color2: spec.color2 ?? 0xfff4e0,
      shadowColor: spec.shadowColor, size: spec.size ?? 0.5, width: spec.width ?? 1e9, align: spec.align ?? 'center', depth: spec.depth,
      lineGap: spec.lineGap ?? 1.32, flourish: !!spec.flourish, pitchK: spec.pitch ?? (spec.style === 'felt' ? 0.05 : spec.style === 'satin' ? 0.045 : ctx.quality === 'lite' ? 0.04 : 0.03), outline: spec.outline ?? true, shadow: spec.shadow ?? true, seed: spec.seed ?? hash(id.length * 3.1 + (id.charCodeAt(0) || 1)),
    };
    const size = S.size, pitch = size * S.pitchK, style = S.style;
    const L = layout(S.text, size, S.width, S.align, S.lineGap);
    const obj = new THREE.Group(); obj.name = 'text:' + id;
    const bounds = { w: L.W, h: L.H };
    // ---- letters: shapes, fills, contours
    const letters = [];
    L.lines.forEach((ln, li) => ln.glyphs.forEach((gl) => {
      if (gl.ch === ' ') return;
      const key = gl.ch + '|' + L.em.toFixed(4) + '|' + pitch.toFixed(5);
      const shapes = font.generateShapes(gl.ch, L.em); if (!shapes.length) return;
      let f = fillCache.get(key);
      if (!f && style === 'thread') { f = satinFill(shapes, pitch, hash(gl.ch.charCodeAt(0))); fillCache.set(key, f); }
      const loops = f ? f.loops : shapes.flatMap((sh) => { const e = sh.extractPoints(10); return [{ pts: e.shape, hole: false }, ...e.holes.map((h) => ({ pts: h, hole: true }))]; });
      const bb = new THREE.Box2(); loops.forEach((l) => l.pts.forEach((p) => bb.expandByPoint(p)));
      letters.push({ ch: gl.ch, ox: ln.x0 + gl.x, oy: ln.base, w: gl.w, shapes, fill: f, loops, bb, idx: letters.length });
    }));
    const nL = letters.length;
    const wordLetters = []; letters.forEach((l) => { (wordLetters[l.w] ||= []).push(l.idx); });

    // ---- stitch lists (each entry: position, angle, length, thickness, role)
    const fill = [], outl = [], shad = [], lstart = { fill: [], outl: [], shad: [] };
    const dThread = pitch * 1.28, dOut = pitch * 1.12, lenOut = pitch * 2.7, spOut = pitch * 3.4;
    const shOff = [size * 0.05, -size * 0.062];
    letters.forEach((lt) => {
      lstart.fill.push(fill.length); lstart.outl.push(outl.length); lstart.shad.push(shad.length);
      if (style === 'thread') {
        const bw = lt.bb.max.x - lt.bb.min.x || 1, bh = lt.bb.max.y - lt.bb.min.y || 1;
        const rows = lt.fill.stitches.map((s, i) => {
          const key = 0.62 * ((s.x - lt.bb.min.x) / bw) + 0.38 * (1 - (s.y - lt.bb.min.y) / bh) + hash(i * 1.37 + lt.idx) * 0.04;
          return { s, key };
        }).sort((a, b) => a.key - b.key);
        rows.forEach(({ s }, i) => {
          const j = hash(lt.idx * 91.7 + i * 3.13);
          fill.push({ x: lt.ox + s.x, y: lt.oy + s.y, z: dThread * (0.28 + 0.32 * s.rel) + (j - 0.5) * dThread * 0.12, ang: s.ang, len: s.len + dThread * (0.35 + 0.2 * j), th: dThread * (0.92 + 0.22 * hash(i + lt.idx * 7.7)), tilt: (hash(i * 5.1 + lt.idx) - 0.5) * 0.5, role: 0, x0: lt.ox, key: 0 });
        });
      }
      const wob = style === 'thread' ? 1 : 0;
      for (const lp of lt.loops) {
        const dashes = loopDashes(lp.pts, style === 'thread' ? spOut : pitch * 2.6);
        const area = signedArea(lp.pts), inward = (lp.hole ? -1 : 1) * (area > 0 ? 1 : -1);   // +1: left normal points into the material
        dashes.forEach((dsh, i) => {
          const ang = Math.atan2(dsh.ty, dsh.tx), j = hash(lt.idx * 13.3 + i * 0.77 + wob);
          if (style === 'thread' || style === 'satin') {
            const inset = style === 'satin' ? size * 0.075 : 0;
            const nx = -dsh.ty * inward, ny = dsh.tx * inward;
            if (style !== 'thread' || S.outline) outl.push({ x: lt.ox + dsh.x + nx * inset, y: lt.oy + dsh.y + ny * inset, z: style === 'thread' ? dThread * 0.78 : size * 0.155, ang, len: lenOut * (0.92 + 0.16 * j), th: dOut, tilt: 0, role: 1 });
            if (style === 'thread' && S.shadow) shad.push({ x: lt.ox + dsh.x + shOff[0], y: lt.oy + dsh.y + shOff[1], z: dThread * 0.2, ang, len: lenOut * (0.96 + 0.16 * j), th: dOut * 1.3, tilt: 0, role: 2 });
          } else {                                    // felt: blanket stitch, a tick across the edge
            const nx = -dsh.ty * inward, ny = dsh.tx * inward, tl = pitch * 2.5;
            outl.push({ x: lt.ox + dsh.x + nx * tl * 0.28, y: lt.oy + dsh.y + ny * tl * 0.28, z: size * 0.105, ang: Math.atan2(ny, nx) + (j - 0.5) * 0.25, len: tl, th: pitch * 0.72, tilt: 0, role: 1 });
          }
        });
      }
    });
    // ---- flourish (title): rosette and two swash lines below the text
    let park = null;
    if (S.flourish) {
      lstart.fill.push(fill.length); lstart.outl.push(outl.length); lstart.shad.push(shad.length);
      const cy = -L.H / 2 - size * 0.66, R0 = size * 0.30, add = (arr, o) => arr.push(o);
      const rings = [[0.04, 0.12, 9, 2], [0.12, 0.22, 16, 0], [0.22, 0.31, 24, 0]];
      rings.forEach(([r0, r1, n, role], ri) => { for (let k = 0; k < n; k++) {
        const a = (k + (ri % 2) * 0.5) / n * PI * 2, rc = (r0 + r1) / 2 * size * (R0 / (size * 0.30));
        add(fill, { x: Math.cos(a) * rc, y: cy + Math.sin(a) * rc, z: dThread * 0.5, ang: a, len: (r1 - r0) * size * 1.06 + dThread * 0.3, th: dThread * (ri === 0 ? 1.15 : 1.0), tilt: (hash(k + ri * 40) - 0.5) * 0.4, role });
      } });
      add(fill, { x: 0, y: cy, z: dThread * 0.9, ang: 0, len: dThread * 1.1, th: dThread * 1.5, tilt: 0, role: 3 });
      // swashes: dashed wave from the rosette out to each side
      for (const sgn of [-1, 1]) {
        const x0 = sgn * size * 0.46, x1 = sgn * (L.W * 0.5 - size * 0.05), N = Math.max(8, Math.round(Math.abs(x1 - x0) / spOut));
        const wave = (f) => cy + Math.sin(f * PI * 2.0 * sgn + 0.4) * size * 0.05 * (1 - f * 0.4);
        for (let k = 0; k < N; k++) {
          const f = k / (N - 1), fa = Math.max(0, f - 0.015), fb = Math.min(1, f + 0.015), x = lerp(x0, x1, f), y = wave(f);
          add(outl, { x, y, z: dThread * 0.6, ang: Math.atan2(wave(fb) - wave(fa), lerp(x0, x1, fb) - lerp(x0, x1, fa)), len: lenOut, th: dOut, tilt: 0, role: 1 });
        }
      }
      // a heart-ish pair of dots at the swash ends
      for (const sgn of [-1, 1]) add(fill, { x: sgn * (L.W * 0.5 - size * 0.02), y: cy, z: dThread * 0.5, ang: 0, len: dThread * 1.0, th: dThread * 1.6, tilt: 0, role: 0 });
      park = { x: L.W * 0.5 - size * 0.02, y: cy };
    }
    const lists = { fill, outl, shad };

    // ---- reference list for the reveal order
    const ref = style === 'thread' ? 'fill' : 'outl';
    const nGroups = lstart.fill.length;                        // letters (+ flourish)
    const listEnd = (name, k) => (k + 1 < nGroups ? lstart[name][k + 1] : lists[name === 'fill' ? 'fill' : name === 'outl' ? 'outl' : 'shad'].length);
    const refList = lists[ref], NREF = refList.length;
    const refStart = lstart[ref === 'fill' ? 'fill' : 'outl'];
    const groupCount = (k) => listEnd(ref === 'fill' ? 'fill' : 'outl', k) - refStart[k];
    // position (in reference stitches) -> per-list prefix count, aligned on letter boundaries
    const countFor = (name, pos) => {
      const lst = lists[name], st = lstart[name]; if (!lst.length) return 0;
      if (pos >= NREF) return lst.length; if (pos <= 0) return 0;
      let k = 0; while (k + 1 < nGroups && refStart[k + 1] <= pos) k++;
      const n = groupCount(k), f = n ? clamp((pos - refStart[k]) / n) : 1;
      return Math.round(st[k] + f * (listEnd(name, k) - st[k]));
    };

    // ---- materials and meshes
    const prevK = M.currentK; M.currentK = K1;
    const geo = stitchGeo();
    const mkMesh = (list, mat, name) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.name = name; im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; im.count = 0;
      list.forEach((s, i) => { _p.set(s.x, s.y, s.z); _q.setFromEuler(_e.set(s.tilt || 0, 0, s.ang)); _q2.setFromEuler(_e.set(s.tilt || 0, 0, 0)); _q.setFromEuler(_e.set(0, 0, s.ang)); _q.multiply(_q2.setFromEuler(_e.set(s.tilt || 0, 0, 0))); _s.set(s.len, s.th, s.th * 0.72); _m.compose(_p, _q, _s); im.setMatrixAt(i, _m); im.setColorAt(i, _c.set(1, 1, 1)); });
      im.instanceMatrix.needsUpdate = true; return im;
    };
    const threadMat = (rough) => stitchify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 }), K1);
    const uP = { value: 0 };
    const parts = {};
    if (style === 'thread') {
      parts.fill = mkMesh(fill, threadMat(0.34), 'satin'); parts.outl = mkMesh(outl, threadMat(0.5), 'outline'); if (shad.length) parts.shad = mkMesh(shad, threadMat(0.7), 'shadowline');
      // underlay: a padded pad under the satin, revealed slightly ahead of it
      const geos = letters.map((lt) => {
        const g = new THREE.ExtrudeGeometry(lt.shapes, { depth: size * 0.012, bevelEnabled: true, bevelThickness: size * 0.008, bevelSize: size * 0.012, bevelSegments: 2, curveSegments: 6 });
        g.translate(lt.ox, lt.oy, 0);
        const pos = g.attributes.position, ord = new Float32Array(pos.count);
        const st = lstart.fill[lt.idx], n = groupCount(lt.idx), bw = lt.bb.max.x - lt.bb.min.x || 1, bh = lt.bb.max.y - lt.bb.min.y || 1;
        for (let i = 0; i < pos.count; i++) { const key = 0.62 * clamp((pos.getX(i) - lt.ox - lt.bb.min.x) / bw) + 0.38 * (1 - clamp((pos.getY(i) - lt.oy - lt.bb.min.y) / bh)); ord[i] = (st + key * n) / NREF; }
        g.setAttribute('aOrd', new THREE.BufferAttribute(ord, 1)); return g;
      });
      const ug = mergeGeometries(geos); geos.forEach((g) => g.dispose());
      const umat = wipeify(stitchify(new THREE.MeshStandardMaterial({ color: darker(S.color, 0.5), roughness: 0.85 }), K1), uP);
      parts.pad = new THREE.Mesh(ug, umat); parts.pad.name = 'underlay'; parts.pad.castShadow = false;
    } else {
      const geos = letters.map((lt) => {
        const bev = style === 'satin' ? { depth: size * 0.05, bevelThickness: size * 0.09, bevelSize: size * 0.05, bevelSegments: 6 } : { depth: S.depth ?? size * 0.07, bevelThickness: size * 0.03, bevelSize: size * 0.03, bevelSegments: 3 };
        const g = new THREE.ExtrudeGeometry(lt.shapes, { ...bev, bevelEnabled: true, curveSegments: 8 });
        g.translate(lt.ox, lt.oy, 0);
        const pos = g.attributes.position, ord = new Float32Array(pos.count), bw = lt.bb.max.x - lt.bb.min.x || 1;
        for (let i = 0; i < pos.count; i++) ord[i] = (lt.idx + clamp((pos.getX(i) - lt.ox - lt.bb.min.x) / bw)) / nL;
        g.setAttribute('aOrd', new THREE.BufferAttribute(ord, 1)); return g;
      });
      const bg = mergeGeometries(geos); geos.forEach((g) => g.dispose());
      const bmat = style === 'felt' ? M.matte(S.color, { rep: 4, bump: 3 }) : stitchify(new THREE.MeshStandardMaterial({ color: S.color, roughness: 0.22, metalness: 0.05 }), K1);
      wipeify(bmat, uP);
      parts.body = new THREE.Mesh(bg, bmat); parts.body.name = 'body'; parts.body.castShadow = false;
      parts.outl = mkMesh(outl, threadMat(0.6), 'edging');
    }
    Object.values(parts).forEach((m) => { m.visible = false; obj.add(m); });
    // base colours (linear floats), painted into instanceColor on every call
    const baseCol = {};
    const paintBase = () => {
      for (const name of ['fill', 'outl', 'shad']) {
        const lst = lists[name], arr = (baseCol[name] ||= new Float32Array(Math.max(1, lst.length) * 3));
        lst.forEach((s, i) => {
          const j = hash(i * 1.9 + (name === 'fill' ? 3 : name === 'outl' ? 5 : 7)), band = 0.5 + 0.5 * Math.sin(s.x * 5.3 / Math.max(0.3, size) + Math.sin(s.y * 4.1 / Math.max(0.3, size)) * 1.7), v = name === 'fill' ? 0.78 + 0.24 * j + 0.22 * band : 0.92 + 0.16 * j;
          if (s.role === 0) _c.set(S.color); else if (s.role === 1) _c.set(S.color2); else if (s.role === 2) _c.set(S.shadowColor ?? darker(S.color, 0.42).getHex()); else _c.set(S.color2).lerp(new THREE.Color(0xffd45e), 0.6);
          arr[i * 3] = _c.r * v; arr[i * 3 + 1] = _c.g * v; arr[i * 3 + 2] = _c.b * v;
        });
      }
    };
    paintBase();

    // ---- needle, ripper, pulled thread
    const needle = makeNeedle(M, size, S.color2); needle.visible = false; obj.add(needle);
    const ripper = makeRipper(M, size * 0.9); ripper.visible = false; obj.add(ripper);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })); spark.visible = false; spark.renderOrder = 8; obj.add(spark);
    const pullGeo = stitchGeo(), pull = new THREE.InstancedMesh(pullGeo, threadMat(0.6), 28); pull.frustumCulled = false; pull.count = 0; pull.visible = false; pull.castShadow = false;
    for (let i = 0; i < 28; i++) pull.setColorAt(i, _c.set(S.color2)); obj.add(pull);
    M.currentK = prevK;

    // ---- per-frame state
    const st = { p: 0, u: 0, t: 0, vis: true, hot: [0, 0], words: null, dirtyM: true, holes: false };
    const baseM = {}; for (const k of Object.keys(parts)) if (parts[k].isInstancedMesh) baseM[k] = parts[k].instanceMatrix.array.slice();
    const x0s = fill.length ? fill : outl;
    const frontX = (() => {                                    // smoothed x of the reveal front vs. reference index
      const n = 48, out = new Float32Array(n + 1);
      for (let k = 0; k <= n; k++) { const c = Math.min(NREF - 1, Math.floor(k / n * (NREF - 1))); let sx = 0, sn = 0; for (let o = -14; o <= 14; o++) { const s = refList[clamp(c + o, 0, NREF - 1)]; if (s) { sx += s.x; sn++; } } out[k] = sn ? sx / sn : 0; }
      for (let k = 1; k <= n; k++) out[k] = Math.max(out[k], out[k - 1]);
      return (idx) => { const f = clamp(idx / Math.max(1, NREF - 1)) * n, i = Math.min(n - 1, Math.floor(f)); return lerp(out[i], out[i + 1], f - i); };
    })();
    const midY = -L.H / 2 + size * 0.5 - (S.flourish ? 0 : 0);

    function paint(name, mesh, count, t, glintOn, hotN) {
      const lst = lists[name]; if (!mesh || !mesh.instanceColor) return;
      const arr = mesh.instanceColor.array, base = baseCol[name], W = Math.max(0.1, L.W);
      const gx = -L.W * 0.5 - 0.3 * W + ((t / 5.2) % 1) * 1.6 * W, gw = 0.09 * W;
      for (let i = 0; i < count; i++) {
        const s = lst[i]; let k = 1;
        if (glintOn) { const dd = (s.x - s.y * 0.35 - gx) / gw; k += 0.55 * Math.exp(-dd * dd); if (hash(i * 0.37 + Math.floor(t * 2.5)) > 0.992) k += 0.5; }
        let hh = 0; if (hotN && i >= count - hotN) { const h = (i - (count - hotN) + 1) / hotN; hh = h * h; }
        arr[i * 3] = base[i * 3] * k * (1 - hh) + 3.0 * hh; arr[i * 3 + 1] = base[i * 3 + 1] * k * (1 - hh) + 2.4 * hh; arr[i * 3 + 2] = base[i * 3 + 2] * k * (1 - hh) + 2.6 * hh;
      }
      mesh.instanceColor.needsUpdate = true;
    }

    // ---- the reveal
    function drawReveal(pos, t, needleOn) {
      for (const k of Object.keys(baseM)) if (st.holes || st.dirtyM) { parts[k].instanceMatrix.array.set(baseM[k]); parts[k].instanceMatrix.needsUpdate = true; }
      st.holes = false; st.dirtyM = false;
      const done = pos >= NREF;
      uP.value = style === 'thread' ? clamp(pos / NREF + 0.012) + (done ? 1 : 0) : clamp(pos / NREF) + (done ? 1 : 0);
      if (style === 'thread') {
        const nF = countFor('fill', pos), nO = countFor('outl', done ? NREF : Math.max(0, pos - pitch * 0 - 26 + 26 * smooth((pos / NREF - 0.9) / 0.1))), nS = countFor('shad', done ? NREF : Math.max(0, pos - 60 + 60 * smooth((pos / NREF - 0.9) / 0.1)));
        parts.fill.count = nF; parts.fill.visible = nF > 0; parts.outl.count = nO; parts.outl.visible = nO > 0;
        if (parts.shad) { parts.shad.count = nS; parts.shad.visible = nS > 0; }
        parts.pad.visible = pos > 0;
        paint('fill', parts.fill, nF, t, done, done ? 0 : 5); paint('outl', parts.outl, nO, t, done, 0); if (parts.shad) paint('shad', parts.shad, nS, t, false, 0);
      } else {
        const nO = countFor('outl', pos);
        parts.outl.count = nO; parts.outl.visible = nO > 0; parts.body.visible = pos > 0;
        paint('outl', parts.outl, nO, t, done, done ? 0 : 4);
      }
      ripper.visible = false; pull.visible = false;
      // needle rides the front
      if (needleOn && pos > 0 && (!done || S.flourish)) {
        const i = clamp(Math.floor(pos) - 1, 0, NREF - 1), s = refList[i], ph = pos - Math.floor(pos), lift = size * 0.2 * (0.5 + 0.5 * Math.cos(ph * PI * 2)) + size * 0.03;
        const parked = done && S.flourish, tgt = parked ? park : s;
        needle.visible = true;
        placeNeedle(needle, tgt.x, tgt.y, parked ? dThread * 1.4 : (s.z || 0) + size * 0.02, parked ? -0.55 : -0.9 - 0.25 * Math.sin(ph * PI * 2), parked ? 0 : lift);
        needle.userData.tailGroup.rotation.z = Math.sin(t * 2.1 + pos * 0.02) * 0.18;
        needle.scale.setScalar(1);
        spark.visible = !parked; if (!parked) { spark.position.set(s.x, s.y, (s.z || 0) + size * 0.05); const sp = size * (0.22 + 0.16 * (1 - ph)); spark.scale.set(sp, sp, 1); spark.material.opacity = 0.7 + 0.3 * (1 - ph); }
      } else { needle.visible = false; spark.visible = false; }
    }

    // ---- the unpick
    function drawUnpick(u, t) {
      needle.visible = false; spark.visible = false; st.dirtyM = true;
      const pos = NREF; drawRevealColors(t);
      const passOf = (i, n) => 0.02 + (1 - i / Math.max(1, n - 1)) * 0.55;
      for (const name of ['fill', 'outl', 'shad']) {
        const mesh = parts[name === 'fill' ? (style === 'thread' ? 'fill' : 'none') : name], lst = lists[name]; if (!mesh) continue;
        const arr = mesh.instanceMatrix.array, n = lst.length; let alive = 0;
        for (let i = 0; i < n; i++) {
          const s = lst[i], ps = passOf(i, n), tau = clamp((u - ps + 0.05) / 0.16), f = Math.max(0, (u - ps - 0.06) / 0.38);
          const h1 = hash(i * 1.31 + 11.1 + s.x * 7), h2 = hash(i * 2.77 + 3.3), h3 = hash(i * 0.91 + 7.9), h4 = hash(i * 4.13 + 1.7);
          const tt = smooth(tau);
          const fade = 1 - smooth((f - 0.62) / 0.38);
          const px = s.x + (h2 - 0.5) * size * 0.9 * tt * tt + (h3 - 0.4) * size * 1.4 * f * f;
          const py = s.y + (h3 - 0.35) * size * 0.35 * tt - size * 9.5 * f * f;
          const pz = s.z + size * 0.32 * tt * (0.4 + h1);
          _p.set(px, py, pz);
          _q.setFromEuler(_e.set(0, 0, s.ang)); _q.multiply(_q2.setFromEuler(_e.set(s.tilt || 0, 0, 0)));
          _ax.set(h1 - 0.5, h2 - 0.5, h3 - 0.2).normalize();
          _q.premultiply(_q2.setFromAxisAngle(_ax, tt * (1.6 + 3 * h4) + f * (3 + 6 * h1)));
          _s.set(s.len * (1 - 0.35 * tt) * fade, s.th * fade, s.th * 0.72 * fade);
          _m.compose(_p, _q, _s); _m.toArray(arr, i * 16);
          if (fade > 0.01) alive++;
        }
        mesh.instanceMatrix.needsUpdate = true; mesh.count = n; mesh.visible = alive > 0;
      }
      if (parts.pad) { uP.value = clamp(1 - (u - 0.02) / 0.55); parts.pad.visible = u < 0.6; }
      if (parts.body) { uP.value = 1 - clamp((u - 0.1) / 0.5); parts.body.visible = u < 0.62; }
      // ripper and the pulled thread
      const fr = clamp(1 - (u - 0.02) / 0.55), idx = fr * (NREF - 1), rx = frontX(idx);
      const on = u > 0.0 && u < 0.66, pop = smooth(clamp(u / 0.04)) * (1 - smooth((u - 0.57) / 0.09));
      ripper.visible = on && pop > 0.01; ripper.scale.setScalar(Math.max(0.01, pop));
      const rk = ripper.userData.crank; rk.rotation.y = -u * 60;
      ripper.position.set(rx + size * 0.02, midY - size * 0.02 + Math.sin(u * 90) * size * 0.012, size * 0.18); ripper.rotation.set(0.25, 0, -0.35);
      pull.visible = ripper.visible; pull.count = 28;
      const tip = new THREE.Vector3(rx + size * 0.02, midY, size * 0.14), Lt = size * (0.6 + 3.2 * smooth(u / 0.5));
      const c1 = new THREE.Vector3(tip.x + Lt * 0.35, tip.y + size * 0.6 + Math.sin(u * 30) * size * 0.05, tip.z + size * 0.1), en = new THREE.Vector3(tip.x + Lt * 0.9, tip.y - size * 1.4 - Math.sin(u * 22) * size * 0.1, tip.z - size * 0.02);
      const P = (k) => { const a = 1 - k; return new THREE.Vector3(a * a * tip.x + 2 * a * k * c1.x + k * k * en.x, a * a * tip.y + 2 * a * k * c1.y + k * k * en.y, a * a * tip.z + 2 * a * k * c1.z + k * k * en.z); };
      for (let i = 0; i < 28; i++) {
        const a = P(i / 28), b = P((i + 1) / 28), dx = b.x - a.x, dy = b.y - a.y;
        _p.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); _q.setFromEuler(_e.set(0, 0, Math.atan2(dy, dx))); _s.set(Math.hypot(dx, dy) * 1.25, Math.max(pitch * 0.9, size * 0.028), Math.max(pitch * 0.9, size * 0.028)); _m.compose(_p, _q, _s); pull.setMatrixAt(i, _m);
      }
      pull.instanceMatrix.needsUpdate = true;
    }
    function drawRevealColors(t) {
      if (style === 'thread') { paint('fill', parts.fill, fill.length, t, false, 0); paint('outl', parts.outl, outl.length, t, false, 0); if (parts.shad) paint('shad', parts.shad, shad.length, t, false, 0); }
      else paint('outl', parts.outl, outl.length, t, false, 0);
    }

    const item = {
      id, obj, bounds, style, spec: S, counts: { fill: fill.length, outline: outl.length, shadow: shad.length },
      progress(p, t = 0) {
        st.p = p; st.u = 0; st.t = t;
        const pos = clamp(p) * NREF;
        drawReveal(p >= 1 ? NREF : pos, t, true);
      },
      unpick(u) {
        st.u = u;
        if (u <= 0) { drawReveal(NREF, 0, false); needle.visible = false; return; }
        drawUnpick(clamp(u), 0);
      },
      progressWords(t, windows) {
        const nW = wordLetters.length; st.t = t; st.u = 0;
        const vis = new Array(nL).fill(0);                      // per letter: 0..1
        for (let w = 0; w < nW; w++) {
          const win = windows[w] || windows[windows.length - 1] || { t0: 0, t1: 1 }, f = clamp((t - win.t0) / Math.max(1e-6, win.t1 - win.t0));
          for (const li of wordLetters[w] || []) vis[li] = f;
        }
        let gap = false, ok = true; for (let li = 0; li < nL; li++) { if (vis[li] <= 0) gap = true; else if (gap) ok = false; }
        const allDone = nL > 0 && vis.every((f) => f >= 1);
        let pos = 0; for (let li = 0; li < nL; li++) { pos = refStart[li] + vis[li] * groupCount(li); if (vis[li] < 1) break; }
        if (allDone) pos = NREF - (S.flourish ? groupCount(nL) : 0);
        if (S.flourish && allDone) pos = NREF;
        drawReveal(pos, t, true);
        if (!ok) {                                             // overlapping windows: hide unrevealed letters with zero-scale matrices
          st.holes = true;
          for (const name of Object.keys(baseM)) {
            const arr = parts[name].instanceMatrix.array, lst = lists[name];
            for (let li = 0; li < nL; li++) if (vis[li] <= 0) { const a = lstart[name][li], b = li + 1 < nGroups ? lstart[name][li + 1] : lst.length; for (let i = a; i < b; i++) { arr[i * 16] = 0; arr[i * 16 + 5] = 0; arr[i * 16 + 10] = 0; } }
            parts[name].count = lst.length; parts[name].visible = true; parts[name].instanceMatrix.needsUpdate = true;
          }
        }
      },
      setColor(c) { S.color = c; paintBase(); if (parts.body) parts.body.material.color.set(c); if (parts.pad) parts.pad.material.color.copy(darker(c, 0.5)); },
      setColor2(c) { S.color2 = c; paintBase(); },
      setVisible(v) { obj.visible = !!v; },
      dispose() { obj.traverse((o) => { if (o.geometry && o.geometry !== stitchGeo()) o.geometry.dispose(); }); },
    };
    // start hidden until the first call
    item.progress(0, 0);
    T.items.set(id, item);
    return item;
  }

  T.item = (id, spec) => makeItem(id, spec || {});
  T.itemFromWords = (id, words, spec) => makeItem(id, { ...(spec || {}), text: words.join(' ') }, words);
  // Text.title(root?) or Text.title({ lines: 1|2, size, id }); a Group argument is the parent to add the title to
  T.title = (arg) => {
    const isRoot = !!(arg && arg.isObject3D), opt = isRoot || !arg ? {} : arg, two = opt.lines !== 1;
    const it = makeItem(opt.id || 'title', {
      text: two ? 'ZOMBIE\nCOUTURE' : 'ZOMBIE COUTURE', style: 'thread', color: 0xf02a7c, color2: 0xfff4e0, shadowColor: 0x5b1f56, size: opt.size ?? 1.0, align: 'center', flourish: true, lineGap: 1.28,
    });
    if (isRoot) arg.add(it.obj);
    return it;
  };
  return T;
}
