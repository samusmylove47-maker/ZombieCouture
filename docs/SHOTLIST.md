# Shot vocabulary (templates) for "Zombie Couture"

> As built (2026-09-30): 81 shots in `data/storyboard.json` (see `docs/SHOTS.md` for the resolved list).  The bridge, finale, outro and card entries below were rewritten to match what was built; the earlier sections are the plan they grew from (check `web/film/shots.js` and `web/film/shots2.js` for the truth).

`data/storyboard.json` names templates from this list; `web/film/shots.js` implements them (film-core: intro, verse 1, pre-chorus 1, chorus 1; the rest in the second wave). Each entry: the picture, the set and rigs, the cast and acts, notable arguments. **Cost**: A cheap, B normal, C heavy. Lengths come from the storyboard, so every template must work for any `u.dur` (slow moves in `u.p`). "Sung" = what is being sung when the shot starts. The camera language: calm in verses and the bridge, motivated pushes and orbits in choruses, whips only where marked. The rig names are those promised in `docs/briefs/*.md`; if a module does not provide one, build the move from anchors in the template.

Cast shorthand: Pip = `pip`, zombies `z0..z15`. "Dead" = `K` 0, grey, `deadX` acts. "Alive" = `K` 1, `liveX` acts.

## Intro (instrumental; the dead mall; Pip is the only colour)
* **deadWide** (A): wide from the far end of the mall (mall `wideDead`-like: 1.9 m high at about 23 m from the hub), slow dolly in over `u.p`. Cold blue flicker, dust in light shafts, six dead zombies far away drifting toward the light (`deadShamble` along `F.walk` paths, 0.25 m/s), Pip tiny at the machine in a warm lamp pool. Starts from black: `in: dip:0x000000`, the first flicker is two hard stutters.
* **deadPush** (A): low (0.9 m), tracking forward between the pillars toward the barricade, a fallen cart blurred in the foreground, zombie legs shuffling past at the edge of frame.
* **hubIdle** (A): `machine_macro` macro of the idle machine in its lamp pool, needle up, dust drifting through the cone of light, slow rack from foreground spool to the needle. `args.needle = 0`.
* **pipBack** (A): from behind Pip at the barricade looking out at the dead mall, a slow push over her shoulder; the only colour in frame; a tiny breathing bob.

## Verse 1 (soft, eerie; dead)
* **barricadeWide** (B): from OUTSIDE the glass door (`mall_door.outsideIn`) looking in at the barricade of carts and the vending machine; Pip peeks over the top, zombies' silhouettes at the frame edges; cold. `pipListen` in idle.
* **beansCU** (A): `machine_macro.beansCU`: macro on the last can of beans on the barricade, the "LAST ONE" note, Pip's spoon dips in, a bean falls; focus racks to her eye behind. Cut lands on "last can of beans".
* **pipListen** (A): Pip's face, three-quarter close; she turns her head toward a noise; emote `worried`; the wink arc stays.
* **groanGlass** (B): `mall_door.glassCU` from inside: grey faces and palms pressed on the pane, mouths in a slow moan (`deadPressGlass`, `face.emote = 'moan'`).
* **scratchCU** (A): `mall_door.scratchCU`: extreme close on hands scratching down the glass.
* **cloudyEyes** (A): extreme close-up of one zombie's clouded eye (camera aimed at its head position); Pip's reflection is not needed; a slow blink of the heavy lid.
* **doorOpenPip** (B): `mall_door.doorWide` over Pip's shoulder as she unlatches and the door swings inward (`args.door` 0 to 1 over `u.p`, the bell rings); cold light and shapes beyond.
* **noBite** (B): medium in the doorway: a zombie leans toward Pip with its mouth open (`deadNoBite`: lean, freeze, mouth closes, straightens, tips its hat). Pip flinches, then relaxes. The joke lands on "they didn't bite". Camera (second version): from the concourse, over the zombie's shoulder and a little to one side of the doorway, so the zombie is large in the right foreground and Pip's face is at left; the first version stood behind Pip, whose huge head hid the lean and the hat tip. From the word "bite." on (frame 574, 23.92 s) the shot cuts to the zombie's face from inside the shop, off to one side of the doorway, with Pip stepping half a metre aside across the cut so that her huge head does not hide it (the shy glance, the smug face, the raised hand). The first cut-away attempt, from behind the zombie the whole time, had its tipping arm cross Pip's eye in the last half second. Cameras further to the side inside the shop look through the open door leaf and its frosted glass (no good); the working front camera is 2.0 m into the shop and 1.3 m to the right of the door, fov 28.
* **pipReact** (A): Pip, relieved and puzzled; a nervous little smile. (Optional, fills a long verse tail.)

