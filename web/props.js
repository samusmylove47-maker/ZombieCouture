// Story props for the stitch-front world: the sewing machine (the hub of the front), giant spools, the thread itself,
// the running stitches that mark the front on the floor, dust, fluorescent tubes, confetti.
import * as THREE from 'three';
import { add } from './chars.js';
import { glowSprite, starSprite, rng } from './set.js';
const PI = Math.PI;

// ---- the sewing machine: pink, chunky, a little too big. It is always alive (K = 1) and warm.
export function makeMachine(M, scale = 1) {
  const prev = M.currentK; M.currentK = { value: 1 };
  const g = new THREE.Group();
  const body = M.plastic(0xff6fae, { rough: 0.3 }), cream = M.plastic(0xfff2e4, { rough: 0.35 }), steel = M.metal(0xdfe6ee), gold = M.plastic(0xffd45e, { rough: 0.25 });
  const rounded = (w, h, d, r = 0.05) => { // cheap rounded box via scaled capsule-ish: extruded rounded rect
    const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 8 });
    geo.translate(0, 0, -d / 2); return geo;
  };
  add(g, rounded(0.78, 0.09, 0.34, 0.04), body, { y: 0.045 });                                  // base
  add(g, rounded(0.16, 0.5, 0.26, 0.05), body, { x: 0.28, y: 0.32 });                             // pillar
  add(g, rounded(0.62, 0.15, 0.26, 0.06), body, { x: 0.02, y: 0.53 });                            // arm
  add(g, rounded(0.2, 0.26, 0.24, 0.06), cream, { x: -0.3, y: 0.44 });                            // head
  add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), steel, { x: -0.31, y: 0.25 });        // needle bar
  const needle = add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.12, 8), steel, { x: -0.31, y: 0.12 });
  add(g, new THREE.BoxGeometry(0.07, 0.014, 0.05), steel, { x: -0.3, y: 0.055 });                 // presser foot
  add(g, new THREE.TorusGeometry(0.075, 0.016, 10, 28), gold, { x: 0.37, y: 0.5, z: 0.14, ry: PI / 2 });   // handwheel
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), steel, { x: 0.02, y: 0.66 });         // spool pin
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20), gold, { x: 0.02, y: 0.61 });
  add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.12, 20), M.cloth(0xff5fa8, { rep: 6 }), { x: 0.02, y: 0.7 });   // the spool of pink thread
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20), gold, { x: 0.02, y: 0.77 });
  add(g, new THREE.BoxGeometry(0.16, 0.012, 0.2), M.plastic(0xffffff), { x: -0.3, y: 0.003 });      // throat plate
  // lamp on the arm
  add(g, new THREE.ConeGeometry(0.05, 0.08, 16, 1, true), M.basic(0xfff0c8, { toneMapped: false }), { x: -0.1, y: 0.45, z: 0.1, rx: PI });
  add(g, new THREE.SphereGeometry(0.018, 10, 8), M.basic(0xffffe0, { toneMapped: false }), { x: -0.1, y: 0.41, z: 0.1 });
  g.scale.setScalar(scale);
  M.currentK = prev;
  g.userData = { needle, needleTop: 0.12, wheel: g.children[7] };
  return g;
}

export function makeSpool(M, r = 0.5, h = 0.9, color = 0xff5fa8) {
  const prev = M.currentK; M.currentK = { value: 1 };
  const sp = new THREE.Group();
  const wood = M.matte(0xe0a868, { rep: 3 });
  add(sp, new THREE.CylinderGeometry(r * 1.32, r * 1.32, h * 0.08, 48), wood, { y: h * 0.04 });
  add(sp, new THREE.CylinderGeometry(r * 1.32, r * 1.32, h * 0.08, 48), wood, { y: h - h * 0.04 });
  add(sp, new THREE.CylinderGeometry(r, r, h * 0.86, 48), M.cloth(color, { rep: 14 }), { y: h / 2 });
  for (let i = 0; i < 12; i++) add(sp, new THREE.TorusGeometry(r * 1.005, r * 0.028, 6, 48), M.cloth(new THREE.Color(color).offsetHSL(0, 0, 0.06).getHex(), { rep: 6 }), { y: h * 0.1 + i * h * 0.07, rx: PI / 2 });
  M.currentK = prev;
  return sp;
}

export function makeNeedle(M, len = 0.7, thick = 0.009) {
  const prev = M.currentK; M.currentK = { value: 1 };
  const nd = new THREE.Group();
  add(nd, new THREE.CylinderGeometry(thick, thick, len, 10), M.metal(0xeef2f8), { y: len * 0.43 });
  add(nd, new THREE.ConeGeometry(thick, len * 0.14, 10), M.metal(0xeef2f8), { y: len * 1.0 });
  add(nd, new THREE.TorusGeometry(thick * 2.2, thick * 0.6, 8, 18), M.metal(0xeef2f8), { y: -len * 0.08 });
  M.currentK = prev;
  return nd;
}

