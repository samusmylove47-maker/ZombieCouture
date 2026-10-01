// Motion-strip previewer for web/moves.js.
//   ?shot=preview&p=moves&act=strut&who=z2|pip&n=6&dt=0.083&k=0|1&t=0&view=front|side|top&amp=1&seed=0.37&side=1&dist=..&dur=..&seat=0.45&sp=1.2&cols=8&beat0=0
// Renders n copies of one character at t, t+dt, t+2dt ... side by side on a plain pastel floor, camera far away with a narrow lens (near-orthographic),
// so one image shows the whole motion at 12 Hz (dt = 1/12).  poseCouture shows hit 0..3 by default.  Extra keys go to the act as args (a_<key> or args.<key>).
// window.setT(t) and window.setView({t, rig: <act name>, args: {who, n, dt, view, k, ... , <act args>}}) work with tools/shootmany.py:
//   tools/rq.sh python3 -u tools/shootmany.py out/mv 960 400 "p=moves&who=z2&k=1" "strut@0" "hop@0,args.n=8" "poseCouture@0,args.n=4,args.a_n=0"
import { makePip, makeZombie } from '../cast.js';
import { makePin, makeScissors } from '../chars.js';
import { makeNeedle } from '../props.js';
import { ACTS, ACT_INFO, applyPose } from '../moves.js';

