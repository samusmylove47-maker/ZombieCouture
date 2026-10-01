// Shot templates: TEMPLATES[name] = (F) => frame.  A template is a PURE function of F (the per-frame helper object built by film.js):
// no Math.random, no clocks, no state.  It says which set is visible, which camera rig, who stands where doing which act, which light,
// what text / thread / props appear.  The full contract, every frame field and a worked example are in docs/FILM_RUNTIME.md.
//
// Written here: intro, verse1, prechorus1, chorus1 (docs/SHOTLIST.md).  Every camera has a fallback built from mall anchors so a missing
// set module never breaks a shot (film.js stubs missing sets and logs them to window.__warn).
import { ZV } from '../cast.js';
import { clamp, lerp, smooth, smoother, hash, easeOut } from '../util.js';

export const PI = Math.PI, TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------- tables the film builds ONCE at load
// crowd homes as [radial, lateral] from the hub (metres along / across the front's axis); zombie i stands at CROWD16[i] unless a template says otherwise
export const CROWD16 = [[2.6, -1.9], [3.4, 1.7], [4.6, -3.2], [5.2, 2.6], [6.4, -1.2], [7.1, 3.9], [7.8, -4.6], [8.6, 0.9], [9.4, -2.7], [10.3, 2.2], [11.0, -5.2], [11.9, 4.6], [12.8, -1.5], [13.6, 1.4], [14.5, -3.9], [15.4, 3.2]];
export const TEXT_SPECS = {
  title: { kind: 'title' },
  // verse 2 gag: the zombie's moan, embroidered, then unpicked and replaced by the word they meant (both share one placement)
  braaains: { text: 'braaains', style: 'thread', color: 0x6fc453, color2: 0x3d2b4f, size: 0.5 },
  pride: { text: 'pride', style: 'thread', color: 0xff5fa8, color2: 0xfff4e0, size: 0.56, flourish: true },
};
export const THREAD_SPECS = {
  run: { segments: 120, radius: 0.02, color: 0xff5fa8, glow: 0.6 },        // the pre-chorus thread pulled across the floor
  sew: { segments: 64, radius: 0.016, color: 0xff5fa8, glow: 0.6 },         // short threads (Pip's sewing hand)
  lift: { segments: 480, radius: 0.015, color: 0xff5fa8, glow: 0.85, helix: 0.07, helixTurns: 14, helixSpeed: 1.4 },     // the thread of light that rises from Pip's needle through the skylight (threadLift, skyReveal): a lazy 9 cm spiral
};
export const PROP_SPECS = {                                                  // hero props built with gags.js (`make` = export name); stand-in plane when gags.js is absent
  scrap0: { make: 'makeScrap', args: [0xffb6d5, { w: 0.5, h: 0.6 }], color: 0xffb6d5 },
  scrap1: { make: 'makeScrap', args: [0xc9b6ff, { w: 0.5, h: 0.6 }], color: 0xc9b6ff },
  scrap2: { make: 'makeScrap', args: [0xfff0a6, { w: 0.5, h: 0.6 }], color: 0xfff0a6 },
};

// ---------------------------------------------------------------------------------------------------- small helpers (pure)
export const cam = (pos, look, fov = 36, extra) => ({ pos, look, fov, ...extra });
export const headY = (id) => 1.4 * (ZV[+String(id).slice(1) % ZV.length]?.height ?? 1);          // head centre of zombie 'zN' (Pip: 'pip' -> 1.4)
export const headOf = (who, at) => [at.x, (at.y || 0) + (who === 'pip' ? 1.45 : headY(who)), at.z];
// unit vectors of a character at `at` facing rotY: forward f and the SCREEN-right r of a camera that looks back at the character
export const fwd = (at) => [Math.sin(at.rotY), Math.cos(at.rotY)];
export const rgt = (at) => [Math.cos(at.rotY), -Math.sin(at.rotY)];
// a camera in front of a character: dist metres ahead of it, side metres to the screen-right, at height h, looking at its head (+ lookDy)
export function faceCam(who, at, o = {}) {
  const hd = headOf(who, at), d = o.dist ?? 1.4, s = o.side ?? 0.4;
  const sw = { ...at, rotY: at.rotY + (o.ang ?? 0) };                 // ang swings the camera round the character (0 = straight ahead of her)
  const f = fwd(sw), r = rgt(sw);
  return { pos: [at.x + f[0] * d + r[0] * s, o.h ?? hd[1] + 0.02, at.z + f[1] * d + r[1] * s], look: [hd[0] + r[0] * (o.lookSide ?? 0), hd[1] + (o.lookDy ?? 0), hd[2] + r[1] * (o.lookSide ?? 0)], fov: o.fov ?? 26 };
}
export const faceAt = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
// shove a camera toward its look point (a "kick" on a downbeat)
export const kick = (r, m) => { const d = [r.look[0] - r.pos[0], r.look[1] - r.pos[1], r.look[2] - r.pos[2]], L = Math.hypot(...d) || 1; return { ...r, pos: [r.pos[0] + d[0] / L * m, r.pos[1] + d[1] / L * m, r.pos[2] + d[2] / L * m] }; };
// a dead zombie drifting toward the machine's lamp: continuous in SONG time so the crowd does not jump between shots
export function drifter(F, rad, lat, speed = 0.25, stop = 2.4) {
  const p = F.at(rad, lat), dx = F.O.x - p.x, dz = F.O.z - p.z, L = Math.hypot(dx, dz), d = Math.max(0, Math.min(speed * F.tp, L - stop));
  return { x: p.x + dx / L * d, y: 0, z: p.z + dz / L * d, rotY: Math.atan2(dx, dz) + 0.1 * Math.sin(rad), dist: d };
}
export const deadEntry = (F, who, home, rad, lat, o = {}) => ({ who, at: drifter(F, rad, lat, o.speed), act: o.act ?? 'deadShamble', args: { dist: drifter(F, rad, lat, o.speed).dist }, k: 0, seed: hash(home * 3.31 + 0.7), amp: o.amp });
export const machineSlot = (F) => F.slot('mall.machine', () => F.at(1.05, 0.55, 0));
// Pip standing behind the barricade (door slot 'inside'); without the door module she stands at the machine
export const insideSlot = (F) => F.slot('mall_door.inside', () => machineSlot(F));
// stand-ins for the door module's slots (used only while mall_door.js is missing): a crowd out front, a doorway
export const fbGlass = (F, i) => () => F.at(5.6, (i - 2.5) * 1.05, 0, F.O);
export const fbOutside = (F, i) => () => F.at(7.5 + (i % 3) * 1.1, (i - 3.5) * 1.15, 0, F.O);
export const fbDoorway = (F) => () => F.at(4.3, 0.4, 0, F.O);
export const eyeLine = (F) => ({ x: F.O.x, z: F.O.z });

