// Gags and hero props: the things that make a viewer say "oh, that's clever".   (owner: gags)
//
// EXPORT TABLE (everything takes the material factory M first; every prop is built once, then only moved)
//   makeThreadLine(M, {segments,radius,color,glow,sides,helix,helixTurns,helixSpeed}) -> { obj, set(pathFn | Vector3[] | [x,y,z][], reveal=1, t=0), tipAt(reveal) }
//        a glowing pink tube whose vertices are rewritten in place each frame; reveal 0..1 draws the first part with a bright tip; helix = lazy helical wobble (metres)
//   makeStitchTrail(M, n, {len,thick,color,pop}) -> { obj, set(pathFn | points, p=1, {up:[x,y,z], lift, side}) }   n instanced running stitches along a path, revealed by p (0..1), newest one pops
//   makeSparklePop(M, {n,size,colors}) -> { obj, set(p, pos=[x,y,z], scale=1) }     one draw call star burst (billboarded instanced quads), p<0 or p>1 hides it
//   makeFluffPuff(M, {size}) -> { obj, set(p, pos=[x,y,z], scale=1) }               6 blobs of cotton stuffing, p in 0..1
//   makeLooseArm(M, char, side=1) -> arm     a visual copy of one arm of a made-over zombie that tumbles free (see ARM GAG below)
//   armGag(u, sock, opt) -> record            pure function of u (seconds since the gag started, about 6.2 s long)
//   ARM_GAG_LENGTH                            seconds
//   reachArm(char, side, worldTarget, pole?)  two-bone IK: poses shL/elL or shR/elR so the hand centre reaches a world point (Pip's hand follows armGag().pipHand)
//   makeBeansCan(M, {r,h,spoon,note,alive}) -> Group     felt can of beans, stitched rims, curling pull-tab, canvas label, "LAST ONE" note; g.userData.spoon = the spoon (with a bean)
//   makeScrap(M, color, {w,h,alive}) -> Group            torn scrap of printed fabric, origin at the middle of the TOP edge (put it in a hand); hangs down, fringed, hem-stitched
//   makeTeacup(M, {saucer,steam,alive}) -> Group         cup + saucer, origin at the middle of the saucer bottom; g.userData.grip = handle centre (cup frame); g.userData.steam(t)
//   holdUpright(prop, joint, {yaw, at:[x,y,z], grip:[x,y,z]})   call every frame after posing: parents the prop to the joint (elR/elL), keeps it upright in world space; grip = the point of the prop (e.g. cup.userData.grip) that sits in the mitt
//   makeSewNeedle(M, len)                               a small always-pink-threaded sewing needle prop for the arm repair
//
// ARM GAG: add arm.obj to the scene (or to a Group with an identity transform).  Every frame:
//     const g = armGag(u, shoulderWorldPos, { rotY, scale, tableDrop, saucer, pip });   arm.apply(g);
//   apply() moves the loose arm, hides J.shR while the arm is off, shows the tidy socket patch, the pink seam stitches, the bow,
//   the cotton puff and the sparkle.  The zombie's own acting is still the film's job; g.zombie.{shR,elR} gives the right-arm pose
//   that matches the loose arm at the moment of the swap (use it whenever g.realArmVisible), g.wobble is a decaying body jolt.
//   g.pipHand is the world point Pip's right hand should be at (reachArm), or null when she is idle.  g.pipStand [x,z] (world), g.pipYaw and g.pipLean
//   are where Pip's feet, facing and forward lean must be (she steps in to the arm, carries it, sews, steps back): set position, rotation.y, pose body [pipLean,0,0], THEN reachArm.
//   Pass sock = the REAL shoulder joint in world space (J.shR.getWorldPosition, so wobble and posture are included); Pip's right shoulder is 1.115 above her floor and
//   her arm reaches 0.43, so the socket must be no more than about 0.3 above her shoulder (a seated tea party is right; a very tall standing zombie misses by up to 6 cm).
//   opt.pip should be BEHIND-right of the zombie ([+0.6, -0.28] x scale in the zombie frame) so that her head never covers the socket from the front.
import * as THREE from 'three';
import { stitchify } from './stitch.js';
import { add, makeBow } from './chars.js';
import { starSprite, glowSprite } from './set.js';
import { clamp, lerp, smooth, smoother, hash, keys } from './util.js';
const PI = Math.PI, TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------- small helpers
// build with a makeover state: K = {value:1} keeps a thing in full colour whatever the world is doing; K = null follows the world (the spatial front)
function withK(M, K, fn) {
  const pk = M.currentK, ps = M.sew; M.currentK = K; M.sew = false;
  try { return fn(); } finally { M.currentK = pk; M.sew = ps; }
}
const ALIVE = () => ({ value: 1 });
const v3 = (a, out = new THREE.Vector3()) => (Array.isArray(a) ? out.set(a[0], a[1], a[2]) : out.set(a.x, a.y, a.z));
// canvas text needs the Fredoka face: draw now, and again when the font arrives (sets are built synchronously)
function withFont(draw) {
  draw();
  try { if (typeof document !== 'undefined' && document.fonts && !document.fonts.check('40px Fredoka')) document.fonts.load('40px Fredoka').then(() => draw()).catch(() => {}); } catch (e) { /* no fonts API: keep the first drawing */ }
}
function canvasTex(w, h, paint, { srgb = true, aniso = 4 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); if (srgb) tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
  withFont(() => { const g = c.getContext('2d'); g.clearRect(0, 0, w, h); paint(g, w, h); tex.needsUpdate = true; });
  return tex;
}
// a printed felt/cloth material: our own colour map + the factory's fibre bump, obeying the dead/alive world (or K)
function printMat(M, map, { bump = 1.8, rep = 6, rough = 1, side = THREE.DoubleSide, emissive = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, side, bumpMap: M.fabricTex ? M.fabricTex(rep) : null, bumpScale: bump });
  if (emissive) { m.emissive.setRGB(emissive, emissive, emissive); m.emissiveMap = map; }
  return stitchify(m, M.currentK, false);
}
// sample any path description at s in 0..1 into a Vector3.  Accepts f(s) -> Vector3 | [x,y,z], or an array of points (Catmull-Rom through them)
function pathSampler(src) {
  if (typeof src === 'function') { const tmp = new THREE.Vector3(); return (s, out) => { const r = src(s); return v3(r ?? tmp, out); }; }
  const P = src.map((p) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p)); const n = P.length - 1;
  if (n < 1) return (s, out) => out.copy(P[0]);
  return (s, out) => {
    const f = clamp(s) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)], t2 = t * t, t3 = t2 * t;
    const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    return out.set(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
  };
}
const easeOutBack = (x, k = 1.9) => { x = clamp(x) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };

// ---------------------------------------------------------------------------------------------------------------- THREAD LINE
// A tube rewritten in place: no geometry is created after the build.  Always alive, slightly emissive, with a hot bead at the reveal tip.
export function makeThreadLine(M, o = {}) {
  const { segments = 96, radius = 0.018, color = 0xff5fa8, glow = 0.6, sides = 6, helix = 0, helixTurns = 5, helixSpeed = 1.6 } = o;
  const N = segments + 1, S = sides, NV = N * S;
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), col = new Float32Array(NV * 3), cen = new Float32Array(N * 3);
  const idx = [];
  for (let i = 0; i < segments; i++) for (let j = 0; j < S; j++) { const a = i * S + j, b = i * S + (j + 1) % S, c = (i + 1) * S + j, d = (i + 1) * S + (j + 1) % S; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mat = withK(M, ALIVE(), () => M.thread(color));
  mat.emissive.set(color); mat.emissiveIntensity = glow; mat.vertexColors = true; mat.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  const tip = withK(M, ALIVE(), () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.glow(0xffb6dc, 1.2)));
  tip.frustumCulled = false; tip.visible = false; tip.castShadow = false;
  const obj = new THREE.Group(); obj.add(mesh, tip);
  const A = new THREE.Vector3(), T = new THREE.Vector3(), N1 = new THREE.Vector3(), N2 = new THREE.Vector3(), C = new THREE.Vector3();
  const ref = new THREE.Vector3(0.36, 0.71, 0.6).normalize();
  let lastSrc = null, sample = null;
  function set(src, reveal = 1, t = 0) {
    if (src !== lastSrc) { sample = pathSampler(src); lastSrc = src; }
    reveal = clamp(reveal); const last = reveal * segments;
    for (let i = 0; i < N; i++) { sample(i / segments, A); cen[i * 3] = A.x; cen[i * 3 + 1] = A.y; cen[i * 3 + 2] = A.z; }
    const at = (f, out) => { const i0 = Math.min(N - 2, Math.floor(f)), k = f - i0; return out.set(lerp(cen[i0 * 3], cen[i0 * 3 + 3], k), lerp(cen[i0 * 3 + 1], cen[i0 * 3 + 4], k), lerp(cen[i0 * 3 + 2], cen[i0 * 3 + 5], k)); };
    mesh.visible = reveal > 0.002;
    for (let i = 0; i < N; i++) {
      const f = Math.min(i, last);
      at(f, C);
      at(Math.max(0, f - 0.5), A); at(Math.min(N - 1, f + 0.5), T); T.sub(A);
      if (T.lengthSq() < 1e-12) T.set(0, 1, 0); T.normalize();
      N1.crossVectors(T, ref).normalize(); N2.crossVectors(T, N1);
      if (helix > 0) {
        const s = f / segments, env = smooth(s / 0.15) * (0.55 + 0.45 * Math.sin(s * 7 + 1.3)), a = TAU * helixTurns * s - t * helixSpeed;
        C.addScaledVector(N1, Math.cos(a) * helix * env).addScaledVector(N2, Math.sin(a) * helix * env);
      }
      const hot = reveal < 0.999 ? smooth((f - (last - 9)) / 9) : 0, shimmer = 1 + 0.10 * Math.sin(f * 0.55 - t * 5.0);
      const r = radius * (i > last ? 0 : 1) * (1 - 0.35 * smooth((f - (last - 2.5)) / 2.5) * (reveal < 0.999 ? 1 : 0));
      const cr = (lerp(1, 1.5, hot)) * shimmer, cg = (lerp(1, 1.35, hot)) * shimmer, cb = (lerp(1, 1.5, hot)) * shimmer;
      for (let j = 0; j < S; j++) {
        const a = (j / S) * TAU, ca = Math.cos(a), sa = Math.sin(a), nx = N1.x * ca + N2.x * sa, ny = N1.y * ca + N2.y * sa, nz = N1.z * ca + N2.z * sa, k = (i * S + j) * 3;
        pos[k] = C.x + nx * r; pos[k + 1] = C.y + ny * r; pos[k + 2] = C.z + nz * r; nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz; col[k] = cr; col[k + 1] = cg; col[k + 2] = cb;
      }
      if (i === N - 1 || i === Math.ceil(last)) { /* keep C for the tip bead below */ }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    tip.visible = reveal > 0.002 && reveal < 0.999;
    if (tip.visible) { at(last, C); tip.position.copy(C); tip.scale.setScalar(radius * (1.5 + 0.35 * Math.sin(t * 14))); }
  }
  return { obj, mesh, tip, set, segments };
}

// ---------------------------------------------------------------------------------------------------------------- STITCH TRAIL
// n running stitches along a path.  set(path, p): stitches whose place along the path is <= p are there, the newest pops in.  up = the surface normal they lie on.
export function makeStitchTrail(M, n = 24, o = {}) {
  const { len = 0.05, thick = 0.008, color = 0xff5fa8, glow = 0.8 } = o;
  const geo = new THREE.CapsuleGeometry(thick, len, 2, 6); geo.rotateZ(PI / 2);
  const mat = withK(M, ALIVE(), () => M.thread(color)); mat.emissive.set(color); mat.emissiveIntensity = glow;
  const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.castShadow = false; im.count = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), P = new THREE.Vector3(), P2 = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let lastSrc = null, sample = null;
  function set(src, p = 1, opt = {}) {
    if (src !== lastSrc) { sample = pathSampler(src); lastSrc = src; }
    if (opt.up) v3(opt.up, UP); else UP.set(0, 1, 0);
    const lift = opt.lift ?? thick * 0.6, pop = opt.pop ?? 0.7 / n, total = n; let cnt = 0;
    for (let i = 0; i < total; i++) {
      const s = (i + 0.5) / total; if (s > p + 1e-6) break;
      sample(s, P); sample(Math.min(1, s + 0.5 / total), P2); sample(Math.max(0, s - 0.5 / total), X); P2.sub(X);
      X.copy(P2); if (X.lengthSq() < 1e-14) X.set(1, 0, 0); X.normalize();
      Y.copy(UP).addScaledVector(X, -UP.dot(X)); if (Y.lengthSq() < 1e-8) Y.set(0, 1, 0).addScaledVector(X, -X.y); Y.normalize(); Z.crossVectors(X, Y);
      m4.makeBasis(X, Y, Z); q.setFromRotationMatrix(m4);
      P.addScaledVector(Y, lift);
      const k = clamp((p - s) / pop); const g = k < 1 ? easeOutBack(k, 2.2) : 1;
      sc.set(g, g, g); m4.compose(P, q, sc); im.setMatrixAt(cnt++, m4);
    }
    im.count = cnt; im.instanceMatrix.needsUpdate = true; im.visible = cnt > 0;
  }
  return { obj: im, set };
}

