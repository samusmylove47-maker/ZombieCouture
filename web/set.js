// The mall. A pastel atrium built from primitives: shopfronts, pillars, signage, the barricade, and a fitting pedestal.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { add, makeBow } from './chars.js';
import { checkerTexture } from './mats.js';
import { stitchify } from './stitch.js';
const PI = Math.PI;

export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function glowSprite(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function starSprite(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const m = size / 2; g.translate(m, m);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, m); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, m, 0, 7); g.fill();
  g.fillStyle = '#fff';
  for (const [w, l] of [[3, m * 0.95], [1.6, m * 0.6]]) {
    for (const a of [0, PI / 2]) { g.save(); g.rotate(a + (l < m * 0.7 ? PI / 4 : 0)); g.beginPath(); g.moveTo(-l, 0); g.quadraticCurveTo(0, -w, l, 0); g.quadraticCurveTo(0, w, -l, 0); g.fill(); g.restore(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function signTexture(text, fg, bg, w = 768, h = 192, glow = '#ff4fa3') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.font = `${Math.floor(h * 0.62)}px Fredoka`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = glow; g.shadowBlur = 28; g.fillStyle = glow; g.fillText(text, w / 2, h / 2 + 4); g.fillText(text, w / 2, h / 2 + 4);
  g.shadowBlur = 8; g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function buildSet(scene, M, opt = {}) {
  const R = rng(5);
  const S = {};
  const felt = M.felt;

  // ---- floor: pastel checker under a mirror
  const checker = checkerTexture(felt ? '#f8d3a0' : '#a99cff', felt ? '#fff3e0' : '#f6f2ff', 14, 1024, felt ? '#ffe9c4' : '#ffffff');
  checker.repeat.set(3, 3);
  if (!felt && opt.reflect !== false) {
    const mirror = new Reflector(new THREE.PlaneGeometry(90, 90), { textureWidth: opt.W ?? 1280, textureHeight: opt.H ?? 720, clipBias: 0.003, color: 0xffffff });
    mirror.rotation.x = -PI / 2; mirror.position.y = -0.002; scene.add(mirror);
    S.mirror = mirror;
  }
  const floorMat = felt
    ? stitchify(new THREE.MeshStandardMaterial({ map: checker, roughness: 1, bumpMap: M.fabricTex(24), bumpScale: 1.2 }))
    : new THREE.MeshPhysicalMaterial({ map: checker, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, transparent: !opt.noMirror && !!S.mirror, opacity: S.mirror ? 0.8 : 1, envMapIntensity: 0.6 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floorMat);
  floor.rotation.x = -PI / 2; floor.receiveShadow = true; scene.add(floor);
  if (floor.material.map) floor.material.map.repeat.set(4, 4);
  S.floor = floor;

  // ---- back wall of shopfronts (arches punched through)
  const wallW = 46, wallH = 11, shops = [-16, -8, 0, 8, 16], aw = 4.4, ah = 3.6, rad = aw / 2;
  const shape = new THREE.Shape(); shape.moveTo(-wallW / 2, 0); shape.lineTo(wallW / 2, 0); shape.lineTo(wallW / 2, wallH); shape.lineTo(-wallW / 2, wallH); shape.closePath();
  for (const cx of shops) {
    const h = new THREE.Path(); h.moveTo(cx - rad, 0.0); h.lineTo(cx + rad, 0.0); h.lineTo(cx + rad, ah); h.absarc(cx, ah, rad, 0, PI, false); h.lineTo(cx - rad, 0.0);
    shape.holes.push(h);
  }
  const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 24 }), M.matte(felt ? 0xe0d0f6 : 0x8f9dff, { rough: 0.55 }));
  wall.position.set(0, 0, -12); wall.receiveShadow = true; wall.castShadow = true; scene.add(wall);
  // stripe trims
  add(scene, new THREE.BoxGeometry(wallW, 0.35, 0.8), M.plastic(0xffffff), { y: 4.4 + 0.0, z: -11.7 });
  add(scene, new THREE.BoxGeometry(wallW, 0.5, 0.9), M.plastic(felt ? 0xff8a6a : 0xff5fae), { y: 8.9, z: -11.65 });

  const palette = felt ? [0xffd9a8, 0xffc0b0, 0xfff0b8, 0xd7f0c0, 0xffd0d8] : [0xffd0f0, 0xd7c6ff, 0xc2f0ff, 0xfff0b8, 0xc8ffd9];
  const signs = ['BOW-TIQUE', 'SAMPLE SALE', 'SPARKLE & CO.', 'GLOSS BAR', 'PASTEL PALACE'];
  const signCols = ['#ff4fa3', '#8a5cff', '#22c7ff', '#ffb400', '#22d68a'];
  shops.forEach((cx, i) => {
    // lit interior
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#fff8ee'); gr.addColorStop(1, '#' + palette[i % palette.length].toString(16).padStart(6, '0')); g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    let winM = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.15, 1.1, 1.1) }); if (felt) winM = stitchify(winM);
    add(scene, new THREE.PlaneGeometry(aw + 0.4, ah + rad + 0.2), winM, { x: cx, y: (ah + rad) / 2, z: -13.6, cast: false, recv: false });
    // side walls of the alcove
    for (const s of [-1, 1]) add(scene, new THREE.PlaneGeometry(1.7, ah + rad), M.matte(palette[i % palette.length], { rough: 0.7 }), { x: cx + s * (rad + 0.05), y: (ah + rad) / 2, z: -12.9, ry: -s * PI / 2, cast: false });
    // dress forms in the windows
    for (let k = 0; k < 3; k++) {
      const df = new THREE.Group();
      const bodyGeo = new THREE.LatheGeometry([[0.001, 0], [0.16, 0.05], [0.24, 0.3], [0.2, 0.65], [0.15, 0.95], [0.11, 1.02], [0.06, 1.08], [0.001, 1.1]].map(p => new THREE.Vector2(p[0], p[1])), 28);
      add(df, bodyGeo, M.satin(palette[(i + k + 1) % palette.length]), { y: 0.5, sy: 0.9 });
      add(df, new THREE.CylinderGeometry(0.014, 0.014, 0.6, 8), M.metal(0xcccccc), { y: 0.2 });
      add(df, new THREE.CylinderGeometry(0.22, 0.24, 0.04, 24), M.plastic(0xffffff), { y: -0.09 });
      df.position.set(cx - 1.3 + k * 1.3, 0.1, -13.0 + (k % 2) * 0.3); df.scale.setScalar(1.2 + (k % 2) * 0.15); scene.add(df);
    }
    // neon sign
    let sm = new THREE.MeshBasicMaterial({ map: signTexture(signs[i], '#ffffff', '#1b0f2e', 768, 192, signCols[i]), toneMapped: false }); if (felt) sm = stitchify(sm);
    // the plane lies exactly on the wall's front face (extrude depth 0.6 + bevel 0.08 from z = -12): pulled toward the camera in depth only, so the two never z-fight (a grid of dropouts on the sign at oblique angles)
    sm.polygonOffset = true; sm.polygonOffsetFactor = -2; sm.polygonOffsetUnits = -2;
    add(scene, new THREE.PlaneGeometry(4.2, 1.05), sm, { x: cx, y: 7.6, z: -11.32, cast: false, recv: false });
    add(scene, new THREE.BoxGeometry(4.5, 1.3, 0.12), M.plastic(0xffffff), { x: cx, y: 7.6, z: -11.45 });
  });

  // ---- pillars with candy bands
  for (const x of [-11, -4.6, 4.6, 11]) {
    const p = new THREE.Group();
    add(p, new THREE.CylinderGeometry(0.55, 0.6, 9.5, 36), M.plastic(0xfff5fa, { rough: 0.3 }), { y: 4.75 });
    for (let k = 0; k < 6; k++) add(p, new THREE.CylinderGeometry(0.575, 0.575, 0.22, 36), M.plastic(k % 2 ? (felt ? 0xff8a6a : 0xff8fc0) : (felt ? 0xffd27a : 0x9be4ff), { rough: 0.2 }), { y: 0.8 + k * 1.5 });
    add(p, new THREE.CylinderGeometry(0.78, 0.82, 0.35, 36), M.plastic(0xffffff), { y: 0.18 });
    p.position.set(x, 0, -6.2 - Math.abs(x) * 0.12); scene.add(p);
  }

  // ---- ceiling glow + hanging ring lights
  add(scene, new THREE.PlaneGeometry(60, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 1.0), toneMapped: false }), { y: 13, rx: PI / 2, cast: false, recv: false });
  for (let k = 0; k < 5; k++) {
    const ring = add(scene, new THREE.TorusGeometry(2.6 + k * 0.5, 0.06, 10, 64), M.glow([0xff7fbf, 0x8fe8ff, 0xffe066, 0xb59aff, 0xff7fbf][k], 2.2), { x: 0, y: 9.6 - k * 0.2, z: -3 - k * 1.7, rx: PI / 2, cast: false, recv: false });
    void ring;
  }
  // banners
  const banner = (txt, col, x, y, z, ry) => { let m = new THREE.MeshBasicMaterial({ map: signTexture(txt, '#ffffff', col, 640, 160, '#ffffff'), toneMapped: false, side: THREE.DoubleSide }); if (felt) m = stitchify(m); add(scene, new THREE.PlaneGeometry(4.0, 1.0), m, { x, y, z, ry, cast: false, recv: false }); };
  banner('GRAND REOPENING!', '#ff4fa3', 8.5, 7.9, -3.5, -0.25);
  banner('EVERYTHING MUST GO', '#8a5cff', -9.2, 7.6, -4.2, 0.3);

  // ---- barricade (dressed up: it has been decorated)
  const bar = new THREE.Group();
  const benchM = M.plastic(0xa5b4ff, { rough: 0.4 }), cartM = M.metal(0xd8dde6);
  add(bar, new THREE.BoxGeometry(2.6, 0.18, 0.7), benchM, { y: 0.9, rz: 0.06 });
  add(bar, new THREE.BoxGeometry(2.6, 0.7, 0.14), benchM, { y: 1.35, z: -0.3, rz: 0.06 });
  add(bar, new THREE.BoxGeometry(1.4, 2.2, 1.0), M.plastic(0xff9ecb, { rough: 0.3 }), { x: -2.0, y: 1.1 });          // vending machine
  add(bar, new THREE.BoxGeometry(1.0, 1.4, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.9, 1.9), toneMapped: false }), { x: -2.0, y: 1.3, z: 0.52 });
  for (let i = 0; i < 3; i++) {   // shopping carts as wire baskets
    const cart = new THREE.Group();
    add(cart, new THREE.BoxGeometry(0.9, 0.05, 0.6), cartM, { y: 0.35 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(cart, new THREE.BoxGeometry(0.03, 0.55, 0.03), cartM, { x: sx * 0.44, y: 0.62, z: sz * 0.29 });
    for (const y of [0.5, 0.75, 0.9]) { add(cart, new THREE.BoxGeometry(0.92, 0.02, 0.02), cartM, { y, z: 0.3 }); add(cart, new THREE.BoxGeometry(0.92, 0.02, 0.02), cartM, { y, z: -0.3 }); add(cart, new THREE.BoxGeometry(0.02, 0.02, 0.62), cartM, { y, x: 0.45 }); add(cart, new THREE.BoxGeometry(0.02, 0.02, 0.62), cartM, { y, x: -0.45 }); }
    cart.position.set(1.4 + i * 0.5, 0.05 + i * 0.85, 0.2 - i * 0.15); cart.rotation.set(0.05, 0.4 + i, 0.5 - i * 0.6); bar.add(cart);
  }
  add(bar, new THREE.BoxGeometry(1.5, 0.5, 0.05), M.plastic(0xfff1a8), { x: 0.2, y: 2.2, z: 0.5, rz: -0.08 });
  for (const [bx, by, c] of [[-1.3, 1.9, 0xff4fa3], [1.1, 1.05, 0x8a5cff], [0.4, 1.7, 0x22c7ff], [2.0, 2.7, 0xffe066]]) { const b = makeBow(M, c, 2.2); b.position.set(bx, by, 0.7); bar.add(b); }
  bar.position.set(-7.4, 0, -7.4); bar.rotation.y = 0.5; bar.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(bar);
  S.barricade = bar;

  // ---- fitting pedestal with light ring
  const ped = new THREE.Group();
  add(ped, new THREE.CylinderGeometry(0.78, 0.82, 0.24, 64), M.plastic(0xffffff, { rough: 0.15 }), { y: 0.12 });
  add(ped, new THREE.CylinderGeometry(0.66, 0.66, 0.02, 64), M.plastic(0xff8fc0, { rough: 0.1 }), { y: 0.25 });
  add(ped, new THREE.TorusGeometry(0.8, 0.028, 12, 96), M.glow(0xff4fb0, 2.4), { y: 0.14, rx: PI / 2, cast: false });
  add(ped, new THREE.TorusGeometry(0.815, 0.02, 12, 96), M.glow(0x8fe8ff, 2.0), { y: 0.06, rx: PI / 2, cast: false });
  ped.position.set(0.95, 0, 0.1); S.ped = ped; scene.add(ped);

  // ---- runway strip heading back
  const rw = new THREE.Group();
  add(rw, new THREE.BoxGeometry(2.4, 0.1, 14), M.plastic(0xffffff, { rough: 0.12 }), { y: 0.05, z: -7 });
  for (const s of [-1, 1]) add(rw, new THREE.BoxGeometry(0.06, 0.05, 14), M.glow(s < 0 ? 0xff4fb0 : 0x62dfff, 2.2), { x: s * 1.21, y: 0.11, z: -7, cast: false });
  rw.position.set(0.95, 0, -0.6); S.runway = rw; if (opt.runway) scene.add(rw);

  return S;
}

export async function buildTitle(scene, M, text, opts = {}) {
  await document.fonts.load('64px Fredoka');
  const json = await new Promise((res, rej) => new TTFLoader().load('../assets/FredokaOne-Regular.ttf', res, undefined, rej));
  const font = new Font(json);
  const size = opts.size ?? 1.5;
  const lines = text.split('\n');
  const grp = new THREE.Group();
  lines.forEach((ln, li) => {
    const shapes = font.generateShapes(ln, size);
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.075, bevelSegments: 8, curveSegments: 10 });
    g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.max.x + bb.min.x) / 2, -li * size * 1.22, 0);
    const front = new THREE.Mesh(g, M.plastic(opts.color ?? 0xff4fa3, { rough: 0.12 })); front.castShadow = true; grp.add(front);
    const g2 = new THREE.ExtrudeGeometry(shapes, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.2, bevelSegments: 4, curveSegments: 10 });
    g2.translate(-(bb.max.x + bb.min.x) / 2, -li * size * 1.22, -0.16);
    const back = new THREE.Mesh(g2, M.plastic(opts.outline ?? 0xffffff, { rough: 0.25 })); grp.add(back);
  });
  grp.position.copy(opts.pos ?? new THREE.Vector3(0, 8, -8.5));
  scene.add(grp); return grp;
}