## Pre-chorus 1 (rising hope; still dead, the thread begins)
* **staringCrowd** (B): the crowd standing silently in the open doorway, staring; Pip steps back; nearly still; dust.
* **holdScraps** (B): three zombies hold up scraps of fabric hopefully (`deadHoldUp`, `makeScrap`); the cut lands on "Can you help us look cute".
* **pipDecides** (A): Pip's face; she looks over at the machine; the lamp glints in her eyes; the worried expression turns to a slow smile (`proud`).
* **threadRun** (B): low tracking shot following the pink thread as it is pulled out of the machine across the floor toward the crowd (`makeThreadLine` reveal over `u.p`), dashes appearing, the first tiny ring of colour at the hub (`R` creeping), zombies stop and turn to look.
* **needleReady** (B): `machine_macro.machinePush` slow push-in on the raised needle; ends exactly at its top position on the last frame of the section (the next shot opens with the needle dropping).

## Chorus 1 (the front detonates; the mall is made over)
* **burst** (B): `machine_macro.burstLow`, `fix` 4 beats: on the downbeat the needle drops, the pink front detonates outward (R from about 3 m growing fast), a confetti pop, camera kicks in slightly. The wave crosses the frame.
* **sewMachine** (B): Pip at the machine (`pipSew`, singing), medium, thread flying, sparkles, the front's ring expanding behind her.
* **hemSweep** (B): low macro on one zombie from the feet: the hem sews itself up the body (`K` sweeps by the front), a hop (`hop`) and a sparkle pop when it completes.
* **bodiceSweep** (B): medium on a zombie as bodice, bows and shoes appear (sew parts) and the clouded eyes stitch open (iris, pupil, highlight); lace and ribbons fly in.
* **twirlLow** (B): low wide, five zombies twirling in petticoats (`poseTwirl`), skirts flaring, Pip's silhouette in the middle; a low sweeping dolly.
* **pipHero** (B): Pip centre, arms wide (`poseWide`, `pipSing`), the coloured crowd behind, camera in a gentle orbit; confetti falling.
* **titleStitch** (B): wide of the mall with the embroidered title "Zombie Couture" sewing itself across the air (`Text.title().progress` by `u.p`), zombies striking poses on the beats, slow crane up.
* **coutureHits** (B): four snap poses on the second "zombie couture, zombie couture" (`poseCouture`, one hit per beat); each beat can be a new tight angle (implement as one shot with four camera jumps on beats, or four shots).
* **adorableWide** (B): wide as the front hits the far walls; all zombies in a line strike the pose; confetti; the whole mall is now alive (`alive` on).
* **pipWink** (A): Pip's wink close-up on "adorable!", a sparkle in the eye.

## Verse 2 (playful, faster; the atelier fitting room, alive)
* **fitEstablish** (B): `atelier.fitWide`: Pip pins a hem on the platform (`pipPin`), a queue of zombies waits (`waitLine0..5`).
* **rackPan** (A): `atelier.rackPan` along the garment rack of tiny gowns; a zombie's arm reaches in.
* **tulleCU** (A): `atelier.tableCU`: tulle unrolling, scissors snip, the tape measure.
* **laceMacro** (A): `atelier.laceMacro`: a lace collar being pinned on a zombie.
* **hemPinCU** (A): `atelier.hemPin`: pins going into a hem at floor level, a shoe tapping.
* **swayLine** (B): `atelier.swayLine`: zombies on and beside the platform swaying with arms stretched out wide (`sway`).
* **mirrorShot** (B): `atelier.mirror`: the platform in the three-panel mirror; the zombies pose ("arms stretched out wide").
* **braainsCaption** (B): close on a moaning zombie with the embroidered caption "braaains" sewing itself in across the frame.
* **unpickPride** (B): the seam ripper unpicks "braaains"; "pride" stitches in; the zombie's moan becomes a proud grin.
* **prideWide** (B): the line-up, arms wide, proud; Pip presents them (`pipPresent`).

## Pre-chorus 2 (the runway in the mall, alive)
* **runwayLow** (B): `mall_runway.lowTrack`: zombies strut past in a line (`strut`), catwalk lights coming up.
* **runwayHeadOn** (B): `mall_runway.headOn`: a strutting zombie walks toward camera, hip swing, the turn (`runwayTurn`) and pose.
* **runwayPit** (B): `mall_runway.photoPit`: flashes from the photo pit (at most 3 per second), plush audience, a zombie strikes the T.

## Chorus 2 (bigger; the whole mall is a party)
* **partyWide** (B): `fix` 4 beats: on the downbeat the bunting drops, the party lights snap on (`mall.light` party spots), confetti.
* **rosetteTop** (B): `mall_rosette.top` or `topTilt`: the overhead rosette draws itself on (`args.draw`), rings of zombies (`rings`) rotating with the beat.
* **petalLow** (B): `mall_rosette.petalLow`: low across the rings toward the pedestal.
* **whipRing** (B): `in: whip`; `whipA` to `whipB` across the rings.
* **lockstepFront** (B): a line of zombies in lockstep dancing toward camera (`lockstep`).
* **coutureHits2** (B): as `coutureHits`, bigger.
* **confettiPeak** (B): confetti storm, everyone cheering (`cheer`), Pip in the middle.
* **crowdCheer** (A): tight on a cheering zombie or two.

