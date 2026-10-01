// Extension module of the mall: the catwalk for pre-chorus 2 ("No more biting, no more screams, just catwalk struts and fashion dreams").
//   build(ctx, mall) -> ext = { name, root, slots, rigs, path(s, lane), update(u, c2), light(kit, u, c2), post, anchors }
// A 14 m felt runway (12.4 m stem + 5.4 m T bar) on the right side of the atrium, parallel to the shop wall, so the low tracking
// camera sees the arcade and its pillars behind the walkers.  Curtain and monogram at the far (start) end, photo pit at the T end.
//
// Runway-local frame: origin at the centre of the curtain end, +z = the walking direction (world -x), +x = world +z (toward the front of the mall).
// path(s, lane): s 0..1 walks from the curtain mouth to the T; 1..1.2 the pose and turn on the spot; 1.2..2.2 walks back to the curtain.  lane -1..1 = +-0.6 m.
// c2.beat drives the footlight chase, the audience and the sweeping spots; flashes come from c2.t (at most 3 per second, small sprites, never full frame).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add } from '../chars.js';
import { stitchify } from '../stitch.js';
import { starSprite } from '../set.js';
import { hash, smooth, smoother, clamp, lerp } from '../util.js';
const PI = Math.PI;
const FONT = '"DejaVu Sans", "Liberation Sans", Arial, sans-serif';   // never Fredoka in a canvas (load timing differs between processes)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rbox = (w, h, d, r = 0.05, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));

function stitchLines(parent, lines, color, { spacing = 0.2, len = 0.1, thick = 0.02, seed = 1 } = {}) {
  const segs = []; let n = 0;
  for (const pts of lines) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = cum[cum.length - 1], c = Math.max(1, Math.round(L / spacing)); segs.push({ pts, cum, L, c }); n += c;
  }
  const g = new THREE.CapsuleGeometry(thick, len, 2, 5); g.rotateX(PI / 2);
  const im = new THREE.InstancedMesh(g, stitchify(new THREE.MeshStandardMaterial({ color, roughness: 1 })), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qj = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), zz = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), tg = new THREE.Vector3();
  let k = 0;
  for (const sg of segs) for (let i = 0; i < sg.c; i++) {
    const s = (i + 0.5) / sg.c * sg.L; let j = 0; while (j < sg.pts.length - 2 && sg.cum[j + 1] < s) j++;
    const f = (s - sg.cum[j]) / Math.max(1e-6, sg.cum[j + 1] - sg.cum[j]);
    p.lerpVectors(sg.pts[j], sg.pts[j + 1], f); tg.subVectors(sg.pts[j + 1], sg.pts[j]).normalize();
    q.setFromUnitVectors(zz, tg); qj.setFromAxisAngle(up, (hash(k * 1.7 + seed) - 0.5) * 0.22); q.multiply(qj);
    sc.set(1, 1, 0.9 + hash(k * 3.1 + seed) * 0.25); m4.compose(p, q, sc); im.setMatrixAt(k++, m4);
  }
  im.castShadow = false; im.receiveShadow = false; parent.add(im); return im;
}
const arcPts = (cx, cz, r, a0, a1, n, y) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return V3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); });
// a chunky glowing polyline (merged into one geometry: cylinders + joint spheres)
function polyTube(pts, r) {
  const gs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = b.clone().sub(a), L = d.length(); if (L < 1e-5) continue;
    const g = new THREE.CylinderGeometry(r, r, L, 8, 1); g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()), V3(1, 1, 1))); gs.push(g);
  }
  for (const p of pts) { const g = new THREE.SphereGeometry(r, 8, 6); g.translate(p.x, p.y, p.z); gs.push(g); }
  return mergeGeometries(gs);
}
function signTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const flat = (map, side = THREE.FrontSide) => stitchify(new THREE.MeshStandardMaterial({ map, roughness: 1, side }));

// a spot cone whose apex sits at the origin and whose axis is +z (scale x,y = radius, z = length); same additive look as set.js beam()
function coneMesh(color, k) {
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 40, 1, true); g.translate(0, -0.5, 0); g.rotateX(-PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(color) }, k: { value: k } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN,vV)),1.6); float fade = pow(vUv.y,1.3); gl_FragColor = vec4(c*edge*fade*k*2.0, 1.0); }',
  });
  const m = new THREE.Mesh(g, mat); m.renderOrder = 5; m.frustumCulled = false; return m;
}