// ---------------------------------------------------------------------------------------------------- TEMPLATES
export const TEMPLATES = {};

// A shot the film cannot find a template for: the dead mall from the far end, nothing else
TEMPLATES.__missing = (F) => ({ set: 'mall', rig: 'mall.wideDead', light: 'mall', cast: [] });

// ======================================================================================= INTRO (instrumental; the dead mall; Pip is the only colour)

// deadWide (A): the far end of the mall, 1.9 m high, slow dolly in over u.p.  Cold flicker (two hard stutters at the start), dust in the shafts,
// six dead zombies drifting toward the light at 0.25 m/s, Pip tiny at the machine in her lamp pool.
TEMPLATES.deadWide = (F) => {
  const p = smooth(F.p);
  const c = F.at(lerp(23, 19.5, p), lerp(6.2, 4.4, p)), l = F.at(1.6, 0.4);
  const homes = [[13.5, -3.2], [11.5, 5.4], [9.5, -4.4], [17.5, 3.2], [8.2, 3.8], [12.4, -0.8]];              // none on the sight line to Pip, none on the pedestal (14.4, 0.7)
  return {
    set: 'mall', rig: () => cam([c.x, lerp(1.9, 1.5, p), c.z], [l.x, 1.25, l.z], 30),
    light: 'mall', flicker: F.flicker('stutter'), args: { needle: 0 },
    cast: [
      F.cast('pip', machineSlot(F), 'pipIdle', { amp: 0.6 }),
      ...homes.map(([r, la], i) => deadEntry(F, 'z' + i, i, r, la)),
    ],
  };
};

// deadPush (A): 0.9 m high, tracking forward between the pillars toward the barricade; dead legs shuffling past at the edge of frame.
TEMPLATES.deadPush = (F) => {
  const p = smooth(F.p);
  const c = F.at(lerp(17, 7.5, p), lerp(1.2, 0.5, p)), l = F.at(lerp(2.0, -1.0, p), lerp(0.0, 0.3, p));
  return {
    set: 'mall', rig: () => cam([c.x, 0.9, c.z], [l.x, 1.05, l.z], 42), light: 'mall', flicker: F.flicker('dead'),
    args: { needle: 0 },
    cast: [
      F.cast('pip', machineSlot(F), 'pipIdle', { amp: 0.6 }),
      deadEntry(F, 'z0', 0, 9.5, -1.7, { speed: 0.3 }), deadEntry(F, 'z1', 1, 11.5, 1.9, { speed: 0.26 }),
      deadEntry(F, 'z2', 2, 14.0, -0.6, { speed: 0.28 }), deadEntry(F, 'z3', 3, 8.2, 2.3, { speed: 0.3 }),
      deadEntry(F, 'z4', 4, 6.4, -2.5, { speed: 0.24 }), deadEntry(F, 'z5', 5, 17.0, 2.6, { speed: 0.27 }),
    ],
  };
};

// hubIdle (A): machine_macro on the idle machine in its lamp pool, needle up, slow rack from the foreground spool to the needle.
TEMPLATES.hubIdle = (F) => ({
  set: 'mall', ext: ['machine_macro'], light: 'machine_macro', flicker: F.flicker('dead'), args: { needle: 0, lamp: 1 },
  rig: F.rig('machine_macro.threadPath', (u) => {                         // fallback: a close three-quarter macro that drifts up toward the needle
    const p = smooth(u.p), c = F.at(lerp(1.9, 1.5, p), lerp(1.3, 0.9, p));
    return cam([c.x, lerp(1.25, 1.5, p), c.z], [F.O.x, lerp(1.05, 1.35, p), F.O.z], 30);
  }),
  post: { band: 0.16, tilt: 3.2, focusY: lerp(0.4, 0.55, smooth(F.p)) },
  cast: [F.cast('pip', machineSlot(F), 'pipIdle', { amp: 0.5 })],
});

// pipBack (A): over Pip's shoulder at the barricade, slow push toward the dead mall; the only colour in frame; a tiny breathing bob.
TEMPLATES.pipBack = (F) => {
  const p = smooth(F.p);
  const pipAt = F.at(2.6, 0.45, 0), ax = { x: pipAt.x, y: 0, z: pipAt.z, rotY: Math.atan2(F.ax.x, F.ax.z) - 0.15 };
  const c = F.at(lerp(0.55, 1.0, p), 1.8), l = F.at(14, -0.7);
  return {
    set: 'mall', light: 'mall', flicker: F.flicker('dead'), args: { needle: 0 },
    rig: () => cam([c.x, lerp(1.62, 1.5, p), c.z], [l.x, 1.15, l.z], 46),
    cast: [
      F.cast('pip', ax, 'pipIdle', { amp: 0.7 }),
      deadEntry(F, 'z0', 0, 12, -2.5), deadEntry(F, 'z1', 1, 14.5, 2.0), deadEntry(F, 'z2', 2, 17, -0.4), deadEntry(F, 'z3', 3, 10, 3.6), deadEntry(F, 'z4', 4, 19, -3.6),
    ],
  };
};

// ======================================================================================= VERSE 1 (soft, eerie; dead)

