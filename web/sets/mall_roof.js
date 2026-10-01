// The mall ROOF, an extension module built into the mall (build(ctx, mall) -> ext).
//   * a felt ceiling over the whole atrium (quilted underside, rafters, bunting-hook rings, warm lamp discs) with a round SKYLIGHT (10 m) closed by
//     ten thick felt petals that fold open like a flower (c2.args.roof 0 = closed .. 1 = open, staggered, slight overshoot and settle);
//     a felt button covers the centre and pops off as the roof opens
//   * the roof's top surface: patchwork felt, stitched seams, scalloped parapet, bunting, chimneys with barber-pole swirls, needle weather-vane, buttons
//   * a shaft of light down onto the pedestal (additive) and a column of light rising out of the skylight
//   * rigs (world coordinates, all on u.p):  up  craneOut  roofRim  roofTop  sunrise        light(kit, u, c2) for the finale (blends room -> open air on c2.cam.position.y; the key always casts, so nothing recompiles);  update(u, c2);  post;  front(u, c2)
//   * anchors: roofY 11.8, ceilY 11.0, skylight {x, y, z, r}, ped, petals, petalLen, petalOpenRad, centre, footprint {x0, x1, z0, z1}, sunDir.   c2.args: roof (0..1, default 0), dawn (0..1, default 1)
// Coordinates: ceiling underside y = 11.0 (flush with the wall tops), roof top y = 11.8, skylight centre = the pedestal, radius 5.12.
// c2.args.roof (0..1) is the raw progress; easing, per-petal stagger and overshoot are done here.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stitchify } from '../stitch.js';
import { PI, TAU, clamp, lerp, smooth, sstep, hash, mkrng, hexs, canvas, dashed, P, F0, SUN_DIR, SUN_HEADING, skyRamp, paintQuilt, boldHaze, aerialFront } from './sky_shared.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const nf = (m) => { m.fog = false; return m; };
const Y0 = 11.0, Y1 = 11.8, R_HOLE = 5.12, N_PET = 10, PET_L = 5.0, PET_W0 = 1.53, HINGE_R = 5.06;

// monotone cubic (Fritsch-Carlson) through knots -> f(x); C1, no overshoot
function pchip(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// ease with a little overshoot that settles (easeOutBack, s = 1.15)
const backOut = (x) => { x = clamp(x); const s = 1.15, c = x - 1; return 1 + (s + 1) * c * c * c + s * c * c; };

// ---------------------------------------------------------------- canvases
function latticeCanvas(size, n, groove = 'rgba(30,20,50,0.55)') {   // quilted diamonds: colour (neutral, dashed stitches) + bump
  const c = canvas(size), g = c.getContext('2d'), b = canvas(size), h = b.getContext('2d'), st = size / n;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size); h.fillStyle = '#707070'; h.fillRect(0, 0, size, size);
  for (let i = -n; i < 2 * n; i++) for (const dir of [1, -1]) {
    const x0 = i * st;
    g.save(); g.setLineDash([size * 0.012, size * 0.009]); g.lineCap = 'round'; g.strokeStyle = 'rgba(255,138,106,0.9)'; g.lineWidth = size * 0.0032; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + dir * size, size); g.stroke(); g.restore();
    h.strokeStyle = 'rgba(20,20,20,0.9)'; h.lineWidth = size * 0.008; h.beginPath(); h.moveTo(x0, 0); h.lineTo(x0 + dir * size, size); h.stroke();
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = (i + 0.5) * st, cy = (j + 0.5) * st, gr = h.createRadialGradient(cx, cy, 0, cx, cy, st * 0.62); gr.addColorStop(0, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); h.fillStyle = gr; h.fillRect(cx - st, cy - st, 2 * st, 2 * st); }
  return { col: c, hgt: b };
}
function buttonCanvas(size = 256) {   // a big four-hole button, neutral colour so instance colours tint it
  const c = canvas(size), g = c.getContext('2d'), m = size / 2;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(m, m, m * 0.98, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = size * 0.05; g.beginPath(); g.arc(m, m, m * 0.74, 0, TAU); g.stroke();
  dashed(g, Array.from({ length: 48 }, (_, i) => [m + Math.cos(i / 48 * TAU) * m * 0.86, m + Math.sin(i / 48 * TAU) * m * 0.86]), size * 0.03, size * 0.02, size * 0.014, 'rgba(255,250,235,1)');
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.fillStyle = '#5a3040'; g.beginPath(); g.arc(m + sx * m * 0.27, m + sy * m * 0.27, m * 0.12, 0, TAU); g.fill(); }
  g.strokeStyle = '#ff8a6a'; g.lineWidth = size * 0.022; g.lineCap = 'round';
  g.beginPath(); g.moveTo(m - m * 0.27, m - m * 0.27); g.lineTo(m + m * 0.27, m + m * 0.27); g.moveTo(m + m * 0.27, m - m * 0.27); g.lineTo(m - m * 0.27, m + m * 0.27); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function poleCanvas() {   // barber-pole swirl for the chimneys: diagonal bands with running stitches on the band edges
  const s = 256, c = canvas(s), g = c.getContext('2d');
  g.fillStyle = '#fff4e0'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#ff9ecb'; for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128 + 64, 0); g.lineTo(k * 128 + 64 + s, s); g.lineTo(k * 128 + s, s); g.closePath(); g.fill(); }
  g.setLineDash([12, 9]); g.lineCap = 'round'; g.strokeStyle = '#fff4e0'; g.lineWidth = 4; for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 128 + 7, 0); g.lineTo(k * 128 + 7 + s, s); g.stroke(); }
  g.strokeStyle = '#ff8a6a'; for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 128 + 57, 0); g.lineTo(k * 128 + 57 + s, s); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// ---------------------------------------------------------------- the petal outline: wide at the hinge, tapering to a rounded tip (a tulip petal / pie slice)