## Bridge (slow, near spoken; the atelier as a candlelit tea party at dusk)
* **teaWide** (B): `atelier.teaWide` (mode `tea`): Pip and six zombies at the round table, candles flickering.
* **teaCU** (A): `atelier.teaCU`: over Pip's shoulder to a zombie sipping (`sitSip`).
* **teaTop** (A): `atelier.teaOverhead`: the table from above, cups, cake stand, candles; a clink.
* **armDrop** (B): close on the last guest as her arm pops off like a cork (it flies past her chin), lands on the table's rim and rolls to the saucer; she stays unbothered (`sitIdle`).  Camera on the open (SW) side at 2.9 m, fov 30 to 28.  Runs `frame.armGag` (`web/gags.js armGag`, see docs/FILM_RUNTIME.md).
* **armSew** (B): a wider cut on the same side: Pip (winking) hurries over, stoops across the table to the arm on the saucer, lifts it and carries it back to the socket.  (From inside the horseshoe her head fills the lens during the stoop: four cameras tested, this one reads best.)
* **armStitch** (B, `b_05b`): "a little love": a two-shot from high on the far side of the table: the zombie faces us, Pip stands behind her shoulder, winking, stitching; the bow pops and sparkles on the last frames.  Every camera lower than this or on the open side is filled by Pip's head or the zombie's own (tested from 9 positions).
* **threadLift** (B): Pip, who has put the needle down after the bow, raises it beside her (huge) head; a thread of light leaves the tip (`THREAD_SPECS.lift`: 480 segments, helix 7 cm, glow) and climbs through the ceiling while the skylight slides open (`args.skylight` 0 to 1) and the dusk sky comes up (`also: ['sky']`, `args.dawn`); the camera tilts up along it.
* **skyReveal** (C): the camera rides the thread up through the open skylight and levels out over the atelier roof to the horizon of the quilt world in the first light (custom rig: it never points straight down); the thread runs on to the sky; out on a warm dip (`0xfff0d0`) into the finale.

## Final chorus (huge, triumphant; the mall finale)
* **finaleWide** (B): Pip on the pedestal (belting, arms wide), the horseshoe of 14 behind her (`mall.formation.horseshoe`), the roof still closed but starting to open (`roofAt`), a slow rising push; comes in on a warm dip (`0xfff0d0`).
* **finaleOrbit** (B): slow orbit around the pedestal at 7 m (outside the outer ring, which stands at 4.55 m), rising; the rings dance.
* **finaleLow** (B): worm's-eye hero angle through the dancers' raised arms up at Pip, the roof opening above her.
* **sunriseRoof** (B): from the floor at the far wall, tilting up across the mall into the ceiling: the ten felt petals fold back from the hole and the sunrise comes in (`args.cloudUnder`: clouds seen from below glow gold); the shop signs ("GRAND REOPENING") in the foreground.
* **pipBelt** (A): Pip close from slightly below, singing full voice (`pipSing style 'belt'`), the horseshoe cheering behind her, confetti in front of the lens.
* **confettiPeak / twirlRing / lockstepFront / pipHero2** (B, `v: 3`): the chorus 2 shots again under the opening roof (`roofAt`).
* **finaleTop** (B): straight down on the rosette (`mall_rosette.top`, turned the other way from chorus 2) with the sun on the pedestal.
* **coutureHits3** (B): the biggest hits.
* **craneOut** (C, 6.4 s): `mall_roof.craneOut`: from behind the horseshoe (Pip facing us on the pedestal, the dancers waving) up through the open skylight, out over the roof and back until the mall is a patch in an enormous quilt; the pink ring of colour (the world is NOT alive: only what the front crossed is coloured) spreads over the grey.

## Outro (fading moans, machine clicks)
* **aerialQuilt** (C, 1.9 s): the crane-out lands: a slow orbit round the finished mall at 70 m (`sky.orbitWorld`, the mall a cake on the quilt with its roof open like a flower, the pink ring at the horizon).
* **horizonDrift** (C, 1.3 s, `o_01b`): ground level on the quilt, a gentle glide toward the felt sun coming up over the cushion hills (`sky.horizon`): the postcard of the finished world.
* **clickCU** (A): the presser foot and needle clicking on the beat in the machine's cold light (`alive 0`, the macro rig pulled back 2.3x so the seam and the fabric read).
* **shyZombie** (B): profile two-shot from the open side (the brown pillar stands on the other side of Pip's bench, so any camera there is blocked): the last grey zombie (`hold`: it stays cloth-grey while the mall is alive) shuffles in (`shy`), hides half its face behind its arm, peeks; Pip waits at the machine with a kind smile.
* **needleDown** (B): the same side, closer: she holds the needle out (`pipNeedleDown`), one tiny stitch, and the camera sinks to the zombie's feet as the first colour comes back there (`k` 0 to 0.2: the thread climbs from the hem).  Cut to the warm dip and the card.

## Card
* **card** (A): `card.card`: the care-label end card (`args.reveal` 0 to 1: 0 to 0.2 the border stitches itself on, then the credits weave in line by line), `in: dip:0xfff4e0`, held for the last 2.2 s of the 6 s tail.
