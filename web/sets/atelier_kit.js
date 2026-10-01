// Helpers for the atelier set: batching (many small pieces -> few draw calls, colour per vertex), instanced running stitches,
// one-draw-call glow points, procedural geometry and canvas textures.  Nothing here runs per frame except Glow.set().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { stitchify } from '../stitch.js';

const PI = Math.PI, TAU = PI * 2;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

export const PAL = {
  pink: 0xff9ecb, pink2: 0xffb6d5, hot: 0xff2f86, lilac: 0xd9a7ff, lilac2: 0xc9b6ff, mint: 0xb6ffd6, sky: 0xa8e6ff,
  butter: 0xfff0a6, butter2: 0xffe066, peach: 0xffc9a8, peach2: 0xffd9a8, cream: 0xfff4e0, coral: 0xff8a6a, thread: 0xff5fa8,
};
export const CANDY = [PAL.pink, PAL.lilac, PAL.mint, PAL.butter, PAL.sky, PAL.peach, PAL.pink2, PAL.lilac2, PAL.butter2, PAL.coral];

export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
// placement record -> Matrix4.  Euler order YXZ: tilt first, then yaw about the vertical.
export function xf(o = {}) {
  if (o.isMatrix4) return o;
  _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ'); _q.setFromEuler(_e);
  const k = o.s ?? 1;
  _p.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); _s.set(o.sx ?? k, o.sy ?? k, o.sz ?? k);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// ---------------------------------------------------------------- geometry
export const cylG = (rt, rb, h, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sphG = (r, ws = 16, hs = 11) => new THREE.SphereGeometry(r, ws, hs);
export const torG = (R, r, rs = 8, ts = 28, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const rboxG = (w, h, d, r = 0.04, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
export const capG = (r, l, cs = 3, rs = 8) => new THREE.CapsuleGeometry(r, l, cs, rs);
export function latheG(prof, seg = 24, a0 = 0, aLen = TAU) { return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg, a0, aLen); }
export function tubeG(pts, r = 0.01, seg = 24, rs = 5) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rs, false); }

// ruffled / pinked / scalloped skirt or cloth: a lathe whose hem waves.  prof = [[r, y], ...] from the top down.
export function skirtG(prof, o = {}) {
  const { seg = 36, amp = 0.05, n = 10, phase = 0, zig = false, rings = 9, a0 = 0, aLen = TAU, pow = 1.7 } = o;
  const pts = new THREE.SplineCurve(prof.map((p) => new THREE.Vector2(p[0], p[1]))).getPoints(rings);
  const geo = new THREE.LatheGeometry(pts, seg, a0, aLen);
  const pos = geo.attributes.position, yMax = prof[0][1], yMin = prof[prof.length - 1][1];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
    const w = Math.pow(Math.max(0, (yMax - y) / (yMax - yMin)), pow);
    let s; if (zig) { const f = (((a * n / TAU) % 1) + 1) % 1; s = Math.abs(f * 2 - 1) * 2 - 1; } else s = Math.sin(a * n + phase);
    const r2 = r * (1 + amp * w * s);
    pos.setXYZ(i, Math.cos(a) * r2, y - amp * 0.7 * w * (s * 0.5 + 0.5), Math.sin(a) * r2);
  }
  geo.computeVertexNormals(); return geo;
}

// rounded-rect / arch shapes (for mirror panels, windows)
export function archShape(w, h, rTop = null, r = 0.06) {
  const s = new THREE.Shape(), hw = w / 2, top = rTop ?? hw;
  s.moveTo(-hw + r, 0); s.lineTo(hw - r, 0); s.quadraticCurveTo(hw, 0, hw, r);
  s.lineTo(hw, h - top);
  s.absarc(0, h - top, hw, 0, PI, false);
  s.lineTo(-hw, r); s.quadraticCurveTo(-hw, 0, -hw + r, 0);
  return s;
}

