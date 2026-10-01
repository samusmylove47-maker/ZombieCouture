// Embroidered text previewer.
//   python3 tools/shoot.py felt preview out.png 640 360 "p=text&item=title&bg=alive"
//   item = title | title1 | braaains | pride | gag | hook1..hook5 | felt | satin | none      bg = alive | dead
//   All items are built once; args.item (or ?item=) picks the one on stage, so one page load can show every item (see tools/shootmany.py).
//   window.setView({t, rig, args}): args.item, args.p (progress 0..1), args.unpick (0..1 on the first item), args.p2 (progress of the
//   second item of 'gag'), args.dist (camera distance scale).   rigs: front | close | tilt | low | needle
//   The care-label card is a set module: use  p=set&set=card  with args.reveal.
import { hash } from '../util.js';
import { buildText } from '../text.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, rng, SHADOW } = env;
  const bg = q.get('bg') || 'alive';
  const kit = makeKit(scene, { shadow: SHADOW });
  const root = new THREE.Group(); scene.add(root);
  FRONT.uAlive.value = bg === 'alive' ? 1 : 0; FRONT.uFront.value.set(0, 0.5, 0, bg === 'alive' ? 60 : -1); FRONT.uFlicker.value = 0.97;
  const T = await buildText({ THREE, M, FRONT, root, hash, rng, quality: 'full' });

  // backdrop: a felt wall and a floor far below, so tilt views have something behind them
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), M.matte(bg === 'alive' ? 0xdccdf5 : 0xc8c8dc, { rep: 30, bump: 0.9 })); wall.position.set(0, 4, -0.25); wall.receiveShadow = true; root.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), M.matte(bg === 'alive' ? 0xffd6b0 : 0xb8b8c8, { rep: 14 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -3; root.add(floor);

  const stage = new THREE.Group(); stage.position.set(0, 1.6, 0); root.add(stage);
  const hooks = {
    hook1: ['Zombie', 'couture,', 'zombie', 'couture,'], hook2: ['Even', 'the', 'dead', 'deserve', 'to', 'look', 'adorable!'],
    hook3: ['We\'re', 'all', 'beautiful…', 'forevermore!'], hook4: ['Zom…', 'bie…', 'cute…'], hook5: ['Zom…', 'bie…', 'couture…'],
  };
  const B = {};
  B.title = [T.title({ lines: 2, id: 'title' })];
  B.title1 = [T.title({ lines: 1, id: 'title1' })];
  B.braaains = [T.item('braaains', { text: 'braaains', style: 'thread', color: 0x9fd86b, color2: 0xfff4e0, shadowColor: 0x2f5a2a, size: 0.8 })];
  B.pride = [T.item('pride', { text: 'pride', style: 'thread', color: 0xff5fa8, color2: 0xfff4e0, shadowColor: 0x5b1f56, size: 0.8 })];
  B.gag = [B.braaains[0], B.pride[0]];
  B.none = [];   // nothing on stage: the baseline for draw-call and frame-time differences
  for (const k of Object.keys(hooks)) B[k] = [T.itemFromWords(k, hooks[k], { style: 'thread', color: 0xff4a98, color2: 0xfff4e0, shadowColor: 0x5b1f56, size: 0.34, width: 6 })];
  B.felt = [T.item('felt', { text: 'Zombie Couture', style: 'felt', color: 0xff5fa8, color2: 0xfff4e0, size: 0.7 })];
  B.satin = [T.item('satin', { text: 'Zombie Couture', style: 'satin', color: 0xff5fa8, color2: 0xfff4e0, size: 0.7 })];
  const all = new Set(Object.values(B).flat()); all.forEach((it) => { stage.add(it.obj); it.setVisible(false); });
  let cur = null, b = { w: 1, h: 1 };
  const choose = (id) => {
    if (!B[id]) throw new Error('unknown item ' + id + ' (have ' + Object.keys(B).join(', ') + ')');
    if (cur === id) return; all.forEach((it) => it.setVisible(false)); B[id].forEach((it) => it.setVisible(true)); cur = id; b = B[id][0]?.bounds || b;
  };
  const view = { rig: q.get('rig') || 'front', t: +(q.get('t') || 0), args: { p: 1, item: q.get('item') || 'title' } };
  const fit = (k = 0.72) => { const asp = W / H, hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(30 / 2)) * asp); return Math.max((b.w / k) / 2 / Math.tan(hf / 2), (b.h / 0.55) / 2 / Math.tan(THREE.MathUtils.degToRad(15))); };
  const rigs = {
    front: () => ({ pos: [0, 1.6, fit()], look: [0, 1.6, 0], fov: 30 }),
    close: () => ({ pos: [-b.w * 0.18, 1.6 + b.h * 0.1, fit(1.5)], look: [-b.w * 0.18, 1.6 + b.h * 0.02, 0], fov: 30 }),
    tilt: () => ({ pos: [b.w * 0.42, 1.6 + b.h * 0.5, fit(0.9)], look: [0, 1.6, 0], fov: 30 }),
    low: () => ({ pos: [-b.w * 0.3, 1.6 - b.h * 0.4, fit(0.9)], look: [0, 1.6, 0], fov: 30 }),
    needle: () => ({ pos: [b.w * (view.args.p - 0.5) * 0.9, 1.6 + b.h * 0.05, fit(3.2)], look: [b.w * (view.args.p - 0.5) * 0.9, 1.6 - b.h * 0.05, 0], fov: 30 }),
  };
  window.setT = (t) => {
    view.t = t; const a = view.args; const id = a.item; choose(id);
    const isWords = !!hooks[id];
    B[id].forEach((it, i) => {
      if (isWords) { const n = hooks[id].length; it.progressWords(a.p ?? 1, hooks[id].map((_, k) => ({ t0: k / n, t1: (k + 0.9) / n }))); return; }
      if (id === 'gag') { if (i === 0) { if ((a.unpick ?? 0) > 0) it.unpick(a.unpick); else it.progress(a.p ?? 1, t); } else it.progress(a.p2 ?? 0, t); return; }
      if ((a.unpick ?? 0) > 0) it.unpick(a.unpick); else it.progress(a.p ?? 1, t);
    });
    kit.off();
    kit.setKey({ pos: [-4, 6, 8], target: [0, 1.6, 0], color: 0xffe6cc, i: 1.5, extent: 8, near: 1, far: 30 });
    kit.setHemi({ sky: 0xffffff, ground: bg === 'alive' ? 0xe8b8c8 : 0x9098b8, i: 0.5 });
    kit.setSpot(0, { color: 0xffd6e8, i: 60, dist: 30, angle: 0.8, pen: 0.7, decay: 1.2, pos: [3, 3, 9], target: [0, 1.6, 0] });
    kit.setSpot(1, { color: 0xff8fc8, i: 60, dist: 30, angle: 0.9, pen: 0.7, decay: 1.2, pos: [-6, 2, -2], target: [0, 1.6, 0] });
    const r = (rigs[view.rig] || rigs.front)(), s = a.dist ?? 1;
    cam.position.set(r.pos[0], 1.6 + (r.pos[1] - 1.6) * s, r.pos[2] * s); cam.lookAt(...r.look); cam.fov = r.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    FRONT.uTime.value = t;
  };
  window.setView = (o = {}) => { const { args, ...rest } = o; Object.assign(view, rest); if (args) view.args = { p: 1, item: view.args.item, ...args }; window.setT(view.t); };
  setPost(makePost(renderer, scene, cam, 'felt', W, H, { band: 0.9, tilt: 0.8, focusY: 0.5, noBokeh: true }));
  window.__text = T; window.__items = B;
  window.setT(view.t);
}