export function sparkles(scene, n, region, seed = 3, tint = [0xffffff, 0xfff0a8, 0xffc4ec, 0xbff3ff]) {
  const R = rng(seed); const tex = starSprite(128); const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(tint[i % tint.length]).multiplyScalar(1.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat); s.position.set(region.x0 + R() * (region.x1 - region.x0), region.y0 + R() * (region.y1 - region.y0), region.z0 + R() * (region.z1 - region.z0));
    const sc = region.s0 + R() * (region.s1 - region.s0); s.scale.set(sc, sc, 1); g.add(s);
  }
  scene.add(g); return g;
}

export function bokeh(scene, n, seed = 9, style = 'vinyl') {
  const R = rng(seed); const tex = glowSprite(128); const g = new THREE.Group();
  const cols = [0xff7fc0, 0xffe27a, 0x7fe0ff, 0xc09cff, 0xffffff, 0xffa0a0];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(cols[i % cols.length]).multiplyScalar(style === 'felt' ? 0.9 : 1.5), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.35 + R() * 0.5, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat); s.position.set((R() - 0.5) * 34, 0.6 + R() * 8.5, -13 + R() * 6 - 3); const sc = 0.25 + R() * 0.9; s.scale.set(sc, sc, 1); g.add(s);
  }
  scene.add(g); return g;
}


