// Look-dev harness. Builds the mall in one of two skins (vinyl | felt) and exposes window.shoot().
// Felt "stitch-front" concept shots: plan, before, seam, makeover, after     Vinyl tests: hero, face, hface, low, cctv
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeMats } from './mats.js';
import { FRONT } from './stitch.js';
import { buildCharacter, pose, makePinCushion, makeScissors, makeClutch, add } from './chars.js';
import { buildSet, buildTitle, sparkles, bokeh, beam, sewnWorld, enclose, glowSprite, rng } from './set.js';
import { makePost } from './post.js';
import { makeMachine, makeSpool, makeNeedle, threadTube, makeFrontStitches, dust, tube, makeConfetti } from './props.js';
import { buildStory } from './story.js';
import { makeZombie, makePip, LIVE, DEAD, liveAct, deadAct, lerpPose, smooth, applyAct, makeoverK, ZV, GOWNS } from './cast.js';
import { makeKit } from './kit.js';
const PI = Math.PI;

const q = new URLSearchParams(location.search);
const style = q.get('style') || 'vinyl';
const shot = q.get('shot') || 'hero';
const W = +(q.get('w') || 1280), H = +(q.get('h') || 720);
const felt = style === 'felt';
const LITE = q.get('lite') === '1', NOMIRROR = q.get('mirror') === '0', NOBOKEH = q.get('bokeh') === '0', SHADOW = +(q.get('shadow') || 2048);
const EXPO = +(q.get('expo') || 0);

const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = EXPO || (felt ? 0.92 : 0.8);

const scene = new THREE.Scene();
scene.background = new THREE.Color(felt ? 0xffd9a6 : 0xb9b0ff);
if (!felt) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32; }
scene.fog = felt ? new THREE.Fog(0x8f8aa8, 30, 130) : new THREE.Fog(0xc4bcff, 26, 80);

const PAPER = q.get('paper') === '1';
const M = makeMats(style, LITE, { paper: PAPER });
const PREVIEW = (shot === 'preview' || shot === 'film') && q.get('mall') !== '1';       // set previews (web/preview/*.js) start from an empty stage
const S = PREVIEW ? null : buildSet(scene, M, { W, H, reflect: !NOMIRROR });
if (felt && !PREVIEW) { sewnWorld(scene); enclose(scene, M); }
const Rr = rng(21);
const key = new THREE.DirectionalLight(felt ? 0xffe2c4 : 0xfff0ee, felt ? 2.6 : 1.7);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, shot === 'preview' || shot === 'film' ? 1200 : 120);
let post;

// ---------------------------------------------------------------- helpers
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function faceTo(obj, x, z, tx, tz, jitter = 0) { obj.position.x = x; obj.position.z = z; obj.rotation.y = Math.atan2(tx - x, tz - z) + jitter; }
function setCam(pos, look, fov) { cam.position.set(...pos); cam.lookAt(...look); cam.fov = fov; cam.updateProjectionMatrix(); }

