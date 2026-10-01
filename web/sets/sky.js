// The SKY and the QUILT WORLD: everything outside the buildings.  A dusk-to-sunrise sky dome with stitched stars, a felt sun button and a
// crescent moon; puffy quilted clouds; distant stuffed-cushion hills; and the quilt ground (patchwork, stitched seams, puffy relief) that the
// mall and the atelier stand on.  The quilt is cloth world: it is grey and cold until the pink stitch front reaches it.
//
// c2.args.dawn  0 = dusk (moon, stars, plum/peach horizon) .. 1 = sunrise (gold-pink horizon, felt sun on the horizon).  Default 1.
// Rigs (all return { pos, look, fov [, roll] }):  aerialMall  orbitWorld  horizon  quiltTop  atelierSky  duskDrift   (each says whether it moves on u.p or u.t)
// front(u, c2) -> { width, noise, dash, thread }: the style of the pink stitch band for aerial views (see the comment at set.front).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stitchify } from '../stitch.js';
import {
  PI, TAU, clamp, lerp, smooth, sstep, hash, mkrng, hexs, canvas, dashed, P, FLAT, QUILT, F0, H_VIEW_END, SUN_DIR, SUN_DIST, SUN_ELEV, SUN_R, MOON_DIR, MOON_R,
  skyRamp, paintQuilt, boldHaze, aerialFront,
} from './sky_shared.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TWO_PI = 'const float TAU = 6.28318530718;';

// world constants used by rigs (from sets/mall.js: mall centre, pedestal)
const MALL_C = { x: 0, z: 5.75 }, PED = { x: 0.53, z: 4.72 }, ATELIER_C = { x: 80, z: 0 };

// ---------------------------------------------------------------- relief of the quilt (also used to stand trees on the ground)
export function quiltRelief(x, z) {
  const bx = Math.floor(x / QUILT.block), bz = Math.floor(z / QUILT.block);
  const fx = x / QUILT.block - bx, fz = z / QUILT.block - bz;
  const d = Math.pow(Math.max(Math.sin(PI * fx) * Math.sin(PI * fz), 0), 0.55);
  const amp = 0.5 + 0.65 * hash(bx * 17.3 + bz * 5.1 + 3.0);
  let m = 1;
  for (const [x0, x1, z0, z1] of FLAT) { const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); m = Math.min(m, smooth(Math.hypot(dx, dz) / 16)); }
  return { h: d * amp * m, ao: 0.74 + 0.26 * d * (0.5 + 0.5 * m) + 0.0 * amp };
}
const groundY = (x, z) => QUILT.y + quiltRelief(x, z).h;

