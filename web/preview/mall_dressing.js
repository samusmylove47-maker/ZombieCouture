// mall dressing previewer (copy of preview/set.js with two additions): cast entries take a pose suffix  who@slot!dead|!live ,
// and a view can pass  only=mall_door+mall_runway  to show just those extension modules.  Default set=mall, ext=all three modules.
// Generic set previewer:  python3 tools/shoot.py felt preview out.png 640 360 "p=set&set=atelier&rig=macro&t=1.2&cast=pip@ped,z2@slotB&alive=1"
//   p=set            this module          set=<name>     web/sets/<name>.js       ext=a,b   extension modules web/sets/<ext>.js (build(ctx, set))
//   rig=<name>       camera rig of the set (or 'ext.rig' for an extension's rig)      t=<s>  seconds since the shot started    dur=<s>  shot length
//   mode=<string>    passed to the set as ctx.mode / c2.mode          alive=0..1  how awake the world is (default 1)      R=<m>  front radius (default: 46 if alive)
//   cast=who@slot,.. who = pip | zN (N = variant 0..6)   slot = a name from set.slots or x:z:rotY[:y]         act=live|dead  (default: live if alive>0.5)
//   light=<ext>      use an extension's light() instead of the set's         post=band,tilt,focusY (override)
//   args=k:v,k:v     free arguments passed as c2.args (numbers are parsed), e.g. args=skylight:0.6,door:1,draw:0.5
//   beat0=<beats>    beat offset (the preview clock runs at 130 BPM)
// Many views in one page load (saves the 10 s shader compile per render): window.setView({t, rig, dur, mode, alive, R, args, light, beat0}) then window.shoot(); see tools/shootmany.py
import { hash, smooth } from '../util.js';
import { makePip, makeZombie, liveAct, deadAct } from '../cast.js';
import { pose } from '../chars.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, rng, SHADOW } = env;
  const name = q.get('set') || 'mall';
  const extList = (q.get('ext') || 'mall_door,mall_runway,mall_rosette');
  const kit = makeKit(scene, { shadow: SHADOW });
  const root = new THREE.Group(); root.name = name; scene.add(root);
  const alive = +(q.get('alive') ?? 1);
  const ctx = { THREE, M, FRONT, rng, hash, scene, root, quality: q.get('quality') || 'full', W, H, mode: q.get('mode') || undefined, args: {} };
  const mod = await import(`../sets/${name}.js`);
  const set = mod.build(ctx);
  const exts = {};
  for (const e of extList.split(',').filter(Boolean)) {
    const em = await import(`../sets/${e}.js`); const g = new THREE.Group(); g.name = e; root.add(g);
    exts[e] = em.build({ ...ctx, root: g }, set);
  }
  FRONT.uAlive.value = alive; FRONT.uFront.value.set(set.anchors?.O?.x ?? 0, 0.5, set.anchors?.O?.z ?? 0, alive > 0.5 ? 46 : -1); FRONT.uFlicker.value = alive > 0.5 ? 1 : 0.97;

  // cast
  const cast = [];
  const slotOf = (s) => { if (set.slots && set.slots[s]) return set.slots[s]; const [x, z, r = 0, y = 0] = s.split(':').map(Number); return { x, z, rotY: r, y }; };
  for (const spec of (q.get('cast') || '').split(',').filter(Boolean)) {
    const [who, slotRaw] = spec.split('@'); const [slot, poseSel] = (slotRaw || '').split('!'); if (!slot) throw new Error(`cast entry "${spec}" needs who@slot (slot = a name from set.slots or x:z:rotY[:y])`); const sl = slotOf(slot);
    const c = who === 'pip' ? makePip(M) : makeZombie(M, +who.slice(1) || 0);
    if (c.kind === 'zombie') c.K.value = alive;
    scene.add(c.obj);
    const isLive = poseSel ? poseSel === 'live' : (who === 'pip' || alive > 0.5);
    const act = isLive ? liveAct(0.35 + cast.length * 0.13, cast.length * 0.31, 1) : deadAct(1.2 + cast.length * 0.4, 0.3 + cast.length * 0.7);
    pose(c.obj, act.pose); c.obj.position.set(sl.x, (sl.y || 0) + act.bob, sl.z); c.obj.rotation.set(0, sl.rotY || 0, act.sway);
    cast.push(c);
  }

  const parseArgs = (str) => Object.fromEntries((str || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, v !== undefined && v !== '' && !isNaN(+v) ? +v : v]; }));
  const view = { rig: q.get('rig') || Object.keys(set.rigs)[0], dur: +(q.get('dur') || 4), mode: ctx.mode, alive, R: +(q.get('R') ?? (alive > 0.5 ? 46 : -1)), args: parseArgs(q.get('args')), light: q.get('light') || '', beat0: +(q.get('beat0') || 0), t: +(q.get('t') || 0) };
  const c2 = { t: 0, tp: 0, beat: 0, bar: 0, phase: 0, pulse: 0, env: { bass: 0, mid: 0.3, high: 0.2, rms: 0.4, vocal: 0, onset: 0 }, alive, R: view.R, Rl: view.R, ignited: true, cam, mode: ctx.mode, args: view.args, section: '', confetti: 0, pip: cast[0] ? { x: cast[0].obj.position.x, z: cast[0].obj.position.z } : undefined };
  const findRig = (name) => { const f = name.includes('.') ? exts[name.split('.')[0]]?.rigs[name.split('.')[1]] : set.rigs[name]; if (!f) throw new Error(`no rig "${name}" (have: ${Object.keys(set.rigs).join(', ')}${Object.keys(exts).map((e) => ', ' + Object.keys(exts[e].rigs || {}).map((r) => e + '.' + r).join(', ')).join('')})`); return f; };
  window.setT = (t) => {
    view.t = t;
    const rigFn = findRig(view.rig), lightFn = view.light && exts[view.light]?.light ? exts[view.light].light : set.light, dur = view.dur;
    const uu = { t, p: Math.min(1, t / dur), dur, mode: view.mode };
    c2.mode = view.mode; c2.args = view.args; c2.alive = view.alive; c2.R = c2.Rl = view.R;
    c2.t = c2.tp = t; c2.beat = t * 130 / 60 + view.beat0; c2.bar = Math.floor(c2.beat / 4); c2.phase = c2.beat % 4; c2.pulse = Math.exp(-(c2.beat % 1) * 5);
    c2.env.bass = c2.pulse; c2.env.onset = c2.pulse > 0.9 ? 1 : 0;
    FRONT.uAlive.value = view.alive; FRONT.uFront.value.set(set.anchors?.O?.x ?? 0, 0.5, set.anchors?.O?.z ?? 0, view.R); FRONT.uFlicker.value = view.alive > 0.5 ? 1 : 0.97;
    cast.forEach((c) => { if (c.kind === 'zombie') c.K.value = view.alive; });
    set.update?.(uu, c2); Object.values(exts).forEach((x) => x.update?.(uu, c2));
    kit.off(); lightFn?.(kit, uu, c2);
    const r = rigFn(uu, c2);
    cam.position.set(...r.pos); cam.lookAt(...r.look); if (r.roll) cam.rotateZ(r.roll); cam.fov = r.fov ?? 40; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    FRONT.uTime.value = t;
  };
  window.setView = (o = {}) => { const { args, only, ...rest } = o; if (only !== undefined) { const on = String(only).split('+'); Object.entries(exts).forEach(([k, e]) => { e.root.visible = only === '' || on.includes(k); }); } Object.assign(view, rest); if (args) view.args = { ...args }; window.setT(view.t); };
  const pp = { ...(set.post || {}), ...Object.fromEntries((q.get('post') ? (([b, t2, f]) => [['band', +b], ['tilt', +t2], ['focusY', +f]])(q.get('post').split(',')) : [])) };
  setPost(makePost(renderer, scene, cam, 'felt', W, H, { band: pp.band ?? 0.42, tilt: pp.tilt ?? 1.8, focusY: pp.focusY ?? 0.5, noBokeh: true }));
  window.setT(view.t);
  window.__set = set; window.__exts = exts; window.__kit = kit;
}