// additive light shafts from the ceiling (volumetric look without volumetrics)
export function beam(scene, x, z, color = 0xff8fd0, radius = 1.1, height = 11, tilt = [0, 0], strength = 0.32) {
  const geo = new THREE.CylinderGeometry(radius * 0.22, radius, height, 48, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(color) }, k: { value: strength } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float k; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN,vV)),1.6); float fade = pow(vUv.y,1.4); gl_FragColor = vec4(c*edge*fade*k*2.0, 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(x, height / 2, z); m.rotation.set(tilt[0], 0, tilt[1]); m.renderOrder = 5; scene.add(m); return m;
}


// a running stitch along a polyline (instanced), used to make the felt world look sewn
export function stitchPath(scene, pts, color = 0xfff4e0, spacing = 0.22, len = 0.11, thick = 0.028) {
  const curve = new THREE.CatmullRomCurve3(pts); const L = curve.getLength(); const n = Math.max(2, Math.floor(L / spacing));
  const g = new THREE.CapsuleGeometry(thick, len, 3, 6); g.rotateX(PI / 2);   // long axis -> z
  const im = new THREE.InstancedMesh(g, stitchify(new THREE.MeshStandardMaterial({ color, roughness: 1 })), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), z = new THREE.Vector3(0, 0, 1);
  const rr = rng(4);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; p.copy(curve.getPoint(t)); const tan = curve.getTangent(t).normalize();
    q.setFromUnitVectors(z, tan); const j = (rr() - 0.5) * 0.25; q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), j));
    m.compose(p, q, sc); im.setMatrixAt(i, m);
  }
  im.castShadow = true; scene.add(im); return im;
}