export async function run(env) {
  const { THREE, renderer, scene, M, FRONT, cam, q, W, H, makePost, makeKit, setPost } = env;
  const PI = Math.PI, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const kit = makeKit(scene, { shadow: 1024 });
  const KNOWN = new Set(['raw', 'debug', 'act', 'who', 'n', 'dt', 'view', 'k', 'amp', 'seed', 'side', 'dist', 'dspeed', 'sp', 'cols', 'dur', 'seat', 'beat0', 'label', 'rot', 'lit', 'top']);
  const num = (x) => (x !== null && x !== '' && x !== undefined && !isNaN(+x) ? +x : x);
  const fromQuery = () => { const o = { t: +(q.get('t') || 0), args: {} }; for (const [k, v] of q.entries()) if (KNOWN.has(k)) o.args[k] = num(v); return o; };
  const DEF = { rot: 0, lit: 0, act: ACTS.strut ? 'strut' : Object.keys(ACTS)[0], who: 'z2', n: 6, dt: 1 / 12, view: 'front', k: 1, amp: 1, seed: 0.37, side: 1, sp: 1.1 };
  let view = null;
  const resolve = (o) => {   // reset to the URL defaults on every call so views never leak into each other
    const base = fromQuery(); const v = { ...DEF, t: base.t, aargs: {}, beat0: 0 };
    const feed = (args) => { for (const [k, val] of Object.entries(args || {})) { if (KNOWN.has(k)) v[k] = val; else if (k.startsWith('a_')) v.aargs[k.slice(2)] = val; else v.aargs[k] = val; } };
    feed(base.args);
    if (o) { if (o.t != null) v.t = +o.t; if (o.rig && ACTS[o.rig]) v.act = o.rig; if (o.dur != null) v.dur = +o.dur; if (o.beat0 != null) v.beat0 = +o.beat0; feed(o.args); }
    v.n = Math.max(1, Math.min(24, Math.round(+v.n))); v.k = +v.k;
    return v;
  };

  // ---- stage
  const floorMat = M.matte(0xf3c7da, { rep: 200 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), floorMat); floor.rotation.x = -PI / 2; floor.receiveShadow = true; floor.position.y = -0.005; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), M.matte(0xe9d6fb, { rep: 200 })); wall.position.set(0, 30, -3.4); scene.add(wall);
  scene.fog = null; scene.background = new THREE.Color(0xf6d6e6);
  const stage = new THREE.Group(); scene.add(stage);      // planks (extra rows), stools
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x552244, transparent: true, opacity: 0.22, depthWrite: false });
  const blobGeo = new THREE.CircleGeometry(0.42, 24);

  // ---- characters and props
  const pool = {};   // who -> [char]
  const getChar = (who, i) => {
    const list = pool[who] ||= [];
    while (list.length <= i) {
      const c = who === 'pip' ? makePip(M) : makeZombie(M, +who.slice(1) || 0);
      scene.add(c.obj); c.props = {}; c.blob = new THREE.Mesh(blobGeo, blobMat); c.blob.rotation.x = -PI / 2; scene.add(c.blob); list.push(c);
    }
    return list[i];
  };
  const mkProp = (kind) => {
    const prev = M.currentK; M.currentK = { value: 1 };
    let g;
    if (kind === 'cup') { g = new THREE.Group(); const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.08, 20, 1, true), M.plastic(0xffffff)); cup.position.y = 0.04; g.add(cup); const h = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14, PI), M.plastic(0xffffff)); h.position.set(0.06, 0.04, 0); h.rotation.z = -PI / 2; g.add(h); g.rotation.x = PI; g.position.set(0, -0.26, 0.02); }
    else if (kind === 'scissors') { g = makeScissors(M); g.scale.setScalar(0.8); g.position.set(0, -0.24, 0); g.rotation.set(-PI / 2, PI / 2, 0.15); }
    else if (kind === 'pin') { g = makePin(M, 0xff2f86); g.scale.setScalar(1.6); g.position.set(0, -0.24, 0); g.rotation.set(-PI / 2, 0, 0); }
    else if (kind === 'needle') { g = makeNeedle(M, 0.6); g.position.set(0, -0.235, 0); g.rotation.set(-1.15, 0, 0); }
    else if (kind === 'scrap') { g = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.22, 1, 1), M.cloth(0xffe066, { rep: 4 })); g.position.set(0.0, -0.31, 0.03); g.rotation.set(0.1, 0, 0.1); }
    else { g = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.plastic(0x33ccff)); g.position.set(0, -0.26, 0); }
    M.currentK = prev; return g;
  };
  const setProp = (c, hand, kind) => {   // hand: 'handL' | 'handR'
    const J = c.obj.userData.J, parent = hand === 'handL' ? J.elL : J.elR;
    c.props[hand] ||= {};
    for (const [k, m] of Object.entries(c.props[hand])) m.visible = k === kind;
    if (kind && !c.props[hand][kind]) { const m = mkProp(kind); parent.add(m); c.props[hand][kind] = m; }
  };

  // ---- pose everything
  const seatOf = (v) => v.seat != null ? +v.seat : (ACT_INFO[v.act]?.g === 'seated' ? 0.45 : 0);
  function setT(t) {
    const v = view; v.t = t;
    const info = ACT_INFO[v.act]; if (!info) throw new Error(`unknown act "${v.act}"`);
    const cols = Math.min(v.n, +(v.cols || 8)), rows = Math.ceil(v.n / cols), sp = +v.sp, rowH = v.view === 'top' ? 1.7 : 2.6;
    const side = v.view === 'side';
    const dur = v.dur != null ? +v.dur : (info.dur ?? Infinity);
    FRONT.uAlive.value = (v.k > 0.5 || +v.lit) ? 1 : 0; FRONT.uFront.value.set(0, 0.5, 0, -1); FRONT.uFlicker.value = v.k > 0.5 ? 1 : 0.97; FRONT.uTime.value = t;
    const seat = seatOf(v);
    while (stage.children.length) stage.remove(stage.children[0]);
    for (const list of Object.values(pool)) for (const c of list) { c.obj.visible = false; c.blob.visible = false; }
    // rows: front/side stack downward with a plank floor each; top view stacks in depth
    floor.visible = rows < 2 || v.view === 'top';
    for (let r = rows < 2 ? 1 : 0; r < rows; r++) if (v.view !== 'top') { const pl = new THREE.Mesh(new THREE.BoxGeometry(cols * sp + 1.6, 0.05, 2.4), M.matte(0xf3c7da, { rep: 200 })); pl.position.set(0, -r * rowH - 0.03, 0); stage.add(pl); }
    for (let i = 0; i < v.n; i++) {
      const c = getChar(v.who, i), col = i % cols, row = Math.floor(i / cols), ti = t + i * v.dt;
      const beat = ti * 130 / 60 + (v.beat0 || 0), args = { ...v.aargs };
      if (v.dist != null) args.dist = +v.dist + (+v.dspeed || 0) * ti;
      if (v.act === 'poseCouture' && args.n == null) args.n = i;
      const P = ACTS[v.act]({ t: ti, tp: ti, dur, k: clamp(ti / dur), beat, phase: ((beat % 4) + 4) % 4, pulse: Math.exp(-(((beat % 1) + 1) % 1) * 5), seed: +v.seed, amp: +v.amp, side: +v.side, args });
      if (c.kind === 'zombie') c.K.value = v.k;
      const x = (col - (cols - 1) / 2) * sp, y = v.view === 'top' ? 0 : -row * rowH, z = v.view === 'top' ? row * rowH : 0;
      applyPose(c, { x, y: y + seat, z, rotY: side ? PI / 2 : (+v.rot || 0) * PI / 180 }, P);
      c.obj.visible = true; c.blob.visible = seat === 0; c.blob.position.set(x, y + 0.004, z);
      setProp(c, 'handL', P.attach?.handL || null); setProp(c, 'handR', P.attach?.handR || null);
      if (seat > 0) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, seat, 20), M.matte(0xd9a7ff, { rep: 20 })); st.position.set(x, y + seat / 2, z); stage.add(st); }
    }
    // camera: far away, narrow lens, framed on the strip
    const aspect = W / H, cw = (cols - 1) * sp + 2.0, D = 26, rise = 3.2;      // 7 degrees above the floor: a grazing camera turns the bumped floor to NaN (black frame)
    const cx = 0, gridH = rows * rowH;
    if (v.view === 'top') {
      const ch = (rows - 1) * rowH + 1.8, half = Math.max(ch / 2, cw / (2 * aspect)), cz = (rows - 1) * rowH / 2;
      cam.position.set(cx, D, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.fov = 2 * Math.atan(half / D) * 180 / PI;
    } else {
      const top = v.top != null ? +v.top : 2.15, bot = -(rows - 1) * rowH - 0.15, cy = (top + bot) / 2, half = Math.max((top - bot) / 2, cw / (2 * aspect));
      cam.up.set(0, 1, 0); cam.position.set(cx, cy + rise, D); cam.lookAt(cx, cy, 0); cam.fov = 2 * Math.atan(half / Math.hypot(D, rise)) * 180 / PI;
    }
    cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    if (v.debug) console.warn('moves-dbg', JSON.stringify({ cam: cam.position.toArray(), fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far, kids: scene.children.length, W, H }));
    // light
    kit.off();
    kit.setKey({ pos: [-4, 8, 12], target: [0, 1, 0], color: 0xffe9d2, i: (v.k > 0.5 || +v.lit) ? 2.2 : 1.4, extent: 10, shadow: false });
    kit.setHemi({ sky: (v.k > 0.5 || +v.lit) ? 0xfff0f6 : 0xc8d0ff, ground: (v.k > 0.5 || +v.lit) ? 0xc8b0e0 : 0x384070, i: (v.k > 0.5 || +v.lit) ? 0.95 : 0.7 });
    kit.setPoint(0, { color: 0xfff2e6, i: 30, dist: 40, decay: 1.2, pos: [3, 4, 12] });
  }
  window.setT = setT;
  window.setView = (o = {}) => { view = resolve(o); setT(view.t); };
  view = resolve(null);
  const post = makePost(renderer, scene, cam, 'felt', W, H, { band: 2, tilt: 0, focusY: 0.5, noBokeh: true });
  post.grade.uniforms.vig.value = 0; post.grade.uniforms.grain.value = 0.012;
  // args.raw=1 renders straight to the canvas (no composer): a way to tell scene problems from post problems
  setPost({ grade: post.grade, composer: { render: () => { if (view.raw) renderer.render(scene, cam); else post.composer.render(); } } });
  setT(view.t);
}
