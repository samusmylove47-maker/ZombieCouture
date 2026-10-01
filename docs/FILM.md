# FILM.md: contracts for everyone who adds code to the film

Read this first. It says how the film is put together, what a set module is, what the shared light kit is, what the render box can afford, and how to test your work without hurting anyone else's renders.

## 0. Ground rules

1. **Frames are pure functions of time.** A frame rendered alone, after a jump, or in shuffled order must be pixel-identical. So: no `Math.random`, `Date.now`, `performance.now`, no state carried from frame to frame. Noise comes from `hash()` in `web/util.js` (or a seeded `rng(seed)` at build time only).
2. **Build once, then only move things.** Per-frame code sets transforms, uniforms, visibility, instance matrices. Do not create geometry or materials per frame (the thread tube in `story.js` is the one tolerated exception).
3. **ES modules, three.js r170** via the import map in `web/index.html`: `import * as THREE from 'three'`, addons as `three/addons/...`. No other libraries, no downloaded assets. The only asset is the Fredoka font: `assets/FredokaOne-Regular.ttf`.
4. **Own your files.** Edit only the files your brief names. Everything else is read-only for you. Shared helpers live in `web/util.js`; if you need a new shared helper, write it in your own file.
5. **The Suno account name never appears in any file you write** except where the director's lyric-credit line is quoted by the text/credits code (that line is: `Lyrics: Syribeth & ShaeAI`). Do not put it anywhere else.
6. Keep em dashes in titles. Write plain, direct comments; no marketing voice.

## 1. The render box (this decides what you can afford)

* 2 CPU cores, no GPU. three.js runs on software WebGL (SwiftShader). One 1280x720 frame of the finished film costs about 3.5 s. Your set may add at most **0.6 s per frame at 720p** to the shots it appears in. Draw calls and shadow-casting geometry cost more than pixels.
* Prefer `InstancedMesh` for anything repeated (spools, stitches, tiles, chairs, teacups). Merge static meshes with the same material when you can. Keep `castShadow` off for small or far things. No transparent overdraw piles; sprites sparingly.
* **Test renders share the box with long jobs.** Always go through the queue and keep them small:

```
cd <repository root>
(timeout 300 tools/rq.sh python3 -u tools/shoot.py felt preview out/<yourname>_1.png 640 360 "p=set&set=atelier&rig=fitWide&t=1.0" > out/<yourname>.log 2>&1; echo rc=$? >> out/<yourname>.log) &
sleep 45; cat out/<yourname>.log
```
  **Many views in one page load** (the shader compile is paid once, later views cost 2 to 6 s instead of 15 to 40 s; use this by default):
```
(timeout 400 tools/rq.sh python3 -u tools/shootmany.py out/<yourname> 640 360 "p=set&set=atelier&cast=pip@platform,z1@platformL" "fitWide@0.5" "hemPin@1.0" "teaWide@0.5,mode=tea" "skyRise@0.6,dur=6,args.skylight=1" > out/<yourname>.log 2>&1; echo rc=$? >> out/<yourname>.log) &
sleep 60; cat out/<yourname>.log
```
  A view is `rig@t[,dur=S][,mode=M][,alive=A][,R=M][,light=EXT][,beat0=B][,args.key=value]`; files are `out/<yourname>_<n>_<rig>_<t>.png`. The log prints draw calls and triangles for the whole frame (shadow pass included).
  Run it in the background with a log and poll, so a hang never freezes your shell. One render job at a time. 640x360 unless you are checking fine detail. The first frame of a page costs 5 to 15 s (shader compile); with other jobs running expect 20 to 60 s. A render that hasn't finished after 3 minutes is hung: read the log (build errors are printed as `BUILD FAILED: ...`).
* **Never `pkill -f "<text that is in your own command line>"`** (it kills your own shell). Use the bracket trick: `pkill -f "[s]hoot.py"`. Do not kill processes you didn't start: long `tools/farm.py` renders are running for the director.
* Look at your renders with the Read tool (PNG). Judge them the way an art director would: silhouette, colour, craft, clutter, what reads at 720p. Iterate at least three times before you call anything done.

