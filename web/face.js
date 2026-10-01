// Faces for the whole cast: viseme mouth blend, blinks, gaze, brows, emotes, zombie moans, deterministic autoBlink / autoLook.
//
// Two halves:
//  * build side  makeMouth() / makeLid() / makeMargin() are called by buildFace() in chars.js while a head is built, so the materials carry the
//                character's makeover K. They make small meshes whose vertices are rewritten in place (no allocation) from a parameter vector.
//                Every one of them is initialised to the resting face, so a character that never calls rigFace/setFace looks like it always did.
//  * rig side    rigFace(char) collects the handles, setFace(char, F) moves them. Pure function of F: no smoothing, no history, no clock.
//
// Look direction: look = [x, y], x > 0 moves the eyes toward the head's local +x (screen right when the character faces the camera), y > 0 up.
import * as THREE from 'three';
import { hash } from './util.js';

const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const VISEMES = ['rest', 'MBP', 'FV', 'O', 'U', 'AA', 'EE', 'TLD'];
export const EMOTE_NAMES = ['neutral', 'happy', 'awe', 'shy', 'gasp', 'sleepy', 'smug', 'proud', 'worried', 'moan', 'cheeky'];   // the ten of the brief plus a tongue-out extra

// ------------------------------------------------------------------------------------------------------------------------------
// surface frames: a flat coordinate patch (x east, y north, metres) wrapped onto the skull ellipsoid used in chars.js
// ------------------------------------------------------------------------------------------------------------------------------
const SKX = 1.06, SKY = 0.99;                    // the skull sphere is scaled like this in buildCharacter()
const IX = 1 / (SKX * SKX), IY = 1 / (SKY * SKY);
const _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

class Frame {
  constructor(R, az, el, roll = 0) {
    this.R = R; this.az = az; this.el = el; this.roll = roll;
    this.d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.q = new THREE.Quaternion().setFromUnitVectors(_z, this.d);        // same orientation onSurface() gives a decal
    if (roll) this.q.multiply(_q2.setFromAxisAngle(_z, roll));
    this.e = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    this.n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    this.nx = 0; this.ny = 0; this.nz = 0;                                 // outward skull normal of the last point put()
  }
  // head-space point on the skull under patch offset (x, y), lifted h metres along the skull normal; writes out[o..o+2]
  put(x, y, h, out, o) {
    const R = this.R, d = this.d, e = this.e, n = this.n;
    const qx = d.x * R + e.x * x + n.x * y, qy = d.y * R + e.y * x + n.y * y, qz = d.z * R + e.z * x + n.z * y;
    const il = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz);
    const ux = qx * il, uy = qy * il, uz = qz * il;
    const rr = R / Math.sqrt(ux * ux * IX + uy * uy * IY + uz * uz);
    let nx = ux * IX, ny = uy * IY, nz = uz;
    const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= nl; ny *= nl; nz *= nl;
    out[o] = ux * rr + nx * h; out[o + 1] = uy * rr + ny * h; out[o + 2] = uz * rr + nz * h;
    this.nx = nx; this.ny = ny; this.nz = nz;
  }
}

// place a mesh on the unit-direction (az, el) of the head sphere, facing outward, rolled about its own z (identical to chars.js onSurface)
export function placeAt(m, R, az, el, k, roll) {
  const ce = Math.cos(el);
  _d.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
  m.position.copy(_d).multiplyScalar(R * k);
  m.quaternion.setFromUnitVectors(_z, _d);
  if (roll) m.rotateZ(roll);
}

function dynGeo(nv, index, withUv) {
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); pa.setUsage(THREE.DynamicDrawUsage);
  const na = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); na.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('normal', na);
  if (withUv) { const ua = new THREE.BufferAttribute(new Float32Array(nv * 2), 2); ua.setUsage(THREE.DynamicDrawUsage); g.setAttribute('uv', ua); }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}
// index buffer of a grid: K columns x RW rows (vertex = col * RW + row, row 0 = upper side); flip reverses the winding
function gridIndex(K, RW, flip) {
  const idx = new Uint16Array((K - 1) * (RW - 1) * 6); let p = 0;
  for (let j = 0; j < K - 1; j++) for (let i = 0; i < RW - 1; i++) {
    const A = j * RW + i, B = A + 1, C = A + RW, D = C + 1;
    if (!flip) { idx[p++] = A; idx[p++] = B; idx[p++] = C; idx[p++] = B; idx[p++] = D; idx[p++] = C; }
    else { idx[p++] = A; idx[p++] = C; idx[p++] = B; idx[p++] = B; idx[p++] = C; idx[p++] = D; }
  }
  return idx;
}
function boundTo(geo, fr, radius) { geo.boundingSphere = new THREE.Sphere(fr.d.clone().multiplyScalar(fr.R), radius); geo.boundingBox = null; }
const colU = (K) => { const u = new Float32Array(K); for (let j = 0; j < K; j++) u[j] = Math.sin(-PI / 2 + PI * j / (K - 1)); return u; };   // -1..1, dense near the ends

// ------------------------------------------------------------------------------------------------------------------------------
// mouth: lips outline, cavity, teeth band, tongue. Parameter vector (metres, mouth-centre relative):
//   0 w   half width          1 cy  corner height        2 sk  right-corner minus left (skew)     3 up  upper lip above the corner line
//   4 dn  lower lip below it  5 exU 6 exL  curve exponents (0.5 ellipse, 1 parabola)               7 th  teeth band height (hangs from the upper lip)
//   8 tg  tongue height       9 tt  tongue tip-up 0..1     10 lp lip outline thickness
// ------------------------------------------------------------------------------------------------------------------------------
export const MP = 11;
const MOUTH_LAYER = { lips: 0.0016, cav: 0.0029, tongue: 0.0042, teeth: 0.0055 };

