# Audio analysis pipeline

Turns a finished song (`song.mp3`) and its lyrics (`data/lyrics.txt`, with `[Section - direction]` tags) into everything the renderer needs to be a pure function of time: word / line / section times, beats and bars, five band levels, drum hits, the vocal level, and mouth (viseme) events. One command, one output file.

```
analysis/run_audio.sh <song.mp3> [lyrics.txt] [--out DIR] [--stages 0-8] [--fps 24] [--set a.b=c ...]
```

Writes `data/audio/*` (stage products, diagnostic sheets) and **`data/timing.json`** (schema: `docs/TIMING_SCHEMA.md`, which also has tested JS readers for `beatAt`, `env`, `hit`, `mouth` ...). Lyrics default to `data/lyrics.txt`. The diagnostic sheets to open first are `data/audio/sheet.png` (overview) and `data/audio/sheet.html` (player with karaoke, tap-along correction).

* Needs Python 3.10+, `ffmpeg`, and `pip install -r analysis/requirements.txt` (PyPI only). Model weights are read from `analysis/models` (or `$ZC_MODELS`); nothing is ever downloaded at run time.
* Cost on this box (2 shared cores, one thread per library, `nice -n 19`): first run about 6 min, of which vocal separation is 5 min for 3 min of audio; every later run with the same audio is about 25 s, because stage results are cached by content hash. Stages run strictly one after the other.
* Re-run only what changed: `--stages 3,4,7,8` after touching lyrics or config; `--stages 7,8` after editing `data/overrides.json` or `data/pron.json` (0.1 s + sheet).
* A full run ends with a summary (tempo and bar phase, how many lyric words were matched, one line per section with its bar range, pronunciations to check, warnings, and where the sheet and the overrides file are). Read that first.

## Stages

| # | stage | what it does | product |
|---|---|---|---|
| 0 | normalize | ffmpeg decode to 44.1 kHz stereo wav (+ 16 kHz mono), loudness; `audio_id` = hash of the decoded samples keys every cache | `norm.wav` `norm_16k.wav` `meta.json` |
| 1 | separate | vocal / instrumental split with `audio-separator` + `UVR-MDX-NET-Voc_FT` (MDX-Net, CPU, 1 thread). Cached by audio + model + settings, so it runs once per song | `vocals.wav` `inst.wav` `sep.json` |
| 2 | asr | sherpa-onnx zipformer (gigaspeech) on the vocal stem, 12 s windows: word times at 40 ms resolution. Cached by model + params + stem content | `asr.json` |
| 3 | align | lyrics vs recognised words (below) | `align.json` |
| 4 | beats | onset envelopes -> tempo -> DP beat tracking that follows tempo drift -> smooth refinement onto real onsets -> downbeat by cue voting | `beats.json` |
| 5 | features | band levels at `fps`, onset strength, vocal level, kick / clap / hat times | `features.json` |
| 6 | visemes | CMUdict (+ compounds, letter-to-sound rules, `pron.json`) -> 8 mouth classes timed inside each word, vowel-weighted, stretched for held words | `visemes.json` |
| 7 | timing | assembles sections / lines / words / beats / frames, applies `overrides.json`, validates against the schema, writes | `data/timing.json` |
| 8 | sheet | PNG overview and HTML player / correction helper | `sheet.png` `sheet.html` |

`state.json` in `data/audio` has per-stage seconds, cache hits and warnings. Warnings also land in `timing.json` `quality.warnings`.

### Stage 3 in a paragraph

