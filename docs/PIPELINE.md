# Pipeline: from the mp3 to shots, sheets and QA

Everything here has been run end to end on a stand-in song (a text-to-speech song at 128 BPM, see section 5), so when the real mp3 arrives the only new step is step 1 below; the rest is the same commands with different files. Work from the repo root. All timings are for the shared 2-core box with other jobs running.

## 1. The chain

| # | command | takes | writes | gate to pass before going on |
|---|---|---|---|---|
| 1 | `nohup analysis/run_audio.sh data/song.mp3 > out/audio_run.log 2>&1 &` | first run 9 min (vocal separation is 8 of them), cached re-run 25 s, `--stages 7,8` 5 s | `data/timing.json`, `data/audio/` (`sheet.html`, `sheet.png`, stage products) | the summary at the end of the log; then listen through `data/audio/sheet.html` |
| 2 | `PYTHONPATH=analysis python3 -m zcaudio.schema data/timing.json` | 1 s | (prints OK) | `OK` |
| 3 | `python3 tools/make_shots.py` | 0.2 s | `data/shots.json`, `docs/SHOTS.md` | exit code 0 (no errors); every warning read |
| 4 | `python3 tools/qa_shots.py` | 0.2 s | (stdout), `--json FILE` optional | exit code 0; warnings read |
| 5 | `tools/rq.sh python3 -u tools/sheet_shots.py > out/sheets.log 2>&1 &` | 66 shots x 3 frames: 10 to 15 min | `out/sheets/sheet_01.png` ... | look at every sheet |
| 6 | `tools/rq.sh python3 -u tools/consistency.py --scene film > out/consistency.log 2>&1 &` | 1 to 3 min (71 s for 5 times on the test scene at 320x180; the film adds its page build, 15 to 40 s) | `out/consistency/report.json` | `PASS` (max difference 0) |
| 7 | the render: `tools/render_all.sh` with review, master, short or thumb (it drives the frame farm `tools/farm.py`, whose header explains the options) | hours | `out/frames/...` | none here; step 8 afterwards |
| 8 | `python3 tools/qa_frames.py out/frames/<dir> --shots data/shots.json [--twos]` | 2 s per 240 frames at 720p | (stdout), `--json FILE` | exit code 0 |

Renders (5, 6, 7) go through `tools/rq.sh`, one at a time, in the background with a log, and are polled with `tail`. Steps 3 and 4 are instant: run them after every edit of `data/storyboard.json`. The whole film re-cuts itself from the song, so a new `data/timing.json` needs steps 3 to 6 again (the sheet cache notices changed shots and re-renders only those).

Order of trust: step 2 says the file is well formed, step 3 that the storyboard can be laid on this song, step 4 that the cuts are on the music, step 5 that it looks like the film, step 6 that a frame is a pure function of the song time (so the render farm may cut the film into any pieces), step 8 that the rendered frames have no blank, frozen, jumping or flashing stretches.

### When the mp3 arrives

    cp <the download> data/song.mp3
    nohup analysis/run_audio.sh data/song.mp3 > out/audio_run.log 2>&1 &
    tail -f out/audio_run.log                    # ends with a summary: tempo, matched words, one line per section, warnings
    PYTHONPATH=analysis python3 -m zcaudio.schema data/timing.json
    python3 tools/make_shots.py && python3 tools/qa_shots.py
    tools/rq.sh python3 -u tools/sheet_shots.py > out/sheets.log 2>&1 &

Before trusting the timing, check the two things the stand-in showed can go wrong: open `data/audio/sheet.html` and confirm by ear that every section starts on the right bar (in particular the choruses, which repeat the same words), and that the bar counter's "1" lands on the downbeat through the whole song. Wrong section starts are pinned in `data/overrides.json` (`{"sections": {"chorus3": {"start": 124.10}}}`), then `analysis/run_audio.sh data/song.mp3 --stages 7,8` (5 s) and steps 2 to 4 again. `analysis/README.md` has the full override format.

## 2. What each tool checks

### `tools/make_shots.py` (the resolver)

`python3 tools/make_shots.py [--timing data/timing.json] [--storyboard data/storyboard.json] [--out data/shots.json] [--doc docs/SHOTS.md] [--no-doc] [--check] [--quiet]`

Implements `docs/STORYBOARD_FORMAT.md` and nothing else: spans, anchors with offsets, the weight / min / max fill with integer beat snapping, `fix`, `opt`, front keyframes and `alive`. A cut that is wrong here is wrong in the film, so the last thing it does is audit every cut against the beat grid and print `cuts: N: M within 20 ms of a beat (worst X ms), K word-forced off the beat`. Exit code 0 only if there is no error; on an error nothing is written. `--check` resolves and audits without writing anything.