// barricadeWide (B): from OUTSIDE the glass door looking in at the barricade; Pip peeks over the top; zombie silhouettes at the frame edges.
TEMPLATES.barricadeWide = (F) => {
  const p = smooth(F.p), inside = insideSlot(F);
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 0 },
    rig: F.rig('mall_door.outsideIn', () => { const c = F.at(lerp(8.5, 7.0, p), 3.4); return cam([c.x, 1.6, c.z], [F.O.x, 1.4, F.O.z], 36); }),
    cast: [
      F.cast('pip', inside, 'pipListen', {}),
      F.cast('z0', 'mall_door.glass0', 'deadPressGlass', { fallbackSlot: fbGlass(F, 0), seed: 0.2, moan: true }),
      F.cast('z1', 'mall_door.glass4', 'deadPressGlass', { fallbackSlot: fbGlass(F, 4), seed: 0.7, moan: true }),
      F.cast('z2', 'mall_door.outside2', 'deadStand', { fallbackSlot: fbOutside(F, 2), seed: 0.4 }),
    ],
  };
};

// beansCU (A): macro on the last can of beans on the barricade, the "LAST ONE" note, Pip's spoon dips in; focus racks to her eye behind.
TEMPLATES.beansCU = (F) => {
  const p = F.p, pipAt = machineSlot(F);
  return {
    set: 'mall', ext: ['machine_macro'], light: 'machine_macro', flicker: F.flicker('dead'), args: { needle: 0, beans: p, spoon: p },
    rig: F.rig('machine_macro.beansCU', () => { const c = F.at(2.2, 0.9); return cam([c.x, 1.45, c.z], [F.O.x - 0.9, 1.25, F.O.z + 0.5], 26); }),
    post: { band: 0.1, tilt: 3.4, focusY: lerp(0.36, 0.6, smooth((p - 0.35) / 0.5)) },
    cast: [F.cast('pip', pipAt, 'pipListen', { face: { emote: 'worried' } })],
  };
};

// pipListen (A): Pip's face, three-quarter close; she turns her head toward a noise; worried.
// The camera must stay within 2.74 m of her: beyond that (the first half of the old 3.0 -> 2.5 push) it sat on the far side of the door module's dark
// wall, which filled the right of the frame and vanished in one frame when the camera crossed it (a pop at 13.71 s in the first master pass).
TEMPLATES.pipListen = (F) => {
  const p = smooth(F.p), s = insideSlot(F);
  const at = { x: s.x, y: 0, z: s.z, rotY: faceAt(s, F.at(6, -1.0)) };
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 0 },
    rig: () => faceCam('pip', at, { dist: lerp(2.68, 2.42, p), side: 0.1, ang: 0.95, fov: 26 }),
    post: { band: 0.2, tilt: 3.0, focusY: 0.52 },
    cast: [F.cast('pip', at, 'pipListen', { face: { emote: 'worried', emoteK: 1 } })],
  };
};

// groanGlass (B): from inside, grey faces and palms pressed on the pane, mouths in a slow moan.
TEMPLATES.groanGlass = (F) => ({
  set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 0 },
  rig: F.rig('mall_door.glassCU', () => { const s = F.slot('mall_door.glass1', fbGlass(F, 1)); const c = F.at(3.9, 0.0); return cam([c.x, 1.3, c.z], [s.x, 1.25, s.z], 34); }),
  cast: [0, 1, 2, 3, 4].map((i) => F.cast('z' + [0, 3, 1, 5, 2][i], 'mall_door.glass' + i, 'deadPressGlass', { fallbackSlot: fbGlass(F, i), seed: hash(i * 2.1), moan: true, look: 'cam', lookAmt: 0.3, face: { emote: 'moan', emoteK: 1 } })),
});

// scratchCU (A): extreme close-up on hands scratching down the glass.
TEMPLATES.scratchCU = (F) => ({
  set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 0 },
  rig: F.rig('mall_door.scratchCU', () => { const s = F.slot('mall_door.glass2', fbGlass(F, 2)); const c = F.at(4.2, 0.1); return cam([c.x, 1.05, c.z], [s.x, 1.05, s.z], 24); }),
  cast: [1, 2, 3].map((i) => F.cast('z' + i, 'mall_door.glass' + i, 'deadScratch', { fallbackSlot: fbGlass(F, i), seed: hash(i * 4.4) })),
});

// cloudyEyes (A): extreme close-up of one zombie's clouded eye; a slow blink of the heavy lid.
TEMPLATES.cloudyEyes = (F) => {
  const p = smooth(F.p), who = 'z3', s = F.slot('mall_door.outside1', fbOutside(F, 1)), A = F.args;
  const at = { x: s.x, y: 0, z: s.z, rotY: s.rotY + PI };                              // turned away from the shopfront, toward the camera; the door is the blurred background
  const r = faceCam(who, at, { dist: lerp(0.95, 0.72, p) * (A.dscale ?? 1.3), side: A.side ?? 0.14, lookSide: A.lookSide ?? 0.1, lookDy: A.lookDy ?? 0.15, fov: A.fov ?? 26, ang: A.ang ?? 0, h: A.h ?? 1.2 });
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 0 },
    rig: () => r, post: { band: 0.1, tilt: 3.0, focusY: 0.5 },
    cast: [F.cast(who, at, A.act ?? 'deadLookUp', { seed: 0.33, face: { emote: 'sleepy', emoteK: 0.6 }, k: 0 })],
  };
};

// doorOpenPip (B): over Pip's shoulder as she unlatches and the door swings inward (args.door 0..1 over the shot); the bell rings.
TEMPLATES.doorOpenPip = (F) => {
  const p = F.p, s = F.slot('mall_door.latch', () => insideSlot(F));
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: smooth((p - 0.5) / 0.4) },
    rig: F.rig('mall_door.doorWide', () => { const c = F.at(lerp(0.9, 1.3, p), 0.9); const l = F.slot('mall_door.doorway', fbDoorway(F)); return cam([c.x, 1.55, c.z], [l.x, 1.3, l.z], 40); }),
    cast: [
      F.cast('pip', s, 'pipOpenDoor', { dur: F.dur }),
      F.cast('z4', 'mall_door.outside1', 'deadStand', { fallbackSlot: fbOutside(F, 1), seed: 0.1 }),
      F.cast('z5', 'mall_door.outside4', 'deadStand', { fallbackSlot: fbOutside(F, 4), seed: 0.8 }),
    ],
  };
};

