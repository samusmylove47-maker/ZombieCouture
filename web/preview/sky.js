// Preview for the roof, the sky and the quilt world:  the mall + mall_roof + sky built together, Pip on the pedestal, optional horseshoe of zombies.
//   python3 tools/shootmany.py out/roof 640 360 "p=sky&cast=pip@ped&horseshoe=8" "mall_roof.craneOut@3.2,dur=8,args.roof=1,alive=1" "sky.aerialMall@0,dur=8,alive=0,R=120,args.dawn=1,args.roof=1" ...
// view = rig@t[,dur=S][,alive=A][,R=M][,light=roof|sky|mall][,args.roof=0..1][,args.dawn=0..1][,hide=r1+r2|mall|sky][,noshadow=1]     (args persist from the previous view when not given: repeat them)
//   query: dbg=1 prints the roof group's children (r0, r1 ...) with their size and height;  hide=r3 hides child 3 of the roof group
//   rig      'sky.<rig>' | 'mall_roof.<rig>' | 'mall.<rig>'  (a bare name is looked up in sky, then mall_roof, then mall)
//   light    default: mall_roof.light for mall_roof rigs, sky.light for sky rigs;  'mall' = the mall's own light
// Unlike set.js this sets the camera BEFORE update() and light(), as the film does, and applies set.front() for sky rigs.
import { hash } from '../util.js';
import { makePip, makeZombie, liveAct } from '../cast.js';
import { pose } from '../chars.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, rng, SHADOW } = env;
  const kit = makeKit(scene, { shadow: SHADOW });
  const quality = q.get('quality') || 'full';
  const base = { THREE, M, FRONT, rng, hash, scene, quality, W, H, mode: undefined, args: {} };
  const mk = (name) => { const g = new THREE.Group(); g.name = name; scene.add(g); return g; };

  const mallRoot = mk('mall');
  const mall = (await import('../sets/mall.js')).build({ ...base, root: mallRoot });
  const exts = {};
  if (q.get('roof') !== '0') { const g = new THREE.Group(); g.name = 'mall_roof'; mallRoot.add(g); exts.mall_roof = (await import('../sets/mall_roof.js')).build({ ...base, root: g }, mall); }
  let sky = null;
  if (q.get('sky') !== '0') sky = (await import('../sets/sky.js')).build({ ...base, root: mk('sky') });

  // cast: pip@ped, zN@x:z:rotY
  const cast = [];
  const slotOf = (s) => { if (mall.slots[s]) return mall.slots[s]; const [x, z, r = 0, y = 0] = s.split(':').map(Number); return { x, z, rotY: r, y }; };
  for (const spec of (q.get('cast') || '').split(',').filter(Boolean)) {
    const [who, slot] = spec.split('@'); const sl = slotOf(slot);
    const c = who === 'pip' ? makePip(M) : makeZombie(M, +who.slice(1) || 0); if (c.kind === 'zombie') c.K.value = 1;
    scene.add(c.obj); const act = liveAct(0.35, who === 'pip' ? 0 : 1.7, 1); pose(c.obj, act.pose); c.obj.position.set(sl.x, (sl.y || 0) + act.bob, sl.z); c.obj.rotation.set(0, sl.rotY || 0, act.sway); cast.push(c);
  }
  const nh = +(q.get('horseshoe') || 0);
  if (nh > 0) mall.formation.horseshoe(nh).forEach((f, i) => {
    const c = makeZombie(M, i % 7); c.K.value = 1; scene.add(c.obj); const act = liveAct(0.35, i * 0.37, 1); pose(c.obj, act.pose); c.obj.position.set(f.x, act.bob, f.z); c.obj.rotation.set(0, f.rotY, act.sway); cast.push(c);
  });

  const parseArgs = (str) => Object.fromEntries((str || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, v !== undefined && v !== '' && !isNaN(+v) ? +v : v]; }));
  const view = { rig: q.get('rig') || 'sky.aerialMall', dur: +(q.get('dur') || 8), alive: +(q.get('alive') ?? 1), R: +(q.get('R') ?? -1), args: { roof: 1, dawn: 1, ...parseArgs(q.get('args')) }, light: q.get('light') || '', t: +(q.get('t') || 0) };
  const c2 = { t: 0, tp: 0, beat: 0, bar: 0, phase: 0, pulse: 0, env: { bass: 0, mid: 0.3, high: 0.2, rms: 0.4, vocal: 0, onset: 0 }, alive: 1, R: -1, Rl: -1, ignited: true, cam, args: view.args, section: '', confetti: 0, pip: { x: mall.anchors.ped.x, z: mall.anchors.ped.z } };
  const O = mall.anchors.O, FR0 = { w: FRONT.uFrontWidth.value, n: FRONT.uFrontNoise.value, d: FRONT.uDash.value, th: FRONT.uThread.value.clone() };

  const findRig = (name) => {
    const [a, b] = name.includes('.') ? name.split('.') : [null, name];
    const cands = a ? [[a, b]] : [['sky', b], ['mall_roof', b], ['mall', b]];
    for (const [s, r] of cands) { const src = s === 'sky' ? sky : s === 'mall' ? mall : exts[s]; if (src?.rigs?.[r]) return { fn: src.rigs[r], set: s }; }
    throw new Error(`no rig "${name}" (sky: ${Object.keys(sky?.rigs || {})}; mall_roof: ${Object.keys(exts.mall_roof?.rigs || {})})`);
  };
  window.setT = (t) => {
    view.t = t;
    const { fn, set: owner } = findRig(view.rig), dur = view.dur, uu = { t, p: Math.min(1, t / dur), dur, mode: undefined };
    c2.args = view.args; c2.alive = view.alive; c2.R = c2.Rl = view.R; c2.t = c2.tp = t; c2.beat = t * 130 / 60; c2.bar = Math.floor(c2.beat / 4); c2.phase = c2.beat % 4; c2.pulse = Math.exp(-(c2.beat % 1) * 5);
    // camera first (the film does the same), then everything that reads the camera
    const r = fn(uu, c2); cam.position.set(...r.pos); cam.up.set(0, 1, 0); cam.lookAt(...r.look); if (r.roll) cam.rotateZ(r.roll); cam.fov = r.fov ?? 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    FRONT.uAlive.value = view.alive; FRONT.uFront.value.set(O.x, 0.5, O.z, view.R); FRONT.uFlicker.value = view.alive > 0.5 ? 1 : 0.97; FRONT.uTime.value = t;
    const aerial = owner === 'sky' || view.front;
    const fs = owner === 'mall_roof' && exts.mall_roof?.front ? exts.mall_roof.front(uu, c2) : aerial && sky?.front ? sky.front(uu, c2) : null;
    FRONT.uFrontWidth.value = fs ? fs.width : FR0.w; FRONT.uFrontNoise.value = fs ? fs.noise : FR0.n; FRONT.uDash.value = fs ? fs.dash : FR0.d; FRONT.uThread.value.copy(fs ? fs.thread : FR0.th);
    mall.update?.(uu, c2); Object.values(exts).forEach((x) => x.update?.(uu, c2)); sky?.update?.(uu, c2);
    kit.off();
    const L = view.light || (owner === 'sky' ? 'sky' : owner === 'mall' ? 'mall' : 'mall_roof');
    (L === 'sky' ? sky : L === 'mall' ? mall : exts[L])?.light?.(kit, uu, c2);
    // debug: hide=r3+r7 (children of the roof group), hide=mall (everything of the mall except the roof group), hide=sky;  noshadow=1
    const hs = new Set(String(view.hide || '').split('+').filter(Boolean)), rr = exts.mall_roof?.root;
    rr?.children.forEach((o, i) => { const h = hs.has('r' + i); if (h) { o.visible = false; o.userData._hid = true; } else if (o.userData._hid) { o.visible = true; o.userData._hid = false; } });
    mallRoot.children.forEach((o) => { if (o === rr) return; if (hs.has('mall')) { o.userData._hid ??= o.visible; o.visible = false; } else if (o.userData._hid !== undefined) { o.visible = o.userData._hid; delete o.userData._hid; } });
    if (sky) sky.root.visible = !hs.has('sky');
    if (view.noshadow) kit.key.castShadow = false;
  };
  window.setView = (o = {}) => { const { args, ...rest } = o; Object.assign(view, rest); if (args) view.args = { roof: 1, dawn: 1, ...args }; window.setT(view.t); };
  if (q.get('dbg')) {
    const roofRoot = exts.mall_roof?.root; const box = new THREE.Box3(), sz = new THREE.Vector3();
    roofRoot?.children.forEach((o, i) => { box.setFromObject(o); box.getSize(sz); console.warn(`r${i} ${o.type} ${o.name || ''} size=${sz.x.toFixed(1)},${sz.y.toFixed(1)},${sz.z.toFixed(1)} y=${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} vis=${o.visible}`); });
    mallRoot.children.forEach((o, i) => { if (o === roofRoot) return; box.setFromObject(o); box.getSize(sz); if (sz.x > 15 || box.max.y > 10) console.warn(`m${i} ${o.type} ${o.name || ''} size=${sz.x.toFixed(1)},${sz.y.toFixed(1)},${sz.z.toFixed(1)} y=${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`); });
    scene.children.forEach((o, i) => { if (o === mallRoot || o.isLight) return; box.setFromObject(o); box.getSize(sz); if (sz.x > 15) console.warn(`s${i} ${o.type} ${o.name || ''} size=${sz.x.toFixed(1)},${sz.y.toFixed(1)},${sz.z.toFixed(1)} y=${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`); });
  }
  const pp = { ...(sky?.post || {}) };
  setPost(makePost(renderer, scene, cam, 'felt', W, H, { band: pp.band ?? 0.4, tilt: pp.tilt ?? 1.7, focusY: pp.focusY ?? 0.5, noBokeh: true }));
  window.setT(view.t);
  window.__mall = mall; window.__exts = exts; window.__sky = sky; window.__kit = kit;
}