// ---------------------------------------------------------------- the stitch-front concept (felt)
async function buildFront() {
  const mode = shot === 'plan' ? (q.get('as') || 'seam') : shot;
  const WORLD_ALIVE = mode === 'after';
  // hub = the sewing machine on the barricade
  const machine = makeMachine(M, 1.15); machine.position.set(0.15, 0.99, 0.05); S.barricade.add(machine);
  scene.updateMatrixWorld(true);
  const Ow = new THREE.Vector3(); machine.getWorldPosition(Ow); const O = { x: Ow.x, z: Ow.z };
  const spot = (color, i, d, a, pen, dec, pos, tgt) => { const s = new THREE.SpotLight(color, i, d, a, pen, dec); s.position.set(...pos); s.target.position.set(...tgt); scene.add(s, s.target); return s; };

  // where things stand is described relative to the front: radial (distance from the hub) and lateral (sideways)
  const Pw = { x: -0.9, z: 1.5 };
  const dP = Math.hypot(Pw.x - O.x, Pw.z - O.z);
  const u = { x: (Pw.x - O.x) / dP, z: (Pw.z - O.z) / dP }, tn = { x: -u.z, z: u.x };
  const R = mode === 'seam' || mode === 'makeover' ? dP : (mode === 'after' ? 60 : -1);
  const at = (rad, lat) => ({ x: O.x + u.x * rad + tn.x * lat, z: O.z + u.z * rad + tn.z * lat });
  FRONT.uFront.value.set(O.x, 0.5, O.z, R);
  FRONT.uAlive.value = WORLD_ALIVE ? 1 : 0;
  FRONT.uFlicker.value = mode === 'before' ? 0.9 : 0.96;

  // Pip
  const pip = makePip(M); scene.add(pip.obj);
  let eyeW = new THREE.Vector3();
  {
    const J = pip.obj.userData.J;
    const pc = makePinCushion(M); pc.position.set(-0.01, -0.13, 0.05); pc.scale.setScalar(0.85); J.elL.add(pc);
    const nd = makeNeedle(M, 0.7); nd.position.set(0.0, -0.235, 0.0); nd.rotation.set(-1.15, 0, 0); J.elR.add(nd);
    pip.needle = nd;
  }
  const cast = [];
  const newZ = (i, extra = {}) => { const z = makeZombie(M, i, extra); scene.add(z.obj); cast.push(z); return z; };

  if (mode === 'before') {
    const P0 = at(-0.0, 0); // (unused)
    const px = O.x + 1.0, pz = O.z + 1.25;
    faceTo(pip.obj, px, pz, O.x, O.z + 0.0, 0.0);
    pose(pip.obj, { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.7, 0, 1.1], elR: [-0.5, 0, -0.3], head: [0.05, -0.25, -0.05], body: [0, 0, 0.02] });
    pip.obj.updateMatrixWorld(true);
  } else {
    faceTo(pip.obj, Pw.x, Pw.z, Pw.x + 3, Pw.z + 3.5, 0);
    pose(pip.obj, { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.55, 0, 1.75], elR: [-0.4, 0, -0.35], head: [0.02, -0.35, -0.1], body: [0, 0, 0.03] });
  }
  scene.updateMatrixWorld(true);

  // ---- cameras
  const camAt = (radial, lateral, h) => { const p = at(radial, lateral); return [p.x, h, p.z]; };
  const C = {
    plan: { pos: [-1, 46, 0.1], look: [-1, 0, 0], fov: 44 },
    before: { pos: [3.4, 1.15, 8.6], look: [-4.6, 1.5, -6.0], fov: 38 },
    seam: { pos: camAt(dP + 2.6, 5.9, 1.2), look: camAt(dP - 0.7, -0.6, 1.15), fov: 46 },
    makeover: { pos: camAt(dP + 1.5, 3.5, 1.5), look: camAt(dP - 0.35, -1.0, 1.15), fov: 34 },
    after: { pos: [4.5, 2.1, 10.5], look: [-1.5, 1.6, 0], fov: 42 },
  }[shot];
  // ---- staging per shot
  const crowd = [];   // [radial, lateral, variant, faceTowards(radial, lateral)]
  if (mode === 'before') {
    crowd.push([6.0, -3.5, 0], [7.2, 1.0, 1], [8.6, -1.8, 2], [10.0, 2.8, 4], [11.6, -4.2, 5], [9.4, 5.0, 3], [13.2, 0.6, 6], [12.2, -6.5, 1], [5.2, 4.2, 6]);
  } else if (mode === 'seam') {
    // behind the front: dressed and alive; on the front: mid-makeover; ahead: dead
    crowd.push([dP - 4.6, -2.2, 0], [dP - 3.6, 2.6, 3], [dP - 6.2, 0.4, 4], [dP - 2.8, -5.2, 5], [dP - 1.9, 5.8, 2]);
    crowd.push([dP - 0.7, -2.0, 1], [dP - 1.35, 1.9, 6]);
    crowd.push([dP + 1.6, -1.2, 2], [dP + 2.4, 2.4, 0], [dP + 3.4, -3.0, 5], [dP + 4.4, 0.6, 1], [dP + 5.2, 3.6, 3], [dP + 6.0, -1.8, 6], [dP + 7.4, 1.2, 4]);
  } else if (mode === 'makeover') {
    crowd.push([dP - 0.35, -1.55, 1]);          // the star of the closeup
    crowd.push([dP - 3.4, 1.8, 3], [dP - 2.6, -3.8, 5], [dP + 2.0, 1.6, 2], [dP + 3.0, -0.6, 0], [dP + 4.4, 2.4, 6], [dP - 5, 0, 4]);
  } else if (mode === 'after') {
    const ring = [[3, 0], [3, 2.3], [3, -2.3], [5, 1.2], [5, -1.2], [5.2, 3.4], [5.2, -3.4], [7, 0], [7, 2.5], [7, -2.5], [8.6, 1.3], [8.6, -1.3], [2.0, 4.4], [2.0, -4.4]];
    ring.forEach(([r, l], i) => crowd.push([dP + r - 3.5, l * 1.25, i]));
  }
  const fT = mode === 'before' ? { x: O.x, z: O.z } : mode === 'after' ? { x: Pw.x + 1.5, z: Pw.z + 6 } : { x: Pw.x, z: Pw.z };
  const beat = 0.35;
  crowd.forEach(([rad, lat, vi], n) => {
    const z = newZ(vi + (n % 3) * 7);
    const p = at(rad, lat);
    const dist = Math.hypot(p.x - O.x, p.z - O.z);
    const k = mode === 'after' ? 1 : (R < 0 ? 0 : makeoverK(R, dist, 2.4));
    z.K.value = k;
    const ph = n * 0.37;
    const act = lerpPose(deadAct(n * 1.3, ph).pose, liveAct(beat, ph * 0.5, 1).pose, smooth(k * 1.4));
    const bob = liveAct(beat, ph * 0.5, 1).bob * smooth(k * 1.4);
    z.obj.position.y = bob; z.obj.rotation.z = 0;
    // dead ones turn toward the light (the machine / Pip); dressed ones turn to camera-ish
    const face = k < 0.5 ? { x: mode === 'before' ? O.x : Pw.x, z: mode === 'before' ? O.z : Pw.z } : { x: fT.x + 2.5 + (n % 3) * 0.6, z: fT.z + 8 };
    faceTo(z.obj, p.x, p.z, face.x, face.z, (Rr() - 0.5) * 0.35);
    const toCam = Math.atan2(C.pos[0] - p.x, C.pos[2] - p.z); let rel = toCam - z.obj.rotation.y; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const head = act.head.slice(); head[1] += Math.max(-1.05, Math.min(1.05, rel)) * 0.85;
    pose(z.obj, { ...act, head });
    z.obj.updateMatrixWorld(true);
  });

  // ---- the thread: from the machine's spool to Pip's needle, lying on the floor
  scene.updateMatrixWorld(true);
  if (mode === 'seam' || mode === 'makeover') {
    pip.needle.updateMatrixWorld(true); pip.needle.localToWorld(eyeW.set(0, -0.06 * 0.7, 0));
    const mp = new THREE.Vector3(); machine.localToWorld(mp.set(0.02, 0.7, 0));
    const pts = [mp.clone(), V(mp.x + 0.15, 0.45, mp.z + 0.4), V(O.x + u.x * 1.3 + 0.3, 0.05, O.z + u.z * 1.3)];
    for (let i = 2; i <= 9; i++) { const rr = 1.3 + (dP - 1.3) * (i - 1) / 9 * 1.0; pts.push(V(O.x + u.x * rr + tn.x * Math.sin(i * 1.25) * 0.55, 0.03, O.z + u.z * rr + tn.z * Math.sin(i * 1.25) * 0.55)); }
    pts.push(V(Pw.x - u.x * 0.6 + tn.x * 0.35, 0.03, Pw.z - u.z * 0.6 + tn.z * 0.35), V(Pw.x - u.x * 0.2 + 0.1, 0.35, Pw.z - u.z * 0.2), eyeW.clone().add(V(-0.1, -0.25, 0.05)), eyeW.clone());
    scene.add(threadTube(M, pts, 0.022, 0xff5fa8, 260));
    // the front, as running stitches on the floor
    const st = makeFrontStitches(scene, 220);
    const a0 = Math.atan2(u.z, u.x);
    st.userData.update(O, R, a0 - 0.62, a0 + 0.62, 0.4);
  }
  if (mode === 'before') {   // a tiny warm island: the machine's lamp
    const l = new THREE.PointLight(0xffd9a0, 22, 7, 1.6); l.position.set(O.x + 0.6, 2.4, O.z + 1.4); scene.add(l);
  }

  // ---- scenery: bunting, fluorescent tubes, dust, sparkles
  function bunting(a, b, sag, n, cols, K = null) {
    const g = new THREE.Group(); M.currentK = K;
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3((a.x + b.x) / 2, Math.min(a.y, b.y) - sag, (a.z + b.z) / 2), b);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 5, false), M.thread(0xfff4e0)));
    for (let i = 1; i < n; i++) {
      const t = i / n, p = curve.getPoint(t);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.0, 0.02, 3), M.cloth(cols[i % cols.length], { rep: 3 })); f.rotation.set(PI / 2, 0, PI); f.scale.set(1, 1, 1.35); f.position.set(p.x, p.y - 0.24, p.z); f.castShadow = true; g.add(f);
    }
    scene.add(g); M.currentK = null;
  }
  const pc = [0xff9ecb, 0xffe066, 0x9fe3ff, 0xd9a7ff, 0xb6ffd6];
  bunting(V(-11.5, 5.0, -4.0), V(6.5, 4.6, -4.6), 1.1, 34, pc);
  bunting(V(-9.0, 4.2, 1.5), V(3.5, 4.3, 0.6), 0.8, 24, pc);
  if (mode !== 'after') {
    const on = (mode === 'before') ? [[1.8, -1.6, 0.05, 90], [4.6, -5.4, -0.15, 0], [8.0, -3.6, 0.1, 70], [-1.5, 3.8, -0.1, 0], [6.4, 2.2, 0.0, 80]] : [[dP * u.x + O.x + 4, 6.2, 0.0, 70], [O.x + u.x * (dP + 5) + 2, 6.2, 0.1, 60], [O.x + u.x * (dP + 8) - 3, 6.2, -0.1, 0]];
    (mode === 'before' ? on : on.map(([x, y, a, c], i) => [x, O.z + u.z * (dP + 3 + i * 2.5), a, c])).forEach(([x, z, a, c]) => tube(scene, x, 6.4, z, 1.8, a, c, [x, z]));
    if (mode === 'before') [[-4, -3, 0.1], [0, -8, -0.1], [-8, -1, 0.0]].forEach(([x, z, a]) => tube(scene, x, 6.4, z, 1.8, a, 0, null));
  }
  dust(scene, mode === 'after' ? 0 : 160, { x0: -10, x1: 14, y0: 0.3, y1: 6.5, z0: -10, z1: 10 }, 5, 0.3);
  if (mode === 'after') { const cf = makeConfetti(scene, 500, { x0: -9, x1: 9, y0: 0, y1: 8, z0: -6, z1: 9 }); cf.userData.update(1.7); }
  sparkles(scene, mode === 'after' ? 30 : 14, { x0: O.x + u.x * (dP - 5) - 5, x1: O.x + u.x * (dP + 1) + 5, y0: 0.9, y1: 3.8, z0: O.z + u.z * (dP - 5) - 5, z1: O.z + u.z * (dP + 1) + 5, s0: 0.1, s1: 0.28 }, 4);

  if (mode === 'seam' || mode === 'makeover' || mode === 'before') {
    const bp = mode === 'before' ? [[-1.0, 0.5], [2.6, -2.5], [0.4, -6.5]] : [[dP + 3.2, 2.8], [dP + 5.5, -2.4], [dP + 8.0, 1.0]].map(([r, l]) => { const p = at(r, l); return [p.x, p.z]; });
    bp.forEach(([x, z]) => beam(scene, x, z, 0x9cc0ff, 1.35, 12, [0, 0], 0.13));
  }
  // ---- lights
  const warm = (mode === 'after') ? 1.6 : 1.0;
  key.position.set(-3.5, 9, 6); key.target.position.set(-2, 1, 0.5); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(SHADOW, SHADOW); Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 36 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  key.intensity = mode === 'before' ? 0.55 : (mode === 'after' ? 2.6 : 1.5);
  scene.add(new THREE.HemisphereLight(mode === 'before' ? 0xa8b8ff : 0xffe8dc, mode === 'before' ? 0x303860 : 0xd8b0b8, mode === 'before' ? 0.5 : (mode === 'after' ? 0.75 : 0.42)));
  if (mode !== 'before') spot(0xffd6a8, 190 * warm, 24, 0.62, 0.7, 1.2, [Pw.x - 1.5, 8, Pw.z + 2], [Pw.x - 2.5, 0.6, Pw.z - 1.5]);
  if (mode === 'seam' || mode === 'makeover') { spot(0xffb98a, 90, 30, 0.7, 0.6, 1.2, [O.x + 2, 5, O.z + 3], [O.x + u.x * 5, 1, O.z + u.z * 5]); spot(0x8fb4ff, 110, 40, 0.9, 0.6, 1.1, [Pw.x + u.x * 9 + 3, 7, Pw.z + u.z * 9], [Pw.x + u.x * 5, 0.6, Pw.z + u.z * 5]); }
  if (mode === 'before') { spot(0x9ab8ff, 130, 40, 0.8, 0.7, 1.1, [2, 8, 4], [-2, 0, -2]); spot(0xffc890, 90, 14, 0.6, 0.7, 1.4, [O.x + 2.5, 6, O.z + 3.5], [O.x + 0.2, 0.4, O.z + 0.4]); }
  if (mode === 'after') {
    spot(0xff9ecb, 150, 30, 0.8, 0.6, 1.2, [-8, 5, -1], [-1, 1, 1]); spot(0x9fe3ff, 150, 30, 0.8, 0.6, 1.2, [7, 5, -1], [-1, 1, 1]);
    beam(scene, -3.5, -1.0, 0xff7fc8, 1.2, 12, [0, 0.05], 0.22); beam(scene, 1.5, 2.0, 0x8fe8ff, 1.0, 12, [0, -0.05], 0.18); beam(scene, 3.5, -2.5, 0xffe27a, 1.1, 12, [0.02, 0], 0.16);
  }

  setCam(C.pos, C.look, C.fov);
  post = makePost(renderer, scene, cam, style, W, H, { band: mode === 'makeover' ? 0.34 : 0.42, tilt: 1.8, focusY: 0.5, noBokeh: true });
  window.__dbg = { O, Pw, dP, u };
}

