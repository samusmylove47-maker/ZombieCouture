// Gags previewer.   ?shot=preview&p=gags&g=arm|beans|scrap|cup|thread|puff&who=z2      (tools/shootmany.py works: window.setView({t, rig, args}))
//   g=arm     the arm falls off at a tea table (t = u seconds since the gag began, 0..6.5); rigs: top (elevated, best), wide, close, front, table;  nopip=1 hides Pip;  who=z2 (short) | z1 (tallest)
//   g=beans   the last can of beans on a felt table with the spoon; t = seconds; rigs: cu, wide, spoon
//   g=scrap   a zombie holding up a torn scrap of printed fabric; rig: hand, wide
//   g=cup     a zombie holding a teacup in a felt mitt; rig: hand, wide
//   g=thread  thread lines: args.reveal (0..1)                              rig: thread
//   g=puff    the sparkle pop and cotton puff, args.p (0..1)                 rig: puff
import { hash, facing } from '../util.js';
import { makePip, makeZombie, ZV } from '../cast.js';
import { pose, add } from '../chars.js';
import { makeLooseArm, armGag, reachArm, makeBeansCan, makeScrap, makeTeacup, makeSewNeedle, makeThreadLine, makeStitchTrail, makeSparklePop, makeFluffPuff, holdUpright, ARM_GAG_LENGTH } from '../gags.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, SHADOW } = env;
  const PI = Math.PI;
  try { await document.fonts.load('40px Fredoka'); } catch (e) { /* fall back to the default face */ }
  const which = q.get('g') || 'arm', who = q.get('who') || (which === 'arm' ? 'z2' : 'z0');
  const kit = makeKit(scene, { shadow: SHADOW });
  FRONT.uAlive.value = 1; FRONT.uFront.value.set(0, 0.5, 0, 60); FRONT.uFlicker.value = 1;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k, smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- stage: felt floor, a lilac wall, a round table with a scalloped cloth
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), M.matte(0xd3b4ec, { rep: 30 })); floor.rotation.x = -PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), M.matte(0x86a9dc, { rep: 30 })); wall.position.set(0, 7, -3.4); wall.receiveShadow = true; scene.add(wall);
  const zi = +who.replace('z', '') || 0, h = ZV[zi % ZV.length].height, hasZ = which !== 'thread' && which !== 'puff' && which !== 'beans';
  const tableTop = 1.115 * h - 0.36 * h, tc = { x: 0.1 * h, z: 0.6 * h };

  function makeTable(top, r) {
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(r, r, 0.045, 48), M.plastic(0xfff4e0, { rough: 0.3 }), { y: top - 0.0225 });
    add(g, new THREE.CylinderGeometry(0.06, 0.09, top - 0.06, 20), M.plastic(0xd9a7ff, { rough: 0.3 }), { y: (top - 0.06) / 2 + 0.03 });
    add(g, new THREE.CylinderGeometry(0.34, 0.36, 0.05, 32), M.plastic(0xd9a7ff, { rough: 0.3 }), { y: 0.025 });
    // tablecloth: a lathe with a scalloped hem, with cream stitches around it
    const prof = [[0.001, top + 0.004], [r * 0.98, top + 0.004], [r * 1.02, top - 0.02], [r * 1.05, top - 0.12], [r * 1.07, top - 0.2]].map((p) => new THREE.Vector2(p[0], p[1]));
    const geo = new THREE.LatheGeometry(prof, 96); const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), w = Math.max(0, (top - 0.02 - y) / 0.18), sc = 1 + 0.035 * w * Math.sin(a * 14), dy = -0.03 * w * (0.5 + 0.5 * Math.cos(a * 14)); P.setXYZ(i, x * sc, y + dy, z * sc); }
    geo.computeVertexNormals(); add(g, geo, M.cloth(0x7fd6c0, { rep: 5 }), {});
    const n = 60, sg = new THREE.CapsuleGeometry(0.006, 0.03, 2, 4); sg.rotateZ(PI / 2);
    const im = new THREE.InstancedMesh(sg, M.thread(0xfff4e0), n), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = V(0, 1, 0);
    for (let i = 0; i < n; i++) { const a = i / n * PI * 2; qq.setFromAxisAngle(up, -(a + PI / 2)); m4.compose(V(Math.cos(a) * r * 0.9, top + 0.008, Math.sin(a) * r * 0.9), qq, V(1, 1, 1)); im.setMatrixAt(i, m4); }
    g.add(im); return g;
  }

  // ---- cast
  let zomb = null, pip = null, arm = null, saucer = null, cup = null, needle = null, thr = null, can = null, scrap = null, cupProp = null;
  const lights = { base: 1 };
  const facePip = { x: 0, z: 0 };
  if (hasZ) {
    zomb = makeZombie(M, zi); zomb.K.value = 1; scene.add(zomb.obj); zomb.obj.position.set(0, 0, 0);
  }
  if (which === 'arm') {
    const table = makeTable(tableTop, 0.46 * h); table.position.set(tc.x, 0, tc.z); scene.add(table);
    arm = makeLooseArm(M, zomb, 1); scene.add(arm.obj);
    pip = makePip(M); scene.add(pip.obj); if (q.get('nopip') === '1') pip.obj.visible = false;      // nopip=1: the gag without Pip in the way
    const pp = { x: 0.6 * h, z: -0.28 * h }; pip.obj.position.set(pp.x, 0, pp.z); pip.obj.rotation.y = facing(pp, { x: 0.05, z: 0.0 });
    saucer = makeTeacup(M, { saucer: true, steam: false, alive: true }); saucer.userData.cup.visible = false; saucer.position.set(0.09 * h, tableTop + 0.004, 0.58 * h); scene.add(saucer);
    cup = makeTeacup(M, { saucer: false, steam: false, alive: true }); scene.add(cup);
    needle = makeSewNeedle(M, 0.16); needle.visible = false; scene.add(needle);
    thr = makeThreadLine(M, { segments: 24, radius: 0.006, glow: 0.8 }); scene.add(thr.obj);
  } else if (which === 'beans') {
    const table = makeTable(0.75, 0.5); table.position.set(0, 0, 0); scene.add(table);
    can = makeBeansCan(M, { spoon: true }); can.position.set(0, 0.75, 0); can.rotation.y = 0.25; scene.add(can);
    can.userData.spoon.visible = true; scene.add(can.userData.spoon);
    // a few loose beans and a thread scrap on the table
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), M.matte(0xc1662f, { rep: 6 })); b.scale.set(0.85, 0.6, 1.2); b.position.set(0.16 + hash(i) * 0.14, 0.755, 0.05 + hash(i + 9) * 0.22); b.rotation.y = hash(i + 3) * 6; b.castShadow = true; scene.add(b); }
  } else if (which === 'scrap') {
    scrap = makeScrap(M, 0xffd9ea); scene.add(scrap);
  } else if (which === 'cup') {
    cupProp = makeTeacup(M, { saucer: false, steam: true, alive: true }); scene.add(cupProp);
  }
  const sparkles = makeSparklePop(M), fluff = makeFluffPuff(M), pulls = [];
  let tl = null, tl2 = null, st = null;
  if (which === 'thread') {
    tl = makeThreadLine(M, { segments: 96, radius: 0.02 }); scene.add(tl.obj);
    tl2 = makeThreadLine(M, { segments: 96, radius: 0.012, helix: 0.18, helixTurns: 4 }); scene.add(tl2.obj);
    st = makeStitchTrail(M, 20, { len: 0.16, thick: 0.02 }); scene.add(st.obj);
  }
  if (which === 'puff') { scene.add(sparkles.obj, fluff.obj); }

  // ---- lights
  const setLights = (t) => {
    kit.off();
    kit.setKey({ pos: [2.6, 6, 4.2], target: [0.2, 0.8, 0.3], color: 0xffe2c4, i: 2.3, extent: 3.2, near: 1, far: 20 });
    kit.setHemi({ sky: 0xf4f0ff, ground: 0xb8a0c8, i: 0.42 });
    kit.setSpot(0, { color: 0xffd6a8, i: 70, dist: 20, angle: 0.9, pen: 0.7, decay: 1.2, pos: [-2.4, 3.5, 3.2], target: [0.2, 0.8, 0.3] });
    kit.setSpot(1, { color: 0xffb0d8, i: 50, dist: 20, angle: 0.8, pen: 0.7, decay: 1.2, pos: [1.5, 2.5, -2.5], target: [0.2, 1.0, 0.2] });
  };

  // ---- cameras: world coordinates
  const P = (x, y, z) => [x * h, y * h, z * h];
  const rigs = {
    wide: () => ({ pos: P(0.45, 1.1, 3.4), look: P(0.3, 0.82, 0.15), fov: 27 }),
    close: () => ({ pos: P(0.5, 1.15, 2.3), look: P(0.28, 0.9, 0.1), fov: 23 }),
    front: () => ({ pos: P(0.3, 1.0, 2.7), look: P(0.28, 0.85, 0.2), fov: 30 }),
    top: () => ({ pos: P(1.0, 2.4, 2.4), look: P(0.25, 0.8, 0.2), fov: 32 }),
    table: () => ({ pos: P(0.9, 0.9, 1.9), look: P(0.15, 0.6, 0.4), fov: 32 }),
    cu: () => ({ pos: [0.3, 0.98, 0.55], look: [0.0, 0.9, 0.0], fov: 30 }),
    spoon: () => ({ pos: [0.5, 1.0, 0.5], look: [0.05, 0.86, 0.0], fov: 32 }),
    hand: () => (which === 'cup' ? { pos: [0.55, 1.0, 1.5], look: [0.15, 0.85, 0.35], fov: 26 } : { pos: [0.85, 1.0, 1.6], look: [0.2, 0.88, 0.3], fov: 28 }),
    thread: () => ({ pos: [0.0, 1.6, 5.5], look: [0.0, 1.5, 0.0], fov: 40 }),
    puff: () => ({ pos: [0.3, 1.1, 2.2], look: [0.3, 1.0, 0.0], fov: 32 }),
  };
  const view = { rig: q.get('rig') || (which === 'arm' ? 'wide' : which === 'beans' ? 'cu' : which === 'thread' ? 'thread' : which === 'puff' ? 'puff' : 'hand'), t: +(q.get('t') || 0), dur: 4, args: {} };

  const sockBase = zomb ? new THREE.Vector3(0.165 * h, 1.115 * h, 0) : new THREE.Vector3();
  window.setT = (t) => {
    view.t = t; const a = view.args || {};
    setLights(t);
    if (which === 'arm') {
      const opt = { scale: h, rotY: 0, saucer: [0.09 * h, 0.58 * h], pip: [0.6 * h, -0.28 * h] };
      // the film passes the REAL shoulder position: pose once with the rest shoulder, read the joint, ask again
      let g = armGag(t, sockBase, opt);
      const poseZ = (gg) => { pose(zomb.obj, { shR: gg.zombie.shR, elR: gg.zombie.elR, shL: [-0.5, 0, -0.35], elL: [-1.0, 0, 0.1], head: [0.02 - gg.zombie.nod * 0.16, 0.0, 0.0], body: [0.02, 0, gg.wobble * 0.07] }); zomb.obj.updateMatrixWorld(true); };
      poseZ(g); const sock = zomb.obj.userData.J.shR.getWorldPosition(V(0, 0, 0)); g = armGag(t, sock, opt); poseZ(g);
      arm.apply(g, { scale: h });
      // the cup: raised at the mouth (cupK = 1, in the mitt through holdUpright with the handle as the grip) or on the saucer (0)
      const J = zomb.obj.userData.J, rest = V(0.09 * h, tableTop + 0.012, 0.58 * h);
      if (g.cupK > 0.5) holdUpright(cup, J.elR, { yaw: -0.3, at: [0, -0.215, 0], grip: cup.userData.grip });
      else { if (cup.parent !== scene) { scene.add(cup); cup.scale.set(1, 1, 1); cup.quaternion.identity(); } cup.position.copy(rest); cup.rotation.set(0, 0, g.cupRattle * 0.05); }
      saucer.rotation.z = -g.cupRattle * 0.04;
      // Pip: left hand at her chest, right hand follows g.pipHand
      pip.obj.position.set(g.pipStand[0], 0, g.pipStand[1]); pip.obj.rotation.y = g.pipYaw;
      pose(pip.obj, { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.2, 0, 0.5], elR: [-0.4, 0, 0], head: [0.05, 0, 0.04], body: [g.pipLean, 0, 0] });
      pip.obj.updateMatrixWorld(true);
      if (g.pipHand) { reachArm(pip, 1, g.pipHand, [0.2, -1, 0.1]); pip.obj.updateMatrixWorld(true); }
      // Pip looks at what is happening
      const look = g.phase === 'sip' || g.phase === 'set down' ? V(0.2 * h, 1.0 * h, 0.3 * h) : (g.arm.visible ? V(...g.arm.pos) : V(0.165 * h, 1.1 * h, 0));
      const hd = pip.obj.userData.J.head; hd.rotation.set(0.12, 0, 0.05);
      // the needle
      needle.visible = !!g.needle.visible;
      if (needle.visible) { const d = V(...g.needle.dir).normalize(), p0 = V(...g.needle.pos); needle.position.copy(p0.clone().addScaledVector(d, -0.16 * h)); needle.quaternion.setFromUnitVectors(V(0, 1, 0), d); needle.scale.setScalar(h); }
      thr.obj.visible = !!g.thread.visible;
      if (thr.obj.visible) { const A = V(...g.thread.from), B = V(...g.thread.to), Mid = A.clone().lerp(B, 0.5).add(V(0, -0.1 * h, 0)); thr.set([A, Mid, B], 1, t); }
      void look;
      window.__gag = g;
    } else if (which === 'beans') {
      const sp = can.userData.spoon, k = smooth(t / 2.0);
      sp.position.set(lerp(0.34, 0.06, k), lerp(0.78, 1.03, k) - 0.0, lerp(0.16, 0.02, k)); sp.rotation.set(0.2 + 0.4 * (1 - k), -0.6 * (1 - k) + 0.4, -0.15);
      sp.scale.setScalar(1.0);
    } else if (which === 'scrap') {
      pose(zomb.obj, { shR: [-1.3, 0, 0.5], elR: [-1.5, 0, 0.4], shL: [-0.7, 0, -0.3], elL: [-0.9, 0, 0], head: [-0.05, 0.1, 0.05], body: [0.02, 0, 0] }); zomb.obj.updateMatrixWorld(true);
      holdUpright(scrap, zomb.obj.userData.J.elR, { yaw: 0.35, at: [0, -0.215, 0] });
    } else if (which === 'cup') {
      pose(zomb.obj, { shR: [-0.8, 0, 0.35], elR: [-1.8, 0, 0.2], shL: [-0.7, 0, -0.3], elL: [-0.9, 0, 0], head: [-0.05, 0.1, 0.05], body: [0.02, 0, 0] }); zomb.obj.updateMatrixWorld(true);
      holdUpright(cupProp, zomb.obj.userData.J.elR, { yaw: -0.4, at: [0, -0.215, 0], grip: cupProp.userData.grip });
      cupProp.userData.steam?.(t);
    } else if (which === 'thread') {
      const rv = a.reveal ?? clamp(t / 3);
      tl.set((s) => V(-3 + 6 * s, 0.05 + 0.05 * Math.sin(s * 22), 0.6 * Math.sin(s * 9)), rv, t);
      tl2.set((s) => V(-1 + 0.6 * Math.sin(s * 2.4), 0.3 + s * 3.2, 0.2), rv, t);
      st.set((s) => V(-3 + 6 * s, 0.0, 1.0 * Math.sin(s * 5) - 0.8), rv, { lift: 0.02 });
    } else if (which === 'puff') {
      const p = a.p ?? clamp(t / 1.2);
      sparkles.set(p, [0.0, 1.0, 0], 1.6); fluff.set(p, [0.7, 1.0, 0], 1.6);
    }
    const r = rigs[view.rig](); cam.position.set(...r.pos); cam.lookAt(...r.look); cam.fov = r.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  };
  window.setView = (o = {}) => { const { args, ...rest } = o; Object.assign(view, rest); if (args) view.args = { ...args }; window.setT(view.t); };
  setPost(makePost(renderer, scene, cam, 'felt', W, H, { band: 0.4, tilt: 1.6, focusY: 0.5, noBokeh: true }));
  window.setT(view.t);
  window.__stage = { zomb, pip, arm, cam, ARM_GAG_LENGTH };
}