// a soft glowing pink thread (always alive)
export function threadTube(M, pts, r = 0.02, color = 0xff5fa8, seg = 160) {
  const prev = M.currentK; M.currentK = { value: 1 };
  const curve = new THREE.CatmullRomCurve3(pts);
  const th = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 7, false), M.thread(color)); th.castShadow = true; th.receiveShadow = false;
  M.currentK = prev; th.userData.curve = curve; return th;
}

// running stitches along the front (an arc of a circle about the hub), lying on the floor. Always pink, always lit.
export function makeFrontStitches(scene, n = 120) {
  const geo = new THREE.CapsuleGeometry(0.036, 0.3, 2, 6); geo.rotateZ(PI / 2);   // long axis -> x
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.36, 0.68).multiplyScalar(1.25), toneMapped: false });
  const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const R = rng(77); const jit = Array.from({ length: n }, () => [R() - 0.5, R() - 0.5]);
  scene.add(im);
  im.userData.update = (O, radius, a0, a1, t = 0, spacing = 0.44) => {
    if (radius <= 0.01) { im.count = 0; return; }
    const cnt = Math.min(n, Math.floor((a1 - a0) * radius / spacing)); im.count = cnt;
    for (let i = 0; i < cnt; i++) {
      const a = a0 + (i + 0.5) / cnt * (a1 - a0);
      // a needle "walks" the stitches on: each stitch pops up in sequence around the arc (running-stitch rhythm)
      const wave = 0.5 + 0.5 * Math.sin(t * 3.0 - i * 0.55);
      const s = 0.82 + 0.18 * wave;
      p.set(O.x + Math.cos(a) * (radius + jit[i][0] * 0.05), 0.04, O.z + Math.sin(a) * (radius + jit[i][0] * 0.05));
      q.setFromAxisAngle(up, -(a + PI / 2) + jit[i][1] * 0.16); sc.set(s, 1, 1);
      m4.compose(p, q, sc); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  return im;
}

export function dust(scene, n, box, seed = 5, opacity = 0.3) {
  const Rr = rng(seed); const tex = glowSprite(64); const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xcfe0ff, transparent: true, opacity: 0.1 + Rr() * opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.set(box.x0 + Rr() * (box.x1 - box.x0), box.y0 + Rr() * (box.y1 - box.y0), box.z0 + Rr() * (box.z1 - box.z0));
    const s = 0.025 + Rr() * 0.06; sp.scale.set(s, s, 1); g.add(sp);
  }
  scene.add(g); return g;
}

// fluorescent tube + a cold spot from it
export function tube(scene, x, y, z, len = 1.8, ang = 0, cold = 60, target = null) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.07), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 1.1, 1.05), toneMapped: false }));
  t.position.set(x, y, z); t.rotation.set(0, 0, ang); scene.add(t);
  let sl = null;
  if (cold > 0) { sl = new THREE.SpotLight(0xa8ccff, cold, 26, 0.75, 0.8, 1.2); sl.position.set(x, y - 0.2, z); sl.target.position.set(target ? target[0] : x, 0, target ? target[1] : z); scene.add(sl, sl.target); }
  return { mesh: t, light: sl };
}

// confetti: closed-form in time, so any frame can be rendered independently
export function makeConfetti(scene, n = 400, box = { x0: -10, x1: 10, y0: 0, y1: 9, z0: -8, z1: 8 }, seed = 31) {
  const geo = new THREE.PlaneGeometry(0.11, 0.06);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, vertexColors: false });
  const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false;
  const cols = [0xff5fa8, 0xffe066, 0x66e0ff, 0xb388ff, 0xff9ecb, 0xb6ffd6, 0xffb347];
  const R = rng(seed); const d = [];
  for (let i = 0; i < n; i++) {
    d.push({ x: box.x0 + R() * (box.x1 - box.x0), y: box.y0 + R() * (box.y1 - box.y0), z: box.z0 + R() * (box.z1 - box.z0), ph: R() * 6.28, sp: 0.7 + R() * 1.1, rs: 2 + R() * 6, sw: 0.2 + R() * 0.5, ax: R() * 6.28 });
    im.setColorAt(i, new THREE.Color(cols[i % cols.length]).multiplyScalar(1.1));
  }
  scene.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
  const H = box.y1 - box.y0;
  im.userData.update = (t, amount = 1, camPos = null) => {
    for (let i = 0; i < n; i++) {
      const c = d[i]; const y = box.y0 + (((c.y - box.y0) - t * c.sp) % H + H) % H;
      p.set(c.x + Math.sin(t * 0.9 + c.ph) * c.sw, y, c.z + Math.cos(t * 0.7 + c.ph) * c.sw);
      e.set(t * c.rs + c.ax, t * c.rs * 0.7, c.ph); q.setFromEuler(e);
      let on = (i / n) < amount ? 1 : 0.0001;
      if (camPos) { const dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z; const dd = Math.sqrt(dx * dx + dy * dy + dz * dz); on *= Math.min(1, Math.max(0.0001, (dd - 1.6) / 1.4)); }
      s1.set(on, on, on); m4.compose(p, q, s1); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  return im;
}
