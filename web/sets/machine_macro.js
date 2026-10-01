// The sewing machine as a star: an extension of the mall (FILM.md section 5).   build(ctx, mall) -> ext        (owner: gags)
// It adds detail around the machine that already stands on the barricade (mall.anchors.machine, scale 1.15) and drives it.
//
// c2.args (all optional):
//   needle 0 | 1 | 2 | 4   stitches per beat (0 idle: needle up, presser foot up).  The needle bottom lands ON the beat.
//   run    0..1            how much of a 24-stitch seam exists (fabric feeds, one stitch per down-stroke).  Pure function of run.
//                          If run is given the needle, wheel, foot and feed are locked to it (x = run * 24 stitches); if not, they follow c2.beat * needle.
//   lamp   0..1            the lamp (default 0.5): bulb glow, warm pool on the fabric, and the `machine` light preset
//   spoon  0..1            Pip's spoon comes in to the can of beans (0 = away).  With u.mode === 'spoon' it follows u.p.
//   wide   1               light preset: keep the wide mall readable (bigger shadow box)
// Rigs (world coordinates, all pure functions of u): needleCU  threadPath  wheelSpin  stitchRun  machinePush  burstLow  clickCU  overTheShoulder  beansCU  beansSpoon  hero
//   `p` = moves on u.p (shot progress, any duration), `t` = moves on u.t (fixed speed); each rig says which below.
// Anchors: ext.anchors = { needle:[x,y,z] world tip when down, eye, fabric, spool, wheel, lamp, beans:{x,y,z,rotY}, toWorld(x,y,z) }  (machine-local: x right, y up, z toward the mall, units before the 1.15 scale)
// Light preset: ext.light(kit, u, c2) = the `machine` preset (cold dim ambience, warm lamp pool, pink bounce from the spool; spots 0..2, point 0, key with a tight shadow box).
// Frame cost: 173 meshes (4 instanced, most tiny), about 35k triangles, about 2 ms of JS per frame; about +220 draw calls with the shadow pass (measured on the mall's machineCU rig: 465 -> 684).
// Take-over: the crude needle, needle bar and presser foot that props.js puts in the machine (children 4..6) are hidden and replaced by animated ones; spokes and a knob are added to the mall's handwheel.
import * as THREE from 'three';
import { add, makePinCushion, makeScissors, makePin } from '../chars.js';
import { stitchify } from '../stitch.js';
import { glowSprite, starSprite } from '../set.js';
import { makeThreadLine, makeBeansCan } from '../gags.js';
import { clamp, lerp, smooth, smoother, hash } from '../util.js';
const PI = Math.PI, TAU = Math.PI * 2;

// ---- the geometry of the seam: one stitch per needle cycle
const N_STITCH = 24, L_ST = 0.03;                 // a full run is 24 stitches, 3 cm (machine-local units) apart
const Y_UP = 0.187, Y_DN = 0.098;                 // needle tip height at the top and bottom of the stroke (machine-local)
const Y_FAB = 0.106, TH = 0.012;                  // fabric bottom and thickness
const NX = -0.31;                                 // needle x
const benchY = (x) => 0.0078 + 0.06 * x;          // the tilted bench top under the machine, in machine-local units

function withK(M, K, fn) { const pk = M.currentK, ps = M.sew; M.currentK = K; M.sew = false; try { return fn(); } finally { M.currentK = pk; M.sew = ps; } }
const ALIVE = () => ({ value: 1 });
function roundSlab(w, d, t, r, bev = 0.0015) {           // a rounded-rectangle slab lying flat: x = w, z = d, y from 0 to t
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, t - 2 * bev), bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 8 });
  geo.rotateX(-PI / 2); geo.translate(0, bev, 0); return geo;
}
function canvasTex(w, h, paint, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  paint(c.getContext('2d'), w, h); tex.needsUpdate = true; return tex;
}
const easeOutBack = (x, k = 2.0) => { x = clamp(x) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };

export function build(ctx, mall) {
  const { M, root, THREE: _T } = ctx; void _T;
  const machine = mall.anchors.machine, mroot = mall.root ?? root.parent;
  mroot.updateMatrixWorld(true); root.updateMatrixWorld(true);
  // ---- machine-local group: everything below is placed in the machine's own frame (x right, y up, z toward the mall)
  const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(machine.matrixWorld);
  const L = new THREE.Group(); L.name = 'machineDetail'; rel.decompose(L.position, L.quaternion, L.scale); root.add(L);
  const mw = machine.matrixWorld.clone();
  const toWorld = (x, y, z) => { const v = new THREE.Vector3(x, y, z).applyMatrix4(mw); return [v.x, v.y, v.z]; };
  const dirWorld = (x, y, z) => { const v = new THREE.Vector3(x, y, z).transformDirection(mw); return v; };
  const ch = machine.children;

  // ---- take over the crude needle, needle bar and presser foot of makeMachine (buried in the base): hide them, build proper ones
  const isCyl = (o, r) => o && o.geometry && o.geometry.parameters && Math.abs((o.geometry.parameters.radiusTop ?? 0) - r) < 1e-4;
  const origBar = isCyl(ch[4], 0.008) ? ch[4] : null, origNeedle = mall.anchors.needle ?? ch[5], origFoot = ch[6] && ch[6].geometry && ch[6].geometry.type === 'BoxGeometry' ? ch[6] : null;
  [origBar, origNeedle, origFoot].forEach((o) => { if (o) o.visible = false; });
  const wheel = mall.anchors.wheel ?? ch[7];

  const steel = withK(M, ALIVE(), () => M.metal(0xe6ecf4)), steelD = withK(M, ALIVE(), () => M.metal(0xaeb6c4)), gold = withK(M, ALIVE(), () => M.plastic(0xffd45e, { rough: 0.22 })), pinkP = withK(M, ALIVE(), () => M.plastic(0xff6fae, { rough: 0.3 })), creamP = withK(M, ALIVE(), () => M.plastic(0xfff2e4, { rough: 0.35 }));
  const mk = (parent, geo, mat, o = {}) => { const m = add(parent, geo, mat, o); m.castShadow = o.cast ?? true; return m; };

  // ---------------------------------------------------------------- needle assembly (animated)
  const needleG = new THREE.Group(); needleG.position.set(NX, Y_UP, 0); L.add(needleG);                 // origin = the needle tip
  const nProf = [[0.0002, 0], [0.0028, 0.012], [0.0038, 0.04], [0.0046, 0.07], [0.0066, 0.078], [0.0066, 0.11]].map((p) => new THREE.Vector2(p[0], p[1]));
  mk(needleG, new THREE.LatheGeometry(nProf, 10), steel);
  mk(needleG, new THREE.TorusGeometry(0.0031, 0.0011, 6, 12), steelD, { y: 0.017, cast: false });             // the eye, facing the camera
  mk(needleG, new THREE.CylinderGeometry(0.0115, 0.0115, 0.02, 14), gold, { y: 0.1 });                            // clamp
  mk(needleG, new THREE.SphereGeometry(0.0055, 10, 8), steelD, { y: 0.1, z: 0.0115, sz: 0.6 });
  mk(needleG, new THREE.TorusGeometry(0.0085, 0.0018, 6, 14), steelD, { y: 0.128, rx: PI / 2, cast: false });        // thread guide ring on the bar
  const barG = new THREE.CylinderGeometry(0.0075, 0.0075, 1, 12); const bar = mk(L, barG, steel); bar.position.x = NX;
  // presser foot: a small gold sled, two rails around a slot for the needle, an upturned toe, a heel bridge and the shank up into the head
  const foot = new THREE.Group(); L.add(foot);
  for (const s of [-1, 1]) { mk(foot, new THREE.BoxGeometry(0.046, 0.005, 0.0085), gold, { x: NX + 0.003, y: 0.0025, z: s * 0.0125, cast: false }); mk(foot, new THREE.BoxGeometry(0.014, 0.005, 0.0085), gold, { x: NX + 0.03, y: 0.0062, z: s * 0.0125, rz: 0.55, cast: false }); }
  mk(foot, new THREE.BoxGeometry(0.009, 0.007, 0.033), gold, { x: NX - 0.02, y: 0.0045, cast: false });
  const shank = mk(foot, new THREE.CylinderGeometry(0.0045, 0.0045, 1, 10), steel, { x: NX - 0.02, cast: false });
  const shankG = shank;   // scaled each frame

  // ---------------------------------------------------------------- the fixed detail of the head: faceplate, tension dial, take-up lever, screws, guides
  mk(L, roundSlab(0.15, 0.2, 0.005, 0.02, 0.002).rotateX(PI / 2).translate(0, 0, 0.0), gold, { x: -0.3, y: 0.44, z: 0.135, sx: 1, cast: false });   // faceplate (slab turned to face +z)
  const dial = mk(L, new THREE.CylinderGeometry(0.026, 0.026, 0.014, 22), pinkP, { x: -0.285, y: 0.505, z: 0.152, rx: PI / 2 });
  mk(L, new THREE.BoxGeometry(0.004, 0.02, 0.003), steelD, { x: -0.285, y: 0.505, z: 0.16, cast: false });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; mk(L, new THREE.BoxGeometry(0.0022, 0.005, 0.0016), creamP, { x: -0.285 + Math.cos(a) * 0.0225, y: 0.505 + Math.sin(a) * 0.0225, z: 0.1595, rz: a - PI / 2, cast: false }); }
  mk(L, new THREE.BoxGeometry(0.015, 0.1, 0.004), withK(M, ALIVE(), () => M.ink(0x40203a)), { x: -0.365, y: 0.44, z: 0.1385, cast: false });                       // take-up slot
  const tul = new THREE.Group(); L.add(tul);
  mk(tul, new THREE.BoxGeometry(0.03, 0.012, 0.012), steel, { x: 0.006, cast: false }); mk(tul, new THREE.TorusGeometry(0.0055, 0.0019, 6, 12), steelD, { x: 0.024, cast: false });
  tul.position.set(-0.365, 0.46, 0.146);
  for (const [x, y, z] of [[-0.362, 0.535, 0.1385], [-0.238, 0.535, 0.1385], [-0.362, 0.345, 0.1385], [-0.238, 0.345, 0.1385]]) {
    mk(L, new THREE.CylinderGeometry(0.0075, 0.0075, 0.005, 12), gold, { x, y, z: z + 0.001, rx: PI / 2, cast: false });
    mk(L, new THREE.BoxGeometry(0.011, 0.0018, 0.001), steelD, { x, y, z: z + 0.0038, rz: hash(x * 91 + y * 7) * 3, cast: false });
  }
  for (const [x, y] of [[0.26, 0.15], [0.31, 0.15], [0.26, 0.5]]) { mk(L, new THREE.CylinderGeometry(0.0085, 0.0085, 0.005, 12), gold, { x, y, z: 0.1445, rx: PI / 2, cast: false }); }
  // stitch-length dial on the pillar (P2) and a tiny window
  mk(L, new THREE.CylinderGeometry(0.024, 0.024, 0.012, 20), gold, { x: 0.28, y: 0.27, z: 0.148, rx: PI / 2 });
  mk(L, new THREE.CylinderGeometry(0.017, 0.017, 0.006, 20), creamP, { x: 0.28, y: 0.27, z: 0.155, rx: PI / 2, cast: false });
  mk(L, new THREE.BoxGeometry(0.004, 0.02, 0.003), pinkP, { x: 0.28, y: 0.275, z: 0.1595, rz: 0.7, cast: false });
  // thread guides on the arm and the spool cap
  mk(L, new THREE.CylinderGeometry(0.0055, 0.0055, 0.05, 8), steel, { x: -0.13, y: 0.64, cast: false });
  mk(L, new THREE.TorusGeometry(0.0115, 0.002, 6, 14), gold, { x: -0.13, y: 0.668, rx: PI / 2, rz: 0, cast: false });
  mk(L, new THREE.TorusGeometry(0.0075, 0.0018, 6, 12), gold, { x: -0.34, y: 0.548, z: 0.152, cast: false });
  mk(L, new THREE.SphereGeometry(0.014, 12, 8), gold, { x: 0.02, y: 0.788, sy: 0.6, cast: false });

  // ---------------------------------------------------------------- the throat plate, feed dogs, and the sewing extension table
  const plateM = withK(M, ALIVE(), () => M.metal(0xf1f4fa));
  mk(L, roundSlab(0.2, 0.14, 0.004, 0.02), plateM, { x: NX, y: 0.102, cast: false });
  mk(L, new THREE.CylinderGeometry(0.0065, 0.0065, 0.001, 14), withK(M, ALIVE(), () => M.ink(0x2b1a3a)), { x: NX, y: 0.1065, cast: false });
  const dogs = new THREE.Group(); dogs.position.set(NX, 0.1045, 0); L.add(dogs);
  for (const z of [-0.032, 0.032]) { const bar2 = mk(dogs, new THREE.BoxGeometry(0.06, 0.003, 0.009), steelD, { z, cast: false }); for (let i = -3; i <= 3; i++) mk(dogs, new THREE.BoxGeometry(0.004, 0.003, 0.009), steelD, { x: i * 0.0085, y: 0.0028, z, cast: false }); void bar2; }
  const tableM = withK(M, ALIVE(), () => M.plastic(0xb6ffd6, { rough: 0.3 })), tX0 = -0.402, tX1 = -1.0, tW = tX0 - tX1;
  mk(L, roundSlab(tW, 0.36, 0.03, 0.03, 0.004), tableM, { x: (tX0 + tX1) / 2, y: 0.072 });
  for (const z of [-0.12, 0.12]) mk(L, new THREE.CylinderGeometry(0.026, 0.03, 0.12, 14), pinkP, { x: -0.93, y: benchY(-0.93) + 0.06 + 0.002, z });
  // running stitches around the table's top edge (cream), and its little feet
  { const pts = []; const hw = tW / 2 - 0.022, hd = 0.18 - 0.022, cx = (tX0 + tX1) / 2, n = 44; const sg = new THREE.CapsuleGeometry(0.0032, 0.016, 2, 4); sg.rotateZ(PI / 2);
    const im = new THREE.InstancedMesh(sg, withK(M, ALIVE(), () => M.thread(0xfff4e0)), n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
    const per = 2 * (2 * hw + 2 * hd);
    for (let i = 0; i < n; i++) { let d = (i + 0.5) / n * per, x, z, ang; const a1 = 2 * hw, a2 = a1 + 2 * hd, a3 = a2 + 2 * hw;
      if (d < a1) { x = -hw + d; z = -hd; ang = 0; } else if (d < a2) { x = hw; z = -hd + (d - a1); ang = -PI / 2; } else if (d < a3) { x = hw - (d - a2); z = hd; ang = PI; } else { x = -hw; z = hd - (d - a3); ang = PI / 2; }
      q.setFromAxisAngle(up, ang); P0.set(cx + x, 0.1035, z); m4.compose(P0, q, s1); im.setMatrixAt(i, m4); }
    im.castShadow = false; L.add(im); void pts; }

  // ---------------------------------------------------------------- the strip of pastel felt fabric: a fixed ribbon, its print scrolls with the feed
  const STRIP = { x0: 0.30, xe: -0.965, rb: 0.035, ym: Y_FAB + TH / 2 + 0.0005, w: 0.17, dropLen: 0.15 };
  const sFlat = STRIP.x0 - STRIP.xe, sArc = PI / 2 * STRIP.rb, sTot = sFlat + sArc + STRIP.dropLen, sNeedle = STRIP.x0 - NX;
  const strip = (s, out = {}) => {
    if (s <= sFlat) { out.x = STRIP.x0 - s; out.y = STRIP.ym; out.tx = -1; out.ty = 0; out.nx = 0; out.ny = 1; }
    else if (s <= sFlat + sArc) { const f = (s - sFlat) / STRIP.rb; out.x = STRIP.xe - STRIP.rb * Math.sin(f); out.y = STRIP.ym - STRIP.rb + STRIP.rb * Math.cos(f); out.tx = -Math.cos(f); out.ty = -Math.sin(f); out.nx = -Math.sin(f); out.ny = Math.cos(f); }
    else { const d = s - sFlat - sArc; out.x = STRIP.xe - STRIP.rb; out.y = STRIP.ym - STRIP.rb - d; out.tx = 0; out.ty = -1; out.nx = -1; out.ny = 0; }
    return out;
  };
  const stripTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#a8e6ff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.10)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 6, h);
    g.fillStyle = '#fff4e0'; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const x = i * 128 + 64 + (j % 2) * 40 - 20, y = 42 + j * 86; g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill(); }
    g.fillStyle = '#ffd6e8'; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const x = i * 128 + 14 + (j % 2) * 40 + 20, y = 85 + j * 86; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
    g.strokeStyle = '#fff4e0'; g.lineWidth = 5; g.setLineDash([14, 10]); for (const y of [12, h - 12]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }, true);
  const TILE = 0.25; stripTex.repeat.set(sTot / TILE, 1);
  {
    const NJ = 110, prof = [[-1, 0.5, 0], [-0.5, 0.5, 0.0018], [0, 0.5, 0.0026], [0.5, 0.5, 0.0018], [1, 0.5, 0], [1, 0.12, 0], [1, -0.5, 0], [0, -0.5, 0], [-1, -0.5, 0], [-1, 0.12, 0]];      // [z/(w/2), +-th/2, puff]
    const PN = prof.length, pos = [], uv = [], idx = [], tmp = {};
    for (let j = 0; j <= NJ; j++) {
      const s = (j / NJ) * sTot; strip(s, tmp);
      for (let p = 0; p < PN; p++) { const [zz, hh, puff] = prof[p], off = hh * TH + (hh > 0 ? puff : 0), top = p < 5; pos.push(tmp.x + tmp.nx * off, tmp.y + tmp.ny * off, zz * STRIP.w / 2); uv.push(s / sTot, top ? (zz + 1) / 2 : (zz > 0 ? 1 : 0)); }
    }
    for (let j = 0; j < NJ; j++) for (let p = 0; p < PN; p++) { const a = j * PN + p, b = j * PN + (p + 1) % PN, c = (j + 1) * PN + p, d = (j + 1) * PN + (p + 1) % PN; idx.push(a, b, c, b, d, c); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const fm = withK(M, ALIVE(), () => { const m = new THREE.MeshStandardMaterial({ map: stripTex, roughness: 1, side: THREE.DoubleSide, bumpMap: M.fabricTex(30), bumpScale: 2.0 }); return stitchify(m, M.currentK, false); });
    const fab = new THREE.Mesh(geo, fm); fab.castShadow = true; fab.receiveShadow = true; L.add(fab);
  }
  // running stitches on the fabric: 40 instances, pure function of the feed
  const dashG = new THREE.CapsuleGeometry(0.0055, 0.022, 2, 6); dashG.rotateZ(PI / 2);
  const dashM = withK(M, ALIVE(), () => M.thread(0xff5fa8)); dashM.emissive.set(0xff5fa8); dashM.emissiveIntensity = 0.85;
  const NDASH = 40, dashes = new THREE.InstancedMesh(dashG, dashM, NDASH); dashes.frustumCulled = false; dashes.castShadow = false; L.add(dashes);
  const dm4 = new THREE.Matrix4(), dq = new THREE.Quaternion(), dp = new THREE.Vector3(), ds = new THREE.Vector3(), dX = new THREE.Vector3(), dY = new THREE.Vector3(), dZ = new THREE.Vector3(), st = {};
  // the thread: spool -> guide -> faceplate guide -> tension dial -> take-up eye -> bar guide -> needle eye -> the fabric
  const thread = makeThreadLine(M, { segments: 72, radius: 0.0027, color: 0xff5fa8, glow: 0.85, sides: 5 }); L.add(thread.obj);
  const tp = Array.from({ length: 10 }, () => new THREE.Vector3());
  tp[0].set(-0.027, 0.735, 0.0); tp[1].set(-0.13, 0.668, 0.0); tp[2].set(-0.31, 0.6, 0.085); tp[3].set(-0.34, 0.548, 0.156); tp[4].set(-0.285, 0.5, 0.162);
  // 5: take-up eye, 6: bar guide, 7: needle eye, 8: fabric hole, 9: last stitch

  // ---------------------------------------------------------------- the handwheel: spokes, hub and a knob so the turning reads
  if (wheel) {
    const wk = (geo, mat, o) => { const m = add(wheel, geo, mat, o); m.castShadow = false; return m; };
    wk(new THREE.CylinderGeometry(0.022, 0.022, 0.024, 16), gold, { rx: PI / 2 });
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4; wk(new THREE.BoxGeometry(0.066, 0.012, 0.008), creamP, { x: Math.cos(a) * 0.045, y: Math.sin(a) * 0.045, rz: a }); }
    wk(new THREE.SphereGeometry(0.011, 12, 8), pinkP, { x: 0.0, y: 0.06, z: 0.018 });
    wk(new THREE.SphereGeometry(0.006, 10, 8), creamP, { x: 0.058, y: 0.0, z: 0.0 });
    wk(new THREE.TorusGeometry(0.06, 0.004, 6, 24), pinkP, { z: 0.004 });
  }

  // ---------------------------------------------------------------- the lamp: glow sprite + a warm pool on the fabric
  const lampPos = new THREE.Vector3(-0.1, 0.4, 0.1);
  const glowTex = glowSprite(96);
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); lampGlow.position.copy(lampPos); lampGlow.scale.setScalar(0.15); L.add(lampGlow);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffc98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.34), poolMat); pool.rotation.x = -PI / 2; pool.position.set(-0.27, 0.1215, 0.03); pool.renderOrder = 3; L.add(pool);
  const spoolGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6fae, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); spoolGlow.position.set(0.02, 0.7, 0.0); spoolGlow.scale.setScalar(0.24); L.add(spoolGlow);
  // dust in the lamp cone (P3): a handful of motes that drift, pure function of time
  const motes = []; for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe6b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); s.scale.setScalar(0.006 + hash(i) * 0.008); L.add(s); motes.push(s); }

  // ---------------------------------------------------------------- the sewing kit on the bench, table and fabric (world-obeying: grey in the dead mall)
  const kit = new THREE.Group(); L.add(kit);
  withK(M, null, () => {
    const pc = makePinCushion(M); pc.scale.setScalar(1.3); pc.position.set(-0.66, 0.102 + 0.03, 0.115); pc.rotation.y = 0.4; kit.add(pc);
    const sc = makeScissors(M); sc.scale.setScalar(0.85); sc.rotation.set(-PI / 2, 0, PI / 2 + 0.25); sc.position.set(-0.12, benchY(-0.12) + 0.016, 0.255); kit.add(sc);
    for (let i = 0; i < 7; i++) { const p = makePin(M, [0xff5fa8, 0xffe066, 0x66e0ff, 0xb388ff][i % 4]); p.scale.setScalar(1.25); p.rotation.set(-PI / 2 + (hash(i) - 0.5) * 0.3, 0, hash(i + 8) * PI); p.position.set(0.02 + i * 0.045 + hash(i + 3) * 0.02, benchY(0.1) + 0.006, 0.245 + (hash(i + 5) - 0.5) * 0.04); kit.add(p); }
    // two pins stuck into the fabric on the table
    for (let i = 0; i < 2; i++) { const p = makePin(M, i ? 0xffe066 : 0x66e0ff); p.scale.setScalar(1.3); p.rotation.set(0.35, 0, 0.2 - i * 0.5); p.position.set(-0.55 - i * 0.18, 0.118, 0.07 + i * 0.01); kit.add(p); }
    // bobbin lying on the bench, and a little spool of cream thread
    const bob = new THREE.Group(); mk(bob, new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), steel, { y: 0.024 }); mk(bob, new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), steel, { y: -0.024 }); mk(bob, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 20), withK(M, ALIVE(), () => M.cloth(0xff5fa8, { rep: 8 })), {});
    bob.rotation.z = PI / 2; bob.position.set(0.36, benchY(0.36) + 0.03, 0.235); bob.rotation.x = 0.3; kit.add(bob);
    const sp2 = new THREE.Group(); mk(sp2, new THREE.CylinderGeometry(0.03, 0.03, 0.008, 18), M.plastic(0xd9a7ff), { y: 0.028 }); mk(sp2, new THREE.CylinderGeometry(0.03, 0.03, 0.008, 18), M.plastic(0xd9a7ff), { y: -0.028 }); mk(sp2, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 18), M.cloth(0xfff4e0, { rep: 8 }), {});
    sp2.position.set(-0.83, 0.102 + 0.036, 0.11); kit.add(sp2);
    // yellow tape measure: a coiled roll with a tail lying out
    const tape = new THREE.Group(); mk(tape, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 26), M.matte(0xffd83a), { y: 0.016 }); mk(tape, new THREE.CylinderGeometry(0.02, 0.02, 0.032, 16), M.plastic(0xff9ecb), { y: 0.016 });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.0035, 0.026), M.matte(0xffd83a)); tail.position.set(0.12, 0.004, 0.02); tail.rotation.y = -0.15; tail.castShadow = true; tape.add(tail);
    tape.position.set(0.62, benchY(0.62) + 0.002, 0.2); tape.rotation.y = 0.5; kit.add(tape);
    // thread scraps and curls
    const curl = (x, y, z, col, r, turns, rot) => { const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * turns * TAU; pts.push(new THREE.Vector3(Math.cos(a) * r * (1 - i / 34), Math.sin(a * 0.5) * 0.004 + i * 0.0006, Math.sin(a) * r * (1 - i / 34))); }
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0032, 5, false), withK(M, ALIVE(), () => M.thread(col))); m.position.set(x, y, z); m.rotation.y = rot; m.castShadow = true; kit.add(m); };
    curl(-0.42, 0.13, 0.135, 0xff5fa8, 0.03, 2.2, 0.3); curl(-0.78, 0.116, -0.12, 0xfff4e0, 0.024, 1.6, 1.2); curl(0.16, benchY(0.16) + 0.004, 0.2, 0xff8a6a, 0.026, 1.9, 0.7); curl(-0.32, benchY(-0.32) + 0.004, 0.27, 0xff5fa8, 0.02, 1.5, 2.0);
    // a doily under the machine (scalloped, oval)
    const dg = new THREE.CylinderGeometry(0.5, 0.5, 0.003, 64), dPos = dg.attributes.position; for (let i = 0; i < dPos.count; i++) { const x = dPos.getX(i), z = dPos.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z), sc2 = r > 0.4 ? 1 + 0.045 * Math.cos(a * 18) : 1; dPos.setXYZ(i, x * sc2, dPos.getY(i), z * sc2); } dg.computeVertexNormals();
    const doily = new THREE.Mesh(dg, M.cloth(0xfff8ec, { rep: 10 })); doily.scale.set(1.15, 1, 0.6); doily.position.set(0.0, benchY(0) - 0.0112, 0.0); doily.receiveShadow = true; kit.add(doily);
    // brass-screw feet and a tiny mug of pins at the back right
    const mug = new THREE.Group(); mk(mug, new THREE.CylinderGeometry(0.035, 0.03, 0.06, 20, 1, true), M.plastic(0xffb6d5, { rough: 0.3 }), { y: 0.03 }); mk(mug, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 20), M.plastic(0xffb6d5), { y: 0.002 });
    for (let i = 0; i < 9; i++) { const p = makePin(M, [0xff5fa8, 0xffe066, 0x66e0ff, 0xffffff][i % 4]); p.scale.setScalar(1.1); const a = i * 0.7; p.position.set(Math.cos(a) * 0.012, 0.055, Math.sin(a) * 0.012); p.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); mug.add(p); }
    mug.position.set(0.5, benchY(0.5) + 0.003, -0.15); kit.add(mug);
  });

  // ---------------------------------------------------------------- the last can of beans and Pip's spoon (world scale, not in the machine frame)
  const beansLocal = [0.7, benchY(0.7) + 0.0, 0.04];
  const bw = toWorld(...beansLocal); const bench = mall.anchors.barricade ?? machine.parent;
  const canRotY = (bench && bench.rotation ? bench.rotation.y : 0.5) - 0.28;
  const can = makeBeansCan(M, { spoon: true, note: true }); can.position.set(bw[0], bw[1] + 0.001, bw[2]); can.rotation.y = canRotY; root.add(can);
  const spoon = can.userData.spoon; can.remove(spoon); root.add(spoon); spoon.visible = false;
  // Pip's hand and forearm that hold the spoon (always alive)
  const hand = new THREE.Group();
  withK(M, ALIVE(), () => { const skin = M.skin(0xf2bb95); mk(hand, new THREE.CapsuleGeometry(0.03, 0.34, 4, 12), skin, { y: 0.24, rx: 0 }); mk(hand, new THREE.CylinderGeometry(0.037, 0.037, 0.035, 20), M.cloth(0xfff3fa), { y: 0.075 }); mk(hand, new THREE.SphereGeometry(0.046, 20, 14), skin, { y: 0.0, sy: 1.05 }); mk(hand, new THREE.SphereGeometry(0.034, 16, 12), M.satin(0xff2f86), { y: 0.42, sy: 1.0 }); });
  spoon.add(hand); hand.position.set(0, 0.02, -0.235); hand.rotation.set(PI / 2, 0, 0);          // the handle end sits in her mitt; the forearm extends back out of frame
  const canFront = new THREE.Vector3(Math.sin(canRotY), 0, Math.cos(canRotY)), canRight = new THREE.Vector3(canFront.z, 0, -canFront.x);
  const beansW = { x: bw[0], y: bw[1], z: bw[2], rotY: canRotY };

  // ---------------------------------------------------------------- per-frame animation
  const dumMat = new THREE.Matrix4();
  function state(u, c2) {
    const a = c2.args || {}, rate = a.needle ?? 0, hasRun = a.run !== undefined && a.run !== null && !Number.isNaN(+a.run);
    let x, idle = false;
    if (rate > 0) x = hasRun ? clamp(+a.run, 0, 1e6) * N_STITCH : (c2.beat ?? 0) * rate + (a.phase0 ?? 0);
    else { idle = true; x = (hasRun ? Math.floor(clamp(+a.run, 0, 1e6) * N_STITCH + 1e-6) : 0) + 0.9; }
    const K = Math.max(0, Math.floor(x + 1e-6)), fr = x - Math.floor(x + 1e-6);
    const F = K + smooth((fr - 0.2) / 0.6);                                     // the feed: fabric moves while the needle is up
    const h = idle ? 1 : (1 + Math.cos(TAU * x)) / 2;                             // 1 = needle at the top, 0 = at the bottom (on the integers)
    return { x, K, fr, F, h, idle, lamp: a.lamp ?? 0.5, spoon: a.spoon ?? (u.mode === 'spoon' ? u.p : 0), rate };
  }
  const TUL_LO = 0.428, TUL_HI = 0.49;
  function update(u, c2) {
    const S = state(u, c2), tim = c2.t ?? u.t ?? 0;
    // needle, bar, foot
    const tipY = lerp(Y_DN, Y_UP, S.h) + (S.idle ? 0.012 : 0);
    needleG.position.y = tipY;
    const clampTop = tipY + 0.11, barTop = 0.345; bar.scale.y = Math.max(0.001, barTop - clampTop); bar.position.y = clampTop + bar.scale.y / 2;
    const lift = S.idle ? 0.03 : 0.012 * smooth((S.h - 0.45) / 0.55);
    foot.position.y = Y_FAB + TH + 0.0005 + lift;
    shankG.scale.y = Math.max(0.001, 0.335 - (foot.position.y + 0.006)); shankG.position.y = 0.006 + shankG.scale.y / 2;
    dogs.position.y = 0.1045 + (S.idle ? 0 : 0.0075 * smooth((S.fr - 0.15) / 0.1) * (1 - smooth((S.fr - 0.85) / 0.1)));
    tul.position.y = lerp(TUL_LO, TUL_HI, S.idle ? 1 : (1 + Math.cos(TAU * S.x + 0.9)) / 2);
    if (wheel) wheel.rotation.z = S.idle ? (wheel.rotation.z || 0) * 0 + 0.6 * S.K : TAU * S.x;
    // the thread follows the moving parts
    tp[5].set(-0.365 + 0.024, tul.position.y, 0.152); tp[6].set(NX - 0.0075, tipY + 0.128, 0.0105); tp[7].set(NX - 0.0024, tipY + 0.024, 0.0042); tp[8].set(NX - 0.003, Y_FAB + TH + 0.002, 0.0026); tp[9].copy(tp[8]).add(new THREE.Vector3(-0.012, -0.001, 0.004));
    thread.set(tp, 1, tim);
    // the fabric print scrolls; the stitches slide with it
    stripTex.offset.x = -(S.F * L_ST) / TILE * (TILE / sTot) * (sTot / TILE);
    const first = Math.max(1, S.K - NDASH + 1); let cnt = 0;
    for (let k = first; k <= S.K && cnt < NDASH; k++) {
      const s = sNeedle + (S.F - k) * L_ST + 0.5 * L_ST; if (s > sTot - 0.02) continue;
      strip(s, st);
      const kk = k === S.K && !S.idle ? clamp(S.fr / 0.16) : 1, g = kk < 1 ? easeOutBack(kk, 2.4) : 1;
      dX.set(st.tx, st.ty, 0).normalize(); dY.set(st.nx, st.ny, 0).normalize(); dZ.crossVectors(dX, dY);
      dm4.makeBasis(dX, dY, dZ); dq.setFromRotationMatrix(dm4);
      const topOff = TH / 2 + 0.0036; dp.set(st.x + st.nx * topOff, st.y + st.ny * topOff, 0.0);
      ds.set(g, g, g); dm4.compose(dp, dq, ds); dashes.setMatrixAt(cnt++, dm4);
    }
    dashes.count = cnt; dashes.instanceMatrix.needsUpdate = true;
    // lamp
    const lam = clamp(S.lamp);
    lampGlow.material.opacity = 0.9 * lam; lampGlow.scale.setScalar(0.12 + 0.07 * lam);
    poolMat.opacity = 0.38 * lam; spoolGlow.material.opacity = 0.28 * (0.6 + 0.4 * lam);
    motes.forEach((s, i) => { const k = ((tim * 0.05 + hash(i * 3.1)) % 1); s.position.set(lampPos.x + (hash(i) - 0.5) * 0.16 + Math.sin(tim * 0.6 + i) * 0.01, lerp(0.39, 0.14, k), lampPos.z + (hash(i + 4) - 0.5) * 0.1); s.material.opacity = 0.6 * lam * Math.sin(k * PI); });
    // beans and the spoon
    const sp = clamp(S.spoon); spoon.visible = sp > 0.001;
    if (spoon.visible) {
      const e = smooth(sp), dip = smooth((sp - 0.55) / 0.35);
      const start = new THREE.Vector3(0.62, 0.32, -0.04), end = new THREE.Vector3(0.0, 0.318, 0.0);           // in the can's frame: x = can right, y up, z = can front
      const px = lerp(start.x, end.x + 0.02, e), py = lerp(start.y, end.y + 0.03, e) + 0.07 * Math.sin(e * PI) - 0.04 * dip, pz = lerp(start.z, end.z + 0.03, e);
      const wp = new THREE.Vector3(bw[0], bw[1], bw[2]).addScaledVector(canRight, px).addScaledVector(canFront, pz); wp.y += py - 0.001;
      spoon.position.copy(wp); spoon.rotation.set(0.32 - 0.22 * dip, canRotY + 1.5 - 0.9 * e, 0.0); spoon.rotation.order = 'YXZ';
    }
    void dumMat;
  }

  // ---------------------------------------------------------------- rigs: machine-local points -> world.  `p` = u.p (progress), `t` = u.t (seconds)
  const W = toWorld, look = (x, y, z) => W(x, y, z);
  const tipDown = [NX, Y_DN, 0];
  const rigs = {
    // extreme macro of the needle piercing the fabric; a slow push and a small orbit on p; the post default gives a shallow band of focus
    needleCU: (u) => { const k = u.p; const a = -0.8 + 0.28 * k, d = 0.175 - 0.03 * k; return { pos: W(NX + Math.sin(a) * d, 0.142 + 0.012 * k, Math.cos(a) * d), look: look(NX - 0.006, 0.124, 0.0), fov: 20 }; },
    // follows the thread from the spool to the needle over p (the camera rides beside the moving point on the thread)
    threadPath: (u) => { const k = smooth(u.p); const path = [[-0.027, 0.735, 0.0], [-0.13, 0.668, 0.0], [-0.31, 0.6, 0.085], [-0.34, 0.548, 0.156], [-0.285, 0.5, 0.162], [-0.34, 0.46, 0.152], [NX, 0.3, 0.02], [NX, 0.16, 0.0032]]; const f = k * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), t = f - i; const P = path[i].map((v, j) => lerp(v, path[i + 1][j], smooth(t)));
      return { pos: W(P[0] + 0.1, P[1] + 0.05, P[2] + 0.17), look: look(P[0], P[1], P[2]), fov: 26 }; },
    // the handwheel turns in the foreground: low, from the machine's right side, a slow orbit on p
    wheelSpin: (u) => { const a = 0.15 + 0.35 * u.p; return { pos: W(0.372 + 0.42 * Math.cos(a), 0.47, 0.14 + 0.42 * Math.sin(a) + 0.02), look: look(0.372, 0.5, 0.115), fov: 34 }; },
    // side view of the stitches forming: a dolly that follows the seam (t: fixed speed)
    stitchRun: (u) => { const x = -0.5 - 0.02 * u.t; return { pos: W(x + 0.12, 0.2, 0.6), look: look(x, 0.118, 0.0), fov: 26 }; },
    // slow inevitable push-in from about 4 m to the needle over the whole shot (log-space, slightly accelerating so it never slows down)
    machinePush: (u) => { const e = Math.pow(u.p, 1.3), dist = Math.exp(lerp(Math.log(3.4), Math.log(0.42), e)); const ax = lerp(0.62, -0.1, e), ay = lerp(0.40, 0.2, e), lx = lerp(0.0, NX, smooth(e)), ly = lerp(0.36, 0.14, smooth(e));
      return { pos: W(lx + ax * dist * 0.55, ay + (dist > 1 ? 0.12 * dist : 0.0), 0.02 + dist * 0.85), look: look(lx, ly, 0.0), fov: lerp(34, 22, e) }; },
    // low, beside the machine, looking out over the barricade at the dead mall (the downbeat shot); a tiny push on p
    burstLow: (u) => ({ pos: W(0.52 - 0.05 * u.p, 0.11, 0.42), look: look(-0.5 + 0.03 * u.p, 0.36, 4.2), fov: 38 }),
    // outro: low light, macro on the presser foot clicking (t)
    clickCU: (u) => ({ pos: W(NX + 0.085 - 0.004 * u.t, 0.152, 0.105), look: look(NX - 0.004, 0.122, 0.0), fov: 24 }),
    // from behind Pip's slot toward the machine
    overTheShoulder: (u) => { const sl = mall.slots.machine, f = new THREE.Vector3(Math.sin(sl.rotY), 0, Math.cos(sl.rotY)), r = new THREE.Vector3(f.z, 0, -f.x); const p = new THREE.Vector3(sl.x, 0, sl.z).addScaledVector(f, -0.95 + 0.12 * u.p).addScaledVector(r, -1.5); return { pos: [p.x, 1.9 - 0.08 * u.p, p.z], look: W(-0.02, 0.32, 0.0), fov: 34 }; },
    // the macro of the last can of beans (label and note), a slow push on p
    beansCU: (u) => { const p = new THREE.Vector3(bw[0], bw[1], bw[2]).addScaledVector(canFront, 0.4 - 0.07 * u.p).addScaledVector(canRight, 0.06 - 0.05 * u.p); return { pos: [p.x, bw[1] + 0.17, p.z], look: [bw[0], bw[1] + 0.135, bw[2]], fov: 30 }; },
    // Pip's spoon comes in from the right: same frame, wider, held for the dip
    beansSpoon: (u) => { const p = new THREE.Vector3(bw[0], bw[1], bw[2]).addScaledVector(canFront, 0.62).addScaledVector(canRight, 0.17 - 0.05 * u.p); return { pos: [p.x, bw[1] + 0.3, p.z], look: [bw[0] + canRight.x * 0.12, bw[1] + 0.18, bw[2] + canRight.z * 0.12], fov: 32 }; },
    // a glamour three-quarter of the whole machine
    hero: (u) => ({ pos: W(0.62 - 0.12 * u.p, 0.5, 1.15), look: look(-0.04, 0.34, 0.0), fov: 34 }),
  };

  // ---------------------------------------------------------------- the `machine` light preset (spots 0..2, point 0, key with a tight shadow box)
  const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(k));
  function light(kit2, u, c2) {
    const a = c2.args || {}, lam = clamp(a.lamp ?? 0.5), alive = clamp(c2.alive ?? 0), wide = !!a.wide;
    const N = W(NX, 0.13, 0.0), lp = W(lampPos.x, lampPos.y - 0.02, lampPos.z), sp = W(0.02, 0.72, 0.05), fab = W(-0.3, 0.118, 0.0), head = W(-0.3, 0.42, 0.14);
    const warm = Math.max(lam, alive);
    kit2.setHemi({ sky: mix(0x6f86d0, 0xfff0f6, alive), ground: mix(0x1f2445, 0xd8b0b8, alive), i: lerp(0.4, 0.7, alive) });
    kit2.setKey({ pos: [N[0] + 0.5, N[1] + 1.1, N[2] + 0.75], target: N, color: mix(0x9fb4ff, 0xffdcb4, warm), i: lerp(0.3, 1.0, warm) * (wide ? 1.2 : 1), extent: wide ? 5 : 0.85, near: 0.3, far: wide ? 14 : 5 });
    kit2.setSpot(0, { color: 0xffc27a, i: 3.0 * lam, dist: 3, angle: 0.62, pen: 0.85, decay: 1.0, pos: lp, target: fab });                       // the lamp pool on the fabric and the needle
    kit2.setSpot(1, { color: 0xff5fa8, i: 3.2 * (0.55 + 0.45 * lam), dist: 3, angle: 0.75, pen: 0.9, decay: 1.0, pos: sp, target: head });         // pink bounce from the spool onto the head
    kit2.setSpot(2, { color: 0x8fb4ff, i: lerp(4.0, 1.0, alive), dist: 8, angle: 0.9, pen: 0.9, decay: 0.8, pos: W(-0.9, 0.9, -1.2), target: W(-0.1, 0.3, 0.0) });   // cold rim from the dead mall behind
    kit2.setPoint(0, { color: 0xffd08c, i: 0.9 * lam, dist: 1.5, decay: 1.2, pos: lp });
  }

  const ext = {
    name: 'machine_macro', root, rigs, update, light, slots: {}, post: { band: 0.13, tilt: 6.5, focusY: 0.5, bloom: 0.3 },
    anchors: { needle: W(NX, Y_DN, 0), eye: W(NX, Y_DN + 0.017, 0), fabric: W(NX, Y_FAB + TH, 0), spool: W(0.02, 0.7, 0), wheel: W(0.372, 0.5, 0.14), lamp: W(lampPos.x, lampPos.y, lampPos.z), beans: beansW, toWorld, can, spoon, thread, stitches: dashes },
    // the ext registers its own stitch state for the film: how many stitches exist for a given run
    stitchCount: (run) => Math.floor(clamp(run, 0, 1e6) * N_STITCH + 1e-6),
  };
  update({ t: 0, p: 0, dur: 1, mode: '' }, { args: {}, beat: 0, t: 0 });
  return ext;
}
