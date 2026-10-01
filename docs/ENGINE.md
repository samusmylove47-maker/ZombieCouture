# Engine notes

three.js r170 in headless Chromium (Playwright), software WebGL (SwiftShader, no GPU, 2 cores). Every frame is a pure function of time: `window.setT(t)` then `window.shoot('jpg')`. No clock reads, no unseeded randomness inside `update`.

## Files

| file | role |
|---|---|
| `web/index.html`, `web/main.js` | harness. `?style=felt|vinyl&shot=...` builds a scene and exposes `setT`, `shoot`, `info`, `ready` |
| `web/mats.js` | material kits. `makeMats(style, lite, {paper})`; felt = fibre map + bump, stitchified; `paper` swaps in card-stock grain (proposal C mock) |
| `web/stitch.js` | the stitch-front shader patch (`stitchify`, `sewDepth`, uniforms in `FRONT`) |
| `web/chars.js` | `buildCharacter` (procedural doll, nine posable joints, `sew` parts, props), `pose` |
| `web/cast.js` | `makePip`, `makeZombie(M, i)`, `ZV` variants, `GOWNS`, `LIVE`/`DEAD` poses, `deadAct`, `liveAct`, `applyAct` |
| `web/props.js` | sewing machine, spool, needle, thread tube, 3D running stitches, dust, confetti |
| `web/set.js` | the mall, bunting, sparkles, beams, `enclose`, embroidered title |
| `web/story.js` | the animated scene: `buildStory(...)` returns `{update(t), R, cuts, rigAt, crowd, pip, confetti, ...}` |
| `web/post.js` | EffectComposer: tilt-shift, bloom, output, grade |

## Shots (`?shot=`)

`story` (animated; params `t`, `rig`, `dead=1`, `paper=1`, `flat=0.07`), `cast` (line-up; `k=0|1`), `plan|before|seam|makeover|after` (early look-dev), and legacy vinyl stills `hero|face|hface|low|cctv`. Other params: `w`, `h`, `shadow` (map size, default 2048), `expo`, `mirror=0` (vinyl floor reflection off), `bokeh=0`, `lite=1`, `quality=lite`.

## Tools

* `python3 tools/shoot.py <style> <shot> <out.png> [w h] ["k=v&k=v"]` one still.
* `python3 tools/bench.py <style> <shot> <w> <h> [n] ["&k=v"]` steady-state seconds per frame.
* `python3 tools/farm.py --scene story --t0 0 --t1 10 --fps 24 --on 2 --w 1280 --h 720 --out out/frames/x [--shard k/n] [--fmt jpg]` resumable frame farm; `--on 2` renders every second frame and copies it forward (stop-motion on twos; the film itself is Motion = Ones, so the master does not use it).
* `tools/sheet_story.sh t1 t2 ...` quick 640x360 contact frames.
* `tools/demo_track.py` writes the 10 s placeholder beat used by the test animation.
* ffmpeg encode used for the page: `-crf 26` web, master should be crf 16-18 with BT.709 tags: `scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709`. Mux audio once, padded: `-af apad=whole_dur=<seconds>` (never `-shortest`).

## Measured cost (this machine, 2026-09-30)

| scene | 720p | 1080p |
|---|---|---|
| felt, dead wide (t=1.0) | 3.1 s | |
| felt, close (t=5.0, rig close) | 3.65 s | |
| felt, finale (t=8.9) | 3.75 s | 6.2 s |
| felt paper mock (t=8.9) | 3.9 s | |
| vinyl finale, mirror floor | 10.3 s | |
| vinyl finale, `mirror=0` | 3.7 s | |

First frame in a page costs 8-13 s (shader compile). Cost follows draw calls, geometry and shadow-map size more than pixels (2.25x the pixels cost 1.66x). Whole film: 177 s at 24 fps = 4,248 frames (171.02 s of song plus a 6 s end card), all rendered (Motion = Ones). Measured on the final shots: about 7 to 12 s per 1080p frame on this two-core box depending on what else is running (a test render slows the farm), so the master is an overnight job; see `docs/NEXT.md` for how it is run in passes.

## The front (uniforms in `FRONT`)

`uFront` (x, y, z, radius; `w < 0` = none), `uFrontWidth`, `uFrontNoise`, `uDash`, `uThread`, `uDeadGrade`, `uDeadLift`, `uDeadGain`, `uDeadKeep`, `uFlicker`, `uAlive` (1 = whole world alive), `uDeadRim`, `uFuzz`, `uMott`, `uTime`. Characters take a per-body `K` uniform through `stitchify(mat, K, sew)`; `sew = true` materials are discarded ahead of the sweep.

## Rules for keeping frames pure

1. `update(t)` reads only `t`, seeded `rng`/hash functions and constants. No `Date.now`, no `Math.random`, no accumulated state.
2. Camera is set first in `update`, everything that faces the camera reads it in the same call.
3. To add: `tools/consistency.py` renders sample times ascending, after a jump to the end and back, and shuffled, and fails on pixel drift (idea from the prior-art survey; not yet written).

## Third-party code

None copied so far. `docs/PRIOR_ART.md` lists what was read and the licence of each repo. If a helper is ported from an MIT/CC0 repo, add `THIRD_PARTY_NOTICES.md` with the author's copyright line and the licence text before it ships.