// ---------------------------------------------------------------- batching
// Static pieces are baked into merged meshes with per-vertex colour.  One Batch per visibility group.
export class Batch {
  constructor(M, parent, name = 'b') { this.M = M; this.parent = parent; this.name = name; this.b = {}; this.mats = {}; this.tris = 0; this.stack = [new THREE.Matrix4()]; }
  // sub-assemblies: push a placement, add pieces in local coordinates, pop
  push(o) { this.stack.push(this.stack[this.stack.length - 1].clone().multiply(xf(o))); return this; }
  pop() { this.stack.pop(); return this; }
  place(o, fn) { this.push(o); fn(this); this.pop(); return this; }
  mat(kind) {
    if (!this.mats[kind]) {
      const M = this.M;
      const m = kind === 'cloth' ? M.cloth(0xffffff, { rep: 7 }) : M.matte(0xffffff, { rep: 7, bump: 2.2 });
      m.vertexColors = true; this.mats[kind] = m;
    }
    return this.mats[kind];
  }
  add(geo, color, o = {}, kind = 'felt', cast = true) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(this.stack[this.stack.length - 1].clone().multiply(xf(o)));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.computeBoundingBox(); const bb = g.boundingBox;
    const md = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const us = o.uv ?? Math.min(10, Math.max(0.4, md / 0.5));
    const uv = g.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * us, uv.getY(i) * us);
    const col = new Float32Array(n * 3); _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const key = kind + '|' + (cast ? 1 : 0);
    (this.b[key] ||= []).push(g); this.tris += n / 3;
    return this;
  }
  rbox(w, h, d, r, color, o, kind, cast) { return this.add(rboxG(w, h, d, r), color, o, kind, cast); }
  cyl(rt, rb, h, color, o, seg = 20, kind, cast) { return this.add(cylG(rt, rb, h, seg), color, o, kind, cast); }
  sph(r, color, o, ws = 16, hs = 11, kind, cast) { return this.add(sphG(r, ws, hs), color, o, kind, cast); }
  tor(R, r, color, o, rs = 8, ts = 28, kind, cast) { return this.add(torG(R, r, rs, ts), color, o, kind, cast); }
  flush() {
    const out = [];
    for (const key of Object.keys(this.b)) {
      const [kind, cast] = key.split('|');
      const mesh = new THREE.Mesh(mergeGeometries(this.b[key], false), this.mat(kind));
      mesh.castShadow = cast === '1'; mesh.receiveShadow = true; mesh.name = `${this.name}_${key}`;
      this.parent.add(mesh); out.push(mesh);
    }
    this.b = {}; return out;
  }
}

// ---------------------------------------------------------------- running stitches (all in one InstancedMesh)
export class Stitches {
  constructor() { this.m = []; this.c = []; }
  // pts: [[x,y,z], ...] polyline;  o: gap (spacing), len, w (thickness)
  poly(pts, color = PAL.cream, o = {}) {
    const gap = o.gap ?? 0.17, len = o.len ?? 0.085, w = o.w ?? 0.017;
    const col = new THREE.Color(color), z = new THREE.Vector3(0, 0, 1);
    let carry = gap * 0.5;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]), d = b.clone().sub(a), L = d.length();
      if (L < 1e-6) continue; d.divideScalar(L);
      const q = new THREE.Quaternion().setFromUnitVectors(z, d);
      let s = carry;
      while (s < L) {
        const p = a.clone().addScaledVector(d, s);
        this.m.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(w, w, len))); this.c.push(col);
        s += gap;
      }
      carry = s - L;
    }
    return this;
  }
  arc(cx, cy, cz, r, a0, a1, plane, color, o = {}, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, c = Math.cos(a) * r, s = Math.sin(a) * r;
      pts.push(plane === 'xz' ? [cx + c, cy, cz + s] : plane === 'xy' ? [cx + c, cy + s, cz] : [cx, cy + s, cz + c]);
    }
    return this.poly(pts, color, o);
  }
  ring(cx, cy, cz, r, plane, color, o = {}) { const n = Math.max(24, Math.ceil(r * 40)); return this.arc(cx, cy, cz, r, 0, TAU, plane, color, { ...o, gap: TAU * r / Math.max(8, Math.round(TAU * r / (o.gap ?? 0.17))) }, n); }
  flush(parent, M) {
    if (!this.m.length) return null;
    const g = cylG(1, 1, 1, 5); g.rotateX(PI / 2);
    const mat = stitchify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    const im = new THREE.InstancedMesh(g, mat, this.m.length);
    this.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, this.c[i]); });
    im.castShadow = false; im.receiveShadow = true; im.name = 'stitches'; parent.add(im);
    const n = this.m.length; this.m = []; this.c = []; return { mesh: im, count: n };
  }
}