// noBite (B): medium in the doorway.  A zombie leans toward Pip with its mouth open, freezes, closes the mouth, straightens, tips its hat.
// Pip flinches, then relaxes.  The joke lands on "they didn't bite".
// Camera (second version): over the ZOMBIE's shoulder from the concourse, off to one side of the doorway (the first version stood behind Pip, whose huge head
// hid the zombie's lean and its hat tip, and nobody saw a face).  From here the lean reads as a silhouette, Pip's gasp shows before it and her relief after it;
// at the peak of the lean the zombie's own head covers her face for about a second, which is the tension before the joke.  Side views from inside the shop are
// blocked by its wall.  Args (cf/cr: metres into the shop / to the left of the door for the camera, lf/lr: the same for the look-at point, ch, ly0/ly1, fov0/fov1).
TEMPLATES.noBite = (F) => {
  const p = smooth(F.p), door = F.slot('mall_door.doorway', fbDoorway(F)), f = fwd(door), r = rgt(door);           // door.rotY looks INTO the mall (toward Pip's side)
  const zAt = { x: door.x, y: 0, z: door.z, rotY: door.rotY };
  const pAt = { x: door.x + f[0] * 0.9, y: 0, z: door.z + f[1] * 0.9, rotY: door.rotY + PI };                    // Pip a step inside the door, facing the zombie
  const A = F.args, cf = A.cf ?? -1.8, cr = A.cr ?? -1.7, lf = A.lf ?? 0.6, lr = A.lr ?? 0;
  const cx = door.x + f[0] * cf - r[0] * cr, cz = door.z + f[1] * cf - r[1] * cr;
  const lk = [door.x + f[0] * lf - r[0] * lr, lerp(A.ly0 ?? 1.15, A.ly1 ?? 1.15, p), door.z + f[1] * lf - r[1] * lr];
  const tSwitch = Math.min(0.55 * F.dur, 2.4);
  // Third version: from the word "bite." on (the mouth snaps shut as the word starts) the picture cuts to the zombie's FACE from inside the shop, off to one
  // side, and Pip steps half a metre aside across the cut (pdx) so that her huge head is not in the line: the shy glance, the smug face, the hat tip.  Seen from
  // behind (the camera above) the tipping arm crossed Pip's eye.  Frames before the cut are exactly the second version.
  // Args bf/br (camera metres into the shop / to the left), blf/blr (look-at), bh, bly, bfov, tcut (s), pdx (Pip's step, metres to the right of the door).
  const tCut = A.tcut ?? 0.5767 * F.dur, bf = A.bf ?? 2.0, br = A.br ?? -1.3, blf = A.blf ?? 0, blr = A.blr ?? 0;
  const bx = door.x + f[0] * bf - r[0] * br, bz = door.z + f[1] * bf - r[1] * br;
  const bk = [door.x + f[0] * blf - r[0] * blr, A.bly ?? 1.3, door.z + f[1] * blf - r[1] * blr];
  const pCut = { ...pAt, x: pAt.x + r[0] * (A.pdx ?? -0.5), z: pAt.z + r[1] * (A.pdx ?? -0.5) };                      // across the cut Pip may step aside (a cheat: nobody sees it)
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 1 },
    rig: () => (F.u.t < tCut ? cam([cx, A.ch ?? 1.15, cz], lk, A.fov ?? lerp(A.fov0 ?? 34, A.fov1 ?? 31, p)) : cam([bx, A.bh ?? 1.3, bz], bk, A.bfov ?? 28)),
    cast: [
      F.cast('z0', zAt, 'deadNoBite', { dur: Math.min(F.dur, 4.5), moan: false }),
      F.u.t < tSwitch ? F.cast('pip', pAt, 'pipFlinch', { dur: tSwitch, face: { emote: 'gasp', emoteK: 1 } }) : F.cast('pip', F.u.t < tCut ? pAt : pCut, 'pipRelieved', { t0: tSwitch, face: { emote: 'shy', emoteK: 0.8 } }),
      F.cast('z6', 'mall_door.outside3', 'deadStand', { fallbackSlot: fbOutside(F, 3), seed: 0.6 }),
    ],
  };
};

// pipReact (A): Pip, relieved and puzzled; a nervous little smile.  (Optional shot that fills a long verse tail.)
TEMPLATES.pipReact = (F) => {
  const p = smooth(F.p), s = insideSlot(F), A = F.args;
  const at = { x: s.x, y: 0, z: s.z, rotY: faceAt(s, F.at(5, 1.5)) };
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 1 },
    rig: () => faceCam('pip', at, { dist: lerp(3.2, 2.7, p) * (A.dscale ?? 0.85), side: A.side ?? 0.1, ang: A.ang ?? -1.6, fov: A.fov ?? 27 }), post: { band: 0.2, tilt: 3.0 },
    cast: [F.cast('pip', at, 'pipRelieved', { face: { emote: p < 0.5 ? 'worried' : 'shy', emoteK: p < 0.5 ? 0.5 : 0.9 } })],
  };
};

// ======================================================================================= PRE-CHORUS 1 (rising hope; still dead, the thread begins)

// staringCrowd (B): the crowd standing silently in the open doorway, staring; Pip steps back; nearly still; dust.
TEMPLATES.staringCrowd = (F) => {
  const p = smooth(F.p);
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 1 },
    rig: F.rig('mall_door.staring', () => { const c = F.at(lerp(2.6, 2.1, p), 1.0); const l = F.slot('mall_door.doorway', fbDoorway(F)); return cam([c.x, 1.35, c.z], [l.x, 1.2, l.z], 36); }),
    cast: [
      F.cast('pip', insideSlot(F), 'pipFlinch', { dur: 1.2, amp: 0.4, face: { emote: 'worried', emoteK: 0.7 } }),
      F.cast('z0', 'mall_door.doorway', 'deadStand', { fallbackSlot: fbDoorway(F), seed: 0.1, look: 'cam', lookAmt: 0.9 }),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => F.cast('z' + (i + 1), 'mall_door.outside' + i, 'deadStand', { fallbackSlot: fbOutside(F, i), seed: hash(i + 0.5), look: 'cam', lookAmt: 0.8 })),
    ],
  };
};

