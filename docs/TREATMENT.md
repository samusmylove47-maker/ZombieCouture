# Zombie Couture: treatment (proposal A, "Re-Stitched")

Status (2026-09-30): direction A ("Re-Stitched") chosen by the director. **Motion = ones** (24 fps, every frame rendered; the "on twos" notes below are the original proposal and were not used). The director also asked for the before/after "clientele" slider to appear in the second half, as the contrast between the scary start and the new cute friends: it is shot `b_01` (`doorSlider`, bridge opening), a seam wipe from the washed-out zombies to their made-over selves. The film is 177 s: the 171.02 s song plus a 6 s care-label end card (`docs/SHOTLIST.md` is the as-built list; the tables below are the plan).

Song: "Zombie Couture", Suno v5, 171.02 s, 126.18 BPM, satirical bubblegum pop, four-on-the-floor, handclaps, ultra-sweet female lead with gang vocals. Lyrics are original (`data/lyrics.txt`, from two images supplied by the director). The real mp3 arrived on 2026-09-30 and has been analysed (`data/timing.json`).

## 1. The idea in one line

A dead, grey, flickering mall is sewn back into colour by a pink stitch front that sweeps out from a sewing machine; every zombie it reaches is made over, hem first, into pastel couture. The lyrics say this in words; the picture does it in the material.

## 2. Look rules (felt, 3D, lit)

* Wool-felt dolls and set: fibre map plus bump, object-space mottling, fresnel fuzz rim on characters only, blanket-stitch rings at seams, 3D running stitches on the floor where the front passes.
* Two worlds, one shader: **dead** = cold, dim, blue-grey, fluorescent flicker (`uFlicker`), colour almost gone; **alive** = warm candy pastel with real lights and shadows. The front is the boundary (`uFront` = hub x, y, z and radius; `w < 0` means no front). A dashed pink thread band (`uDash`, `uThread`) rides the boundary.
* Palette: dead = `uDeadGrade` (0.50, 0.66, 0.95) cold; alive = peach floor, lilac walls, pastel gowns (`GOWNS` in `web/cast.js`), Pip in hot pink (`0xff2f86`) with a magenta streak. Pip is **never** dead-graded (her K stays 1): in verse 1 she is the only colour.
* Camera: tilt-shift band (`makePost` band/tilt), soft bloom, NeutralToneMapping. Grain is a feature; encode at high bitrate (crf 16-18, `-tune grain` for share cuts) so it survives compression.
* Motion: originally proposed as stop-motion "on twos" (12 poses a second, camera on twos too); the director chose **ones** (smooth 24 fps) after seeing the demos. The twos and mixed modes still exist in the engine (`motion=` query, `docs/FILM_RUNTIME.md`).

## 3. Cast

* **Pip** (designer, survivor, sings the lead): always alive; brown buns, magenta streak, purple iris, wink, tape measure, pin cushion, needle. Nine posable joints (body, head, shoulders, elbows, hips) plus face pieces.
* **Zombies**: seven variants (`ZV`), no two alike: heights 0.8-1.22, head scale 0.9-1.18, hats (pillbox, cone, none), stuffing tufts, patch colours. Dead state: torn grey rags, bare feet, blank clouded eyes (stitched X on some). Made-over state: gown (lathe skirt, zigzag hem on half), bodice, socks, shoes, bows, sewn-open eyes with iris, pupil and highlight.
* Parts that get sewn on are separate meshes flagged `sew`; they are discarded ahead of the sweep and get a matching shadow depth material, so shadows appear with the dress.

## 4. The story device, precisely

* Per-character `K` (0 to 1) is the makeover state. `sc_sewv(k, wp, op)` = `k*1.2 - (0.02 + sh*0.84 + noise*0.07)` where `sh = worldY/2.05`: the sweep climbs from the feet up. Colour returns behind the sweep; a dashed thread band (`abs(edge)` smoothstep) sits on it.
* Crowd zombies drift toward the light at 0.24-0.30 m/s. The front reaches each one at a solved time `tm`; `K` ramps over `Tm = 1.35 s` with a hop and a sparkle pop when it completes.
* The front's radius `R(t)`: ignite at 1.8 s (in the 10 s test), a steady stride, a burst that floods the mall, then `uAlive = 1`. In the full film these anchors come from `timing.json` (section starts), not constants.

## 5. Section by section (times are placeholders until the mp3 is analysed)