The beat readers (`beatAt`, `timeOfBeat`, `barPos`, `beatPulse`, `cutFirstWords`) are a port of the JavaScript in `docs/TIMING_SCHEMA.md`; `node tests/check_readers.mjs` runs the JS and `tests/test_make_shots.py` compares the two at random times (agreement to about 1e-16).

Decisions the format leaves open, and how they show up:

* Free cuts are whole beats; a cut forced by a word (`lineNwM`, `lineN:end`) keeps the word's exact time and is marked `snap: word` (`w` in `SHOTS.md`). All others are `b` (beat) or `s` (section edge).
* An anchor a little before its section start (a pickup) moves to the section start, with a warning.
* Too little room: `opt` shots are dropped first (`dropped (opt)`), then `min` values are relaxed (`relaxed`), then `fix` lengths are truncated. Too much room stretches shots beyond `max`.
* The stand-in output never overwrites the real one: `--timing data/timing.<tag>.json` writes `data/shots.<tag>.json` and `docs/SHOTS.<tag>.md` unless `--out` / `--doc` are given.
* Extra fields in `shots.json` beyond the format: `snap`, `out` (a copy of the next shot's `in`), `sections`, `source`, `dropped`, `sung`, `at`.

### `tools/qa_shots.py` (the cuts against the music)

`python3 tools/qa_shots.py [--shots data/shots.json] [--timing data/timing.json] [--json FILE] [--quiet]`

Errors (exit code 1): the list is not contiguous from 0 to the duration, a shot under 0.5 s, a duplicate id, the audio id differs from the timing's, a cut more than 20 ms from a beat that is not on a word start, a cut inside a word held longer than 0.6 s unless the transition is `flash`, `whip` or `dip` (a `seam` wipe does not excuse it), more than 3 `flash` cuts in any 1 s.

Warnings: a chorus average outside 1.7 to 1.9 s, verse 1 or the bridge not longer than the choruses, a section average outside 1.2 to 6 s, shots under 0.8 s.

It also prints the shot statistics per section, the transition table, and the estimated render time from the cost classes: A 3.0 s, B 3.5 s, C 4.5 s per rendered frame at 720p, for ones (every frame; the choice for this film) and twos (`motion=twos`, half the frames). These are 720p figures for an idle machine: the 1080p master measured about 7 to 12 s per frame.

### `tools/sheet_shots.py` (what the director looks at)

`tools/rq.sh python3 -u tools/sheet_shots.py [--shots data/shots.json] [--timing ...] [--only id,section,...] [--w 480 --h 270] [--frames 3] [--out out/sheets] [--motion ones|twos|mixed] [--batch 24] [--force] [--tile-only] [--placeholder]`

Renders progress 0.1, 0.5 and 0.9 of every shot through the film (`shot=film`, one browser page per 24 shots, the shader compile is paid once per page, a failed page is retried twice) and tiles them, 8 shots per `sheet_NN.png`. `--only m_i1,chorus2` picks shots or whole sections; `--placeholder` tiles synthetic pictures without a browser (layout test); `--tile-only` tiles what is cached.

Each row: shot id and cost badge (A green, B yellow, C red), template, start-end, length in seconds and beats, section, the transition in, whether the cut is on a beat, a word or a section edge, the lyric line sung at the start (italic, "next line, not yet sung", when the shot starts before the line does), the storyboard note, and, top right, the median render time of the shot's frames at the sheet size (kept in `times.json` beside the frames, so re-tiling still shows it). Every picture is captioned with its progress and song time and has a thin outline, so a black frame (a dip) is not mistaken for a missing one. Frames are cached as `<out>/frames/<w>x<h>/<id>_<pct>_<key>.png`, where the key hashes the shot's template, args, times, cost, transition and the timing file: change the storyboard or the timing and only the affected shots render again (their old frames are deleted). A change in the film code is not noticed: use `--force`. Exit code 1 if any frame failed (it is drawn as a red tile with the error).

### `tools/consistency.py` (frames are pure functions of the song time)

`tools/rq.sh python3 -u tools/consistency.py [--scene auto|film|story] [--n 6] [--times 1.5,4,7.2] [--shots data/shots.json] [--timing ...] [--w 320 --h 180] [--motion ones] [--fresh] [--out out/consistency]` (`--timing` defaults to the timing file named in the shots file; the times are the midpoints of `--n` shots)

In one page it renders the same song times in three orders: ascending; each time right after a jump to the far end of the film; shuffled. With `--fresh` the first three times are also rendered in a new page. It compares PNG bytes and reports, per pair, the largest absolute pixel difference and the number of differing pixels; identical setups must give 0. Exit code 0 pass, 1 fail (an amplified `diff_*.png` is written), 2 the page did not build. `--scene auto` uses the film when `web/film/film.js` builds and falls back to the 10 s test scene (`shot=story`). Run it after any change to the film or the shaders, and before a long render; the farm depends on it.

### `tools/qa_frames.py` (the rendered frames)

`python3 tools/qa_frames.py <frames_dir> [--shots data/shots.json] [--fps 24] [--twos] [--json FILE] [--first N] [--limit N] [--quiet]`

The frame number is the last number in the file name (`f_00123.jpg` is frame 123, the farm's absolute numbering). Works on 1/8 downscaled copies (240 frames at 1280x720 in about 2 s).

* blank: mean luma under 2 or std under 1. An error, except at the very start and next to a planned `dip`.
* frozen: more than 3 identical frames in a row. 4 to 12 frames is a warning, more is an error; with `--twos` identical pairs are normal; the end card is not counted.
* jump: a frame-to-frame difference above max(12, 5 x the local median) that is not at a planned cut of `shots.json` (plus or minus 1 frame, 2 with `--twos`). An error. A planned cut with no visible change is a note.
* flash: mean luma up by more than 0.15 over the previous frame, or more than 25 % of the picture above 250; adjacent flash frames count as one; more than 3 in any 1 s is an error (the photosensitivity guideline).
* drift: per shot, mean luma and colour at the start and end, the range and the largest change. A report, not an error.

Without `--shots` every hard cut is reported as an unplanned jump (expected on a clip that has cuts).

## 3. Reading the outputs

`make_shots.py` messages. The ones that need a decision:

| message | meaning | what to do |
|---|---|---|
| `X and Y are 0.00 s apart (non-ascending); X would get no time` | two anchors resolve to the same moment | move one anchor later, or mark one `opt` |
| `minimums (N beats) do not fit in M beats; relaxed` | the words are denser than the shots' `min` values allow; the shots are shortened, cuts stay on beats | lower `min`, drop a shot, or accept; many of these in a chorus mean the storyboard has too many shots for the words |
| `dropped (opt): ...` | an optional shot was removed to make room | none, unless you want it: then anchor it later or drop another |
| `N beats to fill but the maximums add up to M; shots stretched beyond max` | not enough shots for the time | add shots, raise `max`, or accept a long hold |
| `anchor ... is N ms before the section start (a pickup)` | an anchor sits a hair before the bar line, the cut moves to the bar line | none |
| `storyboard section 'x' is not in the timing` | the analysis found different sections than the storyboard names | fix `data/overrides.json` / lyrics, or the storyboard |
| `no alive anchor` | the storyboard names no moment the world comes alive | add `alive` |

`docs/SHOTS.md`: a table per section (id, start-end, length, beats, template, transition, cost, snap, the lyric line at the start, note), a summary (shot count, average, minimum, maximum per section), the total, the dropped `opt` shots and the cut-versus-beat audit (the header line gives the number of front keys and the time the world comes alive). It says at the top what timing it was built from; a file built from the stand-in carries a banner saying so.

`qa_shots.py` report: the `cuts:` line (`on_beat`, `downbeats`, word-forced), the section table, the transition counts, the cost table, the dropped shots, then warnings and errors. Errors are never acceptable; warnings are the director's call.

`sheet_shots.py`: check that each shot shows what its note says, that the three frames of one shot are the same shot (not a cut inside it), that the cost badge is honest (a C shot should have earned it), and that the lyric shown is the line the shot is about.

## 4. Numbers to expect (the stand-in, 128 BPM, 171 s, the director's storyboard)

* Stand-in (earlier test numbers): 66 shots, 175.00 s with a 4 s card; 65 cuts: 54 within 20 ms of a beat, 11 word-forced. Estimated render 4.0 h on ones, 2.0 h on twos.
* The real song, as built: 81 shots, 177.00 s (171.00 s of audio plus a 6 s card); 80 cuts: 28 on the beat (worst 20 ms), 51 forced to an exact word time, none off the beat and unexplained; `qa_shots.py` 0 errors. Estimate from the cost classes: A 19 shots / 37 s, B 58 / 126 s, C 4 / 14 s, about 4.1 h on ones at 720p on an idle box (the 1080p master measured 7 to 12 s per frame, so plan for 8 to 14 h).
* Analysis of the stand-in: 128.00 BPM, first downbeat 0.344 s, beat confidence 0.97, 92 bars, 9 sections; 80 of 242 lyric words matched the recognised words (33 %; low because it is synthetic speech, a real vocal should do better).
* Analysis of the real song: 126.18 BPM (local range 125.36 to 126.99, deviation from a constant grid +/-17 ms), first downbeat 0.413 s, beat confidence 0.94, downbeat confidence 1.0; 198 of 242 words anchored to the recognised words, 43 interpolated, 1 pinned by hand (`data/overrides.json`); 10 sections.
* Runtimes of the stages: normalize 4 s, vocal separation 502 s, ASR 14 s, alignment 4 s, beats 4 s, features 8 s, timing 0.1 s, sheet 4 s.

## 5. The stand-in and the mini files

| file | what | made by |
|---|---|---|
| `data/audio_standin/standin.wav`, `standin.truth.json` | a text-to-speech song with the real lyrics: 4-bar backing intro, nine sections at 128 BPM with a bar of backing between them, kick / clap / hat, 171 s, a long instrumental tail | `python3 tools/standin_song.py` |
| `data/timing.standin.json` | the real pipeline's result on it (with 2 word pins and a `chorus3` start pin in `data/audio_standin/work/overrides.json`) | `analysis/run_audio.sh data/audio_standin/standin.wav --out data/audio_standin/work` |
| `data/timing.mini.json` | 30 s, beats at exactly 120 BPM (first downbeat 0.25 s), three sections: verse 1 (2 lines, 4.25 to 8.25 s), pre-chorus 1 (2 lines, 10.25 to 14.25 s), chorus 1 (3 lines, 16.25 to 22.25 s), an intro of 4.25 s before it; hand made, valid | `python3 tools/standin_song.py --mini data/timing.mini.json` |
| `data/shots.standin.json`, `docs/SHOTS.md` | the director's storyboard, with `o_02` moved off the section start, resolved on the stand-in | `python3 tools/make_shots.py --timing data/timing.standin.json --storyboard tests/storyboard_standin.json --doc docs/SHOTS.md` |
| `data/shots.mini.json`, `docs/SHOTS.mini.md` | 13 shots (with the card) for the mini timing, from `tests/storyboard_mini.json` | `python3 tools/make_shots.py --timing data/timing.mini.json --storyboard tests/storyboard_mini.json` |

`data/timing.json`, `data/shots.json` and `data/song.mp3` are reserved for the real song; no tool here writes them unless it is run with the default arguments on the real files. To try any tool on the stand-in, pass its `--timing` / `--shots` (for example `tools/rq.sh python3 -u tools/sheet_shots.py --shots data/shots.mini.json --out out/sheets_mini`).

## 6. Tests

All are plain scripts (pytest also collects them); none needs the network.

| command | covers | takes |
|---|---|---|
| `python3 tests/test_make_shots.py` | 37 tests: every anchor form and offset, w / min / max / fix / opt / in / at, fill exactness, beat rounding at ties, word-forced cuts, pickups, dropping and relaxing, error cases, front keys, `alive`, random storyboards, the derived file names, and the Python readers against the JS (needs `node`) | 20 s |
| `python3 tests/test_qa_shots.py` | 10 tests: structure, off-beat and held-word cuts, flash budget, statistics, cost table, transitions, a corrupted stand-in file | 5 s |
| `python3 tests/test_sheet_shots.py` | 7 tests: sheet size and count, `--only` / `--frames`, the frame cache key (a changed shot is drawn again, the others are kept), missing tiles, and the timing default of `consistency.py` (placeholder pictures, no browser) | 3 s |
| `python3 tests/test_qa_frames.py` | 9 tests: synthetic sequences with blank, frozen, jump, flash and drift, twos, and the real 10 s clip in `out/frames/motion_ones` (skipped when absent) | 1 to 2 min |
| `node tests/check_readers.mjs <timing.json> '<times>' '<beats>'` | the helper the first test calls (not run alone): evaluates the JS readers printed in `docs/TIMING_SCHEMA.md` at the given times and beat numbers and prints JSON | 1 s |

Fixtures: `tests/storyboard_test.json` (every anchor type and fill case, resolved against `tests/timing_test.json`, a synthetic 120 BPM song), `tests/storyboard_standin.json`, `tests/storyboard_mini.json`. `python3 tests/test_make_shots.py --write-fixtures` rewrites the synthetic ones.

## 7. Known limits

* The analysis can place a section start on the wrong bar when the speech recogniser matches a repeated lyric to the wrong repeat (on the stand-in, `chorus3` was 2 bars early). The tools cannot see this, because a timing with the section in the wrong place is still well formed. Check every section start by ear in `sheet.html` and pin.
* `qa_shots.py` checks cuts against the beat grid and the words, not against the picture; a cut that is on the beat but in a bad place is only visible in the sheets.
* The cost estimate uses a fixed table (A 3.0 s, B 3.5 s, C 4.5 s), not measured times; `python3 tools/bench.py <style> <shot> <w> <h> [n]` measures a real steady-state frame.
* `sheet_shots.py` renders at the sheet size (480x270 by default), so a shader that behaves differently at 720p is not seen; the sheets are for composition and timing, not for the final look.
* `consistency.py` compares bytes: any nondeterminism, such as a time-dependent random seed, fails it, on purpose.
