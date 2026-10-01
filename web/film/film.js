// The film runtime: turns sets, cast, timing and shots into frames.  window.setT(t) is a PURE function of the song time t:
// it recomputes everything from t (no Math.random, no clocks, no state carried between calls).  See docs/FILM_RUNTIME.md.
//
//   ?shot=film&t=<song s>&w=&h=&motion=ones|twos|mixed&hand=0|1&timing=<url>&shots=<url>&sid=<shot id>&p=<0..1>&debug=1&warm=1&aspect=portrait
//
// Per frame:  find the shot -> u, c2 -> template(F) -> frame description -> visibility, camera, front uniforms, set.update, kit,
//             cast (acts, faces), text, props, threads, post + transitions.
import * as THREE from 'three';
import { loadTiming } from './timing.js';
import { TEMPLATES, TEXT_SPECS, THREAD_SPECS, PROP_SPECS, CROWD16 } from './shots.js';
import './shots2.js';                                       // second-wave templates (verse 2 to the end card): they add themselves to TEMPLATES
import { clamp, lerp, smooth, hash, wrapAng, lerpAng } from '../util.js';
import { pose, makePinCushion, makeTape, makeScissors, makePin } from '../chars.js';
import { makeZombie, makePip, deadAct, liveAct, lerpPose } from '../cast.js';
import { makeNeedle } from '../props.js';

const PI = Math.PI, TAU = Math.PI * 2;
const POSE_KEYS = ['shL', 'shR', 'elL', 'elR', 'head', 'body', 'legL', 'legR'];
const EXT_NAMES = ['mall_door', 'mall_runway', 'mall_rosette', 'mall_roof', 'machine_macro'];
const DEFAULT_EXT = ['mall_roof'];                       // shown in every mall shot unless a frame says `ext` (the ceiling must always exist)
const FRONT_DEFAULTS = { w: 0.55, n: 0.55, d: 46, c: [1.0, 0.36, 0.66] };
const POST_DEFAULT = { band: 0.42, tilt: 1.8, focusY: 0.5, bloom: 0.18, bloomRadius: 0.5, bloomThr: 0.92, vig: 0.34, grain: 0.05, sat: 0.98, contrast: 1.03, chroma: 0.0006, tint: [1.02, 0.99, 0.96], lift: [0, 0, 0] };
const K_RAMP = 1.5;                                      // metres of front radius over which a zombie is made over
const WHIP_FRAMES = 3, FPS = 24;