// ---------------------------------------------------------------- glow points: one draw call for every soft light dot in the set
export class Glow {
  constructor(N, H = 720) {
    this.N = N; this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.siz = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: H * 0.5 } },
      vertexShader: 'attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC; varying float vS; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vC = aColor; vS = aSize < 0.0 ? 1.0 : 0.0; if (aColor.a <= 0.0 || aSize == 0.0 || mv.z > -0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; } else { gl_PointSize = clamp(abs(aSize) * uScale * projectionMatrix[1][1] / (-mv.z), 1.5, 220.0); } }',
      fragmentShader: 'varying vec4 vC; varying float vS; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = clamp(1.0 - r, 0.0, 1.0); a = a * a * (3.0 - 2.0 * a); if (vS > 0.5) { float ax = abs(d.x), ay = abs(d.y); float cr = max(exp(-ay * ay * 1400.0) * (1.0 - ax * 2.0), exp(-ax * ax * 1400.0) * (1.0 - ay * 2.0)); a = clamp(max(cr, a * a), 0.0, 1.0); } gl_FragColor = vec4(vC.rgb, a * vC.a); }',
    });
    this.obj = new THREE.Points(geo, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 6; this.obj.name = 'glow';
    this.geo = geo;
  }
  // i = slot; size in metres (diameter); alpha 0..1+
  set(i, x, y, z, size, r, g, b, a) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.siz[i] = size;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
  }
  star(i, x, y, z, size, r, g, b, a) { this.set(i, x, y, z, -size, r, g, b, a); }
  hide(i) { this.siz[i] = 0; this.col[i * 4 + 3] = 0; }
  commit() { const a = this.geo.attributes; a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true; }
}

// ---------------------------------------------------------------- canvas textures (all deterministic)
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, rx = 1, ry = 1, rep = true) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 6;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t;
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function flower(g, x, y, r, petal, centre, n = 5) {
  g.fillStyle = petal; for (let i = 0; i < n; i++) { const a = i / n * TAU; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.46, 0, TAU); g.fill(); }
  g.fillStyle = centre; g.beginPath(); g.arc(x, y, r * 0.34, 0, TAU); g.fill();
}
function dashRect(g, x, y, w, h, col, lw = 3, dash = [9, 7]) { g.save(); g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash); g.lineCap = 'round'; g.strokeRect(x, y, w, h); g.restore(); }

// honey planks in a 4 m x 4 m tile (planks run along x)
export function plankTex() {
  const [c, g] = cv(1024, 1024), R = rng(12);
  const base = [0xf3c98b, 0xefbf80, 0xf8d9a8, 0xe9b57c, 0xfad4a0, 0xf0c690, 0xffdcae];
  const rows = 16, rh = 1024 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -R() * 400;
    while (x < 1024) {
      const len = 360 + R() * 420, col = base[Math.floor(R() * base.length)];
      g.fillStyle = hex(col); g.fillRect(x, r * rh, len, rh);
      g.strokeStyle = 'rgba(150,90,50,0.16)'; g.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) { const yy = r * rh + 6 + R() * (rh - 12); g.beginPath(); g.moveTo(x + 4, yy); g.bezierCurveTo(x + len * 0.3, yy + (R() - 0.5) * 6, x + len * 0.65, yy + (R() - 0.5) * 6, x + len - 4, yy + (R() - 0.5) * 4); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, r * rh, len, 4);
      g.fillStyle = 'rgba(120,70,40,0.30)'; g.fillRect(x, r * rh + rh - 3, len, 3); g.fillRect(x, r * rh, 3, rh);
      g.fillStyle = 'rgba(255,244,224,0.85)'; for (const dy of [14, rh - 14]) { g.beginPath(); g.arc(x + 12, r * rh + dy, 3.2, 0, TAU); g.fill(); }
      x += len;
    }
  }
  return tex(c, 14 / 4, 10 / 4);
}

