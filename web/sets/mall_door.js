// Extension module of the mall: the shopfront glass door for verse 1 and the pre-chorus.
//   build(ctx, mall) -> ext = { name, root, anchors, slots, rigs, update(u, c2), light(kit, u, c2), post }
// A free-standing felt shopfront: arched double door with two sidelights, a scratched milky glass, a stitched frame,
// an OPEN/CLOSED flip sign, a WELCOME mat, a bell on a curl.  It stands in front of the barricade (on the mall side);
// Pip is behind the barricade ("inside"), the zombies are outside pressed to the glass.
//
// Door-local frame (used for all geometry): +z = outside (toward the mall and the zombies), +x = right as seen from outside, y up.
// c2.args.door: 0 = closed .. 1 = open (eased here, with a small overshoot).  c2.alive fades the light from cold to warm.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add } from '../chars.js';
import { stitchify } from '../stitch.js';
import { beam, glowSprite } from '../set.js';
import { hash, smooth, smoother, clamp, lerp } from '../util.js';
const PI = Math.PI;
const FONT = '"DejaVu Sans", "Liberation Sans", Arial, sans-serif';   // never Fredoka in a canvas: its load timing would make frames differ between processes

const rbox = (w, h, d, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// arch outline (closed): straight sides from y0 up to the spring line ySp, then a half circle of radius hw
function archInto(p, cx, hw, y0, ySp) { p.moveTo(cx - hw, y0); p.lineTo(cx + hw, y0); p.lineTo(cx + hw, ySp); p.absarc(cx, ySp, hw, 0, PI, false); p.lineTo(cx - hw, y0); return p; }
function fitUV(geo, x0, y0, w, h) { const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) - x0) / w, (p.getY(i) - y0) / h); return geo; }

// many running stitches along polylines in ONE instanced mesh
function stitchLines(parent, lines, color, { spacing = 0.2, len = 0.1, thick = 0.02, seed = 1, shadow = false } = {}) {
  const segs = []; let n = 0;
  for (const pts of lines) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = cum[cum.length - 1], c = Math.max(1, Math.round(L / spacing)); segs.push({ pts, cum, L, c }); n += c;
  }
  const g = new THREE.CapsuleGeometry(thick, len, 2, 5); g.rotateX(PI / 2);
  const im = new THREE.InstancedMesh(g, stitchify(new THREE.MeshStandardMaterial({ color, roughness: 1 })), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qj = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), zz = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), tg = new THREE.Vector3();
  let k = 0;
  for (const sg of segs) for (let i = 0; i < sg.c; i++) {
    const s = (i + 0.5) / sg.c * sg.L; let j = 0; while (j < sg.pts.length - 2 && sg.cum[j + 1] < s) j++;
    const f = (s - sg.cum[j]) / Math.max(1e-6, sg.cum[j + 1] - sg.cum[j]);
    p.lerpVectors(sg.pts[j], sg.pts[j + 1], f); tg.subVectors(sg.pts[j + 1], sg.pts[j]).normalize();
    q.setFromUnitVectors(zz, tg); qj.setFromAxisAngle(up, (hash(k * 1.7 + seed) - 0.5) * 0.22); q.multiply(qj);
    const l = 0.9 + hash(k * 3.1 + seed) * 0.25; sc.set(1, 1, l);
    m4.compose(p, q, sc); im.setMatrixAt(k++, m4);
  }
  im.castShadow = shadow; im.receiveShadow = false; parent.add(im); return im;
}
const arcPts = (cx, cy, r, a0, a1, n, z = 0) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return V3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z); });
const linePts = (a, b) => [a, b];

