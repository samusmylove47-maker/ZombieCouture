// Extension module of the mall: the overhead rosette for chorus 2 ("the whole mall wakes"), Busby Berkeley style.
//   build(ctx, mall) -> ext = { name, root, slots, rigs, rings(n, angle, opt), update(u, c2), light(kit, u, c2), post, anchors }
// A giant embroidered rosette on the floor around the pedestal: a scalloped cream disc, 12 big and 12 small flat pastel felt petals,
// and about 1100 instanced running stitches (coral scallop outline, cream petal outlines, hot pink rose curve, coral mid ring).
// c2.args.draw (0..1, falls back to u.p) draws the stitches on in order along the curves; the petals bloom out of the centre as it goes.
import * as THREE from 'three';
import { starSprite } from '../set.js';
import { stitchify } from '../stitch.js';
import { hash, smooth, smoother, clamp, lerp } from '../util.js';
const PI = Math.PI, TAU = PI * 2;

export function build(ctx, mall) {
  const { M, root } = ctx;
  const A = mall.anchors, C = { x: A.ped.x, z: A.ped.z };
  const G = new THREE.Group(); G.name = 'rosette'; G.position.set(C.x, 0, C.z); root.add(G);
  const R0 = 5.1, NS = 24;                                   // outline radius and number of scallops

  const flatGeo = (shape, seg = 24) => { const g = new THREE.ShapeGeometry(shape, seg); g.rotateX(-PI / 2); return g; };   // lies on the floor: shape (x, y) -> world (x, -z)
  const flatMesh = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.receiveShadow = true; m.castShadow = false; G.add(m); return m; };

  // ---------------------------------------------------------------------------------------------- appliqué under the stitches
  // scalloped base disc
  {
    const s = new THREE.Shape(); s.moveTo(R0, 0);
    for (let i = 0; i < NS; i++) { const a1 = (i + 0.5) * TAU / NS, a2 = (i + 1) * TAU / NS; s.quadraticCurveTo(Math.cos(a1) * (R0 + 0.34), Math.sin(a1) * (R0 + 0.34), Math.cos(a2) * R0, Math.sin(a2) * R0); }
    flatMesh(flatGeo(s, 12), M.matte(0x8a4f9e, { rep: 5 }), 0.010);           // plum ground: the pastel petals and the thread pop against the bright peach floor
    const s2 = new THREE.Shape(); s2.moveTo(R0 - 0.36, 0);   // a coral hem ring just inside the edge
    const hole = new THREE.Path(); hole.absarc(0, 0, R0 - 0.62, 0, TAU, true);
    const ring = new THREE.Shape(); ring.absarc(0, 0, R0 - 0.34, 0, TAU, false); ring.holes.push(hole);
    flatMesh(flatGeo(ring, 64), M.matte(0xffc9a8, { rep: 5 }), 0.012);
  }
  // petals: pointed ovals along +x, instanced around the centre with their own pastel colour
  const petalShape = (r0, r1, w) => {
    const s = new THREE.Shape(), L = r1 - r0; s.moveTo(r0, 0);
    s.bezierCurveTo(r0 + L * 0.12, w * 1.1, r0 + L * 0.72, w * 1.12, r1, 0);
    s.bezierCurveTo(r0 + L * 0.72, -w * 1.12, r0 + L * 0.12, -w * 1.1, r0, 0); return s;
  };
  const pastel = [0xff92c2, 0xc790ff, 0x94ecbc, 0xffe270, 0x8ad6ff, 0xffab8c];
  const NP = 12;
  const bigGeo = flatGeo(petalShape(0.95, 4.55, 0.86)), smallGeo = flatGeo(petalShape(0.9, 3.05, 0.5));
  const bigP = new THREE.InstancedMesh(bigGeo, M.matte(0xffffff, { rep: 5 }), NP), smallP = new THREE.InstancedMesh(smallGeo, M.matte(0xffffff, { rep: 5 }), NP);
  for (const [im, y] of [[bigP, 0.015], [smallP, 0.019]]) { im.position.y = y; im.receiveShadow = true; im.frustumCulled = false; G.add(im); }
  for (let k = 0; k < NP; k++) { bigP.setColorAt(k, new THREE.Color(pastel[k % 6])); smallP.setColorAt(k, new THREE.Color(pastel[(k + 3) % 6]).multiplyScalar(1.0)); }
  // centre disc under the pedestal, with a coral ring
  flatMesh(flatGeo((() => { const s = new THREE.Shape(); s.absarc(0, 0, 1.2, 0, TAU, false); return s; })(), 48), M.matte(0xfff0a6, { rep: 5 }), 0.022);
  flatMesh(flatGeo((() => { const s = new THREE.Shape(); s.absarc(0, 0, 1.2, 0, TAU, false); const h = new THREE.Path(); h.absarc(0, 0, 1.06, 0, TAU, true); s.holes.push(h); return s; })(), 48), M.matte(0xff8a6a, { rep: 5 }), 0.024);

  // ---------------------------------------------------------------------------------------------- stitch paths (2D points in floor coordinates x, z)
  const paths = [];   // { pts:[[x,z]...], color, t0, t1 }   draw window [t0, t1]
  const CORAL = 0xff7a5c, CREAM = 0xfff8ea, HOT = 0xff2f86;
  {   // (a) scalloped outline, one loop, counter-clockwise from +x
    const pts = [];
    for (let i = 0; i < NS; i++) for (let j = 0; j < 16; j++) { const f = j / 16, a = (i + f) * TAU / NS, r = R0 - 0.2 + 0.30 * Math.sin(f * PI); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    pts.push(pts[0]); paths.push({ pts, color: CORAL, t0: 0.0, t1: 0.55, sp: 0.2 });
  }
  for (let k = 0; k < NP; k++) {   // (b) outline of each big petal, base -> tip on one side, tip -> base on the other
    const a = k * TAU / NP, L = 3.6, w = 0.86 - 0.1, out = [], back = [];
    for (let j = 0; j <= 24; j++) { const f = j / 24, x = 0.95 + 0.1 + f * (L - 0.2), ww = w * Math.pow(Math.sin(Math.pow(f, 0.8) * PI), 0.75) * (1 - f * 0.05); out.push([x, ww]); back.push([x, -ww]); }
    const pts = out.concat(back.reverse()).map(([x, y]) => [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y]);
    paths.push({ pts, color: CREAM, t0: 0.18 + 0.42 * k / NP, t1: 0.18 + 0.42 * k / NP + 0.2, sp: 0.19 });
  }
  {   // (c) rose curve r = 2.9 cos(6 theta): twelve petals through the centre; keep the parts outside the centre disc
    const runs = []; let cur = [];
    for (let i = 0; i <= 720; i++) { const th = i / 720 * PI, r = 2.95 * Math.cos(6 * th), x = r * Math.cos(th), y = r * Math.sin(th); if (Math.abs(r) > 1.3) cur.push([x, y]); else if (cur.length) { runs.push(cur); cur = []; } }
    if (cur.length) runs.push(cur);
    runs.sort((p, q) => Math.atan2(p[Math.floor(p.length / 2)][1], p[Math.floor(p.length / 2)][0]) - Math.atan2(q[Math.floor(q.length / 2)][1], q[Math.floor(q.length / 2)][0]));
    runs.forEach((pts, k) => paths.push({ pts, color: HOT, t0: 0.36 + 0.5 * k / runs.length, t1: 0.36 + 0.5 * k / runs.length + 0.16, sp: 0.2 }));
  }
  {   // (d) wavy mid ring in coral over the small petals
    const pts = []; for (let i = 0; i <= 360; i++) { const a = i / 360 * TAU, r = 3.72 + 0.28 * Math.cos(12 * a + PI / 12 * 0); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    paths.push({ pts, color: CORAL, t0: 0.55, t1: 0.86, sp: 0.2 });
  }
  {   // (e) a dashed pink ring hugging the pedestal
    const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU; pts.push([Math.cos(a) * 1.13, Math.sin(a) * 1.13]); }
    paths.push({ pts, color: HOT, t0: 0.86, t1: 1.0, sp: 0.16 });
  }
  {   // (f) a cream dashed ring in the plum band between the wavy ring and the hem
    const pts = []; for (let i = 0; i <= 200; i++) { const a = i / 200 * TAU; pts.push([Math.cos(a) * 4.22, Math.sin(a) * 4.22]); }
    paths.push({ pts, color: CREAM, t0: 0.62, t1: 0.92, sp: 0.25 });
  }
  // sample every path at even spacing -> instances
  const inst = [];   // { x, z, ang, col, t, len }
  for (const p of paths) {
    const cum = [0]; for (let i = 1; i < p.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]));
    const L = cum[cum.length - 1], n = Math.max(2, Math.round(L / p.sp));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n * L; let j = 0; while (j < p.pts.length - 2 && cum[j + 1] < s) j++;
      const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]), a = p.pts[j], b = p.pts[j + 1];
      inst.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), col: p.color, t: p.t0 + (p.t1 - p.t0) * (i + 0.5) / n });
    }
  }
  const NI = inst.length;
  const capsule = new THREE.CapsuleGeometry(0.042, 0.14, 2, 5); capsule.rotateZ(PI / 2);    // long axis -> x, lying on the floor
  const stitches = new THREE.InstancedMesh(capsule, stitchify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })), NI);
  stitches.frustumCulled = false; stitches.castShadow = false; stitches.receiveShadow = false; G.add(stitches);
  inst.forEach((s, i) => stitches.setColorAt(i, new THREE.Color(s.col)));
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Matrix4();
  let lastDraw = -1;
  function setDraw(d) {
    if (Math.abs(d - lastDraw) < 1e-5) return; lastDraw = d;
    for (let i = 0; i < NI; i++) {
      const s = inst[i], k = clamp((d - s.t) / 0.012), e = k < 1 ? k * (1 + 0.3 * (1 - k)) : 1;      // the newest stitch pops with a little overshoot
      qq.setFromAxisAngle(up, -s.ang); pp.set(s.x, 0.038, s.z); const q = e < 0.001 ? 0.0001 : e; sc.set(q * (0.92 + 0.16 * hash(i * 1.3)), q, q);
      m4.compose(pp, qq, sc); stitches.setMatrixAt(i, m4);
    }
    stitches.instanceMatrix.needsUpdate = true;
    // the petals bloom out of the centre as the stitching passes them
    for (let k = 0; k < NP; k++) {
      const gb = smooth(clamp((d - 0.06 - 0.44 * k / NP) / 0.22)), gs = smooth(clamp((d - 0.28 - 0.4 * k / NP) / 0.22));
      let e = 0.5 + 0.5 * gb; qq.setFromAxisAngle(up, -k * TAU / NP); sc.set(e, 1, e); m4.compose(pp.set(0, 0, 0), qq, sc); bigP.setMatrixAt(k, m4);
      e = 0.5 + 0.5 * gs; qq.setFromAxisAngle(up, -(k + 0.5) * TAU / NP); sc.set(e, 1, e); m4.compose(pp.set(0, 0, 0), qq, sc); smallP.setMatrixAt(k, m4);
    }
    bigP.instanceMatrix.needsUpdate = true; smallP.instanceMatrix.needsUpdate = true;
    void tmp;
  }
  setDraw(1);

  // sparkles at the petal tips and scallop nodes, pulsing on the beat once the outline is complete (P3 hook)
  const SP = []; for (let k = 0; k < NP; k++) SP.push([Math.cos(k * TAU / NP) * 4.55, 0.55, Math.sin(k * TAU / NP) * 4.55]); for (let k = 0; k < NS; k += 2) SP.push([Math.cos(k * TAU / NS) * (R0 + 0.15), 0.35, Math.sin(k * TAU / NS) * (R0 + 0.15)]);
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SP.flat()), 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SP.length * 3), 3));
  const sparkle = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.55, map: starSprite(128), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
  sparkle.frustumCulled = false; G.add(sparkle);

  // ---------------------------------------------------------------------------------------------- formation helper
  const RAD = [0, 1.75, 3.3, 4.55], CAP = [1, 6, 12, 18];
  // rings(n, angle, opt): n characters in concentric rings around the pedestal, inner rings first (1, 6, 12, 18).  angle (radians) rotates them;
  // neighbouring rings turn in opposite directions at different speeds.  opt.centre = false leaves the pedestal free (Pip stands on it);
  // opt.face = 'in' (toward the pedestal, default) | 'out' | 'tangent'.
  function rings(n, angle = 0, opt = {}) {
    const centre = opt.centre ?? opt.center ?? (n > 6), face = opt.face ?? 'in', out = [];
    const cnt = [0, 0, 0, 0]; let left = n;
    if (centre && left > 0) { cnt[0] = 1; left--; }
    for (let r = 1; r < 4 && left > 0; r++) { cnt[r] = Math.min(CAP[r], left); left -= cnt[r]; }
    if (left > 0) cnt[3] += left;
    const dir = [0, 1, -1, 1], spd = [0, 1.0, 0.75, 0.55], off = [0, 0, PI / 12, PI / 18];
    for (let r = 0; r < 4; r++) for (let k = 0; k < cnt[r]; k++) {
      const a = (r === 0 ? 0 : off[r] + k * TAU / cnt[r] + dir[r] * spd[r] * angle), x = C.x + Math.cos(a) * RAD[r], z = C.z + Math.sin(a) * RAD[r];
      let rotY; if (r === 0) rotY = angle * 0.5; else if (face === 'out') rotY = Math.atan2(x - C.x, z - C.z); else if (face === 'tangent') rotY = Math.atan2(-Math.sin(a) * dir[r], Math.cos(a) * dir[r]); else rotY = Math.atan2(C.x - x, C.z - z);
      out.push({ x, z, rotY, ring: r, k });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- rigs
  const P = clamp, P3 = (dx, y, dz) => [C.x + dx, y, C.z + dz];
  const rigs = {
    // straight down, slowly turning on u.t (roll about the view axis)
    top: (u) => { const p = P(u.p); return { pos: P3(0, 10.6 - 0.6 * smooth(p), 0.02), look: P3(0, 0, 0), fov: 60, roll: u.t * 0.05 }; },
    // crane, slightly oblique: rises and drifts over the shot
    topTilt: (u) => { const p = P(u.p); return { pos: P3(-2.2 + 4.4 * p, 5.6 + 3.2 * smooth(p), 6.6 - 1.2 * p), look: P3(0, 0.2, -0.3), fov: 46 }; },
    // low across the rings toward the pedestal
    petalLow: (u) => { const p = P(u.p), ph = 0.55 + 0.35 * p; return { pos: P3(Math.sin(ph) * 6.2, 0.85, Math.cos(ph) * 6.2), look: P3(0, 1.25, 0), fov: 48 }; },
    // start and end of a whip-pan: the film interpolates between the two
    whipA: () => ({ pos: P3(-5.4, 1.15, 4.4), look: P3(2.4, 0.95, -1.4), fov: 46 }),
    whipB: () => ({ pos: P3(5.4, 1.05, 4.6), look: P3(-2.6, 0.95, -1.4), fov: 46 }),
  };
  const slots = { center: { x: C.x, y: 0.25, z: C.z, rotY: 0 } };

  // ---------------------------------------------------------------------------------------------- lights: the party colours of mall.js plus a bright pool on the pedestal
  const light = (kit, u, c2) => {
    const pulse = c2.pulse ?? 0, bar = Math.floor(c2.bar ?? 0), k = 0.86 + 0.24 * pulse;
    kit.setKey({ pos: P3(-2.5, 10.5, 5.5), target: P3(0, 0.4, 0), color: 0xfff0e0, i: 1.0, extent: 8.5, near: 1, far: 30 });
    kit.setHemi({ sky: 0xffe8f4, ground: 0xe6b8c8, i: 0.48 });
    kit.setSpot(0, { color: 0xfff4e0, i: 125 * (0.9 + 0.2 * pulse), dist: 30, angle: 0.3, pen: 0.55, decay: 1.2, pos: P3(0.4, 10.6, 0.8), target: P3(0, 0.3, 0) });      // the pool on the pedestal
    kit.setSpot(1, { color: 0xff9ecb, i: 105 * k, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: P3(-9.5, 6.5, -5), target: P3(-0.5, 0.6, 0) });                  // party pink
    kit.setSpot(2, { color: 0x9fe3ff, i: 105 * k, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: P3(8.5, 6.5, -5), target: P3(0.5, 0.6, 0) });                    // party cyan
    kit.setSpot(3, { color: 0xfff0c0, i: 38, dist: 34, angle: 0.8, pen: 0.6, decay: 1.2, pos: P3(0, 9.5, 9.5), target: P3(0, 0.6, 0) });                              // party butter
    kit.setSpot(4, { color: bar % 2 ? 0xff5fa8 : 0xb388ff, i: 70 * k, dist: 30, angle: 0.6, pen: 0.7, decay: 1.2, pos: P3(5.5, 8, 6.5), target: P3(-0.5, 0.5, -0.5) });   // alternates each bar
    kit.setSpot(5, { color: bar % 2 ? 0xb6ffd6 : 0xffe066, i: 60 * k, dist: 30, angle: 0.6, pen: 0.7, decay: 1.2, pos: P3(-5.5, 8, 6.5), target: P3(0.5, 0.5, -0.5) });
    kit.setPoint(0, { color: 0xff7fc0, i: 30 + 18 * pulse, dist: 6, decay: 1.5, pos: P3(0, 0.6, 0) });
    kit.setPoint(1, { color: 0xfff0e0, i: 14, dist: 26, decay: 1.2, pos: P3(0, 8.5, 0) });
  };

  // ---------------------------------------------------------------------------------------------- update
  const col = new THREE.Color();
  const update = (u, c2) => {
    const d = clamp(c2.args?.draw ?? u.p ?? 0);
    setDraw(d);
    const on = smooth(clamp((d - 0.9) / 0.1)), beat = c2.beat ?? 0, ca = spGeo.attributes.color;
    for (let i = 0; i < SP.length; i++) {
      const w = Math.pow(0.5 + 0.5 * Math.sin(beat * PI * 2 + i * 1.7), 3) * on; col.setHSL((i * 0.083) % 1, 0.9, 0.82).multiplyScalar(0.25 + 1.3 * w); ca.setXYZ(i, col.r, col.g, col.b);
    }
    ca.needsUpdate = true; sparkle.visible = on > 0.01;
  };

  mall.slots = mall.slots || {};
  for (const [k, v] of Object.entries(slots)) { const key = k === 'center' ? 'rosetteCenter' : k; if (!(key in mall.slots)) mall.slots[key] = v; mall.slots['mall_rosette.' + k] = v; }

  return { name: 'mall_rosette', root, group: G, slots, rigs, rings, update, light, anchors: { centre: C, radii: RAD, capacity: CAP, outlineRadius: R0 }, post: { band: 0.4, tilt: 1.6, focusY: 0.6 } };
}