// ---------------------------------------------------------------------------------------------------------------- SPARKLE POP and FLUFF PUFF
// billboarded instanced quads: one draw call, additive; the shader keeps the quad facing the camera
// a crisp four-point star with a hot core (additive), so the burst reads as sparkles and not as bokeh
function star4Tex(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), h = size / 2;
  const rg = g.createRadialGradient(h, h, 0, h, h, h * 0.42); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, size, size);
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(h, 1); g.quadraticCurveTo(h + 4, h - 4, size - 1, h); g.quadraticCurveTo(h + 4, h + 4, h, size - 1); g.quadraticCurveTo(h - 4, h + 4, 1, h); g.quadraticCurveTo(h - 4, h - 4, h, 1); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeSparklePop(M, o = {}) {
  const { n = 11, size = 0.16, colors = [0xffffff, 0xfff0a8, 0xffc4ec, 0xbff3ff] } = o;
  const tex = star4Tex(128);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { map: { value: tex }, gain: { value: 1.7 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vC; void main(){ vUv = uv; vC = vec3(1.0);\n#ifdef USE_INSTANCING_COLOR\n vC = instanceColor;\n#endif\n vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float sc = length(instanceMatrix[0].xyz); mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; uniform float gain; varying vec2 vUv; varying vec3 vC; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vC * gain, t.a); }',
  });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n); im.frustumCulled = false; im.visible = false;
  const D = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(i * 3.1) * 0.5, el = (hash(i * 7.7) - 0.3) * 1.1, sp = 0.6 + hash(i * 5.3) * 0.8;
    D.push({ d: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), sp, s: (0.55 + hash(i * 9.1) * 0.75) * (i === 0 ? 1.7 : 1), ph: hash(i * 2.9) });
    im.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), P = new THREE.Vector3(), sc = new THREE.Vector3(), Q0 = new THREE.Quaternion();
  function set(p, pos = [0, 0, 0], scale = 1) {
    im.visible = p >= 0 && p <= 1; if (!im.visible) return;
    const c = v3(pos, new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const d = D[i], e = 1 - Math.pow(1 - p, 2.4);
      P.copy(c).addScaledVector(d.d, (i === 0 ? 0 : 0.5 * d.sp * e) * scale); P.y += 0.05 * scale * e;
      const life = smooth(p / 0.12) * (1 - smooth((p - 0.35) / 0.65)) * (0.75 + 0.25 * Math.sin((p * 22 + d.ph * 6)));
      const s = size * scale * d.s * Math.max(0, life); sc.set(s, s, s); m4.compose(P, Q0, sc); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return { obj: im, set };
}

export function makeFluffPuff(M, o = {}) {
  const { size = 0.035 } = o;
  const mat = withK(M, ALIVE(), () => M.cloth(0xffffff, { rep: 8 })); mat.emissive.set(0xfff6ee); mat.emissiveIntensity = 0.32;          // cotton stays white under any light
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, 6); im.frustumCulled = false; im.visible = false; im.castShadow = false;
  const D = [];
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4, el = 0.35 + hash(i * 4.4) * 0.9; D.push({ d: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), sp: 0.6 + hash(i * 6.1) * 0.6, s: 0.7 + hash(i * 8.3) * 0.7, rot: hash(i * 3.3) * TAU }); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), sc = new THREE.Vector3();
  function set(p, pos = [0, 0, 0], scale = 1) {
    im.visible = p >= 0 && p <= 1; if (!im.visible) return;
    const c = v3(pos, new THREE.Vector3());
    for (let i = 0; i < 6; i++) {
      const d = D[i], burst = 1 - Math.pow(1 - clamp(p / 0.6), 2.2);
      P.copy(c).addScaledVector(d.d, 0.13 * d.sp * burst * scale); P.y += (0.06 * burst - 0.22 * p * p) * scale;
      const s = size * d.s * scale * smooth(p / 0.1) * (1 - smooth((p - 0.55) / 0.45)); sc.set(s * 1.1, s * 0.85, s);
      e.set(d.rot + p * 2, d.rot * 0.7 - p * 3, 0); q.setFromEuler(e); m4.compose(P, q, sc); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return { obj: im, set };
}

// ---------------------------------------------------------------------------------------------------------------- shared prop pieces
function ringStitches(M, { r, y = 0, n, color = 0xfff4e0, thick = 0.004, len = 0.022, glow = 0 }) {
  const g = new THREE.CapsuleGeometry(thick, len, 2, 5); g.rotateZ(PI / 2);
  const m = M.thread(color); if (glow) { m.emissive.set(color); m.emissiveIntensity = glow; }
  const im = new THREE.InstancedMesh(g, m, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; q.setFromAxisAngle(up, -(a + PI / 2)); p.set(Math.cos(a) * r, y, Math.sin(a) * r); m4.compose(p, q, s1); im.setMatrixAt(i, m4); }
  im.castShadow = false; im.frustumCulled = false; return im;
}
const glazed = (M, c, rough = 0.25) => M.plastic(c, { rough });

// ---------------------------------------------------------------------------------------------------------------- BEANS CAN
function labelPaint(g, w, h) {
  g.fillStyle = '#ff9a78'; g.fillRect(0, 0, w, h);
  // faint cloth weave
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 3; for (let y = 0; y < h; y += 9) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // top and bottom bands (butter) with cream running stitches
  g.fillStyle = '#ffe066'; g.fillRect(0, 0, w, 62); g.fillRect(0, h - 62, w, 62);
  g.strokeStyle = '#fff4e0'; g.lineWidth = 6; g.lineCap = 'round'; g.setLineDash([22, 16]);
  for (const y of [78, h - 78]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.setLineDash([]);
  const cx = w / 2;
  // BEANS
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '190px Fredoka'; g.lineJoin = 'round';
  g.lineWidth = 26; g.strokeStyle = '#7a3b2e'; g.strokeText('BEANS', cx, 232); g.fillStyle = '#fff4e0'; g.fillText('BEANS', cx, 232);
  g.font = '44px Fredoka'; g.lineWidth = 9; g.strokeStyle = '#7a3b2e'; g.strokeText('extra saucy!', cx, 290); g.fillStyle = '#ffe066'; g.fillText('extra saucy!', cx, 290);
  // a cartoon bean on either side of the word, and a big smiling one below
  const bean = (x, y, s, rot, face) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
    g.fillStyle = '#7a3b2e'; g.beginPath(); g.ellipse(0, 0, 62, 41, 0, 0, TAU); g.fill();
    g.fillStyle = '#c1662f'; g.beginPath(); g.ellipse(0, -2, 56, 35, 0, 0, TAU); g.fill();
    g.fillStyle = '#e0873f'; g.beginPath(); g.ellipse(-12, -13, 30, 13, -0.2, 0, TAU); g.fill();
    g.fillStyle = '#7a3b2e'; g.beginPath(); g.ellipse(34, 8, 7, 4.5, 0.6, 0, TAU); g.fill();
    if (face) {
      g.fillStyle = '#3b1f1a'; for (const ex of [-17, 9]) { g.beginPath(); g.ellipse(ex, 0, 5.5, 7.5, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#fff'; for (const ex of [-15, 11]) { g.beginPath(); g.arc(ex, -3, 2.2, 0, TAU); g.fill(); }
      g.strokeStyle = '#3b1f1a'; g.lineWidth = 4.5; g.beginPath(); g.arc(-4, 8, 11, 0.15 * PI, 0.85 * PI); g.stroke();
      g.fillStyle = 'rgba(255,120,150,0.65)'; for (const ex of [-30, 24]) { g.beginPath(); g.ellipse(ex, 12, 8, 5, 0, 0, TAU); g.fill(); }
    }
    g.restore();
  };
  bean(cx - 320, 200, 1.0, -0.5, true); bean(cx + 320, 200, 1.0, 0.45, true); bean(cx - 190, 318, 0.55, 0.3, false); bean(cx + 190, 312, 0.55, -0.35, false);
  // a little star
  g.fillStyle = '#ffe066'; g.strokeStyle = '#7a3b2e'; g.lineWidth = 6; g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? 14 : 34, a = -PI / 2 + i * PI / 5; g[i ? 'lineTo' : 'moveTo'](cx + 250 + Math.cos(a) * rr, 122 + Math.sin(a) * rr); } g.closePath(); g.fill(); g.stroke();
}
function notePaint(g, w, h) {
  g.fillStyle = '#fff8dc'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,150,220,0.35)'; g.lineWidth = 2; for (let y = 34; y < h; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // hand lettering: every letter a little off
  const word = 'LAST ONE', f = 74; g.font = `${f}px Fredoka`; g.fillStyle = '#3b2a4d'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = 34; for (let i = 0; i < word.length; i++) { const ch = word[i], wd = g.measureText(ch).width; g.save(); g.translate(x + wd / 2, h / 2 + (hash(i * 3.3) - 0.5) * 12); g.rotate((hash(i * 7.1) - 0.5) * 0.28); g.fillText(ch, -wd / 2, 0); g.restore(); x += wd + (ch === ' ' ? 4 : 5); }
  g.strokeStyle = '#3b2a4d'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(40, h - 20); g.quadraticCurveTo(w / 2, h - 10, w - 40, h - 26); g.stroke();
}

export function makeBeansCan(M, o = {}) {
  const { r = 0.1, h = 0.26, spoon = true, note = true, alive = false } = o;
  return withK(M, alive ? ALIVE() : (o.K ?? null), () => {
    const g = new THREE.Group(); g.name = 'beansCan';
    const tin = M.metal(0xdde1ea), tinDark = M.metal(0xc4c9d6), gold = glazed(M, 0xffd45e, 0.22);
    // body: a lathe with rounded rolled edges
    const prof = [[0.001, 0], [r - 0.012, 0], [r - 0.004, 0.004], [r, 0.014], [r, h - 0.014], [r - 0.004, h - 0.004], [r - 0.012, h], [0.001, h]].map((p) => new THREE.Vector2(p[0], p[1]));
    add(g, new THREE.LatheGeometry(prof, 48), tin, {});
    for (const y of [0.012, h - 0.012]) add(g, new THREE.TorusGeometry(r + 0.001, 0.0085, 8, 48), tinDark, { y, rx: PI / 2 });          // rolled rims
    // paper label: a cylinder shell centred on +z
    const tex = canvasTex(1024, 448, labelPaint);
    const lab = add(g, new THREE.CylinderGeometry(r + 0.003, r + 0.003, h - 0.075, 64, 1, true, -PI, TAU), printMat(M, tex, { bump: 1.4, rep: 7 }), { y: h / 2 });
    lab.castShadow = false;
    // lid: recessed disc, a ring groove, a rivet and the curling pull-tab
    add(g, new THREE.CylinderGeometry(r - 0.012, r - 0.012, 0.006, 40), tinDark, { y: h - 0.003 });
    add(g, new THREE.TorusGeometry(r * 0.62, 0.0035, 6, 40), tin, { y: h + 0.001, rx: PI / 2 });
    add(g, new THREE.SphereGeometry(0.011, 12, 8), gold, { y: h + 0.006, x: -0.012, sy: 0.6 });
    const tabPts = [[-0.012, 0.006, 0], [0.02, 0.008, 0], [0.058, 0.014, 0], [0.083, 0.036, 0], [0.078, 0.066, 0], [0.05, 0.078, 0], [0.028, 0.066, 0]].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const tab = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tabPts), 32, 0.0075, 8, false), gold); tab.scale.set(1, 1, 2.1); tab.position.set(0, h, 0); tab.castShadow = true; g.add(tab);
    add(g, new THREE.TorusGeometry(0.016, 0.0055, 8, 20), gold, { x: 0.036, y: h + 0.012, rx: PI / 2 - 0.2, sy: 1.15 });
    // stitched rims, top and bottom (the felt can is sewn together)
    const s1 = ringStitches(M, { r: r + 0.0105, y: h - 0.0125, n: 46, color: 0xfff4e0 }), s2 = ringStitches(M, { r: r + 0.0105, y: 0.0125, n: 46, color: 0xfff4e0 }); g.add(s1, s2);
    // the note: LAST ONE, taped on at a tilt
    if (note) {
      const nt = canvasTex(512, 210, notePaint), th = 0.5, rr = r + 0.0085;                    // low on the label, off to the right: BEANS stays readable
      const noteG = new THREE.Group(); noteG.position.set(Math.sin(th) * rr, h * 0.3, Math.cos(th) * rr); noteG.rotation.y = th; g.add(noteG);
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.118, 0.0483), printMat(M, nt, { bump: 0.5, rep: 8 })); paper.rotation.z = -0.11; noteG.add(paper);
      const tapeM = new THREE.MeshStandardMaterial({ color: 0xfff0a6, roughness: 0.5, transparent: true, opacity: 0.8, side: THREE.DoubleSide }); stitchify(tapeM, M.currentK, false);
      for (const sx of [-1, 1]) { const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.014), tapeM); tp.position.set(sx * 0.052, 0.022 - sx * 0.005, 0.0012); tp.rotation.z = sx * 0.6 - 0.11; noteG.add(tp); }
    }
    // the spoon: felt handle, deep bowl, one bean on it
    if (spoon) {
      const sp = new THREE.Group(), steel = M.metal(0xeef1f6);
      const bowl = add(sp, new THREE.SphereGeometry(0.036, 20, 12), steel, { sx: 0.8, sy: 0.42, sz: 1.05 }); bowl.position.set(0, 0, 0.0);
      add(sp, new THREE.CapsuleGeometry(0.0085, 0.2, 3, 8), steel, { y: 0.0, z: -0.12, rx: PI / 2 - 0.12 });
      add(sp, new THREE.SphereGeometry(0.014, 10, 8), M.plastic(0xff5fa8, { rough: 0.3 }), { z: -0.235, y: 0.02, sx: 1.2 });          // pink bead on the end
      const beanM = M.matte(0xc1662f, { rep: 6 });
      add(sp, new THREE.SphereGeometry(0.024, 14, 10), beanM, { y: 0.02, sx: 0.85, sy: 0.6, sz: 1.2, rz: 0.2 });
      g.userData.spoon = sp; sp.visible = false; g.add(sp);
    }
    g.userData.r = r; g.userData.h = h;
    return g;
  });
}