// wallpaper: lilac, cream stripes with a stitched line, tiny flowers and dots.  Tile = 1.4 m (uv scaled by the caller).
export function wallTex() {
  const [c, g] = cv(512, 512);
  g.fillStyle = '#e4dcff'; g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#f3efff'; for (let i = 0; i < 4; i++) g.fillRect(i * 128 + 44, 0, 40, 512);
  g.strokeStyle = 'rgba(255,158,203,0.75)'; g.lineWidth = 3; g.setLineDash([10, 9]);
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 128 + 64, 0); g.lineTo(i * 128 + 64, 512); g.stroke(); }
  g.setLineDash([]);
  const cols = [['#ff9ecb', '#fff0a6'], ['#ffc9a8', '#fff4e0'], ['#a8e6ff', '#fff4e0'], ['#b6ffd6', '#ffe066']];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const x = i * 128 + (j % 2 ? 0 : 0) + 20, y = j * 128 + 64 + (i % 2 ? 40 : -20); const cc = cols[(i + j * 2) % 4]; flower(g, x + (i % 2 ? 44 : 0), y, 15, cc[0], cc[1]); }
  g.fillStyle = 'rgba(255,255,255,0.7)'; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * 64 + 32 + (j % 2) * 32, j * 64 + 8, 2.4, 0, TAU); g.fill(); }
  return tex(c);
}

// ceiling: pale pink sunburst around the skylight (world metres: x -7..7, y(=z) -5..5 -> 80 px per metre)
export function ceilTex() {
  const [c, g] = cv(1120, 800), cx = 560, cy = 400, S = 80;
  g.fillStyle = '#fff2f6'; g.fillRect(0, 0, 1120, 800);
  const N = 16;
  for (let i = 0; i < N; i++) { g.fillStyle = i % 2 ? '#ffe3ee' : '#fff8f2'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 9 * S, i / N * TAU, (i + 1) / N * TAU); g.closePath(); g.fill(); }
  const ring = (r, col, lw, dash) => { g.save(); g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash); g.lineCap = 'round'; g.beginPath(); g.arc(cx, cy, r * S, 0, TAU); g.stroke(); g.restore(); };
  ring(2.95, '#ff8a6a', 5, [16, 12]); ring(3.25, '#ffe066', 12, []); ring(3.55, '#ff9ecb', 4, [10, 10]); ring(5.1, '#c9b6ff', 4, [12, 10]);
  for (let i = 0; i < N; i++) { const a = i / N * TAU; g.save(); g.strokeStyle = '#ff9ecb'; g.lineWidth = 3.5; g.setLineDash([9, 11]); g.beginPath(); g.moveTo(cx + Math.cos(a) * 3.7 * S, cy + Math.sin(a) * 3.7 * S); g.lineTo(cx + Math.cos(a) * 9 * S, cy + Math.sin(a) * 9 * S); g.stroke(); g.restore();
    const m = a + PI / N; flower(g, cx + Math.cos(m) * 4.4 * S, cy + Math.sin(m) * 4.4 * S, 15, i % 2 ? '#ff9ecb' : '#ffc9a8', '#fff0a6'); }
  for (let i = 0; i < N; i++) { const m = (i + 0.5) / N * TAU; flower(g, cx + Math.cos(m) * 6.2 * S, cy + Math.sin(m) * 6.2 * S, 12, '#a8e6ff', '#fff4e0'); }
  // medallion right under the opening (only seen when the panels are closed)
  g.fillStyle = '#ffd6e6'; g.beginPath(); g.arc(cx, cy, 2.4 * S, 0, TAU); g.fill();
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#ffb6d5' : '#ffe9c4'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 2.35 * S, i / 12 * TAU, (i + 1) / 12 * TAU); g.closePath(); g.fill(); }
  g.fillStyle = '#ff8a6a'; g.beginPath(); g.arc(cx, cy, 0.28 * S, 0, TAU); g.fill();
  return tex(c, 1 / 14, 1 / 10, false);
}

