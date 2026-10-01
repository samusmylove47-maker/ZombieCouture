// The end card: a woven garment care label, sewn into the collar seam of a pastel couture dress on a hanger.
//   build(ctx) -> set   (docs/FILM.md section 5)      c2.args.reveal 0..1 is the only argument
//   reveal 0..0.2   a needle stitches the label's edge on
//   reveal 0.2..1   the print is woven in line by line, left to right, the needle riding the front of each line
//   reveal 1        finished: every line readable, needle parked in the bottom corner
// Rigs: card (front-on, slow push-in over u.p, everything legible at the end), cardMacro (weave and stitches, drifting sideways),
//       cardPull (starts inside the collar, pulls back to show the dress and the room, then settles exactly on `card`).
// The whole set lives around (CX, CY, 0) in the spare region x 100..140. World scale is doll-scale exaggerated: the label is 1.36 m wide.
import * as THREE from 'three';
import { stitchify } from '../stitch.js';
import { makeNeedle, placeNeedle } from '../text.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const CX = 120, CY = 1.6;                      // world position of the label centre
const LW = 1.36, LH = 0.86, LR = 0.075;        // label size (m) and corner radius
const CW = 2048, CHT = Math.round(CW * LH / LW);   // canvas size of the print
const K1 = { value: 1 };                       // the card is always in colour

// exact text of the credit block (docs/FILM.md rule 5: the account name appears only in this one line)
const CREDITS = [
  'Directed and published by Avenrae / ShaeAI',
  'Lyrics: Syribeth & ShaeAI',
  'Music: Suno v5',
  'Animation and every line of code:',
  'Claude Sonnet 5.5, in Claude.ai',
];
const CARE = '100% pastel · hand wash only · may moan';

