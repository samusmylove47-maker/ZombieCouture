// The ATELIER: fitting room (verse 2) and, with u.mode === 'tea', the candlelit tea party (bridge), with a skylight that opens onto the quilt sky.
// Region x 73..87, z -5..5, ceiling 5.5.  Local frame = world minus (80, 0, 0): x -7..7, z -5..5.  All static pieces are merged (few draw calls);
// everything that moves is a pure function of u.t, c2.beat, c2.pulse, c2.args.
//
// Layout (local):  north wall (z -5): three-panel mirror behind the platform (0,0), garment rack to the east, curtained booth in the NW corner.
//   west wall (x -7): round window, spool shelves, cutting table.  SE: sewing table.  Wait line runs east of the platform.  Skylight r 2.5 above (0,0).
//   Characters on the platform face +z (the main camera side); the mirror is the pale backdrop behind them.
//
// API:  build(ctx) -> { name, root, anchors, rigs, slots, update(u, c2), light(kit, u, c2), post, info }.  World coordinates (x offset 80).
//   Mode: 'tea' when u.mode === 'tea' or c2.args.mode === 'tea' (candlelit party, fitting group hidden); anything else is the bright fitting room.
//   c2.args:  skylight 0..1 (sliding roof panels, light shaft, moon/dawn pool; raw progress, eased here) | seat 0..6 (teaCU target, armDrop subject)
//             unroll 0..1 (tulle roll on the cutting table, defaults to u.p) | tilt 0 (skyUp: fixed straight-up view).  c2.pulse / c2.beat drive the beat twinkle.
//   Rigs (u.p unless noted, all pure): fitWide fitTwo hemPin mirror rackPan tableCU laceMacro swayLine | teaWide teaCU teaOverhead teaLow armDrop | skyUp skyRise.
//   Slots: platform platformL platformR rackFront tableFront waitLine0..5 teaSeat0..6 (y = root height on the stool) machine.
import * as THREE from 'three';
import { stitchify } from '../stitch.js';
import { hash, clamp, lerp, smooth, smoother } from '../util.js';
import {
  Batch, Stitches, Glow, PAL, CANDY, rng, xf, cylG, sphG, torG, rboxG, latheG, tubeG, skirtG, archShape, ribbonG,
  plankTex, wallTex, ceilTex, quiltTex, matTex, tapeTex, mirrorTex, windowTex,
} from './atelier_kit.js';

const PI = Math.PI, TAU = PI * 2, CX = 80;
const HOLE = 2.5, ROOF = 5.75, CEIL = 5.5;
const SEAT_R = 1.5, SEAT_TOP = 0.62, SEAT_ROOT = SEAT_TOP - 0.0, PLAT_TOP = 0.33, TABLE_TOP = 0.95;
const seatPhi = (k) => -2.0 + k * (4.0 / 6);
const seatXZ = (k) => { const f = seatPhi(k); return { x: Math.sin(f) * SEAT_R, z: -Math.cos(f) * SEAT_R }; };

