# FILM_RUNTIME.md: the film runtime, the template contract, how to add a shot

Read `docs/FILM.md` first (sets, light kit, materials, cast, acts, faces, text: the contracts this file builds on). This file is everything about `web/film/`:

| file | what |
|---|---|
| `web/film/film.js` | `buildFilm(env)`: builds every set once, the cast, text, threads, props, then defines `window.setT(t)` |
| `web/film/shots.js` | `TEMPLATES` (one function per shot template) + the tables the film builds once (crowd homes, text/thread/prop specs) |
| `web/film/timing.js` | `loadTiming(url)` / `attachReaders(T, url)`: the readers of `docs/TIMING_SCHEMA.md` as methods, plus `T.moan(t)`, `T.sing(t, 'lead'\|'bg')`, `T.sectionById(id)` |
| `web/post.js` | `makePost(..., { trans: true })` adds the last pass `post.trans` (whip, dip, flash) |
| `web/main.js` | `?shot=film` builds the film (`buildFilmShot`); `story` and `preview` are untouched |

## 1. Running it

`http://localhost:8000/web/index.html?style=felt&shot=film&w=1920&h=1080&t=42.5` then `window.setT(t)`, `window.shoot()` (PNG data URL, or `shoot('jpg')`), `window.ready === true` when built.

| param | meaning |
|---|---|
| `t` | song time (s) shown first; `window.setT(t)` moves it. `sid=<shot id>&p=<0..1>` instead: a moment inside a shot |
| `motion=ones\|twos\|mixed` | `ones` (default): everything smooth. `twos` and `mixed`: puppets, thread, text, faces and the stitch front step at 12 Hz (`tp = floor(t*12 + 1e-6)/12`), the film grain boils with the puppet frame; camera, lights and particles stay smooth. (Duplicating every second frame is the farm's `--on 2`, not the film's.) |
| `hand=1` | hand-touched jitter: front boil and a small per-pose nudge of root, head, roll (changes every 1/12 s) |
| `timing=`, `shots=` | urls; default `/data/timing.json`, `.standin.json`, `.mini.json`, `.fake.json`. The shots file is derived from the timing url (`timing.X.json` -> `shots.X.json`, `timing.json` -> `shots.json`); a mismatching `audio_id` is warned |
| `aspect=portrait` (or `h > w`) | fov is converted so the subject stays framed (`fovV = 2 atan(tan(fov/2) * (16/9) / (W/H))`, max 100 deg); a frame may set `portraitShift` (metres along camera right) |
| `debug=1` | not used by the runtime itself; stubs draw labels regardless |
| `warm=1` | pre-compile every material once (only worth it for a long run; costs seconds up front) |
| `quality`, `shadow` | passed on to the sets (`quality`) and the kit (`shadow`) |

Helpers for tools: `window.filmInfo()` -> `{ t, shot, tpl, section, R, alive, rig, sets, trans, stubs, drawCalls, warn[], timing, shots, motion, hand }` (call after `shoot()` for `drawCalls`); `window.listShots()`; `window.setView({ sid, p })` or `({ t })`; `window.__film` = internals (T, SH, S, EXT, CHARS, kit, post, Rat, tOfR, ...) for debugging only. Warnings (missing modules, unknown rigs, act failures) collect in `window.__warn` and the console.

## 2. What one `setT(t)` does (in this order)