export async function buildFilm(env) {
  const { renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, rng, SHADOW } = env;
  const warn = (m) => { const w = (window.__warn ||= []); if (!w.includes(m)) { w.push(m); console.warn('[film] ' + m); } };
  const first = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 200);
  const OPT = {
    motion: q.get('motion') || 'ones', hand: q.get('hand') === '1', debug: q.get('debug') === '1', warm: q.get('warm') === '1', dual: q.get('dual') !== '0',
    portrait: q.get('aspect') === 'portrait' || W < H, quality: q.get('quality') || 'full',
    pz: parseFloat(q.get('pz')) || 1,                                                     // portrait only: 1 = the landscape picture's width, below 1 = a tighter crop (subjects larger)
  };
  // Portrait (Shorts) only: per-shot framing from a JSON file, ?short=/data/short.json -> { "<shot id>": { pz, yaw, tilt, dx } } (degrees, degrees, metres to the camera's right).
  // Landscape frames never read it, so the master is unaffected.
  let PSHORT = {};
  if (OPT.portrait && q.get('short')) { try { PSHORT = await (await fetch(q.get('short'))).json(); } catch (e) { warn('short framing file: ' + first(e)); } }

  // ------------------------------------------------------------------------------------------------ timing and shots
  const T = await loadTiming(q.get('timing') || null);
  const SH = await loadShots(q.get('shots') || null);
  const shots = SH.shots;
  shots.forEach((s, i) => { s.i = i; s.dur = s.t1 - s.t0; s.tr = parseIn(s.in); });
  const starts = shots.map((s) => s.t0);
  const aliveAt = SH.aliveAt ?? Infinity;
  if (SH.audio_id && T.meta?.audio_id && SH.audio_id !== T.meta.audio_id) warn(`shots.json (${SH.audio_id}) was made for a different audio than the timing file (${T.meta.audio_id})`);
  acceptFlashes(shots);

  async function loadShots(url) {                        // the shots file that belongs to the timing file: timing.X.json -> shots.X.json (timing.json -> shots.json)
    const derived = T.url ? T.url.replace(/timing(\.[a-z0-9]+)?\.json/, (m, x) => 'shots' + (x || '') + '.json') : null;
    const urls = url ? [url] : [derived, '/data/shots.json', '/data/shots.standin.json', '/data/shots.fake.json'].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const u of urls) { try { const r = await fetch(u); if (r.ok) { const j = await r.json(); j.url = u; return j; } } catch (e) { /* next */ } }
    throw new Error('no shots file found (tried ' + urls.join(', ') + ')');
  }
  function parseIn(s) {                                  // 'cut' | 'whip[:left|right|up|down]' | 'dip[:0xrrggbb]' | 'flash' | 'seam'
    const [kind, arg] = String(s || 'cut').split(':');
    if (kind === 'seam') return { kind: 'cut', seamSkipped: true };
    if (kind === 'dip') return { kind, color: arg !== undefined ? parseInt(arg.replace(/^0x|^#/, ''), 16) : 0x000000 };
    return { kind, dir: arg };
  }
  function acceptFlashes(list) {                         // at most 3 flash cuts in any 1 s window: later ones become plain cuts
    const acc = [];
    for (const s of list) if (s.tr.kind === 'flash') { if (acc.filter((t0) => s.t0 - t0 < 1.0).length >= 3) { s.tr = { kind: 'cut', flashDropped: true }; warn(`flash into ${s.id} dropped (more than 3 per second)`); } else acc.push(s.t0); }
  }
  const shotIndexAt = (t) => { let lo = 0, hi = starts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] <= t) lo = m + 1; else hi = m; } return Math.max(0, lo - 1); };

  // ------------------------------------------------------------------------------------------------ the front (story clock)
  const FK = (SH.front || []).slice().sort((a, b) => a.t - b.t);
  // R(t): keyframes; the segment that ENDS at a key uses that key's ease ('linear' default, 'smooth')
  const Rat = (t) => {
    if (!FK.length) return -1;
    if (t <= FK[0].t) return FK[0].R;
    if (t >= FK[FK.length - 1].t) return FK[FK.length - 1].R;
    let i = 0; while (FK[i + 1].t < t) i++;
    const a = FK[i], b = FK[i + 1], k = clamp((t - a.t) / Math.max(1e-6, b.t - a.t));
    return lerp(a.R, b.R, b.ease === 'smooth' ? smooth(k) : k);
  };
  const tOfR = (r) => {                                   // first song time at which the front has radius >= r (R is non-decreasing)
    if (!FK.length) return Infinity;
    if (Rat(FK[FK.length - 1].t) < r) return Infinity;
    let lo = FK[0].t, hi = FK[FK.length - 1].t;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Rat(m) >= r) hi = m; else lo = m; }
    return hi;
  };

  // ------------------------------------------------------------------------------------------------ optional modules (guarded)
  const opt = async (path) => { try { return await import(path); } catch (e) { warn(`module ${path} missing or broken: ${first(e)}`); return null; } };
  const mods = { moves: await opt('../moves.js'), face: await opt('../face.js'), text: await opt('../text.js'), gags: await opt('../gags.js') };

  // ------------------------------------------------------------------------------------------------ light kit
  const kit = makeKit(scene, { shadow: SHADOW });

  // ------------------------------------------------------------------------------------------------ sets
  const ctxBase = { THREE, M, FRONT, rng, hash, scene, quality: OPT.quality, W, H, mode: undefined, args: {} };
  const HOME = { mall: [0, 0, 0], atelier: [80, 0, 0], sky: [0, 0, 0], card: [120, 0, 0] };
  const debugLabel = (text) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#26232e'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#ff8fc4'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex }));
  };
  function makeStub(name, root, why) {                    // missing base set: a grey box scene with the label of what is missing
    const [hx, hy, hz] = HOME[name] || [0, 0, 0];
    const g = new THREE.Group(); g.position.set(hx, hy, hz);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x8a8794, roughness: 1 })); floor.position.y = -0.1; floor.receiveShadow = true; g.add(floor);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + i * 0.5, 1), new THREE.MeshStandardMaterial({ color: 0xb0aab8, roughness: 1 })); b.position.set(-4.5 + i * 3, 0.5 + i * 0.25, -3); b.castShadow = true; g.add(b); }
    const lab = debugLabel('MISSING: ' + name); lab.position.set(0, 3.2, -4.5); g.add(lab);
    root.add(g);
    const rig = () => ({ pos: [hx, 2.4, hz + 9], look: [hx, 1.4, hz - 3], fov: 40 });
    return {
      name, root, stub: true, why, anchors: { home: { x: hx, y: hy, z: hz } }, slots: { home: { x: hx, y: 0, z: hz, rotY: PI } }, rigs: { debug: rig },
      update() { },
      light(k) { k.setKey({ pos: [hx - 3, 8, hz + 5], target: [hx, 0, hz], color: 0xffffff, i: 1.4, extent: 10 }); k.setHemi({ sky: 0xffffff, ground: 0x777777, i: 0.7 }); },
      post: {},
    };
  }
  async function loadBase(name) {
    const root = new THREE.Group(); root.name = name; root.visible = false; scene.add(root);
    let set = null;
    try { const mod = await import(`../sets/${name}.js`); set = mod.build({ ...ctxBase, root }); if (!set) throw new Error('build() returned nothing'); }
    catch (e) { warn(`set ${name} stubbed: ${first(e)}`); root.clear(); set = null; }
    if (!set) return makeStub(name, root, 'missing');
    set.root ||= root; set.name ||= name; set.rigs ||= {}; set.slots ||= {}; set.stub = false;
    return set;
  }
  async function loadExt(name, mall) {
    const g = new THREE.Group(); g.name = name; g.visible = false; mall.root.add(g);
    let ext = null;
    try { const mod = await import(`../sets/${name}.js`); ext = mod.build({ ...ctxBase, root: g }, mall); if (!ext) throw new Error('build() returned nothing'); }
    catch (e) { warn(`extension ${name} stubbed: ${first(e)}`); g.clear(); ext = null; }
    if (!ext) {
      if (name === 'mall_roof') {                        // the mall has no ceiling of its own: give the stub a plain one so nothing looks open
        const c = new THREE.Mesh(new THREE.PlaneGeometry(50, 40), M.matte(0xb39ce0, { rough: 0.9 })); c.rotation.x = PI / 2; c.position.set(0, 11.4, 5.5); g.add(c);
      }
      return { name, root: g, stub: true, rigs: {}, slots: {}, anchors: {}, update() { }, light: null, post: {} };
    }
    ext.root ||= g; ext.name ||= name; ext.rigs ||= {}; ext.slots ||= {}; ext.stub = false;
    return ext;
  }
  const S = {};
  for (const n of ['mall', 'atelier', 'sky', 'card']) S[n] = await loadBase(n);
  const mall = S.mall;
  const EXT = {};
  for (const n of EXT_NAMES) EXT[n] = await loadExt(n, mall);
  const O = mall.anchors?.O || { x: -7.24, y: 0.99, z: -7.43 };
  const setOf = (name) => S[name] || EXT[name] || null;

  // ------------------------------------------------------------------------------------------------ cast pool
  const CHARS = {};
  const castRoot = new THREE.Group(); castRoot.name = 'cast'; scene.add(castRoot);
  const mk = (id, rec, level) => {
    rec.id = id; rec.obj.visible = false; castRoot.add(rec.obj);
    if (mods.face) { try { mods.face.rigFace(rec, { level }); } catch (e) { warn(`rigFace(${id}) failed: ${first(e)}`); } }
    rec.idx = id === 'pip' ? 0 : 1 + +id.slice(1); rec.baseScale = rec.obj.scale.x;          // zombies carry their variant height in the root scale
    return (CHARS[id] = rec);
  };
  const pip = mk('pip', makePip(M), 'full');
  {
    const J = pip.obj.userData.J;
    pip.cushion = makePinCushion(M); pip.cushion.position.set(-0.01, -0.13, 0.05); pip.cushion.scale.setScalar(0.85); J.elL.add(pip.cushion);
    pip.needle = makeNeedle(M, 0.7); pip.needle.position.set(0.0, -0.235, 0.0); pip.needle.rotation.set(-1.15, 0, 0); J.elR.add(pip.needle);
  }
  for (let i = 0; i < 16; i++) mk('z' + i, makeZombie(M, i), i < 4 ? 'full' : 'lite');

  // ------------------------------------------------------------------------------------------------ text, threads, props
  const fxRoot = new THREE.Group(); fxRoot.name = 'fx'; scene.add(fxRoot);
  const texts = {};
  if (mods.text) {
    try {
      const Text = await mods.text.buildText({ THREE, M, FRONT, root: fxRoot, hash, rng, quality: OPT.quality });
      for (const [id, spec] of Object.entries(TEXT_SPECS)) {
        try { const it = spec.kind === 'title' ? Text.title() : Text.item(id, spec); if (it.obj.parent !== fxRoot) fxRoot.add(it.obj); it.obj.visible = false; texts[id] = it; }
        catch (e) { warn(`text item ${id} failed: ${first(e)}`); }
      }
    } catch (e) { warn(`buildText failed: ${first(e)}`); }
  }
  const threads = {};
  for (const [id, spec] of Object.entries(THREAD_SPECS)) {
    let th = null;
    if (mods.gags?.makeThreadLine) { try { th = mods.gags.makeThreadLine(M, spec); } catch (e) { warn(`makeThreadLine failed: ${first(e)}`); } }
    if (!th) th = fallbackThread(spec);
    th.obj.visible = false; if (th.obj.parent !== fxRoot) fxRoot.add(th.obj); threads[id] = th;
  }
  function fallbackThread(spec) {                         // used until gags.js lands: a tube whose vertices move in place
    const seg = spec.segments ?? 96, rad = 6, r0 = spec.radius ?? 0.018;
    const prev = M.currentK; M.currentK = { value: 1 };
    const geo = new THREE.BufferGeometry(); const pos = new Float32Array((seg + 1) * rad * 3); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = []; for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * rad + j, b = i * rad + (j + 1) % rad, c = (i + 1) * rad + j, d = (i + 1) * rad + (j + 1) % rad; idx.push(a, c, b, b, c, d); }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, M.thread(spec.color ?? 0xff5fa8)); mesh.frustumCulled = false; mesh.castShadow = false; M.currentK = prev;
    const P = new THREE.Vector3(), Tn = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    return {
      obj: mesh, fallback: true,
      set(pts, reveal = 1, t = 0) {
        if (reveal <= 0.001) { mesh.visible = false; return; }
        mesh.visible = true;
        const curve = typeof pts === 'function' ? null : new THREE.CatmullRomCurve3(pts.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p)));
        for (let i = 0; i <= seg; i++) {
          const s = (i / seg) * reveal;
          if (curve) { curve.getPoint(s, P); curve.getTangent(Math.min(0.999, s), Tn); } else { const p = pts(s); P.set(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]); const p2 = pts(Math.min(1, s + 0.01)); Tn.set((p2.x ?? p2[0]) - P.x, (p2.y ?? p2[1]) - P.y, (p2.z ?? p2[2]) - P.z).normalize(); }
          N.crossVectors(Tn, up); if (N.lengthSq() < 1e-6) N.set(1, 0, 0); N.normalize(); B.crossVectors(Tn, N).normalize();
          const rr = r0 * (1 + 0.12 * Math.sin(t * 6 + i * 0.7));
          for (let j = 0; j < rad; j++) { const a = (j / rad) * TAU, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr; const o = (i * rad + j) * 3; pos[o] = P.x + N.x * cx + B.x * cy; pos[o + 1] = P.y + N.y * cx + B.y * cy; pos[o + 2] = P.z + N.z * cx + B.z * cy; }
        }
        geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
      },
    };
  }
  const props = {};
  for (const [id, spec] of Object.entries(PROP_SPECS)) {
    let g = null;
    if (mods.gags && mods.gags[spec.make]) { try { g = mods.gags[spec.make](M, ...(spec.args || [])); } catch (e) { warn(`gags.${spec.make} failed: ${first(e)}`); } }
    if (!g) {                                              // stand-in: a flat felt scrap
      const prev = M.currentK; M.currentK = { value: 1 };
      g = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.42), M.cloth(spec.color ?? 0xffb6d5, { rep: 4 })); g.userData.standIn = true; M.currentK = prev;
    }
    g.visible = false; fxRoot.add(g); props[id] = g;
  }

  // ------------------------------------------------------------------------------------------------ acts (fallbacks when moves.js is missing)
  function fallbackAct(name, a, c) {
    if (c.kind === 'pip' || /^pip/.test(name)) {
      const s = Math.sin(a.tp * 2.2 + a.seed * 6), bob = 0.012 * Math.sin(a.beat * TAU);
      return { pose: { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.55, 0, 1.75], elR: [-0.4, 0, -0.35], head: [0.02, -0.4 + 0.05 * s, -0.08], body: [0.05, 0, 0.02 * s] }, dy: bob, face: {} };
    }
    if (/^dead|^shy|^flinch|^gasp|^wobble/.test(name)) { const d = deadAct(a.tp + a.seed * 3, a.seed * 6); return { pose: d.pose, dy: d.bob, roll: d.sway, face: /moan/i.test(name) ? { emote: 'moan' } : {} }; }
    const l = liveAct(a.beat, a.seed * 0.5, a.amp); return { pose: l.pose, dy: l.bob, roll: l.sway, face: {} };
  }
  const normPose = (p) => { const o = {}; for (const k of POSE_KEYS) o[k] = (p && p[k]) ? [p[k][0] || 0, p[k][1] || 0, p[k][2] || 0] : [0, 0, 0]; return o; };
  function applyPoseFallback(c, base, P) {                 // pose + root placement in the character's own frame (x right, z forward, y up)
    pose(c.obj, P.pose);
    const rot = base.rotY + (P.yaw || 0), cs = Math.cos(base.rotY), sn = Math.sin(base.rotY);
    const dx = P.dx || 0, dz = P.dz || 0;
    c.obj.position.set(base.x + dx * cs + dz * sn, (base.y || 0) + (P.dy ?? P.bob ?? 0), base.z - dx * sn + dz * cs);
    c.obj.rotation.order = 'YXZ'; c.obj.rotation.set(P.lean || 0, rot, P.roll || 0);
  }
  const warnedAct = new Set();
  function evalAct(e, c, ctx) {
    const a = ctx.a; let P;
    try {
      if (typeof e.act === 'function') P = e.act(a, c);
      else if (e.act === 'crowd') P = crowdAct(a, c, ctx);
      else if (e.act && mods.moves) P = mods.moves.act(e.act, a);
      else if (e.act) P = fallbackAct(e.act, a, c);
      else P = c.K.value > 0.5 ? fallbackAct('liveBop', a, c) : fallbackAct('deadStand', a, c);
    } catch (err) {
      if (!warnedAct.has(e.act)) { warnedAct.add(e.act); warn(`act ${e.act} failed (${first(err)}); fallback used`); }
      P = fallbackAct(String(e.act), a, c);
    }
    P = P || {}; P.pose = normPose(P.pose); return P;
  }
  // a crowd zombie that is made over as the front passes: dead shamble -> makeover (hop) -> bop.  Uses the front's own timing.
  function crowdAct(a, c, ctx) {
    const A = (n) => { try { return mods.moves ? mods.moves.act(n, a) : fallbackAct(n, a, c); } catch (e) { return fallbackAct(n, a, c); } };
    const K = c.K.value, dead = A('deadShamble'), live = A('liveBop');
    const kp = smooth((K - 0.35) / 0.65), d = normPose(dead.pose), l = normPose(live.pose);
    const P = { pose: lerpPose(d, l, kp), dy: (dead.dy || 0) * (1 - kp) + (live.dy || 0) * kp, roll: (dead.roll || 0) * (1 - kp) + (live.roll || 0) * kp, dx: (live.dx || 0) * kp, dz: (live.dz || 0) * kp, yaw: (live.yaw || 0) * kp, lean: (live.lean || 0) * kp, face: kp > 0.5 ? live.face : dead.face };
    const th = ctx.tDone;                                  // the makeover hop when the last stitch lands (moves.hop when it exists, else a sine bump)
    if (isFinite(th)) {
      const h = (ctx.tpSong - th), HD = 0.62;
      if (h >= 0 && h < HD) {
        if (mods.moves) { try { return mods.moves.act('hop', { ...a, t: h, tp: h, dur: HD, k: h / HD, args: { from: 'live' } }); } catch (e) { /* bump below */ } }
        P.dy += Math.sin(h / HD * PI) * 0.22;
      }
    }
    return P;
  }

  // ------------------------------------------------------------------------------------------------ helper object F handed to templates
  const FB = {};
  FB.slot = function (name, fb) {                         // 'mall.machine', 'mall_door.glass2', 'atelier.teaSeat0' or plain 'machine'
    if (name && typeof name === 'object') return { x: name.x, y: name.y || 0, z: name.z, rotY: name.rotY || 0 };
    let s = null;
    const dot = String(name).indexOf('.');
    if (dot > 0) { const o = setOf(name.slice(0, dot)); s = o?.slots?.[name.slice(dot + 1)]; }
    else for (const o of [mall, ...Object.values(EXT), S.atelier, S.card]) if (o?.slots?.[name]) { s = o.slots[name]; break; }
    if (!s) { if (fb === undefined) warn(`slot ${name} not found`); s = typeof fb === 'function' ? fb() : fb; }
    return s ? { x: s.x, y: s.y || 0, z: s.z, rotY: s.rotY || 0 } : { x: 0, y: 0, z: 0, rotY: 0 };
  };
  FB.at = function (rad, lat = 0, y = 0, face) {          // a world point from the hub axes: rad metres along the front's axis, lat sideways
    const p = mall.anchors.at(rad, lat), r = { x: p.x, y, z: p.z, rotY: 0 };
    if (face) r.rotY = Math.atan2(face.x - p.x, face.z - p.z);
    return r;
  };
  FB.pos = function (rad, lat, y) { const p = mall.anchors.at(rad, lat); return [p.x, y, p.z]; };
  FB.ext = (name) => EXT[name] || null;                    // an extension module's set object (anchors, slots, rigs) or null
  FB.O = O; FB.ax = mall.anchors?.u || { x: 0.579, z: 0.815 }; FB.tn = mall.anchors?.tn || { x: -0.815, z: 0.579 };
  FB.mall = mall; FB.Rat = Rat; FB.tOfR = tOfR;
  FB.beatSec = function () { const b = Math.floor(T.beatAt(this.t)); return T.timeOfBeat(b + 1) - T.timeOfBeat(b); };      // length of the current beat in seconds
  FB.conf = function (delay = 0) { return Math.max(0, this.t - (this.sec0 + delay)); };                                  // confetti clock: seconds since the section started (0 = none)
  FB.sinceBeatNo = function (n) { return this.t - T.timeOfBeat(this.b0 + n); };                                            // seconds since beat n counted from the (rounded) shot start
  FB.facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  FB.rig = function (name, fallback) {                    // camera by rig name with a fallback so a missing set never breaks a shot
    return (u, c2) => {
      const fn = findRig(name);
      if (fn) return fn(u, c2);
      warn(`rig ${name} not found; fallback camera used`);
      return typeof fallback === 'function' ? fallback(u, c2) : fallback;
    };
  };
  FB.has = (name) => !!findRig(name);
  FB.walk = function (points, speed, o = {}) {           // constant-speed path; returns {x, z, rotY, dist, done} at the shot's puppet time
    const t = Math.max(0, this.up - (o.t0 || 0));
    return walkAt(points, speed, t, o.ahead ?? 0.5);
  };
  FB.cast = function (who, slot, act, o = {}) {
    const at = typeof slot === 'string' ? this.slot(slot, o.fallbackSlot) : slot;
    return { who, at: { x: at.x, y: at.y || 0, z: at.z, rotY: at.rotY || 0 }, act, ...o };
  };
  FB.crowd = function (ids, o = {}) {                     // zombies at their crowd homes (CROWD16), optional {act, args, radShift, k, look, seed}
    return ids.map((i) => {
      const [rad, lat] = CROWD16[i % 16];
      const p = mall.anchors.at(rad + (o.radShift || 0), lat + (o.latShift || 0));
      const face = o.faceTo || { x: O.x, z: O.z };
      return { who: 'z' + i, at: { x: p.x, y: 0, z: p.z, rotY: Math.atan2(face.x - p.x, face.z - p.z) + (o.jitter ?? 0.25) * (hash(i * 3.7) - 0.5) }, act: o.act ?? 'crowd', args: o.args, k: o.k, look: o.look, seed: hash(i * 5.31 + 0.5), amp: o.amp, sing: o.sing };
    });
  };
  FB.since = function (nBeats) { return this.t - T.timeOfBeat(T.beatAt(this.shot.t0) + nBeats); };            // seconds since beat n of this shot (negative before it)
  FB.beatIn = function (n) { return this.b >= n && this.b < n + 1; };                                          // are we inside beat n of the shot
  FB.tMeet = (x, z) => tOfR(Math.hypot(x - O.x, z - O.z));                                                   // song time when the front reaches (x, z)
  FB.tDone = (x, z, ramp = K_RAMP) => tOfR(Math.hypot(x - O.x, z - O.z) + ramp);                              // song time when that zombie is fully made over
  FB.mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
  FB.ease = smooth;
  FB.clamp = clamp; FB.lerp = lerp; FB.smooth = smooth; FB.hash = hash;
  FB.orbit = (c, r, a0, a1, h, look, p, fov) => { const a = lerp(a0, a1, p); return { pos: [c.x + Math.sin(a) * r, h, c.z + Math.cos(a) * r], look, fov }; };
  FB.flicker = function (kind = 'dead') {                 // fluorescent flicker of the dead world, 0.3..1 (pure function of song time)
    const t = this.t;
    if (kind === 'stutter') { const n = Math.floor(t * 14); return t < 0.6 ? (hash(n) > 0.5 ? 1 : 0.25) : (hash(n + 9) > 0.86 ? 0.6 : 0.96); }
    return 0.86 + 0.14 * (hash(Math.floor(t * 14) + 3) > 0.22 ? 1 : 0.35);
  };
  FB.sing = function (which) { return T.sing(this.tp, which); };
  FB.act = (name, a) => (mods.moves ? mods.moves.act(name, a) : fallbackAct(name, a, { kind: 'zombie' }));           // a named act's pose record, for templates that mix two acts
  FB.word = function (lineId, n, end) {                   // song time of word n (1-based) of a lyric line ('bridge1.1'): its start, or its end with end = true
    const l = (T.lines || []).find((x) => x.id === lineId); if (!l) return null;
    const w = T.words[Math.min(l.word1 - 1, l.word0 + n - 1)]; return end ? w.t1 : w.t0;
  };

  function walkAt(points, speed, t, ahead) {
    const P = points.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p));
    const seg = []; let total = 0;
    for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z); seg.push(l); total += l; }
    const at = (d) => { d = clamp(d, 0, total); let i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; } const k = seg[i] > 1e-9 ? d / seg[i] : 0; return { x: lerp(P[i].x, P[i + 1].x, k), z: lerp(P[i].z, P[i + 1].z, k) }; };
    if (P.length < 2) return { x: P[0]?.x || 0, z: P[0]?.z || 0, rotY: 0, dist: 0, done: true };
    const d = Math.max(0, speed * t), p0 = at(d), p1 = at(d + ahead), p2 = at(Math.max(0, d - ahead));
    const hx = p1.x - p2.x, hz = p1.z - p2.z;
    return { x: p0.x, z: p0.z, rotY: Math.atan2(hx, hz), dist: Math.min(d, total), done: d >= total };
  }

  // ------------------------------------------------------------------------------------------------ rigs
  function findRig(name, cur) {
    if (typeof name === 'function') return name;
    if (!name || typeof name !== 'string') return null;
    const dot = name.indexOf('.');
    if (dot > 0) return setOf(name.slice(0, dot))?.rigs?.[name.slice(dot + 1)] || null;
    if (cur) { for (const o of [cur.setObj, ...(cur.exts || [])]) if (o?.rigs?.[name]) return o.rigs[name]; }
    return null;
  }

  // ------------------------------------------------------------------------------------------------ post
  const post = makePost(renderer, scene, cam, 'felt', W, H, { band: 0.42, tilt: 1.8, focusY: 0.5, noBokeh: true, trans: true });
  setPost(post);
  // the 'before' picture of a wipe lives here (half-float like the composer's own buffers: no banding in the grey-to-colour gradient)
  const wipeReady = !!post.wipe;
  const rtA = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const applyPost = (p) => {
    post.tilt.uniforms.band.value = p.band; post.tilt.uniforms.amount.value = p.tilt; post.tilt.uniforms.focusY.value = p.focusY;
    post.bloom.strength = p.bloom; post.bloom.radius = p.bloomRadius; post.bloom.threshold = p.bloomThr;
    const g = post.grade.uniforms; g.vig.value = p.vig; g.grain.value = p.grain; g.sat.value = p.sat; g.contrast.value = p.contrast; g.chroma.value = p.chroma;
    const tn = typeof p.tint === 'number' ? hex3(p.tint) : (p.tint.isColor ? [p.tint.r, p.tint.g, p.tint.b] : p.tint), lf = Array.isArray(p.lift) ? p.lift : [0, 0, 0];
    g.tint.value.set(tn[0], tn[1], tn[2]); g.lift.value.set(lf[0], lf[1], lf[2]);
  };
  const hex3 = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

  // ------------------------------------------------------------------------------------------------ transitions (pure functions of the distance to a cut)
  function transitionAt(t, k) {
    const out = { whip: 0, dir: [1, 0], dip: 0, dipColor: [0, 0, 0], flash: 0 };
    const cutFn = (s, d) => {                              // s = the incoming shot of a cut, d = t - cut time (negative before the cut)
      const tr = s.tr;
      if (tr.kind === 'whip') {
        const w = WHIP_FRAMES / FPS, v = clamp(1 - Math.abs(d) / w);
        if (v > out.whip) { out.whip = v; const sgn = tr.dir === 'left' || tr.dir === 'down' ? -1 : (tr.dir ? 1 : (s.i % 2 ? -1 : 1)); out.dir = tr.dir === 'up' || tr.dir === 'down' ? [0, sgn] : [sgn, 0]; }
      } else if (tr.kind === 'dip') {
        const first = s.i === 0, pre = first ? 0 : Math.min(0.35, 0.5 * (shots[s.i - 1]?.dur ?? 1)), post = Math.min(first ? 1.1 : 0.5, 0.7 * s.dur);
        const v = d < 0 ? (pre > 0 ? smooth(1 - -d / pre) : 0) : smooth(1 - d / post);
        if (v > out.dip) { out.dip = v; out.dipColor = hex3(tr.color); }
      } else if (tr.kind === 'flash' && d >= 0 && d < 0.10) {
        out.flash = Math.max(out.flash, 0.55 * Math.pow(1 - d / 0.10, 2));
      }
    };
    const s = shots[k], nx = shots[k + 1];
    cutFn(s, t - s.t0);
    if (nx) cutFn(nx, t - nx.t0);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ the per-frame function
  const last = { t: -1, shot: null, tpl: null, section: null, R: -1, alive: 0, rig: null, sets: [], cost: null };
  const visibleSets = () => [...Object.values(S), ...Object.values(EXT)];
  const HIDE_ALL = () => { for (const s of Object.values(S)) s.root.visible = false; for (const e of Object.values(EXT)) e.root.visible = false; for (const c of Object.values(CHARS)) c.obj.visible = false; for (const t of Object.values(texts)) t.obj.visible = false; for (const t of Object.values(threads)) t.obj.visible = false; for (const p of Object.values(props)) p.visible = false; };
  const tmpV = new THREE.Vector3(), camP = new THREE.Vector3();           // camP: the camera position at the puppet time (what look-at targets)

  // build(t, side): the two clocks and the template's frame description for song time t.  `side` is undefined for the picture the viewer ends up
  // with and 'before' for the first half of a wipe (F.side tells the template which one it is building; see the wipe notes in FILM_RUNTIME.md).
  function build(t, side, shotIndex) {
    const k = shotIndex ?? shotIndexAt(t), shot = shots[k];
    const tpSong = OPT.motion === 'ones' ? t : Math.floor(t * 12 + 1e-6) / 12;            // puppet clock (12 Hz on twos and mixed)
    const tq = Math.floor(tpSong * 12 + 1e-6);
    const dur = shot.dur;
    const tpl = TEMPLATES[shot.tpl];
    // The template runs once per clock: mk(tt, tpp) builds u, c2, F and the frame for smooth time tt and puppet time tpp.  The smooth run drives camera,
    // sets, lights, post; on twos a second run at the puppet time poses the cast, text, threads and props, so puppets cannot depend on the smooth clock.
    const mk = (tt, tpp) => {
      const ts = tt - shot.t0;
      const u = { t: ts, p: clamp(ts / dur), dur, mode: undefined };
      const bp = T.barPos(tt), beat = T.beatAt(tt), beatP = T.beatAt(tpp);
      const Rp = Rat(tpp), Rl = Rat(tt);
      const aliveShaderDefault = tpp >= aliveAt ? 1 : 0, aliveLightDefault = tt >= aliveAt ? 1 : clamp((Rl - 14) / 30);
      const c2 = {
        t: tt, tp: tpp, beat, bar: bp.bar, phase: bp.beat, pulse: T.beatPulse(tt), beatP, pulseP: T.beatPulse(tpp),
        env: { bass: T.env('bass', tt), mid: T.env('mid', tt), high: T.env('high', tt), rms: T.env('rms', tt), vocal: T.env('vocal', tt), onset: T.env('onset', tt) },
        alive: aliveLightDefault, R: Rp, Rl, ignited: Rp >= 0, cam, args: shot.args || {}, pip: { x: 0, z: 0 }, section: shot.section, confetti: 0, mode: undefined,
      };
      const F = Object.create(FB);
      const secObj = T.sectionById(shot.section), b0 = Math.round(T.beatAt(shot.t0));
      Object.assign(F, { sec0: secObj ? secObj.start : shot.t0, b0, beatNo: Math.floor(beat + 0.12) - b0, t: tt, tp: tpp, up: Math.max(0, tpp - shot.t0), u, p: u.p, dur, c2, args: shot.args || {}, shot, section: shot.section, T, R: Rp, Rl, alive: aliveShaderDefault, aliveLight: aliveLightDefault, aliveAt, tq: Math.floor(tpp * 12 + 1e-6), b: beat - T.beatAt(shot.t0), bp: beatP - T.beatAt(shot.t0), beat, beatP, motion: OPT.motion, portrait: OPT.portrait, cam, side });
      let frame;
      if (!tpl) { warn(`no template ${shot.tpl}; debug frame used`); frame = TEMPLATES.__missing(F); } else frame = tpl(F) || {};
      if (typeof window !== 'undefined' && window.__rigOverride) frame.rig = window.__rigOverride(frame, F) ?? frame.rig;      // debugging only (out/argtry.py `_rig`): a plan view of any shot
      if (typeof window !== 'undefined' && window.__frameOverride) window.__frameOverride(frame, F);                             // debugging only (out/argtry.py `_frame`): edit the frame before it is posed
      frame.cast ||= []; frame.ext ||= []; frame.args = { ...(shot.args || {}), ...(frame.args || {}) };
      return { u, c2, F, frame, ts, Rp, Rl, aliveShaderDefault, aliveLightDefault, beatP };
    };
    const S1 = mk(t, tpSong);
    const tpEff = Math.max(tpSong, shot.t0), needP = OPT.motion !== 'ones' && Math.abs(tpEff - t) > 1e-9;
    const SP = needP ? mk(tpEff, tpEff) : S1;
    return { t, k, shot, tpSong, tq, S1, SP, needP };
  }

  // compose(B, mode): pose the whole scene for one built frame.  mode 'before' = the first picture of a wipe (no transition pass, no wipe pass),
  // 'main' = what the viewer sees (transition pass; the wipe pass when the frame carries `wipe`).
  function compose(B, mode = 'main', wipeOn = true) {
    const { t, k, shot, tpSong, tq, S1, SP, needP } = B;
    const { u, c2, F, frame, ts, Rp, Rl, aliveShaderDefault, aliveLightDefault, beatP } = S1;

    // ---- visibility: base set, extensions, also
    HIDE_ALL();
    const setName = frame.set || 'mall', setObj = S[setName] || S.mall;
    setObj.root.visible = true;
    const extNames = setName === 'mall' ? [...new Set([...(frame.noRoof ? [] : DEFAULT_EXT), ...frame.ext])] : (frame.ext || []);
    const exts = extNames.map((n) => EXT[n]).filter(Boolean);
    exts.forEach((e) => { e.root.visible = true; });
    const others = (frame.also || []).map((n) => S[n]).filter(Boolean); others.forEach((s) => { s.root.visible = true; });
    const cur = { setObj, exts };

    // ---- story clock overrides
    const R = frame.R ?? Rp, Rlight = frame.R ?? Rl;
    const aliveShader = frame.alive ?? aliveShaderDefault, aliveLight = frame.alive ?? aliveLightDefault;
    c2.R = R; c2.Rl = Rlight; c2.alive = aliveLight; c2.ignited = frame.ignited ?? R >= 0; c2.args = frame.args; c2.mode = frame.mode; u.mode = frame.mode; c2.confetti = frame.confetti || 0;
    const pipEntry = frame.cast.find((e) => e.who === 'pip');
    if (pipEntry) { const a = pipEntry.path || pipEntry.at || {}; c2.pip = { x: a.x || 0, z: a.z || 0 }; } else c2.pip = { x: mall.slots?.machine?.x ?? O.x, z: mall.slots?.machine?.z ?? O.z };

    // ---- camera first: everything that faces the camera reads it in this same call
    let rigFn = findRig(frame.rig, cur), rigName = typeof frame.rig === 'string' ? frame.rig : (typeof frame.rig === 'function' ? '<fn>' : '<object>');
    let r;
    if (frame.rig && typeof frame.rig === 'object' && !Array.isArray(frame.rig)) r = frame.rig;
    else {
      if (!rigFn && frame.rig) { warn(`rig ${frame.rig} not found in ${setName}; using its debug/default rig`); }
      rigFn ||= setObj.rigs?.debug || Object.values(setObj.rigs || {})[0] || (() => ({ pos: [0, 2, 10], look: [0, 1.2, 0], fov: 40 }));
      r = rigFn(u, c2);
    }
    let fov = r.fov ?? 40;
    const ps = OPT.portrait ? (PSHORT[shot.id] || {}) : {};
    if (OPT.portrait) fov = Math.min(100, 2 * Math.atan(Math.tan(fov * PI / 360) * (16 / 9) / (W / H) * (ps.pz ?? OPT.pz)) * 180 / PI);
    cam.position.set(...r.pos); cam.lookAt(...r.look);
    if (r.roll) cam.rotateZ(r.roll);
    if (OPT.portrait && ps.dx) { tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(ps.dx); cam.position.add(tmpV); }
    if (OPT.portrait && (ps.yaw || ps.tilt)) { cam.rotateY(-(ps.yaw || 0) * PI / 180); cam.rotateX((ps.tilt || 0) * PI / 180); }
    if (OPT.portrait && frame.portraitShift) { tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(frame.portraitShift); cam.position.add(tmpV); }
    cam.fov = fov; cam.aspect = W / H; cam.near = r.near ?? 0.05; cam.far = 1200; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    camP.copy(cam.position);
    if (needP) {                                                               // twos: the puppets were posed for the camera as it stood at the puppet time
      try {
        const fr = SP.frame.rig, rp = (fr && typeof fr === 'object' && !Array.isArray(fr)) ? fr : (findRig(fr, cur) || rigFn)(SP.u, SP.c2);
        camP.set(rp.pos[0], rp.pos[1], rp.pos[2]);
        if (OPT.portrait && SP.frame.portraitShift) { tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(SP.frame.portraitShift); camP.add(tmpV); }
      } catch (e) { /* keep the smooth position */ }
    }

    // ---- front, alive, flicker, boil
    FRONT.uFrontWidth.value = FRONT_DEFAULTS.w; FRONT.uFrontNoise.value = FRONT_DEFAULTS.n; FRONT.uDash.value = FRONT_DEFAULTS.d; FRONT.uThread.value.setRGB(...FRONT_DEFAULTS.c);
    const od = frame.front || (setObj.front ? setObj.front(u, c2) : null) || (exts.find((e) => e.front)?.front(u, c2)) || null;
    FRONT.uFront.value.set(O.x, 0.5, O.z, R);
    FRONT.uAlive.value = aliveShader;
    FRONT.uTime.value = t;
    FRONT.uBoil.value = OPT.hand ? ((tq * 0.61803398875) % 1) * 37.0 : 0;
    FRONT.uFlicker.value = lerp(frame.flicker ?? 0.96, 1, aliveLight);
    if (od) {
      if (od.width !== undefined) FRONT.uFrontWidth.value = od.width; if (od.noise !== undefined) FRONT.uFrontNoise.value = od.noise; if (od.dash !== undefined) FRONT.uDash.value = od.dash;
      const th = od.thread; if (Array.isArray(th)) FRONT.uThread.value.setRGB(th[0], th[1], th[2]); else if (th && th.isColor) FRONT.uThread.value.copy(th); else if (typeof th === 'number' && th > 255) FRONT.uThread.value.setHex(th);
    }
    scene.background = new THREE.Color(frame.bg ?? (aliveShader > 0.5 ? 0xffd9a6 : 0x141826));

    // ---- machine fallback: without machine_macro the film pumps the needle from args.needle
    if (EXT.machine_macro.stub && mall.anchors?.needle) {
      const n = frame.args.needle || 0, nd = mall.anchors.needle;
      nd.position.y = n > 0 ? 0.12 + 0.05 * Math.sin(beatP * TAU * n) : 0.12;
      if (mall.anchors.wheel) mall.anchors.wheel.rotation.z = n > 0 ? beatP * TAU * n * 0.5 : 0;
    }

    // ---- sets: update, light
    setObj.update?.(u, c2); exts.forEach((e) => e.update?.(u, c2)); others.forEach((s) => s.update?.(u, c2));
    kit.off();
    const lights = Array.isArray(frame.light) ? frame.light : [frame.light || setName];
    for (const ln of lights) { const lo = setOf(ln === 'mall' || ln === setName ? setName : ln) || setObj; (lo.light || setObj.light)?.call(lo, kit, u, c2); }

    // ---- cast
    const touchAmt = OPT.hand ? 1 : 0;
    const touch = (n, a) => (hash(tq * 1.37 + n * 91.7) - 0.5) * 2 * a * touchAmt;
    const heldUse = {};
    const RC = SP.frame.R ?? SP.Rp, aliveC = SP.frame.alive ?? SP.aliveShaderDefault;
    SP.frame.cast.forEach((e, ei) => {
      const c = CHARS[e.who]; if (!c) { warn(`unknown cast id ${e.who}`); return; }
      if (e.hidden) return;
      const path = e.path, at = path ? { x: path.x, y: e.at?.y || 0, z: path.z, rotY: path.rotY } : (typeof e.at === 'string' ? FB.slot(e.at) : e.at);
      const clear = SP.frame.camClear ?? frame.camClear ?? 0.6;                 // a zombie whose root is within `clear` m of the camera would fill the lens from inside: it is left out (entry keepNear:true or frame camClear:0 turns this off)
      if (c.kind !== 'pip' && !e.keepNear && clear > 0 && camP.y < 2.6 && Math.hypot(at.x - camP.x, at.z - camP.z) < clear) return;
      c.obj.visible = true;
      // makeover state
      let K;
      const dist = Math.hypot(at.x - O.x, at.z - O.z);
      const auto = clamp((RC - dist) / (e.ramp ?? K_RAMP));
      if (c.kind === 'pip') K = 1;
      else if (typeof e.k === 'number') K = e.k;
      else K = (aliveC > 0.5 && !e.hold) ? 1 : auto;
      c.K.value = K; if (c.kind !== 'pip') (c.K.hold ||= { value: 0 }).value = e.hold ? 1 : 0;
      // act
      const seed = e.seed ?? hash(c.idx * 7.13 + 0.5);
      const t0 = e.t0 || 0, actT = Math.max(0, SP.ts - t0), actTp = Math.max(0, SP.F.up - t0), adur = e.dur ?? Infinity;
      const a = { t: needP ? actTp : actT, tp: actTp, dur: adur, k: isFinite(adur) ? clamp((needP ? actTp : actT) / adur) : 0, beat: SP.beatP, phase: ((SP.beatP - T.beatAt(T.bars[0])) % 4 + 4) % 4, pulse: SP.c2.pulseP, seed, amp: e.amp ?? 1, side: e.side ?? 1, args: { ...(e.args || {}), ...(path ? { dist: path.dist } : {}), K } };
      const tDone = e.act === 'crowd' ? tOfR(dist + (e.ramp ?? K_RAMP)) : Infinity;
      const P = evalAct(e, c, { a, tDone, tpSong });
      // look-at: the head turns toward the camera or a world point
      if (e.look) {
        const tgt = e.look === 'cam' ? camP : e.look === 'pip' ? { x: c2.pip.x, z: c2.pip.z } : e.look;
        const rot = at.rotY + (P.yaw || 0), rel = clamp(wrapAng(Math.atan2(tgt.x - at.x, tgt.z - at.z) - rot), -1.05, 1.05) * (e.lookAmt ?? 0.7);
        P.pose.head = [P.pose.head[0], P.pose.head[1] + rel, P.pose.head[2]];
      }
      if (touchAmt) { const n = c.idx * 5; P.roll = (P.roll || 0) + touch(n + 11, 0.010); P.lean = (P.lean || 0) + touch(n + 12, 0.008); P.pose.head = [P.pose.head[0] + touch(n + 15, 0.02), P.pose.head[1], P.pose.head[2] + touch(n + 16, 0.03)]; }
      const base = { x: at.x + (touchAmt ? touch(c.idx * 5 + 13, 0.004) : 0), y: at.y || 0, z: at.z + (touchAmt ? touch(c.idx * 5 + 14, 0.004) : 0), rotY: at.rotY };
      if (mods.moves?.applyPose) { try { mods.moves.applyPose(c, base, P); } catch (err) { warn(`moves.applyPose failed: ${first(err)}`); applyPoseFallback(c, base, P); } } else applyPoseFallback(c, base, P);
      c.obj.scale.setScalar(c.baseScale * (e.scale ?? 1));
      // hands: Pip's needle and cushion follow the act's attach hints
      if (c.kind === 'pip') { const at2 = P.attach || {}; c.needle.visible = !at2.handR; c.cushion.visible = !at2.handL; }
      if (P.attach) for (const hand of ['handL', 'handR']) if (P.attach[hand]) attachHeld(c, hand === 'handL' ? 'elL' : 'elR', P.attach[hand], heldUse);
      if (e.attach) for (const [hand, kind] of Object.entries(e.attach)) if (kind) attachHeld(c, hand === 'handL' ? 'elL' : 'elR', kind, heldUse);
      // face
      if (mods.face) {
        try {
          const ph = P.face || {}, ef = e.face || {};
          const Fc = { mouth: null, moan: 0, blink: mods.face.autoBlink ? mods.face.autoBlink(tpSong, seed) : 0, look: [0, 0], brow: ef.brow ?? ph.brow ?? 0, emote: ef.emote ?? ph.emote ?? 'neutral', emoteK: ef.emoteK ?? ph.emoteK ?? (ef.emote || ph.emote ? 1 : 0), t: tpSong };
          let lookT = [0, 0];
          if (e.look || ph.look) { const tgt = e.look === 'cam' ? camP : (e.look && e.look.x !== undefined ? e.look : null); if (tgt) lookT = [clamp(wrapAng(Math.atan2(tgt.x - at.x, tgt.z - at.z) - (at.rotY + (P.yaw || 0))), -1, 1), 0]; if (ph.look) lookT = ph.look; }
          Fc.look = ef.look ?? (mods.face.autoLook ? mods.face.autoLook(tpSong, seed, lookT) : lookT);
          if (e.sing) {
            if (c.kind === 'pip') { if (T.sing(tpSong, 'lead') > 0.05) Fc.mouth = T.mouth(tpSong); }
            else if (T.sing(tpSong, 'bg') > 0.05 || e.sing === 'any') Fc.mouth = T.mouth(tpSong);
          }
          if (e.moan) Fc.moan = Math.max(T.moan(tpSong), ph.mouth ?? 0); else if (ph.mouth) Fc.moan = ph.mouth;
          if (Fc.moan > 0.05 && Fc.emote === 'neutral') { Fc.emote = 'moan'; Fc.emoteK = Fc.moan; }
          mods.face.setFace(c, Fc);
        } catch (err) { warn(`setFace failed: ${first(err)}`); }
      }
    });
    // ---- the arm gag (web/gags.js armGag; docs/FILM_RUNTIME.md "arm gag"): frame.armGag = { who, t0, saucer: {x, z}, pip: {x, z}, tableY } drives ONE seated zombie's right arm
    // (sip, pop off, roll, sewn back on, bow), the loose arm and its effects, Pip's feet, hand, needle and thread.  Everything is a function of the puppet clock: u = tpSong - t0.
    for (const L of Object.values(LOOSE)) L.reset();
    if (ARM_PROPS.needle) ARM_PROPS.needle.visible = false; if (ARM_PROPS.thread) ARM_PROPS.thread.obj.visible = false;
    const ag = SP.frame.armGag;
    if (ag && mods.gags?.armGag && mods.gags?.makeLooseArm) {
      try {
        const ch = CHARS[ag.who], pc = CHARS.pip;
        if (ch && ch.obj.visible && pc && (pc.obj.visible || ag.noPip)) {
          const J = ch.obj.userData.J, sc = ch.obj.scale.x, rotY = ag.rotY ?? ch.obj.rotation.y, uG = Math.max(0, tpSong - ag.t0), cR = Math.cos(rotY), sR = Math.sin(rotY);
          const zPose = (g) => { pose(ch.obj, { shR: g.zombie.shR, elR: g.zombie.elR }); J.head.rotation.x -= g.zombie.nod * 0.16; J.body.rotation.z += g.wobble * 0.07; ch.obj.updateMatrixWorld(true); };
          const sockOf = () => J.shR.getWorldPosition(new THREE.Vector3());
          let sock = sockOf();
          const optOf = () => ({ scale: sc, rotY, tableDrop: sock.y - ag.tableY, saucer: [(ag.saucer.x - sock.x) * cR - (ag.saucer.z - sock.z) * sR, (ag.saucer.x - sock.x) * sR + (ag.saucer.z - sock.z) * cR], pip: [(ag.pip.x - sock.x) * cR - (ag.pip.z - sock.z) * sR, (ag.pip.x - sock.x) * sR + (ag.pip.z - sock.z) * cR], z1: ag.z1, z2: ag.z2, sewDist: ag.sewDist, pickDist: ag.pickDist, restZ: ag.restZ });
          let g = mods.gags.armGag(uG, sock, optOf()); zPose(g);                       // the film passes the REAL shoulder: pose once, read the joint, ask again
          sock = sockOf(); g = mods.gags.armGag(uG, sock, optOf()); zPose(g);
          const L = (LOOSE[ag.who] ||= (() => { const l = mods.gags.makeLooseArm(M, ch, 1); fxRoot.add(l.obj); return l; })());
          L.apply(g, { scale: sc });
          if (ag.pipHand) { const h = ag.pipHand(uG, g); if (h) g.pipHand = h; }                    // a template may take Pip's right hand over once the repair is done (threadLift: she raises the needle); a pure function of the gag clock
          if (ag.needle) { const n = ag.needle(uG, g); if (n) g.needle = { fade: 1, ...n }; }       // ... and show the needle in it: { visible, pos: tip, dir }
          window.__armDbg = { u: uG, phase: g.phase, sock: sock.toArray().map((v) => +v.toFixed(3)), rotY, sc, drop: +(sock.y - ag.tableY).toFixed(3), arm: g.arm.pos.map((v) => +v.toFixed(3)), armVis: g.arm.visible, pipStand: g.pipStand.map((v) => +v.toFixed(3)), pipHand: g.pipHand ? g.pipHand.map((v) => +v.toFixed(3)) : null };      // debug only
          // the cup: in the mitt at the mouth while she sips, otherwise it stands on the table's own saucer (the table's static cup)
          if (g.cupK > 0.5 && HELD.cup.length) { const h = HELD.cup[Math.min(heldUse.cup || 0, HELD.cup.length - 1)]; heldUse.cup = (heldUse.cup || 0) + 1; if (h.parent !== J.elR) J.elR.add(h); h.visible = true; if (mods.gags.holdUpright) mods.gags.holdUpright(h, J.elR, { yaw: -0.3, at: [0, -0.215, 0], grip: h.userData.grip }); }
          // Pip: feet, lean, the left hand at her chest, the right hand on the arm / the needle
          if (!ag.noPip) {
            const yaw = ag.pipYaw0 !== undefined && uG < 0.8 ? lerpAng(ag.pipYaw0, g.pipYaw, smooth(clamp((uG - 0.25) / 0.5))) : g.pipYaw;      // before the pop she may face the lens, then turns to the guest
            pc.obj.position.set(g.pipStand[0], ag.pipY ?? 0, g.pipStand[1]); pc.obj.rotation.set(0, yaw, 0);
            let ca = 0; if (ag.pipCam) { const K = ag.pipCam; ca = K[0][1]; for (let i = 1; i < K.length; i++) if (uG >= K[i - 1][0]) ca = uG >= K[i][0] ? K[i][1] : lerp(K[i - 1][1], K[i][1], smooth(clamp((uG - K[i - 1][0]) / (K[i][0] - K[i - 1][0])))); }     // pipCam [[u, amount], ...]: how far her head turns toward the lens (0 = at the guest, 1 = as far as it goes)
            const relC = ca > 0 ? clamp(wrapAng(Math.atan2(camP.x - g.pipStand[0], camP.z - g.pipStand[1]) - yaw), -1.05, 1.05) * ca : 0;
            pose(pc.obj, { shL: [0, 0, -0.9], elL: [0, 0, 1.8], shR: [-0.2, 0, 0.5], elR: [-0.4, 0, 0], head: [0.12 + (ag.pipHeadX ? ag.pipHeadX(uG) : 0), relC, 0.05], body: [g.pipLean, 0, 0] }); pc.obj.updateMatrixWorld(true);
            if (g.pipHand && mods.gags.reachArm) {                                                                                         // ag.pipHandK(u, g) 0..1 blends the IK arm with the plain pose (a hand that leaves the socket / rises with the needle)
              const Jp = pc.obj.userData.J, hk = ag.pipHandK ? clamp(ag.pipHandK(uG, g)) : 1, q0 = Jp.shR.quaternion.clone(), e0 = Jp.elR.rotation.x;
              mods.gags.reachArm(pc, 1, g.pipHand, [0.2, -1, 0.1]);
              if (hk < 1) { const q1 = Jp.shR.quaternion.clone(); Jp.shR.quaternion.copy(q0).slerp(q1, hk); Jp.elR.rotation.x = lerp(e0, Jp.elR.rotation.x, hk); }
              pc.obj.updateMatrixWorld(true);
            }
            pc.needle.visible = false; pc.cushion.visible = false;
          }
          const nd = ARM_PROPS.needle;
          if (nd && g.needle.visible) { const d = tmpV.set(...g.needle.dir).normalize(); nd.visible = true; nd.position.set(...g.needle.pos).addScaledVector(d, -0.16 * sc); nd.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); nd.scale.setScalar(sc * (g.needle.scale ?? 1)); }
          const th = ARM_PROPS.thread;
          if (th && g.thread.visible) { const A = new THREE.Vector3(...g.thread.from), B = new THREE.Vector3(...g.thread.to), Mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, -0.1 * sc, 0)); th.obj.visible = true; th.set([A, Mid, B], 1, tpSong); }
        }
      } catch (err) { warn(`armGag failed: ${first(err)}`); }
    }
    // pip standing by (not in the cast list) keeps invisible; held props not requested this frame are hidden
    for (const kind of Object.keys(HELD)) HELD[kind].forEach((h, i) => { if (!(heldUse[kind] > i)) h.visible = false; });

    // ---- text, threads, props
    for (const te of SP.frame.text || []) {
      const it = texts[te.id]; if (!it) continue;
      it.obj.visible = te.visible !== false; if (te.pos) it.obj.position.set(...te.pos); it.obj.rotation.set(te.rotX || 0, te.rotY || 0, te.rotZ || 0);
      if (te.scale) it.obj.scale.setScalar(te.scale); if (te.color !== undefined) it.setColor?.(te.color);
      if (te.words && it.progressWords) it.progressWords(tpSong, te.words); else if (te.p !== undefined) it.progress?.(te.p, tpSong);
      if (te.unpick !== undefined) it.unpick?.(te.unpick);
    }
    for (const th of SP.frame.threads || []) { const T2 = threads[th.id]; if (!T2) { warn(`unknown thread ${th.id}`); continue; } T2.obj.visible = th.reveal > 0.001; T2.set(th.pts, th.reveal ?? 1, th.t ?? tpSong); }
    for (const pe of SP.frame.props || []) {
      const g = props[pe.id]; if (!g) { warn(`unknown prop ${pe.id}`); continue; }
      g.visible = pe.visible !== false;
      if (pe.attach) { const ch = CHARS[pe.attach.who]; const j = ch?.obj.userData.J?.[pe.attach.joint || 'elR']; if (j) { if (g.parent !== j) j.add(g); g.position.set(...(pe.attach.pos || [0, -0.25, 0.03])); g.rotation.set(...(pe.attach.rot || [-0.3, 0, 0])); } }
      else { if (g.parent !== fxRoot) fxRoot.add(g); if (pe.at) { g.position.set(pe.at.x, pe.at.y || 0, pe.at.z); g.rotation.set(0, pe.at.rotY || 0, 0); } }
      if (pe.scale) g.scale.setScalar(pe.scale);
    }

    // ---- post + transitions
    const pp = { ...POST_DEFAULT, ...(setObj.post || {}) };
    for (const ln of lights) { const lo = setOf(ln); if (lo && lo !== setObj && lo.post) Object.assign(pp, lo.post); }
    Object.assign(pp, frame.post || {});
    if (!(pp.focusY >= 0.05 && pp.focusY <= 0.95)) { warn(`post.focusY ${pp.focusY} is outside 0.05..0.95 (screen fraction) in shot ${shot.id}; 0.5 used`); pp.focusY = 0.5; }     // a set that meant world metres would blur the whole frame
    applyPost(pp);
    const tr = mode === 'main' ? transitionAt(t, k) : { whip: 0, dir: [1, 0], dip: 0, dipColor: [0, 0, 0], flash: 0 }, tu = post.trans.uniforms;
    tu.whip.value = tr.whip; tu.whipDir.value.set(...tr.dir); tu.dip.value = tr.dip; tu.dipColor.value.set(...tr.dipColor); tu.flash.value = tr.flash;
    post.trans.enabled = mode === 'main';
    post.grade.uniforms.time.value = OPT.motion === 'ones' ? 0.37 : (tq % 97) * 0.0731 + 0.11;      // film grain boils with the puppet poses
    // the wipe pass composites the 'before' picture (rendered into rtA by setT) with this one along a stitched seam
    const wipe = mode === 'main' && wipeOn ? frame.wipe : null;
    post.wipe.enabled = !!wipe && wipeReady;
    if (wipe) {
      const wu = post.wipe.uniforms;
      wu.tOther.value = rtA.texture; wu.pos.value = clamp(wipe.pos ?? 0); wu.ang.value = wipe.angle ?? 0.1; wu.dir.value = wipe.dir ?? 1; wu.time.value = t;
      wu.amp.value = wipe.amp ?? 11; wu.per.value = wipe.period ?? 34; wu.inset.value = wipe.inset ?? 15; wu.thick.value = wipe.thick ?? 3.4; wu.dashL.value = wipe.dash ?? 26; wu.dashG.value = wipe.gap ?? 15; wu.shadow.value = wipe.shadow ?? 0.6;
      if (wipe.thread) wu.thread.value.set(...wipe.thread);
    }

    Object.assign(last, { t, shot: shot.id, tpl: shot.tpl, section: shot.section, R, alive: aliveShader, rig: rigName, cast: (frame.cast || []).map((e) => ({ who: e.who, at: e.at && [+e.at.x.toFixed(2), +(e.at.y || 0).toFixed(2), +e.at.z.toFixed(2), +(e.at.rotY || 0).toFixed(2)], act: typeof e.act === 'string' ? e.act : typeof e.act, vis: !!CHARS[e.who]?.obj.visible })), sets: [setName, ...extNames, ...(frame.also || [])], trans: tr, wipe: wipe ? { pos: wipe.pos, ready: wipeReady } : null, stubs: visibleSets().filter((s) => s.stub && s.root.visible).map((s) => s.name) });
    return last;
  }

  // setT(t): the whole frame.  A frame that carries `wipe` (the before/after slider) is drawn twice: first the 'before' picture, which is rendered
  // through the full post chain into rtA, then the main picture is posed and left for shoot() to render, with the wipe pass laying rtA behind
  // the moving seam.  Both halves are pure functions of t, so the result is the same in any order or process.
  function renderBefore() {
    const C = post.composer;
    C.renderToScreen = false; C.render(); C.renderToScreen = true;
    C.copyPass.render(renderer, rtA, C.readBuffer);
  }
  function setT(t) {
    const main = build(t);
    const w = main.S1.frame.wipe;
    if (w && wipeReady && OPT.dual) {
      const pos = clamp(w.pos ?? 0);
      if (pos <= 0.0005) return compose(build(t, w.side || 'before'), 'main', false);          // the seam has not entered yet: only the 'before' picture is on screen
      if (pos >= 0.9995) return compose(main, 'main', false);                                    // the seam has left: only the 'after' picture
      compose(build(t, w.side || 'before'), 'before');
      renderBefore();
    }
    return compose(main, 'main');
  }

  // ---- held props (tape, scissors, pins, cups, scraps ...): a small pool, re-parented each frame
  const HELD = {
    tape: [makeTape(M)], scissors: [makeScissors(M)], pin: [makePin(M)],
    cup: [0, 1, 2, 3, 4, 5, 6, 7].map(() => makeCupFallback()), scrap: [],
  };
  if (mods.gags?.makeTeacup) { try { HELD.cup = HELD.cup.map(() => mods.gags.makeTeacup(M)); } catch (e) { warn(`makeTeacup failed: ${first(e)}`); } }
  for (const list of Object.values(HELD)) list.forEach((h) => { h.visible = false; fxRoot.add(h); });
  const HELD_XF = { tape: [[0, -0.24, 0.04], [0.6, 0, 0]], scissors: [[0, -0.215, 0], [0, PI / 2, 0.15]], pin: [[0, -0.22, 0.03], [-0.9, 0, 0]], cup: [[0, -0.26, 0.05], [0, 0, 0]], scrap: [[0, -0.25, 0.03], [-0.3, 0, 0]] };
  // the arm gag's parts: one loose arm per zombie that has ever been the gag's subject, and Pip's needle and thread while she sews it back on
  const LOOSE = {}, ARM_PROPS = { needle: null, thread: null };
  if (mods.gags?.makeSewNeedle) { try { ARM_PROPS.needle = mods.gags.makeSewNeedle(M, 0.16); ARM_PROPS.needle.visible = false; fxRoot.add(ARM_PROPS.needle); } catch (e) { warn(`makeSewNeedle failed: ${first(e)}`); } }
  if (mods.gags?.makeThreadLine) { try { ARM_PROPS.thread = mods.gags.makeThreadLine(M, { segments: 24, radius: 0.006, glow: 0.8 }); ARM_PROPS.thread.obj.visible = false; fxRoot.add(ARM_PROPS.thread.obj); } catch (e) { warn(`makeThreadLine(arm) failed: ${first(e)}`); } }
  function makeCupFallback() {
    const prev = M.currentK; M.currentK = { value: 1 };
    const g = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.08, 16), M.plastic(0xfff4e0)); g.add(cup);
    const sau = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.015, 16), M.plastic(0xffd9ea)); sau.position.y = -0.045; g.add(sau);
    M.currentK = prev; return g;
  }
  function attachHeld(c, joint, kind, use) {
    const list = HELD[kind]; if (!list || !list.length) return;
    const i = use[kind] || 0; if (i >= list.length) return;
    use[kind] = i + 1;
    const h = list[i], j = c.obj.userData.J[joint]; if (h.parent !== j) j.add(h);
    const [p, r] = HELD_XF[kind]; h.position.set(...p); h.rotation.set(...r); h.visible = true;
  }

  // ------------------------------------------------------------------------------------------------ public API
  const totalFor = (sid, p) => { const s = shots.find((x) => x.id === sid); if (!s) throw new Error('no shot ' + sid); return p >= 1 ? s.t1 - 1e-3 : s.t0 + clamp(p) * (s.t1 - s.t0); };
  window.setT = (t) => { setT(t); };
  window.setView = (o = {}) => { if (o.sid) window.setT(totalFor(o.sid, o.p ?? 0.5)); else if (o.t !== undefined) window.setT(+o.t); };
  window.shoot = (fmt = 'png') => {
    renderer.info.reset(); post.composer.render();
    last.cost = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    const c = document.getElementById('c'); return fmt === 'jpg' ? c.toDataURL('image/jpeg', 0.94) : c.toDataURL('image/png');
  };
  window.filmInfo = () => ({ ...last, drawCalls: last.cost?.calls ?? renderer.info.render.calls, warn: window.__warn || [], timing: T.url, shots: SH.url, stubs: Object.values({ ...S, ...EXT }).filter((s) => s.stub).map((s) => s.name), motion: OPT.motion, hand: OPT.hand });
  window.listShots = () => shots;
  window.__film = { T, SH, S, EXT, CHARS, kit, post, Rat, tOfR, setT, mods, texts, threads, props };

  if (OPT.warm) {                                          // pre-compile every material with every set visible (then hide): only pays off in long runs
    const vis = [...Object.values(S), ...Object.values(EXT)].map((s) => s.root.visible);
    Object.values(S).forEach((s) => (s.root.visible = true)); Object.values(EXT).forEach((s) => (s.root.visible = true)); Object.values(CHARS).forEach((c) => (c.obj.visible = true));
    kit.setKey({ pos: [0, 9, 6], target: [0, 0, 0], i: 1 }); renderer.compile(scene, cam);
    kit.key.castShadow = false; renderer.compile(scene, cam); kit.key.castShadow = true;
    HIDE_ALL(); void vis;
  }
  const sid = q.get('sid'), tq0 = q.get('t');
  window.setT(sid ? totalFor(sid, +(q.get('p') ?? 0.5)) : +(tq0 ?? 0));
}
