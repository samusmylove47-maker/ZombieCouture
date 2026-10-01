// Face previewer: one character, large, on a plain pastel felt backdrop.
//   python3 tools/shoot.py felt preview out.png 640 360 "p=face&who=pip&mouth=AA&emote=happy"
//   ?shot=preview&p=face&who=pip|z0..z6&k=0|1&level=full|lite     k = zombie makeover 0 (dead) or 1 (dressed); Pip is always alive
//   Many views in one page (the shader compile is paid once):
//     tools/shootmany.py out/x 480 480 "p=face&who=pip" "face@0,args.mouth=AA" "face@0,args.mix=AA:0.6+O:0.4" "faceWide@0,args.emote=awe" "face@0,args.who=z2,args.k=0"
// view args (all optional):
//   who, k         switch character / makeover per view (characters are built on first use)
//   mouth=<viseme name> (weight 1) | mix=AA:0.6+O:0.4 (viseme:weight pairs joined with + or |; rest is the remainder) | sing=1 (singing, but between words)
//   emote (neutral happy awe shy gasp sleepy smug proud worried moan cheeky), emoteK, blink 0..1, lookx, looky -1..1, brow -1..1, moan 0..1, auto=1 (autoBlink / autoLook at t), seed
// rigs: face (close), faceWide (head and shoulders), threeQuarter, profile, body
import { makePip, makeZombie } from '../cast.js';
import { pose } from '../chars.js';
import { rigFace, setFace, autoBlink, autoLook, VISEMES } from '../face.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost, SHADOW } = env;
  scene.fog = null;
  const kit = makeKit(scene, { shadow: SHADOW });
  const back = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 16), M.matte(0xf3c7da, { rep: 90, side: THREE.BackSide })); scene.add(back);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), M.matte(0xf7c2d8, { rep: 90 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  const chars = {};
  const get = (who) => {
    if (chars[who]) return chars[who];
    const c = who === 'pip' ? makePip(M) : makeZombie(M, +who.slice(1) || 0);
    scene.add(c.obj);
    pose(c.obj, { shL: [0, 0, -0.5], shR: [0, 0, 0.5], head: [-0.03, 0, 0] });
    c.obj.updateMatrixWorld(true);
    rigFace(c, { level: q.get('level') || (who === 'pip' ? 'full' : 'lite') });
    const J = c.obj.userData.J, hp = new THREE.Vector3(), ws = new THREE.Vector3();
    J.head.getWorldPosition(hp); J.head.getWorldScale(ws);
    c.hp = hp; c.Rw = 0.34 * ws.x;                                  // head centre and world radius
    return (chars[who] = c);
  };

  const parseMix = (s) => { const m = new Float32Array(8); let sum = 0; for (const kv of String(s).split(/[+|;]/).filter(Boolean)) { const [n, w] = kv.split(':'); const i = VISEMES.indexOf(n); if (i > 0) { m[i] = w === undefined ? 1 : +w; sum += m[i]; } } m[0] = Math.max(0, 1 - sum); return m; };
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
  const view = { rig: q.get('rig') || 'face', t: num(q.get('t'), 0), args: {} };
  for (const k of ['who', 'k', 'mouth', 'mix', 'emote', 'emoteK', 'blink', 'lookx', 'looky', 'brow', 'moan', 'sing', 'auto', 'seed']) if (q.get(k) !== null) view.args[k] = isNaN(+q.get(k)) ? q.get(k) : +q.get(k);
  const baseArgs = { ...view.args };                              // every view starts from the URL's arguments (a view without args no longer inherits the previous view's)

  const RIGS = {
    face: { fov: 26, dist: 5.4, az: 0, dy: -0.02, up: 0 },
    faceWide: { fov: 30, dist: 11.5, az: 0, dy: -0.4, up: 0.15 },
    threeQuarter: { fov: 26, dist: 5.4, az: 0.62, dy: -0.02, up: 0.05 },
    profile: { fov: 26, dist: 5.4, az: 1.5, dy: -0.02, up: 0 },
    body: { fov: 34, dist: 12.5, az: 0.25, dy: -1.2, up: 0.2 },
  };
  function lights(hp, dead) {
    kit.off();
    kit.setKey({ pos: [hp.x - 2.4, hp.y + 2.2, hp.z + 4.2], target: [hp.x, hp.y, hp.z], color: dead ? 0xcfd8ff : 0xffe2c4, i: dead ? 1.4 : 2.3, extent: 3, near: 1, far: 16 });
    kit.setHemi({ sky: dead ? 0xa8b8ff : 0xfff0f6, ground: dead ? 0x303860 : 0xc8b0e0, i: dead ? 0.55 : 0.8 });
    kit.setSpot(0, { color: dead ? 0x8fb4ff : 0xffb0d8, i: 90, dist: 30, angle: 0.7, pen: 0.6, decay: 1.2, pos: [hp.x + 3.2, hp.y + 1.6, hp.z - 2.6], target: [hp.x, hp.y, hp.z] });
    kit.setPoint(0, { color: 0xfff2e6, i: dead ? 10 : 26, dist: 24, decay: 1.4, pos: [hp.x + 1.6, hp.y + 0.6, hp.z + 4.4] });
  }

  function apply() {
    const a = view.args, t = view.t;
    const who = a.who || q.get('who') || 'pip';
    const dead = who !== 'pip' && num(a.k ?? q.get('k'), 1) < 0.5, kk = dead ? 0 : 1;
    const c = get(who);
    for (const k in chars) chars[k].obj.visible = chars[k] === c;
    if (c.kind === 'zombie') c.K.value = kk;
    FRONT.uFront.value.set(0, 0.5, 0, -1); FRONT.uAlive.value = kk; FRONT.uFlicker.value = kk ? 1 : 0.97;
    scene.background = new THREE.Color(dead ? 0x141826 : 0xf6d6e6);
    back.material.color.set(dead ? 0xc9c3e6 : 0xf3c7da); floor.material.color.set(dead ? 0xc9c3e6 : 0xf7c2d8);
    const hp = c.hp, Rw = c.Rw;
    lights(hp, dead);

    let mouth = null;
    if (a.mix) mouth = parseMix(a.mix);
    else if (a.mouth && VISEMES.includes(a.mouth)) { mouth = new Float32Array(8); mouth[VISEMES.indexOf(a.mouth)] = 1; }
    else if (a.sing) { mouth = new Float32Array(8); mouth[0] = 1; }
    const seed = num(a.seed, 0.3);
    const F = { mouth, moan: num(a.moan, 0), blink: num(a.blink, 0), look: [num(a.lookx, 0), num(a.looky, 0)], brow: num(a.brow, 0), emote: a.emote || 'neutral', emoteK: num(a.emoteK, 1), t };
    if (a.auto) { F.blink = autoBlink(t, seed); F.look = autoLook(t, seed, F.look); }
    setFace(c, F);
    const r = RIGS[view.rig] || RIGS.face;
    const D = r.dist * Rw;
    cam.position.set(hp.x + Math.sin(r.az) * D, hp.y + r.up * D + r.dy * Rw, hp.z + Math.cos(r.az) * D);
    cam.lookAt(hp.x, hp.y + r.dy * Rw, hp.z); cam.fov = r.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    FRONT.uTime.value = t;
  }
  window.setT = (t) => { view.t = t; apply(); };
  window.setView = (o = {}) => { const { args, ...rest } = o; Object.assign(view, rest); view.args = { ...baseArgs, ...(args || {}) }; apply(); };
  window.__chars = chars;
  setPost(makePost(renderer, scene, cam, 'felt', W, H, { band: 0.5, tilt: 1.0, focusY: 0.5, noBokeh: true }));
  apply();
}