// holdScraps (B): three zombies hold up scraps of fabric hopefully; the cut lands on "Can you help us look cute".
TEMPLATES.holdScraps = (F) => {
  const p = smooth(F.p);
  const who = [['z1', 'mall_door.outside1', 1], ['z4', 'mall_door.doorway', -1], ['z6', 'mall_door.outside4', 0]];
  const ent = who.map(([id, slot], i) => F.cast(id, slot, 'deadHoldUp', { fallbackSlot: i === 1 ? fbDoorway(F) : fbOutside(F, i === 0 ? 1 : 4), seed: 0.15 + i * 0.3, look: 'cam', lookAmt: 0.8, t0: i * 0.12 }));
  const c = F.at(lerp(1.9, 1.5, p), 0.6), l = F.at(5, 0.3);
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door', flicker: F.flicker('dead'), args: { door: 1 },
    rig: () => cam([c.x, 1.3, c.z], [l.x, 1.05, l.z], 40),
    cast: [...ent, F.cast('pip', insideSlot(F), 'pipListen', { amp: 0.5, face: { emote: 'awe', emoteK: 0.6 } })],
    props: ent.map((e, i) => ({ id: 'scrap' + i, attach: { who: e.who, joint: 'elR', pos: [0, -0.26, 0.03], rot: [-0.3, 0, 0] } })),
  };
};

// pipDecides (A): Pip's face; she looks at the machine; the lamp glints in her eyes; the worried look turns into a slow smile.
TEMPLATES.pipDecides = (F) => {
  const p = F.p, s = machineSlot(F);
  const at = { x: s.x, y: 0, z: s.z, rotY: faceAt(s, F.at(3.2, -0.6)) };
  const k1 = 1 - smooth((p - 0.2) / 0.25), k2 = smooth((p - 0.45) / 0.3);
  return {
    set: 'mall', ext: ['machine_macro'], light: 'machine_macro', flicker: F.flicker('dead'), args: { needle: 0, lamp: 1 },
    rig: () => faceCam('pip', at, { dist: lerp(3.2, 2.6, smooth(p)), side: 0.4, fov: 25 }), post: { band: 0.2, tilt: 3.0, focusY: 0.55 },
    cast: [F.cast('pip', at, 'pipIdle', { amp: 0.6, args: { mood: 'nervous' }, look: { x: F.O.x, z: F.O.z }, lookAmt: 0.5 + 0.4 * smooth(p * 1.6), face: p < 0.45 ? { emote: 'worried', emoteK: k1 } : { emote: 'proud', emoteK: k2 } })],
  };
};

// threadRun (B): low tracking shot following the pink thread as it is pulled out of the machine across the floor toward the crowd; the first
// tiny ring of colour at the hub (the front's R creeps); the zombies stop and turn to look.
TEMPLATES.threadRun = (F) => {
  const p = smooth(F.p), reveal = clamp(0.03 + p * 0.97);
  const spool = [F.O.x + 0.02, (F.O.y || 0.99) + 0.8, F.O.z];
  const pts = [spool, [spool[0] + 0.15, 0.5, spool[2] + 0.4]];
  for (let i = 0; i < 12; i++) { const rad = 1.2 + i * 0.85, lat = Math.sin(i * 1.25) * 0.55; const a = F.at(rad, lat); pts.push([a.x, 0.035, a.z]); }
  // the tip position along the curve is only needed for the camera: sample the same polyline (Catmull-Rom would differ by a few cm)
  const tipIdx = clamp(reveal, 0, 1) * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(tipIdx)), kk = tipIdx - i0;
  const tip = pts[i0].map((v, j) => lerp(v, pts[i0 + 1][j], kk));
  const tipRad = (tip[0] - F.O.x) * F.ax.x + (tip[2] - F.O.z) * F.ax.z, camRad = Math.max(0.9, tipRad - 2.6);
  const cx = F.at(camRad, 1.7);
  const crowd = [0, 2, 4, 6, 8, 10].map((i) => {
    const [rad, lat] = CROWD16[i], sees = F.u.t > (i * 0.13 + 0.4);
    return F.cast('z' + i, F.at(rad + 3.0, lat, 0, sees ? { x: tip[0], z: tip[2] } : F.O), sees ? 'deadStand' : 'deadShamble', { k: 0, seed: hash(i * 1.7), look: sees ? { x: tip[0], z: tip[2] } : undefined, lookAmt: 0.9, args: { dist: 0 } });
  });
  return {
    set: 'mall', ext: ['machine_macro'], light: 'mall', flicker: F.flicker('dead'), args: { needle: 0 },
    rig: () => cam([cx.x, 0.42, cx.z], [tip[0], 0.25, tip[2]], 44),
    threads: [{ id: 'run', pts, reveal }],
    cast: [F.cast('pip', machineSlot(F), 'pipThread', { amp: 0.7 }), ...crowd],
  };
};

// needleReady (B): slow push-in on the raised needle (machine_macro.machinePush); ends exactly at its top position on the last frame,
// the next shot (burst) opens with the needle dropping.
TEMPLATES.needleReady = (F) => ({
  set: 'mall', ext: ['machine_macro'], light: 'machine_macro', flicker: F.flicker('dead'), args: { needle: 0, lamp: 1 },
  rig: F.rig('machine_macro.machinePush', (u) => { const p = smooth(u.p), c = F.at(lerp(4.2, 1.1, p), lerp(1.4, 0.35, p)); return cam([c.x, lerp(1.7, 1.55, p), c.z], [F.O.x - 0.35, lerp(1.2, 1.45, p), F.O.z], lerp(36, 24, p)); }),
  post: { band: 0.14, tilt: 3.4, focusY: 0.5 },
  cast: [(() => { const s = insideSlot(F); return F.cast('pip', { x: s.x, y: 0, z: s.z, rotY: faceAt(s, F.O) }, 'pipSew', { amp: 0.15 }); })()],       // behind the machine: the push-in starts where she would stand in front of it
});