A DP aligns the lyric words to the recognised words (phonetic + character similarity; 1:2 and 2:1 merges; cheap gaps for extra recognised words and for lyric words the recogniser missed), so misheard, dropped and extra words all just cost a little. Matches with similarity >= 0.62 become time anchors. Two kinds of anchors are then distrusted: (a) the recogniser emits the first word after a silence early (the previous song's opening word came out 2.3 s early), so an anchor that sits in vocal silence is demoted to "interpolated" but its token time is remembered; (b) a lyric word matched to the wrong recognised word (a mangled recognition that happens to look like it, a stray "and" / "the") squeezes or stretches the words around it, so where the words between two anchors would have to be sung at less than 60% of their model duration (`align.squeeze_factor`; real gaps measure 0.9-1.3, wrong anchors 0.2-0.4) the least reliable anchor of that stretch is dropped, but only if dropping one or two anchors actually gives the words room; if not, the words are the odd ones out (a line the singer skipped, a section written twice in the lyrics and sung once), the anchors stay, and the words are crammed into the room there is and flagged. Unanchored words are placed between anchors along the *voiced* stretches of the vocal stem: a second small DP assigns consecutive groups of words to consecutive voiced segments so that segment length matches the words' expected sung length, breaks fall on line boundaries, voiced segments with no words (moans, echoes) are left empty and reported as `vocalizations` (an empty segment costs extra unless the voiced time clearly exceeds what the words need: when voiced time is scarce the words spread over every segment instead of piling into the last one), and a demoted word may sit in the stretch between its token and the next voiced onset (a soft consonant the voice detector missed). Finally every word start is snapped to a vocal onset within 80 ms (a line's first word may snap 150 ms back to the phrase onset) by a monotone DP, and word ends follow the vocal energy, each ending with its own voiced run. Words are never dropped; a word the audio does not support is flagged rather than lost. When a stretch holds far more words than the audio can (wrong lyrics, a 20 s excerpt), the words are spread over the voiced time with a warning instead of failing.

Confidences: recognised words 0.5-1.0 by match quality, interpolated 0.38 / 0.30 / 0.22 by distance to the nearest recognised word, pinned 1.0. The share of anchored words (`quality.alignment.anchor_share`) is the health number: 0.78 on the previous song; below 0.35 the run warns that the lyrics may not match the audio.

### Beats

The tempo is not assumed constant. The tracker (autocorrelation + fold for the global tempo, log-tempo prior centred on `beats.bpm_hint` = 130 with range 90-180, Ellis-style DP, then a robust re-snap onto the onset peaks and a Whittaker smoother) follows drift and tempo steps. The downbeat is the beat position (out of 4) that wins a vote of harmonic change, bass energy, loudness rise, kick and backbeat. `beats`, `bars`, `tempo.bpm` (robust straight-line fit through the beat times, so the typical tempo), `tempo.bpm_range`, confidences and `deviation_from_constant_ms` are in `timing.json`. A constant onset lead of 19 ms is added (spectral-flux peaks lead the true onset by about 20 ms; calibrated on synthetic tracks with exact truth, residual bias -1.6 to -2.8 ms).

## Check by ear first (new song)

1. `data/audio/sheet.html`: play the song, watch the karaoke line and the bar counter. Tempo / downbeat: is the "1" of each bar on the downbeat (kick + bass + chord change), do the beat ticks stay on the kick through the whole song? `quality.beats.confidence` above 0.8 is solid; a half-time or double-time tempo is the classic failure (`--set beats.bpm_hint=...` moves the prior; `overrides.beats.constant` or `downbeat_shift` fix it exactly).
2. Sections: `sections[].start / end` are bar lines; `sections[].t0 / t1` are the sung extent. Sections that start or end on the wrong bar are pinned in `overrides.sections`.
3. `quality.review` lists the lines to listen to first (low confidence, mostly interpolated, or words squeezed under 80 ms, which means the lyric and the audio disagree there); the end-of-run summary prints the first eight. The PNG marks interpolated words orange, dashed = low confidence.
4. `quality.pronunciations_to_check`: words pronounced by rules; fix in `data/pron.json`. (All 126 distinct words of `data/lyrics.txt` are in CMUdict, "forevermore" as a compound, so this list should be empty for Zombie Couture.)
5. `quality.warnings` should be empty; `quality.alignment.anchor_share` should be 0.6+; `vocalizations` shows what the vocal stem contains that the lyrics do not explain (zombie moans in the bridge and outro will show up here, which is right).

## Hand corrections

Nothing is edited in `timing.json` directly. Put corrections in **`data/overrides.json`** (applied last, by stage 7) and re-run `--stages 7,8` (about 5 s). Runs of interpolated words next to a pin are re-spaced between their anchors; a pin never silently reorders recognised words (a warning says so). Broken JSON stops the run instead of being ignored; unknown ids and mismatching `expect` words are reported as warnings.

```json
{
  "words": {
    "chorus1.3/2": {"t0": 47.31, "t1": 47.62, "expect": "petticoats"},
    "57":          {"t0": 12.0}
  },
  "lines":    {"verse1.2": {"t0": 9.8, "t1": 13.2}},
  "sections": {"chorus1": {"start": 41.2, "end": 62.9}},
  "beats":    {"downbeat_shift": 1,
               "constant": {"bpm": 130.6, "first_beat": 0.42, "first_downbeat": 0.42}},
  "vocalizations": [{"t0": 88.0, "t1": 90.5, "kind": "moan"}]
}
```

* Word keys: `<line id>/<n>` (1-based word in the line; line ids are `<section id>.<n>`, e.g. `verse1.2`, `chorus3.6`, `outro1.1`) or the global word index (`words[].i`). `expect` guards against the numbering having moved: a mismatch is a warning. `t1` defaults to a sensible length.
* Section ids: `verse1 prechorus1 chorus1 verse2 prechorus2 chorus2 bridge1 chorus3 outro1` for the Zombie Couture lyrics (the `[Final Chorus]` tag is `chorus3`). A pinned `start` / `end` wins; the neighbour that was not pinned gives way if they would overlap.
* `beats.downbeat_shift` rotates which beat is "one" (-3..3). `beats.constant` replaces the tracked grid by an exact one (use it if the song is DAW-perfect and the tracker wobbles, or for a wrong tempo).
* `vocalizations`, if present, replaces the detected list.
* **`sheet.html` writes this file for you**: play, click "t0 = now" / "t1 = now" next to a word, "start = now" / "end = now" for a section, or press "tap" on a word and then **N** at each following word start (tap-along; Esc stops). Copy or download the box, save it as `data/overrides.json`, re-run `--stages 7,8`. The pinned words show blue in the next sheet.
* `data/pron.json`: `{"couture": "K UW0 T UH1 R", "braaains": "B R EY1 N Z"}` (ARPAbet, stress digits on vowels) overrides pronunciations for the mouth shapes and the duration model; re-run `--stages 3,6,7,8`.

Wrong tempo prior for a section-heavy song: `--set beats.bpm_hint=128 --set beats.prior_sigma_oct=0.3`. Snapping too eager (words jump to instruments in the stem): `--set align.snap=false` or `--set align.onset_window_ms=50`. Mouths late: `--set visemes.lead_ms=30`.

### Supplying stems yourself

If the separated vocal is poor (or a DAW export exists): run stage 0, drop your `vocals.wav` (and `inst.wav`, the backing without vocals) into `data/audio/`, then run `--stages 2-8`. The ASR cache is keyed by the stem's content, so a new stem is never confused with the old one. Both files should be the same length as `norm.wav` and time-aligned with it (any sample rate, mono or stereo).

## Settings

`--set section.key=value` (JSON values) or `--config file.json`; defaults live in `zcaudio/common.py` `DEFAULTS`. The ones worth knowing:

| key | default | meaning |
|---|---|---|
| `fps` (or `--fps`) | 24 | frame rate of `frames`; any value works, the renderer interpolates |
| `beats.bpm_hint`, `prior_sigma_oct`, `bpm_min`, `bpm_max` | 130, 0.6, 90, 180 | tempo prior; `prior_sigma_oct` large = weak prior |
| `beats.tight`, `smooth_lambda` | 120, 60 | stiffness of the tracker / smoothness of the refined curve (lower = follows tempo changes faster) |
| `beats.downbeat_shift` | 0 | rotate the bar phase |
| `align.snap`, `onset_window_ms`, `phrase_start_back_ms` | true, 80, 150 | onset snapping |
| `align.anchor_sim` | 0.62 | minimum match similarity to trust a recognised word as a time anchor |
| `align.squeeze_factor` | 0.6 | an anchor is dropped when the words between it and its neighbour would have to be sung faster than this fraction of their model duration (0 = never drop) |
| `sections.pickup_beats` | 2.25 | a first word up to this many beats before a bar line is a pickup into it |
| `features.gamma` | 1.7 | contrast of the band levels |
| `visemes.lead_ms` | 0 | shift mouth events earlier |
| `asr.hotwords` | false | not supported in this build (raises a clear error); the alignment already tolerates recognition errors |

## Known failure modes

* **Tempo octave / downbeat.** A wrong half- or double-time tempo or a downbeat one beat off is the most likely beat error; both are visible at once in `sheet.html`. On the previous song the phase agreed with the reference on 94 of 94 bars, on five synthetic tracks (100, 128, 145 BPM, ramp 126 to 134, steps 124 / 134 / 116) and on the text-to-speech song (128 BPM) bar phase was 100% right.
* **Early first word after a silence** (the recogniser's quirk above): handled by demotion; if it still lands wrong, that line is normally in `quality.review`. The intro line and the outro are the risky places.
* **Moans and non-lyric voice.** Moans in gaps are reported as `vocalizations`, not words (tested by splicing moans into real gaps). A moan right before a phrase, or over sung words, can still pull the first word of that phrase towards it (the recogniser hears a word in the moan): up to 0.9 s off in the worst synthetic case, usually within a line's `quality.review`. The zombie moans of the bridge and outro are where to look.
* **Stacked / gang vocals.** With doubled vocals the recogniser sees fewer words (anchor share dropped from 0.78 to 0.69 on a synthetic doubled stem) and interpolated words in fast shout sections (e.g. "one! two! three!" lists, "Nope! Rain is real") can be 1-2 s off; median word shift stayed 10 ms and 83% of words within 100 ms. Lines are still right to within about a second and every affected line is flagged. Use tap-along on those lines.
* **Speech-like delivery / staccato words** (tested with a text-to-speech version of the lyrics, one word at a time on an eighth-note grid): the recogniser recognises only a third of such words, and some of those matches are wrong. The squeeze check and the surplus-aware segment DP (stage 3) were added for this case; what remains is a tail of interpolated, mostly short function words ("the", "but", "I", "have") placed 0.3-0.5 s early or late inside a run of fast words (p90 183 ms, max 474 ms), and they carry the low confidences (0.22-0.43) that put their lines into `quality.review`.
* **Instrumental bleed in the vocal stem** moves interpolated words more than recognised ones (median 5 ms recognised vs 80 ms interpolated on a synthetic bleed test); the first fix is a better stem (see above).
* **Interpolated words** are placed along voiced time by phoneme weights: fine for a mouth, not for karaoke-grade highlighting. Their `conf` says so.
* **Lyrics that differ from what is sung** (a skipped or added line, a chorus sung fewer times than written). The DP tolerates it: words around the difference keep their times (see the three structural rows below), unsung words are crammed into the room between their neighbours and show up in `quality.review` as "N of M words squeezed under 80 ms". Two things it cannot know: a sung line that is missing from the text can pull a neighbouring word into it (one word 1.7 s off in the test), and a section written twice but sung once can be split between the two copies when the recogniser scrambles a phrase (15 low-confidence words 0.4-3.8 s off). The fix in both cases is to pass `run_audio.sh` a copy of the lyrics that says what is really sung.
* **Very wrong lyrics** (another song's text): the run finishes, warns (`only 23% of the lyric words matched ...`), flags most lines, and still writes a valid `timing.json`.
* **Drum classes.** Kick is reliable (F1 >= 0.996 everywhere); clap and hat are gated by spectral balance and can add or miss hits in dense mixes (clap precision fell to 0.82 when consonant-heavy speech was mixed over the beat, F1 0.90). Sewing-machine clicks and similar SFX in the outro will show up as hats.
* **Ground truth caveat** (validation only): the previous project's line times are line-level, of mixed provenance ('checked', 'vocal' = an older pipeline's estimates that lean late, 'grid' = model-based constant pickup), and a few entries sit in silence. Errors below are relative to that reference; they are an upper bound for the checked lines and partly reference error for the others.

## Validation

`python3 analysis/validation/run_validation.py [--parts main,synth,lyrics,audio,wrong,tts]` (`--out` for the JSON, default `validation/results.json`; everything is regenerable; the whole set takes about 3 min once the P(Bloom) and text-to-speech stems are cached, and each run first refreshes the two base runs with the current code). The song "Upping My P(Bloom)" (174 s, its lyrics, a reference `timing.json` with line starts and a constant bar grid) stands in until the real mp3 exists; synthetic four-on-the-floor tracks (`validation/synth.py`: constant tempo, ramp, tempo steps) give exact truth for beats and drums; a text-to-speech version of the Zombie Couture lyrics (`validation/tts_song.py`) gives exact truth for every word. Everything ran under `nice -n 19`, one thread; `validation/pbloom/data/timing.json` is a complete sample output for renderer development.

Stage 1 (separation) is the expensive one, so it was exercised three ways: the full P(Bloom) song (312 s), the text-to-speech song (322 s, uncached, inside the validation run) and a 20 s excerpt (`--excerpt 30:20 --stages 0,1`: 63 s, stems exactly as long as `norm.wav`, identical to what `audio-separator` produces on its own). Stages 2-8 also ran on that excerpt with the whole-song lyrics (472 words against 20 s of audio: no anchors survive, it warns, spreads the words over the voiced time and writes a valid file in 10 s).

The stage 3 changes of the last round were judged on all of them at once: the P(Bloom) numbers below did not move (bit-identical word times), so the improvements on the speech-like test cost nothing on real singing.

### Lyric alignment (72 line starts vs reference)

| | median \|err\| | p90 | within 100 ms | within 200 ms | max | bias |
|---|---|---|---|---|---|
| first working version | 165 ms | 630 ms | 31% | 60% | | |
| final | **115 ms** | **355 ms** | **43%** | **76%** | 745 ms | -51 ms |
| final, 'checked' lines (17) | 84 ms | 525 ms | 53% | 65% | | +41 ms |
| final, 'vocal' lines (27) | 120 ms | 288 ms | 48% | 74% | | -55 ms |
| final, 'grid' lines (28) | 123 ms | 209 ms | 32% | 86% | | -73 ms |

What moved the numbers: an explicit similarity floor for anchors (weak matches like "Humans" <- "amazon" no longer time a word), demotion of anchors in vocal silence with the remembered token time, segment-aware placement of the unmatched words, sustain-aware slot boundaries after held notes, monotone onset snapping. The bias is negative for lines whose reference came from an older estimate that leans late. There is no word-level reference; as an internal check 74.6% of word starts sit within 50 ms of a vocal-stem onset and 370 of 472 words (78%) are timed by the recogniser.

### Beats and sections (P(Bloom))

* Tempo 130.621 BPM (reference 130.63); local tempo 129.6-131.4 BPM; beats wander -120 to +63 ms against a constant grid, so the reference's constant bar grid is valid only in the middle of the song: there (40-120 s) my bars differ by median +15 ms, max 31 ms; over the whole song by -15 ms median, -112 / +23 ms p10 / p90. That difference is the song's own drift, not tracker error: strong kick hits sit within 30 ms of my beats 92% of the time (median +7 ms, in every part of the song) but within 30 ms of the reference's constant grid only 51% of the time (segment medians -64 to +25 ms). All 94 reference bars are my downbeats. Confidence 0.946 (beat 0.923, downbeat 1.0), jitter 3.1 ms.
* 11 section starts: 9 on the same bar as the reference (within 0.11 s), 11 of 11 within one bar; the two others are one bar off. verse3: the vocal enters 1.4 beats after a downbeat, 2.6 beats before the next; the reference counts that as a pickup, the default rule (a first word up to 2.25 beats before a bar line is a pickup into it) does not. `--set sections.pickup_beats=2.75` would match all but the outro, but then any first word that comes 1.3+ beats after a downbeat also becomes a pickup, so the default stays and the arrangement decides by hand (`overrides.sections.verse3.start`). outro: a definition difference (the reference outro starts where the last chorus ends, mine where the first outro word is sung).
* Synthetic (exact truth, five tracks: 100, 128, 145 BPM, ramp 126 to 134, steps 124 / 134 / 116): beat error median 1.5-3.4 ms (a constant -1 to -3 ms bias remains), max 5.8 ms, `F70` (beats matched within 70 ms) >= 0.996, bar phase 100% on all five, `tempo.bpm` within 0.03 of the true mean on the constant and ramp tracks (it is a robust straight-line fit through the beat times, so on the step track it is a compromise, 126.9 against a true time average of 124.7; per-beat times and `bpm_range` carry the local tempo); drums: kick F1 >= 0.996, clap 0.94-1.0, hat 1.0, p90 timing error <= 2.1 ms.

### Robustness (each variant against the unperturbed run)

| variant | what changed | word shift median / p90 / max | words within 100 ms | line starts vs reference (median / within 200 ms) |
|---|---|---|---|---|
| drop 3 lyric words | text only | 0 / 0 / 324 ms | 99.8% | 113 ms / 78% |
| insert `Ooh`, `ah` vocalisations in the text | text only | 0 / 0 / 140 ms | 99.8% | 115 ms / 77% |
| misspell 7 words | text only | 0 / 0 / 0 ms | 100% | 115 ms / 78% |
| moans spliced over sung words | audio | 0 / 0 / 575 ms | 96.6% | 111 ms / 75% |
| moans spliced into real gaps | audio | 0 / 0 / 893 ms | 98.9% | 115 ms / 74%; both moans reported as `vocalizations` |
| hiss added to the stem | audio | 0 / 80 / 494 ms | 90.9% | 108 ms / 76% |
| instrument bleed in the stem | audio | 13 / 135 / 678 ms | 82.4% | 135 ms / 76% |
| stacked doubles (gang vocals) | audio | 10 / 178 / 2041 ms | 83.3% | 119 ms / 68% |
| a sung line missing from the text (8 words) | text only | 0 / 0 / 1706 ms | 99.6% | 113 ms / 75% |
| a text line that is not sung (6 words) | text only | 0 / 0 / 120 ms | 99.8% | 115 ms / 76% |
| a pre-chorus written twice, sung once (24 extra words) | text only | 0 / 0 / 3762 ms | 98.1% | 115 ms / 76%; the phrase is split between the copies, flagged for review |
| another song's lyrics | text | anchor share 0.23, warning, valid file | | |

### Speech-like test with exact word truth (Zombie Couture lyrics, text-to-speech)

`validation/tts_song.py` speaks every word of `data/lyrics.txt` with espeak-ng (one call per word, pitch varying per word, held words slowed), lays the words on an eighth-note grid over a synthetic 128 BPM four-on-the-floor backing (lines start on a bar line or a beat before it, one empty bar between sections) and writes the exact word times. It needs `pip install espeakng-loader` (validation only). It is a deliberately hard case for the recogniser: only 38% of the words were recognised well enough to be anchors, against 78% on the real singing. Read it as a test of the alignment mechanics on the real lyric text (repeated choruses, holds, pickups, section gaps), not as a promise for the real vocal.

| word start error | median | p90 | mean | max | within 50 / 100 / 200 ms |
|---|---|---|---|---|---|
| before the last stage 3 changes | 84 ms | 2020 ms | | | - / 52% / 62% |
| **final, all 242 words** | **15 ms** | **183 ms** | 59 ms | 474 ms | **66% / 84% / 91%** |
| final, recognised words (91) | 41 ms | 115 ms | 52 ms | 243 ms | 60% / 85% / 96% |
| final, interpolated words (151) | 14 ms | 221 ms | 63 ms | 474 ms | 69% / 83% / 88% |
| final, held words (8) | 52 ms | 148 ms | 72 ms | 232 ms | 50% / 75% / 88% |

* Word ends: median 48 ms, p90 127 ms. Lines: median 12 ms, p90 131 ms, max 210 ms, 97% within 200 ms. Sections: all 9 exactly on the truth bar. Beats: median 2.0 ms, max 6 ms, bar phase right. Drums: kick F1 1.0, hat 0.99, clap 0.90 (precision 0.82).
* What fixed it (the first version dumped lines into the last voiced segment of a long gap, and wrong anchors (a mangled "incalypse" matched to "apocalypse", a stray "and") shoved their neighbours around): the surplus-aware segment DP, `prune_squeezed`, token slots and per-run word ends, all in stage 3. On P(Bloom) the word times did not change at all.

Before / after the "text line that is not sung" test: nine correct anchors after the crammed line were dropped one after the other by the squeeze check (6 words 0.3-1.0 s off, 98.3% within 100 ms); the check now drops an anchor only when that gives the run room, and the row above is the result.

Before / after the moans-in-gaps round: one word (and the following line start) had been captured by the moan (up to 1.2 s off) and no vocalisation was reported; the token slot + per-run word ends fixed both. A gap with far more words than the audio can hold (whole-song lyrics against a 20 s excerpt) crashed the gap DP; it now spreads the words over the voiced time and warns.

## Layout, caches, hygiene

```
analysis/run_audio.sh            entry point            zcaudio/         the package (s0_normalize ... s8_sheet, dpalign, g2p, lyrics, ...)
analysis/models/                 weights (git-ignored): UVR-MDX-NET-Voc_FT.onnx, asr/zipformer-gigaspeech/
analysis/validation/             run_validation.py (+ synth.py, tts_song.py, eval_*.py), results.json, pbloom/ = the P(Bloom) sample run;
                                 tts/ = the text-to-speech test (song, truth, run); variants/ synth/ pbloom_excerpt/ are scratch the harness / the excerpt command
                                 recreates and that can be deleted at any time (caches and wavs are git-ignored)
data/audio/                      stage products; cache/ (stems, ASR by content hash) and *.wav are git-ignored
data/timing.json                 the output the renderer reads      data/overrides.json  data/pron.json   hand corrections (yours)
```

* Model files: `analysis/models/UVR-MDX-NET-Voc_FT.onnx` (67 MB) and `analysis/models/asr/zipformer-gigaspeech` (encoder / decoder / joiner int8 + tokens + bpe). They were copied from the previous project's download folder (`ZC_MODELS` is searched too). huggingface.co and similar hosts are unreachable from this environment; the same files exist as GitHub release assets (UVR models repo; k2-fsa/sherpa-onnx `asr-models`, `sherpa-onnx-zipformer-gigaspeech-2023-12-12`) but that path was not exercised.
* All JSON writes are atomic (temp file + rename): a killed run never leaves a truncated file.
* `data/audio/cache` holds about 60 MB per song (stems + ASR); delete it to force stage 1 / 2 to recompute.
* The pipeline never touches `web/`, `tools/`, `out/`, or `data/lyrics.txt`.
