# timing.json - schema `zombie-couture.timing/1`

`data/timing.json` is the single hand-off from the audio analysis (`analysis/run_audio.sh`, see `analysis/README.md`) to the renderer. Frames are meant to be a pure function of this file plus the audio: nothing in the renderer should hard-code a time.

* Seconds everywhere, as floats, on the timeline of the decoded audio (44.1 kHz, first decoded sample = 0). Mux the same mp3 the analysis saw. (`meta.container_start_s` is ffprobe's stream start offset for the mp3, 0.023 s on the previous song. All times are measured from the first decoded sample; if a muxer keeps that offset the audio is presented 23 ms later than these times, under one frame at 30 fps - compensate only if frame-exact sync ever matters.)
* Times are rounded to milliseconds (`levels` to 3 decimals). Arrays that are lists of times are strictly or weakly ascending as stated below; `zcaudio/schema.py` checks this and stage 7 refuses to write a file that fails (`cd analysis && python3 -m zcaudio.schema ../data/timing.json` checks any file).
* Unknown keys must be ignored by readers; new keys may be added without changing the schema id. A breaking change bumps it (`/2`).
* Size: about 340 KB for 174 s at 24 fps (the per-frame arrays dominate).
* Nothing here is guaranteed correct for a new song: `quality` says what to check by ear, and `data/overrides.json` pins corrections (README, "Hand corrections"). After an override the file is rebuilt with `python3 -m zcaudio run --song ... --stages 7,8`.

## Top level

| key | type | meaning |
|---|---|---|
| `schema` | string | `"zombie-couture.timing/1"` |
| `meta` | object | provenance (below) |
| `tempo` | object | summary of the tracked tempo (below) |
| `beats` | number[] | every beat, seconds, strictly ascending, covering the whole file (extended beyond the first/last detected beat with the local period) |
| `beat_strength` | number[] | same length as `beats`: how much onset energy supports that beat, 0..1.5 (1 = as strong as the song's 90th-percentile onset; 0 = nothing audible on that beat, e.g. a breakdown or an extrapolated beat) |
| `bars` | number[] | the beats that are "one" (downbeats), strictly ascending; `bars[k]` is bar number `k`; always a subset of `beats`, every `tempo.beats_per_bar`-th beat |
| `sections` | object[] | song structure from the lyrics tags, with sung and musical extents |
| `instrumentals` | object[] | stretches without sung sections (intro, breaks, outro), only if at least 1.5 bars long |
| `lines` | object[] | one per lyric line |
| `words` | object[] | one per lyric word, ascending and non-overlapping |
| `visemes` | object | mouth events per word |
| `vocalizations` | object[] | voiced spans that are not lyric words (moans, ooh, stray shouts) |
| `frames` | object | per-frame levels at `fps` |
| `drums` | object | kick / clap / hat hit times with strengths |
| `quality` | object | confidence numbers, lines to check, warnings |

The tempo is **not assumed constant**: `beats` is the truth for time-to-beat conversion, and `tempo.bpm` is only its average slope. (The previous song's tempo wandered by up to 150 ms against a constant grid; the tracker follows that.)

## meta

`song` (file name), `duration` (s), `sample_rate` (44100), `audio_id` (16 hex chars: hash of the decoded PCM, keys all caches), `container_start_s`, `lufs`, `true_peak_dbtp` (EBU R128 of the input), `lyrics_file`, `lyrics_sha` (12 hex chars of the lyrics text used), `fps` (of `frames`), `excerpt` (`null`, or `[start, length]` when the run was a test excerpt), `pipeline` (version), `created` (UTC ISO time), `overrides` (sorted list of the top-level keys of `overrides.json` that were applied; `[]` if none).

## tempo

| key | meaning |
|---|---|
| `bpm` | average tempo (slope of the beat curve) |
| `beat_s` | `60 / bpm`; the average beat length |
| `beats_per_bar` | 4 |
| `bpm_range` | `[min, max]` = 5th and 95th percentile of the per-bar tempo, or `null` |
| `first_downbeat` | `bars[0]` |
| `confidence` | 0..1, `0.7 * beat_conf + 0.3 * downbeat_conf`; above 0.8 is solid, below 0.6 look at `sheet.html` |
| `downbeat_confidence` | 0..1; how clearly one beat position out of four wins the vote for "one" (harmonic change, bass, loudness rise, kick, backbeat). 1.0 on the previous song |
| `deviation_from_constant_ms` | 2nd and 98th percentile of (tracked beat - best constant-tempo grid), ms; large numbers mean the song breathes |

If the song has a pickup, beats before `bars[0]` exist and belong to bar -1. `barPos()` below handles that.

## sections[]

One entry per `[Section - direction]` tag in `data/lyrics.txt`, in song order.

| key | meaning |
|---|---|
| `i`, `id` | index and id: `<kind><n>`, e.g. `verse1`, `prechorus2`, `chorus3` (the `[Final Chorus]` tag), `bridge1`, `outro1`; `n` is the number in the tag or the running count per kind |
| `name`, `kind`, `index`, `final` | tag text before the dash; `intro verse prechorus chorus postchorus bridge break outro instrumental spoken other`; `n`; true for tags containing final/last/closing |
| `direction` | text after the dash (the performance direction, e.g. `soft, slightly eerie female vocals, minor key`), verbatim |
| `t0`, `t1` | sung extent: first word start, last word end |
| `start`, `end` | musical extent on bar lines, for cuts and camera moves. `start` is the bar line the section is felt to begin on (a first word up to `sections.pickup_beats` = 2.25 beats before a bar line is a pickup into it, otherwise the bar line before), `end` is the first bar line at or after the last word (the end of the file if less than a bar remains); `end` never passes the next section's `start` |
| `bar0`, `bars` | index into `bars` of `start`, and the number of whole bars in `[start, end)` |
| `pickup_beats` | `(start - t0) / beat_s` when the first word comes before the bar line, else 0 |
| `line0`, `line1`, `word0`, `word1` | half-open index ranges into `lines` and `words` |
| `pinned` | present (true) if `overrides.json` moved `start` or `end` |

Sections never overlap in `[start, end)`. Gaps between them are in `instrumentals`.

## instrumentals[]

`{t0, t1, where, after, before, bar0, bars}`: `where` is `"intro"` (before the first section), `"between"` or `"outro"` (after the last section); `after` / `before` are section ids (null at the file edges). Only gaps of at least 1.5 bars are listed.

## lines[]

`{i, id, section, text, t0, t1, word0, word1, conf}`. `id` is `<section id>.<n>` with `n` the 1-based line number inside the section (`chorus1.3`); these ids are the keys used in `overrides.json`. `text` is the lyric line as written (notes in [brackets] removed). `conf` is the mean of the word confidences. Lines cover all words contiguously.

## words[]

| key | meaning |
|---|---|
| `i` | index = position in the array |
| `w` | display text with its punctuation and ellipses (`"Zom…bie…"`, `"(Bloom!)"` shows as `"Bloom!"`) |
| `n` | normalised form used for matching (lower case, no punctuation, `braaains` -> `brains`) |
| `t0`, `t1` | start (snapped to a vocal onset where one was near) and end (where the voiced note ends, never later than the next word's `t0`) |
| `conf` | 0..1. Recognised words: 0.5..1 by match quality; interpolated words 0.38 / 0.30 / 0.22 by distance (1 / 2 / more words) to the nearest recognised one (+0.05 when snapped to an onset); pinned words 1. Below about 0.5 treat the time as a good guess, not a measurement |
| `src` | `"asr"` (timed by the recogniser), `"interp"` (placed between recognised words along the voiced stretches of the vocal stem), `"pinned"` (set by hand in `overrides.json`) |
| `line`, `sec` | indices into `lines` and `sections` |
| `hold` | present when the lyric stretches the word: 1 = trailing ellipsis (`beautiful…`), 2 = ellipsis inside the word (`Zom…bie…`) |
| `parts`, `syl` | for `hold` 2 words: the pieces (`["Zom","bie"]`) and their `[t0, t1]` spans; for lyric karaoke of split words |
| `bg` | true if the word was in (parentheses) in the lyrics: backing / gang vocal |
| `voc` | true for ooh / ah / na / la style tokens written in the lyrics |
| `snap_ms` | how far snapping to a vocal onset moved the start (ms; absent if not snapped) |

Invariants: `words[k].t0 <= words[k].t1 <= words[k+1].t0`, all inside `[0, duration]`. Words are never dropped: a word that could not be found in the audio is interpolated and shows up in `quality.review`.

## visemes

`{set: [...8 names...], words: [...]}`. `set` is `["rest","MBP","FV","O","U","AA","EE","TLD"]`: closed lips (p b m), lip-teeth (f v), rounded (o), tight round (u w), wide open (ah), spread (ee), tongue-tip (th l d t n). `words[i]` is a list of events `[t, d, v, w]` for `words[i]`: the shape `set[v]` is reached at `t`, held for `d` seconds, weight `w` in 0..1 (vowel openness or consonant salience). Events are ascending in `t` inside a word and may overlap neighbouring ones; the sampler blends them (recipe below, identical to the Python reference `s6_visemes.sample_mouth`, checked to 5e-8). `rest` events fill gaps of 120 ms or more between words. Words are timed from `words[i].t0..t1`, so a pinned word moves its mouth events too.

Pronunciations come from CMUdict, compounds of dictionary words, or letter-to-sound rules; the rare rule-based words are listed in `quality.pronunciations_to_check` and can be fixed in `data/pron.json`.

## vocalizations[]

`{t0, t1, kind, src, level_db?, text?}`: voiced stretches of the vocal stem that no lyric word explains (`src: "energy"`), recognised ooh/ah tokens that were left out (`src: "asr"`, with `text`), or hand-set spans (`src: "pinned"`, `kind` as written in the override, e.g. `"moan"`). Use them to keep the mouth open or trigger a moan effect; they carry no lyric.

## frames

`{fps, n, sub, bass, lowmid, mid, high, rms, onset, vocal}`; each level array has `n = ceil(duration * fps)` numbers in 0..1. Frame `i` is centred on `t = i / fps` and holds the peak of the underlying 5 ms series over `[t - 0.5/fps, t + 0.5/fps]`, so a hit is never missed by sampling.

| name | meaning |
|---|---|
| `sub` `bass` `lowmid` `mid` `high` | band levels of the full mix: 20-60, 60-200, 200-1000, 1000-4000, 4000-16000 Hz. Song-relative: 0 = the 8th percentile of the song's own level in that band, 1 = its 99.5th percentile, then raised to `features.gamma` (1.7) to spread the typical range; fast attack (15 ms), slow release (140 ms). Median about 0.5-0.65 |
| `rms` | broadband level, same scaling |
| `onset` | broadband onset strength (spectral flux, 99th percentile = 1); spiky, good for flashes |
| `vocal` | level of the separated vocal stem: 0 in silence, about 0.7-1 while singing (all zeros, with a warning, if no vocal stem exists) |

## drums

`{kick: {t: [...], s: [...]}, clap: {...}, hat: {...}}`: hit times (ascending, detector latency already removed) and strengths 0..1. Detected on the instrumental stem (plus a little of the mix) from band spectral flux with spectral gates: kick = low band, clap = mid-band flux with a clap-like balance, hat = high-band flux. Clap and hat are the least reliable (on synthetic tracks: kick F1 >= 0.996, clap F1 0.94-1.0 with a few extra claps (0.90 with consonant-heavy speech over the beat), hat F1 0.99-1.0; p90 timing error <= 2.1 ms); `s` is the relative strength of the hit.

## quality

| key | meaning |
|---|---|
| `alignment` | `{words, asr_anchored, interpolated, pinned, anchor_share, low_conf_words, asr_words, asr_unused, demoted, pruned, weak_pairs}`. `anchor_share` is the share of lyric words that were matched to a recognised word (0.78 on the previous song; below 0.35 the run warns that the lyrics may not match the audio) |
| `beats` | `{confidence, beat_conf, downbeat_conf, kick_on_beat_share, tempo_stability, jitter_ms, deviation_from_constant_ms}` |
| `review` | `[{line, t0, why}]` lines worth listening to first: low confidence, half or more of the words interpolated, an interpolated line start, or three or more interpolated words squeezed under 80 ms (lyric text that is not sung) |
| `pronunciations_to_check` | `[{word, phones, src}]` words pronounced by letter-to-sound rules or `pron.json` |
| `notes` | what overrides did (`"4 word time(s) pinned by overrides.json"`) |
| `warnings` | anything the stages complained about (mismatching lyrics, missing stems, override typos); empty is normal |
| `stage_seconds` | wall time per stage |

## Reading it: reference implementations

The renderer's accessors (`beatAt`, `timeOfBeat`, `env`, `events`, `hit`, cuts on the first sung word of a section, `wordProgress`, mouth shapes) are a few lines each. This code is plain JavaScript, tested against the previous song's `timing.json` (beat conversion round-trips to 1e-14 s; `mouth()` equals the Python reference to 5e-8).

```js
// timing.json readers (plain JS, no dependencies).  T = the parsed timing.json.  All times are seconds on the song's own timeline.
const ub = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };  // first index with a[i] > x
const lb = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };  // first index with a[i] >= x

// --- beats and bars ---------------------------------------------------------------------------------------------------
// beatAt(t): fractional beat number (0 = T.beats[0]); extrapolates with the edge beat length outside the tracked range.
function beatAt(t) {
  const b = T.beats, n = b.length;
  if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
  if (t >= b[n - 1]) return (n - 1) + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
  const i = ub(b, t) - 1;
  return i + (t - b[i]) / (b[i + 1] - b[i]);
}
function timeOfBeat(x) {                                   // inverse of beatAt
  const b = T.beats, n = b.length;
  if (x <= 0) return b[0] + x * (b[1] - b[0]);
  if (x >= n - 1) return b[n - 1] + (x - (n - 1)) * (b[n - 1] - b[n - 2]);
  const i = Math.floor(x);
  return b[i] + (x - i) * (b[i + 1] - b[i]);
}
function barPos(t) {                                       // {bar: index into T.bars (negative before the first downbeat), beat: 0 .. beats_per_bar}
  const bpb = T.tempo.beats_per_bar, rel = beatAt(t) - beatAt(T.bars[0]);
  const bar = Math.floor(rel / bpb);
  return { bar, beat: rel - bar * bpb };
}
const beatPulse = (t, sharp = 4) => { const f = beatAt(t) % 1; return Math.pow(1 - (f < 0 ? f + 1 : f), sharp); };   // 1 on the beat, decaying

// --- levels and drum events ---------------------------------------------------------------------------------------------
function env(name, t) {                                    // 'sub' 'bass' 'lowmid' 'mid' 'high' 'rms' 'onset' 'vocal' -> 0..1, linear between frames
  const F = T.frames, a = F[name], x = Math.min(Math.max(t * F.fps, 0), a.length - 1), i = Math.floor(x);
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (x - i);
}
function events(kind, t0, t1) {                            // drum hits ('kick' 'clap' 'hat') in [t0, t1)
  const d = T.drums[kind], out = [];
  for (let i = lb(d.t, t0); i < d.t.length && d.t[i] < t1; i++) out.push({ t: d.t[i], s: d.s[i] });
  return out;
}
function hit(kind, t, halfLife = 0.12) {                   // 1 on a full-strength hit, halving every halfLife seconds; strongest recent hit wins
  const d = T.drums[kind];
  let v = 0;
  for (let i = ub(d.t, t) - 1; i >= 0 && t - d.t[i] < 6 * halfLife; i--) v = Math.max(v, d.s[i] * Math.pow(0.5, (t - d.t[i]) / halfLife));
  return v;
}

// --- words, lines, sections -----------------------------------------------------------------------------------------------
const W0 = T.words.map(w => w.t0);
function wordAt(t) {                                       // the word being sung at t, or null (words never overlap)
  const i = ub(W0, t) - 1;
  return i >= 0 && t < T.words[i].t1 ? T.words[i] : null;
}
const wordProgress = (w, t) => Math.min(1, Math.max(0, (t - w.t0) / Math.max(1e-6, w.t1 - w.t0)));
function lineAt(t) {                                       // the line whose sung extent (widened by `pad`) contains t, else null
  const pad = 0.25;
  for (const l of T.lines) if (t >= l.t0 - pad && t < l.t1 + pad) return l;
  return null;
}
function sectionAt(t) {                                    // section whose bar-line extent [start, end) contains t, else null (instrumental)
  for (const s of T.sections) if (t >= s.start && t < s.end) return s;
  return null;
}
// cut('first words', k): the last beat at or before the first sung word of section k (+20 ms tolerance)
function cutFirstWords(k) {
  const t0 = T.sections[k].t0 + 0.02;
  return timeOfBeat(Math.floor(beatAt(t0) + 1e-6));
}

// --- mouth ---------------------------------------------------------------------------------------------------------------
// mouth(t): weights of the viseme classes in T.visemes.set (index 0 = rest); non-rest weights sum to <= 1.
const ATTACK = 0.04, RELEASE = 0.07, REST_ATTACK = 0.06;
function mouth(t) {
  const V = T.visemes, W = T.words, m = new Float32Array(V.set.length), i0 = ub(W0, t) - 1;
  for (let i = Math.max(0, i0 - 3); i < Math.min(W.length, i0 + 4); i++) {
    for (const [te, d, v, w] of V.words[i]) {
      const a = v === 0 ? REST_ATTACK : ATTACK, lo = te - a, hi = te + d + RELEASE;
      if (t < lo || t > hi) continue;
      m[v] = Math.max(m[v], w * Math.min(1, (t - lo) / a) * Math.min(1, (hi - t) / RELEASE));
    }
  }
  let s = 0;
  for (let k = 1; k < m.length; k++) s += m[k];
  if (s > 1) for (let k = 1; k < m.length; k++) m[k] /= s;
  m[0] = Math.max(0, 1 - Math.min(1, s));
  return m;
}
```

Notes for cuts: `sections[k].start` is the musical start of section `k` (a bar line); `cutFirstWords(k)` is the beat-level version, the last beat at or before the first sung word of the section (+20 ms tolerance). For a hard cut on the downbeat use `start`; for a cut that lands on the beat just before the vocal comes in use `cutFirstWords`.

## Example (abridged)

```json
{
 "schema": "zombie-couture.timing/1",
 "tempo": {"bpm": 130.621, "beat_s": 0.459, "beats_per_bar": 4, "bpm_range": [129.61, 131.42], "first_downbeat": 0.419, "confidence": 0.946, "downbeat_confidence": 1.0},
 "beats": [0.419, 0.877, 1.347, 1.805, 2.269],
 "bars": [0.419, 2.269, 4.133],
 "sections": [{"i": 1, "id": "verse1", "name": "Verse 1", "kind": "verse", "t0": 12.1, "t1": 25.3, "start": 11.98, "end": 26.73, "bar0": 6, "bars": 8, "pickup_beats": 0.28}],
 "lines": [{"i": 3, "id": "verse1.1", "section": 1, "text": "Barricaded in the mall, last can of beans,", "t0": 12.1, "t1": 15.6, "word0": 13, "word1": 22, "conf": 0.9}],
 "words": [{"i": 13, "w": "Barricaded", "n": "barricaded", "t0": 12.1, "t1": 12.9, "conf": 0.95, "src": "asr", "line": 3, "sec": 1, "snap_ms": -6.0}],
 "visemes": {"set": ["rest", "MBP", "FV", "O", "U", "AA", "EE", "TLD"], "words": [[[12.1, 0.055, 1, 1.0], [12.155, 0.076, 5, 0.85]]]},
 "frames": {"fps": 24, "n": 4176, "bass": [0.12, 0.2], "vocal": [0.0, 0.0]},
 "drums": {"kick": {"t": [0.421, 0.872], "s": [1.0, 0.76]}}
}
```
(Abridged. `tempo`, `beats`, `bars` and `drums` are real values from the validation song "Upping My P(Bloom)"; the section, line, word and viseme entries are illustrative.)