// ======================================================================================= CHORUS 1 (the front detonates; the mall is made over)

// the crowd used by most chorus-1 shots: zombie i at its home, made over by the front as it passes (act 'crowd' does dead -> hop -> bop)
export const crowdIds = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
export const chorusPip = (F, act = 'pipSew', o = {}) => F.cast('pip', machineSlot(F), act, { sing: true, ...o });

// burst (B, fix 4 beats): low next to the machine looking out at the dead mall; on the downbeat the needle drops, the front detonates outward,
// confetti pops, the camera kicks in.  The wave crosses the frame.
TEMPLATES.burst = (F) => {
  const kk = Math.exp(-Math.max(0, F.u.t) * 9), base = F.rig('machine_macro.burstLow', () => { const c = F.at(0.9, 1.1); const l = F.at(9, -0.6); return cam([c.x, 0.5, c.z], [l.x, 1.2, l.z], 50); });
  return {
    set: 'mall', ext: ['machine_macro'], light: ['mall', 'machine_macro'], args: { needle: F.u.t < 0 ? 0 : 2, run: clamp(F.u.t / 1.5), lamp: 1 }, confetti: F.conf(0.04),
    rig: (u, c2) => kick(base(u, c2), 0.32 * kk), flicker: F.flicker('dead'), post: { band: 0.34, tilt: 2.2, focusY: 0.5, bloom: 0.26 },
    cast: [chorusPip(F, 'pipSew', { amp: 1 }), ...F.crowd(crowdIds(0, 10), { act: 'crowd' })],
  };
};

// sewMachine (B): Pip at the machine (pipSew, singing), medium; thread flying, sparkles; the front's ring expanding behind her.
TEMPLATES.sewMachine = (F) => {
  const p = smooth(F.p), s = machineSlot(F);
  const at = { x: s.x, y: 0, z: s.z, rotY: faceAt(s, F.at(3.5, 0.9)) };
  const r = faceCam('pip', at, { dist: lerp(3.3, 2.7, p), side: 0.8, h: 1.35, lookDy: -0.2, fov: 34 });
  return {
    set: 'mall', ext: ['machine_macro'], light: ['mall', 'machine_macro'], args: { needle: 2, run: 1, lamp: 1 }, confetti: F.conf(0.04),
    rig: () => r, post: { band: 0.34, tilt: 2.2, focusY: 0.5, bloom: 0.24 }, cast: [chorusPip(F, 'pipSew', { look: 'cam', lookAmt: 0.4 }), ...F.crowd(crowdIds(0, 8), { act: 'crowd' })],
  };
};

// a zombie placed on the front so that it is made over DURING the shot: its radius from the hub = R at fraction `at` of the shot
export const onFront = (F, at, lat) => { const r = F.Rat(F.shot.t0 + at * F.dur); return F.at(Math.max(2.0, r), lat); };

// hemSweep (B): low macro on one zombie from the feet: the hem sews itself up the body as the front passes; a hop and a sparkle pop at the end.
TEMPLATES.hemSweep = (F) => {
  const p = smooth(F.p), pos = onFront(F, 0.28, -1.2), who = 'z2';
  const at = { x: pos.x, y: 0, z: pos.z, rotY: faceAt(pos, F.O) + 0.1 };                                  // faces the hub (the light), i.e. away from the camera side
  const c = { x: pos.x + Math.sin(at.rotY + 2.6) * 1.9, z: pos.z + Math.cos(at.rotY + 2.6) * 1.9 };
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04),
    rig: () => cam([c.x, lerp(0.3, 0.55, p), c.z], [pos.x, lerp(0.42, 0.75, p), pos.z], 36), flicker: F.flicker('dead'),
    post: { band: 0.2, tilt: 3.0, focusY: 0.42 },
    cast: [{ who, at, act: 'crowd', seed: 0.31, look: 'cam', lookAmt: 0.6 }, chorusPip(F, 'pipSew', { amp: 0.8 }), ...F.crowd([0, 1, 4, 5], { act: 'crowd' })],
  };
};

// bodiceSweep (B): medium on a zombie as the bodice, bows and shoes appear and the clouded eyes stitch open; lace and ribbons fly in.
TEMPLATES.bodiceSweep = (F) => {
  const p = smooth(F.p), pos = onFront(F, 0.3, 1.0), who = 'z4';
  const at = { x: pos.x, y: 0, z: pos.z, rotY: faceAt(pos, F.O) + 0.2 };
  const r = faceCam(who, at, { dist: lerp(3.0, 2.3, p), side: -0.9, h: 1.15, lookDy: -0.25, fov: 30 });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => r, flicker: F.flicker('dead'),
    cast: [{ who, at, act: 'crowd', seed: 0.62, look: 'cam', lookAmt: 0.7 }, chorusPip(F, 'pipSew', { amp: 0.8 }), ...F.crowd([1, 3, 6, 7], { act: 'crowd' })],
  };
};

// twirlLow (B, at line 3): low wide, five zombies twirling in petticoats around Pip; low sweeping dolly.
TEMPLATES.twirlLow = (F) => {
  const p = smooth(F.p), ctr = F.at(6.2, 0.4), ids = [0, 1, 2, 3, 4];
  const a = lerp(-0.7, 0.5, p), r = 6.2, c = { x: ctr.x + Math.sin(a + 0.4) * r, z: ctr.z + Math.cos(a + 0.4) * r };
  const cyc = F.beatSec() * 4;                                                        // one full turn per 4 beats, restarted every cycle
  const ring = ids.map((i, n) => { const ang = (n / ids.length) * TAU + 0.4; const pos = { x: ctr.x + Math.sin(ang) * 2.1, z: ctr.z + Math.cos(ang) * 2.1 }; const ph = (((F.u.t - n * 0.15) % cyc) + cyc) % cyc; return F.cast('z' + i, { ...pos, y: 0, rotY: faceAt(pos, ctr) }, 'poseTwirl', { k: 1, seed: hash(n * 3.3), t0: F.u.t - ph, dur: cyc, args: { n } }); });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => cam([c.x, 0.5, c.z], [ctr.x, 1.05, ctr.z], 44),
    cast: [F.cast('pip', { x: ctr.x, y: 0, z: ctr.z, rotY: faceAt(ctr, c) }, 'pipSing', { sing: true, args: { style: 'bright' } }), ...ring, ...F.crowd([8, 9, 11, 12], { act: 'liveBop', k: 1 })],
  };
};