export function build(ctx) {
  const { M, root, quality = 'full' } = ctx;
  const H = ctx.H ?? 720, lite = quality === 'lite';
  const Lg = new THREE.Group(); Lg.name = 'atelier'; Lg.position.set(CX, 0, 0); root.add(Lg);
  const G = { room: new THREE.Group(), fit: new THREE.Group(), tea: new THREE.Group() };
  G.room.name = 'room'; G.fit.name = 'fitting'; G.tea.name = 'tea';
  Lg.add(G.room, G.fit, G.tea);
  const B = { room: new Batch(M, G.room, 'room'), fit: new Batch(M, G.fit, 'fit'), tea: new Batch(M, G.tea, 'tea') };
  const ST = { room: new Stitches(), fit: new Stitches(), tea: new Stitches() };
  const glow = new Glow(300, H); Lg.add(glow.obj);
  const R = rng(2026);
  const texMat = (map, o = {}) => stitchify(new THREE.MeshStandardMaterial({ map, roughness: o.rough ?? 1, bumpMap: M.fabricTex(o.bumpRep ?? 18), bumpScale: o.bump ?? 1.2, side: o.side ?? THREE.FrontSide, ...(o.extra || {}) }));
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const mesh = (geo, mat, parent, o = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0); m.castShadow = !!o.cast; m.receiveShadow = o.recv !== false; parent.add(m); return m; };
  const sagLine = (a, b, drop, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - drop * 4 * t * (1 - t), lerp(a[2], b[2], t)]; });
  const bowB = (b, o, col, s = 1) => b.place(o, (bb) => { for (const sd of [-1, 1]) bb.add(sphG(0.055 * s, 12, 8), col, { x: sd * 0.06 * s, sx: 1.25, sy: 0.72, sz: 0.5, rz: sd * 0.25 }, 'cloth', false); bb.add(sphG(0.03 * s, 10, 8), col, { z: 0.005 }, 'cloth', false); bb.add(sphG(0.014 * s, 6, 5), col, { x: 0.02 * s, y: -0.06 * s, sy: 3, rz: 0.35 }, 'cloth', false); });
  const flowerB = (b, o, col, centre = PAL.butter2, s = 1, petals = 5) => b.place(o, (bb) => { for (let i = 0; i < petals; i++) { const a = i / petals * TAU; bb.add(sphG(0.035 * s, 8, 6), col, { x: Math.cos(a) * 0.04 * s, y: Math.sin(a) * 0.04 * s, sz: 0.5 }, 'cloth', false); } bb.add(sphG(0.025 * s, 8, 6), centre, { z: 0.01 * s }, 'cloth', false); });
  const spoolB = (b, o, col, r = 0.06, h = 0.13, fl = PAL.cream, cast = false) => b.place(o, (bb) => {
    bb.add(cylG(r * 1.38, r * 1.38, h * 0.11, 12), fl, { y: h * 0.055 }, 'felt', cast); bb.add(cylG(r * 1.38, r * 1.38, h * 0.11, 12), fl, { y: h - h * 0.055 }, 'felt', cast);
    bb.add(cylG(r, r, h * 0.82, 12), col, { y: h / 2 }, 'cloth', cast);
    bb.add(torG(r * 1.01, r * 0.07, 5, 14), PAL.cream, { y: h * 0.33, rx: PI / 2 }, 'cloth', false); bb.add(torG(r * 1.01, r * 0.07, 5, 14), PAL.cream, { y: h * 0.66, rx: PI / 2 }, 'cloth', false);
  });
  const pinB = (b, o, col) => b.place(o, (bb) => { bb.add(cylG(0.0035, 0.0035, 0.07, 4), 0xdfe6ee, { y: 0.035 }, 'felt', false); bb.add(sphG(0.011, 6, 5), col, { y: 0.073 }, 'felt', false); });

  // ================================================================ THE SHELL
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 11.4), texMat(plankTex(), { bumpRep: 30, bump: 0.7 }));
  floor.rotation.x = -PI / 2; floor.receiveShadow = true; G.room.add(floor);

  const WALLS = [
    { o: [-7, -5], d: [1, 0], n: [0, 1], ry: 0, len: 14 }, { o: [7, 5], d: [-1, 0], n: [0, -1], ry: PI, len: 14 },
    { o: [-7, 5], d: [0, -1], n: [1, 0], ry: PI / 2, len: 10 }, { o: [7, -5], d: [0, 1], n: [-1, 0], ry: -PI / 2, len: 10 },
  ];
  const wp = (W, s, off = 0) => [W.o[0] + W.d[0] * s + W.n[0] * off, W.o[1] + W.d[1] * s + W.n[1] * off];
  const wallMat = texMat(wallTex(), { bumpRep: 3, bump: 1.0 });
  for (const W of WALLS) {
    const g = new THREE.PlaneGeometry(W.len, CEIL - 1.4), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W.len / 1.4, uv.getY(i) * (CEIL - 1.4) / 1.4);
    const [x, z] = wp(W, W.len / 2, 0); mesh(g, wallMat, G.room, { x, y: 1.4 + (CEIL - 1.4) / 2, z, ry: W.ry });
    // dado: quilted mint pillows, chair rail, skirting, picture rail, crown
    const np = Math.floor(W.len / 0.78);
    for (let i = 0; i < np; i++) {
      const s = (i + 0.5) * W.len / np, [px, pz] = wp(W, s, 0.06);
      B.room.rbox(W.len / np - 0.1, 1.16, 0.12, 0.06, i % 3 === 1 ? 0xd8c8ff : 0xc2aef5, { x: px, y: 0.78, z: pz, ry: W.ry }, 'felt', false);
      if (i % 2 === 0) { const [bx, bz] = wp(W, s, 0.125); B.room.add(sphG(0.028, 8, 6), PAL.pink, { x: bx, y: 0.78, z: bz, sz: 0.6, ry: W.ry }, 'felt', false); }
    }
    const [mx, mz] = wp(W, W.len / 2, 0.09), [rx2, rz2] = wp(W, W.len / 2, 0.05);
    B.room.rbox(W.len + 0.1, 0.1, 0.22, 0.04, PAL.cream, { x: mx, y: 1.42, z: mz, ry: W.ry }, 'felt', false);
    B.room.rbox(W.len + 0.1, 0.17, 0.2, 0.05, PAL.butter, { x: mx, y: 0.085, z: mz, ry: W.ry }, 'felt', false);
    B.room.rbox(W.len + 0.1, 0.07, 0.11, 0.03, PAL.coral, { x: rx2, y: 3.92, z: rz2, ry: W.ry }, 'felt', false);
    B.room.rbox(W.len + 0.1, 0.22, 0.2, 0.06, PAL.cream, { x: mx, y: CEIL - 0.11, z: mz, ry: W.ry }, 'felt', false);
    ST.room.poly([wp(W, 0.05, 0.16), wp(W, W.len - 0.05, 0.16)].map(([x2, z2]) => [x2, 1.485, z2]), PAL.coral, { gap: 0.2, len: 0.1 });
    ST.room.poly([wp(W, 0.05, 0.1), wp(W, W.len - 0.05, 0.1)].map(([x2, z2]) => [x2, 3.86, z2]), PAL.cream, { gap: 0.2, len: 0.1 });
  }
  // outer shell (thick, so the roof edge and outside faces exist), buried below the quilt ground
  const ext = PAL.peach2;
  B.room.rbox(15.6, 7.0, 0.6, 0.12, ext, { y: 2.9, z: -5.34 }, 'felt', false); B.room.rbox(15.6, 7.0, 0.6, 0.12, ext, { y: 2.9, z: 5.34 }, 'felt', false);
  B.room.rbox(0.6, 7.0, 10.4, 0.12, ext, { x: -7.34, y: 2.9 }, 'felt', false); B.room.rbox(0.6, 7.0, 10.4, 0.12, ext, { x: 7.34, y: 2.9 }, 'felt', false);
  for (const [x, z, ry, len] of [[0, -5.62, 0, 15], [0, 5.62, 0, 15], [-7.62, 0, PI / 2, 10.4], [7.62, 0, PI / 2, 10.4]]) {
    ST.room.poly([[-len / 2, 0, 0], [len / 2, 0, 0]].map(([a, , c]) => [x + Math.cos(ry) * a, 2.3, z - Math.sin(ry) * a]), PAL.cream, { gap: 0.22, len: 0.11 });
    B.room.rbox(len + 0.1, 0.16, 0.06, 0.03, PAL.pink, { x, y: 2.9, z: z + (z !== 0 ? Math.sign(z) * -0.0 : 0), ry }, 'felt', false);
  }

  // ---- ceiling with the skylight opening (underside), roof top (quilt), hole wall, collar, parapet, rails
  const outline = (hw, hd) => { const s = new THREE.Shape(); s.moveTo(-hw, -hd); s.lineTo(hw, -hd); s.lineTo(hw, hd); s.lineTo(-hw, hd); s.closePath(); const h = new THREE.Path(); h.absarc(0, 0, HOLE, 0, TAU, true); s.holes.push(h); return s; };
  const ceilT = ceilTex(); ceilT.offset.set(0.5, 0.5);
  const cg = new THREE.ShapeGeometry(outline(7.05, 5.05), 64); cg.rotateX(PI / 2); cg.translate(0, CEIL, 0);
  const ceilMat = texMat(ceilT, { bumpRep: 2, bump: 0.9 });
  const ceilMesh = mesh(cg, ceilMat, G.room, { recv: false, cast: false });
  const rg = new THREE.ShapeGeometry(outline(7.45, 5.45), 64); rg.rotateX(-PI / 2); rg.translate(0, ROOF, 0);
  mesh(rg, texMat(quiltTex(), { bumpRep: 2, bump: 1.2 }), G.room, { recv: true });
  B.room.add(cylG(HOLE, HOLE, ROOF - CEIL, 56, true), PAL.pink2, { y: (ROOF + CEIL) / 2 }, 'cloth', false);
  B.room.tor(HOLE + 0.14, 0.1, PAL.butter, { y: ROOF + 0.07, rx: PI / 2 }, 8, 72, 'felt', false);
  ST.room.ring(0, ROOF + 0.17, 0, HOLE + 0.14, 'xz', PAL.coral, { gap: 0.2, len: 0.1 });
  B.room.tor(HOLE + 0.02, 0.05, PAL.coral, { y: CEIL - 0.02, rx: PI / 2 }, 6, 64, 'felt', false);        // trim ring under the hole
  for (const [x, z, sx, sz] of [[0, -5.3, 15.2, 0.3], [0, 5.3, 15.2, 0.3], [-7.3, 0, 0.3, 10.6], [7.3, 0, 0.3, 10.6]]) B.room.rbox(sx, 0.34, sz, 0.12, PAL.butter, { x, y: ROOF + 0.15, z }, 'felt', false);
  for (const [x, z] of [[-7.3, -5.3], [7.3, -5.3], [-7.3, 5.3], [7.3, 5.3]]) B.room.add(sphG(0.24, 14, 10), PAL.pink, { x, y: ROOF + 0.38, z }, 'felt', false);
  ST.room.poly([[-7.3, ROOF + 0.33, -5.3], [7.3, ROOF + 0.33, -5.3], [7.3, ROOF + 0.33, 5.3], [-7.3, ROOF + 0.33, 5.3], [-7.3, ROOF + 0.33, -5.3]], PAL.coral, { gap: 0.24, len: 0.12 });
  for (const z of [-2.95, 2.95]) B.room.rbox(13.4, 0.08, 0.2, 0.03, PAL.cream, { y: ROOF + 0.04, z }, 'felt', false);
  const beamMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { c: { value: new THREE.Color(0xbfd0ff) }, k: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN,vV)),1.3); float f = pow(vUv.y,1.15) * smoothstep(0.0,0.08,vUv.y) * (1.0 - smoothstep(0.86,1.0,vUv.y)); gl_FragColor = vec4(c*e*f*k, 1.0); }',
  });
  const shaft = new THREE.Mesh(cylG(HOLE - 0.05, HOLE + 0.5, CEIL - 0.1, 56, true), beamMat()); shaft.position.y = (CEIL - 0.1) / 2 + 0.05; shaft.renderOrder = 5; shaft.visible = false; G.room.add(shaft);
  const shaft2 = new THREE.Mesh(cylG(0.9, 1.5, CEIL - 0.1, 40, true), beamMat()); shaft2.position.set(0.15, (CEIL - 0.1) / 2 + 0.05, 0.1); shaft2.renderOrder = 5; shaft2.visible = false; G.room.add(shaft2);

  // ---- the two sliding roof panels (half discs riding on the roof rails)
  const panels = [];
  const panelUnder = texMat(ceilT, { bumpRep: 2, bump: 0.9 });
  for (const sg of [-1, 1]) {
    const grp = new THREE.Group(); G.room.add(grp);
    const sh = new THREE.Shape(); sh.absarc(0, 0, HOLE + 0.3, sg > 0 ? -PI / 2 : PI / 2, sg > 0 ? PI / 2 : PI * 1.5, false); sh.closePath();
    const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 44 }); eg.rotateX(-PI / 2); eg.translate(0, ROOF + 0.17, 0);
    const pb = new Batch(M, grp, 'panel'); pb.add(eg, PAL.lilac2, {}, 'felt', true);
    const topY = ROOF + 0.17 + 0.14 + 0.03;
    const cols = [PAL.pink, PAL.butter, PAL.mint, PAL.sky, PAL.lilac, PAL.peach];
    for (let i = 0; i < 4; i++) {          // wedge appliqué
      const th0 = (sg > 0 ? 0 : PI) + i * PI / 4;
      pb.add(new THREE.CylinderGeometry(HOLE + 0.1, HOLE + 0.1, 0.03, 22, 1, false, th0 + 0.02, PI / 4 - 0.04), cols[(i + (sg > 0 ? 0 : 3)) % cols.length], { y: topY + 0.012 }, 'felt', false);
    }
    pb.add(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 20, 1, false, sg > 0 ? 0 : PI, PI), PAL.coral, { y: topY + 0.05 }, 'cloth', false);
    pb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 20, 1, false, sg > 0 ? 0 : PI, PI), PAL.cream, { y: topY + 0.052 }, 'cloth', false);
    const pms = pb.flush(); const slab = pms.find((m) => m.name.endsWith('felt|1'));
    const ps = new Stitches();
    for (let i = 0; i <= 4; i++) { const a = (sg > 0 ? 0 : PI) + i * PI / 4; ps.poly([[Math.sin(a) * 0.5, topY + 0.03, Math.cos(a) * 0.5], [Math.sin(a) * (HOLE + 0.1), topY + 0.03, Math.cos(a) * (HOLE + 0.1)]], PAL.cream, { gap: 0.17, len: 0.085 }); }
    ps.arc(0, topY + 0.03, 0, HOLE + 0.15, sg > 0 ? -PI / 2 : PI / 2, sg > 0 ? PI / 2 : PI * 1.5, 'xz', PAL.cream, { gap: 0.17 }, 40);
    ps.flush(grp, M);
    const ug = new THREE.ShapeGeometry(sh, 44); ug.rotateX(PI / 2); ug.translate(0, ROOF + 0.135, 0);
    const um = new THREE.Mesh(ug, panelUnder); grp.add(um);
    grp.traverse((o) => { if (o.isMesh && o !== um) { o.castShadow = false; } });
    panels.push({ grp, sg, slab });
  }

  // ================================================================ FITTING CORNER (platform, podiums, mirror, booth, rack)
  B.fit.cyl(1.0, 1.03, 0.28, PAL.cream, { y: 0.14 }, 48, 'felt', true);
  B.fit.cyl(0.9, 0.9, 0.055, PAL.pink, { y: 0.3 }, 48, 'felt', true);
  B.fit.tor(0.98, 0.05, PAL.hot, { y: 0.27, rx: PI / 2 }, 8, 56, 'felt', false);
  B.fit.tor(0.9, 0.03, PAL.cream, { y: 0.33, rx: PI / 2 }, 6, 56, 'felt', false);
  ST.fit.ring(0, 0.34, 0, 0.78, 'xz', PAL.cream, { gap: 0.15, len: 0.08 });
  ST.fit.ring(0, 0.2, 0, 1.03, 'xz', PAL.coral, { gap: 0.2, len: 0.1 });
  for (const [px, col, base] of [[-1.6, PAL.lilac, PAL.peach], [1.6, PAL.mint, PAL.butter]]) {
    B.fit.cyl(0.62, 0.65, 0.17, base, { x: px, z: 0.05, y: 0.085 }, 40, 'felt', true);
    B.fit.cyl(0.55, 0.55, 0.04, col, { x: px, z: 0.05, y: 0.19 }, 40, 'felt', true);
    B.fit.tor(0.6, 0.035, PAL.hot, { x: px, z: 0.05, y: 0.17, rx: PI / 2 }, 6, 40, 'felt', false);
    ST.fit.ring(px, 0.215, 0.05, 0.46, 'xz', PAL.cream, { gap: 0.15, len: 0.08 });
  }
  const ringMat = M.glow(0xff8fc8, 1.1); const ringMesh = mesh(torG(1.2, 0.022, 6, 72), ringMat, G.fit, { y: 0.028, rx: PI / 2, recv: false });
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + 0.3; pinB(B.fit, { x: Math.cos(a) * 0.86, y: 0.325, z: Math.sin(a) * 0.86, rz: 0.5, ry: -a }, CANDY[i]); }

  // three-panel mirror (fake: pale glossy gradient + sparkles).  Frames are baked; the faces are three small meshes.
  const mirTex = mirrorTex();
  const mirMat = stitchify(new THREE.MeshStandardMaterial({ map: mirTex, roughness: 0.2, metalness: 0, emissive: 0xcfe0ff, emissiveMap: mirTex, emissiveIntensity: 0.32 }));
  const MIR = { z: -2.9, h: 2.5 };
  const mirrorPanel = (w, ry, cx, cz) => {
    const outer = archShape(w, MIR.h, w / 2, 0.08), inner = archShape(w - 0.24, MIR.h - 0.22, (w - 0.24) / 2, 0.05);
    const hole = new THREE.Path(inner.getPoints(20).map((p) => new THREE.Vector2(p.x, p.y + 0.11))); outer.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(outer, { depth: 0.09, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 18 });
    const face = new THREE.ShapeGeometry(inner, 18); face.translate(0, 0.11, 0);
    const pos = face.attributes.position, uv = face.attributes.uv, x0 = -(w - 0.24) / 2, hh = MIR.h - 0.22;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x0) / (w - 0.24), (pos.getY(i) - 0.11) / hh);
    const grp = new THREE.Group(); grp.position.set(cx, 0.08, cz); grp.rotation.y = ry; G.room.add(grp);
    const fb = new Batch(M, grp, 'mf'); fb.add(fg, PAL.butter, { z: -0.045 }, 'felt', false);
    fb.rbox(w * 0.85, 0.07, 0.34, 0.03, PAL.pink, { y: -0.04, z: -0.03 }, 'felt', false); fb.add(sphG(0.08, 10, 8), PAL.pink, { y: MIR.h + 0.04 }, 'felt', false); fb.flush();
    const fm = new THREE.Mesh(face, mirMat); fm.position.z = 0.058; grp.add(fm); return grp;
  };
  const wingA = 0.5, wingW = 1.15, midW = 1.5;
  mirrorPanel(midW, 0, 0, MIR.z);
  mirrorPanel(wingW, wingA, -(midW / 2) - wingW / 2 * Math.cos(wingA), MIR.z + wingW / 2 * Math.sin(wingA));
  mirrorPanel(wingW, -wingA, (midW / 2) + wingW / 2 * Math.cos(wingA), MIR.z + wingW / 2 * Math.sin(wingA));
  for (const sd of [-1, 1]) B.room.add(sphG(0.06, 8, 6), PAL.hot, { x: sd * midW / 2, y: 1.3, z: MIR.z + 0.09 }, 'felt', false);

  // ---- garment rack, north wall, east of the mirror: 9 tiny couture gowns
  const RK = { x0: 2.7, x1: 6.3, z: -4.15, y: 1.78 };
  B.room.add(cylG(0.03, 0.03, RK.x1 - RK.x0 + 0.2, 12), PAL.butter2, { x: (RK.x0 + RK.x1) / 2, y: RK.y, z: RK.z, rz: PI / 2 }, 'felt', true);
  for (const x of [RK.x0, RK.x1]) {
    B.room.cyl(0.035, 0.035, RK.y + 0.1, PAL.butter2, { x, y: (RK.y + 0.1) / 2, z: RK.z }, 10, 'felt', true);
    B.room.rbox(0.12, 0.07, 1.0, 0.03, PAL.pink, { x, y: 0.05, z: RK.z }, 'felt', true);
    B.room.add(sphG(0.065, 10, 8), PAL.hot, { x, y: RK.y + 0.15, z: RK.z }, 'felt', false);
    for (const dz of [-0.42, 0.42]) B.room.add(sphG(0.05, 8, 6), PAL.lilac2, { x, y: 0.05, z: RK.z + dz }, 'felt', false);
  }
  const gownB = (b, o, style, c1, c2, c3) => b.place(o, (bb) => {
    bb.add(torG(0.035, 0.006, 5, 12, PI * 1.5), PAL.butter2, { y: 1.815, ry: PI / 2 }, 'felt', false);
    for (const sd of [-1, 1]) bb.rbox(0.28, 0.018, 0.018, 0.007, PAL.butter2, { x: sd * 0.12, y: 1.71, rz: -sd * 0.38 }, 'felt', false);
    bb.add(latheG([[0.001, 1.66], [0.11, 1.645], [0.125, 1.56], [0.108, 1.44], [0.1, 1.38]], 20), c3, { sz: 0.66 }, 'cloth', true);
    bb.tor(0.11, 0.012, PAL.cream, { y: 1.64, rx: PI / 2, sy: 0.66 }, 5, 16, 'cloth', false);      // lace collar
    for (const sd of [-1, 1]) bb.add(sphG(0.052, 10, 7), c2, { x: sd * 0.135, y: 1.6, sy: 0.85, sz: 0.7 }, 'cloth', false);
    for (const y of [1.56, 1.48]) bb.add(sphG(0.012, 6, 5), PAL.cream, { y, z: 0.085 }, 'felt', false);
    if (style === 0) {
      bb.add(skirtG([[0.09, 1.42], [0.19, 1.3], [0.34, 1.0], [0.45, 0.68], [0.48, 0.6]], { seg: 30, amp: 0.05, n: 12 }), c1, { sx: 0.82, sz: 0.7 }, 'cloth', true);
      bb.add(skirtG([[0.1, 1.44], [0.2, 1.34], [0.31, 1.14], [0.37, 0.98]], { seg: 26, amp: 0.06, n: 9, phase: 1 }), c2, { sz: 0.7 }, 'cloth', false);
      bb.tor(0.1, 0.014, c2, { y: 1.42, rx: PI / 2, sy: 0.66 }, 5, 16, 'cloth', false); bowB(bb, { y: 1.42, z: 0.09, rz: 0 }, c2, 0.9);
    } else if (style === 1) {
      for (let k = 0; k < 3; k++) bb.add(skirtG([[0.08, 1.42 - k * 0.05], [0.3 + k * 0.03, 1.36 - k * 0.05], [0.48 + k * 0.03, 1.24 - k * 0.06]], { seg: 28, amp: 0.09, n: 14 + k * 2, phase: k }), [c1, c2, c3][k], { sz: 0.72 }, 'cloth', k === 0);
      bb.tor(0.1, 0.014, PAL.hot, { y: 1.42, rx: PI / 2, sy: 0.66 }, 5, 16, 'cloth', false);
    } else if (style === 2) {
      bb.add(skirtG([[0.09, 1.42], [0.14, 1.2], [0.15, 0.94], [0.19, 0.74], [0.33, 0.55]], { seg: 28, amp: 0.05, n: 8 }), c1, { sz: 0.66 }, 'cloth', true);
      bb.add(skirtG([[0.16, 0.9], [0.24, 0.72], [0.36, 0.5]], { seg: 24, amp: 0.08, n: 10, phase: 2 }), c2, { sz: 0.66, z: -0.02 }, 'cloth', false); bowB(bb, { y: 1.02, z: 0.1 }, c2, 1.2);
    } else {
      bb.add(skirtG([[0.1, 1.42], [0.25, 1.3], [0.37, 1.1]], { seg: 28, amp: 0.05, n: 10 }), c1, { sz: 0.7 }, 'cloth', true);
      bb.add(skirtG([[0.2, 1.2], [0.34, 1.11], [0.42, 1.02]], { seg: 28, amp: 0.05, n: 16 }), c3, { sz: 0.7 }, 'cloth', false);
      bowB(bb, { y: 1.5, z: 0.09 }, c2, 1.3);
    }
  });
  const gown = [[0, PAL.pink, PAL.pink2, PAL.hot], [1, PAL.mint, PAL.butter, PAL.sky], [2, PAL.lilac, PAL.lilac2, PAL.pink], [3, PAL.butter, PAL.peach, PAL.cream], [1, PAL.sky, PAL.lilac2, PAL.mint], [0, PAL.peach, PAL.coral, PAL.butter], [2, PAL.mint, PAL.pink2, PAL.cream], [3, PAL.lilac2, PAL.pink, PAL.butter], [0, PAL.butter2, PAL.mint, PAL.pink2]];
  gown.forEach(([st, a, b2, c], i) => gownB(B.room, { x: RK.x0 + 0.3 + i * 0.4, z: RK.z + (i % 2 ? 0.08 : -0.06), ry: (R() - 0.5) * 0.4, y: 0 }, st, a, b2, c));
  // patterns pinned above the rack
  for (const [x, y, w, h, rz] of [[3.6, 3.25, 0.62, 0.86, 0.05], [4.75, 3.05, 0.5, 0.7, -0.06], [5.85, 3.3, 0.58, 0.82, 0.04]]) {
    B.room.rbox(w, h, 0.012, 0.005, PAL.cream, { x, y, z: -4.94, rz }, 'felt', false);
    ST.room.poly([[x - w * 0.3, y + h * 0.35, -4.925], [x + w * 0.1, y + h * 0.42, -4.925], [x + w * 0.3, y - h * 0.1, -4.925], [x + w * 0.15, y - h * 0.4, -4.925], [x - w * 0.25, y - h * 0.36, -4.925], [x - w * 0.3, y + h * 0.35, -4.925]], PAL.hot, { gap: 0.1, len: 0.05, w: 0.008 });
    pinB(B.room, { x: x - w * 0.36, y: y + h * 0.4, z: -4.93, rx: PI / 2 }, PAL.hot); pinB(B.room, { x: x + w * 0.36, y: y + h * 0.4, z: -4.93, rx: PI / 2 }, PAL.sky);
  }
  // big appliqué flowers on the north wall (west of the mirror)
  for (const [x, y, s, c1, c2] of [[-3.3, 3.1, 1.6, PAL.pink, PAL.butter2], [-2.5, 4.1, 1.0, PAL.peach, PAL.pink2]]) {
    B.room.add(cylG(0.02, 0.02, y - 0.6, 6), PAL.mint, { x, y: (y - 0.6) / 2 + 0.6, z: -4.95 }, 'felt', false);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.room.add(sphG(0.2 * s, 10, 8), c1, { x: x + Math.cos(a) * 0.26 * s, y: y + Math.sin(a) * 0.26 * s, z: -4.93, sz: 0.28 }, 'felt', false); }
    B.room.add(sphG(0.17 * s, 12, 8), c2, { x, y, z: -4.9, sz: 0.4 }, 'felt', false);
    ST.room.ring(x, y, -4.9, 0.2 * s, 'xy', PAL.cream, { gap: 0.09, len: 0.045, w: 0.01 });
    B.room.add(sphG(0.24 * s, 10, 8), PAL.mint, { x: x + 0.55 * s, y: y - 0.75 * s, z: -4.96, sx: 1.6, sy: 0.6, sz: 0.4, rz: 0.5 }, 'felt', false);
  }

  // ---- curtained booth in the NW corner
  const curtains = [];
  const curtainG = (w, h, tieY, seed) => {
    const g = new THREE.PlaneGeometry(w, h, 30, 22); g.translate(0, -h / 2, 0); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), yh = y + h;
      const gather = 1 - 0.6 * Math.exp(-Math.pow((yh - tieY) / 0.34, 2)), flare = yh < tieY ? 1 + 0.25 * (tieY - yh) / tieY : 1;
      const xn = x * gather * flare;
      p.setXYZ(i, xn, y, Math.sin(xn / w * TAU * 4 + seed) * (0.04 + 0.06 * (1 - yh / h)) * (yh < tieY ? 1.4 : 1));
    }
    g.computeVertexNormals(); return g;
  };
  const addCurtain = (parent, x, y, z, ry, w, h, tieY, col, seed) => {
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.order = 'YXZ'; grp.rotation.y = ry; parent.add(grp);
    const m = mesh(curtainG(w, h, tieY, seed), M.cloth(col, { rep: 4 }), grp, { cast: false }); curtains.push({ grp, seed, base: ry });
    return m;
  };
  B.room.rbox(2.6, 0.12, 2.0, 0.05, PAL.lilac, { x: -5.7, y: 0.06, z: -3.95 }, 'felt', false);      // booth floor pad
  B.room.rbox(0.14, 2.9, 2.15, 0.05, PAL.lilac2, { x: -4.55, y: 1.5, z: -3.95 }, 'felt', true);     // partition
  ST.room.poly([[-4.46, 0.35, -4.85], [-4.46, 2.55, -4.85], [-4.46, 2.55, -3.05], [-4.46, 0.35, -3.05], [-4.46, 0.35, -4.85]], PAL.cream, { gap: 0.14, len: 0.07 });
  B.room.rbox(1.2, 0.38, 0.62, 0.15, PAL.hot, { x: -6.35, y: 0.34, z: -4.3 }, 'felt', true);       // bench
  B.room.rbox(1.2, 0.32, 0.18, 0.08, PAL.pink, { x: -6.35, y: 0.72, z: -4.68 }, 'felt', true);
  B.room.add(cylG(0.012, 0.012, 1.2, 6), PAL.cream, { x: -5.7, y: 4.6, z: -3.9 }, 'felt', false);
  B.room.add(sphG(0.09, 10, 8), 0xffffff, { x: -5.7, y: 3.85, z: -3.9 }, 'felt', false);
  B.room.add(cylG(0.03, 0.03, 2.45, 8), PAL.butter2, { x: -5.75, y: 2.95, z: -2.85, rz: PI / 2 }, 'felt', false);
  for (const x of [-6.95, -4.55]) B.room.add(sphG(0.06, 8, 6), PAL.hot, { x, y: 2.95, z: -2.85 }, 'felt', false);
  addCurtain(G.room, -6.55, 2.95, -2.85, 0, 1.25, 2.85, 1.2, PAL.pink, 0.3);
  addCurtain(G.room, -4.9, 2.95, -2.85, 0, 1.25, 2.85, 1.2, PAL.pink, 1.9);
  for (const x of [-6.95, -4.55]) { B.room.tor(0.1, 0.014, PAL.hot, { x: x + (x < -5 ? 0.02 : -0.02), y: 1.15, z: -2.82, ry: PI / 2 }, 5, 16, 'felt', false); bowB(B.room, { x: x + (x < -5 ? 0.04 : -0.04), y: 1.15, z: -2.7 }, PAL.hot, 1.4); }
  // ---- sewing table (SE) and a stool: the machine itself is built elsewhere
  const SW = { x: 4.7, z: 2.75 };
  B.room.rbox(1.5, 0.08, 0.75, 0.035, PAL.peach2, { x: SW.x, y: 0.8, z: SW.z }, 'felt', true);
  for (const [dx, dz] of [[-0.62, -0.28], [0.62, -0.28], [-0.62, 0.28], [0.62, 0.28]]) B.room.cyl(0.05, 0.035, 0.78, PAL.butter, { x: SW.x + dx, y: 0.39, z: SW.z + dz }, 10, 'felt', true);
  B.room.rbox(1.3, 0.08, 0.6, 0.03, PAL.butter, { x: SW.x, y: 0.28, z: SW.z }, 'felt', false);
  spoolB(B.room, { x: SW.x - 0.5, y: 0.84, z: SW.z + 0.2 }, PAL.hot); spoolB(B.room, { x: SW.x - 0.4, y: 0.84, z: SW.z + 0.28 }, PAL.mint, 0.05, 0.11); spoolB(B.room, { x: SW.x - 0.55, y: 0.84, z: SW.z - 0.2 }, PAL.sky);
  B.room.cyl(0.24, 0.26, 0.05, PAL.pink, { x: SW.x + 0.75, y: 0.05, z: SW.z - 1.0 }, 20, 'felt', false);
  B.room.cyl(0.27, 0.27, 0.07, PAL.lilac, { x: SW.x - 0.1, y: 0.42, z: SW.z + 0.85 }, 20, 'felt', true);
  for (const a of [0.5, 2.6, 4.7]) B.room.cyl(0.02, 0.026, 0.4, PAL.butter, { x: SW.x - 0.1 + Math.cos(a) * 0.18, y: 0.2, z: SW.z + 0.85 + Math.sin(a) * 0.18 }, 6, 'felt', false);

  // ================================================================ WORK CORNER (west wall)
  const CT = { x: -5.75, z0: -2.1, z1: 1.5, top: 0.96 };
  const ctz = (CT.z0 + CT.z1) / 2, ctl = CT.z1 - CT.z0;
  B.room.rbox(1.05, 0.09, ctl, 0.04, 0xf0c58e, { x: CT.x, y: CT.top - 0.045, z: ctz }, 'felt', true);
  for (const [dx, dz] of [[-0.42, -0.1], [0.42, -0.1], [-0.42, 0.1], [0.42, 0.1]]) {
    const zz = dz < 0 ? CT.z0 + 0.14 : CT.z1 - 0.14;
    B.room.cyl(0.07, 0.05, 0.88, PAL.butter, { x: CT.x + dx, y: 0.44, z: zz }, 12, 'felt', true);
    B.room.tor(0.07, 0.02, PAL.coral, { x: CT.x + dx, y: 0.3, z: zz, rx: PI / 2 }, 5, 14, 'felt', false);
  }
  B.room.rbox(0.9, 0.06, ctl - 0.3, 0.025, PAL.butter, { x: CT.x, y: 0.26, z: ctz }, 'felt', false);
  const bolts = [PAL.pink, PAL.lilac, PAL.mint, PAL.sky, PAL.butter];
  bolts.forEach((c, i) => { B.room.cyl(0.09, 0.09, 0.78, c, { x: CT.x + (i % 2 ? 0.05 : -0.06), y: 0.35, z: CT.z0 + 0.35 + i * 0.5, rz: PI / 2 }, 14, 'cloth', false); B.room.cyl(0.04, 0.04, 0.8, PAL.cream, { x: CT.x + (i % 2 ? 0.05 : -0.06), y: 0.35, z: CT.z0 + 0.35 + i * 0.5, rz: PI / 2 }, 8, 'felt', false); });
  const matMesh = mesh(new THREE.PlaneGeometry(0.92, 2.6), texMat(matTex(), { bumpRep: 4, bump: 0.5 }), G.room, { x: CT.x, y: CT.top + 0.004, z: -0.7, rx: -PI / 2, recv: true });
  matMesh.rotation.z = 0;
  const TY = CT.top + 0.008;
  // tape measure: ribbon across the mat, and its wound roll
  const tapeCurve = new THREE.CatmullRomCurve3([V3(CT.x + 0.32, TY + 0.006, -1.95), V3(CT.x + 0.2, TY + 0.006, -1.6), V3(CT.x - 0.05, TY + 0.006, -1.42), V3(CT.x - 0.2, TY + 0.006, -1.05), V3(CT.x + 0.05, TY + 0.006, -0.72), V3(CT.x + 0.25, TY + 0.006, -0.85), V3(CT.x + 0.2, TY + 0.006, -1.1)]);
  {
    const N = 90, pos = [], uvs = [], idx = [];
    for (let i = 0; i <= N; i++) { const t = i / N, p = tapeCurve.getPoint(t), tg = tapeCurve.getTangent(t), sd = new THREE.Vector3(-tg.z, 0, tg.x).normalize().multiplyScalar(0.032); pos.push(p.x + sd.x, p.y + 0.002 * Math.sin(t * 30), p.z + sd.z, p.x - sd.x, p.y + 0.002 * Math.sin(t * 30), p.z - sd.z); uvs.push(t * 1.4, 0, t * 1.4, 1); if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const tg2 = new THREE.BufferGeometry(); tg2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg2.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); tg2.setIndex(idx); tg2.computeVertexNormals();
    const tt = tapeTex(); tt.wrapS = THREE.RepeatWrapping;
    mesh(tg2, stitchify(new THREE.MeshStandardMaterial({ map: tt, roughness: 0.95, side: THREE.DoubleSide })), G.room, { cast: false });
  }
  B.room.cyl(0.085, 0.085, 0.045, 0xffd83a, { x: CT.x + 0.32, y: TY + 0.025, z: -2.0 }, 20, 'felt', false);
  B.room.cyl(0.03, 0.03, 0.05, PAL.hot, { x: CT.x + 0.32, y: TY + 0.026, z: -2.0 }, 12, 'felt', false);
  // scissors (oversized, pink handles): two halves crossed at a pivot, snip on the beat
  const scis = new THREE.Group(); scis.position.set(CT.x - 0.15, TY + 0.02, -1.5); scis.rotation.y = 0.55; G.room.add(scis);
  const scisHalf = [1, -1].map((sd) => {
    const g = new THREE.Group(); scis.add(g); const bb = new Batch(M, g, 'sc');
    bb.rbox(0.032, 0.012, 0.36, 0.005, 0xe8eef5, { z: 0.2 }, 'felt', false); bb.rbox(0.028, 0.02, 0.16, 0.008, PAL.hot, { z: -0.02 }, 'felt', false);
    bb.tor(0.06, 0.017, PAL.hot, { z: -0.14, rx: PI / 2, sy: 0.75 }, 6, 18, 'felt', false); bb.flush(); g.userData.sd = sd; return g;
  });
  B.room.add(sphG(0.02, 8, 6), 0xaab4c2, { x: CT.x - 0.15, y: TY + 0.035, z: -1.5 }, 'felt', false);
  // half-cut tulle: three wavy sheets, a chalk line and scalloped cut edge, plus the bolt it comes from
  const tulle = (w, d, col, y, x, z, ry, ph) => {
    const g = new THREE.PlaneGeometry(w, d, 24, 24); g.rotateX(-PI / 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const px = p.getX(i), pz = p.getZ(i); p.setY(i, 0.03 * Math.sin(px * 9 + ph) * Math.cos(pz * 7 + ph * 0.6) + 0.02 * Math.sin(pz * 13 + ph) + Math.max(0, 0.04 * (pz / d + 0.5))); }
    g.computeVertexNormals(); B.room.add(g, col, { x, y, z, ry }, 'cloth', false);
  };
  tulle(0.7, 0.85, PAL.pink2, TY + 0.02, CT.x - 0.1, -0.05, 0.1, 0); tulle(0.68, 0.8, PAL.lilac, TY + 0.05, CT.x - 0.08, -0.02, -0.06, 2); tulle(0.62, 0.72, PAL.sky, TY + 0.08, CT.x - 0.05, 0.0, 0.12, 4);
  ST.room.poly([[CT.x - 0.4, TY + 0.14, 0.32], [CT.x - 0.02, TY + 0.14, 0.3], [CT.x + 0.3, TY + 0.14, 0.34]], PAL.hot, { gap: 0.06, len: 0.03, w: 0.008 });
  B.room.cyl(0.11, 0.11, 0.82, PAL.lilac2, { x: CT.x + 0.02, y: TY + 0.12, z: 0.85, rz: PI / 2, ry: 0 }, 16, 'cloth', false);
  B.room.cyl(0.05, 0.05, 0.86, PAL.cream, { x: CT.x + 0.02, y: TY + 0.12, z: 0.85, rz: PI / 2 }, 8, 'felt', false);
  tulle(0.5, 0.42, PAL.lilac2, TY + 0.03, CT.x + 0.03, 0.55, 0.2, 1);
  const unrollG = new THREE.PlaneGeometry(0.58, 1.6, 22, 48); unrollG.rotateX(-PI / 2); unrollG.translate(0, 0, -0.8);
  { const p = unrollG.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), d = -p.getZ(i); p.setY(i, 0.012 + 0.2 * Math.exp(-d / 0.16) + 0.02 * Math.sin(x * 11 + d * 4) * Math.min(1, d * 3) + 0.012 * Math.sin(d * 17)); } unrollG.computeVertexNormals(); }
  const unrollM = new THREE.Mesh(unrollG, M.cloth(PAL.pink2, { rep: 4 })); unrollM.position.set(CT.x + 0.02, TY + 0.12, 0.85); unrollM.receiveShadow = true; G.room.add(unrollM);
  const unrollEdge = new THREE.Mesh(cylG(0.028, 0.028, 0.58, 10), M.cloth(PAL.pink, { rep: 4 })); unrollEdge.rotation.z = PI / 2; unrollEdge.position.set(CT.x + 0.02, TY + 0.12 + 0.02, 0.85); G.room.add(unrollEdge);
  // pin cushion, chalk, buttons, spools, lace roll, paper pattern
  B.room.place({ x: CT.x + 0.32, y: TY + 0.03, z: 1.05 }, (bb) => {
    bb.add(sphG(0.09, 16, 10), 0xff4b5c, { sy: 0.7 }, 'cloth', false); bb.tor(0.085, 0.012, PAL.butter2, { rx: PI / 2, y: -0.005 }, 5, 20, 'felt', false);
    for (let i = 0; i < 13; i++) { const a = i * 0.97, r = 0.03 + (i % 3) * 0.018, tl = 0.3 + (i % 4) * 0.12; pinB(bb, { x: Math.cos(a) * r, y: 0.055, z: Math.sin(a) * r, rz: -Math.cos(a) * tl, rx: Math.sin(a) * tl }, CANDY[i % CANDY.length]); }
  });
  for (const [dz, c, ry] of [[-1.05, PAL.pink, 0.4], [-1.12, 0xffffff, -0.3], [-0.97, PAL.lilac, 1.1]]) B.room.rbox(0.09, 0.02, 0.03, 0.008, c, { x: CT.x + 0.38, y: TY + 0.012, z: dz - 0.0, ry }, 'felt', false);
  for (let i = 0; i < 11; i++) { const c = CANDY[i % CANDY.length]; B.room.add(sphG(0.024, 8, 6), c, { x: CT.x + 0.1 + (i % 4) * 0.055, y: TY + 0.008, z: 1.25 + Math.floor(i / 4) * 0.055, sy: 0.35 }, 'felt', false); }
  [[CT.x - 0.32, -0.9, PAL.hot, 0.06, 0.13], [CT.x - 0.28, -0.75, PAL.mint, 0.05, 0.11], [CT.x + 0.35, -0.4, PAL.butter2, 0.06, 0.13], [CT.x - 0.36, 1.2, PAL.sky, 0.055, 0.12], [CT.x - 0.22, 1.3, PAL.pink, 0.05, 0.11]].forEach(([x, z, c, r, h], i) => spoolB(B.room, { x, y: TY, z, rx: i === 2 ? PI / 2 : 0, ry: i }, c, r, h));
  B.room.tor(0.07, 0.03, PAL.cream, { x: CT.x + 0.35, y: TY + 0.03, z: 0.2, rx: PI / 2 }, 6, 20, 'cloth', false); B.room.tor(0.07, 0.03, PAL.cream, { x: CT.x + 0.35, y: TY + 0.08, z: 0.2, rx: PI / 2 }, 6, 20, 'cloth', false);
  B.room.rbox(0.42, 0.006, 0.55, 0.003, PAL.cream, { x: CT.x + 0.15, y: TY + 0.004, z: -1.75, ry: 0.15 }, 'felt', false);
  ST.room.poly([[CT.x + 0.0, TY + 0.012, -1.98], [CT.x + 0.25, TY + 0.012, -1.98], [CT.x + 0.3, TY + 0.012, -1.7], [CT.x + 0.1, TY + 0.012, -1.55], [CT.x - 0.05, TY + 0.012, -1.7], [CT.x + 0.0, TY + 0.012, -1.98]], PAL.hot, { gap: 0.07, len: 0.035, w: 0.007 });

  // ---- window (round, painted outside, stitched curtains)
  const WIN = { x: -6.98, y: 2.85, z: -0.3, r: 1.05 };
  const winMat = stitchify(new THREE.MeshBasicMaterial({ map: windowTex(), toneMapped: false }));
  const winMesh = mesh(new THREE.CircleGeometry(WIN.r, 48), winMat, G.room, { x: WIN.x, y: WIN.y, z: WIN.z, ry: PI / 2, recv: false });
  B.room.tor(WIN.r + 0.05, 0.11, PAL.butter, { x: WIN.x + 0.05, y: WIN.y, z: WIN.z, ry: PI / 2 }, 8, 56, 'felt', false);
  B.room.tor(WIN.r - 0.07, 0.03, PAL.cream, { x: WIN.x + 0.07, y: WIN.y, z: WIN.z, ry: PI / 2 }, 6, 48, 'felt', false);
  B.room.rbox(0.06, 2 * WIN.r, 0.06, 0.02, PAL.cream, { x: WIN.x + 0.06, y: WIN.y, z: WIN.z }, 'felt', false); B.room.rbox(0.06, 0.06, 2 * WIN.r, 0.02, PAL.cream, { x: WIN.x + 0.06, y: WIN.y, z: WIN.z }, 'felt', false);
  ST.room.ring(WIN.x + 0.16, WIN.y, WIN.z, WIN.r + 0.16, 'zy', PAL.coral, { gap: 0.2, len: 0.1 });
  B.room.add(cylG(0.025, 0.025, 3.4, 8), PAL.butter2, { x: WIN.x + 0.18, y: 4.35, z: WIN.z, rx: PI / 2 }, 'felt', false);
  for (const dz of [-1.7, 1.7]) B.room.add(sphG(0.06, 8, 6), PAL.hot, { x: WIN.x + 0.18, y: 4.35, z: WIN.z + dz }, 'felt', false);
  addCurtain(G.room, WIN.x + 0.24, 4.32, WIN.z - 1.15, PI / 2, 1.1, 2.95, 1.7, PAL.lilac, 0.7);
  addCurtain(G.room, WIN.x + 0.24, 4.32, WIN.z + 1.15, PI / 2, 1.1, 2.95, 1.7, PAL.lilac, 2.4);
  for (const dz of [-1.68, 1.68]) bowB(B.room, { x: WIN.x + 0.36, y: 2.62, z: WIN.z + dz * 0.83, ry: PI / 2 }, PAL.hot, 1.4);
  // spool shelves flanking the window
  const shelfUnits = [{ z0: -2.65, z1: -1.5 }, { z0: 0.9, z1: 2.9 }];
  for (const S of shelfUnits) {
    const len = S.z1 - S.z0, zc = (S.z0 + S.z1) / 2;
    for (let tier = 0; tier < 4; tier++) {
      const y = 1.55 + tier * 0.68;
      B.room.rbox(0.38, 0.06, len, 0.025, PAL.peach2, { x: -6.79, y, z: zc }, 'felt', false);
      for (const z of [S.z0 + 0.1, S.z1 - 0.1]) B.room.rbox(0.05, 0.2, 0.05, 0.02, PAL.butter, { x: -6.94, y: y - 0.12, z }, 'felt', false);
      const n = Math.floor(len / 0.19);
      for (let i = 0; i < n; i++) {
        const z = S.z0 + 0.13 + i * ((len - 0.26) / Math.max(1, n - 1)), c = CANDY[Math.floor(R() * CANDY.length)];
        if (R() < 0.3) B.room.add(latheG([[0.035, 0], [0.11, 0], [0.11, 0.06], [0.035, 0.06]], 14), c, { x: -6.66, y: y + 0.11, z, rz: -PI / 2, rx: 0 }, 'cloth', false);
        else spoolB(B.room, { x: -6.79 + (R() - 0.5) * 0.05, y: y + 0.03, z }, c, 0.06, 0.13 + R() * 0.02);
      }
    }
  }
  // hat stand
  const HS = { x: -6.15, z: 3.4 };
  B.room.cyl(0.03, 0.03, 1.85, PAL.butter2, { x: HS.x, y: 0.93, z: HS.z }, 8, 'felt', true);
  for (let i = 0; i < 3; i++) B.room.add(sphG(0.06, 8, 6), PAL.hot, { x: HS.x + Math.cos(i * 2.1) * 0.0, y: 1.86, z: HS.z }, 'felt', false);
  for (let i = 0; i < 3; i++) B.room.rbox(0.05, 0.05, 0.05, 0.02, PAL.butter2, { x: HS.x + Math.cos(i * 2.09 + 0.6) * 0.32, y: 0.1, z: HS.z + Math.sin(i * 2.09 + 0.6) * 0.32 }, 'felt', false);
  B.room.cyl(0.05, 0.08, 0.06, PAL.pink, { x: HS.x, y: 0.03, z: HS.z }, 12, 'felt', false);
  for (const [dy, kind] of [[1.62, 0], [1.28, 1], [0.94, 2]]) {
    const a = kind * 2.1 + 0.4, hx = HS.x + Math.cos(a) * 0.16, hz = HS.z + Math.sin(a) * 0.16;
    B.room.rbox(0.03, 0.03, 0.2, 0.012, PAL.butter2, { x: HS.x + Math.cos(a) * 0.09, y: dy, z: HS.z + Math.sin(a) * 0.09, ry: PI / 2 - a }, 'felt', false);
    if (kind === 0) { B.room.cyl(0.13, 0.15, 0.13, PAL.pink, { x: hx, y: dy + 0.1, z: hz }, 18, 'cloth', true); B.room.cyl(0.14, 0.14, 0.02, PAL.hot, { x: hx, y: dy + 0.045, z: hz }, 18, 'felt', false); flowerB(B.room, { x: hx + 0.1, y: dy + 0.13, z: hz + 0.05, ry: -0.6 }, PAL.butter2, PAL.hot, 1.4); }
    if (kind === 1) { B.room.add(new THREE.ConeGeometry(0.13, 0.32, 16), PAL.lilac, { x: hx, y: dy + 0.2, z: hz }, 'cloth', true); B.room.tor(0.1, 0.014, PAL.cream, { x: hx, y: dy + 0.13, z: hz, rx: PI / 2 }, 5, 16, 'felt', false); B.room.add(sphG(0.04, 8, 6), PAL.hot, { x: hx, y: dy + 0.37, z: hz }, 'felt', false); }
    if (kind === 2) { B.room.cyl(0.3, 0.3, 0.02, PAL.butter, { x: hx, y: dy + 0.04, z: hz, rz: 0.08 }, 22, 'cloth', true); B.room.cyl(0.13, 0.15, 0.13, PAL.butter, { x: hx, y: dy + 0.1, z: hz }, 18, 'cloth', false); B.room.tor(0.135, 0.02, PAL.hot, { x: hx, y: dy + 0.07, z: hz, rx: PI / 2 }, 5, 18, 'cloth', false); bowB(B.room, { x: hx + 0.13, y: dy + 0.08, z: hz, ry: PI / 2 }, PAL.hot, 1.2); }
  }
  // dress forms wearing half-pinned gowns
  const formB = (b, o, style, c1, c2, c3) => b.place(o, (bb) => {
    bb.add(cylG(0.014, 0.014, 0.9, 8), PAL.butter2, { y: 0.5 }, 'felt', true);
    for (let i = 0; i < 3; i++) bb.rbox(0.05, 0.05, 0.4, 0.02, PAL.butter2, { y: 0.03, ry: i * 2.09, z: 0 }, 'felt', false);
    bb.add(latheG([[0.001, 0.86], [0.14, 0.9], [0.18, 1.05], [0.2, 1.18], [0.165, 1.32], [0.17, 1.5], [0.15, 1.6], [0.08, 1.68], [0.001, 1.7]], 24), 0xf3e6d8, { sz: 0.78 }, 'cloth', true);
    bb.add(cylG(0.03, 0.03, 0.12, 8), PAL.butter2, { y: 1.72 }, 'felt', false); bb.add(sphG(0.05, 10, 8), PAL.hot, { y: 1.8 }, 'felt', false);
    bb.add(latheG([[0.001, 1.66], [0.12, 1.62], [0.185, 1.48], [0.175, 1.3], [0.16, 1.2]], 24, 0.3, 5.2), c3, { sz: 0.8 }, 'cloth', true);      // bodice (open at the back-left)
    bb.tor(0.12, 0.014, PAL.cream, { y: 1.62, rx: PI / 2, sy: 0.8 }, 5, 20, 'cloth', false);
    if (style === 0) {
      bb.add(skirtG([[0.16, 1.22], [0.3, 1.06], [0.5, 0.78], [0.62, 0.5], [0.66, 0.44]], { seg: 36, amp: 0.05, n: 12, a0: 0.9, aLen: 5.0 }), c1, {}, 'cloth', true);
      bb.add(skirtG([[0.15, 1.18], [0.24, 1.05], [0.36, 0.82], [0.42, 0.66]], { seg: 30, amp: 0.05, n: 9, a0: 0.9, aLen: 3.6 }), c2, {}, 'cloth', false);
    } else {
      for (let k = 0; k < 3; k++) bb.add(skirtG([[0.14, 1.22 - k * 0.05], [0.34 + k * 0.03, 1.16 - k * 0.05], [0.56 + k * 0.03, 1.04 - k * 0.07]], { seg: 30, amp: 0.09, n: 14 + k, a0: 0.9 + k * 0.2, aLen: 5.0 - k * 0.9 }), [c1, c2, c3][k], {}, 'cloth', k === 0);
    }
    bb.tor(0.166, 0.016, PAL.hot, { y: 1.25, rx: PI / 2, sy: 0.8 }, 5, 20, 'cloth', false);
    for (let i = 0; i < 6; i++) { const a = 0.9 - i * 0.16; pinB(bb, { x: Math.sin(a) * (0.5 - i * 0.05), y: 0.9 + i * 0.03, z: Math.cos(a) * (0.5 - i * 0.05), rz: 0.5, ry: a }, CANDY[i]); }
    bb.add(tubeG([[-0.18, 1.6, 0.08], [-0.22, 1.5, 0.15], [0.0, 1.46, 0.2], [0.22, 1.5, 0.15], [0.18, 1.6, 0.08]], 0.012, 24, 4), 0xffd83a, {}, 'felt', false);
  });
  formB(B.room, { x: -3.45, z: -3.55, ry: 0.35 }, 0, PAL.pink, PAL.pink2, PAL.hot);
  formB(B.room, { x: -2.4, z: -4.1, ry: -0.2 }, 1, PAL.mint, PAL.butter, PAL.sky);


  // ---- more on the cutting table: ruler, swatch stack, thimbles, button jar, scrap ribbons, a needle and its thread
  B.room.rbox(0.07, 0.01, 0.62, 0.004, PAL.cream, { x: CT.x - 0.36, y: TY + 0.006, z: -0.55, ry: 0.05 }, 'felt', false);
  ST.room.poly([[CT.x - 0.335, TY + 0.014, -0.84], [CT.x - 0.345, TY + 0.014, -0.28]], PAL.hot, { gap: 0.03, len: 0.012, w: 0.005 });
  for (let i = 0; i < 6; i++) B.room.rbox(0.2 - i * 0.008, 0.012, 0.2 - i * 0.008, 0.004, CANDY[(i * 3 + 2) % CANDY.length], { x: CT.x + 0.3, y: TY + 0.008 + i * 0.013, z: -0.2, ry: i * 0.31 }, 'cloth', false);
  for (let i = 0; i < 3; i++) { B.room.add(latheG([[0.001, 0.05], [0.02, 0.05], [0.028, 0.03], [0.032, 0.0]], 10), i === 1 ? PAL.sky : PAL.hot, { x: CT.x - 0.08 + i * 0.06, y: TY, z: 0.75 + (i % 2) * 0.05, s: 1.2 }, 'cloth', false); }
  B.room.add(latheG([[0.001, 0], [0.06, 0], [0.07, 0.12], [0.055, 0.15], [0.055, 0.17], [0.06, 0.17], [0.06, 0.15]], 14), 0xe8fbff, { x: CT.x + 0.28, y: TY, z: 1.28 }, 'cloth', false);
  for (let i = 0; i < 12; i++) B.room.add(sphG(0.02, 6, 5), CANDY[i % CANDY.length], { x: CT.x + 0.28 + Math.cos(i * 2.4) * 0.03, y: TY + 0.03 + i * 0.008, z: 1.28 + Math.sin(i * 2.4) * 0.03, sy: 0.5 }, 'felt', false);
  [[[CT.x - 0.1, TY + 0.004, -1.9], [CT.x - 0.3, TY + 0.004, -1.75], [CT.x - 0.28, TY + 0.004, -1.45]], [[CT.x + 0.38, TY + 0.004, 0.1], [CT.x + 0.2, TY + 0.004, 0.35], [CT.x + 0.32, TY + 0.004, 0.55]]].forEach((pts, i) => {
    const cv3 = new THREE.CatmullRomCurve3(pts.map((q) => V3(...q))); B.room.add(ribbonG(cv3, 0.022, 24), [PAL.hot, PAL.butter2][i], {}, 'cloth', false);
  });
  B.room.add(tubeG([[CT.x - 0.33, TY + 0.006, -1.05], [CT.x - 0.4, TY + 0.02, -0.95], [CT.x - 0.44, TY + 0.006, -0.7], [CT.x - 0.3, TY + 0.005, -0.5]], 0.004, 16, 4), PAL.hot, {}, 'felt', false);
  B.room.add(cylG(0.003, 0.003, 0.11, 4), 0xdfe6ee, { x: CT.x - 0.33, y: TY + 0.008, z: -1.08, rz: PI / 2, ry: 0.4 }, 'felt', false);
  for (let i = 0; i < 9; i++) B.room.add(new THREE.TetrahedronGeometry(0.03, 0), CANDY[(i * 2) % CANDY.length], { x: CT.x + (R() - 0.5) * 0.7, y: TY + 0.01, z: -1.3 + R() * 2.2, ry: R() * 6, sy: 0.3 }, 'cloth', false);
  // spool towers by the east wall
  const tower = (x, z, n, r, cols) => { for (let i = 0; i < n; i++) spoolB(B.room, { x: x + (i % 2 ? 0.02 : -0.015), y: i * r * 2.4, z, ry: i * 0.8 }, cols[i % cols.length], r, r * 2.4, PAL.cream, true); B.room.add(tubeG([[x + r, n * r * 2.4 - 0.4, z], [x + r * 1.6, 0.6, z + r * 1.2], [x + r * 3.5, 0.02, z + r * 2.4], [x + r * 5, 0.02, z + r * 3.2]], 0.014, 20, 4), cols[0], {}, 'cloth', false); };
  tower(6.15, -1.7, 6, 0.22, [PAL.pink, PAL.mint, PAL.lilac, PAL.butter, PAL.sky, PAL.peach]);
  tower(5.5, -2.55, 4, 0.2, [PAL.butter2, PAL.hot, PAL.lilac2, PAL.mint]);
  tower(6.3, 0.15, 3, 0.18, [PAL.sky, PAL.pink2, PAL.butter]);
  B.room.cyl(0.36, 0.36, 0.34, PAL.hot, { x: 5.9, y: 0.17, z: -0.75, ry: 0 }, 20, 'cloth', true);
  // tiny stage of gift boxes (SE corner)
  [[6.05, 3.95, 0.72, 0.42, 0.7, PAL.pink, PAL.mint, 0.3], [6.2, 3.05, 0.55, 0.36, 0.55, PAL.lilac, PAL.butter2, -0.2], [5.15, 4.15, 0.5, 0.3, 0.5, PAL.sky, PAL.hot, 0.5], [6.0, 3.95, 0.46, 0.32, 0.46, PAL.butter, PAL.coral, 0.9]].forEach(([x, z, w, h, d, c, rb, ry], i) => {
    const y0 = i === 3 ? 0.42 : 0;
    B.room.rbox(w, h, d, 0.05, c, { x, y: y0 + h / 2, z, ry }, 'cloth', true); B.room.rbox(w + 0.05, 0.07, d + 0.05, 0.03, c, { x, y: y0 + h + 0.03, z, ry }, 'cloth', false);
    B.room.rbox(0.07, h + 0.08, d + 0.03, 0.02, rb, { x, y: y0 + h / 2 + 0.02, z, ry }, 'cloth', false); B.room.rbox(w + 0.03, h + 0.08, 0.07, 0.02, rb, { x, y: y0 + h / 2 + 0.02, z, ry }, 'cloth', false);
    bowB(B.room, { x, y: y0 + h + 0.1, z, ry }, rb, 1.5);
  });
  // a big round rug under the platform and the tea table
  B.room.cyl(2.7, 2.7, 0.016, PAL.lilac2, { y: 0.008 }, 64, 'felt', false); B.room.cyl(2.35, 2.35, 0.02, PAL.pink2, { y: 0.01 }, 64, 'felt', false); B.room.cyl(1.55, 1.55, 0.024, PAL.cream, { y: 0.012 }, 56, 'felt', false);
  B.room.tor(2.68, 0.025, PAL.hot, { y: 0.02, rx: PI / 2 }, 5, 72, 'felt', false);
  ST.room.ring(0, 0.03, 0, 2.5, 'xz', PAL.cream, { gap: 0.18, len: 0.09 }); ST.room.ring(0, 0.03, 0, 1.8, 'xz', PAL.coral, { gap: 0.15, len: 0.08 });
  for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; B.room.add(sphG(0.045, 8, 6), i % 2 ? PAL.butter : PAL.pink, { x: Math.cos(a) * 2.78, y: 0.03, z: Math.sin(a) * 2.78, sy: 0.6 }, 'felt', false); }
  // daylight through the round window (fitting mode only): a slanted additive shaft
  const wshaft = new THREE.Mesh(cylG(WIN.r * 0.98, WIN.r * 1.25, 5.0, 40, true), beamMat()); wshaft.rotation.z = 0.86; wshaft.position.set(-5.05, 1.5, WIN.z); wshaft.renderOrder = 5; wshaft.material.uniforms.c.value.set(0xffe6b8); wshaft.material.uniforms.k.value = 0.2; G.fit.add(wshaft);

  // ---- chandelier made of spools (turns slowly), fairy lights on beat-twinkling bulbs
  const chand = new THREE.Group(); chand.position.set(-2.75, 0, -1.6); G.room.add(chand);
  const cb = new Batch(M, chand, 'chand');
  cb.add(cylG(0.012, 0.012, 1.4, 6), PAL.cream, { y: CEIL - 0.7 }, 'felt', false);
  for (let i = 0; i < 5; i++) cb.tor(0.03, 0.008, PAL.butter2, { y: CEIL - 0.25 - i * 0.26, ry: i * 1.2 }, 5, 10, 'felt', false);
  cb.add(cylG(0.16, 0.3, 0.16, 16), PAL.pink, { y: CEIL - 0.06 }, 'felt', false);
  spoolB(cb, { y: 3.85 }, PAL.hot, 0.2, 0.55, PAL.butter, true);
  cb.tor(0.85, 0.028, PAL.butter2, { y: 3.98, rx: PI / 2 }, 6, 48, 'felt', true);
  const chBulbs = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU, x = Math.cos(a) * 0.85, z = Math.sin(a) * 0.85;
    cb.add(cylG(0.01, 0.01, 0.9, 5), PAL.cream, { x: x * 0.5, y: 4.03 + 0.06, z: z * 0.5, rz: 0, rx: 0 }, 'felt', false);
    cb.rbox(0.03, 0.03, 0.85, 0.012, PAL.butter2, { x: x * 0.5, y: 4.0, z: z * 0.5, ry: PI / 2 - a }, 'felt', false);
    spoolB(cb, { x, y: 4.0, z }, CANDY[i], 0.055, 0.16, PAL.cream);
    for (let k = 0; k < 2; k++) cb.add(tubeG([[x, 3.98, z], [x + (k ? 0.05 : -0.05), 3.7, z + 0.03], [x + (k ? 0.08 : -0.08), 3.5 - k * 0.1, z]], 0.012, 8, 4), CANDY[(i + 2 + k) % CANDY.length], {}, 'cloth', false);
    chBulbs.push({ a, x, z });
  }
  cb.flush();
  const chMat = M.glow(0xffffff, 1.15), chIM = new THREE.InstancedMesh(sphG(0.05, 8, 6), chMat, 6); chIM.frustumCulled = false; chand.add(chIM);
  const chM = new THREE.Matrix4(); chBulbs.forEach((b2, i) => { chM.makeTranslation(b2.x, 4.19, b2.z); chIM.setMatrixAt(i, chM); chIM.setColorAt(i, new THREE.Color(1, 1, 1)); });

  const strings = [
    { pts: sagLine([-6.85, 4.85, -4.85], [6.85, 4.85, -4.85], 0.55, 40), n: 26 },
    { pts: sagLine([-6.85, 4.7, 4.6], [-6.85, 4.7, -2.6], 0.4, 24), n: 15 },
    { pts: sagLine([6.85, 4.7, 4.6], [6.85, 4.7, -3.6], 0.4, 24), n: 15 },
  ];
  const bulbPos = [];
  strings.forEach((s) => {
    B.room.add(tubeG(s.pts, 0.007, s.pts.length * 2, 4), PAL.cream, {}, 'felt', false);
    const c = new THREE.CatmullRomCurve3(s.pts.map((p) => V3(...p)));
    for (let i = 0; i < s.n; i++) { const p = c.getPoint((i + 0.5) / s.n); bulbPos.push([p.x, p.y - 0.05, p.z]); }
  });
  for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; bulbPos.push([Math.cos(a) * (HOLE + 0.22), CEIL - 0.06, Math.sin(a) * (HOLE + 0.22)]); }
  const fairy = new THREE.InstancedMesh(sphG(0.045, 8, 6), M.glow(0xffffff, 1.15), bulbPos.length); fairy.frustumCulled = false; G.room.add(fairy);
  const fm4 = new THREE.Matrix4(); bulbPos.forEach((p, i) => { fm4.makeTranslation(...p); fairy.setMatrixAt(i, fm4); fairy.setColorAt(i, new THREE.Color(1, 1, 1)); });
  const bulbCol = bulbPos.map((_, i) => new THREE.Color(CANDY[(i * 3 + 1) % CANDY.length]).multiplyScalar(1.0));
  const NB = Math.min(bulbPos.length, 70);

  // gilded price-tag garland along the north wall (fitting mode; tea mode has the bunting there)
  {
    const gp = sagLine([-6.7, 4.4, -4.9], [6.7, 4.4, -4.9], 0.42, 40); B.fit.add(tubeG(gp, 0.006, 80, 4), PAL.cream, {}, 'felt', false);
    const gc = new THREE.CatmullRomCurve3(gp.map((p) => V3(...p))), gn = 26;
    for (let i = 1; i < gn; i++) {
      const p = gc.getPoint(i / gn), rz = 0.14 * Math.sin(i * 2.3), col = i % 4 === 0 ? 0xf7dc94 : 0xf0c25a;
      B.fit.rbox(0.15, 0.21, 0.012, 0.005, col, { x: p.x, y: p.y - 0.13, z: p.z + 0.03, rz }, 'felt', false);
      B.fit.add(sphG(0.014, 6, 5), PAL.hot, { x: p.x + Math.sin(rz) * 0.07, y: p.y - 0.045, z: p.z + 0.042 }, 'felt', false);
      B.fit.add(cylG(0.003, 0.003, 0.06, 4), PAL.hot, { x: p.x, y: p.y - 0.015, z: p.z + 0.03 }, 'felt', false);
    }
  }

  // ================================================================ TEA GROUP
  const T = B.tea;
  const tcloth = skirtG([[0.001, TABLE_TOP + 0.012], [0.5, TABLE_TOP + 0.014], [0.84, TABLE_TOP + 0.008], [0.9, TABLE_TOP - 0.03], [0.95, 0.8], [1.0, 0.6], [1.06, 0.44]], { seg: 56, amp: 0.05, n: 22, rings: 14, pow: 2.2 });
  T.add(tcloth, 0xb7a0f0, {}, 'cloth', true);
  T.add(skirtG([[0.001, TABLE_TOP + 0.02], [0.4, TABLE_TOP + 0.02], [0.45, TABLE_TOP + 0.017]], { seg: 48, amp: 0.02, n: 26, pow: 1 }), PAL.cream, {}, 'cloth', false);
  T.tor(1.0, 0.018, PAL.lilac, { y: 0.55, rx: PI / 2 }, 5, 64, 'felt', false);
  ST.tea.ring(0, 0.6, 0, 0.995, 'xz', PAL.hot, { gap: 0.13, len: 0.065 });
  for (let i = 0; i < 22; i++) { const a = i / 22 * TAU; T.add(sphG(0.03, 8, 6), i % 2 ? PAL.pink : PAL.butter, { x: Math.cos(a) * 1.055, y: 0.46, z: Math.sin(a) * 1.055 }, 'felt', false); }
  T.add(cylG(0.16, 0.2, 0.9, 16), PAL.lilac, { y: 0.45 }, 'felt', false);
  const cupB = (b, o, col, s = 1.5) => b.place(o, (bb) => {
    bb.add(latheG([[0.001, 0.0], [0.038, 0.0], [0.05, 0.02], [0.066, 0.078], [0.061, 0.08], [0.046, 0.024], [0.001, 0.02]], 16), col, { s }, 'cloth', false);
    bb.add(cylG(0.055 * s, 0.055 * s, 0.004, 14), 0xc98a5a, { y: 0.062 * s }, 'felt', false);
    bb.tor(0.03 * s, 0.009 * s, col, { x: 0.068 * s, y: 0.048 * s, rz: 0, ry: 0 }, 5, 10, 'felt', false);
    bb.add(latheG([[0.001, 0.0], [0.08, 0.0], [0.115, 0.014], [0.118, 0.02], [0.08, 0.008], [0.001, 0.007]], 20), col === PAL.cream ? PAL.pink2 : PAL.cream, { s: s * 0.95, y: -0.003 }, 'cloth', false);
  });
  const cupCols = [PAL.pink, PAL.lilac, PAL.sky, PAL.butter, PAL.mint, PAL.peach, PAL.pink2];
  const cupPos = [];
  for (let k = 0; k < 7; k++) { const f = seatPhi(k), r = 0.66; const x = Math.sin(f) * r, z = -Math.cos(f) * r; cupPos.push({ x, z }); cupB(T, { x, y: TABLE_TOP + 0.02, z, ry: -f + PI }, cupCols[k]); }
  // teapot
  T.place({ x: 0.06, y: TABLE_TOP + 0.02, z: 0.5, ry: -0.5 }, (bb) => {
    bb.add(sphG(0.15, 20, 14), PAL.pink, { y: 0.15, sy: 0.88 }, 'cloth', true); bb.tor(0.13, 0.014, PAL.butter2, { y: 0.09, rx: PI / 2 }, 5, 20, 'felt', false);
    bb.add(cylG(0.09, 0.1, 0.04, 16), PAL.butter2, { y: 0.02 }, 'felt', false);
    bb.add(sphG(0.085, 14, 9), PAL.pink2, { y: 0.28, sy: 0.6 }, 'cloth', false); bb.add(sphG(0.026, 8, 6), PAL.hot, { y: 0.335 }, 'felt', false);
    bb.add(tubeG([[0.12, 0.1, 0], [0.22, 0.14, 0], [0.25, 0.24, 0]], 0.022, 12, 6), PAL.pink, {}, 'cloth', false); bb.add(sphG(0.026, 8, 6), PAL.butter2, { x: 0.255, y: 0.245 }, 'felt', false);
    bb.tor(0.07, 0.018, PAL.butter2, { x: -0.16, y: 0.17, rz: 0, ry: PI / 2 }, 6, 16, 'felt', false);
    flowerB(bb, { x: 0, y: 0.17, z: 0.145 }, PAL.butter, PAL.hot, 1.6);
  });
  // tiered cake stand with felt cakes (centre)
  T.place({ x: 0.0, y: TABLE_TOP + 0.02, z: 0.0 }, (bb) => {
    bb.add(cylG(0.02, 0.02, 0.64, 8), PAL.butter2, { y: 0.32 }, 'felt', true);
    const plates = [[0.31, 0.1, PAL.lilac2], [0.22, 0.34, PAL.pink], [0.15, 0.56, PAL.mint]];
    for (const [r, y, c] of plates) { bb.add(cylG(r, r * 0.92, 0.02, 32), c, { y }, 'felt', true); bb.tor(r, 0.014, PAL.cream, { y: y + 0.012, rx: PI / 2 }, 5, 32, 'felt', false); bb.add(sphG(0.032, 8, 6), PAL.butter2, { y: y + 0.03 }, 'felt', false); }
    bb.add(sphG(0.035, 8, 6), PAL.hot, { y: 0.67 }, 'felt', false);
    for (let i = 0; i < 6; i++) {       // cupcakes on the big plate
      const a = i / 6 * TAU, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2, col = CANDY[(i * 2) % CANDY.length];
      bb.add(cylG(0.048, 0.036, 0.05, 12), CANDY[(i * 2 + 3) % CANDY.length], { x, y: 0.145, z }, 'cloth', false);
      for (let k = 0; k < 3; k++) bb.add(sphG(0.05 - k * 0.01, 10, 7), col, { x, y: 0.19 + k * 0.03, z, sy: 0.7 }, 'cloth', false);
      bb.add(sphG(0.012, 6, 5), PAL.hot, { x, y: 0.265, z }, 'felt', false);
    }
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12; bb.tor(0.032, 0.016, CANDY[(i + 1) % CANDY.length], { x, y: 0.375, z, rx: PI / 2 }, 6, 14, 'cloth', false); bb.tor(0.032, 0.008, PAL.cream, { x, y: 0.39, z, rx: PI / 2 }, 4, 14, 'cloth', false); }
    bb.add(cylG(0.08, 0.08, 0.05, 20), PAL.cream, { y: 0.6 }, 'cloth', false); bb.add(cylG(0.06, 0.06, 0.04, 20), PAL.pink2, { y: 0.65 }, 'cloth', false); bb.add(sphG(0.026, 8, 6), PAL.hot, { y: 0.7 }, 'felt', false);
  });
  // vase with felt flowers
  T.place({ x: -0.38, y: TABLE_TOP + 0.02, z: 0.4 }, (bb) => {
    bb.add(latheG([[0.001, 0], [0.05, 0], [0.075, 0.09], [0.04, 0.17], [0.05, 0.21], [0.045, 0.21], [0.03, 0.17], [0.06, 0.09], [0.001, 0.01]], 16), PAL.mint, {}, 'cloth', true);
    [[0, 0.06, PAL.pink, 0.1], [0.09, 0.09, PAL.butter, -0.4], [-0.08, 0.08, PAL.lilac, 0.5], [0.03, 0.03, PAL.peach, 0.05], [-0.03, 0.12, PAL.sky, -0.15]].forEach(([dx, dy, c, tilt], i) => {
      const top = [dx * 1.6, 0.34 + dy * 1.6, 0]; bb.add(tubeG([[0, 0.2, 0], [top[0] * 0.5, 0.28, 0], top], 0.006, 8, 4), PAL.mint, {}, 'felt', false);
      flowerB(bb, { x: top[0], y: top[1], z: 0, rz: tilt, ry: i }, c, PAL.butter2, 0.95);
    });
  });
  // candles (4 on the table); flames are glow points
  const flames = [];      // local positions of the flame tips
  const candleB = (b, o, tall, col) => b.place(o, (bb) => {
    bb.add(latheG([[0.001, 0], [0.045, 0], [0.05, 0.02], [0.02, 0.05], [0.026, 0.09], [0.04, 0.1], [0.001, 0.1]], 12), PAL.butter2, {}, 'felt', false);
    bb.add(cylG(0.028, 0.03, tall, 12), col, { y: 0.1 + tall / 2 }, 'felt', false); bb.add(cylG(0.004, 0.004, 0.03, 4), 0x333333, { y: 0.1 + tall + 0.012 }, 'felt', false);
    for (let k = 0; k < 3; k++) bb.add(sphG(0.014, 6, 5), col, { x: 0.026, y: 0.1 + tall - 0.02 - k * 0.05, z: 0.005, sy: 1.6 }, 'felt', false);
  });
  const tcandles = [[-0.5, 0.06, 0.2, PAL.cream], [0.2, -0.43, 0.26, PAL.pink2], [-0.24, 0.62, 0.14, PAL.lilac2], [0.34, 0.58, 0.18, PAL.cream]];      // (the pink one stands on the far side: the arm gag needs the space between seat 6 and the stand clear)
  tcandles.forEach(([x, z, tall, col]) => { candleB(T, { x, y: TABLE_TOP + 0.02, z }, tall, col); flames.push([x, TABLE_TOP + 0.02 + 0.1 + tall + 0.055, z, 'table']); });
  // floor lanterns and side stools (two more candles) + candle pair on the cutting table
  for (const [x, z] of [[-2.85, -2.2], [2.85, -2.3]]) {
    T.rbox(0.42, 0.06, 0.42, 0.03, PAL.lilac, { x, y: 0.52, z }, 'felt', true); for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) T.cyl(0.03, 0.025, 0.5, PAL.butter, { x: x + dx * 0.16, y: 0.25, z: z + dz * 0.16 }, 8, 'felt', false);
    T.add(cylG(0.11, 0.1, 0.2, 14, true), 0xfff0d0, { x, y: 0.65, z }, 'cloth', false); T.tor(0.11, 0.012, PAL.butter2, { x, y: 0.75, z, rx: PI / 2 }, 5, 16, 'felt', false); T.tor(0.1, 0.012, PAL.butter2, { x, y: 0.55, z, rx: PI / 2 }, 5, 16, 'felt', false);
    T.add(cylG(0.03, 0.03, 0.14, 8), PAL.cream, { x, y: 0.62, z }, 'felt', false); flames.push([x, 0.71, z, 'floor']);
  }
  for (const [x, z, tall] of [[CT.x - 0.32, 1.42, 0.16], [CT.x + 0.4, -0.2, 0.2]]) { candleB(T, { x, y: CT.top + 0.01, z }, tall, PAL.cream); flames.push([x, CT.top + 0.11 + tall + 0.055, z, 'work']); }
  // 7 stools with cushions in a horseshoe
  for (let k = 0; k < 7; k++) {
    const s = seatXZ(k), c = CANDY[(k * 3) % CANDY.length];
    T.add(cylG(0.29, 0.29, 0.06, 24), PAL.butter, { x: s.x, y: SEAT_TOP - 0.11, z: s.z }, 'felt', true);
    T.add(sphG(0.3, 20, 12), c, { x: s.x, y: SEAT_TOP - 0.1, z: s.z, sy: 0.26 }, 'cloth', true);
    T.tor(0.29, 0.02, PAL.cream, { x: s.x, y: SEAT_TOP - 0.11, z: s.z, rx: PI / 2 }, 5, 24, 'felt', false);
    for (let i = 0; i < 3; i++) { const a = i * 2.09 + k; T.add(cylG(0.03, 0.022, SEAT_TOP - 0.14, 8), PAL.butter2, { x: s.x + Math.cos(a) * 0.17, y: (SEAT_TOP - 0.14) / 2, z: s.z + Math.sin(a) * 0.17, rx: Math.sin(a) * 0.1, rz: -Math.cos(a) * 0.1 }, 'felt', false); }
    T.add(sphG(0.025, 8, 6), PAL.hot, { x: s.x, y: SEAT_TOP + 0.0, z: s.z }, 'felt', false);
  }
  // round rug under the party
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; flowerB(T, { x: Math.cos(a) * 2.15, y: 0.03, z: Math.sin(a) * 2.15, rx: -PI / 2 }, CANDY[i % CANDY.length], PAL.butter2, 2.0); }
  // bunting along the north wall and both side walls
  const bunting = (a, b2, sag, n) => {
    const pts = sagLine(a, b2, sag, 30); T.add(tubeG(pts, 0.008, 60, 4), PAL.cream, {}, 'felt', false);
    const c = new THREE.CatmullRomCurve3(pts.map((p) => V3(...p)));
    for (let i = 1; i < n; i++) { const p = c.getPoint(i / n), tg = c.getTangent(i / n); T.add(new THREE.ConeGeometry(0.15, 0.36, 3), CANDY[(i * 3) % CANDY.length], { x: p.x, y: p.y - 0.18, z: p.z, rx: PI, ry: Math.atan2(tg.x, tg.z) + PI / 2, sz: 0.25 }, 'cloth', false); }
  };
  bunting([-6.9, 4.5, -3.0], [6.9, 4.5, -3.0], 0.75, 36); bunting([-6.9, 4.4, 3.4], [-2.2, 4.85, -4.9], 0.6, 26); bunting([6.9, 4.4, 3.4], [2.2, 4.85, -4.9], 0.6, 26);

  // ================================================================ FLUSH BATCHES
  Object.values(B).forEach((b) => b.flush());
  ST.room.flush(G.room, M); ST.fit.flush(G.fit, M); ST.tea.flush(G.tea, M);
  root.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.receiveShadow = o.receiveShadow; });

  // ================================================================ NAMED PLACES
  const w3 = (x, y, z) => [x + CX, y, z];
  const slots = {
    platform: { x: CX, y: PLAT_TOP, z: 0, rotY: 0 }, platformL: { x: CX - 1.6, y: 0.205, z: 0.05, rotY: 0.25 }, platformR: { x: CX + 1.6, y: 0.205, z: 0.05, rotY: -0.25 },
    rackFront: { x: CX + 4.5, y: 0, z: -3.35, rotY: PI }, tableFront: { x: CX - 4.55, y: 0, z: -0.55, rotY: -PI / 2 },
    machine: { x: CX + 3.55, y: 0, z: SW.z, rotY: PI / 2 },
  };
  for (let k = 0; k < 6; k++) slots['waitLine' + k] = { x: CX + 2.95 + k * 0.7, y: 0, z: 0.5 + (k % 2 ? 0.34 : -0.06), rotY: -PI / 2 + (k % 2 ? 0.06 : -0.05) };
  for (let k = 0; k < 7; k++) { const s = seatXZ(k); slots['teaSeat' + k] = { x: CX + s.x, y: SEAT_ROOT, z: s.z, rotY: Math.atan2(-s.x, -s.z) }; }
  const anchors = {
    platform: { x: CX, y: PLAT_TOP, z: 0 }, mirror: { x: CX, y: 1.4, z: MIR.z }, table: { x: CX, y: TABLE_TOP, z: 0 }, skylight: { x: CX, y: CEIL, z: 0 },
    machineTable: { x: CX + SW.x, y: 0.84, z: SW.z }, roofY: ROOF, skylightR: HOLE, seatTop: SEAT_TOP, panelTopY: ROOF + 0.34, center: { x: CX, y: 0, z: 0 },
  };

  // ================================================================ RIGS (world coordinates)
  const seatOf = (c2, d = 3) => Math.max(0, Math.min(6, Math.round(c2?.args?.seat ?? d)));
  const rigs = {
    // slow dolly on u.p: platform, queue and rack in one frame, from the south-west
    fitWide: (u) => { const p = u.p; return { pos: w3(lerp(-3.4, -2.2, p), lerp(2.55, 2.3, p), lerp(4.6, 4.4, p)), look: w3(lerp(2.3, 2.0, p), 1.0, -0.6), fov: 52 }; },
    // medium on the platform, slow push (u.p)
    fitTwo: (u) => { const p = u.p; return { pos: w3(lerp(1.4, 0.9, p), 1.35, lerp(4.0, 3.4, p)), look: w3(0, 1.2, 0.1), fov: 40 }; },
    // low macro at hem level, drifts on u.p
    hemPin: (u) => { const p = u.p; return { pos: w3(lerp(0.95, 0.6, p), 0.8, lerp(1.55, 1.3, p)), look: w3(0.05, 0.86, 0.05), fov: 30 }; },
    // facing the mirror from the room: mirror and platform in frame, u.p drift
    mirror: (u) => { const p = u.p; return { pos: w3(lerp(1.7, 0.7, p), 1.5, 3.5), look: w3(0, 1.3, -2.4), fov: 46 }; },
    // slow pan along the garment rack (u.p): 2.6 m to 6.0 m
    rackPan: (u) => { const p = smoother(u.p), x = lerp(2.9, 5.9, p); return { pos: w3(x - 0.3, 1.25, -1.0), look: w3(x + 0.25, 1.1, -4.1), fov: 42 }; },
    // cutting-table macro (tape, scissors, tulle), slow push on u.p
    tableCU: (u) => { const p = u.p; return { pos: w3(lerp(-3.7, -4.1, p), lerp(1.95, 1.75, p), lerp(-0.55, -0.95, p)), look: w3(-5.75, 0.99, lerp(-0.85, -1.15, p)), fov: 36 }; },
    // chest-height macro of a collar on the platform
    laceMacro: (u) => { const p = u.p; return { pos: w3(lerp(0.62, 0.42, p), 1.47, lerp(1.7, 1.4, p)), look: w3(0, 1.42, 0), fov: 30 }; },
    // front-on, waist height: platform + podiums + head of the wait line, slow slide on u.p
    swayLine: (u) => { const p = u.p; return { pos: w3(lerp(2.0, 1.4, p), 1.05, 4.7), look: w3(lerp(2.0, 1.4, p), 1.0, 0), fov: 46 }; },
    // tea party, high oblique from the open side of the horseshoe, slow dolly (u.p).  (The film's own teaWide camera is in web/film/shots2.js.  An earlier build of this view rendered black at some poses in software GL; not seen since the seat-root height fix, SEAT_ROOT = SEAT_TOP.)
    teaWide: (u) => { const p = u.p; return { pos: w3(lerp(0.5, 0.15, p), lerp(2.75, 2.45, p), lerp(4.65, 4.05, p)), look: w3(0, 0.95, -0.2), fov: 46 }; },
    // over Pip's shoulder (seat 0) to the zombie in c2.args.seat (default 3); u.p push
    teaCU: (u, c2) => {
      const S0 = seatXZ(0), k = seatOf(c2, 3), S = seatXZ(k), p = u.p;
      const e = { x: S.x - S0.x, z: S.z - S0.z }, el = Math.hypot(e.x, e.z); e.x /= el; e.z /= el; const rt = { x: -e.z, z: e.x };
      const back = lerp(0.68, 0.58, p), side = lerp(1.15, 1.1, p);
      return { pos: w3(S0.x - e.x * back + rt.x * side, lerp(1.9, 1.78, p), S0.z - e.z * back + rt.z * side), look: w3(S.x - rt.x * 0.05, SEAT_ROOT + 1.22, S.z - rt.z * 0.05), fov: 31 };
    },
    // straight down on the table, slight roll on u.p
    teaOverhead: (u) => { const p = u.p; return { pos: w3(0.0, lerp(4.5, 4.0, p), 0.01), look: w3(0, TABLE_TOP, 0), fov: 44, roll: lerp(-0.05, 0.07, p) }; },
    // candle level through the open side of the horseshoe
    teaLow: (u) => { const p = u.p; return { pos: w3(lerp(0.55, 0.25, p), 1.08, lerp(2.0, 1.75, p)), look: w3(0, 1.22, -0.25), fov: 34 }; },
    // medium on one seat from across the table (c2.args.seat, default 2)
    armDrop: (u, c2) => {
      const k = seatOf(c2, 2), S = seatXZ(k), d = { x: -S.x, z: -S.z }, dl = Math.hypot(d.x, d.z); d.x /= dl; d.z /= dl; const rt = { x: -d.z, z: d.x };
      return { pos: w3(S.x + d.x * 2.9 + rt.x * 1.0, 2.05, S.z + d.z * 2.9 + rt.z * 1.0), look: w3(S.x, SEAT_ROOT + 0.95, S.z), fov: 32 };
    },
    // floor level, tilts up to straight up through the open skylight (u.p; c2.args.tilt = 0 for a fixed straight-up view)
    skyUp: (u, c2) => {
      const p = u.p, kt = (c2?.args?.tilt ?? 1) === 0 ? 1 : smoother(clamp(p / 0.7));
      return { pos: w3(0.0, 0.45, 1.3), look: w3(0.0, lerp(1.8, 8.5, kt), lerp(-3.0, -0.35, kt)), fov: 64 };
    },
    // rises from the table (y 1.6) through the opening to y 9 above the roof, tilting down to the roof and out to the horizon (u.p 0..1)
    skyRise: (u) => {
      const p = clamp(u.p), e = smoother(p), y = lerp(1.6, 9.0, e), late = smoother(clamp((p - 0.55) / 0.45)), early = smoother(clamp(p / 0.45));
      const pos = [lerp(0.9, 0.0, early), y, lerp(1.4, 0.15, early) + late * 5.6];
      const look = [0, lerp(4.6, 5.0, late) + (1 - late) * 3.0 * (1 - early) + late * 0.4, lerp(0.0, -8.0, late)];
      return { pos: w3(pos[0], pos[1], pos[2]), look: w3(look[0], look[1], look[2]), fov: lerp(52, 62, late) };
    },
  };

  // ================================================================ LIGHT
  const isTea = (u, c2) => u.mode === 'tea' || c2?.args?.mode === 'tea' || (u.mode === undefined && c2?.mode === 'tea');
  const skyOpen = (c2) => smoother(clamp(c2?.args?.skylight ?? 0));
  const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k);
  const flick = (t, s) => 0.8 + 0.1 * Math.sin(t * 11.3 + s) + 0.06 * Math.sin(t * 23.1 + s * 2.1) + 0.06 * hash(Math.floor(t * 14) + s * 7.7);
  function light(kit, u, c2) {
    const tea = isTea(u, c2), sk = skyOpen(c2), t = u.t, pl = c2?.pulse ?? 0;
    if (!tea) {
      kit.setKey({ pos: w3(-7.5, 8.4, 6.6), target: w3(-0.4, 0.5, -0.4), color: 0xfff4e6, i: 1.45, extent: 8.5, near: 3, far: 24 });
      kit.setHemi({ sky: 0xf2eeff, ground: 0xe6cfc6, i: 0.5 });
      kit.setSpot(0, { color: 0xfff0d8, i: 62, dist: 14, angle: 0.44, pen: 0.7, decay: 1.2, pos: w3(0.2, 5.1, 1.4), target: w3(0, 0.6, 0) });
      kit.setSpot(1, { color: 0xffe8c8, i: 30, dist: 14, angle: 0.55, pen: 0.7, decay: 1.2, pos: w3(-3.0, 4.9, -0.4), target: w3(-5.6, 0.9, -0.6) });
      kit.setSpot(2, { color: 0xfff0e0, i: 40, dist: 14, angle: 0.5, pen: 0.7, decay: 1.2, pos: w3(3.7, 4.9, -1.6), target: w3(4.5, 1.0, -4.0) });
      kit.setSpot(3, { color: 0xd6e8ff, i: 34, dist: 14, angle: 0.5, pen: 0.8, decay: 1.2, pos: w3(-0.8, 4.0, -4.6), target: w3(0, 1.4, -1.0) });
      kit.setSpot(4, { color: 0xffe6d0, i: 36, dist: 14, angle: 0.6, pen: 0.7, decay: 1.2, pos: w3(4.6, 4.8, 2.4), target: w3(4.6, 0.6, 1.0) });
      kit.setPoint(0, { color: 0xffd090, i: 12 * (1 + 0.25 * pl), dist: 8, decay: 1.5, pos: w3(-4.3, 3.1, 0.4) });
      kit.setPoint(1, { color: 0xffb0d8, i: 16 * (1 + 0.25 * pl), dist: 8, decay: 1.5, pos: w3(0.6, 3.0, -2.0) });
    } else {
      // dusk moonlight warms toward a pale peach dawn as the roof opens (the sky outside is peach)
      kit.setKey({ pos: w3(1.4, 15, -1.0), target: w3(0, 0.4, 0), color: mix(0xa9b8ff, 0xffdcc8, sk), i: 0.12 + 1.35 * sk, extent: 6.5, near: 6, far: 24 });
      kit.setHemi({ sky: mix(0x8a80d0, 0xd2c4ff, sk), ground: mix(0x4a3050, 0x8a6684, sk), i: 0.55 + 0.3 * sk });
      kit.setSpot(0, { color: 0xffc880, i: 32, dist: 12, angle: 0.42, pen: 0.85, decay: 1.2, pos: w3(0, 4.7, 0.2), target: w3(0, 0.9, 0) });
      kit.setSpot(1, { color: 0xffb070, i: 24, dist: 14, angle: 0.5, pen: 0.8, decay: 1.2, pos: w3(3.5, 4.6, -1.5), target: w3(4.5, 1.0, -4.0) });
      kit.setSpot(2, { color: 0x9aa8ff, i: 26, dist: 14, angle: 0.55, pen: 0.8, decay: 1.2, pos: w3(-6.0, 3.4, -0.3), target: w3(-2.0, 1.0, 0.3) });
      kit.setSpot(3, { color: mix(0xb8c8ff, 0xffe8d8, sk), i: 78 * sk, dist: 20, angle: 0.33, pen: 0.7, decay: 1.1, pos: w3(0, 9, 0), target: w3(0, 0.5, 0) });
      kit.setSpot(4, { color: 0xffbe80, i: 30, dist: 14, angle: 0.6, pen: 0.8, decay: 1.2, pos: w3(-4.8, 4.5, 0.2), target: w3(-5.6, 0.9, 0.2) });
      kit.setPoint(0, { color: 0xffb060, i: 7.5 * flick(t, 1.3), dist: 6, decay: 1.5, pos: w3(0.3, 1.35, 0.1) });
      kit.setPoint(1, { color: 0xffa860, i: 5.5 * flick(t, 4.1), dist: 6, decay: 1.5, pos: w3(-0.5, 1.3, 0.5) });
    }
  }

  // ================================================================ UPDATE
  const NDUST = 70, NFAIRY = NB;
  const cupSteam = [0, 2, 4];
  function update(u, c2) {
    const tea = isTea(u, c2), t = u.t, sk = skyOpen(c2), pulse = c2?.pulse ?? 0, beat = c2?.beat ?? 0;
    G.fit.visible = !tea; G.tea.visible = tea;
    // skylight: panels slide apart on their rails; ceiling and panels only cast the moon's shadow in tea mode
    for (const P of panels) { P.grp.position.x = P.sg * (0.02 + sk * (HOLE + 0.62)); P.slab.castShadow = tea; }
    ceilMesh.castShadow = tea;
    shaft.visible = sk > 0.02; shaft2.visible = sk > 0.02;
    shaft.material.uniforms.k.value = (tea ? 0.34 : 0.22) * sk; shaft2.material.uniforms.k.value = (tea ? 0.5 : 0.3) * sk;
    mirMat.emissiveIntensity = tea ? 0.1 : 0.32; winMat.color.setRGB(tea ? 0.42 : 1, tea ? 0.38 : 1, tea ? 0.62 : 1);
    const rp = 1 + 0.4 * pulse; ringMat.color.setRGB(1.0 * rp, 0.56 * rp, 0.78 * rp);
    for (const c of curtains) { c.grp.rotation.x = Math.sin(t * 0.7 + c.seed) * 0.02; }
    chand.rotation.y = t * 0.12;
    { const open = 0.04 + 0.26 * (1 - pulse); for (const h of scisHalf) h.rotation.y = h.userData.sd * open;
      const un = smooth(clamp(c2?.args?.unroll ?? u.p)); unrollM.scale.z = 0.12 + 0.88 * un; unrollEdge.position.z = 0.85 - 1.6 * (0.12 + 0.88 * un) - 0.02; }
    // fairy lights twinkle on the beat
    const tmp = new THREE.Color();
    for (let i = 0; i < bulbPos.length; i++) {
      const on = (i + Math.floor(beat)) % 3 === 0 ? pulse : 0;
      const k = (tea ? 0.32 : 0.62) + (tea ? 0.25 : 0.4) * (0.5 + 0.5 * Math.sin(t * 2.7 + i * 1.9)) + 0.9 * on;
      fairy.setColorAt(i, tmp.copy(bulbCol[i]).multiplyScalar(k));
    }
    fairy.instanceColor.needsUpdate = true;
    for (let i = 0; i < 6; i++) { const on = (i + Math.floor(beat)) % 2 === 0 ? pulse : 0; chIM.setColorAt(i, tmp.setRGB(1, 0.86, 0.6).multiplyScalar((tea ? 0.7 : 1.0) + 0.5 * on)); }
    chIM.instanceColor.needsUpdate = true;
    // glow points -----------------------------------------------------------------------------------------------
    let gi = 0;
    for (let i = 0; i < NDUST; i++) {       // dust motes in the shaft
      const fr = ((hash(i + 200) + t * (0.012 + 0.02 * hash(i + 300))) % 1), a = hash(i) * TAU + t * (0.05 + 0.04 * hash(i + 9)) * (i % 2 ? 1 : -1), r = Math.sqrt(hash(i + 100)) * (HOLE - 0.25);
      glow.set(gi++, Math.cos(a) * r + Math.sin(t * 0.5 + i) * 0.04, 5.3 - fr * 5.0, Math.sin(a) * r, 0.03 + 0.03 * hash(i + 50), 0.85, 0.9, 1.0, sk * 0.5 * Math.min(1, fr * 6) * Math.min(1, (1 - fr) * 6));
    }
    for (let i = 0; i < 8; i++) {           // candle flames (core + halo); floor lanterns/work candles live in both modes' tea group only
      const f = flames[i]; if (!f) { glow.hide(gi++); glow.hide(gi++); continue; }
      const fl = tea ? flick(t, i * 2.7 + 1) : 0;
      glow.set(gi++, f[0] + 0.004 * Math.sin(t * 9 + i), f[1] + 0.012 * fl, f[2], 0.075 * (0.8 + 0.5 * fl), 1.0, 0.9, 0.55, tea ? 1.0 : 0);
      glow.set(gi++, f[0], f[1] + 0.01, f[2], 0.34 * (0.7 + 0.5 * fl), 1.0, 0.55, 0.2, tea ? 0.7 * fl : 0);
    }
    for (let i = 0; i < NFAIRY; i++) {      // bulb halos
      const p = bulbPos[i], on = (i + Math.floor(beat)) % 3 === 0 ? pulse : 0, c = bulbCol[i];
      glow.set(gi++, p[0], p[1], p[2], 0.2 + 0.1 * on, c.r * 0.7, c.g * 0.7, c.b * 0.7, (tea ? 0.32 : 0.28) + 0.4 * on);
    }
    for (let i = 0; i < 6; i++) {           // chandelier halos (it turns)
      const b2 = chBulbs[i], a = b2.a + chand.rotation.y, on = (i + Math.floor(beat)) % 2 === 0 ? pulse : 0;
      glow.set(gi++, Math.cos(a) * 0.85 + chand.position.x, 4.19, Math.sin(a) * 0.85 + chand.position.z, 0.34 + 0.12 * on, 1.0, 0.8, 0.5, (tea ? 0.5 : 0.36) + 0.3 * on);
    }
    for (let i = 0; i < 12; i++) {          // mirror sparkles: twinkle on the beat
      const a = hash(i + 400), b3 = hash(i + 500), ph = (t * 0.9 + a * 5 + (Math.floor(beat) % 2) * 0.3) % 1, tw = Math.pow(Math.max(0, Math.sin(ph * PI)), 3) * (0.5 + 0.7 * pulse);
      glow.star(gi++, (a - 0.5) * 3.0, 0.7 + b3 * 1.6, MIR.z + 0.16 + (Math.abs(a - 0.5) > 0.27 ? 0.36 : 0.0), 0.16 + 0.26 * tw, 1, 1, 1, tw * (tea ? 0.5 : 1.0));
    }
    for (let ci = 0; ci < cupSteam.length; ci++) for (let j = 0; j < 4; j++) {       // steam curls above three cups
      const cp = cupPos[cupSteam[ci]], fr = (t * 0.16 + j / 4 + ci * 0.31) % 1, h = fr * 0.34;
      glow.set(gi++, cp.x + Math.sin(fr * 7 + ci * 2 + j) * 0.03, TABLE_TOP + 0.13 + h, cp.z + Math.cos(fr * 6 + ci) * 0.02, 0.05 + 0.1 * fr, 0.8, 0.82, 1.0, tea ? 0.2 * Math.sin(fr * PI) : 0);
    }
    while (gi < glow.N) glow.hide(gi++);
    glow.commit();
  }

  const set = {
    name: 'atelier', root, anchors, rigs, slots, update, light,
    post: { band: 0.42, tilt: 1.8, focusY: 0.5, bloom: 0.2, vig: 0.34 },
    info: { tris: Object.values(B).reduce((a, b) => a + b.tris, 0), lite },
  };
  return set;
}