// ------------------------------------------------------------------------------------------------- canvas textures
function rngC(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// milky glass: a faint veil, diagonal highlight streaks, smudges, fingerprints, claw scratches.  Alpha carries all of it.
function glassTexture(seed, w = 384, h = 768, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const R = rngC(seed);
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(214,232,246,0.36)'; g.fillRect(0, 0, w, h);                                   // the veil
  const edge = g.createLinearGradient(0, 0, w, 0); edge.addColorStop(0, 'rgba(200,220,240,0.55)'); edge.addColorStop(0.14, 'rgba(200,220,240,0)'); edge.addColorStop(0.86, 'rgba(200,220,240,0)'); edge.addColorStop(1, 'rgba(200,220,240,0.55)');
  g.fillStyle = edge; g.fillRect(0, 0, w, h);
  // smudges: soft blotches and long wipes, mostly at head height
  for (let i = 0; i < 16; i++) {
    const x = R() * w, y = h * (0.28 + R() * 0.5), r = 22 + R() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${0.26 + R() * 0.22})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr;
    g.save(); g.translate(x, y); g.rotate(R() * PI); g.scale(1, 0.35 + R() * 0.5); g.translate(-x, -y); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore();
  }
  // hand prints: a palm blotch with finger streaks and a few fingerprint whorls
  for (let i = 0; i < (opt.hands ?? 3); i++) {
    const x = w * (0.2 + R() * 0.6), y = h * (0.34 + R() * 0.3);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.ellipse(x, y, 26, 32, 0.2, 0, 7); g.fill();
    for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(x - 30 + f * 20, y - 46 - (f === 1 || f === 2 ? 8 : 0), 7, 20, (f - 1.5) * 0.1, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2;
    for (let f = 0; f < 3; f++) { const fx = x - 24 + f * 24, fy = y - 52; for (let r = 2; r < 12; r += 2.6) { g.beginPath(); g.ellipse(fx, fy, r * 0.8, r * 1.15, 0, 0, 7); g.stroke(); } }
  }
  // breath fog: big soft patches at face height (the zombies stand pressed to the glass)
  for (let i = 0; i < 5; i++) { const x = w * (0.15 + R() * 0.7), y = h * (0.62 + R() * 0.22), r = 44 + R() * 44; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(235,245,255,0.42)'); gr.addColorStop(1, 'rgba(235,245,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  // scratches: claw marks, 3 to 5 fingers dragged down and a little across; tapered, and broken where the nail lifts
  const claw = (x0, y0, L, drift, n, gap, fan, big = 1) => {
    for (let k = 0; k < n; k++) {
      const sx = x0 + k * gap, sy = y0 + (R() - 0.5) * 12, Lk = L * (0.75 + R() * 0.4), segs = 9; let px = sx, py = sy;
      for (let q = 1; q <= segs; q++) {
        const f = q / segs, nx = sx + drift * f * f + (k - n / 2) * gap * fan * f, ny = sy + Lk * f;
        if (!(f > 0.35 && R() < 0.22)) {
          const al = (1 - f * 0.75) * (0.8 + R() * 0.2), wd = 3.6 * big * (1 - f * 0.65); g.lineCap = 'round';
          g.strokeStyle = `rgba(20,30,50,${0.3 * al})`; g.lineWidth = wd + 1.8; g.beginPath(); g.moveTo(px + 1.5, py + 1.5); g.lineTo(nx + 1.5, ny + 1.5); g.stroke();
          g.strokeStyle = `rgba(255,255,255,${0.9 * al})`; g.lineWidth = wd; g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
        }
        px = nx; py = ny;
      }
    }
  };
  for (let i = 0; i < (opt.claws ?? 7); i++) claw(w * (0.12 + R() * 0.76), h * (0.2 + R() * 0.5), 90 + R() * 170, (R() - 0.5) * 120, 3 + Math.floor(R() * 3), 10 + R() * 8, (R() - 0.5) * 0.9);
  if (opt.hero) {   // one deliberate hero mark for the macro rigs: a palm and four fingertips, and a long five-finger drag below them
    const hx = w * opt.hero[0], hy = h * opt.hero[1];
    g.fillStyle = 'rgba(255,255,255,0.34)'; g.beginPath(); g.ellipse(hx + 48, hy - 46, 46, 56, 0.15, 0, 7); g.fill();
    for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(hx + 8 + f * 27, hy - 112 - (f === 1 || f === 2 ? 14 : 0), 10, 30, (f - 1.5) * 0.12, 0, 7); g.fill(); }
    claw(hx, hy + 6, 230, 34, 5, 24, 0.5, 1.5);
  }
  // the diagonal highlight streaks (drawn last so they sit over the dirt)
  g.save(); g.translate(w * (opt.streak ?? 0.5), h * 0.5); g.rotate(0.42);
  for (const [off, wd, al] of [[-w * 0.35, w * 0.15, 0.55], [-w * 0.1, w * 0.05, 0.85], [w * 0.05, w * 0.022, 0.9], [w * 0.3, w * 0.12, 0.42]]) {
    const gr = g.createLinearGradient(off - wd, 0, off + wd, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${al})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(off - wd, -h, wd * 2, h * 2);
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function glassMat(map) {
  return stitchify(new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.55 }));
}
// chunky felt lettering: rounded outline + fill (no font file needed)
function letters(g, text, x, y, px, fill, outline, ow = 0.16, spacing = 0) {
  g.font = `900 ${px}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round';
  if (spacing) { try { g.letterSpacing = spacing + 'px'; } catch (e) { /* older canvas */ } }
  if (outline) { g.strokeStyle = outline; g.lineWidth = px * ow * 2; g.strokeText(text, x, y); }
  g.fillStyle = fill; g.fillText(text, x, y);
}
function signTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const flat = (map, o = {}) => stitchify(new THREE.MeshStandardMaterial({ map, roughness: 1, bumpMap: o.bump ?? null, bumpScale: 1, side: o.side ?? THREE.FrontSide }));

export function build(ctx, mall) {
  const { M, root } = ctx;
  const A = mall.anchors, at = A.at;

  // ---------------------------------------------------------------------------------------------- placement
  const Dc = at(4.6, 0.9);                    // shopfront centre (world x, z): 4.6 m in front of the machine, 0.9 m to the side (the pillar at x = -4.6 stands 2.6 m behind its right end)
  const TH = 0.6;                            // rotation about y; local +z (outside) = (sin TH, cos TH) in world
  const cs = Math.cos(TH), sn = Math.sin(TH);
  const Wp = (x, z) => ({ x: Dc.x + x * cs + z * sn, z: Dc.z - x * sn + z * cs });
  const W = (x, y, z) => { const p = Wp(x, z); return [p.x, y, p.z]; };
  const toLocal = (x, z) => ({ x: (x - Dc.x) * cs - (z - Dc.z) * sn, z: (x - Dc.x) * sn + (z - Dc.z) * cs });
  const D = new THREE.Group(); D.name = 'shopfront'; D.position.set(Dc.x, 0, Dc.z); D.rotation.y = TH; root.add(D);

  // ---------------------------------------------------------------------------------------------- materials
  const mint = M.matte(0xb6ffd6, { rough: 0.7 }), cream = M.cloth(0xfff4e0, { rep: 3 }), pink = M.cloth(0xff9ecb, { rep: 4 }), hot = M.cloth(0xff5fa8, { rep: 4 }),
    plum = M.cloth(0x7a4b8a, { rep: 3 }), butter = M.cloth(0xffe066, { rep: 3 }), brass = M.plastic(0xffd45e, { rough: 0.25 }), lilac = M.cloth(0xd9a7ff, { rep: 4 });
  const cor = 0xff8a6a, crm = 0xfff4e0, hpk = 0xff5fa8;

  // ---------------------------------------------------------------------------------------------- the wall panel with its three arched holes
  const HW = 3.0, DOOR_HW = 1.0, DOOR_SP = 2.75, SL_X = 1.9, SL_HW = 0.6, SL_Y0 = 0.62, SL_SP = 2.9;
  {
    const pn = new THREE.Shape();
    pn.moveTo(-HW, 0); pn.lineTo(HW, 0); pn.lineTo(HW, 4.05); pn.bezierCurveTo(HW - 0.1, 4.55, 1.4, 5.0, 0, 5.0); pn.bezierCurveTo(-1.4, 5.0, -HW + 0.1, 4.55, -HW, 4.05); pn.lineTo(-HW, 0);
    pn.holes.push(archInto(new THREE.Path(), 0, DOOR_HW, 0.02, DOOR_SP));
    pn.holes.push(archInto(new THREE.Path(), -SL_X, SL_HW, SL_Y0, SL_SP), archInto(new THREE.Path(), SL_X, SL_HW, SL_Y0, SL_SP));
    const depth = 0.34;
    const geo = new THREE.ExtrudeGeometry(pn, { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 20 });
    const m = new THREE.Mesh(geo, mint); m.position.z = -depth / 2; m.castShadow = true; m.receiveShadow = true; D.add(m);
    // proud cream trim bands around each hole, front and back
    const band = (cx, hw, y0, ySp, g) => {
      const sh = archInto(new THREE.Shape(), cx, hw + g, y0 <= 0.05 ? 0 : y0 - g, ySp); sh.holes.push(archInto(new THREE.Path(), cx, hw, y0, ySp));
      const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 20 });
      for (const [z, fl] of [[depth / 2 + 0.03, 1], [-depth / 2 - 0.03 - 0.07, 1]]) { const b = new THREE.Mesh(bg, cream); b.position.z = z; b.castShadow = true; b.receiveShadow = true; D.add(b); }
    };
    band(0, DOOR_HW, 0.02, DOOR_SP, 0.27); band(-SL_X, SL_HW, SL_Y0, SL_SP, 0.2); band(SL_X, SL_HW, SL_Y0, SL_SP, 0.2);
    // return walls on the inside so the flat reads as a piece of building from oblique angles
    for (const s of [-1, 1]) {
      add(D, rbox(0.3, 3.5, 1.25, 0.12), mint, { x: s * (HW - 0.15), y: 1.75, z: -0.17 - 0.625 });
      add(D, rbox(0.42, 0.24, 1.4, 0.1), cream, { x: s * (HW - 0.15), y: 3.55, z: -0.17 - 0.625 });
    }
    // sill / threshold
    add(D, rbox(2.5, 0.07, 0.62, 0.03), cream, { y: 0.035, z: 0.0 });
    add(D, rbox(2.9, 0.06, 0.34, 0.03), butter, { y: 0.03, z: 0.62 });
  }
  // stitching on the panel: coral on the trim bands, cream along the wainscot and the crown
  {
    const st = [], cr = [], zf = 0.298;
    for (const [cx, hw, y0, ySp, g] of [[0, DOOR_HW, 0, DOOR_SP, 0.27], [-SL_X, SL_HW, SL_Y0, SL_SP, 0.2], [SL_X, SL_HW, SL_Y0, SL_SP, 0.2]]) {
      const r = hw + g * 0.55, y00 = y0 <= 0.05 ? 0.05 : y0 - g * 0.55;
      st.push([V3(cx - r, y00, zf), V3(cx - r, ySp, zf), ...arcPts(cx, ySp, r, PI, 0, 22, zf).slice(1), V3(cx + r, y00, zf)]);
      if (y0 > 0.05) st.push([V3(cx - r, y00, zf), V3(cx + r, y00, zf)]);
    }
    stitchLines(D, st, cor, { spacing: 0.17, len: 0.09, thick: 0.02, seed: 3 });
    cr.push([V3(-HW + 0.18, 0.5, 0.238), V3(HW - 0.18, 0.5, 0.238)]);
    cr.push([V3(-HW + 0.16, 0.16, 0.238), V3(-HW + 0.16, 3.9, 0.238)], [V3(HW - 0.16, 0.16, 0.238), V3(HW - 0.16, 3.9, 0.238)]);
    const crown = []; for (let i = 0; i <= 30; i++) { const t = i / 30, x = -HW + 0.4 + t * (2 * HW - 0.8); crown.push(V3(x, 4.02 + Math.pow(Math.sin(t * PI), 0.7) * 0.75, 0.238)); }
    cr.push(crown);
    stitchLines(D, cr, crm, { spacing: 0.2, len: 0.1, thick: 0.02, seed: 8 });
    // quilted wainscot diamonds under the sidelights
    const dm = []; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const cx = s * (1.35 + i * 0.55), cy = 0.28; dm.push([V3(cx, cy - 0.16, 0.238), V3(cx + 0.27, cy, 0.238), V3(cx, cy + 0.16, 0.238), V3(cx - 0.27, cy, 0.238), V3(cx, cy - 0.16, 0.238)]); }
    stitchLines(D, dm, 0xffb6d5, { spacing: 0.12, len: 0.06, thick: 0.015, seed: 12 });
  }

  // ---------------------------------------------------------------------------------------------- the shop sign on the crown
  {
    const tex = signTex(1024, 288, (g, w, h) => {
      g.fillStyle = '#fff4e0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff5fa8'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
      g.setLineDash([26, 18]); g.strokeStyle = '#ff8a6a'; g.lineWidth = 6; g.strokeRect(30, 30, w - 60, h - 60); g.setLineDash([]);
      letters(g, 'HEM & CO.', w / 2, h * 0.42, 132, '#ff5fa8', '#7a4b8a', 0.07);
      letters(g, 'ALTERATIONS  ·  BOWS  ·  BUTTONS', w / 2, h * 0.79, 40, '#7a4b8a', null);
    });
    const sg = new THREE.Shape(); const sw = 1.62, sh0 = 4.14, sh1 = 4.86;
    sg.moveTo(-sw, sh0); sg.lineTo(sw, sh0); sg.lineTo(sw, sh1 - 0.2); sg.quadraticCurveTo(sw - 0.05, sh1, sw - 0.5, sh1); sg.lineTo(-sw + 0.5, sh1); sg.quadraticCurveTo(-sw + 0.05, sh1, -sw, sh1 - 0.2); sg.lineTo(-sw, sh0);
    const gg = fitUV(new THREE.ShapeGeometry(sg, 10), -sw, sh0, 2 * sw, sh1 - sh0);
    const plate = new THREE.Mesh(gg, flat(tex)); plate.position.z = 0.262; D.add(plate);
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(sg, { depth: 0.03, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.02, bevelSegments: 2 }), plum); rim.position.z = 0.2; rim.castShadow = true; D.add(rim);
  }

  // ---------------------------------------------------------------------------------------------- glass
  const glassMeshes = [];
  const pane = (geo, seed, opt) => { const m = new THREE.Mesh(geo, glassMat(glassTexture(seed, 384, 768, opt))); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 3; D.add(m); glassMeshes.push(m); return m; };
  {   // fanlight (semicircle above the leaves) with spoke mullions
    const fs = new THREE.Shape(); fs.absarc(0, DOOR_SP, DOOR_HW - 0.02, 0, PI, false); fs.lineTo(DOOR_HW - 0.02, DOOR_SP);
    const fg = fitUV(new THREE.ShapeGeometry(fs, 24), -1, DOOR_SP, 2, 1);
    pane(fg, 41, { hands: 0, claws: 2, streak: 0.4 });
    for (let i = 0; i <= 6; i++) { const a = PI * i / 6; const m = add(D, rbox(0.045, DOOR_HW - 0.1, 0.06, 0.02), cream, { x: Math.cos(a) * (DOOR_HW - 0.1) / 2, y: DOOR_SP + Math.sin(a) * (DOOR_HW - 0.1) / 2, rz: a - PI / 2 }); void m; }
    add(D, new THREE.TorusGeometry(0.42, 0.024, 8, 30, PI), cream, { y: DOOR_SP, z: 0.0 });
  }
  for (const s of [-1, 1]) {   // sidelights
    const sh = archInto(new THREE.Shape(), s * SL_X, SL_HW - 0.02, SL_Y0 + 0.02, SL_SP);
    pane(fitUV(new THREE.ShapeGeometry(sh, 20), s * SL_X - SL_HW, SL_Y0, 2 * SL_HW, SL_SP + SL_HW - SL_Y0), s < 0 ? 51 : 52, { hands: 2, claws: 5, streak: 0.5 });
    add(D, rbox(0.05, 0.05 + 0, 0.06, 0.02), cream, { x: s * SL_X, y: 1.9 });   // tiny rivet so the pane doesn't read as a hole
  }

  // ---------------------------------------------------------------------------------------------- the leaves
  const leaves = [];
  function makeLeaf(side) {
    const pivot = new THREE.Group(); pivot.position.set(side * DOOR_HW, 0, 0); D.add(pivot);
    const leaf = new THREE.Group(); pivot.add(leaf);
    const dir = -side, w = DOOR_HW - 0.015, h = DOOR_SP - 0.06, y0 = 0.06, mid = dir * w / 2;
    const T = 0.13;
    add(leaf, rbox(0.15, h, T, 0.04), pink, { x: dir * 0.075, y: y0 + h / 2 });
    add(leaf, rbox(0.15, h, T, 0.04), pink, { x: dir * (w - 0.075), y: y0 + h / 2 });
    add(leaf, rbox(w, 0.2, T, 0.04), pink, { x: mid, y: y0 + h - 0.1 });
    add(leaf, rbox(w, 0.56, T, 0.05), pink, { x: mid, y: y0 + 0.28 });
    const gy0 = y0 + 0.56, gy1 = y0 + h - 0.2, gh = gy1 - gy0, gw = w - 0.3;
    // inner cream trim round the pane (both faces)
    for (const z of [0.05, -0.05]) {
      add(leaf, rbox(gw + 0.06, 0.05, 0.04, 0.015), cream, { x: mid, y: gy0 + 0.02, z });
      add(leaf, rbox(gw + 0.06, 0.05, 0.04, 0.015), cream, { x: mid, y: gy1 - 0.02, z });
      add(leaf, rbox(0.05, gh, 0.04, 0.015), cream, { x: mid - gw / 2 - 0.015, y: (gy0 + gy1) / 2, z });
      add(leaf, rbox(0.05, gh, 0.04, 0.015), cream, { x: mid + gw / 2 + 0.015, y: (gy0 + gy1) / 2, z });
    }
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat(glassTexture(side < 0 ? 61 : 62, 320, 768, { hands: 3, claws: 8, streak: side < 0 ? 0.35 : 0.65, hero: side < 0 ? null : [0.36, 0.5] })));
    gm.position.set(mid, (gy0 + gy1) / 2, 0); gm.renderOrder = 3; gm.castShadow = false; leaf.add(gm); glassMeshes.push(gm);
    // kick panel appliqué: a cream diamond with a button, stitched
    for (const z of [0.075, -0.075]) {
      add(leaf, rbox(0.34, 0.34, 0.03, 0.09), cream, { x: mid, y: y0 + 0.28, z, rz: PI / 4, sx: 1, sy: 1 });
      add(leaf, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), hot, { x: mid, y: y0 + 0.28, z: z * 1.35, rx: PI / 2 });
    }
    // handle: a brass knob on the free stile, both faces
    for (const z of [0.13, -0.13]) { add(leaf, new THREE.SphereGeometry(0.058, 14, 10), brass, { x: dir * (w - 0.075), y: 1.2, z }); add(leaf, new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), brass, { x: dir * (w - 0.075), y: 1.2, z: z * 0.6, rx: PI / 2 }); }
    // stiles get a running stitch on the outer face
    const zf = T / 2 + 0.004;
    stitchLines(leaf, [linePts(V3(dir * 0.075, y0 + 0.62, zf), V3(dir * 0.075, y0 + h - 0.24, zf)), linePts(V3(dir * (w - 0.075), y0 + 0.62, zf), V3(dir * (w - 0.075), y0 + h - 0.24, zf)), linePts(V3(dir * 0.12, y0 + h - 0.1, zf), V3(dir * (w - 0.12), y0 + h - 0.1, zf))], crm, { spacing: 0.16, len: 0.08, thick: 0.016, seed: 20 + side });
    leaves.push({ pivot, leaf, side, w });
    return { pivot, leaf, dir, w, h, y0 };
  }
  const LL = makeLeaf(-1), LR = makeLeaf(1);

  // OPEN / CLOSED flip sign: hangs on the right leaf's glass near the top; flips as the door starts to open
  const sign = new THREE.Group();
  {
    const mk = (word, fill, bg) => signTex(256, 160, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff4e0'; g.lineWidth = 8; g.setLineDash([16, 10]); g.strokeRect(10, 10, w - 20, h - 20); g.setLineDash([]); letters(g, word, w / 2, h / 2 + 4, word.length > 4 ? 52 : 68, fill, null); });
    const tOut = mk('CLOSED', '#fff4e0', '#ff5fa8'), tIn = mk('OPEN', '#fff4e0', '#3fb58a');
    const bw = 0.44, bh = 0.27;
    const body = add(sign, rbox(bw, bh, 0.03, 0.03), cream, { cast: true });
    const fo = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.03, bh - 0.03), flat(tOut)); fo.position.z = 0.017; sign.add(fo);
    const fi = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.03, bh - 0.03), flat(tIn)); fi.position.z = -0.017; fi.rotation.y = PI; sign.add(fi);
    void body;
    const holder = new THREE.Group(); holder.position.set(-LR.w * 0.5 + 0.02 - 0.0, 2.22, 0.3); holder.add(sign); LR.leaf.add(holder);
    // string from the suction hook on the glass to the sign
    { const str = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), M.thread(hpk)); str.position.set(-LR.w * 0.5 + 0.02, 2.4, 0.16); str.rotation.set(PI / 2, 0, 0); LR.leaf.add(str); }
    add(LR.leaf, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), hot, { x: -LR.w * 0.5 + 0.02, y: 2.4, z: 0.03, rx: PI / 2 });
    sign.userData.holder = holder;
    sign.userData.pivot = holder;
  }
  // a taped note on the glass of the left leaf (front face only; a plain paper back keeps it from mirroring)
  {
    const tex = signTex(256, 200, (g, w, h) => { g.fillStyle = '#fffbe8'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(120,90,60,0.35)'; g.lineWidth = 2; for (let y = 60; y < h; y += 26) { g.beginPath(); g.moveTo(14, y); g.lineTo(w - 14, y); g.stroke(); } letters(g, 'NO BRAINS', w / 2, 40, 40, '#c2185b', null); letters(g, 'HERE. ONLY', w / 2, 92, 34, '#5b3a70', null); letters(g, 'BEANS!', w / 2, 146, 52, '#5b3a70', null); });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.28), flat(tex)); note.position.set(LL.dir * 0.42, 1.98, 0.062); note.rotation.z = 0.06; LL.leaf.add(note);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.28), M.matte(0xfffbe8)); back.position.set(LL.dir * 0.42, 1.98, 0.06); back.rotation.set(0, PI, 0.06); back.rotation.y = PI; back.position.z = 0.058; LL.leaf.add(back);
    for (const dx of [-0.16, 0.16]) add(LL.leaf, rbox(0.1, 0.03, 0.01, 0.005), butter, { x: LL.dir * 0.42 + dx, y: 2.12, z: 0.066, rz: dx * 0.9 });
  }

  // ---------------------------------------------------------------------------------------------- bell on a curl (mounted at the top of the inside face of the right leaf)
  const bellPivot = new THREE.Group();
  {
    const curve = []; for (let i = 0; i <= 28; i++) { const t = i / 28, a = t * PI * 2.6, r = 0.12 * (1 - t * 0.75); curve.push(V3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve), 60, 0.011, 6, false), M.thread(0x3b2a4d));
    const mount = new THREE.Group(); mount.position.set(-LR.w + 0.28, LR.y0 + LR.h - 0.42, -0.14); LR.leaf.add(mount); mount.add(tube);
    add(mount, new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), brass, { x: 0.12, y: 0, z: 0, rx: PI / 2 });
    bellPivot.position.set(-0.01, -0.02, 0); mount.add(bellPivot);
    const prof = [[0.001, 0.0], [0.05, 0.005], [0.075, 0.02], [0.062, 0.07], [0.04, 0.115], [0.02, 0.135], [0.001, 0.14]].map((p) => new THREE.Vector2(p[0], p[1]));
    const bell = add(bellPivot, new THREE.LatheGeometry(prof, 20), brass, { y: -0.2, sx: 1.1, sz: 1.1 }); void bell;
    add(bellPivot, new THREE.SphereGeometry(0.02, 8, 6), M.plastic(0xff5fa8), { y: -0.2 });
    add(bellPivot, new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5), M.thread(0x3b2a4d), { y: -0.05 });
    { const bw = makeBow(M, 0xff5fa8); bw.position.y = -0.075; bellPivot.add(bw); }
  }

  // ---------------------------------------------------------------------------------------------- doormat (outside)
  {
    const tex = signTex(512, 300, (g, w, h) => {
      g.fillStyle = '#7a4b8a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffb6d5'; g.lineWidth = 10; g.setLineDash([26, 16]); g.strokeRect(24, 24, w - 48, h - 48); g.setLineDash([]);
      g.strokeStyle = '#fff4e0'; g.lineWidth = 4; g.strokeRect(46, 46, w - 92, h - 92);
      letters(g, 'WELCOME', w / 2, h / 2 + 4, 84, '#fff4e0', '#ff5fa8', 0.06);
    });
    add(D, rbox(1.72, 0.05, 0.98, 0.06), plum, { y: 0.03, z: 1.22 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 0.9), flat(tex)); m.rotation.x = -PI / 2; m.position.set(0, 0.058, 1.22); m.receiveShadow = true; D.add(m);
  }

  // ---------------------------------------------------------------------------------------------- shafts and dust
  const shafts = [];
  {
    const b1 = beam(D, 0, 0, 0x9cc0ff, 1.5, 9, [0, 0], 0.16); b1.position.set(0.2, 3.3, 1.5); b1.rotation.set(0.75, 0, 0.0); shafts.push(b1);
    const b2 = beam(D, 0, 0, 0xa8c8ff, 0.9, 8, [0, 0], 0.12); b2.position.set(-1.6, 3.6, 2.4); b2.rotation.set(0.6, 0, -0.15); shafts.push(b2);
    const b3 = beam(D, 0, 0, 0x9cc0ff, 1.0, 8, [0, 0], 0.11); b3.position.set(1.9, 3.5, 2.8); b3.rotation.set(0.6, 0, 0.18); shafts.push(b3);
  }
  const NDUST = 90, dustBase = new Float32Array(NDUST * 3), dustGeo = new THREE.BufferGeometry();
  for (let i = 0; i < NDUST; i++) { dustBase[i * 3] = (hash(i * 1.3) - 0.5) * 6.5; dustBase[i * 3 + 1] = 0.3 + hash(i * 2.9 + 1) * 4.2; dustBase[i * 3 + 2] = -3.2 + hash(i * 5.1 + 2) * 8.2; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustBase), 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.075, map: glowSprite(64), color: 0xcfe0ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  dustPts.frustumCulled = false; D.add(dustPts);

  // ---------------------------------------------------------------------------------------------- slots
  const facingOut = TH, facingIn = TH + PI;                 // rotY that looks out (toward the zombies) / in (toward Pip)
  const slots = {};
  const inP = at(-1.2, 0.3); slots.inside = { x: inP.x, y: 0, z: inP.z, rotY: facingOut };
  { const p = Wp(0.85, -1.25); slots.latch = { x: p.x, y: 0, z: p.z, rotY: facingOut }; }        // Pip at the door, for the over-the-shoulder door-opening shots
  const GX = [-2.05, -1.22, -0.4, 0.42, 1.24, 2.06], GZ = [0.46, 0.42, 0.48, 0.44, 0.49, 0.45], GR = [0.07, -0.09, 0.05, -0.06, 0.08, -0.05];
  GX.forEach((x, i) => { const p = Wp(x, GZ[i]); slots['glass' + i] = { x: p.x, y: 0, z: p.z, rotY: facingIn + GR[i] }; });
  { const p = Wp(0.0, 0.1); slots.doorway = { x: p.x, y: 0, z: p.z, rotY: facingIn }; }
  const OX = [-3.1, -1.55, 0.05, 1.6, 3.15, -2.3, 0.85, 2.45], OZ = [1.9, 2.25, 2.0, 2.3, 1.95, 3.5, 3.7, 3.4], OR = [0.2, -0.15, 0.1, -0.2, 0.15, -0.1, 0.25, -0.05];
  OX.forEach((x, i) => { const p = Wp(x, OZ[i]); slots['outside' + i] = { x: p.x, y: 0, z: p.z, rotY: facingIn + OR[i] }; });
  // the crowd standing in and just outside the open doorway (for the "staring" shots)
  [[-0.62, 0.2], [0.55, 0.28], [-0.05, 0.95], [-1.05, 1.15], [1.0, 1.2], [0.3, 1.85]].forEach(([x, z], i) => { const p = Wp(x, z); slots['stare' + i] = { x: p.x, y: 0, z: p.z, rotY: facingIn + (i % 2 ? 0.1 : -0.1) }; });

  // ---------------------------------------------------------------------------------------------- rigs (world coordinates)
  const P = (p) => clamp(p);
  const BL = toLocal(A.O.x, A.O.z);       // the barricade in door-local coordinates (about 4.6 m behind the door)
  const rigs = {
    // from inside, over Pip's shoulder (Pip at `latch`): the shopfront fills the frame, the dead mall shows through the glass
    doorWide: (u) => { const p = P(u.p); return { pos: W(0.2 - 0.15 * p, 1.72, -3.5 + 0.4 * p), look: W(-0.3, 1.78, 0.6), fov: 38 }; },
    // macro on the pane from inside: faces and palms on the glass (zombies at glass2 / glass3)
    glassCU: (u) => { const p = P(u.p); return { pos: W(-0.1 + 0.3 * p, 1.5, -1.35), look: W(0.0, 1.42, 0.3), fov: 34 }; },
    // hands scratching down the glass, extreme close (glass3)
    scratchCU: (u) => { const p = P(u.p); return { pos: W(0.3 + 0.2 * p, 1.56, -0.95), look: W(0.5, 1.5 - 0.06 * p, 0.0), fov: 32 }; },
    // dolly back from the latch as the door swings in
    doorOpen: (u) => { const p = P(u.p); return { pos: W(-0.5, 1.5 + 0.1 * p, -0.95 - 1.5 * smooth(p)), look: W(0.1, 1.65, 1.5), fov: 42 - 3 * p }; },
    // from outside looking in: the barricade shows through the glass, Pip behind it
    outsideIn: (u) => { const p = P(u.p); return { pos: W(-0.9 + 0.6 * p, 1.3, 4.7 - 0.5 * p), look: W(BL.x - 0.2, 1.5, BL.z), fov: 34 }; },
    // from inside, the crowd standing in the open doorway
    staring: (u) => { const p = P(u.p); return { pos: W(0.1, 1.35, -3.3 + 1.0 * smooth(p)), look: W(0.0, 1.4, 1.2), fov: 36 - 3 * p }; },
    // layout check from above (debug)
    plan: () => ({ pos: W(0.2, 15, 4.5), look: W(0.2, 0, -2.5), fov: 50 }),
  };

  // ---------------------------------------------------------------------------------------------- lights (kit: 1 key, hemi, spots 0..5, points 0..1)
  const cAlive = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k);
  const light = (kit, u, c2) => {
    const alive = c2.alive ?? 0, warm = smooth(clamp((alive - 0.2) / 0.6)), cold = 1 - warm * 0.65;
    const pip = slots.inside, pc = c2.pip ?? pip;
    kit.setKey({ pos: W(-1.5, 9.5, 7.5), target: W(0, 0.6, -1.6), color: cAlive(0xa9c2ff, 0xffe2c4, warm), i: lerp(1.1, 1.7, warm), extent: 9, near: 1, far: 30 });
    kit.setHemi({ sky: cAlive(0xb4c4ff, 0xffe8dc, warm), ground: cAlive(0x2c3460, 0xd8b0b8, warm), i: lerp(0.46, 0.58, warm) });
    kit.setSpot(0, { color: cAlive(0x9fc0ff, 0xd8e8ff, warm), i: 150 * cold, dist: 30, angle: 0.44, pen: 0.7, decay: 1.1, pos: W(0.2, 8.0, 5.6), target: W(0.0, 0.3, -1.8) });                 // the cold shaft through the glass
    kit.setSpot(1, { color: 0xb4d0ff, i: 82 * cold, dist: 26, angle: 0.55, pen: 0.7, decay: 1.2, pos: W(1.6, 6.5, 6.0), target: W(0.0, 1.3, 0.4) });                                 // back-light on the pressed zombies
    kit.setSpot(2, { color: 0xffc890, i: lerp(105, 60, warm), dist: 14, angle: 0.5, pen: 0.7, decay: 1.2, pos: [pc.x + 0.5, 3.4, pc.z - 1.2], target: [pc.x, 1.0, pc.z] });        // warm lamp pool on Pip
    kit.setSpot(3, { color: 0xffb98a, i: lerp(46, 25, warm), dist: 16, angle: 0.6, pen: 0.8, decay: 1.2, pos: [A.O.x + 1.6, 4.2, A.O.z - 1.0], target: [A.O.x, 1.0, A.O.z + 0.4] });   // warm kicker on the barricade
    kit.setSpot(4, { color: 0x8fa8ff, i: 62 * cold, dist: 30, angle: 0.6, pen: 0.8, decay: 1.2, pos: W(-3.5, 7.5, 10.5), target: W(0.0, 0.8, 3.2) });                                // cold fill on the outside crowd
    kit.setPoint(0, { color: 0xffc890, i: 18, dist: 7, decay: 1.6, pos: [A.O.x + 0.6, 2.4, A.O.z + 1.4] });                                                                          // the machine's lamp
    kit.setPoint(1, { color: 0xa8c8ff, i: 26 * cold, dist: 9, decay: 1.5, pos: W(0.0, 2.7, 1.4) });                                                                                  // cold glow outside the door
  };

  // ---------------------------------------------------------------------------------------------- update
  const swing = (d) => smoother(d) + 0.07 * Math.sin(PI * clamp((d - 0.55) / 0.45));            // ease with a small overshoot that settles at d = 1
  const update = (u, c2) => {
    const alive = c2.alive ?? 0, d = clamp(c2.args?.door ?? 0), t = c2.t ?? u.t ?? 0;
    LL.pivot.rotation.y = +swing(d) * 1.72;
    LR.pivot.rotation.y = -swing(clamp((d - 0.1) / 0.9)) * 1.5;
    // the sign flips CLOSED -> OPEN as the door starts to move (the wobble is a damped swing about the vertical axis)
    const f = smooth(clamp((d - 0.02) / 0.26));
    sign.userData.holder.rotation.y = PI * f + 0.35 * Math.sin(f * PI) * 0.4 * Math.sin(d * 40);
    sign.userData.holder.rotation.z = 0.04 * Math.sin(d * 33) * (1 - d) * (d > 0.02 ? 1 : 0);
    // the bell rings while the door moves and then settles
    const ring = d > 0.01 ? Math.exp(-Math.max(0, d - 0.15) * 3.2) : 0;
    bellPivot.rotation.z = 0.7 * ring * Math.sin(d * 58); bellPivot.rotation.x = 0.25 * ring * Math.sin(d * 47 + 1);
    // dust drifts in the shaft
    const pa = dustGeo.attributes.position;
    for (let i = 0; i < NDUST; i++) {
      pa.setXYZ(i, dustBase[i * 3] + Math.sin(t * 0.21 + i) * 0.25, dustBase[i * 3 + 1] + Math.sin(t * 0.33 + i * 1.7) * 0.18 - ((t * 0.04 * (0.5 + hash(i))) % 1) * 0.0, dustBase[i * 3 + 2] + Math.cos(t * 0.17 + i * 0.6) * 0.25);
    }
    pa.needsUpdate = true;
    dustPts.visible = alive < 0.9; shafts.forEach((s) => (s.visible = alive < 0.4));
    // the glass yellows a little less when the world is alive (nothing to do: the factory shader handles colour)
  };

  // pretty-print slots into the mall's slot table so previews and the film can find them by name (existing names are never replaced)
  mall.slots = mall.slots || {};
  for (const [k, v] of Object.entries(slots)) { if (!(k in mall.slots)) mall.slots[k] = v; mall.slots['mall_door.' + k] = v; }

  return {
    name: 'mall_door', root, group: D, slots, rigs, update, light,
    anchors: { centre: Dc, rotY: TH, toLocal, W, Wp, leafL: LL.pivot, leafR: LR.pivot, sign, bell: bellPivot, glass: glassMeshes, inside: inP },
    post: { band: 0.4, tilt: 1.8, focusY: 0.5 },
  };
}

// small local bow (chars.js exports makeBow, but the ext keeps its own copy of the shape so the file stays self-contained)
function makeBow(M, color) {
  const g = new THREE.Group();
  for (const sd of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), M.satin(color)); l.position.x = sd * 0.04; l.scale.set(1.25, 0.72, 0.5); l.rotation.z = sd * 0.25; g.add(l); }
  const k = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), M.satin(color)); g.add(k);
  return g;
}