// pipHero (B, at line 4): Pip centre on the pedestal, arms wide, the coloured crowd behind, gentle orbit, confetti falling.
TEMPLATES.pipHero = (F) => {
  const p = smooth(F.p), ped = F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25));
  const a = lerp(-0.5, 0.35, p), r = 4.3, c = { x: ped.x + Math.sin(a) * r + 0.6, z: ped.z + Math.cos(a) * r };
  const back = faceAt(c, ped), ring = [1, 3, 5, 7, 9, 11, 13, 15].map((i, n) => { const ang = back + lerp(-1.25, 1.25, n / 7) + 0.0, rad = 3.4 + (n % 2) * 1.1; const pos = { x: ped.x + Math.sin(ang) * rad, z: ped.z + Math.cos(ang) * rad }; return F.cast('z' + i, { ...pos, y: 0, rotY: faceAt(pos, c) }, 'liveBop', { k: 1, seed: hash(i * 1.9), look: 'cam', lookAmt: 0.5 }); });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => cam([c.x, 1.45, c.z], [ped.x, 1.5, ped.z], 38),
    cast: [F.cast('pip', { ...ped, rotY: faceAt(ped, c) }, 'pipSing', { sing: true, args: { style: 'bright' }, look: 'cam', lookAmt: 0.4 }), ...ring],
  };
};

// titleStitch (B, at line 5): wide of the mall with the embroidered title sewing itself across the air; zombies pose on the beats; slow crane up.
TEMPLATES.titleStitch = (F) => {
  const p = smooth(F.p), ped = F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25));
  const c = [lerp(3.6, 5.2, p), lerp(2.2, 4.4, p), lerp(9.6, 11.4, p)], lk = [ped.x - 1.0, lerp(2.4, 3.5, p), ped.z - 5.0];
  const dx = lk[0] - c[0], dy = lk[1] - c[1], dz = lk[2] - c[2], dl = Math.hypot(dx, dy, dz), D = 11;                       // the title hangs D metres ahead of the camera, facing it
  const tpos = [c[0] + dx / dl * D, c[1] + dy / dl * D + 0.35, c[2] + dz / dl * D];
  const ring = F.crowd(crowdIds(0, 14), { act: 'liveBop', k: 1, faceTo: { x: c[0], z: c[2] } });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => cam(c, lk, 44),
    text: [{ id: 'title', p: smooth(F.p * 1.15), pos: tpos, rotY: Math.atan2(c[0] - tpos[0], c[2] - tpos[2]), scale: F.portrait ? 1.15 : 1.5 }],   // portrait: at 1.5 the narrow frame cut COUTURE off at both sides; 1.15 leaves about 9 % each side
    cast: [F.cast('pip', { ...ped, rotY: faceAt(ped, { x: c[0], z: c[2] }) }, 'pipSing', { sing: true, args: { style: 'bright' } }), ...ring],
  };
};

// coutureHits (B, at "zombie couture"): four snap poses, one per beat; each beat a new tight angle (one shot, four camera jumps on the beats).
TEMPLATES.coutureHits = (F) => {
  const ped = F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25)), n = clamp(F.beatNo, 0, 3), tHit = Math.max(0, F.sinceBeatNo(n));
  const grp = [[-1.5, 0.3, 'z1'], [1.5, 0.3, 'z2'], [-0.8, -1.2, 'z3'], [0.9, -1.3, 'z5']];
  const cast = grp.map(([dx, dz, id], i) => { const pos = { x: ped.x + dx, z: ped.z + dz + 2.2 }; return F.cast(id, { ...pos, y: 0, rotY: faceAt(pos, { x: ped.x + [4, -3, 0, 2][n], z: ped.z + 9 }) }, 'poseCouture', { k: 1, seed: hash(i), t0: F.u.t - tHit, args: { n: (n + i) % 4 }, look: 'cam', lookAmt: 0.6 }); });
  const angles = [
    () => cam([ped.x - 3.0, 0.7, ped.z + 6.0], [ped.x, 1.1, ped.z + 2.0], 34),
    () => cam([ped.x + 3.6, 1.6, ped.z + 5.2], [ped.x - 0.4, 1.2, ped.z + 2.0], 30),
    () => cam([ped.x + 0.2, 0.45, ped.z + 4.2], [ped.x, 1.25, ped.z + 2.0], 38),
    () => cam([ped.x - 1.6, 2.6, ped.z + 6.4], [ped.x, 1.2, ped.z + 2.0], 32),
  ];
  return { set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: angles[n], cast: [F.cast('pip', { x: ped.x, y: 0.25, z: ped.z + 1.2, rotY: faceAt({ x: ped.x, z: ped.z + 1.2 }, { x: ped.x, z: ped.z + 9 }) }, 'poseCouture', { sing: true, k: 1, t0: F.u.t - tHit, args: { n } }), ...cast] };
};

// adorableWide (B, at line 6): wide as the front hits the far walls; all zombies line up and strike the pose; confetti; the whole mall is alive.
TEMPLATES.adorableWide = (F) => {
  const p = smooth(F.p), ped = F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25));
  const line = (F.mall.formation?.horseshoe ? F.mall.formation.horseshoe(14) : null);
  const ent = crowdIds(0, 14).map((i) => {
    const s = line ? line[i] : (() => { const ang = lerp(-1.1, 1.1, i / 13); return { x: ped.x + Math.sin(ang + PI) * 4, z: ped.z + Math.cos(ang + PI) * 4, rotY: 0 }; })();
    return F.cast('z' + i, { x: s.x, y: 0, z: s.z, rotY: s.rotY }, 'poseWide', { k: 1, seed: hash(i * 2.3), t0: (i % 5) * 0.06 });
  });
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: F.rig('mall.finale', () => cam([lerp(3.0, 4.2, p), 2.5, 9.6], [ped.x, 1.4, ped.z - 0.4], 44)),
    cast: [F.cast('pip', { ...ped, rotY: faceAt(ped, { x: 3.6, z: 9.4 }) }, 'poseWide', { sing: true, k: 1 }), ...ent],
  };
};

