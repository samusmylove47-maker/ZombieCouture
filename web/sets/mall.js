// The mall atrium as a set module: the dead grey mall that gets sewn back into colour.
// Contract (shared by every set module, see docs/FILM.md):
//   build(ctx) -> { name, root, anchors, rigs, slots, update(u, c2), light(kit, u, c2), post }
// World coordinates.  The atrium occupies x in [-23.5, 23.5], z in [-12.5, 24], floor y = 0, ceiling y = 11.4.
import * as THREE from 'three';
import { buildSet, sewnWorld, enclose, beam, sparkles, rng } from '../set.js';
import { makeMachine, dust, makeConfetti } from '../props.js';
import { add, makeBow } from '../chars.js';
const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function build(ctx) {
  const { M, root, FRONT, quality = 'full' } = ctx;
  const S = buildSet(root, M, { W: ctx.W, H: ctx.H, reflect: false });
  sewnWorld(root);
  const shell = enclose(root, M, { ceiling: false });        // the roof is a separate module (mall_roof.js) so it can open
  const set = { name: 'mall', root, S, shell };

  // ---- the hub: the sewing machine on the barricade (always alive, K = 1)
  const machine = makeMachine(M, 1.15); machine.position.set(0.15, 0.99, 0.05); S.barricade.add(machine);
  root.updateMatrixWorld(true);
  const Ow = new THREE.Vector3(); machine.getWorldPosition(Ow);
  const O = { x: Ow.x, y: Ow.y, z: Ow.z };
  // the front travels along u (radial axis, from the machine toward the mall), tn is the lateral axis
  const P1 = { x: -0.9, z: 1.5 }, dP1 = Math.hypot(P1.x - O.x, P1.z - O.z);
  const u = { x: (P1.x - O.x) / dP1, z: (P1.z - O.z) / dP1 }, tn = { x: -u.z, z: u.x };
  const at = (rad, lat) => ({ x: O.x + u.x * rad + tn.x * lat, z: O.z + u.z * rad + tn.z * lat });
  const ang0 = Math.atan2(u.z, u.x);
  const pedW = at(14.4, 0.7); S.ped.position.set(pedW.x, 0, pedW.z);   // the fitting pedestal: centre stage of the finale
  set.anchors = { O, u, tn, at, ang0, ped: pedW, machine, barricade: S.barricade, pedestal: S.ped, needle: machine.userData.needle, wheel: machine.children[7] };

  // ---- ambience: bunting, dust, sparkles, light shafts
  function bunting(a, b, sag, n, cols) {
    const g = new THREE.Group();
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3((a.x + b.x) / 2, Math.min(a.y, b.y) - sag, (a.z + b.z) / 2), b);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 5, false), M.thread(0xfff4e0)));
    for (let i = 1; i < n; i++) {
      const t = i / n, p = curve.getPoint(t);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.0, 0.02, 3), M.cloth(cols[i % cols.length], { rep: 3 })); f.rotation.set(PI / 2, 0, PI); f.scale.set(1, 1, 1.35); f.position.set(p.x, p.y - 0.24, p.z); f.castShadow = true; g.add(f);
    }
    root.add(g);
  }
  const pc = [0xff9ecb, 0xffe066, 0x9fe3ff, 0xd9a7ff, 0xb6ffd6];
  bunting(V(-11.5, 5.0, -4.0), V(6.5, 4.6, -4.6), 1.1, 34, pc);
  bunting(V(-9.0, 4.2, 1.5), V(3.5, 4.3, 0.6), 0.8, 24, pc);
  const dustG = dust(root, quality === 'full' ? 150 : 70, { x0: -10, x1: 14, y0: 0.3, y1: 6.5, z0: -10, z1: 10 }, 5, 0.3);
  const spk = sparkles(root, 16, { x0: -8, x1: 4, y0: 0.9, y1: 3.8, z0: -6, z1: 5, s0: 0.1, s1: 0.26 }, 4);
  const confetti = makeConfetti(root, quality === 'full' ? 520 : 260, { x0: -9, x1: 9, y0: 0, y1: 8, z0: -6, z1: 9 }); confetti.visible = false;
  const beams = [[-1.0, 0.5], [2.6, -2.5], [0.4, -6.5]].map(([x, z]) => beam(root, x, z, 0x9cc0ff, 1.35, 12, [0, 0], 0.13));
  const partyBeams = [beam(root, -3.5, -1.0, 0xff7fc8, 1.2, 12, [0, 0.05], 0.22), beam(root, 1.5, 2.0, 0x8fe8ff, 1.0, 12, [0, -0.05], 0.18), beam(root, 3.5, -2.5, 0xffe27a, 1.1, 12, [0.02, 0], 0.16)];
  partyBeams.forEach((b) => (b.visible = false));
  set.confetti = confetti;

  // ---- named places for the cast (world coordinates; rotY = the direction the character faces, radians about +y, 0 = facing +z)
  const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  set.slots = {
    machine: { ...at(1.05, 0.55), y: 0, rotY: facing(at(1.05, 0.55), O) - 0.5 },      // Pip at the machine
    ped: { x: pedW.x, y: 0.25, z: pedW.z, rotY: 0 },                                   // on the pedestal (centre stage)
  };
  // formations return [{x, z, rotY}] for n characters
  set.formation = {
    // two horseshoe rows around the pedestal opening toward `toward` = {x, z} (the finale camera)
    horseshoe(n, toward = { x: 3.6, z: 9.0 }) {
      const to = Math.atan2(toward.x - pedW.x, toward.z - pedW.z), out = [];
      for (let k = 0; k < n; k++) {
        const inner = k < 8, idx = inner ? k : k - 8, cnt = inner ? Math.min(8, n) : n - 8, rad = inner ? 2.7 : 4.7;
        const a = to + PI + lerp(-1.15, 1.15, (idx + 0.5) / cnt) * (inner ? 1 : 0.95);
        const x = pedW.x + Math.sin(a) * rad, z = pedW.z + Math.cos(a) * rad;
        out.push({ x, z, rotY: Math.atan2(pedW.x - x, pedW.z - z) + PI });
      }
      return out;
    },
    // a line of n along the runway (z decreasing away from camera), spaced `gap` metres
    line(n, from, to) { return Array.from({ length: n }, (_, k) => { const f = n === 1 ? 0 : k / (n - 1); return { x: lerp(from.x, to.x, f), z: lerp(from.z, to.z, f), rotY: Math.atan2(to.x - from.x, to.z - from.z) }; }); },
  };

  // ---- generic rigs (the film builds its own; these exist so the set can be previewed alone)
  set.rigs = {
    wideDead: () => { const p = at(23, 3.5), l = at(1.6, 0.4); return { pos: [p.x, 1.9, p.z], look: [l.x, 1.25, l.z], fov: 30 }; },
    finale: () => ({ pos: [3.6, 2.5, 9.4], look: [pedW.x, 1.3, pedW.z - 0.4], fov: 44 }),
    machineCU: () => { const p = at(2.2, 1.5); return { pos: [p.x, 1.3, p.z], look: [O.x, 1.15, O.z], fov: 32 }; },
  };

  // ---- light mood.  c2.alive 0 = dead grey mall, 1 = everything awake; c2.R = front radius (metres, <0 before ignition); c2.pip = {x, z}; c2.ignited (bool)
  set.light = (kit, uu, c2) => {
    const alive = c2.alive ?? 0, R = c2.R ?? -1, pp = c2.pip ?? at(1.05, 0.55), ignited = c2.ignited ?? R >= 0;
    kit.setKey({ pos: [-3.5, 9, 6], target: [-2, 1, 0.5], color: 0xffe2c4, i: lerp(0.55, 1.85, Math.max(alive, smooth(clamp((R + 1) / 12)) * 0.45)), extent: 13, near: 1, far: 36 });
    kit.setHemi({ sky: new THREE.Color(0xc8d0ff).lerp(new THREE.Color(0xffe8dc), alive), ground: new THREE.Color(0x384070).lerp(new THREE.Color(0xd8b0b8), alive), i: lerp(0.5, 0.58, alive) });
    kit.setSpot(0, { color: 0xffd6a8, i: R >= 0 ? 150 * (1 - alive * 0.55) : 0, dist: 24, angle: 0.62, pen: 0.7, decay: 1.2, pos: [pp.x - u.x * 2.5 + 1.0, 8, pp.z - u.z * 2.5 + 2], target: [pp.x - u.x * 2.2, 0.6, pp.z - u.z * 2.2] });
    kit.setSpot(1, { color: 0x8fb4ff, i: lerp(110, 0, smooth(clamp((alive - 0.2) / 0.6))), dist: 40, angle: 0.9, pen: 0.6, decay: 1.1, pos: [2, 8, 4], target: [-2, 0, -2] });
    kit.setSpot(2, { color: 0xffb98a, i: lerp(45, 0, alive), dist: 30, angle: 0.7, pen: 0.6, decay: 1.2, pos: [O.x + 2, 5, O.z + 3], target: [O.x + u.x * 5, 1, O.z + u.z * 5] });
    const party = smooth(clamp((alive - 0.5) / 0.4));
    kit.setSpot(3, { color: 0xff9ecb, i: 85 * party, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: [-9, 6, -1], target: [-1, 1, 1] });
    kit.setSpot(4, { color: 0x9fe3ff, i: 85 * party, dist: 34, angle: 0.85, pen: 0.6, decay: 1.2, pos: [8, 6, -1], target: [-1, 1, 1] });
    kit.setSpot(5, { color: 0xfff0c0, i: 35 * party, dist: 34, angle: 0.8, pen: 0.6, decay: 1.2, pos: [0, 9, 8], target: [0, 0.8, 0] });
    kit.setPoint(0, { color: 0xffc890, i: ignited ? 14 : 22, dist: 7, decay: 1.6, pos: [O.x + 0.6, 2.4, O.z + 1.4] });
    kit.setPoint(1, { color: 0xffeef8, i: 70 * smooth(clamp((alive - 0.35) / 0.5)), dist: 60, decay: 1.2, pos: [-2, 10.5, 2] });
  };

  set.update = (uu, c2) => {
    const alive = c2.alive ?? 0;
    beams.forEach((b) => (b.visible = alive < 0.3));
    partyBeams.forEach((b) => (b.visible = alive > 0.85));
    dustG.visible = alive < 0.9;
    spk.visible = alive > 0.05;
    const cf = c2.confetti ?? 0;                           // 0 = none, else seconds since the confetti started
    confetti.visible = cf > 0;
    if (confetti.visible) confetti.userData.update(cf, clamp(cf / 0.8), c2.cam ? c2.cam.position : null);
  };

  set.post = { band: 0.42, tilt: 1.8, focusY: 0.5 };
  return set;
}