1. shot = the shot with `t0 <= t < t1` in shots.json; `u = { t: t - t0, p, dur, mode }`; `c2` as in FILM.md 5; `F` = the helper object below.
2. `frame = TEMPLATES[shot.tpl](F)` (unknown template: warning + a debug frame of the empty dead mall). On `motion=twos|mixed` the template runs a SECOND time with `t` set to the puppet time (`floor(t*12)/12`): that second frame supplies `cast`, `text`, `threads`, `props`, and the camera position the puppets look at; the first (smooth) frame supplies set, camera, lights, args, post. So a template needs no special care for twos: whatever it computes from `F.t` / `F.p` is automatically stepped for puppets and smooth for the camera. On `ones` both are the same run.
3. Visibility: everything hidden, then the base set (`frame.set`, default `mall`), the mall extensions (`mall_roof` always unless `frame.noRoof`; plus `frame.ext`), `frame.also` sets.
4. Story clock: `R`, `alive` (below), `frame.R` / `frame.alive` override.
5. Camera from the rig (a name, a function `(u, c2) => {pos, look, fov, roll?}` or the object itself). Portrait conversion.
6. Front uniforms (`FRONT.uFront = (O.x, 0.5, O.z, R)`, `uAlive`, `uFlicker`, `uBoil`; band style from `frame.front` or `set.front()`), background colour.
7. `set.update(u, c2)` for the base set and each visible extension, `kit.off()`, then `light(kit, u, c2)` of the set(s) named in `frame.light`.
8. Cast: per entry, makeover state `K`, the act -> pose record `P`, look-at, `moves.applyPose`, held props, face (`setFace`).
9. Text items, threads, hero props.
10. Post grade (defaults, then the base set's `post`, then the sets named in `frame.light`, then `frame.post`), then the transition pass for the distance to the nearest cut.

Nothing is remembered between calls: render t, then t2, then t again and the PNGs are identical. The only mutable things are scene objects that steps 1-10 overwrite completely every call. Safety nets: a `post.focusY` outside 0.05..0.95 (a set that meant metres; it would blur the whole frame) is replaced by 0.5 with a warning; a zombie whose root is within 0.6 m of the camera is left out of the frame (`camClear` on the frame changes the radius, 0 turns it off; `keepNear: true` on an entry exempts it; Pip is never culled).

## 3. The story clock

* `shots.json.front` keyframes give `R(t)`, the radius (m) of the pink stitch front around the hub `O` (the machine). Between keys `R` is interpolated with the ease of the key the segment ENDS at (`linear` default, `smooth`). This is my reading of "between keys R is interpolated with the key's ease"; if the pipeline means the ease of the segment's start key, change `Rat` in `film.js`, one line. `R = -1`: not started.
* `aliveAt`: the song time after which the whole world counts as sewn. Shader `uAlive` = 1 from `aliveAt` on. Light mood `c2.alive` = 1 from `aliveAt`, and before that ramps `clamp((Rl - 14) / 30)` so the sets warm up as the front sweeps the mall (`Rl` = R on the smooth clock).
* Per zombie: `K = clamp((R - dist(zombie, O)) / 1.5)` (0 dead .. 1 made over) unless the entry says `k` (number) or `hold: true` (stay dead even when alive; also sets `K.hold`). After `aliveAt` every zombie is made over unless held. Pip is always K = 1.
* Helpers in `F`: `F.Rat(t)`, `F.tOfR(r)` (first song time with R >= r; bisection; `Infinity` if never), `F.tMeet(x, z)` (front reaches the point), `F.tDone(x, z)` (fully made over). A template can therefore place a zombie so the makeover happens inside its shot.

## 4. The template contract

```js
TEMPLATES.name = (F) => frame       // pure: no Math.random, Date.now, performance.now, no state; the same F gives the same frame
```
Registered in `web/film/shots.js`; the storyboard's `tpl` names it. `F.args` = the storyboard shot's `args`. Length-independent: express slow moves in `F.p` (0..1 over the shot), fixed-speed moves in `F.u.t` (s), beat-locked things through `F.b` / `F.since(n)` / `F.beatIn(n)`.

`F` fields: `t` (song s, smooth), `tp` (puppet clock), `up` (puppet seconds since shot start), `u`, `p`, `dur`, `c2`, `args`, `shot`, `section`, `T` (timing readers), `R`, `Rl`, `alive` (shader), `aliveLight`, `aliveAt`, `tq` (12 Hz frame number), `b` / `bp` (beats since the shot start, smooth / puppet), `beat`, `beatP`, `motion`, `portrait`, `cam` (the camera object; read it only for things that must look at it and take it from the previous state never: use `look:'cam'`).
`F` methods: `slot(name, fallback)` ('mall.machine', 'mall_door.glass2', 'atelier.teaSeat0', bare 'machine'; fallback = slot object or function; a missing slot without fallback warns), `at(rad, lat, y, faceToPoint)` (world slot from the hub axes: rad m along the front's axis, lat sideways), `pos(rad, lat, y)` -> [x,y,z], `cast(who, slot, act, opts)`, `crowd(ids, opts)` (zombies at their homes `CROWD16`), `rig(name, fallback)` (camera by name, with a fallback if the set module is missing), `walk(points, speed, opts)` (constant-speed path; `.x .z .rotY .dist .done`), `orbit(c, r, a0, a1, h, look, p, fov)`, `flicker('dead'\|'stutter')`, `conf(delay)` (confetti clock), `since(n)`, `beatIn(n)`, `beatSec()`, `sinceBeatNo(n)`, `facing(a, b)`, `sing(which)`, `mix`, `ease`, `clamp`, `lerp`, `smooth`, `hash`, `O`, `ax`, `tn`, `mall`.

### The frame a template returns
```js
{ set: 'mall'|'atelier'|'sky'|'card',          // base set (default 'mall')
  ext: ['mall_door'],                           // mall extensions to show (mall_roof is always on unless noRoof)
  also: ['sky'],                                // more base sets visible at the same time (a rooftop above the mall)
  noRoof: true,
  rig: 'mall_door.glassCU' | 'glassCU' | (u, c2) => ({ pos, look, fov, roll? }) | { pos, look, fov },
  light: 'mall' | 'mall_door' | ['mall', 'machine_macro'],   // whose light(kit, u, c2) runs; later names override earlier ones
  mode: 'string', args: { door: 0.4, needle: 2, lamp: 1, run: 0.5 },   // handed to the sets in c2.args / u.mode (merged over the shot's args)
  R, alive, ignited, confetti, flicker, bg,      // story-clock and mood overrides
  front: { width, noise, dash, thread },         // stitch-front band style (else set.front())
  post: { band, tilt, focusY, bloom, vig, grain, sat, contrast, chroma, tint, lift },
  portraitShift: 0.4,
  cast: [ entry, ... ], text: [ ... ], threads: [ ... ], props: [ ... ] }
```
Cast entry: `{ who: 'pip'|'z0'..'z15', at: {x,y,z,rotY} | 'slot.name', path: F.walk(...), act: 'deadShamble' | fn(a, c) | 'crowd' | null, args, t0 (act starts this many s into the shot), dur, amp, side, seed, k, hold, ramp, sing: true|'any', moan: true, look: 'cam'|'pip'|{x,z}, lookAmt, face: { emote, emoteK, brow, look, blink }, attach: { handL: 'tape'|'scissors'|'pin'|'cup'|'scrap', handR }, scale, hidden }`. `act: 'crowd'` is built in: dead shamble -> made over as the front passes (`K`) -> hop at `tOfR(dist + ramp)` -> `liveBop`. Any act name in `moves.ACTS` works; a name moves.js lacks logs one warning and falls back to a basic pose (the film never throws).
Lip-sync: Pip mouths `T.mouth(tp)` when `sing: true` and the lead voice is on a word; zombies mouth when `sing: true` and a backing/gang word is sung (`sing: 'any'` forces it). `moan: true` opens the mouth on `T.moan(tp)`. Blinks and gaze are automatic (`autoBlink`, `autoLook`).
Text: `{ id: 'title', p: 0..1 | words: [{t0,t1}], unpick, pos: [x,y,z], rotX/Y/Z, scale, color, visible }`. Threads: `{ id: 'run'\|'sew'\|'lift', pts: [[x,y,z],...] | fn(s), reveal: 0..1, t }`. Props: `{ id: 'scrap0', attach: { who, joint, pos, rot } | at: {x,y,z,rotY}, scale, visible }`.

### Worked example
```js
// hemSweep: the front crosses the frame; the camera sits low beside the seam and rises with u.p
TEMPLATES.hemSweep = (F) => {
  const p = F.smooth(F.p), c = F.at(F.lerp(4, 7, p), 2.4), l = F.at(F.lerp(6, 11, p), -0.6);
  return {
    set: 'mall', light: 'mall', args: { needle: 2 },
    rig: () => ({ pos: [c.x, F.lerp(0.5, 1.4, p), c.z], look: [l.x, 1.0, l.z], fov: 34 }),
    cast: [ F.cast('pip', F.slot('mall.machine'), 'pipSew', { sing: true }), ...F.crowd([0, 1, 2, 3, 4, 5], { act: 'crowd' }) ],
  };
};
```

## 5. Transitions (`in` of a shot)

`cut` (default). `whip[:left|right|up|down]`: a 24-tap directional blur peaking on the cut over 3 frames each side (alternates left/right when no direction is given). `dip[:0xrrggbb]`: fades to the colour before the cut (up to 0.35 s) and back after it (0.5 s; 1.1 s for the first shot of the film). `flash`: soft additive white for 0.10 s; the runtime turns any flash that would be the 4th within one second into a plain cut (warning). `seam` is NOT implemented: it plays as a cut and is flagged in `filmInfo().trans` (the storyboard does not use it). All are pure functions of the distance to the cut.

## 6. Stubs, and what you may rely on

Sets are imported and built once each (`web/sets/<name>.js` -> `build(ctx)`; extensions `build(ctx, mall)`). A missing or throwing base set becomes a grey box scene labelled `MISSING: <name>` with a `debug` rig; a missing extension is an empty group (`mall_roof`: a plain ceiling); each logs to `window.__warn`. `moves.js`, `face.js`, `text.js`, `gags.js` are imported with guards: without them the film uses `deadAct`/`liveAct`-based fallbacks, no faces, a flat thread tube, a felt-plane scrap. Missing rigs/slots use the template's fallback camera/position. `window.filmInfo().stubs` lists what was stubbed on screen.

## 7. How to add things

* A template: add `TEMPLATES.myShot = (F) => ({...})` in `web/film/shots.js`, use it in `data/storyboard.json`, run `tools/make_shots.py`. Give every camera a fallback (`F.rig(name, fallbackFn)`), place characters with `F.slot(name, fallback)` or `F.at(...)`.
* Before rendering a template: `node web/film/smoke.mjs` (about a second, node only). It runs every template for every shot of `data/shots.standin.json` at seven times, on both clocks, with the real helper object `F` out of `film.js` and stubbed sets, and reports throws, non-finite numbers, malformed cast/text/thread/prop entries, a missing camera and any two calls with the same input that differ. It cannot judge how a shot looks.
* A set: `web/sets/<name>.js` exporting `build(ctx)` (base set: add its name to the list in `film.js`, `S` loop, and to `HOME`) or an extension (add its name to `EXT_NAMES`). Rigs appear as `<name>.<rig>` and as bare `<rig>` inside a shot that shows the set.
* A gag prop: add a spec to `PROP_SPECS` (`make` = export of `gags.js`), then a `props: [{ id, attach | at }]` entry in a frame.
* An act: add it to `moves.js`; use its name in `cast.act`. It gets `a = { t, tp, dur, k, beat, phase, pulse, seed, amp, side, args }`; `a.args.K` is the character's makeover state and `a.args.dist` the metres walked on a `path`.

## 8. Rules the runtime relies on (and enforces where it can)

Pure functions of time (no random, no clocks). Only factory materials `M`. Lights only from the kit (11 lights always). Puppets on `tp`; camera, light, particles on smooth `t`. Missing keys of a pose are filled by the film (`pose()` skips missing joints and would carry state). The zombie root scale carries the variant height (`rec.baseScale`); do not `setScalar` it to 1.

Cost: on the software-GL box a frame costs about what its draw calls cost (`filmInfo().drawCalls`, read it after `shoot()`); the JS of `setT` (template, poses, faces, set updates) is 1 to 20 ms. Measured at 640x360 with the sets that exist now: a close-up with a macro set is 200 to 600 calls, the mall with a crowd 1,000 to 1,800, the finale mall with 14 zombies and the roof 2,800 (`titleStitch`, `adorableWide`). The empty mall with its roof is about 550 calls and each visible character 130 to 150 (faces included), so Pip + 6 zombies add about 1,000 to the mall. The film hides every set, extension, character, text item, thread and prop that the frame does not name, so a close-up should cast only the people in it. The transition pass is one full-screen pass. `warm=1` pre-compiles every material once (the first frame of a page load otherwise pays for the shader compiles, 15 to 25 s here); the farm should pass it once per browser.

## 9. Second-wave additions (verse 2 to the card)

Everything here lives in `web/film/shots2.js` (templates and helpers), `web/film/film.js` (the runtime side) and `web/gags.js`.  The templates that use them are in `docs/SHOTLIST.md`.

### 9.1 `frame.armGag`: the tea-party gag (bridge shots b_02, b_04, b_05, b_05b, b_06, b_07)
One seated zombie's right arm pops off, rolls to the saucer, is picked up by Pip and sewn back on with a bow; one pure function `armGag(u, sock, opts)` in `web/gags.js` (u = seconds since the gag started) returns the zombie's arm angles, the loose arm's pose, Pip's feet / lean / hand, the needle and thread, sparkles.  The film runs it after the cast is posed (`film.js`, "the arm gag"); the gag clock is ABSOLUTE (`armGag.t0`, song seconds) so the five shots that cut it up stay in step.
```js
frame.armGag = { who: 'z2', t0: 117.8,                   // the seated zombie and the gag clock origin (song s); u = puppet-clock song time - t0
  saucer: {x, z}, pip: {x, z}, tableY: 0.97,             // world x/z of the saucer the arm rolls to, Pip's rest spot, the tabletop height
  z1: 0.58, z2: 0.66, sewDist: 0.5, pickDist: 0.42,      // the arm's roll distances, how far from the socket she sews / from the arm she picks
  restZ, rotY, pipY, noPip, pipYaw0,                     // optional: rest offset, override of the zombie's heading, Pip's floor height, leave Pip alone, Pip's first facing (toward the lens before the pop)
  pipCam: [[u, amount], ...],                            // how far Pip's head turns toward the lens over the gag clock (0 = at the guest .. 1 = as far as it goes)
  pipHand: (u, g) => [x, y, z] | null,                   // take Pip's right hand over (world point): threadLift raises the needle at her side once the repair is done
  pipHandK: (u, g) => 0..1,                              // blend of that IK arm with the plain pose (hides the snap when the hand leaves the socket)
  needle: (u, g) => ({ visible, pos: tip, dir, scale }), // show the needle in that hand
  pipHeadX: (u) => radians }                             // extra head nod / lift
```
Timeline (u): pop 0.8, land 1.28, rolls to 2.05, Pip picks 2.15 to 3.0, carries to 3.65, sews 3.7 to 4.75, swap 4.8, bow 5.2, Pip steps back 5.3 to 6.0, the zombie nods 5.85 to 6.55, gag over 6.5; `pipHand` of the gag itself becomes null at u = 5.15 (that is why b_06 supplies its own).  `window.__armDbg` (and `ARMDBG=1` for `tools/argtry.py`) prints the gag's numbers for the frame.
Geometry that matters: Pip's head is huge, so any camera between her and the zombie is filled by it (seven of the nine cameras tried for the stitch); her arm reaches 0.43 m from the shoulder (0.165 lateral, 1.115 up), and a hand held straight up is inside her head, so the needle is raised out to the side.

### 9.2 `frame.wipe`: the before/after slider (bridge shot b_01 `doorSlider`)
```js
frame.wipe = { pos: 0..1,          // where the seam is (0 = the before picture only .. 1 = the after picture only)
               side: 'before',     // which picture film.js asks the template for while it draws the other half (F.side === 'before' | 'after')
               angle, dir, amp, period, inset, thick, dash, gap, shadow, thread: [r,g,b] }   // the look of the stitched seam
```
`setT(t)` builds the frame twice (once per side), renders the 'before' picture through the whole post chain into a render target and lays it behind the moving seam with the `Wipe` pass (`web/post.js`).  Both halves are pure functions of t.  `pos <= 0.0005` draws only the before picture, `>= 0.9995` only the after picture (so the cost is paid only while the seam is on screen).  `&dual=0` turns the feature off.  The template chooses its own content for each side (doorSlider: the same nine figures dead and grey / sewn and waving, Pip worried / waving; `alive`, `R`, `flicker` differ per side).

### 9.3 Camera clearance, `hold`, `k`
* A zombie whose root is within `camClear` (default 0.6 m; `frame.camClear` or a cast entry's `keepNear: true` switch it off) of a camera below 2.6 m is left out of the frame: it would fill the lens from inside.  Pip is never culled.
* `k` (0..1) on a cast entry sets the makeover state directly (the thread sweeps the character bottom-up: `k = max(smoothstep(0, 0.18, uK*1.2 - (0.02 + y/2.05*0.84 + noise*0.07)), uAlive*(1 - uHold))`; the pink thread band at the sweep edge shows only while 0 < uK < 1 and `alive` < 0.5).  `hold: true` keeps the character cloth-grey although `frame.alive` is high (the last zombie of the outro, `alive` 0.45: `shy` + `k` 0 to 0.2 = the first colour at its feet).
* World materials: `k = max(max(kF, uK), uAlive)`, where kF comes from the front radius R around the hub.  `frame.alive` sets both the shader `uAlive` and the light mood; the scene background is `frame.bg` or warm (alive > 0.5) / night blue.

### 9.4 Set arguments used by the second wave
`atelier`: `mode: 'tea'`, `seat`, `skylight` 0..1 (the panels slide, eased), `dawn` (belongs to the `sky` set: add `also: ['sky']` to see it through the hole).  `mall_roof`: `roof` 0..1 (the ten petals open; `roofAt(t)` in shots2.js drives it in chorus 3), `dawn`; the light blends from the room to open air on the camera height.  `mall_rosette`: `draw` 0..1.  `machine_macro`: `needle` 0|1|2|4, `run`, `lamp`.  `sky`: `dawn` 0..1, `cloudUnder` 0..1 (clouds seen from below glow gold instead of brown).  `card`: `reveal` 0..1 (0 to 0.2 the border stitches on, 0.2 to 1 the credits weave in line by line).

### 9.5 Helpers in `shots2.js` worth knowing
`pedFrame(F)` (the pedestal's own frame: `xz(a, b)`, `w(a, b, y)`, `polar(rad, ang, y)`, `rotY`), `ringCast` / `carousel` (the rosette's rings, static or walking), `pipOnPed`, `roofAt(t)`, `FIN(F, extra)` / `horse(F, PF, n, act, o)` (finale base frame and the horseshoe of dancers), `gagSetup` / `gagCast` / `teaGuests` / `seatAt` / `seatRig` (tea party), `sockOf` / `needleUp` / `liftPts` (the thread of light), `shyCast` / `OUTRO` / `SHY` (the last zombie), `skyRig(F, name, map, fallback)` (a sky rig on a remapped progress).  Camera helper `cam(pos, look, fov, roll?)`, `faceCam(who, at, {dist, side, h, lookDy, fov})`.

### 9.6 Looking at one shot without the whole film
`tools/views.sh <prefix> <w> <h> <shot id> <specfile>` (runs `tools/argtry.py` through `tools/rq.sh`, one page load, many views).  One line per view: `label|p|{json}`; the JSON's keys are merged into the shot's args, plus the special keys `_sid` (another shot's id: its own timing, args, template), `_tpl` (another template), `_rig` (a JS expression returning `{pos, look, fov}`; `frame` and `F` in scope, single quotes inside), `_frame` (JS statements run on the frame before it is posed).  Output `<prefix>_<label>.png`; `CAST=1` prints the cast table, `ARMDBG=1` the gag numbers; `tools/sheet.py <out.jpg> <cols> <cell width> file.png ...` makes a contact sheet.  If "built in ..." has not printed after two minutes, kill it and run it again (a browser that starts while the farm boots sometimes stalls).  Run it in the foreground with `timeout`, not backgrounded with `&` inside a subshell.