// pipWink (A, on "adorable!"): Pip's wink close-up, a sparkle in the eye.
TEMPLATES.pipWink = (F) => {
  const p = smooth(F.p), ped = F.slot('mall.ped', () => F.at(14.4, 0.7, 0.25));
  const at = { x: ped.x, y: 0.25, z: ped.z, rotY: faceAt(ped, { x: 3.6, z: 9.4 }) };
  return {
    set: 'mall', light: 'mall', confetti: F.conf(0.04), rig: () => faceCam('pip', at, { dist: lerp(3.4, 2.8, p), side: 0.15, lookDy: 0.0, fov: 24 }), post: { band: 0.22, tilt: 3.0 },
    cast: [F.cast('pip', at, 'pipWink', { sing: true, face: { emote: 'happy', emoteK: 1 }, look: 'cam', lookAmt: 0.8 })],
  };
};

// ======================================================================================= BRIDGE (the tea party, the arm, the sky)

// door-local helpers: W(x, y, z) is a world point in the shopfront's own frame (x along the panel, z out toward the crowd), Wp(x, z) the same on the floor,
// TH the heading that looks OUT.  Falls back to a mall-anchor approximation while mall_door.js is missing.
export const doorFrame = (F) => {
  const a = F.ext('mall_door')?.anchors;
  if (a && a.W && a.Wp) return { W: a.W, Wp: a.Wp, TH: a.rotY };
  const Wp = (x, z) => { const p = F.at(4.6 + z, 0.9 - x); return { x: p.x, z: p.z }; };
  return { W: (x, y, z) => { const p = Wp(x, z); return [p.x, y, p.z]; }, Wp, TH: 0.6 };
};

// doorSlider (B, bridge line 1 "They used to scare me, now they're my friends"): THE contrast shot.  One tableau, two worlds: the crowd of verse 1 / pre-chorus 1
// standing in the open shopfront door and just outside it, first as the dead (cold grey light, staring, Pip frozen with her hand on her heart), then, behind a
// stitched felt seam that crosses the frame on "now they're my friends", the same six sewn, warm and waving, Pip waving back.  film.js draws the 'before'
// picture separately (F.side === 'before'); the Wipe pass lays the seam.  args tune the camera / blocking (see the defaults below).
TEMPLATES.doorSlider = (F) => {
  const A = F.args, before = A.force ? A.force === 'before' : F.side === 'before', D = doorFrame(F), p = smooth(F.p);
  const w = (n, end, fb) => F.word('bridge1.1', n, end) ?? fb;
  const tA = w(6, false, F.shot.t0 + 1.9) - (A.lead ?? 0.25), tB = w(9, false, F.shot.t0 + 2.8) + (A.tail ?? 0.11);      // "now" ... "friends"
  const pos = clamp(smoother(clamp((F.t - tA) / (tB - tA))));
  // the crowd in door-local metres (x along the panel, z out into the concourse): a loose arc facing the shop, the verse-1 regulars in front
  const ARC = A.layout ?? [[-0.55, 1.15], [0.6, 1.25], [-1.3, 2.3], [0.05, 2.2], [1.3, 2.4], [-1.95, 3.5], [-0.65, 3.6], [0.7, 3.7], [1.95, 3.55]];
  const IDS = A.ids ?? [0, 2, 3, 1, 4, 5, 6, 7, 8], ACTS = ['wave', 'wave', 'liveBop', 'wave', 'liveBop', 'cheer', 'liveBop', 'wave', 'cheer'];
  const zs = ARC.map(([x, z], i) => {
    const q = D.Wp(x, z), face = D.Wp(A.faceX ?? 0.0, A.faceZ ?? -3.0), at = { x: q.x, y: 0, z: q.z, rotY: faceAt(q, face) + (hash(i * 3.9) - 0.5) * 0.25 };
    const o = { seed: hash(i * 2.1 + 0.3), look: 'cam', lookAmt: 0.6 };
    return before ? F.cast('z' + IDS[i], at, 'deadStand', { ...o, k: 0 })
                  : F.cast('z' + IDS[i], at, ACTS[i % ACTS.length], { ...o, k: 1, t0: hash(i * 7.7) * 0.25 });
  });
  const pw = D.Wp(A.pipX ?? -0.55, A.pipZ ?? 0.0), pipAt = { x: pw.x, y: 0, z: pw.z, rotY: faceAt(pw, D.Wp(0.2, 3)) };
  const pipEnt = A.pip ? [before ? F.cast('pip', pipAt, 'pipListen', { sing: true, amp: 0.6, face: { emote: 'worried', emoteK: 1 } }) : F.cast('pip', pipAt, 'wave', { sing: true, face: { emote: 'happy', emoteK: 1 } })] : [];
  const cx = (A.cx ?? 0.0) + (A.dx ?? 0) * p, cz = (A.cz ?? -2.7) + (A.dz ?? 0.55) * p;                                // one slow push through the seam: her step toward them
  return {
    set: 'mall', ext: ['mall_door'], light: 'mall_door',
    alive: before ? 0 : 1, R: before ? -1 : undefined, flicker: before ? F.flicker('dead') : 1, args: { door: A.door ?? 1 },
    rig: () => cam(D.W(cx, (A.cy ?? 1.4) + 0.006 * Math.sin(F.t * 1.9), cz), D.W(A.lx ?? 0.0, A.ly ?? 1.25, A.lz ?? 3.0), A.fov ?? 50),
    cast: [...pipEnt, ...zs],
    confetti: before ? 0 : Math.max(0, F.t - tB),
    wipe: before ? undefined : { pos, angle: A.angle ?? 0.09 },
  };
};
