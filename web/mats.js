// Material kits. One scene, several skins: the same geometry is dressed as glossy vinyl, hand-stitched felt, or plain broadcast.
import * as THREE from 'three';
import { stitchify } from './stitch.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function fibreCanvas(size, seed, mode) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const R = rng(seed);
  g.fillStyle = mode === 'bump' ? '#808080' : '#f0f0f0'; g.fillRect(0, 0, size, size);
  // wool fibres: curved strokes at random angles, light and dark. Bold enough to read at 720p on a doll-sized head.
  for (let i = 0; i < size * 9; i++) {
    const x = R() * size, y = R() * size, a = R() * Math.PI * 2, l = 7 + R() * 22;
    const v = R() < 0.5;
    g.strokeStyle = mode === 'bump'
      ? (v ? `rgba(255,255,255,${0.16 + R() * 0.34})` : `rgba(0,0,0,${0.16 + R() * 0.34})`)
      : (v ? `rgba(255,255,255,${0.16 + R() * 0.30})` : `rgba(120,104,124,${0.08 + R() * 0.20})`);
    g.lineWidth = 1.3 + R() * 1.9;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.9) * l * 0.5, y + Math.sin(a + 0.9) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}

// card stock: soft grain plus a few pale cotton fibres. Same UV contract as fibreCanvas (colour or bump).
function paperCanvas(size, mode) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const R = rng(mode === 'bump' ? 31 : 17);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (R() + R() + R()) / 3 - 0.5;
    const v = mode === 'bump' ? 128 + n * 150 : 244 + n * 22;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = mode === 'bump' ? v : v - 3; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let i = 0; i < size / 3; i++) {
    const x = R() * size, y = R() * size, a = R() * Math.PI * 2, l = 10 + R() * 30;
    g.strokeStyle = mode === 'bump' ? `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${0.08 + R() * 0.12})` : `rgba(${R() < 0.5 ? '255,255,255' : '150,140,130'},${0.06 + R() * 0.10})`;
    g.lineWidth = 0.7 + R() * 0.8; g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}

const TEX_CACHE = new Map();
function tex(canvas, repeat, srgb) {
  const key = repeat + (srgb ? 's' : 'l');
  let m = TEX_CACHE.get(canvas); if (!m) TEX_CACHE.set(canvas, m = new Map());
  let t = m.get(key); if (t) return t;
  t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  m.set(key, t); return t;
}

export function checkerTexture(a, b, n = 16, size = 1024, grout = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const s = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
  g.strokeStyle = grout; g.globalAlpha = 0.7; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function makeMats(style, lite = false, opt = {}) {
  const felt = style === 'felt';
  const paper = felt && !!opt.paper;          // proposal C: same structure as felt, card-stock surface
  const fMap = felt ? (paper ? paperCanvas(512, 'color') : fibreCanvas(512, 7, 'color')) : null;
  const fBump = felt ? (paper ? paperCanvas(512, 'bump') : fibreCanvas(512, 11, 'bump')) : null;
  const env = { envMapIntensity: 1.0 };

  // generic lit surface for everything cloth / plastic
  const api = { currentK: null, sew: false };
  function surf(color, o = {}) {
    const col = new THREE.Color(color);
    if (felt) {
      const rep = (o.rep ?? 5) * 0.5 * (paper ? 2 : 1);
      const m = new THREE.MeshStandardMaterial({
        color: col, roughness: paper ? 0.92 : 1, metalness: 0, map: tex(fMap, rep, true), bumpMap: tex(fBump, rep, false),
        bumpScale: (o.bump ?? 2.4) * (paper ? 0.28 : 1), side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1,
      });
      return o.noStitch ? m : stitchify(m, o.uK ?? api.currentK, o.sew ?? api.sew);
    }
    if (lite) return new THREE.MeshStandardMaterial({ color: col, roughness: Math.max(0.28, (o.rough ?? 0.34)), metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1, envMapIntensity: o.env ?? 1.0 });
    return new THREE.MeshPhysicalMaterial({
      color: col, roughness: o.rough ?? 0.34, metalness: o.metal ?? 0, clearcoat: o.clear ?? 1.0, clearcoatRoughness: o.clearRough ?? 0.08,
      sheen: o.sheen ?? 0, sheenColor: new THREE.Color(o.sheenColor ?? 0xffffff), side: o.side ?? THREE.FrontSide,
      transparent: !!o.transparent, opacity: o.opacity ?? 1, envMapIntensity: o.env ?? 1.0,
      ...(o.extra || {}),
    });
  }

  return Object.assign(api, {
    style, felt,
    surf,
    skin: (c) => felt ? surf(c, { rep: 6, bump: 1.8 }) : surf(c, { rough: 0.42, clear: 0.55, clearRough: 0.22, sheen: 0.6, sheenColor: 0xffc0c0 }),
    cloth: (c, o = {}) => felt ? surf(c, { rep: o.rep ?? 5, side: THREE.DoubleSide, bump: 2.6 })
      : surf(c, { rough: 0.5, clear: 0.6, clearRough: 0.25, sheen: 1.0, sheenColor: o.sheenColor ?? 0xffffff, side: THREE.DoubleSide, env: 0.9 }),
    satin: (c, o = {}) => felt ? surf(c, { rep: 5, side: THREE.DoubleSide }) : surf(c, { rough: 0.22, clear: 1, clearRough: 0.05, sheen: 0.5, side: THREE.DoubleSide }),
    hair: (c) => felt ? surf(c, { rep: 10, bump: 3.2 }) : surf(c, { rough: 0.3, clear: 1, clearRough: 0.05, sheen: 0.8, sheenColor: 0xffffff }),
    plastic: (c, o = {}) => surf(c, { rough: o.rough ?? 0.25, clear: 1, ...o }),
    metal: (c) => felt ? surf(c, { rep: 3, bump: 0.5 }) : surf(c, { rough: 0.18, metal: 1, clear: 0.4, env: 1.6 }),
    matte: (c, o = {}) => surf(c, { rough: 0.9, clear: 0, ...o }),
    glow: (c, k = 2) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(felt ? Math.min(k, 1.15) : k), toneMapped: false }); return felt ? stitchify(m, api.currentK, api.sew) : m; },
    eyeWhite: () => { const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, emissive: 0x666666 }); return felt ? stitchify(m, api.currentK, api.sew) : m; },
    ink: (c = 0x2b1a3a) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }); return felt ? stitchify(m, api.currentK, api.sew) : m; },
    // unlit colour (highlights, blush, tongue) that still obeys the makeover
    basic: (c, o = {}) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true, toneMapped: o.toneMapped ?? true }); return felt ? stitchify(m, api.currentK, api.sew) : m; },
    thread: (c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }); return felt ? stitchify(m, api.currentK, api.sew) : m; },
    fabricTex: (rep) => tex(fMap, rep, true),
  });
}