// ---------------------------------------------------------------------------------------------------------------- SCRAP OF FABRIC
function scrapPaint(color) {
  const c = new THREE.Color(color), hex = (k) => '#' + c.clone().multiplyScalar(k).getHexString();
  const alt = new THREE.Color(color).offsetHSL(0.5, 0.15, -0.06);
  return (g, w, h) => {
    g.fillStyle = hex(1); g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.10)'; for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 3);
    // small flowers
    for (let i = 0; i < 26; i++) {
      const x = ((i * 137.5) % 1) * 0 + hash(i * 1.7) * (w - 90) + 45, y = hash(i * 2.3 + 9) * (h - 140) + 70, s = 0.8 + hash(i * 5.9) * 0.7, rot = hash(i * 3.1) * TAU;
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
      g.fillStyle = i % 3 === 0 ? '#fff4e0' : (i % 3 === 1 ? '#' + alt.getHexString() : '#ffd6e8');
      for (let k = 0; k < 5; k++) { g.save(); g.rotate((k / 5) * TAU); g.beginPath(); g.ellipse(0, -15, 9, 14, 0, 0, TAU); g.fill(); g.restore(); }
      g.fillStyle = '#ffe066'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.restore();
      if (i % 2 === 0) { g.fillStyle = '#' + new THREE.Color(0xa9e6b8).getHexString(); g.beginPath(); g.ellipse(x + 26 * s, y + 18 * s, 6, 12, 0.9, 0, TAU); g.fill(); }
    }
    // hem: cream running stitches on three sides (the bottom is torn)
    g.strokeStyle = '#fff4e0'; g.lineWidth = 6; g.lineCap = 'round'; g.setLineDash([22, 14]);
    g.beginPath(); g.moveTo(26, h - 30); g.lineTo(26, 26); g.lineTo(w - 26, 26); g.lineTo(w - 26, h - 30); g.stroke(); g.setLineDash([]);
  };
}
export function makeScrap(M, color = 0xffd9ea, o = {}) {
  const { w = 0.34, h = 0.42, alive = false } = o;
  return withK(M, alive ? ALIVE() : (o.K ?? null), () => {
    const g = new THREE.Group(); g.name = 'scrap';
    const geo = new THREE.PlaneGeometry(w, h, 16, 20), P = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);      // v: 0 bottom .. 1 top
      const zig = Math.abs(((u * 9) % 1) * 2 - 1) * 2 - 1, noise = (hash(Math.round(u * 16) * 3.7) - 0.5) * 0.02;
      const yb = -h / 2 + 0.02 * (zig * 0.5 + 0.5) + noise;                     // torn bottom edge
      const y = lerp(yb, h / 2, v), x = (u - 0.5) * w * (1 + 0.03 * Math.sin(v * 9 + u * 3));
      const drape = (1 - v);
      P.setXYZ(i, x, y - h / 2, 0.055 * Math.sin(u * PI * 2.2 + 0.6) * drape * drape + 0.05 * drape * drape - 0.012 * Math.cos(u * 7 + v * 5) * drape);
    }
    geo.computeVertexNormals();
    const map = canvasTex(512, 640, scrapPaint(color));
    const mesh = new THREE.Mesh(geo, printMat(M, map, { bump: 1.6, rep: 6 })); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    // fringe of loose threads along the torn edge
    const fg = new THREE.CapsuleGeometry(0.0035, 0.05, 2, 4), fm = M.thread(new THREE.Color(color).offsetHSL(0, 0, 0.12).getHex());
    const nF = 22, fr = new THREE.InstancedMesh(fg, fm, nF), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s1 = new THREE.Vector3();
    for (let i = 0; i < nF; i++) {
      const u = (i + 0.5) / nF, x = (u - 0.5) * w * 0.98, zz = 0.05 * Math.sin(u * PI * 2.2 + 0.6) + 0.05, L = 0.7 + hash(i * 4.1) * 0.9;
      e.set(0, 0, (hash(i * 2.2) - 0.5) * 0.7); q.setFromEuler(e); p.set(x, -h + 0.012 - 0.027 * L, zz - 0.004); s1.set(1, L, 1); m4.compose(p, q, s1); fr.setMatrixAt(i, m4);
    }
    fr.castShadow = false; fr.frustumCulled = false; g.add(fr);
    // a tiny hanging loop-tab at the top so it looks held
    g.userData = { w, h }; return g;
  });
}