// roof patchwork quilt: 8 x 8 patches, tile = 6 m
export function quiltTex() {
  const [c, g] = cv(1024, 1024), R = rng(41), P = 128;
  const pal = [0xffb6d5, 0xd9a7ff, 0xb6ffd6, 0xfff0a6, 0xa8e6ff, 0xffc9a8, 0xc9b6ff, 0xffd9a8, 0xff9ecb];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = i * P, y = j * P, a = pal[Math.floor(R() * pal.length)], b = pal[Math.floor(R() * pal.length)], kind = Math.floor(R() * 6);
    g.fillStyle = hex(a); g.fillRect(x, y, P, P);
    g.save(); g.beginPath(); g.rect(x, y, P, P); g.clip();
    if (kind === 1) { g.fillStyle = hex(b); for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) { g.beginPath(); g.arc(x + 16 + k * 32 + (m % 2) * 16, y + 16 + m * 32, 7, 0, TAU); g.fill(); } }
    else if (kind === 2) { g.fillStyle = hex(b); for (let k = 0; k < 5; k++) g.fillRect(x, y + 10 + k * 26, P, 12); }
    else if (kind === 3) { g.fillStyle = 'rgba(255,255,255,0.45)'; for (let k = 0; k < 4; k++) { g.fillRect(x + k * 32 + 8, y, 16, P); g.fillRect(x, y + k * 32 + 8, P, 16); } }
    else if (kind === 4) { flower(g, x + 64, y + 64, 34, hex(b), '#fff4e0'); }
    else if (kind === 5) { g.fillStyle = hex(b); g.beginPath(); g.moveTo(x, y); g.lineTo(x + P, y); g.lineTo(x + P / 2, y + P / 2); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x, y + P); g.lineTo(x + P, y + P); g.lineTo(x + P / 2, y + P / 2); g.closePath(); g.fill(); }
    g.restore();
    dashRect(g, x + 8, y + 8, P - 16, P - 16, 'rgba(255,255,255,0.85)', 3, [8, 6]);
  }
  g.strokeStyle = 'rgba(120,90,140,0.22)'; g.lineWidth = 4;
  for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(k * P, 0); g.lineTo(k * P, 1024); g.stroke(); g.beginPath(); g.moveTo(0, k * P); g.lineTo(1024, k * P); g.stroke(); }
  return tex(c, 1 / 6, 1 / 6);
}

