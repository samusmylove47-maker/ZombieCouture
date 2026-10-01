// Procedural fashion-doll characters: the Designer (Pip) and the undead clientele (Hem & co.).
// Everything is built from primitives so the look is fully controlled and every joint is animatable.
import * as THREE from 'three';
import { stitchify, sewDepth } from './stitch.js';
import { makeMouth, makeLid, makeMargin, PIP_REST, ZOMBIE_REST, ZOMBIE_LID_Y } from './face.js';
const PI = Math.PI;

export function dirAt(az, el) {
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export function add(parent, geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true;
  if (mat.userData && mat.userData.sew && mat.userData.uK) m.customDepthMaterial = (mat.userData.uK.__depth ||= sewDepth(mat.userData.uK));
  parent.add(m); return m;
}

// place a mesh on a sphere of radius R at (azimuth, elevation), facing outward
function onSurface(parent, R, az, el, geo, mat, o = {}) {
  const d = dirAt(az, el);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(d.clone().multiplyScalar(R * (o.k ?? 1)));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  if (o.roll) m.rotateZ(o.roll);
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  m.castShadow = o.cast ?? false; m.receiveShadow = false;
  if (mat.userData && mat.userData.sew && mat.userData.uK) m.customDepthMaterial = (mat.userData.uK.__depth ||= sewDepth(mat.userData.uK));
  m.userData.sf = { az, el, k: o.k ?? 1, roll: o.roll || 0 };
  parent.add(m); return m;
}

function smoothProfile(pts, n = 28) {
  const c = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1])));
  return c.getPoints(n);
}

// ruffled / pinked skirt tier
export function skirtGeo(profile, { segs = 112, amp = 0.03, n = 12, zig = false, phase = 0 } = {}) {
  const geo = new THREE.LatheGeometry(smoothProfile(profile), segs);
  const pos = geo.attributes.position;
  const yMax = profile[0][1], yMin = profile[profile.length - 1][1];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x), r = Math.hypot(x, z);
    const w = Math.pow(Math.max(0, (yMax - y) / (yMax - yMin)), 1.7);
    let s;
    if (zig) { const f = ((a * n / (2 * PI)) % 1 + 1) % 1; s = Math.abs(f * 2 - 1) * 2 - 1; }
    else s = Math.sin(a * n + phase);
    const r2 = r * (1 + amp * w * s);
    pos.setXYZ(i, Math.cos(a) * r2, y - amp * 0.7 * w * (s * 0.5 + 0.5) * (zig ? 1.2 : 1), Math.sin(a) * r2);
  }
  geo.computeVertexNormals();
  return geo;
}

const cap = (r, l, s = 8, h = 16) => new THREE.CapsuleGeometry(r, l, s, h);
const sph = (r, w = 32, h = 20) => new THREE.SphereGeometry(r, w, h);

// ---------- props ----------
export function makePin(M, color = 0xff5fa8) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.0022, 0.0022, 0.06, 6), M.metal(0xdddddd), { y: 0.03, cast: false });
  add(g, sph(0.0075, 12, 8), M.plastic(color), { y: 0.062, cast: false });
  return g;
}

export function makePinCushion(M) {
  const g = new THREE.Group();
  add(g, sph(0.05, 24, 16), M.cloth(0xff4b5c), { sy: 0.7 });
  add(g, new THREE.TorusGeometry(0.05, 0.007, 8, 24), M.plastic(0xffe27a), { rx: PI / 2, y: 0.0, sx: 1.05, sy: 1.05 });
  const cols = [0xffffff, 0xffe066, 0x66e0ff, 0xb388ff, 0xff9ecb];
  for (let i = 0; i < 9; i++) {
    const p = makePin(M, cols[i % cols.length]);
    const a = i * 0.9 + 0.3, tilt = 0.3 + (i % 3) * 0.18;
    p.position.set(Math.cos(a) * 0.028, 0.02, Math.sin(a) * 0.028);
    p.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    g.add(p);
  }
  return g;
}

export function makeScissors(M) {
  const g = new THREE.Group();
  const blade = M.metal(0xe8eef5), handle = M.plastic(0xff3d8b);
  for (const s of [-1, 1]) {
    const b = add(g, new THREE.BoxGeometry(0.014, 0.19, 0.004), blade, { x: s * 0.008, y: 0.11, rz: s * -0.045 });
    b.geometry.translate(0, 0, 0);
    add(g, new THREE.TorusGeometry(0.03, 0.0075, 10, 24), handle, { x: s * 0.03, y: -0.03, rz: s * 0.1 });
  }
  add(g, sph(0.0075, 10, 8), M.metal(0xaaaaaa), { y: 0.03, z: 0.004 });
  return g;
}