export function build(ctx) {
  const { M, root } = ctx;
  const prevK = M.currentK; M.currentK = K1;
  const G = new THREE.Group(); G.name = 'card'; G.position.set(CX, CY, 0); root.add(G);
  const set = { name: 'card', root, slots: {}, rigs: {}, anchors: {} };
  const add = (parent, geo, mat, o = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0); m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    m.castShadow = o.cast ?? false; m.receiveShadow = o.recv ?? true; parent.add(m); return m;
  };
  const glowMat = (c, k = 1) => stitchify(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false }), K1);
  const thread = (c, rough = 0.6) => stitchify(new THREE.MeshStandardMaterial({ color: c, roughness: rough }), K1);

  // ============================================================ backdrop: quilted felt wall, floor, hook
  const wallMat = M.matte(0xd8d0fa, { rep: 130, bump: 1.2 }); if (wallMat.emissive) wallMat.emissive.set(0x3a3360);
  add(G, new THREE.PlaneGeometry(40, 26), wallMat, { y: 3.5, z: -1.9 }).name = 'wall';
  add(G, new THREE.PlaneGeometry(40, 30), M.matte(0xffd9b8, { rep: 130, bump: 1.6 }), { y: -4.7, z: 10, rx: -PI / 2 }).name = 'floor';
  // quilting: diamond lattice of running stitches on the wall (one instanced mesh)
  {
    const pts = []; const step = 2.1;
    for (let i = -10; i <= 10; i++) for (const s of [-1, 1]) {   // two families of diagonals
      const len = 34; const n = Math.floor(len / 0.5);
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n - 0.5; const x = i * step + s * t * len * 0.5, y = 3.5 + t * len * 0.5 * 1.0; pts.push([x, y, s]); }
    }
    const geo = new THREE.CapsuleGeometry(0.018, 0.16, 1, 5); geo.rotateZ(PI / 2);
    const im = new THREE.InstancedMesh(geo, thread(0xfff3e4), pts.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
    let n2 = 0;
    pts.forEach(([x, y, s]) => { if (Math.abs(x) > 19 || y < -4.4 || y > 14) return; p.set(x, y, -1.87); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * PI / 4); m4.compose(p, q, s1); im.setMatrixAt(n2++, m4); });
    im.count = n2; im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; G.add(im);
  }
  add(G, new THREE.SphereGeometry(0.11, 16, 12), M.plastic(0xffd45e, { rough: 0.25 }), { y: 1.62, z: -1.7, cast: false });          // wall hook (a big gold button)
  add(G, new THREE.CylinderGeometry(0.05, 0.05, 0.26, 12), M.plastic(0xffd45e, { rough: 0.25 }), { y: 1.62, z: -1.8, rx: PI / 2 });

  // ============================================================ the dress (seen from behind), hanging from the hook
  const dress = new THREE.Group(); dress.name = 'dress'; dress.position.z = -0.1; G.add(dress);
  const rr = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  // bodice
  {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0.5); s.quadraticCurveTo(0, 0.44, 0.5, 0.5); s.lineTo(0.98, 0.3); s.quadraticCurveTo(1.04, 0.2, 0.96, 0.0); s.lineTo(0.9, -0.4); s.quadraticCurveTo(0.8, -0.9, 0.68, -1.3); s.lineTo(-0.68, -1.3); s.quadraticCurveTo(-0.8, -0.9, -0.9, -0.4); s.lineTo(-0.96, 0.0); s.quadraticCurveTo(-1.04, 0.2, -0.98, 0.3); s.closePath();
    add(dress, new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 4, curveSegments: 14 }), M.cloth(0xffb6d5, { rep: 5 }), { z: -0.16, cast: true });
  }
  // collar band (the label's top edge is sewn into its lower seam) and a scalloped lace edge
  add(dress, new THREE.ExtrudeGeometry(rr(1.38, 0.2, 0.09), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 3, curveSegments: 8 }), M.cloth(0xfff4e0, { rep: 6 }), { y: 0.5, z: -0.06, cast: true });
  {
    const geo = new THREE.SphereGeometry(0.055, 10, 8), im = new THREE.InstancedMesh(geo, M.cloth(0xffffff, { rep: 6 }), 26); const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 0.6);
    for (let i = 0; i < 26; i++) { p.set(-0.66 + i * 0.0528, 0.63 + (i % 2) * 0.008, -0.04); m4.compose(p, q, s1); im.setMatrixAt(i, m4); } dress.add(im);
  }
  // sleeves: puffed caps with cuffs
  for (const s of [-1, 1]) {
    add(dress, new THREE.SphereGeometry(0.36, 24, 16), M.cloth(0xd9c2ff, { rep: 8 }), { x: s * 1.14, y: 0.1, z: -0.16, sx: 1, sy: 0.92, sz: 0.7, cast: true });
    add(dress, new THREE.TorusGeometry(0.29, 0.05, 8, 24), M.cloth(0xfff4e0, { rep: 6 }), { x: s * 1.18, y: -0.13, z: -0.12, rx: PI / 2 * 0.15, sz: 0.8 });
  }
  // skirt: three scalloped tiers (lathe about y)
  const tier = (yTop, yBot, rTop, rBot, col, n, amp) => {
    const prof = []; for (let i = 0; i <= 10; i++) { const k = i / 10; prof.push(new THREE.Vector2(lerp(rTop, rBot, Math.pow(k, 1.2)), lerp(yTop, yBot, k))); }
    const g = new THREE.LatheGeometry(prof, 96), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x), w = Math.pow(clamp((yTop - y) / (yTop - yBot)), 2.2); const sc = 1 + amp * w * Math.sin(a * n); pos.setXYZ(i, x * sc, y - amp * 0.9 * w * (0.5 + 0.5 * Math.sin(a * n)), z * sc); }
    g.computeVertexNormals();
    return add(dress, g, M.cloth(col, { rep: 4 }), { z: -0.2, sz: 0.5, cast: true });
  };
  tier(-1.24, -2.35, 0.62, 1.1, 0xffc0dc, 16, 0.045);
  tier(-2.2, -3.3, 0.98, 1.5, 0xd9c2ff, 20, 0.05);
  tier(-3.15, -4.15, 1.34, 1.9, 0xbff5dc, 24, 0.055);
  // sash and a big bow at the back
  add(dress, new THREE.TorusGeometry(0.66, 0.07, 10, 40), M.satin(0xff5fa8), { y: -1.28, z: -0.2, rx: PI / 2, sy: 0.5 });
  {
    const bow = new THREE.Group(); bow.position.set(0, -1.28, -0.2); dress.add(bow);
    const sat = M.satin(0xff5fa8);
    for (const s of [-1, 1]) { add(bow, new THREE.SphereGeometry(0.2, 18, 12), sat, { x: s * 0.24, sx: 1.25, sy: 0.85, sz: 0.4, rz: s * 0.25, cast: true }); add(bow, new THREE.BoxGeometry(0.13, 0.66, 0.03), sat, { x: s * 0.13, y: -0.4, rz: s * 0.18, cast: true }); }
    add(bow, new THREE.SphereGeometry(0.09, 14, 10), sat, { z: 0.02, sz: 0.8 });
  }
  // buttons down the back with sewn crosses
  for (let i = 0; i < 3; i++) add(dress, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), M.plastic(0xffe066, { rough: 0.25 }), { y: -0.55 - i * 0.22, z: -0.05, rx: PI / 2, cast: true });
  // hanger: padded satin shoulders (mostly hidden), neck and a wire hook that hangs from the wall button
  {
    const h = new THREE.Group(); h.position.set(0, 0.62, -0.1); dress.add(h);
    for (const s of [-1, 1]) add(h, new THREE.CapsuleGeometry(0.05, 0.75, 4, 10), M.satin(0xff8fc0), { x: s * 0.42, y: -0.12, rz: s * PI / 2 - s * 0.32, cast: true });
    add(h, new THREE.CylinderGeometry(0.03, 0.04, 0.18, 12), M.plastic(0xffd45e, { rough: 0.25 }), { y: 0.06 });
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 0.34, 0), new THREE.Vector3(0.05, 0.52, 0), new THREE.Vector3(0, 0.78, -0.05), new THREE.Vector3(-0.02, 0.98, -0.2), new THREE.Vector3(0, 1.06, -0.3)]);
    const wire = stitchify(new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.2, metalness: 0.4, emissive: 0x505a70 }), K1);
    add(h, new THREE.TubeGeometry(curve, 30, 0.014, 6, false), wire, { cast: true });
  }
  // stitched seam lines on the bodice (running stitch, one instanced mesh)
  {
    const pts = [];
    for (let k = 0; k < 20; k++) pts.push([0, -0.46 - k * 0.04, -0.03, PI / 2]);                    // centre-back seam below the label
    for (let k = 0; k < 44; k++) { const t = k / 43; pts.push([lerp(-0.69, 0.69, t), -1.27, -0.02, 0]); }  // waist seam
    for (const s of [-1, 1]) for (let k = 0; k < 16; k++) pts.push([s * (0.88 - k * 0.012), -0.42 - k * 0.055, -0.05, PI / 2 + s * 0.1]);
    const geo = new THREE.CapsuleGeometry(0.014, 0.05, 1, 5); geo.rotateZ(PI / 2);
    const im = new THREE.InstancedMesh(geo, thread(0xfff4e0), pts.length); const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    pts.forEach(([x, y, z, a], i) => { p.set(x, y, z); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a); m4.compose(p, q, s1); im.setMatrixAt(i, m4); }); im.frustumCulled = false; dress.add(im);
  }

  // ============================================================ the label
  const pivot = new THREE.Group(); pivot.position.set(0, LH / 2, 0.02); G.add(pivot);
  const label = new THREE.Group(); label.name = 'label'; label.position.set(0, -LH / 2, 0); pivot.add(label);
  const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CHT;
  const cx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // weave: a base (colour) drawn once, a bump drawn once
  const base = document.createElement('canvas'); base.width = CW; base.height = CHT;
  { const g = base.getContext('2d'); g.fillStyle = '#fff5e2'; g.fillRect(0, 0, CW, CHT);
    const imgd = g.getImageData(0, 0, CW, CHT), d = imgd.data;                   // weft rows and warp columns, with slubs
    for (let y = 0; y < CHT; y++) { const row = 1 + 0.028 * Math.sin(y * 1.9) + 0.02 * (hash(y * 0.31) - 0.5); for (let x = 0; x < CW; x++) { const i = (y * CW + x) * 4, col = 1 + 0.02 * Math.sin(x * 1.9), v = row * col * (1 + (((x >> 2) + (y >> 2)) & 1) * 0.012); d[i] = Math.min(255, d[i] * v); d[i + 1] = Math.min(255, d[i + 1] * v); d[i + 2] = Math.min(255, d[i + 2] * v * 0.995); } }
    g.putImageData(imgd, 0, 0);
    g.lineCap = 'round'; for (let i = 0; i < 260; i++) { const x = hash(i * 1.7) * CW, y = hash(i * 3.1 + 5) * CHT, l = 14 + hash(i * 7.7) * 46; g.strokeStyle = hash(i * 2.3) < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(190,160,130,0.16)'; g.lineWidth = 2 + hash(i * 9.1) * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (hash(i * 4.4) - 0.5) * 6); g.stroke(); }
    // selvedge: a woven edge stripe all round, in soft pink
    g.strokeStyle = 'rgba(255,170,205,0.55)'; g.lineWidth = 16; g.beginPath(); g.roundRect(38, 38, CW - 76, CHT - 76, 46); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 4; g.beginPath(); g.roundRect(56, 56, CW - 112, CHT - 112, 36); g.stroke(); }
  const bumpC = document.createElement('canvas'); bumpC.width = CW / 2; bumpC.height = CHT / 2;
  { const g = bumpC.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, bumpC.width, bumpC.height);
    for (let y = 0; y < bumpC.height; y += 3) { g.fillStyle = `rgba(255,255,255,${0.22 + 0.06 * hash(y)})`; g.fillRect(0, y, bumpC.width, 1); g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(0, y + 1, bumpC.width, 1); }
    for (let x = 0; x < bumpC.width; x += 3) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x, 0, 1, bumpC.height); } }
  const bump = new THREE.CanvasTexture(bumpC); bump.anisotropy = 8;
  const faceMat = stitchify(new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 1.4, roughness: 0.92 }), K1);
  const sideMat = M.cloth(0xf2dfc0, { rep: 6 });
  const lg = new THREE.ExtrudeGeometry(rr(LW, LH, LR), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 12 });
  { const pos = lg.attributes.position, uv = lg.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + LW / 2) / LW, (pos.getY(i) + LH / 2) / LH); }
  const labelMesh = new THREE.Mesh(lg, [faceMat, sideMat]); labelMesh.castShadow = true; labelMesh.receiveShadow = true; label.add(labelMesh);
  labelMesh.position.z = 0;

  // stitched border: a running stitch on a rounded-rect path, pink thread, plus corner crosses
  const border = [];
  {
    const ins = 0.052, w = LW - 2 * ins, h = LH - 2 * ins, r = LR - 0.02, per = [];
    const sides = [[w - 2 * r, 0], [Math.PI * r / 2, 1], [h - 2 * r, 0], [Math.PI * r / 2, 1], [w - 2 * r, 0], [Math.PI * r / 2, 1], [h - 2 * r, 0], [Math.PI * r / 2, 1]];
    const path = new THREE.CurvePath();
    const P = (x, y) => new THREE.Vector2(x, y);
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    path.add(new THREE.LineCurve(P(x0 + r, y1), P(x1 - r, y1))); path.add(new THREE.QuadraticBezierCurve(P(x1 - r, y1), P(x1, y1), P(x1, y1 - r)));
    path.add(new THREE.LineCurve(P(x1, y1 - r), P(x1, y0 + r))); path.add(new THREE.QuadraticBezierCurve(P(x1, y0 + r), P(x1, y0), P(x1 - r, y0)));
    path.add(new THREE.LineCurve(P(x1 - r, y0), P(x0 + r, y0))); path.add(new THREE.QuadraticBezierCurve(P(x0 + r, y0), P(x0, y0), P(x0, y0 + r)));
    path.add(new THREE.LineCurve(P(x0, y0 + r), P(x0, y1 - r))); path.add(new THREE.QuadraticBezierCurve(P(x0, y1 - r), P(x0, y1), P(x0 + r, y1)));
    const total = path.getLength(), n = Math.round(total / 0.046);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, p = path.getPoint(t), tan = path.getTangent(t); border.push({ x: p.x, y: p.y, ang: Math.atan2(tan.y, tan.x) }); }
    void sides; void per;
  }
  const bGeo = new THREE.CapsuleGeometry(0.0105, 0.03, 1, 5); bGeo.rotateZ(PI / 2);
  const borderMesh = new THREE.InstancedMesh(bGeo, thread(0xff6fae, 0.55), border.length); borderMesh.frustumCulled = false; borderMesh.count = 0;
  { const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    border.forEach((b, i) => { p.set(b.x, b.y, 0.0165); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.ang); s1.set(1, 1, 0.9); m4.compose(p, q, s1); borderMesh.setMatrixAt(i, m4); }); }
  labelMesh.add(borderMesh);
  // top seam: the label is sewn into the collar, a tighter zigzag at its top edge (static, always there)
  {
    const nz = 30, geo = new THREE.CapsuleGeometry(0.009, 0.05, 1, 5); geo.rotateZ(PI / 2);
    const im = new THREE.InstancedMesh(geo, thread(0xff6fae, 0.55), nz); const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nz; i++) { p.set(-0.62 + i * (1.24 / (nz - 1)), LH / 2 - 0.02, 0.0165); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), i % 2 ? 1.2 : -1.2); m4.compose(p, q, s1); im.setMatrixAt(i, m4); }
    labelMesh.add(im);
  }
  // the needle (3D) with its thread tail; rides the border, then the front of each printed line, then parks
  const needle = makeNeedle(M, 0.3, 0xff6fae); needle.visible = false; label.add(needle);

  // ------------------------------------------------------------ print layout (canvas pixels; y is the text baseline)
  const INK = '#3a1745', PINK = '#ff5fa8', CREAM = '#fff4e0';
  const items = [];   // each: { draw(g), x0, x1, y0, y1 } ; wiped left to right in order
  const fontOk = () => { try { return document.fonts.check('64px Fredoka'); } catch (e) { return true; } };
  let fontReady = fontOk(), needRedraw = true;
  if (!fontReady) { set.ready = document.fonts.load('64px Fredoka').then(() => { fontReady = true; needRedraw = true; }); } else set.ready = Promise.resolve();
  const F = (px) => `${px}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
  function line(g, text, x, y, px, align = 'left', spacing = 0, seed = 0) {          // char by char so the print is slightly imperfect
    g.font = F(px); g.textBaseline = 'alphabetic';
    const ws = [...text].map((c) => g.measureText(c).width + spacing), W = ws.reduce((a, b) => a + b, 0) - spacing;
    let cx0 = align === 'center' ? x - W / 2 : align === 'right' ? x - W : x;
    [...text].forEach((c, i) => { g.save(); g.translate(cx0 + (hash(seed + i * 1.3) - 0.5) * 1.4, y + (hash(seed + i * 2.9 + 7) - 0.5) * 1.6); g.rotate((hash(seed + i * 4.1) - 0.5) * 0.006); g.fillText(c, 0, 0); g.restore(); cx0 += ws[i]; });
    return W;
  }
  const measure = (text, px, spacing = 0) => { cx.font = F(px); return [...text].reduce((a, c) => a + cx.measureText(c).width + spacing, 0) - spacing; };
  const stitchLine = (g, y, x0, x1, col = 'rgba(75,35,80,0.7)') => { g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round'; g.setLineDash([26, 18]); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); };
  const MX = 150, IW = CW - 2 * MX;
  const fit = (text, px, maxW, sp = 0) => Math.min(px, px * maxW / Math.max(1, measure(text, px, sp)));
  // size tag and flag (top row)
  items.push({ y0: 92, y1: 190, x0: MX, x1: MX + 540, draw(g) {
    g.fillStyle = '#ffe9a0'; g.beginPath(); g.roundRect(MX, 98, 540, 88, 24); g.fill();
    g.strokeStyle = 'rgba(75,35,80,0.75)'; g.lineWidth = 5; g.setLineDash([16, 12]); g.beginPath(); g.roundRect(MX + 11, 109, 518, 66, 15); g.stroke(); g.setLineDash([]);
    g.fillStyle = INK; line(g, 'XS (UNDEAD)', MX + 270, 166, 58, 'center', 2, 11); } });
  items.push({ y0: 92, y1: 190, x0: CW - MX - 620, x1: CW - MX, draw(g) {
    const x = CW - MX - 620, y = 98, w = 620, h = 88;
    g.fillStyle = PINK; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - 34, y + h / 2); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); g.fill();
    g.fillStyle = CREAM; line(g, 'MADE WITH LOVE', x + w / 2 + 10, y + 60, 50, 'center', 3, 21);
    g.beginPath(); const hx = x + 46, hy = y + 46; g.moveTo(hx, hy + 14); g.bezierCurveTo(hx - 26, hy - 6, hx - 10, hy - 26, hx, hy - 10); g.bezierCurveTo(hx + 10, hy - 26, hx + 26, hy - 6, hx, hy + 14); g.fill(); } });
  // title
  { const tp = 152, tsp = 5; items.push({ y0: 226, y1: 376, get x0() { return CW / 2 - measure('ZOMBIE COUTURE', tp, tsp) / 2 - 30; }, get x1() { return CW / 2 + measure('ZOMBIE COUTURE', tp, tsp) / 2 + 30; }, draw(g) { g.fillStyle = INK; line(g, 'ZOMBIE COUTURE', CW / 2, 352, tp, 'center', tsp, 3); } }); }
  items.push({ y0: 384, y1: 402, x0: MX, x1: CW - MX, draw(g) { stitchLine(g, 393, MX, CW - MX); } });
  const CY0 = [492, 584, 676, 768, 850];
  CREDITS.forEach((t, i) => { const y = CY0[i], px = () => fit(t, 80, IW); items.push({ y0: y - 80, y1: y + 26, x0: MX, get x1() { return MX + measure(t, px()) + 24; }, draw(g) { g.fillStyle = INK; line(g, t, MX, y, px(), 'left', 0, 31 + i * 17); } }); });
  items.push({ y0: 896, y1: 914, x0: MX, x1: CW - MX, draw(g) { stitchLine(g, 905, MX, CW - MX); } });
  // care symbols (woven icons)
  const icons = [
    (g, x, y) => { g.beginPath(); g.moveTo(x - 62, y - 12); g.lineTo(x + 62, y - 12); g.lineTo(x + 46, y + 58); g.lineTo(x - 46, y + 58); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(x - 50, y + 12); g.quadraticCurveTo(x - 25, y - 4, x, y + 12); g.quadraticCurveTo(x + 25, y + 28, x + 50, y + 12); g.stroke();
      g.beginPath(); g.moveTo(x - 16, y - 20); g.lineTo(x - 16, y - 58); g.quadraticCurveTo(x - 16, y - 68, x - 8, y - 68); g.lineTo(x + 14, y - 68); g.quadraticCurveTo(x + 24, y - 68, x + 22, y - 50); g.lineTo(x + 20, y - 26); g.stroke(); g.beginPath(); g.arc(x - 22, y - 44, 9, 0, TAU); g.fill(); },
    (g, x, y) => { g.beginPath(); g.moveTo(x, y - 64); g.lineTo(x + 66, y + 52); g.lineTo(x - 66, y + 52); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(x - 66, y - 44); g.lineTo(x + 66, y + 66); g.moveTo(x + 66, y - 44); g.lineTo(x - 66, y + 66); g.stroke(); },
    (g, x, y) => { g.beginPath(); g.moveTo(x - 66, y + 46); g.lineTo(x + 56, y + 46); g.quadraticCurveTo(x + 70, y + 46, x + 64, y + 26); g.quadraticCurveTo(x + 50, y - 26, x + 20, y - 34); g.lineTo(x - 66, y - 34); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(x - 30, y - 34); g.quadraticCurveTo(x - 30, y - 62, x + 2, y - 62); g.lineTo(x + 30, y - 62); g.stroke(); g.beginPath(); g.arc(x - 6, y + 4, 9, 0, TAU); g.fill(); },
    (g, x, y) => { g.beginPath(); g.roundRect(x - 80, y - 58, 160, 100, 30); g.stroke(); g.beginPath(); g.moveTo(x - 28, y + 40); g.lineTo(x - 46, y + 72); g.lineTo(x + 6, y + 42); g.stroke(); g.font = F(42); g.textAlign = 'center'; g.fillText('moan', x, y + 4); g.textAlign = 'left'; },
    (g, x, y) => { for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + s * 30, y - 58, x + s * 82, y - 40, x + s * 66, y + 6); g.bezierCurveTo(x + s * 60, y + 24, x + s * 26, y + 12, x, y); g.stroke(); g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + s * 36, y + 66); g.lineTo(x + s * 16, y + 66); g.lineTo(x, y + 26); g.stroke(); } g.beginPath(); g.arc(x, y + 4, 13, 0, TAU); g.fill(); },
  ];
  icons.forEach((fn, i) => { const x = CW / 2 + (i - 2) * 330, y = 1002; items.push({ y0: y - 84, y1: y + 84, x0: x - 96, x1: x + 96, draw(g) { g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 9; g.lineJoin = 'round'; g.lineCap = 'round'; fn(g, x, y); } }); });
  { const cp = () => fit(CARE, 80, IW, 1); items.push({ y0: 1096, y1: 1200, get x0() { return CW / 2 - measure(CARE, cp(), 1) / 2 - 24; }, get x1() { return CW / 2 + measure(CARE, cp(), 1) / 2 + 24; }, draw(g) { g.fillStyle = INK; line(g, CARE, CW / 2, 1170, cp(), 'center', 1, 71); } }); }
  // reading order: tag, flag, title, rule, credits, rule, icons, care line
  const order = items.slice(); const nIt = order.length;
  const winOf = (i) => { const a = 0.2 + 0.8 * (i / nIt) * 0.95, b = a + 0.8 * (1.7 / nIt) * 0.95; return [a, Math.min(1, b)]; };
  order.forEach((it, i) => { [it.a, it.b] = winOf(i); });
  order[nIt - 1].b = 1;

  const ink = document.createElement('canvas'); ink.width = CW; ink.height = CHT; const ig = ink.getContext('2d');
  let lastKey = '', needleUV = { x: 0, y: 0, edge: 0 };
  function redraw(r) {
    ig.clearRect(0, 0, CW, CHT);
    let nx = null, ny = null;
    for (const it of order) {
      const f = clamp((r - it.a) / (it.b - it.a)); if (f <= 0) continue;
      ig.save(); ig.beginPath(); ig.rect(it.x0 - 40, it.y0 - 30, (it.x1 - it.x0 + 80) * f + (f >= 1 ? 40 : 0), it.y1 - it.y0 + 70); ig.clip();
      ig.globalAlpha = 1; it.draw(ig); ig.restore();
      if (f > 0 && f < 1) { nx = it.x0 + (it.x1 - it.x0) * f; ny = it.y1 - 12; }
    }
    // weave the print into the cloth: thin gaps between weft rows, so the ink reads as thread, not paint
    ig.globalCompositeOperation = 'destination-out'; ig.fillStyle = 'rgba(0,0,0,0.20)'; for (let y = 0; y < CHT; y += 4) ig.fillRect(0, y, CW, 1.4); ig.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, CW, CHT); cx.drawImage(base, 0, 0); cx.drawImage(ink, 0, 0);
    tex.needsUpdate = true;
    needleUV = nx === null ? null : { x: nx, y: ny };
  }
  const toLocal = (px, py) => [(px / CW - 0.5) * LW, (0.5 - py / CHT) * LH];
  // sparkles (instanced additive stars, billboarded) and confetti flakes (instanced, closed form in time)
  const starTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 60, 0, 7); g.fill(); g.fillStyle = '#fff'; for (const [w, l, a] of [[3.2, 58, 0], [3.2, 58, PI / 2], [1.8, 34, PI / 4], [1.8, 34, -PI / 4]]) { g.save(); g.rotate(a); g.beginPath(); g.moveTo(-l, 0); g.quadraticCurveTo(0, -w, l, 0); g.quadraticCurveTo(0, w, -l, 0); g.fill(); g.restore(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const NS = 26, stars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), NS);
  stars.frustumCulled = false; stars.renderOrder = 6; G.add(stars);
  const starData = Array.from({ length: NS }, (_, i) => { const a = hash(i * 3.7) * TAU, rad = 0.95 + hash(i * 1.3) * 1.5; return { x: Math.cos(a) * rad * 1.35, y: Math.sin(a) * rad * 0.8 - 0.05, z: -0.35 - hash(i * 5.1) * 1.0, s: 0.07 + hash(i * 9.9) * 0.15, ph: hash(i * 2.2) * TAU, sp: 1.1 + hash(i * 6.6) * 1.8 }; });
  const NC = 46, confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.04), confMat, NC); conf.frustumCulled = false; G.add(conf);
  const ccol = [0xff5fa8, 0xffe066, 0x66e0ff, 0xb388ff, 0xff9ecb, 0xb6ffd6, 0xffb347];
  const cdat = Array.from({ length: NC }, (_, i) => { conf.setColorAt(i, new THREE.Color(ccol[i % ccol.length])); const front = i % 6 === 0; const x = (hash(i * 1.9) - 0.5) * 5.4; return { x: front && Math.abs(x) < 0.85 ? Math.sign(x || 1) * (0.9 + hash(i)) : x, y: (hash(i * 4.3) - 0.5) * 3.4, z: front ? 0.2 + hash(i * 8.8) * 0.5 : -0.3 - hash(i * 2.7) * 1.3, ph: hash(i * 7.1) * TAU, sp: 0.08 + hash(i * 3.3) * 0.12, rs: 1 + hash(i * 6.1) * 3 }; });

  // ============================================================ rigs (world coordinates)
  const LPOS = [CX, CY, 0];
  const cardPose = (D, dx = 0, dy = 0) => ({ pos: [CX + dx, CY + dy, D], look: [CX + dx * 0.3, CY, 0], fov: 30 });
  const D_END = 1.98;
  set.rigs.card = (u) => { const k = smooth(u.p), D = lerp(2.55, D_END, k); return cardPose(D, lerp(0.05, 0, k), lerp(0.03, 0, k)); };
  // macro: 0.6 m from the cloth, drifting from the top-left corner (border stitches, tag) across the title and down the credits to the
  // care line, so it follows the front of the weaving when the film ramps `reveal` with the shot
  const macroPath = new THREE.CatmullRomCurve3([[-0.46, 0.35], [-0.30, 0.30], [-0.06, 0.20], [-0.26, 0.05], [-0.12, -0.09], [0.06, -0.20], [0.28, -0.26]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  set.rigs.cardMacro = (u) => { const q = macroPath.getPoint(clamp(u.p)); return { pos: [CX + q.x, CY + q.y + 0.06, 0.6 + 0.05 * Math.sin(u.p * PI)], look: [CX + q.x + 0.08, CY + q.y - 0.02, 0], fov: 26 }; };
  set.rigs.cardPull = (u) => {
    const k = clamp(u.p);
    const A = { pos: [CX - 0.3, CY + 0.6, 0.34], look: [CX + 0.05, CY + 0.32, 0], fov: 24 };          // inside the collar, on the seam
    const B = { pos: [CX + 1.4, CY - 0.5, 8.6], look: [CX, CY - 1.3, -0.1], fov: 34 };                 // the whole dress and the room
    const E = { pos: [CX, CY, D_END], look: [CX, CY, 0], fov: 30 };                                     // exactly the end pose of `card`
    let a, b, f;
    if (k < 0.5) { a = A; b = B; f = smooth(k / 0.5); } else { a = B; b = E; f = smooth((k - 0.5) / 0.5); f = f * f * (3 - 2 * f); }
    const m = (p, q) => [lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f)];
    return { pos: m(a.pos, b.pos), look: m(a.look, b.look), fov: lerp(a.fov, b.fov, f) };
  };

  // ============================================================ light
  set.light = (kit, u, c2) => {
    // the label is 2 to 5 m from every light, so these are much lower than the mall's (whose lights are 10 to 30 m away)
    kit.setKey({ pos: [CX - 1.6, CY + 4.2, 7.5], target: [CX, CY - 0.5, 0], color: 0xffe2c8, i: 1.15, extent: 5.5, near: 2, far: 22, radius: 6 });
    kit.setHemi({ sky: 0xfff0f8, ground: 0xf0c8d8, i: 0.58 });
    kit.setSpot(0, { color: 0xfff0d8, i: 6.2, dist: 24, angle: 0.42, pen: 0.85, decay: 1.2, pos: [CX + 0.6, CY + 1.4, 4.4], target: [CX, CY - 0.05, 0] });   // a gentle pool on the label
    kit.setSpot(1, { color: 0xff8fc8, i: 16, dist: 26, angle: 0.7, pen: 0.7, decay: 1.2, pos: [CX + 3.4, CY + 1.8, -1.6], target: [CX, CY - 0.2, 0] });   // pink rim from behind-right
    kit.setSpot(2, { color: 0xb8e8ff, i: 4, dist: 26, angle: 0.8, pen: 0.8, decay: 1.2, pos: [CX - 4, CY - 0.5, 3], target: [CX, CY - 1, 0] });
    kit.setPoint(0, { color: 0xffe6f0, i: 2.4, dist: 12, decay: 1.4, pos: [CX, CY + 0.4, 2.6] });
  };

  // ============================================================ per-frame
  const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _tmp = new THREE.Vector3();
  set.update = (u, c2) => {
    const r = clamp(c2.args?.reveal ?? 1), t = u.t;
    // sway from its thread
    pivot.rotation.z = 0.016 * Math.sin(t * 1.7) + 0.007 * Math.sin(t * 2.9 + 1);
    pivot.rotation.x = 0.011 * Math.sin(t * 1.3 + 0.5);
    // border stitching, first fifth of the reveal
    const rb = clamp(r / 0.2), nB = Math.floor(rb * border.length + (r >= 0.2 ? border.length : 0) * 0);
    borderMesh.count = r >= 0.2 ? border.length : nB; borderMesh.visible = borderMesh.count > 0;
    // the print
    const key = Math.round(r * 400) + (fontReady ? 'f' : 'n');
    if (key !== lastKey || needRedraw) { redraw(r); lastKey = key; needRedraw = false; }
    // needle position
    let on = false, tx = 0, ty = 0, tz = 0.03, ang = -0.85, bob = 0.5;
    if (r > 0 && r < 0.2 && border.length) { const i = Math.min(border.length - 1, Math.max(0, borderMesh.count - 1)), b = border[i]; tx = b.x; ty = b.y; on = true; bob = (rb * border.length) % 1; }
    else if (r >= 0.2 && r < 1 && needleUV) { [tx, ty] = toLocal(needleUV.x, needleUV.y); on = true; bob = (r * 120) % 1; }
    else if (r >= 1) { const b = border[Math.floor(border.length * 0.42)] || { x: 0.5, y: -0.36 }; tx = LW / 2 - 0.135; ty = -LH / 2 + 0.08; on = true; bob = 0.9; ang = -0.5; }
    needle.visible = on;
    if (on) {
      const lift = r >= 1 ? 0 : 0.07 * (0.5 + 0.5 * Math.cos(bob * TAU)) + 0.01;
      placeNeedle(needle, tx, ty, 0.026, r >= 1 ? -0.5 : -0.9 - 0.2 * Math.sin(bob * TAU), lift);
      needle.userData.tailGroup.rotation.z = Math.sin(t * 2.2) * 0.2;
    }
    // sparkles: billboard to the camera, twinkle as a pure function of time
    const cq = c2.cam ? c2.cam.quaternion : _q.identity();
    starData.forEach((s, i) => { const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph), sc = s.s * (0.35 + 0.9 * tw * tw); _p.set(s.x, s.y + 0.03 * Math.sin(t * 0.6 + s.ph), s.z); _s.set(sc, sc, 1); _m4.compose(_p, cq, _s); stars.setMatrixAt(i, _m4); });
    stars.instanceMatrix.needsUpdate = true;
    cdat.forEach((c, i) => { const y = ((c.y - t * c.sp + 1.7) % 3.4 + 3.4) % 3.4 - 1.7; _p.set(c.x + 0.06 * Math.sin(t * 0.7 + c.ph), y, c.z); _q.setFromEuler(_e.set(t * c.rs + c.ph, t * c.rs * 0.7, c.ph)); _s.set(1, 1, 1); _m4.compose(_p, _q, _s); conf.setMatrixAt(i, _m4); });
    conf.instanceMatrix.needsUpdate = true;
  };

  set.anchors = { label, needle, pivot, dress, center: new THREE.Vector3(CX, CY, 0), labelSize: { w: LW, h: LH }, endCamera: { pos: [CX, CY, D_END], look: [CX, CY, 0], fov: 30 } };
  set.post = { band: 0.44, tilt: 1.3, focusY: 0.5, bloom: 0.16, vig: 0.26, grain: 0.03, sat: 1.0, contrast: 1.02, tint: [1.02, 1.0, 0.98] };
  // draw the label and dress first: the depth test then skips the wall and dress pixels that sit behind them (about 15% off the end frame)
  const nearFirst = (o, v) => o.traverse((x) => { x.renderOrder = v; });
  nearFirst(pivot, -20); nearFirst(dress, -10);
  M.currentK = prevK;
  set.update({ t: 0, p: 0, dur: 6 }, { args: { reveal: 1 }, cam: null });
  return set;
}
