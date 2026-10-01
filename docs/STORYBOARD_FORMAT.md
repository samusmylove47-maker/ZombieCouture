# Storyboard format and how it becomes `shots.json`

`data/storyboard.json` (written by hand, by the director) says **what** happens in each section and how much room each shot wants. `tools/make_shots.py` resolves it against `data/timing.json` (the measured song) into `data/shots.json`: exact start and end times on the beat grid. Change the song or its timing, re-run, and the whole film re-cuts itself. Nothing in the film hard-codes a time.

## storyboard.json

```json
{
  "schema": "zombie-couture.storyboard/1",
  "front": [ { "at": "prechorus1:end-2b", "R": -1 }, { "at": "chorus1:start", "R": 0.3 }, { "at": "chorus1:line3", "R": 18, "ease": "smooth" } ],
  "alive": "chorus1:line6",
  "sections": [
    { "id": "intro", "shots": [ { "id": "i1", "tpl": "deadWide", "w": 3, "min": 4, "max": 16, "in": "cut", "args": {}, "cost": "A", "note": "..." } ] },
    { "id": "verse1", "shots": [ ... ] }
  ]
}
```

### Sections and their spans
Section ids are the ids in `timing.json` (`verse1 prechorus1 chorus1 verse2 prechorus2 chorus2 bridge1 chorus3 outro1`) plus the pseudo-section `intro` (from 0 to the first section's `start`). A section's **span** is `[start, next section's start)`; instrumental gaps belong to the section before them; the last section's span ends at the end of the file (`timing.meta.duration`). Every span must be covered by its shots, and every section in the timing needs an entry (a missing entry is an error).

### The card and the tail
`"tail": 4.0` (seconds, top level) extends the video past the end of the audio for the end card: the video lasts `timing.meta.duration + tail`, the audio is padded with silence when muxed, and the pseudo-section `card` covers `[audio end, audio end + tail)` (give it one or two shots). The last real section (`outro1`) ends at the audio end.

### Shots
`id` unique; `tpl` a template name in `web/film/shots.js`; `args` free arguments handed to the template (the template reads them as `F.args`); `in` the transition into this shot: `cut` (default), `whip`, `dip` (or `dip:<hex colour>`), `flash`, `seam`; `cost` `A` cheap / `B` normal / `C` heavy (default `B`); `note` free text for the shot doc.

`opt: true` marks a shot that may be dropped when a section is too short for the `min` lengths of all its shots (the lowest weight goes first, then the rest are re-filled); dropped shots are listed as warnings. A shot with an `at` anchor that would land inside another shot's forced range is an error, unless one of them is `opt`.

Length and placement:
* `at` (optional) forces the shot to start at an anchor (below).
* `fix` (optional) gives an exact length in beats.
* otherwise `w` (weight, default 1), `min` and `max` (beats, defaults 2 and 64) say how the leftover time is shared. Algorithm: forced starts (`at`) are placed first; between two forced starts the remaining shots share the time in proportion to `w`, clamped to `[min, max]`, iterating until stable, rounded so **every cut lands on a beat of the beat grid** (`timeOfBeat(round(beatAt(x)))`), except shots forced to a word or line start, which use the anchor's own time (see cut rule). A `fix` beyond the room is truncated with a warning.

### Anchors
`<section>:<name>[<offset>]`, where name is one of
`start`, `end` (span end), `first` (the last beat at or before the first sung word of the section, +20 ms tolerance; `timing.cutFirstWords`), `line<n>` (start of the n-th line, 1-based: the last beat at or before its first word +20 ms tolerance), `line<n>:end` (the end of the last word of that line), `line<n>w<m>` (the exact start of word m of line n, not beat-snapped), `bar<n>` (n-th bar line from the section start, 0-based), `beat<n>` (n-th beat from the section start).
Offsets: `+2b`, `-1b` (beats, through the beat grid), `+1bar`, `+0.5s` (seconds). Examples: `chorus1:line5-1b`, `verse2:line4w6`, `bridge1:line4:end`, `prechorus1:end-2b`.

### Front and alive
`front` keyframes give the radius of the pink stitch front in metres over time (anchors resolved to seconds; `R = -1` = not started). Between keys R is interpolated with the key's `ease` (`linear` default, `smooth`). `alive` is the anchor after which the whole world counts as sewn (`FRONT.uAlive = 1`).

## shots.json (`zombie-couture.shots/1`), written by make_shots.py

```json
{ "schema": "zombie-couture.shots/1", "fps": 24, "duration": 175.2, "audio_duration": 171.2, "tail": 4.0, "audio_id": "…", "aliveAt": 60.4,
  "front": [ { "t": 44.1, "R": -1 }, { "t": 50.3, "R": 0.3, "ease": "linear" } ],
  "shots": [ { "id": "v1_03", "section": "verse1", "tpl": "beansCU", "t0": 15.61, "t1": 18.37, "beats": 6, "args": {}, "in": "cut", "cost": "B", "note": "", "line": "verse1.1", "text": "Barricaded in the mall, last can of beans," } ] }
```
`t0` of shot k+1 equals `t1` of shot k (no gaps, no overlaps); the first `t0` is 0 and the last `t1` is the video duration (`audio duration + tail`); `duration` in the file is that video duration and `audio_duration` the song's. `line` / `text` are the lyric line being sung at the shot's start (or the nearest following line), for the shot doc.

## Checks (make_shots.py refuses to write a file that fails an error; warnings are printed)
Errors: unknown section id, missing section, unresolved anchor, non-ascending anchors in one section, a shot shorter than 0.5 s, gaps or overlaps, first `t0` not 0, last `t1` not the duration. Warnings: a cut that is not within 20 ms of a beat and not word-forced; average shot length per section outside 1.2..6 s; more than 3 `flash` transitions in any 1 s window; `fix` truncated.