| Section | ~time | On screen | Tech |
|---|---|---|---|
| Intro | 0:00-0:08 | Black, one machine click, cold flicker on the dead mall, wide, nearly still. Title withheld. | flicker grade, `dead` rig |
| Verse 1 (soft, eerie, minor) | 0:08-0:38 | Barricade of carts and a vending machine; last can of beans; cloudy-eyed zombies at the glass; the door opens, "and they didn't bite". Slow drifts, shallow focus. Pip only colour. | dead shuffle, Pip lip-sync |
| Pre-chorus (rising hope) | 0:38-0:50 | Zombies hold up scraps: "help us look cute". Pip looks at the machine; needle up; the thread pulls out across the floor; push-in on the riser. | thread tube, dashed seam |
| Chorus 1 | 0:50-1:12 | Downbeat: the front detonates. Zombies made over on the beat (hop, sparkle). Title stitched in embroidery. "Zombie couture" x2: everyone poses, arms wide. | stitch front, embroidered title |
| Verse 2 (playful, faster) | 1:12-1:32 | Fitting-room macro montage: prom dress, tulle, lace collars, pins, tape. "braaains" unpicks and re-sews as "pride". | macro rigs, caption gag |
| Pre-chorus 2 | 1:32-1:42 | Runway: zombies strut in a line, low tracking shot, catwalk lights come up. | runway strip |
| Chorus 2 (bigger, confetti synth drops) | 1:42-2:02 | The whole mall wakes: bunting, party lights, confetti on the drops, overhead rosette with stitched outline, whip-pans, lockstep. | front reaches far walls |
| Bridge (slow, near-spoken, piano, distant moans) | 2:02-2:22 | Candlelit tea party in the fitting room. An arm falls off; everyone ignores it; Pip sews it back with a bow. "A little thread, a little love": the thread lifts to the skylight; the roof opens on a patchwork-quilt sky. | warm dim grade, slow crane |
| Final chorus (huge, choir) | 2:22-2:48 | Pedestal, horseshoe (already built), Pip centre stage, confetti storm, multi-angle coverage; on the held "forevermore" the crane pulls back through the skylight. | finale formation |
| Outro (fading moans, machine clicks) | 2:48-2:51 | Machine clicks. The last un-sewn zombie approaches, shy. Needle down. Cut to the care-label end card. | care-label card |

## 6. Cuts, camera, motion policy (from the prior-art survey, ideas only)

* Every cut lands on a downbeat or the first sung word of a line (snap to the last beat at or before the word, +20 ms tolerance). No typed times.
* Nothing cuts or shakes during held notes; drum rolls never trigger full-frame flashes.
* Pace: average shot length about 1.7-1.9 s in choruses, longer in verse 1 and the bridge. A shot's length is set by the "reads" it must land (what the viewer must understand).
* Shot list is data (`data/shots.json`): id, start (from a cut rule), mood, transition, rig, effects, cost class. The doc is generated from it.
* Rigs are pure functions of time (`rigs.dead/track/close/crane` exist; add fitting-room, runway, overhead, tea-party, skylight, machine-macro).

## 7. Lip-sync, moans, captions

* Mouth: `timing.json.visemes` gives events `[t, d, v, w]` per word over the set `rest, MBP, FV, O, U, AA, EE, TLD`. Sample with the reference recipe in `docs/TIMING_SCHEMA.md`; drive a jaw plus lip-shape blend on Pip. Zombies: open-mouth moan on `vocalizations` spans and mouth the gang-vocal hook lines.
* Embroidered captions: hook lines and the "braaains" to "pride" gag, as thread letters that stitch in as the word is sung (progress from `words[i].t0..t1`). Full-lyric captions live in a separate `.srt`.

## 8. Credits (care-label end card)

Directed and published by Avenrae / ShaeAI. Lyrics: Syribeth & ShaeAI. Music: Suno v5. Animation and every line of code: Claude Sonnet 5.5, in Claude.ai. Care line: "100% pastel · hand wash only · may moan". **The Suno account name appears only in the lyric-credit line above, exactly as the director gave it (end card, video description, CREDITS/README). Nowhere else: not in "Music: Suno v5", file metadata, file names, code or commit messages.**

## 9. Risks

1. First minute is grey: needs wit and pace from the camera; Pip's colour and the pink thread carry it.
2. Grain vs compression: high-bitrate master, `-tune grain` for share cuts.
3. Real vocal alignment may be worse than the synthetic tests: listen through `sheet.html`, pin overrides.
4. Software-GL render time: the 1080p master on ones is 4,248 frames at roughly 7 to 12 s each on the two-core box (about 8 to 14 h of farm time in total, run in two passes as shots were finished); previews are rendered per shot at 720p first.
5. Faces are small in wide shots: performance lives in close-ups and the mouth rig.

## 10. Deliverables

Master 1080p (BT.709-tagged), 720p review, native 9:16 15 s Shorts cut on a bar line at the strongest chorus, thumbnail rendered by the engine, `.srt`, description (hook, CTA, hashtags), care-label credits, public MIT repo (code only; song and lyrics excluded unless the director says otherwise).