export function makeTape(M, len = 1.2) {
  // soft yellow measuring tape draped as a ribbon
  const pts = [new THREE.Vector3(-0.09, 1.16, 0.09), new THREE.Vector3(-0.15, 1.02, 0.14), new THREE.Vector3(-0.1, 0.92, 0.16), new THREE.Vector3(0.09, 1.02, 0.16), new THREE.Vector3(0.15, 1.16, 0.09)];
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 40, 0.014, 6, false);
  const mat = M.matte(0xffd83a);
  return new THREE.Mesh(geo, mat);
}

export function makeClutch(M, color = 0xff8ad4) {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.16, 0.1, 0.045), M.plastic(color, { rough: 0.15 }), { });
  add(g, sph(0.016, 12, 8), M.metal(0xffe08a), { y: 0.05, z: 0.024 });
  add(g, new THREE.TorusGeometry(0.03, 0.004, 6, 20, PI), M.metal(0xffe08a), { y: 0.05 });
  return g;
}

export function makeBow(M, color, s = 1) {
  const g = new THREE.Group();
  for (const sd of [-1, 1]) {
    const lobe = add(g, sph(0.055 * s, 20, 12), M.satin(color), { x: sd * 0.06 * s, sx: 1.25, sy: 0.72, sz: 0.5, rz: sd * 0.25 });
    void lobe;
  }
  add(g, sph(0.03 * s, 16, 10), M.satin(color), { sz: 0.9 });
  for (const sd of [-1, 1]) add(g, cap(0.012 * s, 0.12 * s, 4, 8), M.satin(color), { x: sd * 0.025 * s, y: -0.07 * s, rz: sd * 0.35 });
  return g;
}