// ---------------------------------------------------------------- legacy look-dev shot ("the fitting") : vinyl tests
async function buildLegacy() {
  const pip = buildCharacter(M, { skin: 0xf2bb95, hair: 0x4b2418, streak: 0xff4fa3, eye: 0x6a3dff, dress: [0xfff3fa, 0xffd0e8, 0xffffff], bodice: 0xff2f86, bow: 0xff2f86, shoe: 0xff2f86, sock: 0xffffff, sockTrim: 0xff2f86, wink: true, tape: true, scrunchie: 0xffe066, uK: { value: 1 } });
  const zombie = (i, extra = {}) => makeZombie(M, i, { ...extra }).obj;
  const hem = zombie(0); hem.userData.J && 0;
  scene.add(pip, hem);
  pose(pip, { shL: [0, 0, -0.85], elL: [0, 0, 1.75], shR: [-0.35, 0, 2.05], elR: [0, 0, -0.9], head: [0.03, -0.28, -0.12], body: [0, 0.0, 0.03] });
  pose(hem, { shL: [-1.30, 0, -0.16], elL: [-0.25, 0, 0], shR: [-1.20, 0, 0.22], elR: [-0.3, 0, 0], head: [0.05, 0.28, 0.2], body: [0.02, 0, -0.03] });
  { const J = pip.userData.J; const sc = makeScissors(M); sc.position.set(0, -0.215, 0.0); sc.rotation.set(0, PI / 2, 0.15); J.elR.add(sc);
    const pc = makePinCushion(M); pc.position.set(-0.01, -0.13, 0.05); pc.scale.setScalar(0.85); J.elL.add(pc);
    const cl = makeClutch(M, 0xff9be2); cl.position.set(0, -0.26, 0.05); cl.rotation.set(1.2, 0.3, 0); hem.userData.J.elR.add(cl); }
  pip.position.set(-1.35, 0, 0.9); pip.rotation.y = 0.5; hem.position.set(0.95, 0.25, 0.1); hem.rotation.y = -0.42;
  const crowd = [[-3.7, -3.0], [-2.3, -4.6], [3.5, -2.4], [4.8, -3.9], [2.0, -5.2], [-0.7, -6.0], [6.3, -5.4], [-5.2, -5.2]];
  crowd.forEach(([x, z], i) => { const c = zombie(i + 1); pose(c, { shL: [-1.15 - Rr() * 0.3, 0, -0.15], elL: [-0.25, 0, 0], shR: [-1.05 - Rr() * 0.3, 0, 0.15], elR: [-0.3, 0, 0], head: [0.05, 0, (Rr() - 0.5) * 0.5], body: [0, 0, (Rr() - 0.5) * 0.08] }); scene.add(c); c.position.set(x, 0, z); c.rotation.y = Math.atan2(0.9 - x, 0.6 - z) + (Rr() - 0.5) * 0.3; });
  scene.traverse((o) => { if (o.material && o.material.userData && o.material.userData.uK) o.material.userData.uK.value = 1; });
  bokeh(scene, felt ? 26 : 90, 9, style);
  sparkles(scene, felt ? 10 : 48, { x0: -7, x1: 7, y0: 0.6, y1: 5.2, z0: -5, z1: 3.5, s0: 0.22, s1: 0.75 }, 4);
  M.currentK = { value: 1 };
  await buildTitle(scene, M, 'ZOMBIE COUTURE', { size: 0.8, color: felt ? 0xff6fa8 : 0xff2f86, pos: new THREE.Vector3(0.1, 3.75, -5.2) });
  M.currentK = null;
  FRONT.uAlive.value = 1;       // legacy shots: the whole world is alive
  if (!felt) { beam(scene, 0.95, 0.1, 0xff7fc8, 1.25, 11, [0, 0], 0.30); beam(scene, -1.35, 0.9, 0x8fe8ff, 1.0, 11, [0, 0], 0.22); beam(scene, 5.2, -2.5, 0xffe27a, 1.0, 11, [0, 0.05], 0.16); beam(scene, -5.4, -3.0, 0xc09cff, 1.0, 11, [0, -0.05], 0.16); }
  key.position.set(-4.5, 8, 7); key.target.position.set(0, 1, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(SHADOW, SHADOW); Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = felt ? 5 : 3;
  scene.add(new THREE.HemisphereLight(felt ? 0xffe8dc : 0xf4eeff, felt ? 0xe8c0c8 : 0xa890ff, felt ? 1.0 : 0.5));
  const rimA = new THREE.SpotLight(felt ? 0xffb37a : 0x4fd8ff, felt ? 90 : 260, 30, 0.6, 0.6, 1.2); rimA.position.set(-6, 5, -4); rimA.target.position.set(0.3, 1, 0.5); scene.add(rimA, rimA.target);
  const rimB = new THREE.SpotLight(felt ? 0xff9a9a : 0xff3fa0, felt ? 90 : 150, 30, 0.6, 0.6, 1.2); rimB.position.set(6.5, 5, -3.5); rimB.target.position.set(0.3, 1, 0.5); scene.add(rimB, rimB.target);
  const SHOTS = {
    hero: { pos: [-0.2, 1.3, 5.2], look: [-0.1, 1.5, 0.3], fov: 38, focus: 5.2, post: { aperture: 0.00014, maxblur: 0.006 } },
    face: { pos: [-0.4, 1.5, 3.0], look: [-1.3, 1.42, 0.9], fov: 26, focus: 2.4, post: { aperture: 0.0006, maxblur: 0.02 } },
    hface: { pos: [0.9, 1.9, 3.0], look: [0.95, 1.7, 0.1], fov: 26, focus: 2.9, post: { aperture: 0.0006, maxblur: 0.02 } },
    low: { pos: [0.3, 0.42, 6.2], look: [0.0, 1.15, 0.3], fov: 34, focus: 6.4, post: { aperture: 0.0004, maxblur: 0.018 } },
    cctv: { pos: [-8.6, 6.4, 9.5], look: [0.6, 0.9, -2.4], fov: 52, focus: 14, post: { aperture: 0.00002, maxblur: 0.002, bloom: 0.2 } },
  };
  const sh = SHOTS[shot]; setCam(sh.pos, sh.look, sh.fov);
  post = makePost(renderer, scene, cam, style, W, H, { focus: sh.focus, ...(sh.post || {}), band: 0.30, tilt: 3.2, focusY: 0.48, noBokeh: NOBOKEH });
}

// die-cut margin: an inverted hull pushed out along the normals, off-white like the paper core. Big parts only (no halos around eye highlights).
function dieCut(root, color = 0xfffaf0, w = 0.02) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${w.toFixed(4)};`); };
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.normal || (o.material && (o.material.transparent || o.material.isMeshBasicMaterial))) return;
    o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y) >= 0.075) meshes.push(o);
  });
  for (const m of meshes) { const h = new THREE.Mesh(m.geometry, mat); h.castShadow = false; h.receiveShadow = false; m.add(h); }
}

let story = null;
async function buildStoryShot() {
  story = buildStory({ scene, M, S, key, cam, shadow: SHADOW, quality: q.get('quality') || 'full' });
  // flat=0.07 squashes every character into a paper doll (proposal C mock); fuzz/mottle off so wool reads as card
  const flat = +(q.get('flat') || (PAPER ? 0.07 : 0));
  if (flat > 0) {
    [story.pip, ...story.crowd.map((c) => c.z)].forEach((c) => { c.obj.scale.z = flat; if (PAPER) dieCut(c.obj); });
    FRONT.uFuzz.value = PAPER ? 0.0 : 0.06; FRONT.uMott.value = PAPER ? 0.03 : 0.05;
  }
  post = makePost(renderer, scene, cam, style, W, H, { band: 0.42, tilt: 1.8, focusY: 0.5, noBokeh: true });
  // dead=1 forces the whole scene back to the un-sewn state at any t (same camera, same poses): the 'before' half of a before/after pair
  const FORCE_DEAD = q.get('dead') === '1';
  // puppet=12 steps the puppets (and the front they sew) at 12 poses a second while the camera, lights and particles stay smooth; hand=1 adds fibre boil and a nudge per pose
  const PUPPET = +(q.get('puppet') || 0), HAND = q.get('hand') === '1';
  window.setT = (t, rig) => {
    const o = rig ? { rig } : {};
    if (PUPPET > 0) o.tp = Math.floor(t * PUPPET + 1e-6) / PUPPET;
    if (HAND) o.touch = 1;
    story.update(t, o);
    if (FORCE_DEAD) { FRONT.uFront.value.w = -1; FRONT.uAlive.value = 0; FRONT.uFlicker.value = 0.97; story.crowd.forEach((c) => { c.z.K.value = 0; }); story.confetti.visible = false; }
  };
  window.setT(+(q.get('t') || 0), q.get('rig') || undefined);
}

// ---------------------------------------------------------------- the cast line-up (k=0 dead, k=1 made over): same camera, same places, so the two renders can be compared with a slider
async function buildCast() {
  const kk = +(q.get('k') || 0), flat = +(q.get('flat') || 0);
  scene.fog = null; scene.background = new THREE.Color(kk ? 0xf6d6e6 : 0x141826);
  FRONT.uFront.value.set(0, 0.5, 0, -1); FRONT.uAlive.value = kk; FRONT.uFlicker.value = kk ? 1 : 0.97;
  S.ped.visible = false; S.floor.visible = false; S.barricade.visible = false;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), M.matte(kk ? 0xf3c7da : 0xc9c3e6, { rep: 200 })); floor.rotation.x = -PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 24), M.matte(kk ? 0xe9d6fb : 0xbfc4e8, { rep: 200 })); wall.position.set(0, 12, -3.2); wall.receiveShadow = true; scene.add(wall);
  const list = [makeZombie(M, 0), makeZombie(M, 1), makeZombie(M, 2), makePip(M), makeZombie(M, 3), makeZombie(M, 4), makeZombie(M, 5), makeZombie(M, 6)];
  list.forEach((c, i) => {
    scene.add(c.obj);
    if (c.kind === 'zombie') c.K.value = kk;
    const act = c.kind === 'pip' ? liveAct(0.35, 0, 1) : (kk ? liveAct(0.25 + i * 0.13, i * 0.37, 0.8) : deadAct(1.2 + i * 0.4, i * 1.7));
    applyAct(c, act, { x: (i - 3.5) * 1.16, y: 0, z: (i % 2) * 0.32, rotY: (i % 2 ? -0.14 : 0.14) * (c.kind === 'pip' ? 0.5 : 1) });
    if (flat > 0) c.obj.scale.z = flat;
  });
  if (flat > 0) { FRONT.uFuzz.value = 0.06; FRONT.uMott.value = 0.05; }
  key.position.set(-4, 7, 8); key.target.position.set(0, 1, 0); scene.add(key, key.target);
  key.castShadow = true; key.shadow.mapSize.set(SHADOW, SHADOW); Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(new THREE.HemisphereLight(0xfff0f6, 0xc8b0e0, 0.8));
  const fillL = new THREE.PointLight(0xfff2e6, 26, 24, 1.4); fillL.position.set(3, 3.5, 7); scene.add(fillL);
  const rimL = new THREE.SpotLight(kk ? 0xffb0d8 : 0x8fb4ff, 90, 30, 0.7, 0.6, 1.2); rimL.position.set(5, 5, -4); rimL.target.position.set(0, 1, 0); scene.add(rimL, rimL.target);
  cam.position.set(0, 1.25, 11.2); cam.lookAt(0, 1.18, 0); cam.fov = 17; cam.updateProjectionMatrix();
  post = makePost(renderer, scene, cam, style, W, H, { band: 0.5, tilt: 1.0, focusY: 0.5, noBokeh: true });
}
const FRONT_SHOTS = ['plan', 'before', 'seam', 'makeover', 'after'];
// ?shot=preview&p=<module>: web/preview/<module>.js exports run(env); the module builds whatever it wants and calls env.setPost(...) and defines window.setT(t)
async function buildPreview() {
  const mod = await import(`./preview/${q.get('p') || 'set'}.js`);
  await mod.run({ THREE, renderer, scene, M, S, FRONT, cam, q, W, H, style, makePost, makeKit, setPost: (p) => { post = p; }, rng, SHADOW, LITE, PAPER });
}
// ?shot=film: the whole music video as a pure function of song time (web/film/film.js); it defines window.setT / setView / shoot / filmInfo itself
async function buildFilmShot() {
  const mod = await import('./film/film.js');
  await mod.buildFilm({ THREE, renderer, scene, M, S, FRONT, cam, q, W, H, style, makePost, makeKit, setPost: (p) => { post = p; }, rng, SHADOW, LITE });
}
try {
  if (shot === 'film') await buildFilmShot(); else if (shot === 'preview') await buildPreview(); else if (shot === 'story') await buildStoryShot(); else if (shot === 'cast') await buildCast(); else if (FRONT_SHOTS.includes(shot)) await buildFront(); else await buildLegacy();
} catch (e) { console.error('BUILD FAILED: ' + (e && e.stack || e)); window.__err = String(e && e.stack || e); }
renderer.info.autoReset = false;   // info() then reports the whole frame (shadow + scene + post passes), not just the last full-screen pass
if (!window.shoot) window.shoot = (fmt = 'png') => { post.grade.uniforms.time.value = 0.37; FRONT.uTime.value = 0.37; renderer.info.reset(); post.composer.render(); return fmt === 'jpg' ? canvas.toDataURL('image/jpeg', 0.94) : canvas.toDataURL('image/png'); };
window.info = () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0 });
window.ready = true;