export function makeMouth(M, head, R, o) {
  const C = o.cols ?? 17, CT = 11;
  const fr = new Frame(R, o.az ?? 0, o.el ?? -0.34, o.roll ?? 0);
  const u = colU(C), s = new Float32Array(C), ut = colU(CT);
  for (let j = 0; j < C; j++) s[j] = Math.max(0, 1 - u[j] * u[j]);
  const xs = new Float32Array(C), yU = new Float32Array(C), yL = new Float32Array(C), tj = new Float32Array(C);
  const mk = (n, rows, mat, layer, name) => {
    const g = dynGeo(n * rows, gridIndex(n, rows, false), false); boundTo(g, fr, 0.2);
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = false; m.receiveShadow = false; head.add(m);
    return { mesh: m, pos: g.attributes.position.array, nrm: g.attributes.normal.array, pa: g.attributes.position, na: g.attributes.normal, layer, rows };
  };
  // tall shapes need several rows: a single tall triangle would cut through the curved skull and vanish
  const L = o.lips ? mk(C, 5, o.lips, MOUTH_LAYER.lips, 'lips') : null;
  const V = mk(C, 5, o.cavity, MOUTH_LAYER.cav, 'cavity');
  const T = o.teeth ? mk(C, 2, o.teeth, MOUTH_LAYER.teeth, 'teeth') : null;
  const G = o.tongue ? mk(CT, 3, o.tongue, MOUTH_LAYER.tongue, 'tongue') : null;
  const out = { frame: fr, lips: L && L.mesh, cavity: V.mesh, teeth: T && T.mesh, tongue: G && G.mesh, top: 0, gap: 0, w: 0 };

  // vertex (column j, row i of S.rows) between y0 (row 0) and y1 (last row)
  function col(S, j, x, y0, y1) {
    const RW = S.rows;
    for (let i = 0; i < RW; i++) {
      const k = (j * RW + i) * 3;
      fr.put(x, y0 + (y1 - y0) * (i / (RW - 1)), S.layer, S.pos, k);
      S.nrm[k] = fr.nx; S.nrm[k + 1] = fr.ny; S.nrm[k + 2] = fr.nz;
    }
  }

  out.update = function (P) {
    const w = Math.max(0.004, P[0]), cy = P[1], sk = P[2], up = P[3], dn = P[4], exU = P[5], exL = P[6], th = P[7], tg = P[8], tt = P[9], lp = P[10];
    let maxGap = 0;
    for (let j = 0; j < C; j++) {
      const sj = s[j], x = w * u[j];
      let a = cy + sk * u[j] + up * Math.pow(sj, exU), b = cy + sk * u[j] - dn * Math.pow(sj, exL);
      if (a < b) { const m = 0.5 * (a + b); a = b = m; }
      xs[j] = x; yU[j] = a; yL[j] = b; if (a - b > maxGap) maxGap = a - b;
      const edge = 1 - Math.abs(u[j]); tj[j] = th * Math.min(1, edge / 0.24) * (0.55 + 0.45 * Math.min(1, edge / 0.5));   // teeth band tapers toward the corners
    }
    out.top = yU[C >> 1]; out.gap = maxGap; out.w = w;
    for (let j = 0; j < C; j++) {
      if (L) { const lt = lp * (0.4 + 0.6 * Math.pow(s[j], 0.35)); col(L, j, xs[j] * (1 + lp * 0.9 / w), yU[j] + lt, yL[j] - lt); }
      col(V, j, xs[j], yU[j], yL[j]);
      if (T) { const top = yU[j] - 0.0004, bot = Math.max(yL[j] + 0.0004, top - tj[j]); col(T, j, xs[j], top, Math.min(bot, top)); }
    }
    if (L) { L.pa.needsUpdate = true; L.na.needsUpdate = true; }
    V.pa.needsUpdate = true; V.na.needsUpdate = true;
    if (T) { T.pa.needsUpdate = true; T.na.needsUpdate = true; T.mesh.visible = th > 0.002 && maxGap > 0.004; }
    if (G) {
      const pr = tt > 1 ? tt - 1 : 0, te = tt > 1 ? 1 : tt;            // tt 0..1 tip up; above 1 the tongue hangs out over the lower lip (cheeky)
      const tw = (o.tongueW ?? 0.5) * w * (1 - 0.25 * te) * (1 + 0.15 * pr), ht = tg * (1 + 0.5 * te);
      for (let j = 0; j < CT; j++) {
        const xt = tw * ut[j], uc = xt / w, sc = Math.max(0, 1 - uc * uc), bell = Math.pow(Math.max(0, 1 - ut[j] * ut[j]), 0.6);
        const lo = cy + sk * uc - dn * Math.pow(sc, exL), hi = cy + sk * uc + up * Math.pow(sc, exU);
        const teeth = th * Math.min(1, (1 - Math.abs(uc)) / 0.24);
        const yb0 = lo + 0.0006, yb = yb0 - pr * 0.032 * bell;
        let yt = Math.min(yb0 + ht * bell, hi - teeth - 0.0012);
        if (yt < yb0) yt = yb0;
        col(G, j, xt, yt, yb);
      }
      G.pa.needsUpdate = true; G.na.needsUpdate = true; G.mesh.visible = tg > 0.003 && dn + up > 0.02;
    }
  };
  out.update(o.init);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------
// eyelid shell: the part of a half-ellipsoid (radii a, b, cz) standing over the eye that lies above (upper) or below (lower) an edge curve
//   edge(x) = yE + bow * (1 - u^2) + tilt * u        u = x / a in -1..1, y measured from the eye centre, upper covers y > edge
// ------------------------------------------------------------------------------------------------------------------------------
export function makeLid(M, head, R, o) {
  const C = o.cols ?? 13, Rw = o.rows ?? 6, a = o.a, b = o.b, cz = o.cz, lower = !!o.lower, dx0 = o.dx ?? 0;
  const fr = new Frame(R, o.az, o.el, 0);
  const nv = C * Rw, idx = new Uint16Array((C - 1) * (Rw - 1) * 6);
  let p = 0;
  for (let j = 0; j < C - 1; j++) for (let i = 0; i < Rw - 1; i++) {
    const A = j * Rw + i, B = A + 1, Cc = A + Rw, D = Cc + 1;
    if (!lower) { idx[p++] = A; idx[p++] = B; idx[p++] = Cc; idx[p++] = B; idx[p++] = D; idx[p++] = Cc; }
    else { idx[p++] = A; idx[p++] = Cc; idx[p++] = B; idx[p++] = B; idx[p++] = Cc; idx[p++] = D; }
  }
  const g = dynGeo(nv, idx, true); boundTo(g, fr, Math.max(a, b) + cz + 0.03);
  const mesh = new THREE.Mesh(g, o.mat); mesh.name = lower ? 'lidLow' : 'lidUp'; mesh.castShadow = false; mesh.receiveShadow = true; head.add(mesh);
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
  const u = colU(C), s = new Float32Array(C);
  for (let j = 0; j < C; j++) { u[j] *= 0.999; s[j] = Math.max(0, 1 - u[j] * u[j]); }
  const e = fr.e, n = fr.n;
  const lid = {
    mesh, frame: fr, a, b, cz, czs: 1, edgeAt: new Float32Array(C), xs: new Float32Array(C), dx0, pE: 9, pB: 0, pT: 0,
    // edge height at eye-relative x (+-9 when x lies outside the shell): is a point at (x, y) under this lid?
    covers(x, y, r) {
      const uu = (x - dx0) / a; if (uu <= -1 || uu >= 1 || !mesh.visible) return false;
      const top = b * Math.sqrt(1 - uu * uu); let ye = lid.pE + lid.pB * (1 - uu * uu) + lid.pT * uu; ye = ye > top ? top : ye < -top ? -top : ye;
      return lower ? y - r < ye : y + r > ye;
    },
    update(yE, bow, tilt, czs = 1) {
      lid.czs = czs; lid.pE = yE; lid.pB = bow; lid.pT = tilt; const czz = cz * czs;
      let any = false;
      for (let j = 0; j < C; j++) {
        const x = a * u[j], top = b * Math.sqrt(s[j]);
        let ye = yE + bow * s[j] + tilt * u[j];
        ye = ye > top ? top : ye < -top ? -top : ye;
        const y0 = lower ? -top : top;
        lid.edgeAt[j] = ye; lid.xs[j] = x;
        if (Math.abs(ye - y0) > 2e-4) any = true;
        for (let i = 0; i < Rw; i++) {
          const y = y0 + (ye - y0) * (i / (Rw - 1));
          const q = 1 - (x / a) * (x / a) - (y / b) * (y / b), zh = czz * Math.sqrt(q > 0 ? q : 0);
          const k = j * Rw + i, k3 = k * 3;
          fr.put(x + dx0, y, zh + 0.0012, pos, k3);
          // dome shading normal: gradient of the ellipsoid in (east, north, skull normal)
          const gx = x / (a * a), gy = y / (b * b), gz = zh / (czz * czz + 1e-9);
          let nx = e.x * gx + n.x * gy + fr.nx * gz, ny = e.y * gx + n.y * gy + fr.ny * gz, nz = e.z * gx + n.z * gy + fr.nz * gz;
          const nl = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9);
          nrm[k3] = nx * nl; nrm[k3 + 1] = ny * nl; nrm[k3 + 2] = nz * nl;
          uv[k * 2] = 0.5 + (x + dx0) / 2.13; uv[k * 2 + 1] = 0.5 + y / 1.0;
        }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.uv.needsUpdate = true;
      mesh.visible = any;
    },
  };
  lid.update(o.yE0 ?? 9, 0, 0);
  return lid;
}

// a dark ribbon that rides on the upper lid's edge (the lash line / lid crease); follows the same edge curve as the lid
export function makeMargin(M, head, R, o) {
  const C = o.cols ?? 13, a = o.a, b = o.b, cz = o.cz, hw0 = o.hw ?? 0.0065, dx0 = o.dx ?? 0;
  const fr = new Frame(R, o.az, o.el, 0);
  const g = dynGeo(C * 2, gridIndex(C, 2, false), false); boundTo(g, fr, Math.max(a, b) + cz + 0.03);
  const mesh = new THREE.Mesh(g, o.mat); mesh.name = 'lidLine'; mesh.castShadow = false; mesh.receiveShadow = false; head.add(mesh);
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
  const u = colU(C), s = new Float32Array(C);
  for (let j = 0; j < C; j++) { u[j] *= 0.985; s[j] = Math.max(0, 1 - u[j] * u[j]); }
  let czNow = cz;
  const zAt = (x, y) => { const q = 1 - (x / a) * (x / a) - (y / b) * (y / b); return czNow * Math.sqrt(q > 0 ? q : 0); };
  return {
    mesh,
    update(lid, on, lift = 0.0032) {
      mesh.visible = on;
      if (!on) return;
      czNow = cz * lid.czs;
      for (let j = 0; j < C; j++) {
        const x = a * u[j], hw = hw0 * (0.35 + 0.65 * Math.pow(s[j], 0.4)), top = b * Math.sqrt(s[j]) - 0.004;
        const ye = lid.edgeAt[j];
        let y1 = Math.min(top, ye + hw), y2 = Math.max(-top, ye - hw);
        if (y2 > y1) y2 = y1;
        for (let r = 0; r < 2; r++) {
          const y = r ? y2 : y1, k3 = (2 * j + r) * 3;
          fr.put(x + dx0, y, zAt(x, y) + lift, pos, k3);
          nrm[k3] = fr.nx; nrm[k3 + 1] = fr.ny; nrm[k3 + 2] = fr.nz;
        }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// tables
// ------------------------------------------------------------------------------------------------------------------------------
//        w     cy    sk   up    dn    exU  exL   th    tg    tt   lp
const PV = {
  rest:    [0.058, 0.000, 0, 0.000, 0.049, 1.0, 0.50, 0.010, 0.022, 0, 0.0055],   // the cute open smile Pip always had
  MBP:     [0.046, 0.006, 0, -0.007, 0.009, 1.0, 1.0, 0.000, 0.000, 0, 0.0058],   // lips pressed: a thin smile-curved line
  FV:      [0.054, 0.002, 0, 0.000, 0.014, 1.0, 0.6, 0.013, 0.000, 0, 0.0055],    // small gap, upper teeth over the lower lip
  O:       [0.030, 0.000, 0, 0.026, 0.026, 0.5, 0.5, 0.000, 0.012, 0, 0.0085],    // round, medium
  U:       [0.018, 0.000, 0, 0.014, 0.014, 0.5, 0.5, 0.000, 0.000, 0, 0.0095],    // small tight pucker
  AA:      [0.058, 0.004, 0, 0.020, 0.065, 0.6, 0.55, 0.010, 0.020, 0, 0.0055],   // wide and tall, tongue low
  EE:      [0.080, 0.006, 0, 0.004, 0.020, 0.8, 0.7, 0.016, 0.000, 0, 0.0055],    // wide and thin, teeth showing
  TLD:     [0.050, 0.002, 0, 0.012, 0.028, 0.6, 0.5, 0.010, 0.026, 1, 0.0055],    // medium open, tongue tip up behind the teeth
  // resting mouths of the emotes
  happy:   [0.072, 0.013, 0, 0.000, 0.060, 1.0, 0.55, 0.013, 0.030, 0, 0.0055],
  awe:     [0.022, 0.000, 0, 0.018, 0.022, 0.5, 0.5, 0.000, 0.010, 0, 0.0085],
  shy:     [0.040, 0.008, 0, -0.005, 0.013, 1.0, 0.8, 0.000, 0.000, 0, 0.0058],
  gasp:    [0.034, 0.000, 0, 0.030, 0.050, 0.5, 0.55, 0.008, 0.016, 0, 0.0075],
  sleepy:  [0.026, 0.000, 0, 0.004, 0.016, 0.7, 0.5, 0.000, 0.008, 0, 0.0065],
  smug:    [0.052, 0.006, 0, -0.006, 0.009, 1.0, 1.0, 0.000, 0.000, 0, 0.0058],
  proud:   [0.058, 0.014, 0, -0.012, 0.012, 1.0, 1.0, 0.000, 0.000, 0, 0.0058],
  worried: [0.040, -0.010, 0, 0.014, -0.009, 1.0, 1.0, 0.000, 0.000, 0, 0.0058],   // a little frown: the upper lip arches, the lower lip follows above the corner line
  moanP:   [0.048, 0.004, 0, 0.022, 0.075, 0.6, 0.55, 0.008, 0.022, 0, 0.0055],
  cheeky:  [0.048, 0.012, 0.006, 0.006, 0.030, 1.0, 0.6, 0.008, 0.028, 1.9, 0.0058],   // tongue out over the lower lip (tt above 1 = how far)
};
const PVF = {}; for (const k in PV) PVF[k] = Float32Array.from(PV[k]);
export const PIP_REST = PVF.rest;
export const ZOMBIE_REST = Float32Array.from([0.075, 0, 0, 0, 0.064, 1, 0.5, 0, 0, 0, 0]);
export const ZOMBIE_LID_Y = 0.016;                            // resting edge of a zombie's heavy lid (metres above the eye centre)
const PIP_VIS = VISEMES.map((n) => PVF[n]);

// zombies collapse the visemes to (open, wide, round), open -1 = shut
const ZVIS = [[0, 0, 0], [-0.92, 0, 0], [0.05, 0.1, 0], [0.55, -0.2, 1], [0.15, -0.5, 1], [1.0, 0.25, 0], [0.05, 0.85, 0], [0.35, 0.1, 0]];

// emotes. lid: upper lid closure 0..1 (negative = eyes wide), low: lower lid rise, brow: raise -1..1, b2: extra raise [screen-left, screen-right],
// tilt: brow tilt (+ = inner ends up, worried), lt: lid slope, bl: blush multiplier, gx/gy: gaze offset, dil: pupil dilation,
// rest: resting mouth of Pip; sm/wm/om/sk: smile add (m), width and opening multipliers, skew while singing; zo: zombie mouth [open, wide, round, smile]
const EMO = {
  neutral: { lid: 0, low: 0, brow: 0, b2: [0, 0], tilt: 0, lt: 0, bl: 1, gx: 0, gy: 0, dil: 0, rest: 'rest', sm: 0, wm: 1, om: 1, sk: 0, zo: [0, 0, 0, 0] },
  happy: { lid: 0.06, low: 0.36, brow: 0.30, b2: [0, 0], tilt: -0.04, lt: 0, bl: 1.6, gx: 0, gy: 0.05, dil: 0.10, rest: 'happy', sm: 0.010, wm: 1.10, om: 1, sk: 0, zo: [0.35, 0.5, 0, 0.012] },
  awe: { lid: -0.4, low: 0, brow: 0.80, b2: [0, 0], tilt: 0.10, lt: 0, bl: 1.2, gx: 0, gy: 0.14, dil: 0.60, rest: 'awe', sm: 0, wm: 0.85, om: 0.9, sk: 0, zo: [0.5, -0.3, 1, 0] },
  shy: { lid: 0.22, low: 0.12, brow: 0.15, b2: [0, 0], tilt: 0.35, lt: 0.006, bl: 2.0, gx: -0.35, gy: -0.55, dil: 0.10, rest: 'shy', sm: 0.006, wm: 0.9, om: 0.8, sk: 0, zo: [-0.5, -0.2, 0, 0.01] },
  gasp: { lid: -0.5, low: 0, brow: 1.0, b2: [0, 0], tilt: 0.12, lt: 0, bl: 1.0, gx: 0, gy: 0.06, dil: 0.40, rest: 'gasp', sm: 0, wm: 0.9, om: 1.2, sk: 0, zo: [1.0, -0.35, 1, 0] },
  sleepy: { lid: 0.55, low: 0.12, brow: -0.30, b2: [0, 0], tilt: 0.22, lt: 0.004, bl: 1.2, gx: 0, gy: -0.28, dil: 0, rest: 'sleepy', sm: -0.002, wm: 0.9, om: 0.7, sk: 0, zo: [0.1, -0.2, 0.5, 0] },
  smug: { lid: 0.38, low: 0.10, brow: 0.05, b2: [-0.15, 0.55], tilt: -0.25, lt: -0.008, bl: 1.0, gx: 0.30, gy: -0.06, dil: 0, rest: 'smug', sm: 0.004, wm: 1, om: 0.85, sk: 0.011, zo: [-0.4, 0.3, 0, 0.008] },
  proud: { lid: 0.16, low: 0.12, brow: 0.12, b2: [0, 0.4], tilt: 0, lt: 0, bl: 1.3, gx: 0, gy: 0.10, dil: 0.05, rest: 'proud', sm: 0.010, wm: 1, om: 0.8, sk: 0, zo: [-0.5, 0.35, 0, 0.014] },
  worried: { lid: 0, low: 0, brow: 0.28, b2: [0, 0], tilt: 0.55, lt: 0.010, bl: 1.0, gx: 0.10, gy: -0.06, dil: 0.15, rest: 'worried', sm: -0.008, wm: 0.9, om: 0.9, sk: 0, zo: [0.1, -0.2, 0, -0.02] },
  cheeky: { lid: 0.30, low: 0.16, brow: 0.10, b2: [0.22, -0.10], tilt: -0.06, lt: 0, bl: 1.5, gx: 0.25, gy: 0.05, dil: 0.10, rest: 'cheeky', sm: 0.006, wm: 1, om: 1, sk: 0.006, zo: [0.5, 0.2, 0, 0.01] },
  moan: { lid: 0.15, low: 0, brow: 0.20, b2: [0, 0], tilt: 0.35, lt: 0, bl: 1.0, gx: 0, gy: 0.10, dil: 0, rest: 'moanP', sm: 0, wm: 0.8, om: 1.1, sk: 0, zo: [1.2, -0.2, 0.5, 0] },
};

// eye geometry (metres, eye-centre relative): Pip's upper lid edge runs from EDGE_TOP (open) to MEET_PIP (shut); a zombie's from ZTOP to ZBOT
const EDGE_TOP = 0.114, MEET_PIP = -0.030, ZTOP = 0.114, ZBOT = -0.095, Z_H0 = (ZTOP - ZOMBIE_LID_Y) / (ZTOP - ZBOT);
const LID_BOW = 0.012, ZLID_BOW = -0.010;
const TRAVEL = { x: 0.016, y: 0.013 };

// ------------------------------------------------------------------------------------------------------------------------------
// rig
// ------------------------------------------------------------------------------------------------------------------------------
const cap3 = (m, e, n) => ({ m, px: m.position.x, py: m.position.y, pz: m.position.z, sx: m.scale.x, sy: m.scale.y, sz: m.scale.z, ex: e.x, ey: e.y, ez: e.z, nx: n.x, ny: n.y, nz: n.z });
const _e = new THREE.Vector3(), _n = new THREE.Vector3(), _t3 = new Float32Array(3), _P = new Float32Array(MP);

export function rigFace(char, opt = {}) {
  const head = char && char.obj && char.obj.userData && char.obj.userData.J && char.obj.userData.J.head;
  const H = head && head.userData.face;
  if (!H) { if (char) char.face = null; return null; }
  if (char.face && char.face.H === H) { if (opt.level) char.face.level = opt.level; return char.face; }
  const level = opt.level || (char.kind === 'pip' ? 'full' : 'lite');
  const rig = { H, head, R: H.R, zombie: H.zombie, level, K: char.K || null, kind: char.kind, eyes: [], brows: H.brows, blush: H.blush, mouth: H.mouth, teeth: H.teeth, wink: null,
    last: { valid: false, mouth: new Float32Array(8), moan: 0, blink: 0, lx: 0, ly: 0, brow: 0, emo: '', ek: 0, t: 0, kv: 0, sing: false } };
  for (const E of H.eyes) {
    if (!E.iris) { continue; }            // button eyes, winks and cloudy eyes do not look around
    _e.set(1, 0, 0).applyQuaternion(E.iris.quaternion); _n.set(0, 1, 0).applyQuaternion(E.iris.quaternion);
    const e = { E, iris: cap3(E.iris, _e, _n), pupil: cap3(E.pupil, _e, _n), hl: E.hl && cap3(E.hl, _e, _n), hl2: E.hl2 && cap3(E.hl2, _e, _n),
      lash: E.lash && cap3(E.lash, _e, _n), flicks: E.flicks.map((f) => cap3(f, _e, _n)), white: E.white || E.blank };   // a zombie's eyeball is its blank orb
    for (const c of [e.hl, e.hl2]) if (c) {      // eye-relative offset (metres, east / north) of each glint from the iris
      const ax = c.px - e.iris.px, ay = c.py - e.iris.py, az = c.pz - e.iris.pz;
      c.ox = ax * c.ex + ay * c.ey + az * c.ez; c.oy = ax * c.nx + ay * c.ny + az * c.nz;
    }
    rig.eyes.push(e);
  }
  if (H.wink) { _e.set(1, 0, 0).applyQuaternion(H.wink.quaternion); _n.set(0, 1, 0).applyQuaternion(H.wink.quaternion); rig.wink = cap3(H.wink, _e, _n); rig.winkQ = H.wink.quaternion.clone(); }
  char.face = rig;
  return rig;
}

const hidden = (o) => { for (; o; o = o.parent) if (!o.visible) return true; return false; };
const same8 = (a, b) => { for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false; return true; };
const move = (c, dx, dy, k, sx, sy) => {   // translate a cached piece along the eye's tangent axes, squash it
  c.m.position.set(c.px + (c.ex * dx + c.nx * dy) * k, c.py + (c.ey * dx + c.ny * dy) * k, c.pz + (c.ez * dx + c.nz * dy) * k);
  c.m.scale.set(c.sx * sx, c.sy * sy, c.sz);
};

export function setFace(char, F) {
  const r = char && char.face; if (!r || !F) return;
  if (hidden(char.obj)) return;
  const mo = F.mouth || null, moan = F.moan || 0, blink = F.blink || 0, lk = F.look, lx = lk ? lk[0] : 0, ly = lk ? lk[1] : 0;
  const brow = F.brow || 0, emo = F.emote || 'neutral', ek = F.emoteK === undefined ? 1 : F.emoteK, t = F.t || 0;
  const zombie = r.zombie, kv = zombie ? (r.K ? r.K.value : 1) : 1, L = r.last;
  const sing = !!mo;
  if (L.valid && L.moan === moan && L.blink === blink && L.lx === lx && L.ly === ly && L.brow === brow && L.emo === emo && L.ek === ek && L.kv === kv && L.sing === sing &&
      (sing ? same8(L.mouth, mo) : true) && (moan > 0 ? L.t === t : true)) return;
  L.valid = true; L.moan = moan; L.blink = blink; L.lx = lx; L.ly = ly; L.brow = brow; L.emo = emo; L.ek = ek; L.kv = kv; L.sing = sing; L.t = t;
  if (sing) L.mouth.set(mo);

  const E = EMO[emo] || EMO.neutral, k = clamp(ek), full = r.level === 'full';
  const eyesAwake = !zombie || kv > 0.6;                 // a zombie's eyes stay blank clouded orbs until the thread has reached its head
  const bk = eyesAwake ? clamp(blink) : 0;

  // ---- eyes: lids ----
  let c = 0, low = 0, yEu = EDGE_TOP, marginOn = false;
  const gaze = zombie ? kv > 0.6 : true;
  for (let i = 0; i < r.H.eyes.length; i++) {
    const Eh = r.H.eyes[i]; if (!Eh.lidU) continue;
    if (!zombie) {
      const lid0 = E.lid * k;
      c = lid0 + (1 - lid0) * bk;                         // -0.5 (wide) .. 1 (shut)
      low = clamp(E.low * k + (1 - E.low * k) * Math.pow(bk, 1.7));
      const cc = c > 0 ? c : 0;
      yEu = EDGE_TOP + (MEET_PIP - EDGE_TOP) * cc;
      const lt = E.lt * k;
      Eh.lidU.update(cc > 0.004 ? yEu : 9, LID_BOW * (0.4 + 0.6 * cc), lt, 1 - 0.5 * sstep(0.6, 1, cc));   // a shut lid flattens
      const yEl = -EDGE_TOP + (MEET_PIP + 0.004 - -EDGE_TOP) * low;
      Eh.lidL.update(low > 0.004 ? yEl : -9, LID_BOW * (0.4 + 0.6 * low), -lt * 0.5, 1 - 0.5 * sstep(0.6, 1, low));
      Eh.margin.update(Eh.lidU, yEu < 0.098);
    } else {
      c = clamp(Z_H0 + E.lid * k * 0.55);
      c = c + (1 - c) * bk;
      yEu = ZTOP + (ZBOT - ZTOP) * c;
      Eh.lidU.update(yEu, ZLID_BOW, E.lt * k, 1 - 0.4 * sstep(0.7, 1, c));
      Eh.margin.update(Eh.lidU, bk > 0.3);
    }
    marginOn = true;
  }

  // ---- eyes: gaze ----
  if (r.eyes.length) {
    let gx = clamp(lx + E.gx * k, -1, 1), gy = clamp(ly + E.gy * k, -1, 1);
    if (!gaze) { gx = 0; gy = 0; }
    const dx = gx * TRAVEL.x, dy = gy * TRAVEL.y;
    const sqx = 1 - 0.20 * Math.pow(Math.abs(gx), 1.6), sqy = 1 - 0.14 * Math.pow(Math.abs(gy), 1.6);
    const dil = 1 + (full ? 0.30 * E.dil * k : 0);
    const hideEye = c > 0.85;                            // under a shut lid the eye is not drawn (the lid flattens)
    for (let ei = 0; ei < r.eyes.length; ei++) {
      const e = r.eyes[ei];
      e.iris.m.visible = !hideEye; e.pupil.m.visible = !hideEye; if (e.white) e.white.visible = !hideEye;
      move(e.iris, dx, dy, 1, sqx, sqy);
      move(e.pupil, dx, dy, 1.12, sqx * dil, sqy * dil);
      const Ue = e.E.lidU, Le = e.E.lidL;                   // a glint is drawn only where no lid covers it
      if (e.hl) { move(e.hl, dx, dy, 0.35, 1, 1); const gx0 = e.hl.ox + dx * 0.35, gy0 = e.hl.oy + dy * 0.35; e.hl.m.visible = !((Ue && Ue.covers(gx0, gy0, 0.006)) || (Le && Le.covers(gx0, gy0, 0.006))); }
      if (e.hl2) { move(e.hl2, dx, dy, 0.35, 1, 1); const gx0 = e.hl2.ox + dx * 0.35, gy0 = e.hl2.oy + dy * 0.35; e.hl2.m.visible = !((Ue && Ue.covers(gx0, gy0, 0.004)) || (Le && Le.covers(gx0, gy0, 0.004))); }
      if (e.lash) {                                       // wide eyes lift the lash line a little; the lash line hides under a lid that has come down
        const lift = c < 0 ? -c * 0.018 : 0;
        move(e.lash, 0, lift, 1, 1, 1);
        e.lash.m.visible = yEu > 0.098;
        for (let fi = 0; fi < e.flicks.length; fi++) move(e.flicks[fi], 0, lift * 0.8 - (c > 0 ? c * 0.02 : 0), 1, 1, 1);
      }
    }
  }

  // ---- brows ----
  {
    const base = brow + E.brow * k;
    for (let i = 0; i < r.brows.length; i++) {
      const b = r.brows[i], side = b.s < 0 ? 0 : 1;
      const raise = clamp(base + E.b2[side] * k, -1.2, 1.4);
      let tilt = E.tilt * k; if (brow < 0) tilt += 0.45 * brow;     // brow < 0 pulls the inner ends down (cute angry)
      placeAt(b.mesh, r.R, b.az, b.el + raise * (raise >= 0 ? 0.06 : 0.045), b.k, b.roll - b.s * tilt);
    }
  }

  // ---- blush, wink ----
  if (full) {
    const bm = lerp(1, E.bl, k), bo = Math.min(0.95, r.blush.opacity * bm);
    r.blush.mat.opacity = bo;
    const sc = 1 + 0.14 * (bm - 1);
    for (let bi = 0; bi < r.blush.meshes.length; bi++) r.blush.meshes[bi].scale.set(1.25 * sc, sc, 1);
    if (r.wink) {
      const w = r.wink, m = w.m, lift = E.lid < 0 ? -E.lid * k * 0.012 : 0;
      m.position.set(w.px + (w.nx) * lift, w.py + w.ny * lift, w.pz + w.nz * lift);
      const s2 = 1 + (emo === 'happy' ? 0.12 * k : 0) + (E.lid < 0 ? 0.10 * k : 0);
      m.scale.set(w.sx * s2, w.sy * s2, w.sz);
      m.quaternion.copy(r.winkQ);
      if (emo === 'sleepy') m.rotateZ(PI * k);                    // a sleeping arc
    }
  }

  // ---- mouth ----
  const P = _P, mth = r.mouth;
  if (!zombie) {
    const rest = PVF[E.rest] || PIP_REST;
    if (sing) {
      const w0 = mo[0];
      for (let j = 0; j < MP; j++) {
        let v = w0 * (PIP_REST[j] + (rest[j] - PIP_REST[j]) * k);
        for (let vi = 1; vi < 8; vi++) v += mo[vi] * PIP_VIS[vi][j];
        P[j] = v;
      }
      const open = (P[3] + P[4]) / 0.09;                          // 0 closed .. ~1 wide open
      P[1] += E.sm * k * (1 - 0.5 * clamp(open));
      P[0] *= lerp(1, E.wm, k); P[3] *= lerp(1, E.om, k); P[4] *= lerp(1, E.om, k); P[2] += E.sk * k;
    } else {
      for (let j = 0; j < MP; j++) P[j] = PIP_REST[j] + (rest[j] - PIP_REST[j]) * k;
      P[2] = E.sk * k;
    }
    if (moan > 0) {
      const mp = PVF.moanP, tr = 0.5 * Math.sin(t * 41) + 0.5 * Math.sin(t * 27 + 1.3);
      for (let j = 0; j < MP; j++) P[j] = lerp(P[j], mp[j], moan);
      P[4] += 0.006 * tr * moan;
    }
    mth.update(P);
  } else {
    // zombie: (open, wide, round) numbers
    let open = 0, wide = 0, round = 0, smile = 0;
    if (sing) {
      const w0 = mo[0];
      for (let vi = 1; vi < 8; vi++) { const z = ZVIS[vi], w = mo[vi]; open += z[0] * w; wide += z[1] * w; round += z[2] * w; }
      void w0;
    }
    const zo = E.zo;
    if (sing) { open += zo[0] * k * 0.5; wide += zo[1] * k; round += zo[2] * k * 0.5; } else { open = zo[0] * k; wide = zo[1] * k; round = zo[2] * k; }
    smile = zo[3] * k;
    let trem = 0;
    if (moan > 0) { trem = 0.5 * Math.sin(t * 41) + 0.5 * Math.sin(t * 27 + 1.3); open += 1.5 * moan; round += 0.45 * moan; wide -= 0.15 * moan; }
    round = clamp(round);
    const w = 0.075 * (1 + 0.3 * wide) * (1 - 0.32 * round) * (1 + 0.03 * trem * moan);
    const dn = (open >= 0 ? 0.064 + 0.05 * open : 0.064 * (1 + open * 1.05)) + 0.010 * trem * moan;
    P[0] = w; P[1] = smile; P[2] = 0; P[3] = 0.004 * Math.max(0, open) + round * 0.15 * dn; P[4] = Math.max(0.002, dn);
    P[5] = lerp(1, 0.5, round); P[6] = 0.5; P[7] = 0; P[8] = Math.max(0, open - 0.6) * 0.03; P[9] = 0; P[10] = 0;
    mth.update(P);
    for (let ti = 0; ti < r.teeth.length; ti++) {                   // buck teeth hang on the upper lip
      const T = r.teeth[ti];
      const fr = mth.frame, x = T.dx * r.R * 0.94, y = 0.0122 + 0.5 * mth.top + (moan > 0.5 ? 0.0028 * (moan - 0.5) * 2 * Math.sin(t * 58 + T.dx * 90) : 0);   // teeth chatter on a strong moan
      fr.put(x, y, 0.0019, _t3, 0); T.mesh.position.set(_t3[0], _t3[1], _t3[2]);
    }
    if (mth.tongue) mth.tongue.visible = mth.tongue.visible && full;
  }
}

// ------------------------------------------------------------------------------------------------------------------------------
// deterministic schedules
// ------------------------------------------------------------------------------------------------------------------------------
function blinkShape(x) {            // 0.14 s long: shut in 0.045, held 0.03, open in 0.065
  if (x <= 0 || x >= 0.14) return 0;
  if (x < 0.045) return sstep(0, 0.045, x);
  if (x < 0.075) return 1;
  return 1 - sstep(0.075, 0.14, x);
}
// one blink per 4 s cell, placed inside the cell so that the gap between blinks is 2.5 to 5.5 s; one in five is a double
export function autoBlink(t, seed = 0) {
  const Lc = 4.0, tt = t + hash(seed * 7.13 + 1.7) * Lc, c = Math.floor(tt / Lc), lt = tt - c * Lc;
  const b0 = 0.6 + hash(c * 1.37 + seed * 3.9) * 1.5;
  let v = blinkShape(lt - b0);
  if (hash(c * 2.11 + seed * 5.3 + 9.1) > 0.8) v = Math.max(v, blinkShape(lt - b0 - 0.30));
  return v;
}
const keeps = (f, seed) => hash(f * 1.91 + seed * 4.7 + 3.3) < 0.5;       // half the cells keep the previous fixation
// slow saccades: the gaze holds a point for 0.8 to 3 s, then jumps in 0.09 s to a new one around `target`
export function autoLook(t, seed = 0, target = null, out = null) {         // out: optional [x, y] to fill (no allocation)
  const Lc = 0.8, tt = t + hash(seed * 3.31 + 0.7) * Lc, c = Math.floor(tt / Lc), lt = tt - c * Lc;
  let f = c, n = 0; while (n < 5 && keeps(f, seed)) { f--; n++; }
  let g = f - 1, m = 0; while (m < 5 && keeps(g, seed)) { g--; m++; }
  const tx = target ? target[0] : 0, ty = target ? target[1] : 0, ax = 0.45, ay = 0.28;
  const fx = tx + (hash(f * 5.17 + seed * 2.9) * 2 - 1) * ax, fy = ty + (hash(f * 3.73 + seed * 6.1 + 2.2) * 2 - 1) * ay;
  const gx = tx + (hash(g * 5.17 + seed * 2.9) * 2 - 1) * ax, gy = ty + (hash(g * 3.73 + seed * 6.1 + 2.2) * 2 - 1) * ay;
  const since = (c - f) * Lc + lt, k = sstep(0, 0.09, since);
  const ox = clamp(lerp(gx, fx, k), -1, 1), oy = clamp(lerp(gy, fy, k), -1, 1);
  if (out) { out[0] = ox; out[1] = oy; return out; }
  return [ox, oy];
}