// ---------- the character ----------
export function buildCharacter(M, o) {
  M.currentK = o.uK ?? null;
  const zombie = !!o.zombie;
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);        // g = body (for sway / lean)
  const J = { root, body: g };
  const skin = M.skin(o.skin);
  const skin2 = M.skin(o.skin2 ?? o.skin);         // mismatched limb for the zombies
  const ink = M.ink();
  const dress = o.dress ?? [0xffb3d9, 0xffd6ec, 0xffffff];

  // The couture is "sewn on": for zombies these parts do not exist until the thread has climbed past them (see stitch.js).
  const sewOn = zombie && o.sew !== false;
  const sewing = (on) => { M.sew = on; };

  // shoes + legs (a zombie starts barefoot; the shoes and socks are sewn on)
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.085, 0.58, 0); g.add(hip);      // legs swing from the hip
    const leg = new THREE.Group(); leg.position.set(0, -0.58, 0); hip.add(leg);
    sewing(sewOn);
    add(leg, new THREE.CylinderGeometry(0.1, 0.108, 0.085, 32), M.plastic(o.shoe ?? 0xff4fa3, { rough: 0.15 }), { y: 0.045 });
    add(leg, sph(0.1, 24, 14), M.plastic(o.shoe ?? 0xff4fa3, { rough: 0.15 }), { y: 0.1, z: 0.035, sx: 0.85, sy: 0.55, sz: 1.35 });
    add(leg, new THREE.TorusGeometry(0.06, 0.009, 8, 24), M.plastic(0xffffff), { y: 0.135, rx: PI / 2 });
    add(leg, new THREE.CylinderGeometry(0.0395, 0.0395, 0.2, 20), M.cloth(o.sock ?? 0xffffff), { y: 0.25 });
    add(leg, new THREE.TorusGeometry(0.0395, 0.007, 8, 20), M.plastic(o.sockTrim ?? 0xff4fa3), { y: 0.345, rx: PI / 2 });
    sewing(false);
    add(leg, cap(0.034, 0.44), (zombie && s === 1 ? skin2 : skin), { y: 0.36 });
    if (zombie) add(leg, sph(0.072, 20, 12), (s === 1 ? skin2 : skin), { y: 0.052, z: 0.03, sx: 0.85, sy: 0.5, sz: 1.4 });   // bare foot
    J[s < 0 ? 'legL' : 'legR'] = hip;
  }

  // the rags a zombie wears until it is dressed: a torn grey tunic under the future dress
  if (zombie) {
    const rag = M.cloth(o.rag ?? 0x8c8f9b, { rep: 4 });
    add(g, skirtGeo([[0.001, 1.19], [0.14, 1.17], [0.165, 1.08], [0.19, 0.9], [0.225, 0.7], [0.245, 0.56]], { amp: 0.05, n: 9, zig: true, phase: 0.8 }), rag);
    add(g, new THREE.BoxGeometry(0.1, 0.1, 0.012), M.cloth(o.ragPatch ?? 0xa7a08a, { rep: 2 }), { x: -0.06, y: 0.78, z: 0.2, rx: -0.15, rz: 0.2 });
  }

  // skirt tiers (couture: three layers with different edges)
  const t = o.tiers ?? {};
  sewing(sewOn);
  add(g, skirtGeo([[0.12, 0.95], [0.19, 0.9], [0.29, 0.78], [0.365, 0.67], [0.41, 0.57]], { amp: t.a1 ?? 0.03, n: 14, zig: !!o.zigHem, phase: 0.4 }), M.cloth(dress[0], { sheenColor: 0xffffff }));
  add(g, skirtGeo([[0.125, 0.965], [0.2, 0.92], [0.3, 0.83], [0.37, 0.73], [0.42, 0.65]], { amp: t.a2 ?? 0.04, n: 11, phase: 1.3 }), M.cloth(dress[1], { sheenColor: 0xffffff }));
  add(g, skirtGeo([[0.13, 0.985], [0.2, 0.95], [0.27, 0.875], [0.315, 0.8], [0.345, 0.74]], { amp: t.a3 ?? 0.03, n: 9, phase: 2.2 }), M.satin(dress[2]));
  if (o.waistBow !== false) {
    const b = makeBow(M, o.bow ?? 0xff3d8b, 1.15); b.position.set(0, 0.965, 0.14); b.rotation.x = -0.25; g.add(b);
  }
  if (M.felt) {   // blanket-stitch ring at the waist and along each tier
    const K = M.currentK;
    const mk = (r, y, col) => { const n = Math.floor(r * 46); const gg = new THREE.CapsuleGeometry(0.0055, 0.03, 2, 4); gg.rotateZ(PI / 2);
      const mm = new THREE.MeshStandardMaterial({ color: col, roughness: 1 }); if (K) stitchify(mm, K, sewOn);
      const im = new THREE.InstancedMesh(gg, mm, n); const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion();
      for (let i = 0; i < n; i++) { const a = i / n * PI * 2; q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a); m4.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q4, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m4); } g.add(im); };
    mk(0.152, 0.99, 0xfff4e0); mk(0.29, 0.86, o.stitch ?? 0xffe066);
  }
  // bodice + puff sleeves
  const bod = new THREE.LatheGeometry(smoothProfile([[0.001, 0.93], [0.125, 0.94], [0.145, 1.0], [0.155, 1.07], [0.14, 1.14], [0.09, 1.185], [0.001, 1.19]], 24), 64);
  add(g, bod, M.satin(o.bodice ?? 0xff3d8b));
  for (const s of [-1, 1]) add(g, sph(0.065, 20, 14), M.satin(o.bodice ?? 0xff3d8b), { x: s * 0.16, y: 1.12, sy: 0.85 });
  sewing(false);
  add(g, cap(0.046, 0.06), skin, { y: 1.2 });          // neck

  // arms
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.165, 1.115, 0); g.add(sh);
    add(sh, cap(0.031, 0.15), s === 1 && zombie ? skin2 : skin, { y: -0.11 });
    const el = new THREE.Group(); el.position.set(0, -0.215, 0); sh.add(el);
    add(el, cap(0.028, 0.125), s === 1 && zombie ? skin2 : skin, { y: -0.1 });
    add(el, new THREE.CylinderGeometry(0.036, 0.036, 0.03, 20), M.cloth(0xffffff), { y: -0.005 });
    add(el, sph(0.043, 20, 14), s === 1 && zombie ? skin2 : skin, { y: -0.215 });
    sh.rotation.z = s * 0.14;
    J[s < 0 ? 'shL' : 'shR'] = sh; J[s < 0 ? 'elL' : 'elR'] = el;
  }

  // head
  const head = new THREE.Group(); head.position.set(0, 1.4, 0.0); g.add(head);
  J.head = head;
  const R = 0.32;
  const skull = add(head, sph(R, 64, 40), skin, { sx: 1.06, sy: 0.99, sz: 1.0 });
  void skull;
  buildFace(M, head, R, o, zombie, skin, ink);
  if (zombie) buildZombieHead(M, head, R, o, ink); else buildDesignerHair(M, head, R, o);

  // wardrobe accents
  if (o.tape) g.add(makeTape(M));
  if (o.stuffing) {   // a tuft of cotton wadding escaping a seam
    const cot = M.cloth(0xfffaf0, { rep: 8 });
    for (const [x, y, z, r] of [[0.16, 1.02, 0.09, 0.034], [0.19, 1.045, 0.07, 0.026], [0.14, 1.06, 0.1, 0.022], [0.2, 1.0, 0.05, 0.02]]) add(g, sph(r, 14, 10), cot, { x, y, z });
  }
  if (o.headScale) head.scale.setScalar(o.headScale);
  if (o.height) root.scale.setScalar(o.height);
  M.currentK = null; M.sew = false;
  root.userData.J = J;
  return root;
}