function quiltGeometry(N) {
  const n1 = N + 1, E = QUILT.half, pos = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2), col = new Float32Array(n1 * n1 * 3);
  const warp = (s) => E * (0.35 * s + 0.65 * s * Math.pow(Math.abs(s), 3));
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const k = j * n1 + i, x = warp(-1 + 2 * i / N), z = warp(-1 + 2 * j / N), r = quiltRelief(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = QUILT.y + r.h; pos[k * 3 + 2] = z;
    uv[k * 2] = x / QUILT.tile; uv[k * 2 + 1] = -z / QUILT.tile;
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = r.ao;
  }
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- sky shaders (drawn at infinity: only the camera's rotation matters)
const SKY_VERT = `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); p.z = p.w * 0.9999; gl_Position = p; }`;
const SKY_FRAG = `${TWO_PI}
uniform vec3 cZen, cUp, cMid, cLow, cHor, cSun, uSunDir; uniform float uSunUp, uQuilt, uTime;
varying vec3 vDir;
float sh(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
void main(){
  vec3 d = normalize(vDir); float e = d.y, h = clamp(e, 0.0, 1.0), t = pow(h, 0.5);
  vec3 c = mix(cHor, cLow, smoothstep(0.0, 0.20, t));
  c = mix(c, cMid, smoothstep(0.16, 0.46, t)); c = mix(c, cUp, smoothstep(0.40, 0.74, t)); c = mix(c, cZen, smoothstep(0.70, 1.0, t));
  c = mix(c, cHor * 0.94, smoothstep(0.0, 0.06, -e));
  float sd = max(dot(d, uSunDir), 0.0);
  c += cSun * (pow(sd, 5.0) * 0.30 + pow(sd, 36.0) * 0.55 + pow(sd, 500.0) * 0.5) * uSunUp;
  // the sky is a quilted canopy: a very faint lattice of running stitches
  if (e > 0.02 && uQuilt > 0.0) {
    float az = atan(d.x, d.z), el = asin(clamp(e, -1.0, 1.0));
    vec2 q = vec2(az * 5.0 + el * 9.0, az * 5.0 - el * 9.0) / 1.5707963;
    vec2 f = abs(fract(q) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.028, min(f.x, f.y) * 0.5 + 0.0) ;
    float dash = step(0.35, fract((q.x + q.y) * 6.0));
    c += (c * 0.20 + 0.02) * line * dash * uQuilt * smoothstep(0.02, 0.2, e);
  }
  if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = cHor;      // never let a NaN reach the bloom chain (one NaN pixel blacks out the whole frame)
  gl_FragColor = vec4(min(c, vec3(6.0)), 1.0);
}`;

const BILL_VERT = `uniform vec3 uDir; uniform float uDist, uHalf, uR; varying vec2 vP;
void main(){
  vec3 d = normalize(mat3(viewMatrix) * uDir);
  vec3 r = abs(d.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), d));
  vec3 u = cross(d, r);
  vec3 v = d * uDist + (r * position.x + u * position.y) * uHalf;
  vec4 p = projectionMatrix * vec4(v, 1.0); p.z = p.w * 0.9999; gl_Position = p;
  vP = position.xy * (uHalf / uR);
}`;
const NOISE_G = `float hs(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i), hs(i+vec2(1,0)), f.x), mix(hs(i+vec2(0,1)), hs(i+vec2(1,1)), f.x), f.y); }`;
const SUN_FRAG = `${TWO_PI}
uniform float uRot, uUp; varying vec2 vP;
${NOISE_G}
void main(){
  vec2 p = vP; float r = length(p), a = atan(p.y, p.x);
  float glow = (exp(-max(r - 0.9, 0.0) * 1.05) * 0.50 + exp(-r * 0.45) * 0.20) * uUp;
  vec3 outC = vec3(1.0, 0.80, 0.52) * glow * smoothstep(4.2, 2.6, r); float outA = 0.0;
  // 28 rays of running stitches, alternating long / short, slowly turning
  float ang = a - uRot, cell = floor(ang / TAU * 28.0 + 0.5), ra = cell / 28.0 * TAU;
  float dd = r * abs(sin(ang - ra)), odd = mod(cell, 2.0);
  float len = odd < 0.5 ? 2.75 : 2.05;
  float dash = step(0.40, fract((r - 1.16) / 0.30));
  float onRay = (1.0 - smoothstep(0.030, 0.042, dd)) * step(1.16, r) * step(r, len) * dash;
  vec3 rayC = odd < 0.5 ? vec3(1.0, 0.95, 0.72) : vec3(1.0, 0.60, 0.44);
  if (onRay > 0.5) { outC = rayC * 1.2; outA = 1.0; }
  if (r < 1.0) {
    vec3 felt = mix(vec3(1.0, 0.82, 0.34), vec3(1.0, 0.93, 0.62), 0.55 * smoothstep(1.0, 0.0, r));
    felt *= 0.92 + 0.16 * vn(p * 12.0);
    float rim = smoothstep(0.80, 0.84, r) * (1.0 - smoothstep(0.94, 0.985, r));
    felt = mix(felt, vec3(0.98, 0.58, 0.26), rim * 0.7);
    float rs = 1.0 - smoothstep(0.016, 0.030, abs(r - 0.885)), rd = step(0.42, fract(ang / TAU * 40.0));
    felt = mix(felt, vec3(1.0, 0.97, 0.86), rs * rd);
    float hd = length(abs(p) - vec2(0.27));
    felt = mix(felt, felt * 0.82, (smoothstep(0.10, 0.125, hd) * (1.0 - smoothstep(0.15, 0.18, hd))) * 0.6);
    felt = mix(felt, vec3(0.42, 0.14, 0.10), 1.0 - smoothstep(0.10, 0.125, hd));
    float lim = step(abs(p.x), 0.30) * step(abs(p.y), 0.30);
    float th = (1.0 - smoothstep(0.020, 0.036, min(abs(p.x - p.y), abs(p.x + p.y)) * 0.7071)) * lim;
    felt = mix(felt, vec3(1.0, 0.50, 0.38) * (0.85 + 0.3 * vn(p * 60.0)), th);
    outC = felt * 1.22; outA = 1.0;
  }
  gl_FragColor = vec4(outC, outA);
}`;
const MOON_FRAG = `${TWO_PI}
uniform float uUp; varying vec2 vP;
${NOISE_G}
void main(){
  vec2 p = vP; float r = length(p);
  float outer = r - 1.0, cut = length(p - vec2(0.50, 0.16)) - 0.84, sd = max(outer, -cut);
  float glow = exp(-max(r - 0.9, 0.0) * 1.7) * 0.26 * (1.0 - smoothstep(1.0, 2.1, r)) * uUp;      // round halo that reaches zero before the quad's edge
  vec3 outC = vec3(0.75, 0.78, 1.0) * glow; float outA = 0.0;
  if (sd < 0.0) {
    vec3 felt = vec3(1.0, 0.93, 0.70) * (0.93 + 0.14 * vn(p * 14.0));
    float st = 1.0 - smoothstep(0.014, 0.026, abs(sd + 0.10));
    float ang = atan(p.y - 0.06, p.x + 0.1), dsh = step(0.4, fract(ang / TAU * 22.0));
    felt = mix(felt, vec3(1.0, 0.72, 0.62), st * dsh);
    felt = mix(felt, felt * 0.86, smoothstep(-0.10, 0.0, sd));
    outC = felt * 1.05 * uUp; outA = uUp;
  }
  gl_FragColor = vec4(outC, outA);
}`;
const STAR_VERT = `attribute vec3 aDir; attribute vec4 aData; attribute vec3 aCol; uniform float uTime, uDusk; varying vec2 vP; varying vec3 vCol; varying float vK, vA;
void main(){
  vec3 d = normalize(mat3(viewMatrix) * aDir);
  vec3 r = abs(d.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), d));
  vec3 u = cross(d, r);
  float tw = 0.70 + 0.30 * sin(uTime * (1.3 + aData.y * 1.7) + aData.y * 40.0);
  float s = aData.x * (0.85 + 0.15 * tw);
  vec3 v = d * 100.0 + (r * position.x + u * position.y) * s * 100.0;
  vec4 p = projectionMatrix * vec4(v, 1.0); p.z = p.w * 0.9999; gl_Position = p;
  vP = position.xy; vCol = aCol; vK = aData.z; vA = uDusk * tw;
}`;
const STAR_FRAG = `varying vec2 vP; varying vec3 vCol; varying float vK, vA;
void main(){
  vec2 p = vP; float a = 0.0;
  if (vK < 0.60) { float s = pow(abs(p.x), 0.55) + pow(abs(p.y), 0.55); a = 1.0 - smoothstep(0.86, 1.0, s); }
  else if (vK < 0.84) { vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071; float s1 = pow(abs(p.x), 0.55) + pow(abs(p.y), 0.55), s2 = pow(abs(q.x), 0.55) + pow(abs(q.y), 0.55) * 1.0 + 0.55; a = max(1.0 - smoothstep(0.86, 1.0, s1), 0.85 * (1.0 - smoothstep(0.86, 1.0, s2 * 1.0))); }
  else { float r = length(p); a = 1.0 - smoothstep(0.80, 0.94, r); float hd = length(abs(p) - vec2(0.24)); a *= 1.0 - 0.85 * (1.0 - smoothstep(0.07, 0.11, hd)); a = max(a, 0.9 * (1.0 - smoothstep(0.02, 0.05, min(abs(p.x - p.y), abs(p.x + p.y)) * 0.7)) * step(length(p), 0.36)); }
  gl_FragColor = vec4(vCol * a * vA * 1.35, a * vA);
}`;

export function build(ctx) {
  const { M, root, FRONT, quality = 'full' } = ctx;
  const lite = quality === 'lite';
  const set = { name: 'sky', root };
  const rr = mkrng(2024);
  const U = { haze: { value: new THREE.Color(0xffe9c0) }, hazeD: { value: 560 }, hazeK: { value: 0.8 } };

  // =================================================================== the quilt ground
  const N = lite ? 96 : 128;
  const { col: colC, hgt: hgtC } = paintQuilt(lite ? 1024 : 2048, { seed: 11 });
  const map = new THREE.CanvasTexture(colC); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 16;
  const bump = new THREE.CanvasTexture(hgtC); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 16;
  const qmat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 5, roughness: 1, metalness: 0, vertexColors: true, fog: false });
  stitchify(qmat); boldHaze(qmat, U);
  const quilt = new THREE.Mesh(quiltGeometry(N), qmat); quilt.receiveShadow = false; quilt.castShadow = false; quilt.frustumCulled = false; quilt.name = 'quilt';
  root.add(quilt);

  // the mall's floor plane (90 x 90 at y = 0) is a checker patch appliqued onto the quilt: a fat piped edge with blanket stitches all round
  {
    const pipeM = M.cloth(0xff9ecb, { rep: 4 }); pipeM.fog = false;
    const H = 45, edge = new THREE.Group();
    const cyl = new THREE.CylinderGeometry(0.34, 0.34, 2 * H + 0.7, 12); cyl.rotateZ(PI / 2);
    for (const [x, z, ry] of [[0, -H, 0], [0, H, 0], [-H, 0, PI / 2], [H, 0, PI / 2]]) { const m = new THREE.Mesh(cyl, pipeM); m.position.set(x, -0.04, z); m.rotation.y = ry; m.receiveShadow = true; edge.add(m); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), pipeM); m.position.set(sx * H, -0.04, sz * H); edge.add(m); }
    // blanket stitches: short bars across the piping, cream and coral alternating
    const per = Math.floor(2 * H / 0.62), n = per * 4;
    const sg = new THREE.CylinderGeometry(0.055, 0.055, 0.6, 5, 1); sg.rotateX(PI / 2);      // long axis along z
    const sm = stitchify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, fog: false }));
    const im = new THREE.InstancedMesh(sg, sm, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let side = 0; side < 4; side++) for (let i = 0; i < per; i++) {
      const t = -H + (i + 0.5) * (2 * H / per), jit = (rr() - 0.5) * 0.08;
      const horizontal = side < 2, s = side % 2 ? 1 : -1;
      // stitches lie on the top surface of the piping, across it
      pp.set(horizontal ? t : s * H + jit, 0.27, horizontal ? s * H + jit : t);
      q.setFromAxisAngle(V3(0, 1, 0), horizontal ? 0 : PI / 2); m4.compose(pp, q, sc); im.setMatrixAt(k, m4);
      im.setColorAt(k, new THREE.Color(i % 2 ? 0xfff4e0 : 0xff8a6a)); k++;
    }
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; edge.add(im);
    root.add(edge);
  }

  // =================================================================== sky dome, sun, moon, stars
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.DoubleSide, depthWrite: false, fog: false,
    uniforms: { cZen: { value: new THREE.Color() }, cUp: { value: new THREE.Color() }, cMid: { value: new THREE.Color() }, cLow: { value: new THREE.Color() }, cHor: { value: new THREE.Color() },
      cSun: { value: new THREE.Color(1.0, 0.86, 0.6) }, uSunDir: { value: V3(0, 0, -1) }, uSunUp: { value: 1 }, uQuilt: { value: 1 }, uTime: { value: 0 } },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 28), skyMat); dome.frustumCulled = false; dome.renderOrder = -1000; dome.name = 'skyDome'; root.add(dome);

  const billMat = (frag, extra = {}) => new THREE.ShaderMaterial({
    vertexShader: BILL_VERT, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uDir: { value: V3(0, 0, -1) }, uDist: { value: SUN_DIST }, uHalf: { value: SUN_R * 4.4 }, uR: { value: SUN_R }, uRot: { value: 0 }, uUp: { value: 1 }, ...extra },
  });
  const sunMat = billMat(SUN_FRAG), sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat); sun.frustumCulled = false; sun.renderOrder = -900; sun.name = 'sunButton'; root.add(sun);
  const moonMat = billMat(MOON_FRAG); moonMat.uniforms.uHalf.value = MOON_R * 2.2; moonMat.uniforms.uR.value = MOON_R; moonMat.uniforms.uDir.value.copy(MOON_DIR);
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moonMat); moon.frustumCulled = false; moon.renderOrder = -890; moon.name = 'moon'; root.add(moon);

  const NS = lite ? 180 : 360;
  const sg = new THREE.InstancedBufferGeometry(); const base = new THREE.PlaneGeometry(2, 2);
  sg.index = base.index; sg.setAttribute('position', base.getAttribute('position')); sg.setAttribute('uv', base.getAttribute('uv'));
  const aDir = new Float32Array(NS * 3), aData = new Float32Array(NS * 4), aCol = new Float32Array(NS * 3);
  const starCols = [0xfff4e0, 0xfff0a6, 0xffb6d5, 0xa8e6ff, 0xfff4e0, 0xfff0a6].map((h) => new THREE.Color(h));
  for (let i = 0; i < NS; i++) {
    let d; for (let tries = 0; tries < 20; tries++) { const y = 0.05 + 0.95 * rr(), a = rr() * TAU, s = Math.sqrt(1 - y * y); d = V3(Math.cos(a) * s, y, Math.sin(a) * s); if (d.angleTo(MOON_DIR) > 0.22) break; }
    aDir.set([d.x, d.y, d.z], i * 3);
    const big = rr() < 0.12; aData.set([(big ? 0.017 : 0.007) + rr() * (big ? 0.010 : 0.007), rr(), rr(), 0], i * 4);
    const c = starCols[Math.floor(rr() * starCols.length)]; aCol.set([c.r, c.g, c.b], i * 3);
  }
  sg.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3)); sg.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4)); sg.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
  sg.instanceCount = NS;
  const starMat = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, uniforms: { uTime: { value: 0 }, uDusk: { value: 1 } } });
  const stars = new THREE.Mesh(sg, starMat); stars.frustumCulled = false; stars.renderOrder = -950; stars.name = 'stars'; root.add(stars);

  // =================================================================== quilted clouds (3 merged shapes, instanced) and cushion hills
  const cloudTex = (() => {
    const s = 512, c = canvas(s), g = c.getContext('2d'), b = canvas(s), h = b.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s); h.fillStyle = '#707070'; h.fillRect(0, 0, s, s);
    const n = 8, st = s / n;
    for (let i = -n; i < 2 * n; i++) for (const dir of [1, -1]) {
      const x0 = i * st; g.save(); g.setLineDash([9, 7]); g.lineCap = 'round'; g.strokeStyle = 'rgba(206,170,200,0.85)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + dir * s, s); g.stroke(); g.restore();
      h.strokeStyle = 'rgba(20,20,20,0.9)'; h.lineWidth = 9; h.beginPath(); h.moveTo(x0, 0); h.lineTo(x0 + dir * s, s); h.stroke();
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = (i + 0.5) * st, cy = (j + 0.5) * st; const gr = h.createRadialGradient(cx, cy, 0, cx, cy, st * 0.5); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); h.fillStyle = gr; h.fillRect(cx - st / 2, cy - st / 2, st, st); }
    const t1 = new THREE.CanvasTexture(c); t1.colorSpace = THREE.SRGBColorSpace; t1.wrapS = t1.wrapT = THREE.RepeatWrapping; t1.repeat.set(2, 1); t1.anisotropy = 8;
    const t2 = new THREE.CanvasTexture(b); t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.repeat.set(2, 1); t2.anisotropy = 8;
    return { map: t1, bump: t2 };
  })();
  const blob = (r, sx, sy, sz, x, y, z, seg = 12) => { const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
  const cloudGeos = [
    mergeGeometries([blob(1, 1, 0.62, 1, 0, 0, 0), blob(0.78, 1, 0.6, 1, 1.15, -0.1, 0.1), blob(0.72, 1, 0.6, 1, -1.05, -0.12, -0.1), blob(0.68, 1, 0.66, 1, 0.25, 0.5, 0.05), blob(0.5, 1, 0.6, 1, -0.4, 0.42, 0.4), blob(0.55, 1, 0.55, 1, 0.65, -0.05, 0.62)]),
    mergeGeometries([blob(0.7, 1.5, 0.5, 1, -2.2, 0, 0), blob(0.85, 1.4, 0.55, 1, -0.7, 0.05, 0.1), blob(0.9, 1.4, 0.58, 1, 0.9, 0.08, -0.05), blob(0.72, 1.4, 0.5, 1, 2.4, 0, 0.1), blob(0.55, 1.2, 0.5, 1, 0.1, 0.42, 0)]),
    mergeGeometries([blob(0.9, 1, 0.66, 1, 0, 0, 0), blob(0.7, 1, 0.66, 1, 1.0, 0.0, 0.2), blob(0.7, 1, 0.66, 1, -1.0, 0.0, -0.1), blob(0.62, 1, 0.66, 1, 0.5, 0.55, 0), blob(0.62, 1, 0.66, 1, -0.5, 0.55, 0.1), blob(0.42, 1, 0.66, 1, 0, 0.95, 0)]),
  ];
  const cloudMat = new THREE.MeshStandardMaterial({ map: cloudTex.map, bumpMap: cloudTex.bump, bumpScale: 3, roughness: 1, metalness: 0, fog: false, color: 0xffffff, emissive: 0x000000, emissiveMap: cloudTex.map });
  const NC = [lite ? 5 : 9, lite ? 3 : 6, lite ? 3 : 6];
  const clouds = [];
  cloudGeos.forEach((g, gi) => {
    const im = new THREE.InstancedMesh(g, cloudMat, NC[gi]); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.name = 'clouds' + gi;
    const items = [];
    for (let i = 0; i < NC[gi]; i++) {
      // the first half of each kind forms a low banner across the finale view (behind and beside the sun), the rest are scattered over the whole sky
      const hero = i < Math.ceil(NC[gi] * 0.5), h = hero ? H_VIEW_END + (rr() - 0.5) * 1.7 : rr() * TAU;
      const dist = hero ? 240 + rr() * 200 : 150 + rr() * 450, alt = hero ? 85 + rr() * 80 : 60 + rr() * 190, sc = hero ? 16 + rr() * 16 : 20 + rr() * 26;
      items.push({ x: Math.sin(h) * dist, y: alt, z: Math.cos(h) * dist, sc, rot: rr() * TAU, sq: 0.8 + rr() * 0.5, spd: 0.7 + rr() * 0.6 });
    }
    clouds.push({ im, items }); root.add(im);
  });
  const WIND = { x: 1.6, z: 0.7 }, WRAP = 700;

  // distant stuffed-cushion hills ring the horizon
  const hillGeo = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, PI / 2);
  const hmat = stitchify(new THREE.MeshStandardMaterial({ map: cloudTex.map, bumpMap: cloudTex.bump, bumpScale: 3, roughness: 1, fog: false }));
  const NH = lite ? 10 : 22;
  const hills = new THREE.InstancedMesh(hillGeo, boldHaze(hmat, U, 'hz'), NH); hills.frustumCulled = false; hills.name = 'hills';
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(), cols = [0xd9a7ff, 0xb6ffd6, 0xffb6d5, 0xa8e6ff, 0xfff0a6, 0xc9b6ff];
    for (let i = 0; i < NH; i++) {
      const a = (i + rr() * 0.6) / NH * TAU, dist = 285 + rr() * 45, w = 55 + rr() * 60, h = 20 + rr() * 26;
      pp.set(Math.cos(a) * dist, QUILT.y - 2, Math.sin(a) * dist); q.setFromAxisAngle(V3(0, 1, 0), rr() * TAU); sc.set(w, h, w * (0.8 + rr() * 0.4)); m4.compose(pp, q, sc);
      hills.setMatrixAt(i, m4); hills.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    }
    hills.instanceMatrix.needsUpdate = true; hills.instanceColor.needsUpdate = true; root.add(hills);
  }

  // =================================================================== scatter: felt lollipop trees and pompom bushes on the quilt (instanced)
  {
    const NT = lite ? 30 : 80, NB = lite ? 30 : 90;
    const trunkM = M.matte(0xffd9a8, { rep: 4 }), canopyM = M.matte(0xffffff, { rep: 5 }), bushM = M.matte(0xffffff, { rep: 5 }); [trunkM, canopyM, bushM].forEach((m) => (m.fog = false));
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 7), trunkM, NT), tops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), canopyM, NT), bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 7), bushM, NB);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(), cc = [0xb6ffd6, 0xffb6d5, 0xd9a7ff, 0xfff0a6, 0xa3f0c4, 0xffc9de];
    const free = (x, z) => FLAT.every(([x0, x1, z0, z1]) => !(x > x0 - 8 && x < x1 + 8 && z > z0 - 8 && z < z1 + 8));
    const spot = (minR, maxR) => { for (let k = 0; k < 40; k++) { const a = rr() * TAU, r = minR + Math.sqrt(rr()) * (maxR - minR), x = Math.cos(a) * r, z = Math.sin(a) * r; if (free(x, z)) return [x, z]; } return [200, 200]; };
    for (let i = 0; i < NT; i++) {
      const [x, z] = spot(52, 300), h = 3.2 + rr() * 4.5, gy = groundY(x, z);
      pp.set(x, gy + h / 2 - 0.1, z); q.identity(); sc.set(1, h, 1); m4.compose(pp, q, sc); trunks.setMatrixAt(i, m4);
      const r = 1.3 + rr() * 1.7; pp.set(x, gy + h + r * 0.55, z); sc.set(r, r * 1.05, r); m4.compose(pp, q, sc); tops.setMatrixAt(i, m4); tops.setColorAt(i, new THREE.Color(cc[i % cc.length]));
    }
    for (let i = 0; i < NB; i++) {
      const [x, z] = spot(50, 320), r = 0.9 + rr() * 1.4, gy = groundY(x, z);
      pp.set(x, gy + r * 0.3, z); q.setFromAxisAngle(V3(0, 1, 0), rr() * TAU); sc.set(r, r * 0.7, r); m4.compose(pp, q, sc); bushes.setMatrixAt(i, m4); bushes.setColorAt(i, new THREE.Color(cc[(i + 2) % cc.length]));
    }
    for (const im of [trunks, tops, bushes]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; root.add(im); }
  }

  // =================================================================== anchors
  const sunPos = (elev) => ({ x: SUN_DIR.x * Math.cos(elev) * SUN_DIST, y: Math.sin(elev) * SUN_DIST, z: SUN_DIR.z * Math.cos(elev) * SUN_DIST });
  set.anchors = {
    sun: sunPos(SUN_ELEV), sunDir: { x: SUN_DIR.x, z: SUN_DIR.z }, sunElev: SUN_ELEV, sunRadiusM: SUN_R, sunDist: SUN_DIST,
    moon: { x: MOON_DIR.x * SUN_DIST, y: MOON_DIR.y * SUN_DIST, z: MOON_DIR.z * SUN_DIST }, moonDir: { x: MOON_DIR.x, y: MOON_DIR.y, z: MOON_DIR.z },
    quiltY: QUILT.y, quiltHalf: QUILT.half, mallCentre: { x: MALL_C.x, z: MALL_C.z }, atelier: { x: ATELIER_C.x, z: ATELIER_C.z }, groundY,
  };
  set.slots = {};

  // =================================================================== rigs (world coordinates)
  const fromPitch = (pos, heading, pitchDown, L = 100) => [pos[0] + Math.sin(heading) * Math.cos(pitchDown) * L, pos[1] - Math.sin(pitchDown) * L, pos[2] + Math.cos(heading) * Math.cos(pitchDown) * L];
  const H0 = Math.atan2(F0.x, F0.z);        // heading (dir = (sin h, cos h)) of the finale axis, pointing from the mall toward the pull-out side
  set.rigs = {
    // high oblique over the mall roof from the pull-out side; the ring of colour crosses the quilt below.  Moves on u.p: a slow drift, +-4 degrees around and 30 m closer.
    aerialMall: (u) => {
      const p = u.p, h = H0 + 0.10 + 0.11 * p, dist = 270 - 34 * p, y = 108 + 7 * p;
      const pos = [MALL_C.x + Math.sin(h) * dist, y, MALL_C.z + Math.cos(h) * dist];
      return { pos, look: fromPitch(pos, h + PI - 0.05 * p, 0.215 - 0.02 * p), fov: 46 };
    },
    // slow orbit around the mall at 70 m, radius 105 m, looking at the roof.  Moves on u.p: 0.9 rad of orbit over the shot.
    orbitWorld: (u) => {
      const a = H0 - 0.55 + 0.9 * u.p, r = 105;
      return { pos: [MALL_C.x + Math.sin(a) * r, 70 + 4 * u.p, MALL_C.z + Math.cos(a) * r], look: [MALL_C.x, 11 + 3 * u.p, MALL_C.z], fov: 42 };
    },
    // low grazing view over the quilt toward the sun button, 2.4 m up.  Moves on u.p: 26 m of dolly toward the sun.
    horizon: (u) => {
      const sx = SUN_DIR.x, sz = SUN_DIR.z, p0 = [70 - sx * 0, 2.4, -78], hd = Math.atan2(sx, sz) + 0.16 - 0.05 * u.p;
      const pos = [p0[0] + sx * 26 * u.p, 2.4 + 0.5 * u.p, p0[2] + sz * 26 * u.p];
      return { pos, look: fromPitch(pos, hd, -0.02 + 0.015 * u.p), fov: 50 };
    },
    // straight down from 120 m on the roof and the ring; a slow quarter turn of the picture.  Moves on u.p.
    quiltTop: (u) => ({ pos: [MALL_C.x + 0.4, 120 + 6 * u.p, MALL_C.z + 3.5], look: [MALL_C.x + 0.4, 0, MALL_C.z + 3.4], fov: 46, roll: -0.25 + 0.55 * u.p }),
    // from the atelier roof looking up at the dusk sky: moon, stars, quilted clouds.  Moves on u.p: a slow tilt up.
    atelierSky: (u) => {
      const pos = [ATELIER_C.x - 1.0, 6.9, ATELIER_C.z + 0.6], hd = Math.atan2(MOON_DIR.x, MOON_DIR.z) + 0.50 - 0.10 * u.p, pitchUp = 0.66 + 0.16 * u.p;
      return { pos, look: [pos[0] + Math.sin(hd) * Math.cos(pitchUp) * 100, pos[1] + Math.sin(pitchUp) * 100, pos[2] + Math.cos(hd) * Math.cos(pitchUp) * 100], fov: 52 };
    },
    // low slow dolly across the dusk quilt between the mall and the atelier.  Moves on u.p: 22 m of travel.
    duskDrift: (u) => {
      const pos = [46 + 22 * u.p, 1.5, 58 - 3 * u.p], hd = Math.atan2(-0.55, -0.83) - 0.10 + 0.10 * u.p;
      return { pos, look: fromPitch(pos, hd, 0.05), fov: 54 };
    },
  };

  // =================================================================== the stitch front, styled for aerial views
  // Through FRONT (web/stitch.js): uFrontWidth = width (m; also scales the pink band, see boldHaze in sky_shared.js), uFrontNoise = noise (m, ragged edge),
  // uDash = dash (dashes around the ring), uThread = thread (colour).  The film copies these four onto FRONT while this set is on screen.
  set.front = (u, c2) => aerialFront(c2?.R);

  // =================================================================== light
  // dawn 0: a weak cool moon key (no shadow) and a lilac hemisphere;  dawn 1: a warm low sunrise key from the sun anchor's side (no shadow: aerial), gold-pink hemisphere.
  const cD = new THREE.Color(), cH1 = new THREE.Color(), cH2 = new THREE.Color();
  set.light = (kit, u, c2) => {
    const dawn = clamp(c2.args?.dawn ?? 1), k = smooth(dawn);
    const sunEl = 0.28, sdx = SUN_DIR.x * Math.cos(sunEl), sdz = SUN_DIR.z * Math.cos(sunEl), sdy = Math.sin(sunEl);
    const mdx = MOON_DIR.x, mdy = MOON_DIR.y, mdz = MOON_DIR.z;
    const dx = lerp(mdx, sdx, k), dy = lerp(mdy, sdy, k), dz = lerp(mdz, sdz, k), l = Math.hypot(dx, dy, dz);
    const tgt = [MALL_C.x, 0, MALL_C.z], hi = 700;      // the key always casts (so no material ever recompiles when the cut changes); here its shadow box sits 700 m up in empty sky, so the shadow pass draws nothing
    kit.setKey({ pos: [tgt[0] + dx / l * 60, tgt[1] + hi + dy / l * 60, tgt[2] + dz / l * 60], target: [tgt[0], tgt[1] + hi, tgt[2]], color: cD.set(0xa9b8ff).lerp(new THREE.Color(0xffc48e), k), i: lerp(0.5, 2.7, k), extent: 4, near: 1, far: 140 });
    kit.setHemi({ sky: cH1.set(0x8f8cf0).lerp(new THREE.Color(0xffdcc8), k), ground: cH2.set(0x4a3f8a).lerp(new THREE.Color(0xd0a0c8), k), i: lerp(0.95, 0.85, k) });
  };

  // =================================================================== update (pure functions of c2.t / u.t and c2.args.dawn)
  const ramp = skyRamp(1);
  const CLOUD_UNDER = new THREE.Color(0xffc49c);
  const mq = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp2 = new THREE.Vector3(), ss2 = new THREE.Vector3(), yAxis = V3(0, 1, 0);
  set.update = (u, c2) => {
    const t = c2?.t ?? u.t, dawn = clamp(c2?.args?.dawn ?? 1), k = smooth(dawn);
    const rmp = skyRamp(dawn);
    skyMat.uniforms.cZen.value.copy(rmp.zen); skyMat.uniforms.cUp.value.copy(rmp.up); skyMat.uniforms.cMid.value.copy(rmp.mid); skyMat.uniforms.cLow.value.copy(rmp.low); skyMat.uniforms.cHor.value.copy(rmp.hor);
    const sunUp = sstep(0.02, 0.8, dawn), el = lerp(-0.13, SUN_ELEV, sunUp);
    const sd = V3(SUN_DIR.x * Math.cos(el), Math.sin(el), SUN_DIR.z * Math.cos(el));
    skyMat.uniforms.uSunDir.value.copy(sd); skyMat.uniforms.uSunUp.value = lerp(0.18, 1, k); skyMat.uniforms.uTime.value = t;
    sunMat.uniforms.uDir.value.copy(sd); sunMat.uniforms.uRot.value = t * 0.035; sunMat.uniforms.uUp.value = sunUp;
    moonMat.uniforms.uUp.value = 1 - sstep(0.0, 0.6, dawn);
    starMat.uniforms.uTime.value = t; starMat.uniforms.uDusk.value = 1 - sstep(0.0, 0.55, dawn);
    U.haze.value.copy(rmp.hor).lerp(new THREE.Color(0xffe0d0), 0.0);
    cloudMat.emissive.set(0x2a2456).lerp(new THREE.Color(0xffd0c0), k).multiplyScalar(lerp(0.55, 0.5, k));
    const under = clamp(c2?.args?.cloudUnder ?? 0);      // looked at from below (through the open roof): sunrise lights the undersides, so the whole cloud glows gold instead of going brown
    if (under > 0) cloudMat.emissive.lerp(CLOUD_UNDER, under);
    // clouds drift with the wind (linear, wrapped, shrinking to nothing at the wrap edge)
    clouds.forEach(({ im, items }) => {
      items.forEach((c, i) => {
        let x = c.x + WIND.x * c.spd * t, z = c.z + WIND.z * c.spd * t;
        x = ((x + WRAP / 2) % WRAP + WRAP) % WRAP - WRAP / 2; z = ((z + WRAP / 2) % WRAP + WRAP) % WRAP - WRAP / 2;
        const edge = Math.min(WRAP / 2 - Math.abs(x), WRAP / 2 - Math.abs(z)), s = c.sc * smooth(edge / 60);
        pp2.set(x, c.y, z); qq.setFromAxisAngle(yAxis, c.rot); ss2.set(s * 1.5, s * c.sq, s * 1.1); mq.compose(pp2, qq, ss2); im.setMatrixAt(i, mq);
      });
      im.instanceMatrix.needsUpdate = true;
    });
  };

  set.post = { band: 0.40, tilt: 1.7, focusY: 0.52 };
  root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.fog = false; });      // the world is looked at from far away: no scene fog on any of it
  return set;
}