// walls, ceiling and beams so the atrium is a closed room from every camera angle
export function enclose(scene, M, opt = {}) {
  const wallM = M.matte(0xe0d0f6, { rough: 0.6 }), trim = M.plastic(0xffffff), trim2 = M.plastic(0xff8a6a);
  const x = 23.5, zf = 24, zb = -12.5, h = 11;
  for (const s of [-1, 1]) {
    add(scene, new THREE.BoxGeometry(0.6, h, zf - zb), wallM, { x: s * x, y: h / 2, z: (zf + zb) / 2 });
    add(scene, new THREE.BoxGeometry(0.8, 0.35, zf - zb), trim, { x: s * (x - 0.3), y: 4.4, z: (zf + zb) / 2 });
    add(scene, new THREE.BoxGeometry(0.9, 0.5, zf - zb), trim2, { x: s * (x - 0.3), y: 8.9, z: (zf + zb) / 2 });
    stitchPath(scene, [new THREE.Vector3(s * (x - 0.72), 4.62, zb), new THREE.Vector3(s * (x - 0.72), 4.62, zf)], 0xff8a6a, 0.3, 0.15, 0.03);
  }
  add(scene, new THREE.BoxGeometry(2 * x, h, 0.6), wallM, { y: h / 2, z: zf });
  add(scene, new THREE.BoxGeometry(2 * x, 0.35, 0.8), trim, { y: 4.4, z: zf - 0.3 });
  add(scene, new THREE.BoxGeometry(2 * x, 0.5, 0.9), trim2, { y: 8.9, z: zf - 0.3 });
  if (opt.ceiling !== false) {
    add(scene, new THREE.BoxGeometry(2 * x, 0.5, zf - zb), M.matte(0xb39ce0, { rough: 0.8 }), { y: 11.4, z: (zf + zb) / 2 });   // ceiling slab
    for (let i = -4; i <= 4; i++) add(scene, new THREE.BoxGeometry(0.5, 0.6, zf - zb), trim, { x: i * 5.5, y: 11.0, z: (zf + zb) / 2, cast: false });   // ceiling beams
  }
  return { x, zf, zb, h, zc: (zf + zb) / 2 };      // interior box: x in [-x, x], z in [zb, zf], ceiling at y = 11.4
}