// Face. The static decals are as they always were; the mouth, the eyelids and the lid line are small dynamic meshes (face.js).
// All handles go to head.userData.face, which rigFace() picks up. Unrigged characters simply keep the resting face.
function buildFace(M, head, R, o, zombie, skin, ink) {
  const eyeCol = o.eye ?? 0x5b3dff;
  const az = 0.44;
  const FH = { R, zombie, cloudy: !!(zombie && o.cloudy), eyes: [], brows: [], blush: null, mouth: null, teeth: [], wink: null };
  head.userData.face = FH;
  // A zombie's eyes are blank clouded orbs until the thread reaches its head; then irises, pupils, highlights and the button are sewn in.
  const sewEyes = zombie && o.sew !== false && !o.cloudy;
  for (const s of [-1, 1]) {
    const E = { s, az: s * az, el: 0.03, blank: null, white: null, iris: null, pupil: null, hl: null, hl2: null, lash: null, flicks: [], lidU: null, lidL: null, margin: null, button: null, cloudyEye: false };
    FH.eyes.push(E);
    const winkThis = o.wink && s === 1;
    if (zombie && o.cloudy) {
      M.sew = false; E.cloudyEye = true;
      onSurface(head, R, s * az, 0.03, sph(0.09, 28, 18), M.plastic(0xeef1e6, { rough: 0.5 }), { sx: 1.0, sy: 1.2, sz: 0.42, k: 0.995 });
      onSurface(head, R, s * az + s * 0.01, 0.0, sph(0.05, 20, 12), M.plastic(0xc9d6e4, { rough: 0.6 }), { sx: 1, sy: 1.1, sz: 0.4, k: 1.04 });
      const lid = onSurface(head, R, s * az, 0.09, sph(0.1, 24, 12, 0, PI * 2, 0, PI * 0.5), M.skin(o.skin), { sy: 0.7, sz: 0.5, k: 1.016 }); void lid;
      continue;
    }
    const buttonThis = zombie && s === 1;
    if (zombie) {   // the blank orb every zombie starts with
      M.sew = false;
      E.blank = onSurface(head, R, s * az, 0.03, sph(0.09, 28, 18), M.plastic(0xe4e9dc, { rough: 0.5 }), { sx: 1.0, sy: 1.2, sz: 0.42, k: 0.995 });
    }
    M.sew = sewEyes;
    const inkS = M.ink();
    if (buttonThis) {
      // one eye is a sewn-on button
      const b = onSurface(head, R, s * az, 0.03, new THREE.CylinderGeometry(0.075, 0.075, 0.03, 28), M.plastic(o.button ?? 0xffd45e, { rough: 0.2 }), { k: 1.0, cast: false });
      b.rotateX(PI / 2); E.button = b;
      for (const [hx, hy] of [[-0.02, -0.02], [0.02, -0.02], [-0.02, 0.02], [0.02, 0.02]]) {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.032, 10), inkS);
        hole.position.set(hx, 0, hy); b.add(hole);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 28), M.plastic(0xffb400, { rough: 0.2 })); rim.rotation.x = PI / 2; rim.position.y = 0.012; b.add(rim);
      // cross-threads
      for (const r of [0.7, -0.7]) { const th = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.006), M.thread(0x3b2a4d)); th.position.y = 0.019; th.rotation.y = r; b.add(th); }
      M.sew = false;
      continue;
    }
    if (winkThis) {
      const arc = onSurface(head, R, s * az, 0.03, new THREE.TorusGeometry(0.06, 0.011, 8, 24, PI), inkS, { k: 1.005 });
      arc.rotation.z += 0; arc.rotateZ(PI + 0);   // smiling arc "^"
      arc.rotateZ(PI);
      FH.wink = arc; E.wink = arc;
      M.sew = false;
      continue;
    }
    if (!zombie) E.white = onSurface(head, R, s * az, 0.03, sph(0.09, 28, 18), M.eyeWhite(), { sx: 1.0, sy: 1.2, sz: 0.4, k: 0.99 });
    E.iris = onSurface(head, R, s * az, 0.03, sph(0.08, 28, 18), M.plastic(zombie ? 0x8fa39a : eyeCol, { rough: 0.15 }), { sx: 1, sy: 1.18, sz: 0.42, k: 1.05 });
    E.pupil = onSurface(head, R, s * az, 0.03, sph(zombie ? (s < 0 ? 0.016 : 0.04) : 0.036, 20, 12), inkS, { sy: 1.15, sz: 0.5, k: 1.075 });
    const hlM = M.basic(0xffffff, { toneMapped: false });
    const hl = new THREE.Mesh(sph(0.02, 12, 8), hlM);
    const d = dirAt(s * az + 0.06, 0.1); hl.position.copy(d.multiplyScalar(R * 1.13)); head.add(hl);
    const hl2 = new THREE.Mesh(sph(0.011, 10, 6), hlM);
    const d2 = dirAt(s * az - 0.06, -0.06); hl2.position.copy(d2.multiplyScalar(R * 1.12)); head.add(hl2);
    E.hl = hl; E.hl2 = hl2;
    if (!zombie) {
      // upper lash line + two flicks
      const lash = onSurface(head, R, s * az, 0.03, new THREE.TorusGeometry(0.086, 0.0085, 6, 22, PI * 1.05), inkS, { k: 1.03, sz: 0.5 });
      lash.rotateZ(PI * 0.5 - PI * 0.525); E.lash = lash;
      for (let i = 0; i < 3; i++) {
        const f = onSurface(head, R, s * (az + 0.34 + i * 0.03), 0.09 + i * 0.075, cap(0.006, 0.05, 3, 6), inkS, { k: 1.03, roll: s * (0.9 + i * 0.35) });
        E.flicks.push(f);
      }
    }
    M.sew = false;
    // eyelids: skin-coloured shells that slide over the eye. Hidden while the lid is open (Pip); a zombie's is the heavy sleepy lid, always there.
    const lidMat = M.skin(o.skin);
    if (!zombie) {
      const dm = { az: s * az, el: 0.03, a: 0.100, b: 0.116, cz: 0.066, dx: -s * 0.006 };   // shifted toward the nose: the eyeball is more exposed on the inner side
      E.lidU = makeLid(M, head, R, { ...dm, mat: lidMat, yE0: 9, cols: 17, rows: 7 });
      E.lidL = makeLid(M, head, R, { ...dm, mat: lidMat, lower: true, yE0: -9, cols: 17, rows: 6 });
      E.margin = makeMargin(M, head, R, { ...dm, mat: M.ink(0x2b1a3a), hw: 0.0065 });
    } else {
      const dm = { az: s * az, el: 0.03, a: 0.100, b: 0.116, cz: 0.054, dx: -s * 0.006 };
      E.lidU = makeLid(M, head, R, { ...dm, mat: lidMat, yE0: ZOMBIE_LID_Y });
      E.margin = makeMargin(M, head, R, { ...dm, mat: M.ink(0x3a2a44), hw: 0.0052 });
    }
  }
  M.sew = false;
  // brows
  for (const s of [-1, 1]) {
    const el = 0.33 + (zombie && s === 1 ? 0.07 : 0) + (zombie ? 0 : 0.035), roll = PI / 2 + s * (zombie ? -0.25 : 0.12);
    const brow = onSurface(head, R, s * az, el, cap(0.0095, 0.075, 4, 8), ink, { k: 1.005, roll });
    FH.brows.push({ mesh: brow, s, az: s * az, el, roll, k: 1.005 });
  }
  // nose + blush
  onSurface(head, R, 0, -0.1, sph(0.02, 12, 8), M.skin(o.skin), { k: 1.03, sz: 0.8 });
  const blush = M.basic(zombie ? 0xc9e6a8 : 0xff8fb5, { transparent: true, opacity: zombie ? 0.5 : 0.55, depthWrite: false });
  const bl = [];
  for (const s of [-1, 1]) bl.push(onSurface(head, R, s * 0.72, -0.16, new THREE.CircleGeometry(0.055, 24), blush, { k: 1.004, sx: 1.25 }));
  FH.blush = { mat: blush, meshes: bl, opacity: zombie ? 0.5 : 0.55 };
  // mouth (dynamic, see face.js): Pip has lips, cavity, teeth band and tongue; a zombie a dark cavity, two buck teeth and a tongue for the moan
  if (!zombie) {
    FH.mouth = makeMouth(M, head, R, { az: 0, el: -0.34, roll: 0, cols: 17, init: PIP_REST, lips: M.ink(0x45142f), cavity: M.ink(0x8a1638), teeth: M.basic(0xffffff), tongue: M.basic(0xff6f8f), tongueW: 0.5 });
  } else {
    FH.mouth = makeMouth(M, head, R, { az: 0.05, el: -0.36, roll: 0.08, cols: 15, init: ZOMBIE_REST, cavity: M.ink(0x3a1c3a), tongue: M.basic(0x9a4f78), tongueW: 0.52 });
    for (const dx of [-0.028, 0.024]) {
      const t = onSurface(head, R, 0.05 + dx, -0.322, new THREE.BoxGeometry(0.033, 0.045, 0.01), M.plastic(0xfff7d8, { rough: 0.3 }), { k: 1.006, roll: dx * 2 });
      FH.teeth.push({ mesh: t, dx });
    }
  }
}