// ---------------------------------------------------------------------------------------------------------------- TEACUP
export function makeTeacup(M, o = {}) {
  const { saucer = true, steam = true, alive = false } = o;
  return withK(M, alive ? ALIVE() : (o.K ?? null), () => {
    const g = new THREE.Group(); g.name = 'teacup';
    const glaze = glazed(M, 0xfff4e0, 0.18), pink = glazed(M, 0xff9ecb, 0.2), gold = glazed(M, 0xffd45e, 0.2);
    let y0 = 0;
    if (saucer) {
      const sp = [[0.001, 0.0], [0.045, 0.0], [0.05, 0.006], [0.098, 0.016], [0.105, 0.022], [0.101, 0.024], [0.06, 0.012], [0.001, 0.010]].map((p) => new THREE.Vector2(p[0], p[1]));
      add(g, new THREE.LatheGeometry(sp, 40), glaze, {}); add(g, new THREE.TorusGeometry(0.103, 0.0035, 6, 40), gold, { y: 0.0225, rx: PI / 2 });
      y0 = 0.011;
    }
    const cp = [[0.001, 0.0], [0.028, 0.0], [0.034, 0.006], [0.052, 0.03], [0.06, 0.07], [0.062, 0.084], [0.058, 0.084], [0.055, 0.07], [0.048, 0.03], [0.001, 0.014]].map((p) => new THREE.Vector2(p[0], p[1]));
    const cup = new THREE.Group(); cup.position.y = y0; g.add(cup);
    add(cup, new THREE.LatheGeometry(cp, 40), glaze, {}); add(cup, new THREE.TorusGeometry(0.0605, 0.004, 6, 40), gold, { y: 0.084, rx: PI / 2 });
    add(cup, new THREE.TorusGeometry(0.0585, 0.0075, 6, 40), pink, { y: 0.034, rx: PI / 2 });
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; add(cup, new THREE.SphereGeometry(0.0055, 8, 6), glazed(M, 0xffe066, 0.3), { x: Math.cos(a) * 0.0605, y: 0.056, z: Math.sin(a) * 0.0605, cast: false }); }
    add(cup, new THREE.CylinderGeometry(0.052, 0.052, 0.004, 32), M.matte(0xb5682f, { rep: 4 }), { y: 0.072 });                 // the tea
    add(cup, new THREE.TorusGeometry(0.03, 0.0085, 8, 24, PI * 1.15), gold, { x: 0.064, y: 0.052, rz: -PI * 0.5 - 0.12 * PI * 0.5 * 0, sy: 1.25 });   // handle
    g.userData.grip = [0.083, y0 + 0.052, 0]; g.userData.cup = cup; g.userData.rim = [0, y0 + 0.084, 0];
    if (steam) {
      const tex = glowSprite(64), wisps = [];
      const sg = new THREE.Group(); sg.position.set(0, y0 + 0.09, 0); g.add(sg);
      for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })); sg.add(s); wisps.push(s); }
      g.userData.steam = (t) => wisps.forEach((s, i) => { const k = ((t * 0.45 + i / 4) % 1); s.position.set(Math.sin(k * 6 + i * 2) * 0.012, k * 0.15, Math.cos(k * 5 + i) * 0.01); const sc = 0.035 + 0.05 * k; s.scale.set(sc, sc, 1); s.material.opacity = 0.42 * Math.sin(k * PI) * 0.8; });
      g.userData.steam(0);
    }
    return g;
  });
}

// keep a prop upright in world space while its parent joint rotates (a cup does not tip out of a mitt).  parent it to the hand joint (el), call after pose().
export function holdUpright(prop, joint, o = {}) {
  const { yaw = 0, at = [0, -0.215, 0], grip = null } = o;           // grip: a point in the prop's own frame (e.g. a cup's userData.grip) that is placed on `at`
  if (prop.parent !== joint) joint.add(prop);
  joint.updateWorldMatrix(true, false);
  const qw = new THREE.Quaternion(); joint.getWorldQuaternion(qw);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  // remove the joint's world scale as well (characters are scaled by their height)
  const sc = new THREE.Vector3(); joint.getWorldScale(sc);
  prop.quaternion.copy(qw).invert().multiply(qy); prop.position.set(at[0], at[1], at[2]); prop.scale.set(1 / sc.x, 1 / sc.y, 1 / sc.z);
  if (grip) prop.position.sub(new THREE.Vector3(grip[0] * prop.scale.x, grip[1] * prop.scale.y, grip[2] * prop.scale.z).applyQuaternion(prop.quaternion));
}

// a small sewing needle with a pink thread through the eye (for the arm repair)
export function makeSewNeedle(M, len = 0.16) {
  return withK(M, ALIVE(), () => {
    const g = new THREE.Group(), st = M.metal(0xeef2f8);
    add(g, new THREE.CylinderGeometry(0.0038, 0.0038, len, 8), st, { y: len * 0.5, cast: false });
    add(g, new THREE.ConeGeometry(0.0038, len * 0.16, 8), st, { y: len + len * 0.05, cast: false });
    add(g, new THREE.TorusGeometry(0.0068, 0.0022, 6, 14), st, { y: -0.004, cast: false });
    g.userData.eye = new THREE.Vector3(0, -0.004, 0); g.userData.tipLen = len * 1.13;
    return g;
  });
}

