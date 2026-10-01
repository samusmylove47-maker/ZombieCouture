// "Re-Stitched": the story world as a pure function of time.  update(t) poses everything; nothing depends on the previous frame.
// Timeline of this sizzle (seconds):  0-1.8 dead mall, Pip at the machine  |  1.8-6.5 the front strides out, zombies are sewn into couture
//                                     6.5-7.6 the wave: the whole mall comes alive  |  7.6- confetti, everyone bops on the beat
import * as THREE from 'three';
import { FRONT } from './stitch.js';
import { pose, makePinCushion } from './chars.js';
import { beam, sparkles, glowSprite, starSprite, rng } from './set.js';
import { makeMachine, makeNeedle, threadTube, makeFrontStitches, dust, makeConfetti } from './props.js';
import { makeZombie, makePip, LIVE, DEAD, liveAct, deadAct, lerpPose, addPose, smooth } from './cast.js';
const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C_HEMI_A = new THREE.Color(0xffe8dc), C_HEMI_B = new THREE.Color(0xd8b0b8);
const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export const BPM = 130;

export function buildStory(ctx) {
  const { scene, M, S, key, cam, quality = 'full' } = ctx;
  const Rr = rng(11);

  // ---- hub: the sewing machine on the barricade
  const machine = makeMachine(M, 1.15); machine.position.set(0.15, 0.99, 0.05); S.barricade.add(machine);
  scene.updateMatrixWorld(true);
  const Ow = new THREE.Vector3(); machine.getWorldPosition(Ow); const O = { x: Ow.x, z: Ow.z };
  const P1 = { x: -0.9, z: 1.5 }, dP1 = Math.hypot(P1.x - O.x, P1.z - O.z);
  const u = { x: (P1.x - O.x) / dP1, z: (P1.z - O.z) / dP1 }, tn = { x: -u.z, z: u.x };
  const at = (rad, lat) => ({ x: O.x + u.x * rad + tn.x * lat, z: O.z + u.z * rad + tn.z * lat });
  const ang0 = Math.atan2(u.z, u.x);

  const ppEndW = at(14.4, 0.7); S.ped.position.set(ppEndW.x, 0, ppEndW.z);

  // ---- the timeline of the front
  const TL = { ignite: 1.8, stride1: 6.5, burst: 7.6, Rmax: 46 };
  const R = (t) => {
    if (t < TL.ignite) return -1;
    if (t < TL.stride1) return 0.6 + 2.0 * (t - TL.ignite);
    const R1 = 0.6 + 2.0 * (TL.stride1 - TL.ignite);
    return lerp(R1, TL.Rmax, smooth((t - TL.stride1) / (TL.burst - TL.stride1)));
  };
  const aliveWorld = (t) => clamp((R(t) - 14) / 30);       // how much of the atrium is alive (drives the light mood)

  // ---- Pip
  const pip = makePip(M); scene.add(pip.obj);
  const nd = makeNeedle(M, 0.7); { const J = pip.obj.userData.J; const pc = makePinCushion(M); pc.position.set(-0.01, -0.13, 0.05); pc.scale.setScalar(0.85); J.elL.add(pc); nd.position.set(0.0, -0.235, 0.0); nd.rotation.set(-1.15, 0, 0); J.elR.add(nd); }

  // ---- the crowd
  // [radial, lateral, variant, speed] : dead zombies drift toward the light at `speed` m/s until the front reaches them
  const spec = [
    [1.9, -1.7, 0, 0.30], [2.7, -1.2, 3, 0.28], [3.7, -3.0, 5, 0.30], [4.4, -1.5, 2, 0.26], [3.3, -4.4, 1, 0.24],
    [5.6, -2.4, 4, 0.30], [6.3, -1.1, 6, 0.28], [7.2, -3.6, 1, 0.26], [7.9, -1.6, 3, 0.30], [8.8, -2.6, 0, 0.28],
    [9.6, -1.2, 5, 0.30], [10.7, -3.2, 2, 0.26], [11.8, -1.8, 6, 0.30], [12.6, -4.4, 4, 0.28], [13.8, -2.2, 1, 0.26],
    [12.0, -5.8, 3, 0.3], [6.2, -5.4, 6, 0.3], [9.0, -5.2, 5, 0.3], [4.6, 2.6, 4, 0.28],
  ];
  // finale formation: two horseshoe rows around the pedestal, opening toward the finale camera
  const formCenter = { x: ppEndW.x, z: ppEndW.z };
  const toFinaleCam = Math.atan2(3.6 - formCenter.x, 9.0 - formCenter.z);
  const slot = (n, N) => { const inner = n < 8; const idx = inner ? n : n - 8, cnt = inner ? 8 : N - 8; const rad = inner ? 2.7 : 4.7; const a = toFinaleCam + PI + lerp(-1.15, 1.15, (idx + 0.5) / cnt) * (inner ? 1 : 0.95); return { x: formCenter.x + Math.sin(a) * rad, z: formCenter.z + Math.cos(a) * rad }; };
  const Tm = 1.35;                                           // seconds for the thread to climb a body
  const crowd = spec.map(([r0, lat, vi, sp], n) => {
    const z = makeZombie(M, vi + (n % 3) * 7); scene.add(z.obj);
    // when does the front meet it?  solve R(t) >= r(t) with r(t) = r0 - sp*t
    let tm = 99; for (let t = 0; t < 12; t += 0.01) { if (R(t) >= r0 - sp * t) { tm = t; break; } }
    const rMeet = r0 - sp * tm;
    return { z, r0, lat, sp, tm, rMeet, ph: n * 0.61, n, popDone: false, form: null };
  });
  crowd.forEach((c, n) => { c.form = slot(n, crowd.length); c.tForm = 7.7 + (n % 7) * 0.09; });

  // sparkle pops when a makeover completes
  const starTex = starSprite(128);
  const pops = crowd.map(() => { const g = new THREE.Group(); const sps = []; for (let i = 0; i < 9; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: new THREE.Color([0xffffff, 0xfff0a8, 0xffc4ec, 0xbff3ff][i % 4]).multiplyScalar(1.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })); s.visible = false; g.add(s); sps.push(s); } scene.add(g); return sps; });

  // ---- front stitches, thread
  const stitches = makeFrontStitches(scene, 240);
  let threadMesh = null;

  // ---- ambient: bunting (shared), dust, tubes, confetti
  function bunting(a, b, sag, n, cols) {
    const g = new THREE.Group();
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3((a.x + b.x) / 2, Math.min(a.y, b.y) - sag, (a.z + b.z) / 2), b);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 5, false), M.thread(0xfff4e0)));
    for (let i = 1; i < n; i++) {
      const t = i / n, p = curve.getPoint(t);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.0, 0.02, 3), M.cloth(cols[i % cols.length], { rep: 3 })); f.rotation.set(PI / 2, 0, PI); f.scale.set(1, 1, 1.35); f.position.set(p.x, p.y - 0.24, p.z); f.castShadow = true; g.add(f);
    }
    scene.add(g);
  }
  const pc = [0xff9ecb, 0xffe066, 0x9fe3ff, 0xd9a7ff, 0xb6ffd6];
  bunting(V(-11.5, 5.0, -4.0), V(6.5, 4.6, -4.6), 1.1, 34, pc);
  bunting(V(-9.0, 4.2, 1.5), V(3.5, 4.3, 0.6), 0.8, 24, pc);
  const dustG = dust(scene, quality === 'full' ? 150 : 70, { x0: -10, x1: 14, y0: 0.3, y1: 6.5, z0: -10, z1: 10 }, 5, 0.3);
  const confetti = makeConfetti(scene, quality === 'full' ? 520 : 260, { x0: -9, x1: 9, y0: 0, y1: 8, z0: -6, z1: 9 }); confetti.visible = false;
  const spk = sparkles(scene, 16, { x0: -8, x1: 4, y0: 0.9, y1: 3.8, z0: -6, z1: 5, s0: 0.1, s1: 0.26 }, 4);

  // ---- lights
  key.position.set(-3.5, 9, 6); key.target.position.set(-2, 1, 0.5); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(ctx.shadow || 2048, ctx.shadow || 2048); Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 36 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  const hemi = new THREE.HemisphereLight(0xa8b8ff, 0x303860, 0.5); scene.add(hemi);
  const spot = (color, i, d, a, pen, dec, pos, tgt) => { const s = new THREE.SpotLight(color, i, d, a, pen, dec); s.position.set(...pos); s.target.position.set(...tgt); scene.add(s, s.target); return s; };
  const pool = spot(0xffd6a8, 0, 24, 0.62, 0.7, 1.2, [0, 8, 0], [0, 0.6, 0]);          // warm pool that follows Pip
  const cold = spot(0x8fb4ff, 110, 40, 0.9, 0.6, 1.1, [2, 8, 4], [-2, 0, -2]);            // cold shaft over the dead crowd
  const lamp = new THREE.PointLight(0xffc890, 22, 7, 1.6); lamp.position.set(O.x + 0.6, 2.4, O.z + 1.4); scene.add(lamp);
  const rim = spot(0xffb98a, 60, 30, 0.7, 0.6, 1.2, [O.x + 2, 5, O.z + 3], [O.x + u.x * 5, 1, O.z + u.z * 5]);
  const beams = [[-1.0, 0.5], [2.6, -2.5], [0.4, -6.5]].map(([x, z]) => beam(scene, x, z, 0x9cc0ff, 1.35, 12, [0, 0], 0.13));
  const fill = new THREE.PointLight(0xffeef8, 0, 60, 1.2); fill.position.set(-2, 10.5, 2); scene.add(fill);
  const partyA = spot(0xff9ecb, 0, 34, 0.85, 0.6, 1.2, [-9, 6, -1], [-1, 1, 1]), partyB = spot(0x9fe3ff, 0, 34, 0.85, 0.6, 1.2, [8, 6, -1], [-1, 1, 1]), partyC = spot(0xfff0c0, 0, 34, 0.8, 0.6, 1.2, [0, 9, 8], [0, 0.8, 0]);
  const partyBeams = [beam(scene, -3.5, -1.0, 0xff7fc8, 1.2, 12, [0, 0.05], 0.22), beam(scene, 1.5, 2.0, 0x8fe8ff, 1.0, 12, [0, -0.05], 0.18), beam(scene, 3.5, -2.5, 0xffe27a, 1.1, 12, [0.02, 0], 0.16)];
  partyBeams.forEach((b) => (b.visible = false));

  // ---- cameras: named rigs, each a function of time
  const rigs = {
    dead: (t) => { const p = at(lerp(23, 20, clamp(t / 2.5)), lerp(3.5, 2.0, clamp(t / 2.5))); const l = at(1.6, 0.4); return { pos: [p.x, lerp(1.9, 1.5, clamp(t / 2.5)), p.z], look: [l.x, 1.25, l.z], fov: 30 }; },
    track: (t) => { const r = R(t); const p = at(r + 2.2, lerp(7.4, 6.4, clamp((t - 2.4) / 4.0))); const l = at(r - 0.9, -0.4); return { pos: [p.x, 1.25, p.z], look: [l.x, 1.15, l.z], fov: 46 }; },
    close: (t) => { const r = R(t); const p = at(r + 1.7, 3.9); const l = at(r - 0.7, -0.6); return { pos: [p.x, 1.5, p.z], look: [l.x, 1.1, l.z], fov: 41 }; },
    crane: (t) => { const k = smooth(clamp((t - 6.3) / 3.6)); return { pos: [lerp(2.6, 3.6, k), lerp(1.35, 2.5, k), lerp(8.0, 9.4, k)], look: [lerp(-1.8, ppEndW.x, k), lerp(1.35, 1.3, k), lerp(0.5, ppEndW.z - 0.4, k)], fov: lerp(46, 44, k) }; },
  };

  const wheel = machine.children[7];
  const J = pip.obj.userData.J;
  const eyeW = new THREE.Vector3();

  function update(t, o = {}) {
    // pt = puppet time. Equal to t unless the harness steps the puppets (stop-motion poses) while camera, lights and particles stay smooth.
    const pt = o.tp ?? t;
    const tq = Math.floor(pt * 12 + 1e-6);                               // index of the 12 Hz pose
    const touchAmt = o.touch || 0;
    const touch = (n, a) => (hash(tq * 1.37 + n * 91.7) - 0.5) * 2 * a * touchAmt;   // the animator's hand: a different nudge on every pose
    // camera first: everything that looks at the camera reads it from this frame, never from the previous one
    const rig = rigs[o.rig || rigAt(t)](t);
    cam.position.set(...rig.pos); cam.lookAt(...rig.look); cam.fov = rig.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const beat = pt * BPM / 60;
    const Rt = R(pt), Rl = R(t);                 // Rt: the drawn front (puppet clock); Rl: the smooth one that drives the light mood
    const alive = aliveWorld(t);
    FRONT.uFront.value.set(O.x, 0.5, O.z, Rt);
    FRONT.uAlive.value = pt >= TL.burst + 0.2 ? 1 : 0;
    FRONT.uTime.value = t;
    FRONT.uBoil.value = touchAmt ? ((tq * 0.61803398875) % 1) * 37.0 : 0;      // felt fibres shimmer from pose to pose
    // fluorescent flicker in the dead world; it steadies when the world wakes
    const fl = t < 1.8 ? 0.86 + 0.14 * (hash(Math.floor(t * 14)) > 0.22 ? 1 : 0.35) : 0.96;
    FRONT.uFlicker.value = lerp(fl, 1, alive);

    // ---- Pip: stands at the machine, then strides out on the front
    const rp = pt < TL.ignite ? 1.05 : Math.max(1.05, R(Math.min(pt, TL.stride1)) + 0.35);
    const walking = pt >= TL.ignite && pt < TL.stride1 + 1.5;
    const lat = pt >= TL.ignite && pt < TL.stride1 ? 0.25 * Math.sin(pt * 1.7) : 0.0;
    const ppW = at(rp, pt < TL.ignite ? 0.55 : lat);
    const ppEnd = { x: ppEndW.x, z: ppEndW.z };                                // the fitting pedestal, centre stage
    const kWalk = smooth(clamp((pt - TL.stride1) / 1.5));
    const kEnd = smooth(clamp((pt - TL.stride1 - 1.2) / 0.4));                  // steps up onto it
    const pp = { x: lerp(ppW.x, ppEnd.x, kWalk), z: lerp(ppW.z, ppEnd.z, kWalk) };
    const cyc = beat * PI;                       // one step per beat: left, right...
    const sw = Math.sin(cyc);
    pip.obj.position.set(pp.x, walking && kEnd < 0.01 ? 0.03 * Math.abs(Math.cos(cyc)) : 0.25 * kEnd, pp.z);
    const faceStride = Math.atan2(u.x, u.z) - 0.8, faceMachine = Math.atan2(O.x - pp.x, O.z - pp.z) - 0.5, faceCam = Math.atan2(cam.position.x - pp.x, cam.position.z - pp.z);
    const faceA = pt < TL.ignite ? faceMachine : faceStride;
    pip.obj.rotation.set(0, pt < TL.stride1 + 0.5 ? faceA : lerpAng(faceA, faceCam, smooth(clamp((pt - TL.stride1 - 0.5) / 0.9))), 0);
    if (pt < TL.stride1 + 1.4) {
      const stitchArm = pt >= TL.ignite && pt < TL.stride1 ? Math.sin(beat * PI * 2) : Math.sin(pt * 4.0) * 0.06;
      pose(pip.obj, { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.55 + 0.42 * stitchArm, 0, 1.75], elR: [-0.4 - 0.25 * stitchArm, 0, -0.35], head: [0.02, walking ? -0.35 : -0.5, -0.1], body: [0.06, 0, 0.03 * sw], legL: [walking && kEnd < 0.01 ? 0.42 * sw : 0, 0, 0], legR: [walking && kEnd < 0.01 ? -0.42 * sw : 0, 0, 0] });
    } else {
      const a = liveAct(beat, 0, 1.15);            // she joins the dance: arms wide, proud
      pose(pip.obj, a.pose); pip.obj.position.y = a.bob + 0.25 * kEnd; pip.obj.rotation.z = a.sway;
    }
    if (touchAmt) { pip.obj.rotation.z += touch(1, 0.008); pip.obj.rotation.x += touch(2, 0.006); pip.obj.position.x += touch(3, 0.003); pip.obj.position.z += touch(4, 0.003); }
    pip.obj.updateMatrixWorld(true);

    // ---- machine: needle pumps, wheel turns once the front is running
    const run = Rt >= 0 && pt < TL.burst + 0.3;
    machine.userData.needle.position.y = run ? 0.12 + 0.05 * Math.sin(beat * PI * 4) : 0.12;
    if (wheel) wheel.rotation.z = run ? beat * PI * 2 : 0;

    // ---- the crowd
    crowd.forEach((c) => {
      const { z, tm, sp, r0, lat, ph, n } = c;
      const tt = Math.min(pt, tm);
      let rad = r0 - sp * tt;                              // dead ones drift toward the light until the thread reaches them
      const p = at(rad, lat + 0.18 * Math.sin(tt * 0.8 + ph));
      const k = smooth((pt - tm) / Tm);
      z.K.value = k;
      const dead = deadAct(pt * 1.0 + ph * 3, ph);
      const live = liveAct(beat, ph * 0.5, 1);
      // the dead pose fades to the live one as the thread reaches the head; then it bops
      const kp = smooth((k - 0.35) / 0.65);
      const a = lerpPose(dead.pose, live.pose, kp);
      // the hop of joy when the last stitch lands
      const hop = pt > tm + Tm * 0.85 && pt < tm + Tm * 0.85 + 0.45 ? Math.sin((pt - tm - Tm * 0.85) / 0.45 * PI) * 0.22 : 0;
      const kf = smooth((pt - c.tForm) / 1.3);                        // glide into the finale formation
      const gx = lerp(p.x, c.form.x, kf), gz = lerp(p.z, c.form.z, kf);
      const moving = kf > 0.001 && kf < 0.999 ? 1 : 0;
      if (moving) { const st = Math.sin(pt * 11 + ph * 5); a.legL = [0.5 * st, 0, 0]; a.legR = [-0.5 * st, 0, 0]; }
      z.obj.position.set(gx, live.bob * kp + hop + moving * 0.03 * Math.abs(Math.sin(pt * 11 + ph * 5)), gz);
      // faces the light (Pip) while dead, turns to the audience once dressed
      const aDead = Math.atan2(pp.x - p.x, pp.z - p.z) + 0.12 * Math.sin(ph * 7);
      const aLive = Math.atan2(cam.position.x * 0.6 + pp.x * 0.4 - gx, cam.position.z * 0.6 + pp.z * 0.4 - gz);
      let dA = aLive - aDead; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      z.obj.rotation.set(0, aDead + dA * smooth((k - 0.25) / 0.6), lerp(dead.sway, live.sway, kp));
      if (touchAmt) { z.obj.rotation.z += touch(n * 5 + 11, 0.010); z.obj.rotation.x += touch(n * 5 + 12, 0.008); z.obj.position.x += touch(n * 5 + 13, 0.004); z.obj.position.z += touch(n * 5 + 14, 0.004); }
      // heads look at the camera
      const toCam = Math.atan2(cam.position.x - gx, cam.position.z - gz); let rel = toCam - z.obj.rotation.y; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const head = a.head.slice(); head[1] += clamp(rel, -1.05, 1.05) * 0.7;
      if (touchAmt) { head[0] += touch(n * 5 + 15, 0.02); head[2] += touch(n * 5 + 16, 0.03); }
      pose(z.obj, { ...a, head });
      z.obj.visible = true;
      // sparkle pop
      const ps = pops[n]; const tp = t - (tm + Tm * 0.8);
      ps.forEach((s, i) => {
        if (tp < 0 || tp > 0.9) { s.visible = false; return; }
        const q = tp / 0.9, a2 = (i / ps.length) * PI * 2 + n, rr = 0.15 + 0.85 * smooth(q);
        s.visible = true; s.position.set(gx + Math.cos(a2) * rr, 1.3 + 0.5 * Math.sin(a2 * 2 + n) * q + 0.3 * q, gz + Math.sin(a2) * rr);
        const sc = (0.22 + 0.12 * (i % 3)) * (1 - q * 0.6); s.scale.set(sc, sc, 1); s.material.opacity = 1 - q * q;
      });
    });

    // ---- the thread from the machine's spool to Pip's needle (rebuilt each frame; a pure function of Pip's position)
    if (threadMesh) { scene.remove(threadMesh); threadMesh.geometry.dispose(); threadMesh = null; }
    if (Rt >= 0 && pt < TL.stride1 + 1.6) {
      nd.updateMatrixWorld(true); nd.localToWorld(eyeW.set(0, -0.06 * 0.7, 0));
      const mp = new THREE.Vector3(); machine.localToWorld(mp.set(0.02, 0.7, 0));
      const pts = [mp.clone(), V(mp.x + 0.15, 0.45, mp.z + 0.4), V(O.x + u.x * 1.3 + 0.3, 0.05, O.z + u.z * 1.3)];
      const dEnd = Math.hypot(pp.x - O.x, pp.z - O.z);
      for (let i = 2; i <= 9; i++) { const rr = 1.3 + (dEnd - 1.3) * (i - 1) / 9; pts.push(V(O.x + u.x * rr + tn.x * Math.sin(i * 1.25 + pt * 0.6) * 0.5, 0.03, O.z + u.z * rr + tn.z * Math.sin(i * 1.25 + pt * 0.6) * 0.5)); }
      pts.push(V(pp.x - u.x * 0.6 + tn.x * 0.35, 0.03, pp.z - u.z * 0.6 + tn.z * 0.35), V(pp.x - u.x * 0.2 + 0.1, 0.35, pp.z - u.z * 0.2), eyeW.clone().add(V(-0.1, -0.25, 0.05)), eyeW.clone());
      threadMesh = threadTube(M, pts, 0.022, 0xff5fa8, 220); scene.add(threadMesh);
    }
    // ---- the front, as running stitches on the floor
    if (Rt > 0 && Rt < 30) stitches.userData.update(O, Rt, ang0 - 0.75, ang0 + 0.75, pt); else stitches.count = 0;

    // ---- light mood follows how much of the world is awake
    key.intensity = lerp(0.55, 1.85, Math.max(alive, smooth(clamp((Rl + 1) / 12)) * 0.45));
    hemi.intensity = lerp(0.5, 0.58, alive);
    hemi.color.setHex(0xc8d0ff).lerp(C_HEMI_A, alive); hemi.groundColor.setHex(0x384070).lerp(C_HEMI_B, alive);
    pool.position.set(pp.x - u.x * 2.5 + 1.0, 8, pp.z - u.z * 2.5 + 2); pool.target.position.set(pp.x - u.x * 2.2, 0.6, pp.z - u.z * 2.2); pool.intensity = Rl >= 0 ? 150 * (1 - alive * 0.55) : 0;
    cold.intensity = lerp(110, 0, smooth(clamp((alive - 0.2) / 0.6)));
    lamp.intensity = t < TL.ignite ? 22 : 14;
    rim.intensity = lerp(45, 0, alive);
    fill.intensity = 70 * smooth(clamp((alive - 0.35) / 0.5));
    partyA.intensity = 85 * smooth(clamp((alive - 0.5) / 0.4)); partyB.intensity = 85 * smooth(clamp((alive - 0.5) / 0.4)); partyC.intensity = 35 * smooth(clamp((alive - 0.5) / 0.4));
    beams.forEach((b) => (b.visible = alive < 0.3));
    partyBeams.forEach((b) => (b.visible = alive > 0.85));
    confetti.visible = t > TL.burst + 0.1; if (confetti.visible) confetti.userData.update(t - TL.burst, clamp((t - TL.burst - 0.1) / 0.8), cam.position);
    dustG.visible = alive < 0.9;
    spk.visible = alive > 0.05;

  }

  // a shot list for the sizzle: which rig when
  const cuts = [[0, 2.5, 'dead'], [2.5, 4.6, 'track'], [4.6, 6.4, 'close'], [6.4, 10, 'crane']];
  const rigAt = (t) => (cuts.find(([a, b]) => t >= a && t < b) || cuts[cuts.length - 1])[2];
  return { update, R, TL, cuts, rigAt, O, u, tn, at, pip, crowd, machine, confetti };
}