function buildZombieHead(M, head, R, o, ink) {
  const thread = M.thread(0x3b2a4d);
  // seam over the left cheek: a dark stitched line with cross-stitches
  const az0 = -0.95, n = 9;
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(dirAt(az0 + Math.sin(t * PI) * -0.16 + t * 0.0, 0.62 - t * 1.05).multiplyScalar(R * 1.006)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0055, 6, false), thread));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, p = curve.getPoint(t), tan = curve.getTangent(t), nrm = p.clone().normalize();
    const side = new THREE.Vector3().crossVectors(tan, nrm).normalize();
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.0085, 0.0085, 0.062), thread);
    st.position.copy(p); st.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tan.clone().cross(side).multiplyScalar(-1).normalize(), tan, side));
    st.rotateY(0); head.add(st);
    st.lookAt(new THREE.Vector3().addVectors(head.localToWorld(p.clone()), new THREE.Vector3(0, 0, 0)));   // no-op safety; re-orient below
    st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), side);
  }
  // forehead patch (a felt-like square appliqué in a mismatched colour, sewn on)
  const patch = onSurface(head, R, 0.62, 0.72, new THREE.BoxGeometry(0.13, 0.11, 0.012), M.cloth(o.patch ?? 0x9fe3ff), { k: 1.0, roll: 0.25, cast: true });
  void patch;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * PI * 2, rx = Math.cos(a) * 0.05, ry = Math.sin(a) * 0.045;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.005), thread);
    s.position.set(rx, ry, 0.009); s.rotation.z = a + PI / 2; patch.add(s);
  }
  // thin hair tufts + a couture fascinator
  const hairM = M.hair(o.hair ?? 0x7a6a86);
  for (let i = 0; i < 9; i++) {
    const az = -0.9 + i * 0.22, el = 1.0 + (i % 3) * 0.12;
    const tuft = onSurface(head, R, az, el, cap(0.011, 0.11 + (i % 4) * 0.02, 3, 6), hairM, { k: 1.03, roll: (i % 2 ? 1 : -1) * 0.5 });
    tuft.translateY(0.05); tuft.castShadow = true;
  }
  const kind = o.hatKind ?? 'pillbox';
  if (kind === 'cone') {
    const cone = new THREE.Group();
    add(cone, new THREE.ConeGeometry(0.15, 0.36, 32, 1, true), M.cloth(0xff7a2f, { rep: 4 }), { y: 0.18 });
    for (const [y, rr] of [[0.11, 0.118], [0.2, 0.086]]) add(cone, new THREE.CylinderGeometry(rr * 0.98, rr, 0.055, 32, 1, true), M.cloth(0xfff6ea, { rep: 4 }), { y });
    add(cone, new THREE.CylinderGeometry(0.19, 0.19, 0.035, 32), M.cloth(0xff7a2f, { rep: 4 }), { y: 0.0 });
    const bw = makeBow(M, 0xff6fb5, 0.8); bw.position.set(0.1, 0.06, 0.1); bw.rotation.set(-0.3, 0.6, 0.3); cone.add(bw);
    cone.position.copy(dirAt(0.1, 1.15).multiplyScalar(R * 0.99)); cone.rotation.set(0.35, 0.2, -0.4); head.add(cone);
  } else if (kind === 'pillbox') {
    const hat = new THREE.Group();
    add(hat, new THREE.CylinderGeometry(0.135, 0.165, 0.11, 40), M.satin(o.hat ?? 0xd9a7ff), { y: 0.055 });
    add(hat, new THREE.TorusGeometry(0.15, 0.014, 10, 40), M.satin(0xffffff), { y: 0.02, rx: PI / 2 });
    const b = makeBow(M, 0xff6fb5, 0.9); b.position.set(0.09, 0.115, 0.02); b.rotation.set(-0.5, 0.2, 0.4); hat.add(b);
    hat.position.copy(dirAt(0.55, 1.05).multiplyScalar(R * 0.97)); hat.rotation.set(0.5, 0.3, -0.55);
    head.add(hat);
  }
}