// ---------------------------------------------------------------------------------------------------------------- IK for one arm
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
// pose shL/elL (side -1) or shR/elR (side +1) so the centre of the hand sits at `target` (world).  pole = world direction the elbow bulges toward (default down and outward)
export function reachArm(char, side, target, pole) {
  const J = char.obj.userData.J, sh = side < 0 ? J.shL : J.shR, el = side < 0 ? J.elL : J.elR, parent = sh.parent;
  parent.updateWorldMatrix(true, false);
  const T = parent.worldToLocal(v3(target, new THREE.Vector3())), S = sh.position.clone();
  const sc = new THREE.Vector3(); parent.getWorldScale(sc); const l1 = 0.215, l2 = 0.215 + 0.0;
  const v = T.clone().sub(S); let d = v.length(); const dmax = (l1 + l2) * 0.999, dmin = Math.abs(l1 - l2) + 0.02; d = clamp(d, dmin, dmax); v.normalize();
  const pw = pole ? v3(pole, new THREE.Vector3()) : new THREE.Vector3(side * 0.45, -1, -0.15);
  const wq = new THREE.Quaternion(); parent.getWorldQuaternion(wq); const P = pw.clone().applyQuaternion(wq.clone().invert()).normalize();
  const qh = P.clone().addScaledVector(v, -P.dot(v)); if (qh.lengthSq() < 1e-6) qh.set(side, -1, 0); qh.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), a = Math.acos(cosA);
  const u1 = v.clone().multiplyScalar(Math.cos(a)).addScaledVector(qh, Math.sin(a)).normalize();
  const cosE = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1), thetaE = PI - Math.acos(cosE);
  const yAx = u1.clone().negate(), zAx = qh.clone().negate().addScaledVector(u1, qh.dot(u1)).normalize(), xAx = new THREE.Vector3().crossVectors(yAx, zAx).normalize();
  _m.makeBasis(xAx, yAx, zAx.crossVectors(xAx, yAx)); _e.setFromRotationMatrix(_m, 'XYZ');
  sh.rotation.set(_e.x, _e.y, _e.z); el.rotation.set(-thetaE, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------- THE ARM GAG
export const ARM_GAG_LENGTH = 6.5;
const T_POP = 0.8, T_LAND = 1.28, T_LAND2 = 1.53, T_REST = 2.05, T_LIFT0 = 2.5, T_LIFT1 = 3.0, T_CARRY1 = 3.65, T_SEW0 = 3.7, T_SEW1 = 4.75, T_SWAP = 4.8, T_BOW = 5.2;
const HOLD = { shR: [-0.35, 0, 0.14], elR: [-0.3, 0, 0] };          // the arm hanging at the tea table (rotation of the real shoulder / elbow joints)
const SIP = { shR: [-0.66, 0, 0.1], elR: [-1.98, 0, 0] };             // the cup at the mouth
const _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _ea = new THREE.Euler();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// 1 = cup raised at the mouth, 0 = cup down on the saucer
function sipK(u) {
  if (u < 0.25) return 1;
  if (u < 0.75) return 1 - smooth((u - 0.25) / 0.5);
  if (u < T_BOW + 0.05) return 0;
  return smooth((u - (T_BOW + 0.05)) / 0.6);
}

// u: seconds since the gag began.  sock: the shoulder joint in world coordinates (Vector3 or [x,y,z]).
// opt: rotY (zombie facing, radians), scale (zombie height scale), tableDrop (metres from the shoulder down to the table top, default 0.36 * scale),
//      saucer [dx,dz] (zombie frame, where the saucer stands, default [0.09,0.58]*scale), pip [dx,dz] (Pip's position in the zombie frame, use [0.6,-0.28]*scale), restZ (arm's resting z, default 0.43*scale)
//      z1, z2 (metres forward of the shoulder where the arm first lands / hops to; default 0.31*scale, 0.36*scale: raise them when the table's edge is further away), sewDist / pickDist (metres from the socket / the arm at which Pip stands to sew / to pick it up; default 0.27, 0.3)
// The arm's orientation is a quaternion (arm.quat) and the same thing as Euler angles in order 'XZY' (arm.rot = [rx, roll about its own axis, rz]).
export function armGag(u, sock, opt = {}) {
  const s = opt.scale ?? 1, rotY = opt.rotY ?? 0, cR = Math.cos(rotY), sR = Math.sin(rotY);
  const S0 = v3(sock, new THREE.Vector3());
  const W = (x, y, z) => [S0.x + x * cR + z * sR, S0.y + y, S0.z - x * sR + z * cR];       // zombie frame -> world
  const Wd = (x, y, z) => [x * cR + z * sR, y, -x * sR + z * cR];                            // a direction
  const T = -(opt.tableDrop ?? 0.36 * s), sauc = opt.saucer ?? [0.09 * s, 0.58 * s], pipXZ = opt.pip ?? [0.66 * s, 0.42 * s];
  const sockOut = 0.03 * s, yTab = T + 0.05 * s;                                             // the repaired arm sits a hair outside the shoulder; origin height when the arm lies on the table
  const xr = 0.08 * s;                                                                        // where the rolled arm's shoulder end ends up (beside the saucer)
  const x1 = 0.12 * s, z1 = opt.z1 ?? 0.31 * s, x2 = 0.15 * s, z2 = opt.z2 ?? 0.36 * s, z3 = opt.restZ ?? Math.max(z2, sauc[1] - 0.105 * s - 0.045 * s);        // opt.restZ: where the arm comes to rest along the zombie's z (default just behind the saucer; raise it if a skirt hides it)
  const out = {
    arm: { pos: W(0, 0, 0), rot: [0, 0, 0], quat: [0, 0, 0, 1], visible: false, elbow: [HOLD.elR[0], 0, 0] }, realArmVisible: true, patch: false,
    wobble: 0, puff: -1, puffPos: W(0.1 * s, 0.0, 0), spark: -1, sparkPos: W(0.22 * s, 0.06 * s, 0.03 * s), bow: 0, seam: 0,
    needle: { visible: false, pos: W(0, 0, 0), dir: [0, -1, 0] }, thread: { visible: false, from: W(0, 0, 0), to: W(0, 0, 0) }, cupRattle: 0, cupK: sipK(u),
    pipHand: null, pipStand: [W(pipXZ[0], 0, pipXZ[1])[0], W(pipXZ[0], 0, pipXZ[1])[2]], pipYaw: 0, pipLean: 0, phase: 'sip', zombie: { shR: SIP.shR.slice(), elR: SIP.elR.slice(), nod: 0 }, length: ARM_GAG_LENGTH,
  };
  // the zombie's own arm while attached: sips, sets the cup down, and after the repair sips again
  const k = sipK(u);
  out.zombie.shR = SIP.shR.map((x, i) => lerp(HOLD.shR[i], x, k)); out.zombie.elR = SIP.elR.map((x, i) => lerp(HOLD.elR[i], x, k));
  const jolt = (t0, a) => { const t = u - t0; return t < 0 ? 0 : a * Math.exp(-t * 7.5) * Math.sin(t * 34); };
  out.wobble = jolt(T_POP, 1) + jolt(T_SWAP, 0.35);
  const tn = u - (T_BOW + 0.65); out.zombie.nod = tn > 0 && tn < 0.7 ? Math.sin(tn / 0.7 * PI) : 0;    // the unbothered nod after the first sip
  if (u < T_POP) { out.phase = u < 0.25 ? 'sip' : 'set down'; out.pipYaw = Math.atan2(S0.x - out.pipStand[0], S0.z - out.pipStand[1]); return out; }

  // ---- the arm is off
  out.arm.visible = u < T_SWAP; out.realArmVisible = u >= T_SWAP; out.patch = u < T_SWAP;
  out.puff = u < T_POP + 0.9 ? (u - T_POP) / 0.9 : -1;
  const tau = u - T_POP;
  let pos, rx, roll, rz;
  const g = 9.0, vy = 1.4, tL = T_LAND - T_POP, yF = (t) => vy * t - 0.5 * g * t * t;           // flight one: a champagne-cork pop
  if (u < T_LAND) {
    const f = tau / tL;
    pos = [lerp(0, x1, f), yF(tau) * s + (yTab - yF(tL) * s) * f * f, lerp(0, z1, f)];
    rx = lerp(HOLD.shR[0], HOLD.shR[0] - 4.9, f); rz = lerp(HOLD.shR[2], 1.38, smooth(f)); roll = lerp(0, 1.1, f); out.phase = 'pop';
  } else if (u < T_LAND2) {
    const f = (u - T_LAND) / (T_LAND2 - T_LAND);                                                 // one hop
    pos = [lerp(x1, x2, f), yTab + 4 * f * (1 - f) * 0.085 * s, lerp(z1, z2, f)];
    rx = lerp(HOLD.shR[0] - 4.9, -6.2, f); rz = lerp(1.38, 1.5, f); roll = lerp(1.1, 1.9, f); out.phase = 'bounce';
  } else if (u < T_REST) {
    const f = (u - T_LAND2) / (T_REST - T_LAND2), e = 1 - Math.pow(1 - f, 2.6);                  // rolls, slows, bumps the saucer
    const bump = f > 0.82 ? Math.sin((f - 0.82) / 0.18 * PI) * 0.012 * s : 0;
    pos = [lerp(x2, xr, e), yTab, lerp(z2, z3, e) - bump]; rx = -6.2; rz = lerp(1.5, PI / 2, e); roll = lerp(1.9, 5.5, e); out.phase = 'roll';
  } else if (u < T_LIFT0) {
    pos = [xr, yTab, z3]; rx = -6.2; rz = PI / 2; roll = 5.5; out.phase = 'lies';
  } else if (u < T_LIFT1) {
    const f = smoother((u - T_LIFT0) / (T_LIFT1 - T_LIFT0)), sw = Math.sin((u - T_LIFT0) * 9) * (1 - f) * 0.18;     // Pip lifts it by the middle: a small pendulum swing
    pos = [xr + 0.02 * s * f, yTab + 0.2 * s * f, z3 + 0.02 * s * f]; rx = -6.2 + sw; rz = lerp(PI / 2, 1.2, f); roll = 5.5 + f * 0.4; out.phase = 'lift';
  } else if (u < T_CARRY1) {
    const f = smoother((u - T_LIFT1) / (T_CARRY1 - T_LIFT1)), sw = Math.sin((u - T_LIFT1) * 7) * (1 - f) * 0.1;
    pos = [lerp(xr + 0.02 * s, sockOut, f), lerp(yTab + 0.2 * s, 0, f) + 0.05 * s * Math.sin(f * PI), lerp(z3 + 0.02 * s, 0, f)];
    rx = lerp(-6.2, HOLD.shR[0] - TAU, f) + sw; rz = lerp(1.2, HOLD.shR[2], f); roll = lerp(5.9, TAU, f); out.phase = 'carry';
  } else {
    const tug = u < T_SEW1 ? Math.pow(Math.max(0, Math.sin((u - T_SEW0) * TAU * 3.4)), 6) * 0.008 * s : 0;           // the arm is tugged a little at every stitch
    const snug = u < T_SEW1 - 0.2 ? 1 : 1 - smooth((u - (T_SEW1 - 0.2)) / 0.25);                                     // the last stitch pulls the arm home, so the swap to the real arm does not jump
    pos = [sockOut * snug + tug * 0.4, -tug, 0]; rx = HOLD.shR[0]; rz = HOLD.shR[2]; roll = 0; out.phase = u < T_SWAP ? 'sew' : 'bow';
  }
  // the elbow: floppy after the pop, then it relaxes
  const eS = -0.05;                                                                            // settled: the forearm lies almost straight on the table
  const elbow = u < T_LIFT0 ? eS + (HOLD.elR[0] - eS) * Math.exp(-tau * 5) + 1.1 * Math.exp(-tau * 2.4) * Math.sin(tau * 11.0)
    : (u < T_CARRY1 ? lerp(eS, HOLD.elR[0], smooth((u - T_LIFT0) / (T_CARRY1 - T_LIFT0))) + 0.05 * Math.sin(u * 9) * (u < T_LIFT1 ? 1 : 0.3) : HOLD.elR[0]);
  // while it lies on the table the arm is turned about the vertical so that its hand points back across the table top (not out over the edge)
  const psi = u < T_LAND2 ? 0 : u < T_REST ? PI * smooth((u - T_LAND2) / (T_REST - T_LAND2)) : u < T_LIFT1 ? PI : u < T_CARRY1 ? PI * (1 - smoother((u - T_LIFT1) / (T_CARRY1 - T_LIFT1))) : 0;
  _qa.setFromEuler(_ea.set(rx, roll, rz, 'XZY')); _qy.setFromAxisAngle(Y_AXIS, rotY + psi); const qw = _qy.multiply(_qa);      // orientation in the world
  out.arm.pos = W(pos[0], pos[1], pos[2]); out.arm.quat = [qw.x, qw.y, qw.z, qw.w]; _ea.setFromQuaternion(qw, 'XZY'); out.arm.rot = [_ea.x, _ea.y, _ea.z]; out.arm.elbow = [elbow, 0, 0];
  const tb = T_LAND2 + 0.82 * (T_REST - T_LAND2);                                             // the bump against the saucer rattles the cup
  out.cupRattle = u > tb ? Math.exp(-(u - tb) * 4.2) * Math.sin((u - tb) * 62) : 0;

  // Pip's right hand: she reaches for the middle of the arm, carries it, then holds the needle
  if (u >= 2.15 && u < T_CARRY1) {
    const along = new THREE.Vector3(0, -1, 0).applyQuaternion(qw), p0 = new THREE.Vector3(out.arm.pos[0], out.arm.pos[1], out.arm.pos[2]);
    const grip = p0.addScaledVector(along, 0.2 * s);
    if (u < T_LIFT0) { const f = smooth((u - 2.15) / 0.35), st = W(pipXZ[0] * 0.9, T + 0.42 * s, pipXZ[1] * 0.9); out.pipHand = [lerp(st[0], grip.x, f), lerp(st[1], grip.y, f), lerp(st[2], grip.z, f)]; }
    else out.pipHand = [grip.x, grip.y, grip.z];
  }
  // the needle circles the seam while Pip stitches; the thread trails back to her other hand
  if (u >= T_CARRY1 - 0.1 && u < T_SWAP) {
    const f = clamp((u - T_SEW0) / (T_SEW1 - T_SEW0)), th = f * TAU + 0.6, rr = 0.06 * s, dip = Math.sin(f * TAU * 9);
    const ax = new THREE.Vector3(0.14, -0.93, 0.34).normalize(), e1 = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0, 0, 1)).normalize(), e2 = new THREE.Vector3().crossVectors(ax, e1);
    const c = new THREE.Vector3(sockOut + 0.012 * s, -0.04 * s, 0);
    const pr = c.clone().addScaledVector(e1, Math.cos(th) * rr).addScaledVector(e2, Math.sin(th) * rr).addScaledVector(ax, 0.022 * s * dip);
    const toP = new THREE.Vector3(pipXZ[0], 0, pipXZ[1]).normalize(), dir = ax.clone().multiplyScalar(0.55).addScaledVector(toP, -0.45).normalize();
    const nd = Wd(dir.x, dir.y, dir.z), tipW = W(pr.x, pr.y, pr.z), fade = smooth((u - (T_CARRY1 - 0.1)) / 0.25);
    out.needle = { visible: fade > 0.01, pos: tipW, dir: nd, fade };
    const eye = [tipW[0] - nd[0] * 0.16 * s, tipW[1] - nd[1] * 0.16 * s, tipW[2] - nd[2] * 0.16 * s];
    out.thread = { visible: fade > 0.01, from: eye, to: W(pipXZ[0] * 0.55, 0.18 * s + 0.05 * s * Math.sin(u * 3), pipXZ[1] * 0.62) };
    out.pipHand = [tipW[0] - nd[0] * 0.11 * s, tipW[1] - nd[1] * 0.11 * s, tipW[2] - nd[2] * 0.11 * s];
    out.seam = smooth((u - T_SEW0) / (T_SEW1 - T_SEW0));
  }
  if (u >= T_SWAP) {
    out.seam = 1;
    const b = (u - T_SWAP) / (T_BOW - T_SWAP + 0.15); out.bow = easeOutBack(b, 2.6); out.spark = u < T_SWAP + 0.9 ? (u - T_SWAP) / 0.9 : -1;
    if (u < T_SWAP + 0.35) out.pipHand = out.pipHand ?? W(sockOut + 0.1 * s, 0.1 * s, 0.1 * s);
  }
  // Pip's feet and lean (metres, world XZ; her right shoulder is 0.165 to her right and 1.115 above her floor, her arm reaches 0.43): she steps in to the arm, carries it to the socket, steps back
  {
    const P0 = W(pipXZ[0], 0, pipXZ[1]), toward = (A, dist) => { const dx = P0[0] - A[0], dz = P0[2] - A[2], l = Math.hypot(dx, dz) || 1; return [A[0] + dx / l * dist, A[2] + dz / l * dist]; };
    const armG = W(xr - 0.13 * s, 0, z3), sew = toward(W(sockOut, 0, 0), opt.sewDist ?? 0.27), pick = toward(armG, opt.pickDist ?? 0.3), rest = [P0[0], P0[2]];
    const mix2 = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    let st = rest, lean = 0, face = W(0, 0, 0);
    if (u >= 2.1 && u < T_LIFT1) { const f = smoother((u - 2.1) / 0.6); st = mix2(rest, pick, f); lean = 0.5 * f; face = armG; }
    else if (u >= T_LIFT1 && u < T_SEW0) { const f = smoother((u - T_LIFT1) / (T_SEW0 - T_LIFT1)); st = mix2(pick, sew, f); lean = lerp(0.5, 0.32, f); face = [lerp(armG[0], S0.x, f), 0, lerp(armG[2], S0.z, f)]; }
    else if (u >= T_SEW0 && u < T_BOW + 0.1) { st = sew; lean = 0.32; face = [S0.x, 0, S0.z]; }
    else if (u >= T_BOW + 0.1) { const f = smoother((u - T_BOW - 0.1) / 0.7); st = mix2(sew, rest, f); lean = 0.32 * (1 - f); face = [S0.x, 0, S0.z]; }
    out.pipStand = st; out.pipLean = lean; out.pipYaw = Math.atan2(face[0] - st[0], face[2] - st[1]);
  }
  return out;
}