const petalHalf = (y) => { const s = clamp(y / PET_L); let w = PET_W0 * Math.pow(1 - s, 0.9); if (y > PET_L - 0.45) w = Math.min(w, 0.34 * Math.sqrt(Math.max(0, 1 - Math.pow((y - (PET_L - 0.45)) / 0.45, 2)))); return w; };
function petalShape(inset = 0) {
  const sh = new THREE.Shape(), R = [];
  for (let i = 0; i <= 28; i++) { const y = PET_L * i / 28; R.push([Math.max(petalHalf(y) - inset, 0), y]); }
  R[0][1] = inset;
  sh.moveTo(-R[0][0], R[0][1]);
  for (let i = 1; i < R.length; i++) sh.lineTo(-R[i][0], R[i][1]);
  for (let i = R.length - 2; i >= 0; i--) sh.lineTo(R[i][0], R[i][1]);
  sh.closePath();
  return sh;
}

export function build(ctx, mall) {
  const { M, root, FRONT, quality = 'full' } = ctx;
  const lite = quality === 'lite';
  const sh = mall.shell || { x: 23.5, zf: 24, zb: -12.5, h: 11, zc: 5.75 };
  const ped = mall.anchors.ped, C = { x: ped.x, z: ped.z };
  const ext = { name: 'mall_roof', root };
  // Two surfaces of the mall set (web/set.js, buildSet) sit in the roof's way, so they are adjusted here instead of editing that file:
  //  * the 60x30 'ceiling glow' plane at y = 13 would cover the open skylight with a white sheet (it is only there to fake a ceiling): hidden;
  //  * the 90x90 checker floor is fogged like everything else, and the scene fog (0x8f8aa8, opaque beyond 130 m) turns it into a flat lavender square from the air: fog off for that one material.
  (mall.root ?? ctx.scene)?.traverse((o) => {
    if (!o.isMesh || o.geometry?.type !== 'PlaneGeometry' || Array.isArray(o.material)) return;
    const { width: w, height: h } = o.geometry.parameters;
    if (w === 60 && h === 30 && Math.abs(o.position.y - 13) < 0.01) o.visible = false;
    if (w === 90 && h === 90 && Math.abs(o.position.y) < 0.01) o.material.fog = false;
  });
  const rr = mkrng(77);
  const U = { haze: { value: new THREE.Color(0xffe9c0) }, hazeD: { value: 560 }, hazeK: { value: 0.8 } };
  const xa = sh.x + 0.6, za = sh.zf + 0.6, zb = Math.min(sh.zb - 1.6, -14.0);          // slab footprint: a little wider than the walls, covers the shop alcoves
  const cornerR = 2.4;

  // shape in (x, -z) so that rotateX(-90deg) puts world z = -shape.y
  const roundRect = (x0, x1, z0, z1, r) => {
    const s = new THREE.Shape(), a = -z1, b = -z0;    // shape y range: -z1 .. -z0
    s.moveTo(x0 + r, a); s.lineTo(x1 - r, a); s.quadraticCurveTo(x1, a, x1, a + r); s.lineTo(x1, b - r); s.quadraticCurveTo(x1, b, x1 - r, b); s.lineTo(x0 + r, b); s.quadraticCurveTo(x0, b, x0, b - r); s.lineTo(x0, a + r); s.quadraticCurveTo(x0, a, x0 + r, a);
    return s;
  };
  const slabShape = () => { const s = roundRect(-xa, xa, zb, za, cornerR), h = new THREE.Path(); h.absarc(C.x, -C.z, R_HOLE, 0, TAU, true); s.holes.push(h); return s; };

  // =========================================================== textures
  const tileTop = 24;
  const roofFam = [[0xffb6d5, 0xfff4e0, 0xffd9a8, 0xffc9de], [0xfff0a6, 0xfff4e0, 0xffc9a8, 0xffb6d5], [0xb6ffd6, 0xfff4e0, 0xa8e6ff, 0xffd9a8], [0xd9a7ff, 0xffc9de, 0xfff4e0, 0xffe066]];
  const qTop = paintQuilt(lite ? 1024 : 2048, { blocks: 2, sub: 3, tileM: tileTop, seed: 5, fam: roofFam, sash: 0.55, stitchScale: 0.42 });
  const topMap = new THREE.CanvasTexture(qTop.col); topMap.colorSpace = THREE.SRGBColorSpace; topMap.wrapS = topMap.wrapT = THREE.RepeatWrapping; topMap.anisotropy = 16; topMap.repeat.set(1 / tileTop, 1 / tileTop);
  const topBump = new THREE.CanvasTexture(qTop.hgt); topBump.wrapS = topBump.wrapT = THREE.RepeatWrapping; topBump.anisotropy = 16; topBump.repeat.set(1 / tileTop, 1 / tileTop);
  const lat = latticeCanvas(1024, 8);
  const ceilMap = new THREE.CanvasTexture(lat.col); ceilMap.colorSpace = THREE.SRGBColorSpace; ceilMap.wrapS = ceilMap.wrapT = THREE.RepeatWrapping; ceilMap.anisotropy = 8; ceilMap.repeat.set(1 / 9.6, 1 / 9.6);
  const ceilBump = new THREE.CanvasTexture(lat.hgt); ceilBump.wrapS = ceilBump.wrapT = THREE.RepeatWrapping; ceilBump.repeat.set(1 / 9.6, 1 / 9.6);

  // =========================================================== the slab: sides + hole wall from an extrusion, top and underside as separate planes
  const bt = 0.1;
  const gap = 0.09;      // the slab's own caps sit 9 cm inside the top and underside planes, so the planes never z-fight with them from far away
  const slabGeo = new THREE.ExtrudeGeometry(slabShape(), { depth: Y1 - Y0 - 2 * bt - 2 * gap, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.1, bevelSegments: 2, curveSegments: lite ? 12 : 28 });
  slabGeo.rotateX(-PI / 2); slabGeo.translate(0, Y0 + bt + gap, 0);
  const sideM = nf(M.cloth(0xff9ecb, { rep: 3 })), capM = nf(M.cloth(0xffc9de, { rep: 3 })); sideM.shadowSide = capM.shadowSide = THREE.DoubleSide;
  const slab = new THREE.Mesh(slabGeo, [capM, sideM]); slab.castShadow = true; slab.receiveShadow = true; root.add(slab);

  const topGeo = new THREE.ShapeGeometry(slabShape(), lite ? 12 : 28); topGeo.rotateX(-PI / 2); topGeo.translate(0, Y1 + 0.006, 0);
  const topMat = stitchify(new THREE.MeshStandardMaterial({ map: topMap, bumpMap: topBump, bumpScale: 3.2, roughness: 1, fog: false })); boldHaze(topMat, U, 'rt'); topMat.shadowSide = THREE.DoubleSide;
  const top = new THREE.Mesh(topGeo, topMat); top.receiveShadow = true; top.castShadow = false; root.add(top);

  const ceilGeo = new THREE.ShapeGeometry(slabShape(), lite ? 12 : 28); ceilGeo.rotateX(-PI / 2); ceilGeo.translate(0, Y0 - 0.006, 0);
  const ceilMat = stitchify(new THREE.MeshStandardMaterial({ map: ceilMap, bumpMap: ceilBump, bumpScale: 2.4, color: 0xdcc8f6, roughness: 1, side: THREE.DoubleSide })); ceilMat.shadowSide = THREE.DoubleSide;
  const ceil = new THREE.Mesh(ceilGeo, ceilMat); ceil.receiveShadow = true; ceil.castShadow = false; root.add(ceil);

  // rolled piping around the skylight (top and bottom edge) with stitches, so the opening has a soft lip
  {
    const pm = nf(M.cloth(0xff7fb8, { rep: 4 }));
    for (const [y, r, tube] of [[Y1 + 0.02, R_HOLE + 0.06, 0.34], [Y0 - 0.02, R_HOLE + 0.02, 0.26]]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, lite ? 48 : 96), pm); t.rotation.x = PI / 2; t.position.set(C.x, y, C.z); t.castShadow = true; root.add(t); }
    const n = 84, sg = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 5, 1), im = new THREE.InstancedMesh(sg, nf(stitchify(new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 1 }))), n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) { const a = i / n * TAU; pp.set(C.x + Math.cos(a) * (R_HOLE + 0.06), Y1 + 0.02 + 0.34, C.z + Math.sin(a) * (R_HOLE + 0.06)); q.setFromEuler(new THREE.Euler(0, -a, 0)); m4.compose(pp, q, sc); im.setMatrixAt(i, m4); }
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; root.add(im);
  }

  let underStitches = null;
  // =========================================================== the ceiling from below: rafters, bunting-hook rings, lamp discs
  {
    const beamM = M.plastic(0xfff5fa, { rough: 0.35 });
    const geos = [], stitchPts = [];
    const seg = (cx, cz, lx, lz) => { const g = new RoundedBoxGeometry(lx, 0.58, lz, 3, 0.12); g.translate(cx, Y0 - 0.26, cz); geos.push(g); const horiz = lx > lz; const L = horiz ? lx : lz; for (const off of [-0.17, 0.17]) stitchPts.push(horiz ? [[cx - L / 2, Y0 - 0.56, cz + off], [cx + L / 2, Y0 - 0.56, cz + off]] : [[cx + off, Y0 - 0.56, cz - L / 2], [cx + off, Y0 - 0.56, cz + L / 2]]); };
    // long rafters along z at x = k * 5.5 (split around the skylight), cross beams along x
    const holeCut = (fixed, isX, lo, hi, w) => {           // returns free intervals of [lo, hi] once the skylight collar is removed
      const c = isX ? C.x : C.z, o = isX ? C.z : C.x, d = Math.abs(fixed - c), rad = R_HOLE + 0.8;
      if (d >= rad) return [[lo, hi]]; const half = Math.sqrt(rad * rad - d * d); return [[lo, Math.min(hi, o - half)], [Math.max(lo, o + half), hi]].filter(([a, b]) => b - a > 0.6);
    };
    for (let k = -4; k <= 4; k++) { const x = k * 5.5; for (const [a, b] of holeCut(x, true, zb + 0.4, za - 0.4)) seg(x, (a + b) / 2, 0.5, b - a); }
    for (const z of [-9.5, -3.5, 11.5, 17.5, 22]) for (const [a, b] of holeCut(z, false, -xa + 0.4, xa - 0.4)) seg((a + b) / 2, z, b - a, 0.5);
    const beams = new THREE.Mesh(mergeGeometries(geos), beamM); beams.castShadow = true; beams.receiveShadow = true; root.add(beams);
    // stitches under the rafters (one instanced mesh)
    const sm = stitchify(new THREE.MeshStandardMaterial({ color: 0xff8a6a, roughness: 1 })), all = [];
    stitchPts.forEach(([a, b]) => { const A = V3(...a), B = V3(...b), L = A.distanceTo(B), n = Math.max(2, Math.floor(L / 0.5)), dir = B.clone().sub(A).normalize(); for (let i = 0; i < n; i++) all.push([A.clone().addScaledVector(dir, (i + 0.5) * L / n), Math.abs(dir.x) > 0.5 ? PI / 2 : 0]); });
    const sg = new THREE.CylinderGeometry(0.032, 0.032, 0.24, 4, 1); sg.rotateX(PI / 2);      // 16 triangles per stitch; there are ~2000 of them
    const im = new THREE.InstancedMesh(sg, sm, all.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    all.forEach(([p, ry], i) => { q.setFromAxisAngle(V3(0, 1, 0), ry); m4.compose(p, q, sc); im.setMatrixAt(i, m4); }); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; root.add(im); underStitches = im;
    // bunting-hook rings hanging at rafter crossings
    const rings = [], rx = [-16.5, -11, 11, 16.5, 22], rz = [-9.5, -3.5, 11.5, 17.5];
    for (const x of rx) for (const z of rz) rings.push([x, z]);
    const rm = new THREE.InstancedMesh(new THREE.TorusGeometry(0.17, 0.038, 6, 14), M.metal(0xffd45e), rings.length);
    rings.forEach(([x, z], i) => { m4.compose(V3(x, Y0 - 0.85, z), q.setFromAxisAngle(V3(0, 1, 0), (i % 2) * PI / 2), sc); rm.setMatrixAt(i, m4); }); rm.instanceMatrix.needsUpdate = true; rm.frustumCulled = false; root.add(rm);
    const hm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), M.thread(0xfff4e0), rings.length);
    rings.forEach(([x, z], i) => { m4.compose(V3(x, Y0 - 0.6, z), q.identity(), sc); hm.setMatrixAt(i, m4); }); hm.instanceMatrix.needsUpdate = true; hm.frustumCulled = false; root.add(hm);
  }
  const lampSpots = [[-17, 0], [-17, 12], [-9, 20], [18, 0], [18, 12], [10, 20], [-9, -8], [12, -8]];
  const lamps = lampSpots.map(([x, z], i) => {
    const g = new THREE.Group(); g.position.set(x, Y0 - 0.34, z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.16, 28), M.glow(0xffe2b0, 1.2)); disc.position.y = -0.22; g.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.07, 8, 28), M.cloth(0xff9ecb, { rep: 4 })); rim.rotation.x = PI / 2; rim.position.y = -0.2; g.add(rim);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), M.thread(0xfff4e0)); cord.position.y = -0.04; g.add(cord);
    root.add(g); return { g, disc, base: disc.material.color.clone(), ph: rr() * 20 };
  });

  // =========================================================== the petals
  const bevT = 0.09, depth = 0.22;
  const petalGeo = new THREE.ExtrudeGeometry(petalShape(), { depth, bevelEnabled: true, bevelThickness: bevT, bevelSize: 0.08, bevelSegments: 2, curveSegments: 2, steps: 1 });
  petalGeo.rotateX(PI / 2); petalGeo.translate(0, -bevT, 0);                           // top face at y = 0, lining face at y = -(depth + 2 bevT)
  const overGeo = new THREE.ShapeGeometry(petalShape(0.03)); overGeo.rotateX(PI / 2); overGeo.translate(0, 0.005, 0);
  const paintPetal = (kind) => {
    const cw = 512, ch = Math.round(512 * PET_L / (2 * PET_W0)), c = canvas(cw, ch), g = c.getContext('2d'), px = (x) => (x + PET_W0) / (2 * PET_W0) * cw, py = (y) => ch - y / PET_L * ch;
    const outline = (inset) => { const pts = []; for (let i = 0; i <= 30; i++) { const y = 0.02 + (PET_L - 0.06) * i / 30; pts.push([px(-Math.max(petalHalf(y) - inset, 0)), py(y)]); } for (let i = 30; i >= 0; i--) { const y = 0.02 + (PET_L - 0.06) * i / 30; pts.push([px(Math.max(petalHalf(y) - inset, 0)), py(y)]); } return pts; };
    g.fillStyle = kind === 'lining' ? '#fff8f0' : '#ffffff'; g.fillRect(0, 0, cw, ch);
    if (kind === 'lining') {
      const gr = g.createLinearGradient(0, ch, 0, 0); gr.addColorStop(0, 'rgba(255,190,160,0.0)'); gr.addColorStop(1, 'rgba(255,170,190,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
      dashed(g, outline(0.2), 15, 10, 4.2, '#ff8a6a', true); dashed(g, outline(0.36), 9, 8, 2.6, 'rgba(255,255,255,0.95)', true);
      dashed(g, [[px(0), py(0.5)], [px(0), py(PET_L - 0.7)]], 16, 11, 5, '#ff5fa8', false);
      for (let k = 1; k < 7; k++) { const y = 0.5 + k * 0.58; for (const s of [-1, 1]) dashed(g, [[px(0), py(y)], [px(s * Math.min(0.22 + (PET_L - y) * 0.18, 1.0)), py(y + 0.42)]], 10, 8, 3.4, '#ff8a6a', false); }
    } else {
      g.save(); g.beginPath(); outline(0).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
      const bands = ['#ffb6d5', '#fff4e0', '#ffd9a8', '#ffc9de', '#fff0a6', '#ffb6d5'];
      for (let k = 0; k < 6; k++) { g.fillStyle = bands[k]; const y0 = py(k * PET_L / 5.6), y1 = py((k + 1) * PET_L / 5.6); g.fillRect(0, y1, cw, y0 - y1 + 1); if (k) { dashed(g, [[0, y0], [cw, y0]], 18, 11, 4.4, '#ff8a6a', false); } }
      g.fillStyle = '#ff5fa8'; g.beginPath(); g.moveTo(px(0), py(1.25)); g.bezierCurveTo(px(-0.7), py(1.9), px(-0.35), py(2.7), px(0), py(2.05)); g.bezierCurveTo(px(0.35), py(2.7), px(0.7), py(1.9), px(0), py(1.25)); g.fill();
      g.restore();
      dashed(g, outline(0.16), 14, 10, 4.2, '#fff4e0', true);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(1 / (2 * PET_W0), 1 / PET_L); t.offset.set(0.5, 0); return t;
  };
  const tLining = paintPetal('lining'), tTop = paintPetal('top');      // the painted maps double as a soft self-glow so petals seen against the sun are pastel felt, not brown
  const liningM = nf(new THREE.MeshStandardMaterial({ map: tLining, emissiveMap: tLining, emissive: new THREE.Color(0.22, 0.22, 0.22), roughness: 1 })); stitchify(liningM);
  const edgeM = nf(M.cloth(0xff9ecb, { rep: 3 }));
  const overM = nf(new THREE.MeshStandardMaterial({ map: tTop, emissiveMap: tTop, emissive: new THREE.Color(0.28, 0.28, 0.28), roughness: 1, side: THREE.DoubleSide })); stitchify(overM);
  const petals = new THREE.InstancedMesh(petalGeo, [liningM, edgeM], N_PET), petalTops = new THREE.InstancedMesh(overGeo, overM, N_PET);
  const tints = [0xffc9de, 0xffe9c8, 0xf0d8ff, 0xd8ffea, 0xfff2b8];
  for (let i = 0; i < N_PET; i++) petals.setColorAt(i, new THREE.Color(tints[i % tints.length]));
  for (const im of [petals, petalTops]) { im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; root.add(im); }
  const pet = Array.from({ length: N_PET }, (_, i) => {
    const th = i / N_PET * TAU + PI / N_PET;
    return { th, psi: Math.atan2(-Math.cos(th), -Math.sin(th)), delay: (i % 2) * 0.16 + hash(i * 3.1) * 0.07, open: 1.98 + (hash(i * 7.7) - 0.5) * 0.2, px: C.x + Math.cos(th) * HINGE_R, pz: C.z + Math.sin(th) * HINGE_R };
  });
  const PET_Y = Y1 - 0.36;
  // the centre button: covers the apex of the closed petals and pops off as the roof opens
  const btnTex = buttonCanvas(256);
  const btnGeo = new THREE.CylinderGeometry(1.62, 1.62, 0.3, 40); btnGeo.translate(0, 0.15, 0);
  const btnMats = [nf(M.cloth(0xff8fc0, { rep: 4 })), nf(stitchify(new THREE.MeshStandardMaterial({ map: btnTex, color: 0xffe066, roughness: 1 }))), nf(stitchify(new THREE.MeshStandardMaterial({ color: 0xffe9a0, roughness: 1 })))];
  const button = new THREE.Mesh(btnGeo, btnMats); button.castShadow = true; button.position.set(C.x, Y1 - 0.62, C.z); root.add(button);

  // =========================================================== top surface: parapet, scallops, bunting, chimneys, weather-vane, buttons
  const perimPts = []; {
    const inset = 0.85, x0 = -xa + inset, x1 = xa - inset, z0 = zb + inset, z1 = za - inset, r = cornerR;
    const arc = (cx, cz, a0) => { for (let i = 0; i <= 10; i++) { const a = a0 + i / 10 * PI / 2; perimPts.push(V3(cx + Math.cos(a) * r, Y1, cz + Math.sin(a) * r)); } };
    arc(x1 - r, z1 - r, 0); arc(x0 + r, z1 - r, PI / 2); arc(x0 + r, z0 + r, PI); arc(x1 - r, z0 + r, PI * 1.5);
  }
  const perim = new THREE.CatmullRomCurve3(perimPts, true, 'centripetal');
  const perimLen = perim.getLength();
  {
    const pipe = nf(M.cloth(0xff7fb8, { rep: 5 })); const t1 = new THREE.Mesh(new THREE.TubeGeometry(perim, lite ? 160 : 320, 0.3, 8, true), pipe); t1.position.y = 0.12; t1.castShadow = true; root.add(t1);
    const ns = Math.round(perimLen / 1.5), scal = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), nf(M.cloth(0xffffff, { rep: 4 })), ns), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), cols = [0xffb6d5, 0xfff4e0, 0xb6ffd6, 0xfff0a6, 0xd9a7ff];
    for (let i = 0; i < ns; i++) { const u = (i + 0.5) / ns, p = perim.getPointAt(u), tg = perim.getTangentAt(u); q.setFromUnitVectors(V3(1, 0, 0), V3(tg.x, 0, tg.z).normalize()); sc.set(0.86, 0.6, 0.62); m4.compose(V3(p.x, Y1 + 0.34, p.z), q, sc); scal.setMatrixAt(i, m4); scal.setColorAt(i, new THREE.Color(cols[i % cols.length])); }
    scal.instanceMatrix.needsUpdate = true; scal.instanceColor.needsUpdate = true; scal.frustumCulled = false; scal.castShadow = true; scal.receiveShadow = true; root.add(scal);
    // running stitches along the top of the piping
    const nst = Math.round(perimLen / 0.55), sgeo = new THREE.CylinderGeometry(0.045, 0.045, 0.34, 5, 1); sgeo.rotateZ(PI / 2);
    const sim = new THREE.InstancedMesh(sgeo, nf(stitchify(new THREE.MeshStandardMaterial({ color: 0xfff4e0, roughness: 1 }))), nst);
    for (let i = 0; i < nst; i++) { const u = (i + 0.5) / nst, p = perim.getPointAt(u), tg = perim.getTangentAt(u); q.setFromUnitVectors(V3(1, 0, 0), V3(tg.x, 0, tg.z).normalize()); m4.compose(V3(p.x, Y1 + 0.12 + 0.3, p.z), q, sc.set(1, 1, 1)); sim.setMatrixAt(i, m4); }
    sim.instanceMatrix.needsUpdate = true; sim.frustumCulled = false; root.add(sim);
  }
  // bunting along the parapet: candy posts, strings (merged tubes), swaying flags (instanced)
  const flags = [];
  const flagGeo = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.34, 0, 0, 0.34, 0, 0, 0, -0.82, 0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2)); return g; })();
  const stringGeos = [];
  {
    const postN = 20, posts = [];
    for (let i = 0; i < postN; i++) { const u = i / postN, p = perim.getPointAt(u); posts.push(V3(p.x, Y1 + 2.5, p.z)); }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), nf(M.plastic(0xfff4e0, { rough: 0.4 })), postN), bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), nf(M.plastic(0xff7fb8)), postN), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    posts.forEach((p, i) => { pm.setMatrixAt(i, m4.compose(V3(p.x, Y1 + 1.3, p.z), q, sc)); bm.setMatrixAt(i, m4.compose(V3(p.x, Y1 + 2.64, p.z), q, sc)); });
    pm.instanceMatrix.needsUpdate = true; bm.instanceMatrix.needsUpdate = true; pm.frustumCulled = bm.frustumCulled = false; pm.castShadow = true; root.add(pm, bm);
    for (let i = 0; i < postN; i++) {
      const a = posts[i], b = posts[(i + 1) % postN], mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 0.85;
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone()); stringGeos.push(new THREE.TubeGeometry(curve, 14, 0.018, 4, false));
      const nfl = Math.round(a.distanceTo(b) / 0.95);
      for (let k = 1; k < nfl; k++) { const t = k / nfl, p = curve.getPoint(t), tg = curve.getTangent(t); flags.push({ p, yaw: Math.atan2(-tg.z, tg.x), col: [0xff9ecb, 0xffe066, 0x9fe3ff, 0xd9a7ff, 0xb6ffd6][(i + k) % 5], ph: hash(i * 13.7 + k) * TAU, k: 0.5 + hash(k * 5.3 + i) * 0.5 }); }
    }
    root.add(new THREE.Mesh(mergeGeometries(stringGeos), nf(M.thread(0xfff4e0))));
  }
  const flagIM = new THREE.InstancedMesh(flagGeo, nf(M.cloth(0xffffff, { rep: 3 })), flags.length); flagIM.frustumCulled = false; flagIM.castShadow = true;
  flags.forEach((f, i) => flagIM.setColorAt(i, new THREE.Color(f.col))); flagIM.instanceColor.needsUpdate = true; root.add(flagIM);

  // chimneys: barber-pole swirls, a flared cap, cotton puffs
  const poleTex = poleCanvas(); poleTex.repeat.set(3, 1.6);
  const chimneys = [[-15.5, -7.0, 3.6], [15.0, 15.5, 3.0], [-17.5, 19.0, 3.3]];
  const poleMat = nf(stitchify(new THREE.MeshStandardMaterial({ map: poleTex, roughness: 1 }))), capMat = nf(M.cloth(0xff8a6a, { rep: 4 }));
  chimneys.forEach(([x, z, h]) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.02, h, 24, 1), poleMat); body.position.set(x, Y1 + h / 2, z); body.castShadow = true; body.receiveShadow = true; root.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.0, 0.42, 24), capMat); cap.position.set(x, Y1 + h + 0.15, z); cap.castShadow = true; root.add(cap);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 28), capMat); lip.rotation.x = PI / 2; lip.position.set(x, Y1 + h + 0.36, z); root.add(lip);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.16, 8, 28), capMat); foot.rotation.x = PI / 2; foot.position.set(x, Y1 + 0.1, z); root.add(foot);
  });
  const puffs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), nf(M.cloth(0xffffff, { rep: 5 })), chimneys.length * 4); puffs.frustumCulled = false; root.add(puffs);
  // bunting between the chimneys
  {
    const strings = [], pairs = [[0, 1], [1, 2]], fl = [];
    pairs.forEach(([ia, ib]) => { const A = chimneys[ia], B = chimneys[ib], a = V3(A[0], Y1 + A[2] + 0.5, A[1]), b = V3(B[0], Y1 + B[2] + 0.5, B[1]), mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 3.2; const cu = new THREE.QuadraticBezierCurve3(a, mid, b); strings.push(new THREE.TubeGeometry(cu, 24, 0.02, 4, false)); const n = Math.round(a.distanceTo(b) / 1.05); for (let k = 1; k < n; k++) { const t = k / n, p = cu.getPoint(t), tg = cu.getTangent(t); flags.push({ p, yaw: Math.atan2(-tg.z, tg.x), col: [0xffe066, 0xff9ecb, 0xb6ffd6, 0x9fe3ff][(k + ia) % 4], ph: hash(k * 3.3 + ia) * TAU, k: 0.7 }); } });
    root.add(new THREE.Mesh(mergeGeometries(strings), nf(M.thread(0xfff4e0))));
    flagIM.dispose(); root.remove(flagIM);
  }
  const flagIM2 = new THREE.InstancedMesh(flagGeo, nf(M.cloth(0xffffff, { rep: 3 })), flags.length); flagIM2.frustumCulled = false; flagIM2.castShadow = true;
  flags.forEach((f, i) => flagIM2.setColorAt(i, new THREE.Color(f.col))); flagIM2.instanceColor.needsUpdate = true; root.add(flagIM2);

  // needle weather-vane: a giant needle that points into the wind, on a pole with a ball
  const vane = new THREE.Group(); vane.position.set(13.5, Y1, -8.2); root.add(vane);
  {
    const steel = nf(M.metal(0xeef2f8)), gold = nf(M.plastic(0xffd45e, { rough: 0.25 }));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 4.6, 10), gold); pole.position.y = 2.3; pole.castShadow = true; vane.add(pole);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), gold); ball.position.y = 4.75; vane.add(ball);
    const arm = new THREE.Group(); arm.position.y = 4.75; vane.add(arm); vane.userData.arm = arm;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 10), steel); shaft.rotation.z = PI / 2; shaft.position.x = 0.0; shaft.castShadow = true; arm.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.9, 10), steel); tip.rotation.z = -PI / 2; tip.position.x = 2.25; arm.add(tip);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), steel); eye.rotation.y = PI / 2; eye.scale.set(1, 1.5, 1); eye.position.x = -1.9; arm.add(eye);
    const thread = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 20, 4.2), M.thread(0xff5fa8)); thread.position.set(-2.25, 0.0, 0); thread.rotation.y = PI / 2; arm.add(thread);
  }
  // big flat buttons and a heart patch sewn on the roof
  {
    const btnM = new THREE.MeshStandardMaterial({ map: btnTex, roughness: 1 }); nf(stitchify(btnM));
    const spots = [[-8, 12, 0xff9ecb], [7.5, -4.5, 0xb6ffd6], [-12.5, 3.0, 0xfff0a6], [16.5, 4.0, 0xd9a7ff], [4.5, 20.0, 0xa8e6ff], [-4.0, -10.5, 0xffc9a8]];
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.25, 1.25, 0.22, 32), btnM, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, c], i) => { m4.compose(V3(x, Y1 + 0.11, z), q.setFromAxisAngle(V3(0, 1, 0), i * 1.3), sc); im.setMatrixAt(i, m4); im.setColorAt(i, new THREE.Color(c)); });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; root.add(im);
  }

  // =========================================================== light shafts (additive)
  const shaftMat = (k, flip) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { c: { value: new THREE.Color(0xffd9a0) }, k: { value: k } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform vec3 c; uniform float k; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(clamp(abs(dot(vN,vV)), 0.0, 1.0),1.3); float fade = ${flip ? 'pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7)' : 'pow(clamp(vUv.y, 0.0, 1.0), 1.2)'}; gl_FragColor = vec4(min(c*edge*fade*k*2.0, vec3(4.0)), 1.0); }`,
  });
  const shaftLo = new THREE.Mesh(new THREE.CylinderGeometry(R_HOLE - 0.15, R_HOLE + 0.9, Y0 + 0.4, 56, 1, true), shaftMat(0.16, false)); shaftLo.position.set(C.x, (Y0 + 0.4) / 2, C.z); shaftLo.renderOrder = 6; root.add(shaftLo);
  const shaftHi = new THREE.Mesh(new THREE.CylinderGeometry(R_HOLE + 4.5, R_HOLE, 46, 56, 1, true), shaftMat(0.10, true)); shaftHi.position.set(C.x, Y1 + 23, C.z); shaftHi.renderOrder = 6; root.add(shaftHi);

  // =========================================================== anchors
  ext.anchors = { roofY: Y1, ceilY: Y0, skylight: { x: C.x, y: (Y0 + Y1) / 2, z: C.z, r: R_HOLE }, ped: { x: C.x, z: C.z }, petals: N_PET, petalLen: PET_L, petalOpenRad: 1.98, centre: { x: 0, z: sh.zc }, footprint: { x0: -xa, x1: xa, z0: zb, z1: za }, sunDir: { x: SUN_DIR.x, z: SUN_DIR.z } };
  ext.slots = {};

  // =========================================================== rigs
  const A = C, f0 = F0;
  const at = (d, y, side = 0) => [A.x + f0.x * d + f0.z * side, y, A.z + f0.z * d - f0.x * side];       // point at distance d along the finale axis (+ lateral offset), height y
  // craneOut: THE shot.  u.p 0..1.  Camera: 3.4 m up, 7 m in front of Pip looking at her -> rises, tilting down on her, through the skylight (p 0.30..0.46) ->
  // keeps rising and pulls out along the finale axis to 380 m out / 90 m up, looking back at the mall with the horizon in the top third (last 25 %: a calm drift).
  const kp = [0, 0.14, 0.28, 0.37, 0.46, 0.55, 0.65, 0.76, 0.88, 1.0];
  const fD = pchip(kp, [7.0, 6.3, 4.6, 3.1, 3.3, 10, 48, 150, 300, 380]);
  const fY = pchip(kp, [3.4, 4.6, 7.6, 11.9, 19.5, 31, 47, 65, 81, 90]);
  const fTb = pchip(kp, [0, 0, 0, 0, 5, 24, 60, 88, 132, 176]);             // look target: distance behind the axis (against the finale axis)
  const fTy = pchip(kp, [1.45, 1.4, 1.3, 1.2, 3.5, 6, 6, 4, 1.5, 0]);
  const fFov = pchip(kp, [38, 39, 41, 45, 48, 48, 47, 46, 45, 44]);
  ext.rigs = {
    craneOut: (u) => {
      const p = clamp(u.p), d = fD(p), y = fY(p), b = fTb(p), ty = fTy(p);
      return { pos: at(d, y), look: at(-b, ty), fov: fFov(p) };
    },
    // floor level beside the pedestal, looking straight up through the skylight at the petals and the sky.  u.p: a slow quarter-turn of the picture and a tilt
    up: (u) => ({ pos: at(1.6 + 0.2 * u.p, 0.9, 0.7), look: [A.x + 0.2, 60, A.z - 0.3], fov: 62 - 6 * u.p, roll: 0.35 * u.p - 0.15 }),
    // low on the roof's front half, looking back across the open flower into the sunrise: the crown of petals stands against the sun.  u.p: creeps 3 m closer and rises 0.5 m
    roofRim: (u) => {
      const hd = SUN_HEADING + 0.20 - 0.12 * u.p, f = [Math.sin(hd), Math.cos(hd)], rt = [-Math.cos(hd), Math.sin(hd)], d = 15.5 - 3.0 * u.p;
      const pos = [A.x - f[0] * d - rt[0] * 3.0, Y1 + 0.9 + 0.5 * u.p, A.z - f[1] * d - rt[1] * 3.0];
      return { pos, look: [pos[0] + f[0] * 60, Y1 + 0.9 + 0.5 * u.p + 60 * 0.075, pos[2] + f[1] * 60], fov: 46 };
    },
    // straight down at 40 m over the petals, slow turn.  u.p
    roofTop: (u) => ({ pos: [A.x + 0.3, 40 + 3 * u.p, A.z + 2.6], look: [A.x + 0.3, Y1, A.z + 2.5], fov: 50, roll: -0.35 + 0.6 * u.p }),
    // low and grazing over the roof patchwork toward the sun button, petals silhouetted.  u.p: 7 m of dolly toward the sun
    sunrise: (u) => {
      const s = SUN_DIR, pos = [14 - s.x * 0 + s.x * 7 * u.p, Y1 + 0.9 + 0.5 * u.p, 20.5 + s.z * 7 * u.p];
      const hd = SUN_HEADING + 0.20 - 0.07 * u.p;
      return { pos, look: [pos[0] + Math.sin(hd) * 100, pos[1] + 5.5, pos[2] + Math.cos(hd) * 100], fov: 46 };
    },
  };

  // =========================================================== light
  // finale preset.  Inside (camera below the roof): a warm key from high above the skylight (78 deg) with a tight shadow box on the pedestal, so the
  // ceiling shades the mall and the opening throws a disc of sun on the pedestal; gold-pink hemisphere; a spot down the shaft; party spots reduced.
  // Outside (camera above the roof): the low sunrise key from the sun side; shadows stay on for the roof (box 34 m) until the camera is above 34 m, then off.
  // The blend follows the camera height (c2.cam.position.y when the film provides it, else args.camY).
  const cKey = new THREE.Color(), cA = new THREE.Color(0xffd2a0), cB = new THREE.Color(0xffc38a), cH1 = new THREE.Color(), cH2 = new THREE.Color();
  ext.light = (kit, u, c2) => {
    const roof = clamp(c2.args?.roof ?? 0), open = smooth(roof * 1.6), camY = c2.cam?.position?.y ?? c2.args?.camY ?? 0;
    const out = sstep(13, 30, camY), iris = 1 - sstep(30, 46, camY);      // the key always casts (switching it would recompile every material and lose a frame): above 30 m its shadow box just closes down to a few metres
    const alive = c2.alive ?? 1;
    // interior sun: near-vertical, from the sun side
    const iEl = 1.36, ix = SUN_DIR.x * Math.cos(iEl), iz = SUN_DIR.z * Math.cos(iEl), iy = Math.sin(iEl);
    const oEl = 0.27, ox = SUN_DIR.x * Math.cos(oEl), oz = SUN_DIR.z * Math.cos(oEl), oy = Math.sin(oEl);
    const dx = lerp(ix, ox, out), dy = lerp(iy, oy, out), dz = lerp(iz, oz, out), l = Math.hypot(dx, dy, dz);
    const tgt = [lerp(C.x, 0, out), lerp(0.6, 11.8, out), lerp(C.z, sh.zc, out)];
    const dist = lerp(50, 90, out);
    kit.setKey({
      pos: [tgt[0] + dx / l * dist, tgt[1] + dy / l * dist, tgt[2] + dz / l * dist], target: tgt,
      color: cKey.copy(cA).lerp(cB, out), i: lerp(open * 1.3 + 0.25, 2.5, out), extent: lerp(24, 34, out) * lerp(0.08, 1, iris), near: 20, far: dist + 70, bias: -0.0006, normalBias: 0.05, radius: 5,
    });
    kit.setHemi({ sky: cH1.set(0xffe2cf).lerp(new THREE.Color(0xffdcc8), out), ground: cH2.set(0xe0a8b8).lerp(new THREE.Color(0xc8a0c8), out), i: lerp(0.45, 0.85, out) });
    const spotK = 1 - out;
    kit.setSpot(0, { color: 0xfff0d8, i: 95 * open * spotK + 35 * (1 - open) * spotK, dist: 42, angle: 0.36, pen: 0.55, decay: 1.2, pos: [C.x + 0.8, 15.2, C.z + 0.6], target: [C.x, 0.5, C.z] });
    const party = 0.5 * spotK;
    kit.setSpot(3, { color: 0xff9ecb, i: 85 * party, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: [-9, 6, -1], target: [-1, 1, 1] });
    kit.setSpot(4, { color: 0x9fe3ff, i: 85 * party, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: [8, 6, -1], target: [-1, 1, 1] });
    kit.setSpot(5, { color: 0xfff0c0, i: 35 * party, dist: 34, angle: 0.8, pen: 0.6, decay: 1.2, pos: [0, 9, 8], target: [0, 0.8, 0] });
    const fillK = sstep(24, 70, camY);      // spot 1: from high on the finale-axis side, no falloff, wide soft edge: a pool of light on the roof, plaza and the quilt around it
    kit.setSpot(1, { color: 0xffe6d0, i: 1.2 * fillK, dist: 0, angle: 0.2, pen: 0.9, decay: 0, pos: [A.x + f0.x * 250, 250, A.z + f0.z * 250], target: [0, 6, sh.zc] });
    kit.setPoint(1, { color: 0xffeef8, i: 46 * spotK * alive, dist: 60, decay: 1.2, pos: [-2, 10.5, 2] });
  };

  // =========================================================== update
  const m4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), sc1 = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
  const X_AX = V3(1, 0, 0), Y_AX = V3(0, 1, 0), Z_AX = V3(0, 0, 1);
  const flagQ = new THREE.Quaternion(), flagQ2 = new THREE.Quaternion(), flagS = new THREE.Vector3();
  ext.update = (u, c2) => {
    const roof = clamp(c2.args?.roof ?? 0), t = c2.t ?? u.t, dawn = clamp(c2.args?.dawn ?? 1), alive = c2.alive ?? 1;
    for (let i = 0; i < N_PET; i++) {
      const p = pet[i], x = clamp((roof - p.delay) / (1 - 0.23)), phi = p.open * backOut(x);
      qa.setFromAxisAngle(Y_AX, p.psi); qb.setFromAxisAngle(X_AX, -phi); qa.multiply(qb);
      m4.compose(pp.set(p.px, PET_Y, p.pz), qa, sc1); petals.setMatrixAt(i, m4); petalTops.setMatrixAt(i, m4);
    }
    petals.instanceMatrix.needsUpdate = true; petalTops.instanceMatrix.needsUpdate = true; petals.instanceColor.needsUpdate = true;
    // the button pops off in the first quarter of the opening: up, spinning, shrinking
    const bk = sstep(0.0, 0.26, roof);
    button.visible = bk < 0.999; button.position.y = Y1 - 0.62 + bk * 3.2 * (1 - 0.3 * bk); button.rotation.y = bk * 5.0; button.scale.setScalar(Math.max(0.001, 1 - sstep(0.4, 1, bk)));
    if (underStitches) underStitches.visible = (c2.cam?.position?.y ?? c2.args?.camY ?? 0) < 14;      // ~2000 stitches under the rafters: nobody sees them from above
    // shafts
    const sh1 = sstep(0.12, 0.6, roof) * (0.6 + 0.4 * alive);
    shaftLo.material.uniforms.k.value = 0.11 * sh1; shaftHi.material.uniforms.k.value = 0.07 * sh1; shaftLo.visible = shaftHi.visible = sh1 > 0.002;
    // lamps flicker (deterministic), bunting sways
    lamps.forEach((l) => { const f = 0.94 + 0.06 * Math.sin(t * 7.3 + l.ph) * Math.sin(t * 2.9 + l.ph * 1.7); l.disc.material.color.copy(l.base).multiplyScalar(f); });
    flags.forEach((f, i) => {
      const sw = Math.sin(t * 2.2 + f.ph) * 0.3 * f.k + Math.sin(t * 0.7 + f.ph * 0.5) * 0.12;
      flagQ.setFromAxisAngle(Y_AX, f.yaw); flagQ2.setFromAxisAngle(X_AX, sw); flagQ.multiply(flagQ2); m4.compose(f.p, flagQ, flagS.set(1, 1, 1)); flagIM2.setMatrixAt(i, m4);
    });
    flagIM2.instanceMatrix.needsUpdate = true;
    // cotton puffs rise out of the chimneys, grow, and shrink away (looping, pure in t)
    chimneys.forEach(([x, z, h], ci) => { for (let k = 0; k < 4; k++) { const ph = ((t * 0.12 + k / 4 + ci * 0.31) % 1 + 1) % 1, s = Math.sin(ph * PI) * (0.5 + ph * 0.8); pp.set(x + ph * 1.8 + Math.sin(ph * 6 + ci) * 0.25, Y1 + h + 0.9 + ph * 4.2, z + ph * 0.7); m4.compose(pp, qa.identity(), flagS.set(s, s * 0.85, s)); puffs.setMatrixAt(ci * 4 + k, m4); } });
    puffs.instanceMatrix.needsUpdate = true;
    vane.userData.arm.rotation.y = (SUN_HEADING - PI / 2) + 0.35 * Math.sin(t * 0.45) + 0.1 * Math.sin(t * 1.3);
    U.haze.value.copy(skyRamp(dawn).hor);
  };

  ext.post = { band: 0.40, tilt: 1.7, focusY: 0.5 };
  // the stitch band while this extension's rigs are on screen: FRONT's own defaults (0.55 m) in the room, the wide aerial band once the camera is high above the roof (see aerialFront)
  ext.front = (u, c2) => {
    const kk = sstep(16, 90, c2?.cam?.position?.y ?? 0), a = aerialFront(c2?.R);
    return { width: lerp(0.55, a.width, kk), noise: lerp(0.55, a.noise, kk), dash: Math.round(lerp(46, a.dash, kk)), thread: a.thread };
  };
  root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.fog = false; });      // the whole roof is far from most cameras: no scene fog on any of it
  return ext;
}