// cutting mat 0.9 x 2.6 m: mint, white grid, diagonals, a quarter circle
export function matTex() {
  const [c, g] = cv(360, 1040);
  g.fillStyle = '#8fdcb8'; g.fillRect(0, 0, 360, 1040);
  g.strokeStyle = 'rgba(255,255,255,0.34)'; g.lineWidth = 1.5;
  for (let x = 0; x <= 360; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1040); g.stroke(); }
  for (let y = 0; y <= 1040; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(360, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
  for (let x = 0; x <= 360; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1040); g.stroke(); }
  for (let y = 0; y <= 1040; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(360, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,120,170,0.8)'; g.lineWidth = 3; g.setLineDash([12, 8]);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(360, 360); g.moveTo(360, 700); g.lineTo(0, 1040); g.stroke();
  g.beginPath(); g.arc(0, 1040, 300, -PI / 2, 0); g.stroke();
  g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = '16px sans-serif';
  for (let y = 100; y < 1040; y += 100) g.fillText(String(y / 10), 6, y - 4);
  return tex(c, 1, 1, false);
}

// measuring tape: yellow, black ticks, red cm marks.  u along the length.
export function tapeTex() {
  const [c, g] = cv(1024, 32);
  g.fillStyle = '#ffd83a'; g.fillRect(0, 0, 1024, 32);
  g.fillStyle = '#2b1a3a';
  for (let x = 0; x < 1024; x += 8) g.fillRect(x, 0, 2, x % 64 === 0 ? 20 : x % 32 === 0 ? 14 : 8);
  g.fillStyle = '#ff2f86'; for (let x = 64; x < 1024; x += 64) g.fillRect(x - 3, 22, 7, 8);
  return tex(c, 1, 1, false);
}

// mirror: pale sky-lilac gradient with two soft diagonal highlights
export function mirrorTex() {
  const [c, g] = cv(256, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#fbfdff'); gr.addColorStop(0.5, '#e6f3ff'); gr.addColorStop(1, '#d9ccff');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [x, w, a] of [[40, 30, 0.42], [96, 12, 0.5], [190, 44, 0.22]]) { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w - 140, 512); g.lineTo(x - 140, 512); g.closePath(); g.fill(); }
  g.restore();
  const v = g.createRadialGradient(128, 256, 80, 128, 256, 330); v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(190,170,240,0.32)');
  g.fillStyle = v; g.fillRect(0, 0, 256, 512);
  return tex(c, 1, 1, false);
}

// painted "outside" for the round window: sunset sky, felt sun, cloud appliqué, lollipop trees
export function windowTex() {
  const [c, g] = cv(512, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#c9b6ff'); gr.addColorStop(0.45, '#ffb6d5'); gr.addColorStop(0.75, '#ffd9a8'); gr.addColorStop(1, '#fff0a6');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(300, 330, 150, 0, TAU); g.fill();
  g.fillStyle = '#fff0a6'; g.beginPath(); g.arc(300, 330, 92, 0, TAU); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.setLineDash([12, 9]); g.beginPath(); g.arc(300, 330, 80, 0, TAU); g.stroke(); g.setLineDash([]);
  const cloud = (x, y, s) => { g.fillStyle = '#fff4e0'; for (const [dx, dy, r] of [[0, 0, 34], [36, -14, 40], [76, 0, 32], [38, 12, 34]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, TAU); g.fill(); } };
  cloud(40, 130, 1.0); cloud(310, 90, 0.8); cloud(150, 250, 0.7);
  g.fillStyle = '#b6ffd6'; g.beginPath(); g.moveTo(0, 470); for (let x = 0; x <= 512; x += 32) g.lineTo(x, 430 + Math.sin(x * 0.02) * 26); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
  g.fillStyle = '#8fdcb0'; g.beginPath(); g.moveTo(0, 500); for (let x = 0; x <= 512; x += 32) g.lineTo(x, 470 + Math.sin(x * 0.03 + 1) * 18); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
  for (const [x, s, col] of [[90, 1, '#ff9ecb'], [420, 1.2, '#d9a7ff'], [250, 0.8, '#ffe066']]) { g.fillStyle = '#c9a07a'; g.fillRect(x - 3, 430, 6, 44 * s); g.fillStyle = col; g.beginPath(); g.arc(x, 424, 24 * s, 0, TAU); g.fill(); }
  return tex(c, 1, 1, false);
}

// flat ribbon strip along a curve (normal up); uv.x runs along the length (times uvLen)
export function ribbonG(curve, w = 0.03, n = 60, uvLen = 1) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPoint(u), tg = curve.getTangent(u), sd = new THREE.Vector3(-tg.z, 0, tg.x).normalize().multiplyScalar(w);
    pos.push(p.x + sd.x, p.y, p.z + sd.z, p.x - sd.x, p.y, p.z - sd.z); uvs.push(u * uvLen, 0, u * uvLen, 1);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