function buildDesignerHair(M, head, R, o) {
  const hairM = M.hair(o.hair ?? 0x5a2a1f);
  hairM.side = THREE.DoubleSide;
  // bob: a shell sitting a touch back and above the skull so the face shows through the front
  const bob = add(head, sph(R * 1.14, 64, 40, 0, PI * 2, 0, PI * 0.78), hairM, { y: 0.055 * R / 0.32, z: -0.105, sx: 1.02, sy: 1.0, sz: 1.0 });
  void bob;
  // fringe
  const bangs = [[-0.62, 0.86, 0.55], [-0.36, 0.95, 0.22], [-0.08, 0.98, -0.05], [0.2, 0.97, -0.28], [0.5, 0.9, -0.5], [0.72, 0.8, -0.65]];
  bangs.forEach(([az, el, roll], i) => onSurface(head, R, az, el, sph(0.1, 20, 14), hairM, { k: 1.04, sx: 1.05, sy: 1.35, sz: 0.55, roll, cast: true }));
  // pink streak
  onSurface(head, R, -0.36, 0.95, cap(0.02, 0.15, 4, 8), M.hair(o.streak ?? 0xff4fa3), { k: 1.075, roll: 0.22 + PI / 2 - PI / 2, cast: true }).rotateZ(0);
  // space buns + scrunchies
  for (const s of [-1, 1]) {
    const c = dirAt(s * 0.82, 1.02).multiplyScalar(R * 1.08);
    add(head, sph(0.13, 28, 18), hairM, { x: c.x, y: c.y + 0.03, z: c.z - 0.02 });
    const sc = add(head, new THREE.TorusGeometry(0.105, 0.03, 12, 32), M.satin(o.scrunchie ?? 0xff4fa3), { x: c.x * 0.93, y: c.y - 0.055, z: c.z - 0.02 });
    sc.lookAt(new THREE.Vector3(c.x * 3, c.y * 3 + 0.5, c.z * 3));
  }
  // star clip
  const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.02 : 0.05, a = i * PI / 5 + PI / 2; star[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.012, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2 });
  onSurface(head, R, 0.62, 0.78, sg, M.metal(0xffe066), { k: 1.09, cast: true });
}

// convenience posing
export function pose(char, p = {}) {
  const J = char.userData.J;
  const set = (o, v) => { if (v) o.rotation.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0); };
  set(J.shL, p.shL); set(J.shR, p.shR); set(J.elL, p.elL); set(J.elR, p.elR);
  if (p.head) J.head.rotation.set(...p.head);
  if (p.body) J.body.rotation.set(...p.body);
  if (p.legL) J.legL.rotation.set(...p.legL);
  if (p.legR) J.legR.rotation.set(...p.legR);
}