// a free copy of one arm of a zombie; tumbles through the gag.  The character's own arm is hidden while this one is out.
export function makeLooseArm(M, char, side = 1) {
  const J = char.obj.userData.J, sh = side < 0 ? J.shL : J.shR, body = J.body;
  const wrap = new THREE.Group(); wrap.name = 'looseArm';
  const clone = sh.clone(true); clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0); clone.rotation.order = 'XZY'; clone.visible = false;
  clone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const el = clone.children.find((c) => c.isGroup); if (el) el.rotation.set(-1.9, 0, 0);
  clone.scale.copy(char.obj.scale); wrap.add(clone);
  // effects (world space, so the wrapper must not be transformed)
  const puff = makeFluffPuff(M), spark = makeSparklePop(M); wrap.add(puff.obj, spark.obj);
  // the tidy socket: a stitched round patch under the puff sleeve, only while the arm is off
  const i = char.i ?? 0, patchCol = [0x9fe3ff, 0xffd08a, 0xb6ffd6, 0xffd08a, 0x9fe3ff, 0xb6ffd6, 0x9fe3ff][i % 7];
  const patch = new THREE.Group();
  {
    const pk = M.currentK, ps = M.sew; M.currentK = char.K; M.sew = false;
    const disc = add(patch, new THREE.CylinderGeometry(0.036, 0.036, 0.009, 28), M.cloth(patchCol, { rep: 5 }), {}); disc.rotation.z = 0;
    add(patch, new THREE.TorusGeometry(0.034, 0.005, 6, 28), M.cloth(new THREE.Color(patchCol).multiplyScalar(0.86).getHex(), { rep: 5 }), { y: 0.005, rx: PI / 2 });
    const st = ringStitches(M, { r: 0.028, y: 0.0075, n: 12, color: 0xfff4e0, thick: 0.0032, len: 0.013 }); patch.add(st);
    const cross = ringStitches(M, { r: 0.007, y: 0.0078, n: 3, color: 0xff5fa8, thick: 0.0028, len: 0.016 }); patch.add(cross);
    M.currentK = pk; M.sew = ps;
    // sits on the underside of the puff sleeve, facing outward and down
    const n = new THREE.Vector3(side * 0.384, -0.923, 0).normalize(), c = new THREE.Vector3(side * 0.1927, 1.0724, 0).addScaledVector(n, 0.003);
    patch.position.copy(c); patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); patch.visible = false; body.add(patch);
  }
  // pink seam stitches around the top of the arm (one ring on the loose arm, one on the real arm for after the repair) and the bow
  const seamA = withK(M, ALIVE(), () => ringStitches(M, { r: 0.037, y: -0.026, n: 14, color: 0xff5fa8, thick: 0.0042, len: 0.02, glow: 0.7 }));
  const seamB = withK(M, ALIVE(), () => ringStitches(M, { r: 0.037, y: -0.026, n: 14, color: 0xff5fa8, thick: 0.0042, len: 0.02, glow: 0.7 }));
  seamA.count = 0; seamB.visible = false; clone.add(seamA); sh.add(seamB);
  const bow = withK(M, ALIVE(), () => makeBow(M, 0xff2f86, 0.95)); bow.position.set(side * 0.232, 1.13, 0.075); bow.rotation.set(-0.35, side * 0.7, side * -0.5); bow.visible = false; body.add(bow);
  const qs = new THREE.Quaternion();
  const api = {
    obj: wrap, clone, patch, bow, puff, spark, seamLoose: seamA, seamReal: seamB,
    // place(pos, rot) with rot in Euler order XZY, or place(armRecord) with the record from armGag().arm
    place(a, rot) {
      if (a && a.pos) { clone.position.set(a.pos[0], a.pos[1], a.pos[2]); if (a.quat) clone.quaternion.set(a.quat[0], a.quat[1], a.quat[2], a.quat[3]); else clone.rotation.set(a.rot[0], a.rot[1], a.rot[2]); if (el && a.elbow) el.rotation.set(a.elbow[0], a.elbow[1] || 0, a.elbow[2] || 0); clone.visible = a.visible !== false; }
      else { const p = Array.isArray(a) ? a : [a.x, a.y, a.z]; clone.position.set(p[0], p[1], p[2]); if (rot) { clone.rotation.order = 'XZY'; clone.rotation.set(rot[0], rot[1], rot[2]); } clone.visible = true; }
    },
    // apply a whole armGag() record: moves the loose arm, hides/shows the real arm, patch, seam, bow, puff and sparkle
    apply(g, opt = {}) {
      api.place(g.arm);
      sh.visible = g.realArmVisible;
      patch.visible = !!g.patch;
      seamA.count = Math.round(clamp(g.seam) * 14); seamA.visible = seamA.count > 0 && g.arm.visible;
      seamB.visible = g.realArmVisible && g.seam >= 1;
      const bs = clamp(g.bow, 0, 1.6) * 1.55; bow.visible = g.bow > 0.001; bow.scale.setScalar(Math.max(0.001, bs));
      puff.set(g.puff, g.puffPos, opt.scale ?? char.obj.scale.x); spark.set(g.spark, g.sparkPos, opt.scale ?? char.obj.scale.x);
      return api;
    },
    reset() { clone.visible = false; sh.visible = true; patch.visible = false; seamB.visible = false; bow.visible = false; puff.set(-1); spark.set(-1); },
  };
  void qs; return api;
}