## 2. The look

Felt-and-thread stop-motion: chunky rounded forms, visible seams and running stitches, appliqué patches, buttons, ribbons, slightly imperfect symmetry, wool fibre surface (this comes from the material factory), soft tilt-shift depth, warm pastel lighting. Never plain CG boxes: if a shape is a box, round it, add a stitched border, add a trim. Scale is doll-scale exaggerated (a character is about 1.2 to 1.7 m tall; doors are tall and friendly).

Palette (candy pastel): pink `0xff9ecb 0xffb6d5`, hot pink accent `0xff2f86` (Pip's colour), lilac `0xd9a7ff 0xc9b6ff`, mint `0xb6ffd6`, sky `0xa8e6ff`, butter `0xfff0a6 0xffe066`, peach `0xffc9a8 0xffd9a8`, cream `0xfff4e0`. Thread colours: cream `0xfff4e0`, coral `0xff8a6a`, hot pink `0xff5fa8`.

**Two worlds, one shader.** Everything made with the material factory `M` is run through `stitchify` (web/stitch.js): before the pink stitch front reaches it, it is cold, dim, blue-grey; after, warm pastel. Global switch `FRONT.uAlive` (0/1) makes the whole world alive. All sets other than the mall are shown only after the mall has come alive, so they render in full colour; the mall renders dead, mid-sweep, or alive depending on the shot.

## 3. Materials: use only the factory `M` (web/mats.js)

`M.matte(color,{rep,rough})` flat cloth/wall/floor, `M.cloth(color,{rep})` (double sided), `M.satin(color)`, `M.plastic(color,{rough})` (glossy trim), `M.metal(color)`, `M.glow(color,k)` (unlit emissive, does not receive light), `M.basic(color,{transparent,opacity,depthWrite,toneMapped})` unlit colour, `M.thread(color)`, `M.skin(color)`, `M.hair(color)`, `M.ink(color)`, `M.eyeWhite()`, `M.fabricTex(rep)`. `rep` = fibre texture repeat (bigger = finer fibres). Canvas textures (patchwork, labels, glass scratches) are welcome: wrap the final material with `stitchify(new THREE.MeshStandardMaterial({ map, ... }))` from `web/stitch.js` so it obeys the dead/alive world. Things that must always be in colour (the sewing machine, the thread, Pip) set `M.currentK = { value: 1 }` while building and restore it afterwards (see `makeMachine` in `web/props.js`).

`stitchPath(root, points, color, spacing, len, thick)` in `web/set.js` lays an instanced running stitch along a polyline; it is the cheap way to make anything look sewn.

## 4. Worlds and coordinates

Right-handed, metres, +y up, character forward is +z when `rotation.y = 0`. `facing(a, b)` in util.js gives the `rotY` that makes a character at `a` face `b`. A character root stands on its feet at y = 0 (Pip is about 1.7 m tall with hair; zombie variants scale 0.8 to 1.22).

Reserved regions (build inside yours, do not cross):

| region | where | owner |
|---|---|---|
| **mall** atrium | x -23.5..23.5, z -12.5..24, floor y = 0, ceiling y = 11.4 | `sets/mall.js` (+ extension modules) |
| **atelier** | x 73..87, z -5..5, height 5.5 | `sets/atelier.js` |
| **sky and quilt world** | dome radius 380 around the origin (not fogged); quilt ground plane at y = -0.35 | `sets/sky.js` |
| spare | x 100..140 | anyone, ask |

The camera's far plane is 1200 in film and preview shots. Scene fog is on (`Fog(0x8f8aa8, 30, 130)`): anything huge and distant (sky, quilt ground) must use `fog: false` materials (or set `material.fog = false`).

## 5. Set module contract (`web/sets/<name>.js`)

```js
export function build(ctx) -> set
ctx = { THREE, M, FRONT, rng, hash, scene, root, quality: 'full'|'lite', W, H, mode, args }
```
`root` is a Group you must add ALL geometry to. The film hides and shows `root` per shot. Never add lights (see the kit). Never touch `scene` directly.

```js
set = {
  name, root,
  anchors: { ... named points and axes others need ... },
  rigs:  { [name]: (u, c2) => ({ pos:[x,y,z], look:[x,y,z], fov, roll? }) },     // world coordinates
  slots: { [name]: { x, y, z, rotY } },                                            // where characters stand
  update(u, c2),                       // animate your moving parts: pure function of u and c2
  light(kit, u, c2),                   // configure the shared light kit (see section 6)
  post: { band, tilt, focusY, bloom, vig, grain, sat, contrast, tint },            // defaults for shots in this set (all optional)
  front?(u, c2) -> { width, noise, dash, thread },                                  // optional: the stitch-front band style while this set is on screen (a band that is 0.6 m wide is invisible from 100 m up)
}
```
Extension modules (`web/sets/mall_door.js`, `mall_runway.js`, `mall_rosette.js`, `mall_roof.js`) are built INTO the mall: `build(ctx, mall) -> ext` where `ctx.root` is a child Group of the mall root and `mall` is the object returned by `sets/mall.js` (`mall.anchors`, `mall.S`, `mall.slots`, `mall.formation`). An extension has the same fields (rigs, slots, update, light, post); the film registers its rigs as `<extname>.<rig>` and may call its `light` instead of the mall's when a shot says so.

Per-frame inputs:

```js
u  = { t, p, dur, mode }      // t: seconds since the shot began (smooth clock), p = t/dur in 0..1, dur: shot length in s, mode: set-specific string chosen by the shot
c2 = { t, tp, beat, bar, phase, pulse, env:{bass,mid,high,rms,vocal,onset}, alive, R, Rl, ignited, cam, args, pip:{x,z}, section, confetti }
```
`t` song seconds, `tp` puppet time (equals `t` unless the film steps the puppets on twos), `beat` fractional beats (from the real beat grid), `phase` beat within the bar 0..4, `pulse` 1 on a beat decaying to 0, `alive` 0..1 how awake the world is, `R` radius of the pink front in metres (-1 before it starts), `args` free arguments of the shot template. Rigs must work for any `u.dur` (shot lengths are only known once the song is analysed): express slow moves in `u.p`, and moves that need a fixed speed in `u.t`. Keep camera moves calm unless the shot is a whip.

## 6. The light kit (`web/kit.js`)

Every shot uses the same ten lights: 1 directional `key` (the only shadow), 1 hemisphere, 6 spots, 2 points, so three.js never recompiles shaders on a cut. A set only configures them in `light(kit, u, c2)`, which must call `kit.off()`-safe setters (the film calls `kit.off()` first):

```js
kit.setKey({ pos, target, color, i, extent, near, far })   // shadow box half-size `extent` (m) around target; smaller = sharper shadows
kit.setHemi({ sky, ground, i })
kit.setSpot(n, { color, i, dist, angle, pen, decay, pos, target })   // n = 0..5
kit.setPoint(n, { color, i, dist, decay, pos })                      // n = 0..1
```
Intensity scale (from the mall, which looks right): key 0.5..2.6, hemi 0.4..0.8, spots 40..190 (dist 24..40, decay 1.2), points 14..70. Unused lights stay at 0. Emissive things (`M.glow`, `M.basic`, additive beam meshes from `beam()` in set.js, sprites) are the way to make lamps, candles and neon look lit without more lights.

## 7. Cast and joints (`web/chars.js`, `web/cast.js`)

`makePip(M)` and `makeZombie(M, i, extra)` return `{ obj, K, kind }`. `obj.userData.J` holds the joints: `body`, `head`, `shL shR` (shoulders), `elL elR` (elbows), `legL legR` (hips), each a Group whose `.rotation` you set through `pose(obj, {...})`. Pose keys (radians `[x, y, z]`): `shL shR elL elR head body legL legR`. Shoulder z is lateral raise (LIVE pose: `shL [0,0,-1.42]`, `shR [0,0,1.42]` = arms straight out), shoulder x swings forward (DEAD pose: `shL [-1.28,0,-0.1]` = arms forward). Leg x swings forward/back. `K.value` 0..1 is a zombie's makeover (0 ragged, 1 dressed); Pip is always 1. Dolls have no fingers: acting is arms, head, body, root bob and sway.

## 8. Preview tool

`web/preview/set.js` renders any set module alone: `?shot=preview&p=set&set=<name>&ext=a,b&rig=<rig>&t=<s>&dur=<s>&mode=<m>&alive=0..1&R=<m>&args=k:v,k:v&beat0=<beats>&cast=pip@slot,z2@x:z:rotY[:y]&light=<ext>&post=band,tilt,focusY`. `window.setView({...})` changes rig, t, dur, mode, alive, R, args at runtime (that is what shootmany.py uses). Other preview modules (`p=<file in web/preview>`) can be written freely by their owner: export `async function run(env)`, build the scene, `env.setPost(makePost(...))`, define `window.setT(t)` (and `window.setView(o)` with `o = {rig, t, dur, mode, alive, R, args, light, beat0}` if you want tools/shootmany.py to work with it). The env gives `{ THREE, renderer, scene, M, S, FRONT, cam, q, W, H, style, makePost, makeKit, setPost, rng, SHADOW, LITE }`.

## 9. What to hand back

A short report: files written, exported API (exact function names and argument shapes), what is finished vs. not, known problems, per-frame cost measured (`tools/bench.py felt preview 640 360 5 "&p=set&set=..."` when the box is quiet enough to trust), and the paths of your three best preview renders. If something in a contract here is wrong or impossible, say so plainly rather than working around it silently.

---

# Part II: the film runtime and the module APIs (binding for the builders who write against them)

Several builders work at the same time, each on one module, against these signatures. If you are the owner of a module, implement exactly this; if you consume one that doesn't exist yet, code against the signature and guard the import (`try { await import(...) } catch {}` or a stub) so your work runs without it.

## 10. Timing readers: `web/film/timing.js` (owner: film-core)

```js
export async function loadTiming(url) -> T      // fetches and parses data/timing.json (schema docs/TIMING_SCHEMA.md), attaches readers:
T.duration
T.beatAt(t)  T.timeOfBeat(b)  T.barPos(t) -> {bar, beat}  T.beatPulse(t, sharp = 4)
T.env(name, t)  T.hit(kind, t, halfLife = 0.12)  T.events(kind, t0, t1)
T.wordAt(t)  T.wordProgress(w, t)  T.lineAt(t)  T.sectionAt(t)  T.sectionById(id)  T.cutFirstWords(k)
T.mouth(t) -> Float32Array(8)      // viseme weights over ['rest','MBP','FV','O','U','AA','EE','TLD']  (reference code in docs/TIMING_SCHEMA.md)
T.moan(t) -> 0..1                  // 1 inside a `vocalizations` span (smoothed with 60 ms attack/release), else 0
T.sing(t) -> 0..1                  // T.env('vocal', t) gated to sung words
```
The readers are the code in TIMING_SCHEMA.md ("Reading it") made into methods. Nothing else in the film may hard-code a time.

## 11. Acts (procedural acting): `web/moves.js` (owner: moves)

```js
export const ACTS = { [name]: (a) => P }
export function act(name, a) -> P                 // throws a clear error for an unknown name
export function actNames() -> string[]
export function applyPose(c, base, P)             // c = makePip()/makeZombie() record; base = {x, y, z, rotY}; sets pose(), position, rotation, face hints
a = { t, tp, dur, k, beat, phase, pulse, seed, amp, side, args }
```
`t` seconds since the act began; `tp` the same on the puppet clock (stepped to 12 Hz when the film runs on twos: use `tp` for every motion so stop-motion just happens; use `t` only where smooth is wanted); `dur` act length in s (may be `Infinity` for loops); `k = clamp(t/dur)`; `beat` global fractional beat number; `phase` beat inside the bar 0..4; `pulse` 1 on the beat decaying to 0; `seed` 0..1 personal phase (different for every character so a crowd never moves in unison unless the act is meant to); `amp` 0..1 intensity; `side` -1 or 1 (mirror); `args` free arguments of the act.
```js
P = { pose:{shL,shR,elL,elR,head,body,legL,legR},   // radians [x,y,z] per joint (keys as in web/cast.js), any missing key = [0,0,0]
      dx, dy, dz,                                    // root offset in the character's own frame (x right, z forward, y up), metres, added to base
      yaw, lean, roll,                               // extra rotation of the root about y (turn), x (forward tilt) and z (sway), radians
      face: { emote, look:[x,y], brow, mouth },      // hints for web/face.js (all optional; `mouth` 0..1 open amount for non-lip-synced moans)
      attach: { handL: 'tape'|'scissors'|'pin'|'cup'|null, handR: ... } }   // props held in the hands (optional; the film shows/hides prop meshes it owns)
```
Acts are pure functions: no state between calls. They must look good sampled at 12 Hz (strong readable poses, clear anticipation and follow-through: this is stop-motion, hold poses and snap between them).

## 12. Faces: `web/face.js` (owner: face)

```js
export function rigFace(char, opt = { level: 'full' | 'lite' })   // once per character after makePip/makeZombie; stores char.face (the handles), safe to call twice
export function setFace(char, F)                                  // every frame: F = { mouth: Float32Array(8) | null, moan: 0..1, blink: 0..1, look: [x, y], brow: -1..1, emote, emoteK: 0..1 }
export function autoBlink(t, seed) -> 0..1                        // deterministic blink schedule (a blink every 2.5 to 5.5 s, about 0.14 s long, sometimes a double)
export function autoLook(t, seed, target = [0, 0]) -> [x, y]      // slow saccades around `target` (-1..1 each)
emote in: 'neutral' | 'happy' | 'awe' | 'shy' | 'gasp' | 'sleepy' | 'smug' | 'proud' | 'worried' | 'moan'
```
`mouth` is the weight vector from `T.mouth(t)`; `null` means "not singing" (then `moan` opens the mouth: zombies' jaw drop, a wobbling "aaah"). `setFace` must cost nothing when a character is hidden or its `F` is unchanged.

## 13. Text and the end card: `web/text.js`, `web/sets/card.js` (owner: text)

```js
// web/text.js
export function buildText(ctx) -> Text                // ctx = { THREE, M, FRONT, root, hash, rng, quality }, root = a Group all text lives in
Text.item(id, spec) -> item                           // spec = { text, style: 'thread' | 'satin' | 'felt', color, color2, size (cap height, m), width (max line width, m, wraps), align: 'center' | 'left', depth }
item = { id, obj,                                     // obj: Group; the caller parents and places it
         progress(p, t),                              // 0..1 stitches in, in reading order, a bright needle-tip stitch leads (t = seconds, for shimmer)
         unpick(p),                                   // 0..1 threads pull out backwards, loose ends curl and fall
         setColor(c), setVisible(v), bounds }         // bounds = {w, h} in metres
Text.title(root?) -> item                             // the embroidered "Zombie Couture" title (em dash never used here)
// web/sets/card.js  is a set module (FILM.md section 5) for the care-label end card
```

## 14. Gags and hero props: `web/gags.js`, `web/sets/machine_macro.js` (owner: gags)

```js
// web/gags.js
export function makeLooseArm(M, char, side) -> arm    // a free copy of one arm of a made-over zombie; arm = { obj, place(u) }
export function armGag(u) -> { arm: {pos, rot, visible}, realArmVisible, wobble, spark }   // pure function of u = seconds since the gag started
export function makeBeansCan(M, opt) -> Group          // the last can of beans (felt can, stitched label, pull-tab)
export function makeHat, makeTeaSet ... (whatever else you build; document it)
// web/sets/machine_macro.js  extension module of the mall: build(ctx, mall) -> ext   (same fields as any extension)
```

## 15. The film runtime: `web/film/film.js` (owner: film-core)

`?shot=film&t=<song seconds>&w=&h=&motion=ones|twos|mixed&hand=0|1&timing=<url>&shots=<url>` builds every set once (mall + extensions, atelier, sky, card), the cast pool (Pip and 16 zombies), the light kit, the text items and the post chain, then exposes `window.setT(t)` (pure: any order, any process) and `window.shoot()`. Extra URL forms for tooling: `&sid=<shot id>&p=<0..1>` renders that shot at that progress (the film computes the song time), `window.filmInfo()` returns `{t, shot, section, tpl, cost, drawCalls}`, `window.listShots()` returns `shots.json` `.shots`.

* **Motion modes.** `ones`: everything smooth. `twos`: the farm renders every second frame (`tools/farm.py --on 2`) and the film feeds poses from `tp = floor(t*12 + 1e-6)/12`; the camera and lights use `t`. `mixed`: puppets and the stitch front step at 12 Hz (`tp`), camera, lights and particles are smooth. With `hand=1`: per-pose fibre boil (`FRONT.uBoil`) and hand-touch nudges (see `web/story.js` for the working reference).
* **Shots** are records in `data/shots.json` (schema `zombie-couture.shots/1`, made by `tools/make_shots.py` from `data/storyboard.json` and `data/timing.json`): `{ id, section, t0, t1, tpl, args, cost, in, out, note }`. The film finds the shot whose `[t0, t1)` contains `t`, builds `u = {t: t - t0, p, dur, mode}`, and asks the **template** `TEMPLATES[tpl]` in `web/film/shots.js` for the frame: which set is visible, which rig, who stands where doing which act, which light preset, effects. A template is a pure function `(F) => frame`; the exact signature is documented by film-core in `docs/FILM_RUNTIME.md`.
* **Front and makeover.** The pink front radius `R(t)` comes from `storyboard.front` keyframes (anchors resolved by make_shots into seconds). A zombie's `K` (0..1) is 0 before the front reaches it, ramps over ~1.4 s as it passes, and is 1 after; `FRONT.uAlive = 1` once the front has covered the mall (storyboard says when). `hold: true` on a cast entry keeps that zombie grey after `uAlive` (the shy last zombie; uses per-character `uHold`, see `web/stitch.js`).
* **Transitions** between shots: `cut` (default), `whip` (3 frames of horizontal motion blur either side of the cut), `dip` (fade through a colour, `arg` = colour), `flash` (at most 0.10 s, never full white for more than 3 frames, at most 3 per second), optional `seam` (a zigzag stitch line wipes across the frame). They are post-process uniforms in `web/post.js`, pure functions of the time distance to the cut.

## 16. File ownership during the build wave

| owner | files |
|---|---|
| atelier | `web/sets/atelier*.js`, `web/preview/atelier*.js` |
| mall-dressing | `web/sets/mall_door.js`, `mall_runway.js`, `mall_rosette.js`, `web/preview/mall_*.js` |
| roof-sky | `web/sets/mall_roof.js`, `web/sets/sky*.js`, `web/preview/sky*.js` |
| face | `web/face.js`, face code inside `web/chars.js` (`buildFace` and helpers only), `web/preview/face.js` |
| moves | `web/moves.js`, `web/preview/moves.js` |
| text | `web/text.js`, `web/sets/card.js`, `web/preview/text.js` |
| gags | `web/gags.js`, `web/sets/machine_macro.js`, `web/preview/gags.js` |
| pipeline | `tools/make_shots.py`, `tools/qa_*.py`, `tools/sheet_shots.py`, `tools/consistency.py`, `data/timing.standin.json`, `docs/SHOTS.md` generation |
| publish | `tools/encode_*.sh`, `tools/make_srt.py`, `tools/make_description.py`, `tools/thumbnail.py`, `tools/repo_bundle.sh`, `tools/farm.py`, `publish/` |
| film-core | `web/film/*`, `web/main.js`, `web/post.js`, `docs/FILM_RUNTIME.md` |
| director (me) | `docs/*` not listed, `data/storyboard.json`, `data/lyrics.txt`, `web/sets/mall.js`, `web/story.js`, `web/set.js`, `web/props.js`, `web/cast.js`, `web/stitch.js`, `web/kit.js`, `web/util.js` |

If you need a change in a file you don't own, write down what and why in your report (or, for a one-line fix, make it and say so plainly).