export function sewnWorld(scene) {
  // stitched arches, trims, pillars: the whole mall looks appliquéd
  for (const cx of [-16, -8, 0, 8, 16]) {
    const pts = []; for (let i = 0; i <= 32; i++) { const a = PI * i / 32; pts.push(new THREE.Vector3(cx + Math.cos(a) * 2.75, 3.6 + Math.sin(a) * 2.75, -11.36)); }
    pts.unshift(new THREE.Vector3(cx + 2.75, 0.4, -11.36)); pts.push(new THREE.Vector3(cx - 2.75, 0.4, -11.36));
    stitchPath(scene, pts, 0xfff4e0, 0.26, 0.13, 0.03);
  }
  stitchPath(scene, [new THREE.Vector3(-22, 4.62, -11.28), new THREE.Vector3(22, 4.62, -11.28)], 0xff8a6a, 0.3, 0.15, 0.03);
  stitchPath(scene, [new THREE.Vector3(-22, 9.2, -11.18), new THREE.Vector3(22, 9.2, -11.18)], 0xfff4e0, 0.3, 0.15, 0.03);
  for (const x of [-11, -4.6, 4.6, 11]) for (const y of [1.6, 4.6, 7.6]) {
    const zc = -6.2 - Math.abs(x) * 0.12; const pts = []; for (let i = 0; i <= 24; i++) { const a = PI * 2 * i / 24; pts.push(new THREE.Vector3(x + Math.cos(a) * 0.62, y, zc + Math.sin(a) * 0.62)); }
    stitchPath(scene, pts, 0xff8a6a, 0.2, 0.1, 0.026);
  }
}