export function build(ctx, mall) {
  const { M, root } = ctx;
  const A = mall.anchors;

  // ---------------------------------------------------------------------------------------------- placement
  const S0 = { x: 19.6, z: -1.6 };                 // centre of the curtain end (world)
  const TH = -PI / 2;                              // local +z = world -x
  const cs = Math.cos(TH), sn = Math.sin(TH);
  const Wp = (x, z) => ({ x: S0.x + x * cs + z * sn, z: S0.z - x * sn + z * cs });
  const W = (x, y, z) => { const p = Wp(x, z); return [p.x, y, p.z]; };
  const R = new THREE.Group(); R.name = 'runway'; R.position.set(S0.x, 0, S0.z); R.rotation.y = TH; root.add(R);
  const STEM_W = 2.6, STEM_L = 12.4, T_W = 5.4, T_D = 2.4, END = 13.3;   // the T bar occupies z 11.6..14.0; END is the pose spot on its front edge

  // ---------------------------------------------------------------------------------------------- materials
  const white = M.plastic(0xfff8f2, { rough: 0.15 }), pinkM = M.cloth(0xff9ecb, { rep: 4 }), cream = M.cloth(0xfff4e0, { rep: 3 }), plum = M.cloth(0x8a5cb8, { rep: 3 }), plumD = M.matte(0x3a2050, { rough: 0.9 }),
    butter = M.cloth(0xffe066, { rep: 3 }), hot = M.cloth(0xff5fa8, { rep: 4 });

  // ---------------------------------------------------------------------------------------------- the runway: T-shaped slab, pink skirt, stitched outline, glow strips
  add(R, rbox(STEM_W, 0.22, STEM_L + 1.0, 0.09), white, { y: 0.14, z: STEM_L / 2 + 0.5 });
  add(R, rbox(T_W, 0.22, T_D, 0.09), white, { y: 0.14, z: STEM_L + 0.4 - 0.0 });
  add(R, rbox(STEM_W + 0.2, 0.12, STEM_L + 1.2, 0.05), pinkM, { y: 0.07, z: STEM_L / 2 + 0.5 });
  add(R, rbox(T_W + 0.2, 0.12, T_D + 0.2, 0.05), pinkM, { y: 0.07, z: STEM_L + 0.4 });
  const yT = 0.255, hw = STEM_W / 2 - 0.12, tw = T_W / 2 - 0.12, zt0 = STEM_L - 0.8 + 0.0, zt1 = STEM_L + 1.5 - 0.12;
  {   // cream running stitch just inside the edge, following the T
    const outline = [V3(-hw, yT, 0.15), V3(-hw, yT, zt0), V3(-tw, yT, zt0), V3(-tw, yT, zt1), V3(tw, yT, zt1), V3(tw, yT, zt0), V3(hw, yT, zt0), V3(hw, yT, 0.15)];
    stitchLines(R, [outline], 0xfff4e0, { spacing: 0.2, len: 0.1, thick: 0.02, seed: 4 });
    // hot pink dashed centre line and a pair of coral lines: a sewn "seam" down the walk
    stitchLines(R, [[V3(0, yT, 0.6), V3(0, yT, zt1 - 0.3)]], 0xff5fa8, { spacing: 0.34, len: 0.18, thick: 0.024, seed: 9 });
    stitchLines(R, [[V3(-0.55, yT, 0.6), V3(-0.55, yT, zt0 - 0.3)], [V3(0.55, yT, 0.6), V3(0.55, yT, zt0 - 0.3)]], 0xff8a6a, { spacing: 0.24, len: 0.12, thick: 0.017, seed: 14 });
  }
  {   // glow edge strips: pink along the audience-left (-x) side, cyan along +x; both wrap the T
    const yg = 0.265, ex = STEM_W / 2 - 0.02, tx = T_W / 2 - 0.02, ze = STEM_L + 1.6 - 0.02;
    const pinkStrip = [V3(-ex, yg, 0.0), V3(-ex, yg, zt0 + 0.3), V3(-tx, yg, zt0 + 0.3), V3(-tx, yg, ze), V3(0, yg, ze)];
    const cyanStrip = [V3(ex, yg, 0.0), V3(ex, yg, zt0 + 0.3), V3(tx, yg, zt0 + 0.3), V3(tx, yg, ze), V3(0, yg, ze)];
    const gm = (c) => { const m = new THREE.Mesh(polyTube(c, 0.035), M.glow(c === pinkStrip ? 0xff4fb0 : 0x62dfff, 2.4)); m.castShadow = false; m.receiveShadow = false; R.add(m); return m; };
    gm(pinkStrip); gm(cyanStrip);
  }

  // ---------------------------------------------------------------------------------------------- footlights (instanced bulbs, chasing on the beat)
  const bulbPos = [];
  const addBulb = (x, z, side) => bulbPos.push({ x, z, side });
  for (let z = 0.5; z <= zt0 + 0.1; z += 0.5) { addBulb(-STEM_W / 2 - 0.16, z, -1); addBulb(STEM_W / 2 + 0.16, z, 1); }
  for (let x = -T_W / 2 - 0.16; x <= T_W / 2 + 0.17; x += 0.5) addBulb(x, STEM_L + 1.6 + 0.16, x < 0 ? -1 : 1);
  for (let z = zt0 + 0.6; z < STEM_L + 1.6; z += 0.5) { addBulb(-T_W / 2 - 0.16, z, -1); addBulb(T_W / 2 + 0.16, z, 1); }
  for (let x = STEM_W / 2 + 0.5; x < T_W / 2 - 0.1; x += 0.5) { addBulb(-x, zt0 - 0.16 + 0.0, -1); addBulb(x, zt0 - 0.16, 1); }
  const nB = bulbPos.length;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 10, 8), M.glow(0xffffff, 2.2), nB); bulbs.frustumCulled = false; bulbs.castShadow = false;
  { const m4 = new THREE.Matrix4(); bulbPos.forEach((b, i) => { m4.makeTranslation(b.x, 0.17, b.z); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, new THREE.Color(1, 1, 1)); }); R.add(bulbs); }
  const bulbSock = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 10), M.plastic(0xfff4e0), nB); bulbSock.castShadow = false;
  { const m4 = new THREE.Matrix4(); bulbPos.forEach((b, i) => { m4.makeTranslation(b.x, 0.085, b.z); bulbSock.setMatrixAt(i, m4); }); R.add(bulbSock); }
  const cPink = new THREE.Color(0xff5fa8), cCyan = new THREE.Color(0x62dfff), cButter = new THREE.Color(0xffe066), tmpC = new THREE.Color();

  // ---------------------------------------------------------------------------------------------- backdrop: proscenium, curtains with a gap, valance, monogram medallion, needle and thread
  const ZC = -0.4, GAP = 0.95, WALL_X = 3.7, WALL_H = 4.6;
  const curtain = (x0, x1, seed) => {
    const w = x1 - x0, h = 3.9, g = new THREE.PlaneGeometry(w, h, 44, 1), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + (x0 + x1) / 2, y = pos.getY(i), yy = y / h + 0.5, amp = 0.05 + 0.14 * (1 - yy) * (1 - yy) * 0 + 0.13 * (1 - yy); pos.setZ(i, Math.sin(x * 9.2 + seed) * amp + Math.sin(x * 21 + seed * 2) * 0.025 * (1 - yy)); }
    g.computeVertexNormals(); g.translate((x0 + x1) / 2, h / 2, 0);
    const m = new THREE.Mesh(g, plum); m.position.z = ZC; m.castShadow = true; m.receiveShadow = true; R.add(m); return m;
  };
  curtain(GAP, WALL_X, 0.3); curtain(-WALL_X, -GAP, 1.9);
  // tie-back ropes and tassels
  for (const s of [-1, 1]) {
    add(R, new THREE.TorusGeometry(0.2, 0.035, 8, 20), butter, { x: s * (GAP + 0.03), y: 1.35, z: ZC + 0.1, ry: PI / 2, sx: 1.2 });
    add(R, new THREE.SphereGeometry(0.07, 10, 8), butter, { x: s * (GAP + 0.06), y: 1.1, z: ZC + 0.2 });
    add(R, new THREE.ConeGeometry(0.085, 0.3, 12), butter, { x: s * (GAP + 0.06), y: 0.86, z: ZC + 0.2, rx: PI });
  }
  // valance: a scalloped band of cream and pink scallops across the whole front
  {
    const n = 15, w = 2 * WALL_X / n;
    add(R, rbox(2 * WALL_X + 0.3, 0.5, 0.3, 0.08), cream, { y: 4.1, z: ZC + 0.02 });
    const sc = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 14, 10, 0, PI * 2, PI / 2, PI / 2), M.cloth(0xffffff, { rep: 3 }), n);
    const m4 = new THREE.Matrix4(); for (let i = 0; i < n; i++) { m4.compose(V3(-WALL_X + w * (i + 0.5), 3.87, ZC + 0.02), new THREE.Quaternion(), V3(w * 0.98, 0.42, 0.34)); sc.setMatrixAt(i, m4); sc.setColorAt(i, new THREE.Color(i % 2 ? 0xffb6d5 : 0xfff4e0)); }
    sc.castShadow = true; R.add(sc);
    stitchLines(R, [[V3(-WALL_X + 0.1, 4.12, ZC + 0.19), V3(WALL_X - 0.1, 4.12, ZC + 0.19)]], 0xff8a6a, { spacing: 0.22, len: 0.11, thick: 0.02, seed: 2 });
    // header board above: plum with a cream border, carrying the medallion
    add(R, rbox(2 * WALL_X + 0.3, 0.9, 0.25, 0.1), plum, { y: 4.75 + 0.0, z: ZC });
    stitchLines(R, [[V3(-WALL_X + 0.1, 4.75, ZC + 0.14), V3(-1.4, 4.75, ZC + 0.14)], [V3(1.4, 4.75, ZC + 0.14), V3(WALL_X - 0.1, 4.75, ZC + 0.14)]], 0xffb6d5, { spacing: 0.2, len: 0.1, thick: 0.02, seed: 6 });
  }
  // the monogram medallion: scalloped cream disc, coral dashed ring, ZC in chunky hot pink satin-stitch look
  const MED = { y: 4.85, r: 1.05 };
  {
    const tex = signTex(512, 512, (g, w, h) => {
      g.translate(w / 2, h / 2);
      g.fillStyle = '#fff4e0'; g.beginPath(); const N = 22; for (let i = 0; i < N; i++) { const a0 = i / N * PI * 2, a1 = (i + 1) / N * PI * 2, am = (a0 + a1) / 2; g.arc(Math.cos(am) * 226, Math.sin(am) * 226, 42, a0 - 1.9, a1 + 1.9, false); } g.fill();
      g.beginPath(); g.arc(0, 0, 230, 0, 7); g.fill();
      g.strokeStyle = '#ff8a6a'; g.lineWidth = 9; g.setLineDash([26, 16]); g.beginPath(); g.arc(0, 0, 208, 0, 7); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#ff5fa8'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 186, 0, 7); g.stroke();
      g.font = `900 250px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.strokeStyle = '#7a4b8a'; g.lineWidth = 34; g.strokeText('ZC', 0, -12); g.fillStyle = '#ff2f86'; g.fillText('ZC', 0, -12);
      g.save(); g.beginPath(); g.rect(-220, -140, 440, 260); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 3;   // satin-stitch hatching over the letters
      for (let x = -260; x < 260; x += 9) { g.beginPath(); g.moveTo(x, -140); g.lineTo(x + 60, 120); g.stroke(); } g.restore();
      g.font = `900 46px ${FONT}`; g.fillStyle = '#7a4b8a'; g.fillText('COUTURE', 0, 150);
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(MED.r, 48), flat(tex)); disc.position.set(0, MED.y, ZC + 0.155); R.add(disc);
    add(R, new THREE.CylinderGeometry(MED.r * 1.0, MED.r * 1.04, 0.1, 40), cream, { y: MED.y, z: ZC + 0.1, rx: PI / 2 });
    // the giant needle, slanted through the medallion, and a looping pink thread
    const needle = new THREE.Group(); needle.position.set(0.15, MED.y - 0.1, ZC + 0.3); needle.rotation.z = -0.62; R.add(needle);
    const steel = M.metal(0xeef2f8);
    add(needle, new THREE.CylinderGeometry(0.035, 0.035, 3.0, 12), steel, { y: 0 });
    add(needle, new THREE.ConeGeometry(0.035, 0.5, 12), steel, { y: 1.75 });
    add(needle, new THREE.TorusGeometry(0.11, 0.028, 8, 20), steel, { y: -1.62, sx: 0.55 });
    const eye = V3(0.15 - 1.62 * Math.sin(0.62), MED.y - 0.1 - 1.62 * Math.cos(0.62), ZC + 0.3);   // where the needle's eye ends up
    const tp = [eye, V3(eye.x - 0.25, eye.y - 0.5, ZC + 0.45), V3(eye.x - 0.85, eye.y - 0.95, ZC + 0.55), V3(eye.x - 1.5, eye.y - 0.7, ZC + 0.5), V3(eye.x - 1.6, eye.y - 0.1, ZC + 0.55), V3(eye.x - 1.1, eye.y + 0.1, ZC + 0.5), V3(eye.x - 0.9, eye.y - 0.6, ZC + 0.5)];
    const th = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp), 60, 0.035, 8, false), M.thread(0xff5fa8)); th.castShadow = true; R.add(th);
  }
  // the backstage box: dark walls, a dark floor, a string of bulbs so the models emerge from a glow
  {
    add(R, new THREE.PlaneGeometry(2 * WALL_X, WALL_H), plumD, { y: WALL_H / 2, z: ZC - 3.0, cast: false, recv: false });
    for (const s of [-1, 1]) add(R, new THREE.PlaneGeometry(3.0, WALL_H), plumD, { x: s * WALL_X, y: WALL_H / 2, z: ZC - 1.5, ry: -s * PI / 2, cast: false, recv: false });
    add(R, new THREE.PlaneGeometry(2 * WALL_X, 3.0), plumD, { y: WALL_H, z: ZC - 1.5, rx: PI / 2, cast: false, recv: false });
    add(R, new THREE.PlaneGeometry(2 * WALL_X, 3.0), M.matte(0x4a2a68, { rough: 0.9 }), { y: 0.02, z: ZC - 1.5, rx: -PI / 2, cast: false });
    for (let i = 0; i < 9; i++) add(R, new THREE.SphereGeometry(0.08, 10, 8), M.glow(i % 2 ? 0xffe066 : 0xff8fc0, 2.2), { x: -2.4 + i * 0.6, y: 3.3 - 0.35 * Math.abs(Math.sin(i * 0.7)), z: ZC - 2.9, cast: false });
    add(R, new THREE.BoxGeometry(2.6, 0.06, 0.06), M.metal(0xdddddd), { y: 3.5, z: ZC - 2.9, cast: false });
  }

  // ---------------------------------------------------------------------------------------------- audience plush (instanced) and photographers
  const seats = [];
  for (let k = 0; k < 11; k++) for (const s of [-1, 1]) seats.push({ x: s * (2.4 + 0.14 * hash(k * 3.3 + s)), z: 1.1 + k * 1.02 + (s > 0 ? 0.32 : 0), ry: -s * PI / 2 + (hash(k * 7.1 + s) - 0.5) * 0.4, sc: 0.86 + hash(k * 2.3 + s * 5) * 0.2, s });
  for (const [x, z, ry] of [[-3.7, zt0 + 0.9, PI / 2], [3.7, zt0 + 0.9, -PI / 2], [-3.7, zt0 + 1.9, PI / 2], [3.7, zt0 + 1.9, -PI / 2]]) seats.push({ x, z, ry, sc: 0.95, s: x < 0 ? -1 : 1 });
  const PIT_Z = STEM_L + 3.6;   // z of the photographers' front row
  const photogs = [];
  [-2.6, -1.35, -0.1, 1.15, 2.4].forEach((x, i) => photogs.push({ x, z: PIT_Z + (i % 2) * 0.75, ry: PI + (hash(i * 5.7) - 0.5) * 0.3, sc: 0.95, photog: true, s: 0, i }));
  const crowd = seats.concat(photogs), N = crowd.length;
  const pal = [0xffb6d5, 0xd9a7ff, 0xb6ffd6, 0xfff0a6, 0xa8e6ff, 0xffc9a8];
  const clothW = () => M.cloth(0xffffff, { rep: 6 });
  const mkIM = (geo, per, mat) => { const im = new THREE.InstancedMesh(geo, mat, N * per); im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; R.add(im); return im; };
  const sph = (r) => new THREE.SphereGeometry(r, 14, 10);
  const P_body = mkIM(sph(1), 1, clothW()), P_head = mkIM(sph(1), 1, clothW()), P_ears = mkIM(sph(1), 2, clothW()), P_arms = mkIM(new THREE.CapsuleGeometry(0.058, 0.2, 3, 6), 2, clothW()),
    P_snout = mkIM(sph(1), 1, M.cloth(0xfff4e0, { rep: 6 })), P_eyes = mkIM(sph(1), 2, M.ink()), P_bow = mkIM(sph(1), 3, M.satin(0xffffff)), P_stool = mkIM(new THREE.CylinderGeometry(0.34, 0.36, 0.16, 16), 1, M.cloth(0xffffff, { rep: 4 }));
  const nPh = photogs.length;
  const P_cam = new THREE.InstancedMesh(rbox(0.22, 0.15, 0.1, 0.03), M.plastic(0x3a2a4d), nPh); P_cam.frustumCulled = false; R.add(P_cam);
  const P_lens = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 12), M.metal(0xdfe6ee), nPh); P_lens.frustumCulled = false; R.add(P_lens);
  crowd.forEach((c, i) => {
    const col = new THREE.Color(pal[Math.floor(hash(i * 4.1 + 1) * pal.length)]), bow = new THREE.Color([0xff2f86, 0x8a5cff, 0xffe066, 0x22c7ff][Math.floor(hash(i * 9.3) * 4)]);
    P_body.setColorAt(i, col); P_head.setColorAt(i, col); P_ears.setColorAt(2 * i, col); P_ears.setColorAt(2 * i + 1, col); P_arms.setColorAt(2 * i, col); P_arms.setColorAt(2 * i + 1, col);
    for (let k = 0; k < 3; k++) P_bow.setColorAt(3 * i + k, bow);
    P_stool.setColorAt(i, new THREE.Color(hash(i * 1.9) < 0.5 ? 0xffe066 : 0xff9ecb));
    P_snout.setColorAt(i, new THREE.Color(0xfff4e0)); P_eyes.setColorAt(2 * i, new THREE.Color(0x2b1a3a)); P_eyes.setColorAt(2 * i + 1, new THREE.Color(0x2b1a3a));
  });
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _b = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  // compose (base transform) * (local part transform)
  const put = (im, idx, base, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { _e.set(rx, ry, rz); _q.setFromEuler(_e); _m.compose(_p.set(lx, ly, lz), _q, _s.set(sx, sy, sz)); _m.premultiply(base); im.setMatrixAt(idx, _m); };
  function plushPose(beat) {
    crowd.forEach((c, i) => {
      const ph = hash(i * 5.3) * 6.28, bob = 0.05 * Math.abs(Math.sin(beat * PI + ph)) * (c.photog ? 0.3 : 1);
      _q.setFromAxisAngle(V3(0, 1, 0), c.ry); _b.compose(_p.set(c.x, bob, c.z), _q, _s.set(c.sc, c.sc, c.sc));
      put(P_body, i, _b, 0, 0.42, 0, 0.34, 0.36, 0.32); put(P_head, i, _b, 0, 0.9, 0.02, 0.25, 0.235, 0.24); put(P_stool, i, _b, 0, 0.08 - bob / c.sc, 0, 1, 1, 1);
      put(P_snout, i, _b, 0, 0.86, 0.2, 0.09, 0.07, 0.06);
      for (const s of [-1, 1]) {
        const k = s < 0 ? 0 : 1;
        put(P_ears, 2 * i + k, _b, s * 0.17, 1.08, -0.02, 0.09, 0.09, 0.05);
        put(P_eyes, 2 * i + k, _b, s * 0.085, 0.94, 0.215, 0.028, 0.032, 0.02);
        // arms: the audience waves on the beat (raised, swinging outward); photographers hold the camera at the face
        let cx, cy, cz, rx = 0, rz = 0;
        if (c.photog) { rx = 1.15; cx = s * 0.23; cy = 0.66 + Math.cos(rx) * 0.16; cz = 0.1 + Math.sin(rx) * 0.16; rz = -s * 0.25; }
        else { const phi = 0.55 + 0.4 * Math.sin(beat * PI * 2 + ph + s * 1.3); cx = s * 0.3 + s * Math.sin(phi) * 0.16; cy = 0.62 + Math.cos(phi) * 0.16; cz = 0; rz = -s * phi; }
        put(P_arms, 2 * i + k, _b, cx, cy, cz, 1, 1, 1, rx, 0, rz);
      }
      put(P_bow, 3 * i, _b, -0.06, 0.7, 0.25, 0.075, 0.05, 0.035, 0, 0, 0.4); put(P_bow, 3 * i + 1, _b, 0.06, 0.7, 0.25, 0.075, 0.05, 0.035, 0, 0, -0.4); put(P_bow, 3 * i + 2, _b, 0, 0.7, 0.265, 0.033, 0.033, 0.03);
      if (c.photog) {
        const j = c.i; put(P_cam, j, _b, 0, 0.9, 0.34, 1, 1, 1); put(P_lens, j, _b, 0, 0.9, 0.42, 1, 1, 1, PI / 2, 0, 0);
      }
    });
    [P_body, P_head, P_ears, P_arms, P_snout, P_eyes, P_bow, P_stool, P_cam, P_lens].forEach((im) => (im.instanceMatrix.needsUpdate = true));
    [P_body, P_head, P_ears, P_arms, P_snout, P_eyes, P_bow, P_stool].forEach((im) => { if (im.instanceColor) im.instanceColor.needsUpdate = true; });
  }
  plushPose(0);

  // photo pit: a low felt barrier and flash sprites at the cameras
  {
    add(R, rbox(6.6, 0.42, 0.22, 0.1), pinkM, { y: 0.21, z: PIT_Z + 1.55 });
    for (const s of [-1, 1]) add(R, rbox(0.22, 0.42, 1.9, 0.1), pinkM, { x: s * 3.4, y: 0.21, z: PIT_Z + 0.7 });
    stitchLines(R, [[V3(-3.0, 0.43, PIT_Z + 1.55), V3(3.0, 0.43, PIT_Z + 1.55)]], 0xfff4e0, { spacing: 0.2, len: 0.1, thick: 0.02, seed: 5 });
  }
  const starTex = starSprite(128);
  const flashSprites = photogs.map((p) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: new THREE.Color(0xfff2d8).multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    const c = Math.cos(p.ry), s = Math.sin(p.ry);
    sp.position.set(p.x + s * 0.42 * p.sc, 1.3 * p.sc, p.z + c * 0.42 * p.sc + 0.0); sp.visible = false; sp.scale.set(0.5, 0.5, 1); R.add(sp); return sp;
  });
  // at most 3 flashes per second: time is cut into 1/3 s slots and a slot fires only for its first 0.09 s; sprites are small (never full frame)
  const flashState = (t) => { const n = Math.floor(t * 3), ph = t * 3 - n; const fire = hash(n * 1.37 + 0.5) > 0.38 && ph < 0.27; return { on: fire, who: Math.floor(hash(n * 7.9 + 3) * photogs.length), k: fire ? 1 - ph / 0.27 * 0.5 : 0 }; };

  // ---------------------------------------------------------------------------------------------- visible spot cones (they follow the same sweep as the kit spots)
  const cones = [coneMesh(0xffd9a8, 0.13), coneMesh(0xffe8c8, 0.12), coneMesh(0xffc890, 0.12), coneMesh(0xff5fa8, 0.10)];
  cones.forEach((c) => { c.visible = false; root.add(c); });   // world space (not the runway group): positions are set in world coordinates each frame
  const truss = [W(-2.2, 9.6, 3.6), W(0.0, 9.6, 7.0), W(2.2, 9.6, 10.4)];
  const sweep = (i, beat, p) => { const ph = i * 2.1, a = beat * 0.5 * PI / 2; const lz = clamp(7.0 + 5.0 * Math.sin(a * 0.5 + ph) + (i - 1) * 1.2, 1.0, 13.0), lx = 0.9 * Math.sin(a + ph * 1.7); return { lx, lz }; };
  const posTarget = (i, beat, p) => { const s = sweep(i, beat, p); return W(s.lx, 0.05, s.lz); };

  // ---------------------------------------------------------------------------------------------- the walk
  const Z_START = 0.5, Z_TURN = 12.5;                    // the turn happens on the T bar, just short of the pose spot
  function path(s, lane = 0) {
    const lx = clamp(lane, -1, 1) * 0.6;
    let lz, rot;
    if (s <= 1) { lz = lerp(Z_START, Z_TURN, clamp(s)); rot = TH; }
    else if (s <= 1.2) { lz = Z_TURN; rot = TH + PI * smooth((s - 1) / 0.2); }
    else { lz = lerp(Z_TURN, Z_START, clamp((s - 1.2) / 1.0)); rot = TH + PI; }
    const p = Wp(lx, lz); return { x: p.x, y: 0.22, z: p.z, rotY: rot };       // y = the runway top: stand characters there
  }
  const slots = {};
  { const a = path(0), b = path(1), c = Wp(0, END); slots.start = { x: a.x, y: 0.22, z: a.z, rotY: a.rotY }; slots.end = { x: b.x, y: 0.22, z: b.z, rotY: b.rotY }; slots.pose = { x: c.x, y: 0.22, z: c.z, rotY: TH };
    const cb = Wp(0, ZC - 1.2); slots.backstage = { x: cb.x, y: 0, z: cb.z, rotY: TH };
    // standing places along the stem for the "line" shots
    for (let i = 0; i < 6; i++) { const q = path(0.12 + i * 0.16, i % 2 ? 0.5 : -0.5); slots['walk' + i] = { x: q.x, y: 0.22, z: q.z, rotY: q.rotY }; } }

  // ---------------------------------------------------------------------------------------------- rigs
  const P = clamp;
  const rigs = {
    // low, alongside on the mall side, travelling with the walk; the arcade wall and its pillars stay behind the runway
    lowTrack: (u) => { const p = P(u.p), z = lerp(2.2, 10.2, smooth(p)); return { pos: W(1.72, 0.46, z), look: W(0.15, 0.98, z + 3.4), fov: 46 }; },
    // front-on from beyond the photo pit at the T; a slight push toward the walkers, the monogram behind them
    headOn: (u) => { const p = P(u.p); return { pos: W(0.05, 1.62 + 0.05 * p, PIT_Z + 2.4 - 1.2 * smooth(p)), look: W(0.0, 1.45, 6.0), fov: 30 }; },
    side: (u) => { const p = P(u.p); return { pos: W(7.4, 1.5, 7.0 + 1.5 * p), look: W(0.0, 1.05, 7.0 + 0.6 * p), fov: 27 }; },
    // the same walk from the far side, the atrium behind it
    sideB: (u) => { const p = P(u.p); return { pos: W(-7.2, 1.4, 6.6 + 1.6 * p), look: W(0.0, 1.05, 6.8 + 0.7 * p), fov: 28 }; },
    overhead: (u) => { const p = P(u.p); return { pos: W(1.2, 9.3, 2.0 + 2.5 * smooth(p)), look: W(0.0, 0.0, 8.0), fov: 44 }; },
    // from behind the curtain, through the gap: the models step out into the light
    backstage: (u) => { const p = P(u.p); return { pos: W(0.0, 1.45, ZC - 2.5 + 1.8 * smooth(p)), look: W(0.0, 1.35, 9.0), fov: 46 }; },
    photoPit: (u) => { const p = P(u.p); return { pos: W(1.05 - 0.5 * p, 1.72, PIT_Z + 2.0), look: W(-0.2 - 0.2 * p, 1.2, END - 0.6), fov: 44 }; },
  };

  // ---------------------------------------------------------------------------------------------- lights
  const cA = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k);
  const light = (kit, u, c2) => {
    const beat = c2.beat ?? 0, p = u.p ?? 0, up = smooth(clamp(p * 3));           // the catwalk lights come up over the first third of the shot
    const fl = flashState(c2.t ?? 0);
    kit.setKey({ pos: W(-5.5, 9.0, 6.0), target: W(0, 0.4, 7.0), color: 0xffe2c4, i: lerp(0.5, 1.05, up), extent: 11, near: 1, far: 34 });
    kit.setHemi({ sky: cA(0x7a6aa8, 0xa898d0, up), ground: 0x2a2040, i: lerp(0.4, 0.55, up) });                  // house lights dim
    for (let i = 0; i < 3; i++) {
      const t = posTarget(i, beat, p);
      kit.setSpot(i, { color: [0xffd9a8, 0xffe8c8, 0xffc890][i], i: lerp(30, 165, up), dist: 30, angle: 0.3, pen: 0.55, decay: 1.2, pos: truss[i], target: t });
      const cone = cones[i], a = V3(...truss[i]), b = V3(...t), L = a.distanceTo(b); cone.position.copy(a); cone.lookAt(b); const r = L * Math.tan(0.3) * 0.9; cone.scale.set(r, r, L); cone.visible = up > 0.05;
      cone.material.uniforms.k.value = 0.12 * up;
    }
    kit.setSpot(3, { color: 0xff3fa4, i: 150 * up, dist: 30, angle: 0.36, pen: 0.7, decay: 1.2, pos: W(0.0, 3.6, ZC - 0.6), target: W(0.0, 1.2, 8.0) });         // magenta rim from behind the walkers
    kit.setSpot(4, { color: 0xffc8e0, i: 175 * up, dist: 30, angle: 0.3, pen: 0.6, decay: 1.2, pos: W(0.6, 8.2, 9.0), target: W(0.0, MED.y - 0.35, ZC + 0.2) });          // wash on the backdrop emblem
    kit.setSpot(5, { color: 0xfff0d0, i: 170 * up, dist: 24, angle: 0.28, pen: 0.6, decay: 1.2, pos: W(0.8, 9.0, END + 0.5), target: W(0.0, 1.0, END + 0.3) });         // follow spot on the T
    kit.setPoint(0, { color: 0xff5fa8, i: 24 * up, dist: 6, decay: 1.5, pos: W(0.0, 0.7, END - 0.6) });
    const fp = flashSprites[fl.who].position, fw = Wp(fp.x, fp.z);
    kit.setPoint(1, { color: 0xfff2d8, i: fl.on ? 46 * fl.k : 0, dist: 7, decay: 1.4, pos: [fw.x, 1.0, fw.z] });
  };

  // ---------------------------------------------------------------------------------------------- update
  const update = (u, c2) => {
    const beat = c2.beat ?? 0, t = c2.t ?? u.t ?? 0;
    cones.forEach((c) => (c.visible = false));      // light() switches them back on, so a frame that uses another light preset never shows stale cones
    // footlights: a bright pair chases along each side, one step per half beat, with a soft tail
    for (let i = 0; i < nB; i++) {
      const b = bulbPos[i], f = ((i * 0.5 - beat * 3) % 8 + 8) % 8, on = f < 2 ? 1 : f < 3.2 ? 0.45 : 0.14;
      tmpC.copy(b.side < 0 ? cPink : cCyan); if (i % 8 === 0) tmpC.copy(cButter); tmpC.multiplyScalar(on); bulbs.setColorAt(i, tmpC);
    }
    bulbs.instanceColor.needsUpdate = true;
    plushPose(beat);
    const fl = flashState(t); flashSprites.forEach((s, i) => { const on = fl.on && i === fl.who; s.visible = on; if (on) { const k = 0.45 + 0.15 * fl.k; s.scale.set(k, k, 1); } });
  };

  mall.slots = mall.slots || {};
  for (const [k, v] of Object.entries(slots)) { if (!(k in mall.slots)) mall.slots[k] = v; mall.slots['mall_runway.' + k] = v; }

  return {
    name: 'mall_runway', root, group: R, slots, rigs, path, update, light,
    anchors: { S0, rotY: TH, W, Wp, END, PIT_Z, stemLength: STEM_L, curtain: { z: ZC } },
    post: { band: 0.4, tilt: 1.6, focusY: 0.5 },
  };
}
