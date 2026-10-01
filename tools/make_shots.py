#!/usr/bin/env python3
"""make_shots.py: resolve data/storyboard.json against data/timing.json into data/shots.json (+ docs/SHOTS.md).

    python3 tools/make_shots.py [--timing data/timing.json] [--storyboard data/storyboard.json]
                                [--out data/shots.json] [--doc docs/SHOTS.md] [--check] [--no-doc] [--quiet]

Implements docs/STORYBOARD_FORMAT.md.  Exit code 0 only if there are no errors; on an error nothing is written.
The whole film re-cuts itself from the song: change the timing, run this again.

How a section is resolved (the rules the format leaves open are decided here, and printed as warnings when they bite):
  * Spans: intro = [0, first section start), section k = [start_k, start_k+1) (the last one ends at the file end), card = [audio end, audio end + tail).
  * `at` anchors force a shot start.  The first shot of a section always starts at the span start.  Anchors must be strictly ascending inside a
    section and at least 0.5 s apart.  An anchor a little before its span start (a pickup: `first`, `line1`) is moved to the span start, with a warning.
  * Between two forced starts the free shots share the time in proportion to `w`, clamped to [min, max] (defaults 2 and 64 beats):
    length_i = clamp(lambda * w_i, min_i, max_i) with lambda chosen so the lengths add up to the room (exact, by bisection).  `fix` is an exact length in beats.
    Room beyond the sum of the `max` values stretches the shots beyond max (warning).
  * Every free cut is rounded to a whole beat of the beat grid (`timeOfBeat(round(beatAt(x)))`), by a small search that keeps every shot inside
    [min, max] when that is possible.  Forced starts on a word (`lineNwM`, `lineN:end`) keep the word's exact time; other anchors are on the grid already.
  * Too little room: `opt` shots are dropped first (lowest weight, then the later one; the shot that closes the segment counts too), then the
    remaining `min` values are relaxed with a warning.  A forced start that lands inside the exact range of an anchored/first `fix` shot is an error
    unless one of the two is `opt`; a `fix` that runs past the end of its span is truncated with a warning.
"""
from __future__ import annotations

import argparse
import bisect
import datetime
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SHOTS = "zombie-couture.shots/1"
MIN_SHOT_S = 0.5                       # a shot shorter than this is an error
BEAT_TOL_S = 0.020                     # a cut this close to a beat counts as on the beat
FIT_TOL_BEATS = 0.05                   # minimums that miss the room by less than this still count as fitting
KNOWN_SHOT_KEYS = {"id", "tpl", "args", "in", "cost", "note", "opt", "at", "fix", "w", "min", "max"}
IN_RE = re.compile(r"^(cut|whip|flash|seam|dip(:(0x|#)?[0-9a-fA-F]{6})?)$")
ANCHOR_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(start|end|first|line\d+:end|line\d+w\d+|line\d+|bar\d+|beat\d+)\s*((?:[+-]\s*\d+(?:\.\d+)?\s*(?:bar|b|s))*)\s*$")
OFFS_RE = re.compile(r"([+-])\s*(\d+(?:\.\d+)?)\s*(bar|b|s)")


# =====================================================================================================================================
# timing readers: a line-for-line port of the JavaScript in docs/TIMING_SCHEMA.md ("Reading it").  tests/check_readers.mjs compares them.
# =====================================================================================================================================
def _ub(a, x):
    return bisect.bisect_right(a, x)          # first index with a[i] > x


def _lb(a, x):
    return bisect.bisect_left(a, x)           # first index with a[i] >= x


def _js_mod1(x):
    """JavaScript `x % 1` (sign follows the dividend)."""
    return math.fmod(x, 1.0)


class Timing:
    def __init__(self, T: dict, path: str | None = None):
        self.T = T
        self.path = path
        self.beats = T["beats"]
        self.bars = T["bars"]
        self.bpb = T["tempo"]["beats_per_bar"]
        self.duration = T["meta"]["duration"]
        self.sections = T["sections"]
        self.lines = T["lines"]
        self.words = T["words"]
        self.W0 = [w["t0"] for w in self.words]

    # --- beats and bars
    def beat_at(self, t: float) -> float:
        b = self.beats
        n = len(b)
        if t <= b[0]:
            return (t - b[0]) / (b[1] - b[0])
        if t >= b[n - 1]:
            return (n - 1) + (t - b[n - 1]) / (b[n - 1] - b[n - 2])
        i = _ub(b, t) - 1
        return i + (t - b[i]) / (b[i + 1] - b[i])

    def time_of_beat(self, x: float) -> float:
        b = self.beats
        n = len(b)
        if x <= 0:
            return b[0] + x * (b[1] - b[0])
        if x >= n - 1:
            return b[n - 1] + (x - (n - 1)) * (b[n - 1] - b[n - 2])
        i = math.floor(x)
        return b[i] + (x - i) * (b[i + 1] - b[i])

    def bar_pos(self, t: float) -> dict:
        bpb = self.bpb
        rel = self.beat_at(t) - self.beat_at(self.bars[0])
        bar = math.floor(rel / bpb)
        return {"bar": bar, "beat": rel - bar * bpb}

    def beat_pulse(self, t: float, sharp: float = 4.0) -> float:
        f = _js_mod1(self.beat_at(t))
        return (1 - (f + 1 if f < 0 else f)) ** sharp

    # --- words, lines, sections
    def word_at(self, t: float):
        i = _ub(self.W0, t) - 1
        return self.words[i] if i >= 0 and t < self.words[i]["t1"] else None

    def line_at(self, t: float):
        pad = 0.25
        for l in self.lines:
            if l["t0"] - pad <= t < l["t1"] + pad:
                return l
        return None

    def section_at(self, t: float):
        for s in self.sections:
            if s["start"] <= t < s["end"]:
                return s
        return None

    def cut_first_words(self, k: int) -> float:
        t0 = self.sections[k]["t0"] + 0.02
        return self.time_of_beat(math.floor(self.beat_at(t0) + 1e-6))

    def cut_first_word_of_line(self, line: dict) -> float:
        """The same rule for the n-th line of a section: the last beat at or before its first word (+20 ms tolerance)."""
        t0 = line["t0"] + 0.02
        return self.time_of_beat(math.floor(self.beat_at(t0) + 1e-6))

    # --- helpers of this tool
    def beat_index_at_or_after(self, t: float) -> int:
        return math.ceil(self.beat_at(t - 1e-3) - 1e-9)

    def snap_to_beat(self, t: float) -> float:
        return self.time_of_beat(math.floor(self.beat_at(t) + 0.5))       # JS Math.round

    def beat_error(self, t: float) -> float:
        """Distance in seconds to the nearest beat of the grid."""
        return abs(t - self.snap_to_beat(t))

    # JS-style names, so code and docs read the same
    beatAt = beat_at
    timeOfBeat = time_of_beat
    barPos = bar_pos
    beatPulse = beat_pulse
    cutFirstWords = cut_first_words


def load_timing(path) -> Timing:
    p = Path(path)
    return Timing(json.loads(p.read_text()), str(path))


# =====================================================================================================================================
# report
# =====================================================================================================================================
class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


class AnchorError(Exception):
    pass


class Anchor:
    __slots__ = ("t", "kind", "text")

    def __init__(self, t, kind, text):
        self.t, self.kind, self.text = t, kind, text      # kind: 'beat' (on the grid), 'word' (exact word time), 'span' (section edge), 'time' (free)


class Span:
    def __init__(self, id, start, end, kind, idx=None):
        self.id, self.start, self.end, self.kind, self.idx = id, start, end, kind, idx     # kind: intro | sung | card


def build_spans(T: Timing, tail: float) -> list[Span]:
    S = T.sections
    spans: list[Span] = []
    if S:
        spans.append(Span("intro", 0.0, S[0]["start"], "intro"))
    for k, s in enumerate(S):
        end = S[k + 1]["start"] if k + 1 < len(S) else T.duration
        spans.append(Span(s["id"], s["start"], end, "sung", k))
    if tail > 0:
        spans.append(Span("card", T.duration, T.duration + tail, "card"))
    return spans


class Resolver:
    """Anchors ('chorus1:line3w2+1b') -> seconds."""

    def __init__(self, T: Timing, spans: list[Span]):
        self.T = T
        self.spans = {s.id: s for s in spans}

    def section_lines(self, span: Span):
        if span.kind != "sung":
            return []
        s = self.T.sections[span.idx]
        return self.T.lines[s["line0"]:s["line1"]]

    def resolve(self, text: str) -> Anchor:
        m = ANCHOR_RE.match(text) if isinstance(text, str) else None
        if not m:
            raise AnchorError(f"cannot parse anchor {text!r} (form: section:name[+-N b|bar|s], e.g. chorus1:line3w2+1b)")
        sid, name, offs = m.group(1), m.group(2), m.group(3)
        span = self.spans.get(sid)
        if span is None:
            raise AnchorError(f"anchor {text!r}: unknown section {sid!r} (known: {', '.join(self.spans)})")
        T = self.T
        kind = "beat"
        if name == "start":
            t = span.start
            kind = "beat" if T.beat_error(t) < 0.001 else "span"
        elif name == "end":
            t = span.end
            kind = "beat" if T.beat_error(t) < 0.001 else "span"
        elif name == "first":
            if span.kind != "sung":
                raise AnchorError(f"anchor {text!r}: {sid} has no sung words")
            t = T.cut_first_words(span.idx)
        elif name.startswith("bar"):
            n = int(name[3:])
            i0 = math.ceil((T.beat_at(span.start - 1e-3) - T.beat_at(T.bars[0])) / T.bpb - 1e-9)
            t = T.time_of_beat(T.beat_at(T.bars[0]) + (i0 + n) * T.bpb)
        elif name.startswith("beat"):
            n = int(name[4:])
            t = T.time_of_beat(T.beat_index_at_or_after(span.start) + n)
        else:                                                     # lineN, lineN:end, lineNwM
            lines = self.section_lines(span)
            mm = re.match(r"line(\d+)(?::(end)|w(\d+))?$", name)
            n = int(mm.group(1))
            if not lines:
                raise AnchorError(f"anchor {text!r}: {sid} has no sung lines")
            if not 1 <= n <= len(lines):
                raise AnchorError(f"anchor {text!r}: {sid} has {len(lines)} lines, no line {n}")
            line = lines[n - 1]
            if mm.group(2):
                t = T.words[line["word1"] - 1]["t1"]
                kind = "word"
            elif mm.group(3):
                wm = int(mm.group(3))
                nw = line["word1"] - line["word0"]
                if not 1 <= wm <= nw:
                    raise AnchorError(f"anchor {text!r}: {line['id']} has {nw} words, no word {wm} ({line['text']!r})")
                t = T.words[line["word0"] + wm - 1]["t0"]
                kind = "word"
            else:
                t = T.cut_first_word_of_line(line)
        for sign, num, unit in OFFS_RE.findall(offs):
            v = float(num) * (-1 if sign == "-" else 1)
            if unit == "s":
                t += v
                if kind != "word":
                    kind = "time"
            else:
                nb = v * (T.bpb if unit == "bar" else 1)
                t = T.time_of_beat(T.beat_at(t) + nb)
                if kind == "span":
                    kind = "time"
        return Anchor(t, kind, text)


# =====================================================================================================================================
# the fill: lengths in proportion to weights, clamped, then whole beats
# =====================================================================================================================================
def clamp_fill(total: float, items: list[tuple[float, float, float]]) -> list[float]:
    """items = (w, lo, hi).  Lengths l_i = clamp(lam * w_i, lo_i, hi_i) adding up to `total` (bisection on lam).
    If total exceeds sum(hi) the surplus is spread in proportion to w (shots stretch beyond max)."""
    n = len(items)
    sum_lo = sum(i[1] for i in items)
    sum_hi = sum(i[2] for i in items)
    if total >= sum_hi - 1e-9:
        extra = total - sum_hi
        sw = sum(i[0] for i in items)
        return [i[2] + extra * i[0] / sw for i in items]
    if total <= sum_lo + 1e-9:
        f = total / sum_lo if sum_lo > 0 else 0
        return [i[1] * f for i in items]
    lo_l, hi_l = 0.0, max(i[2] / i[0] for i in items) + 1.0
    for _ in range(200):
        lam = 0.5 * (lo_l + hi_l)
        s = sum(min(max(lam * w, lo), hi) for w, lo, hi in items)
        if s < total:
            lo_l = lam
        else:
            hi_l = lam
    lam = 0.5 * (lo_l + hi_l)
    out = [min(max(lam * w, lo), hi) for w, lo, hi in items]
    fix = total - sum(out)                                   # bisection residue (~1e-12)
    out[max(range(n), key=lambda i: out[i])] += fix
    return out


def snap_cuts(T: Timing, tA: float, tB: float, lens: list[float], bounds: list[tuple[float, float]]) -> tuple[list[float], bool]:
    """Round the internal cuts of one segment to whole beats.  lens: ideal lengths in beats (sum = beat_at(tB) - beat_at(tA)); bounds: (lo, hi) per shot in
    beats.  Returns (cut times, ok).  ok is False when the segment cannot be cut on the grid (then the ideal, off-grid times are returned)."""
    m = len(lens)
    if m == 1:
        return [], True
    bA, bB = T.beat_at(tA), T.beat_at(tB)
    x = []
    acc = bA
    for j in range(m - 1):
        acc += lens[j]
        x.append(acc)
    cands = []
    for xj in x:
        c = [k for k in range(math.floor(xj) - 2, math.ceil(xj) + 3) if bA + 1e-6 < k < bB - 1e-6]
        c.sort(reverse=True)                                 # ties resolve upwards, like Math.round
        cands.append(c)
    if any(not c for c in cands):
        return [T.time_of_beat(v) for v in x], False
    P_BOUND, P_SHORT = 100.0, 1e5
    # dynamic programme over the cuts
    best = [dict() for _ in range(m - 1)]        # best[j][c] = (cost, prev_c)
    for c in cands[0]:
        dur = T.time_of_beat(c) - tA
        cost = (c - x[0]) ** 2 + P_BOUND * _viol(c - bA, bounds[0]) + (P_SHORT if dur < MIN_SHOT_S else 0)
        best[0][c] = (cost, None)
    for j in range(1, m - 1):
        for c in cands[j]:
            bc = None
            for p, (pc, _) in best[j - 1].items():
                if p >= c:
                    continue
                dur = T.time_of_beat(c) - T.time_of_beat(p)
                cost = pc + (c - x[j]) ** 2 + P_BOUND * _viol(c - p, bounds[j]) + (P_SHORT if dur < MIN_SHOT_S else 0)
                if bc is None or cost < bc[0] - 1e-12 or (abs(cost - bc[0]) <= 1e-12 and p > bc[1]):
                    bc = (cost, p)
            if bc is not None:
                best[j][c] = bc
    fin = None
    for p, (pc, _) in best[m - 2].items():
        dur = tB - T.time_of_beat(p)
        cost = pc + P_BOUND * _viol(bB - p, bounds[m - 1]) + (P_SHORT if dur < MIN_SHOT_S else 0)
        if fin is None or cost < fin[0] - 1e-12 or (abs(cost - fin[0]) <= 1e-12 and p > fin[1]):
            fin = (cost, p)
    if fin is None:
        return [T.time_of_beat(v) for v in x], False
    cuts = [fin[1]]
    for j in range(m - 2, 0, -1):
        cuts.append(best[j][cuts[-1]][1])
    cuts.reverse()
    return [T.time_of_beat(c) for c in cuts], True


def _viol(length, b):
    lo, hi = b
    return max(0.0, lo - length - FIT_TOL_BEATS, length - hi - FIT_TOL_BEATS)


# =====================================================================================================================================
# one section
# =====================================================================================================================================
class Spec:
    """A storyboard shot plus its working state."""

    def __init__(self, raw: dict, section: str, order: int):
        self.raw = raw
        self.id = raw.get("id")
        self.section = section
        self.order = order
        self.opt = bool(raw.get("opt", False))
        self.at_text = raw.get("at")
        self.fix = raw.get("fix")
        self.w = float(raw.get("w", 1))
        self.mn = float(raw.get("min", 2))
        self.mx = float(raw.get("max", 64))
        self.anchor: Anchor | None = None
        self.forced_t: float | None = None
        self.snap = "beat"
        self.t0 = self.t1 = None

    @property
    def lo(self):
        return float(self.fix) if self.fix is not None else self.mn

    @property
    def hi(self):
        return float(self.fix) if self.fix is not None else self.mx

    def __repr__(self):
        return f"<{self.id}>"


def resolve_section(span: Span, specs: list[Spec], R: Resolver, rep: Report, dropped: list):
    T = R.T
    live = list(specs)
    tol = BEAT_TOL_S
    # ---- resolve the anchors
    for s in live:
        if s.at_text is None:
            continue
        try:
            a = R.resolve(s.at_text)
        except AnchorError as e:
            rep.error(f"{span.id}/{s.id}: {e}")
            s.at_text = None
            continue
        anchor_sid = ANCHOR_RE.match(s.at_text).group(1)
        t = a.t
        if a.kind == "time":
            t = T.snap_to_beat(t)
            a = Anchor(t, "beat", a.text)
        if t < span.start - tol:
            if span.start - t <= 2.5 * 60.0 / max(T.T["tempo"]["bpm"], 1) + 1e-9 and anchor_sid == span.id:
                rep.warn(f"{span.id}/{s.id}: anchor {s.at_text!r} is {1000 * (span.start - t):.0f} ms before the section start (a pickup); the cut moves to the section start")
                a = Anchor(span.start, "span", a.text)
            else:
                rep.error(f"{span.id}/{s.id}: anchor {s.at_text!r} = {t:.3f} s lies before its section starts ({span.start:.3f} s)")
                s.at_text = None
                continue
        elif t >= span.end - MIN_SHOT_S + 1e-9:
            rep.error(f"{span.id}/{s.id}: anchor {s.at_text!r} = {t:.3f} s lies at or after the end of its section ({span.end:.3f} s; a shot needs at least {MIN_SHOT_S} s)")
            s.at_text = None
            continue
        s.anchor = a

    def forced_time(i, s):
        if i == 0:
            return span.start
        return s.anchor.t if s.anchor else None

    # ---- iterate: find problems, drop `opt` shots, until none is left that dropping can cure
    while True:
        F = [i for i, s in enumerate(live) if forced_time(i, s) is not None]
        if not live:
            rep.error(f"{span.id}: no shots left")
            return []
        first = live[0]
        if first.anchor is not None and first.anchor.t > span.start + tol:
            # the first shot must start at the section start
            if first.opt and len(live) > 1:
                dropped.append({"id": first.id, "section": span.id, "why": "anchored later than the section start"})
                rep.warn(f"{span.id}/{first.id}: dropped (opt): anchored {first.anchor.t - span.start:.2f} s after the section start")
                live.pop(0)
                continue
            rep.error(f"{span.id}/{first.id}: the first shot of a section must start at the section start, but its anchor {first.at_text!r} is {first.anchor.t - span.start:.2f} s later")
            first.anchor = None
            continue
        problems = []       # (kind, involved live indices, message)
        times = {i: forced_time(i, live[i]) for i in F}
        for a, b in zip(F, F[1:]):
            gap = times[b] - times[a]
            if gap < MIN_SHOT_S:
                implied = a == 0 and live[a].anchor is None
                who_a = f"{live[a].id} (the section start)" if implied else f"{live[a].id} ({times[a]:.3f} s)"
                hint = f"; {live[a].id} would get no time: drop it, anchor {live[b].id} later or mark one `opt`" if implied and gap < MIN_SHOT_S else ""
                problems.append(("order", [a, b], f"anchors of {who_a} and {live[b].id} ({times[b]:.3f} s, {live[b].at_text}) are {gap:.2f} s apart"
                                 + (" (non-ascending)" if gap <= 0 else f" (a shot needs {MIN_SHOT_S} s)") + hint))
        if not problems:
            for k, a in enumerate(F):
                b = F[k + 1] if k + 1 < len(F) else None
                tA, tB = times[a], (times[b] if b is not None else span.end)
                seg = live[a:(b if b is not None else len(live))]
                L = T.beat_at(tB) - T.beat_at(tA)
                need = sum(s.lo for s in seg)
                if need > L + FIT_TOL_BEATS:
                    problems.append(("short", list(range(a, (b if b is not None else len(live)))) + ([b] if b is not None else []),
                                     f"{'/'.join(s.id for s in seg)} need {need:g} beats (minimums) but only {L:.2f} beats fit between {tA:.2f} s and {tB:.2f} s"))
        if not problems:
            break
        cured = False
        for kind, idxs, msg in problems:
            cands = [i for i in idxs if live[i].opt and not (i == 0 and len(live) > 1 and live[1].anchor is not None and live[1].anchor.t > span.start + tol)]
            if cands:
                i = min(cands, key=lambda i: (live[i].w, -i))
                s = live.pop(i)
                dropped.append({"id": s.id, "section": span.id, "why": msg})
                rep.warn(f"{span.id}/{s.id}: dropped (opt): {msg}")
                cured = True
                break
        if cured:
            continue
        if any(k == "order" for k, _, _ in problems):
            rep.error(f"{span.id}: {[m for k, _, m in problems if k == 'order'][0]}")
            return []
        break                                            # only short segments left, none droppable: relaxed below

    # ---- segments and lengths
    F = [i for i, s in enumerate(live) if forced_time(i, s) is not None]
    out = []
    for k, a in enumerate(F):
        b = F[k + 1] if k + 1 < len(F) else None
        tA = forced_time(a, live[a])
        tB = forced_time(b, live[b]) if b is not None else span.end
        seg = live[a:(b if b is not None else len(live))]
        bA, bB = T.beat_at(tA), T.beat_at(tB)
        L = bB - bA
        need = sum(s.lo for s in seg)
        lo = [s.lo for s in seg]
        hi = [s.hi for s in seg]
        if need > L + FIT_TOL_BEATS:
            head = seg[0]
            if b is not None and len(seg) == 1 and head.fix is not None:
                rep.error(f"{span.id}/{live[b].id}: its anchor {live[b].at_text!r} lands inside the fixed range of {head.id} (fix {head.fix:g} beats, only {L:.2f} beats before the anchor); neither is `opt`")
                continue
            fixsum = sum(s.fix for s in seg if s.fix is not None)
            nonfix = [s for s in seg if s.fix is None]
            room = L - fixsum
            if nonfix and room >= len(nonfix):
                f = room / sum(s.mn for s in nonfix)
                lo = [max(1.0, s.mn * f) if s.fix is None else float(s.fix) for s in seg]
                hi = [max(h, l) for h, l in zip(hi, lo)]
                rep.warn(f"{span.id}: {'/'.join(s.id for s in seg)}: minimums ({need:g} beats) do not fit in {L:.2f} beats; relaxed")
            else:
                f = L / need
                lo = [l * f for l in lo]
                hi = [h * f for h in hi]
                trunc = [s.id for s in seg if s.fix is not None]
                rep.warn(f"{span.id}: {'/'.join(s.id for s in seg)}: {need:g} beats needed, {L:.2f} available; everything squeezed" + (f" (fix truncated: {', '.join(trunc)})" if trunc else ""))
        elif b is None and any(s.fix is not None for s in seg):
            pass
        lens = clamp_fill(L, [(s.w, l, h) for s, l, h in zip(seg, lo, hi)])
        if sum(h for h in hi) < L - FIT_TOL_BEATS:
            rep.warn(f"{span.id}: {'/'.join(s.id for s in seg)}: {L:.1f} beats to fill but the maximums add up to {sum(hi):g}; shots stretched beyond max")
        # a `fix` that was cut short by the room (last shot of a segment ends the span, or squeezed)
        for s, l in zip(seg, lens):
            if s.fix is not None and l < s.fix - 1e-6:
                rep.warn(f"{span.id}/{s.id}: fix {s.fix:g} beats truncated to {l:.2f}")
        cuts, ok = snap_cuts(T, tA, tB, lens, list(zip(lo, hi)))
        if not ok:
            rep.warn(f"{span.id}: {'/'.join(s.id for s in seg)}: not enough beats to cut on the grid between {tA:.2f} s and {tB:.2f} s; cuts left off the beat")
        times = [tA] + cuts + [tB]
        for j, s in enumerate(seg):
            s.t0, s.t1 = times[j], times[j + 1]
            if j == 0:
                s.snap = ("span" if a == 0 else (live[a].anchor.kind if live[a].anchor else "beat"))
                if s.snap == "time":
                    s.snap = "beat"
            else:
                s.snap = "beat" if ok else "free"
            out.append(s)
    return out


# =====================================================================================================================================
# the whole storyboard
# =====================================================================================================================================
def resolve_all(T: Timing, SB: dict, rep: Report):
    tail = float(SB.get("tail", 0) or 0)
    spans = build_spans(T, tail)
    spanmap = {s.id: s for s in spans}
    R = Resolver(T, spans)
    dropped: list = []
    if SB.get("schema") and not str(SB["schema"]).startswith("zombie-couture.storyboard/"):
        rep.error(f"storyboard schema {SB['schema']!r} is not zombie-couture.storyboard/1")
    entries = {}
    for e in SB.get("sections", []):
        sid = e.get("id")
        if sid not in spanmap:
            hint = " (tail is 0: the card section needs `tail` > 0)" if sid == "card" else ""
            rep.error(f"storyboard section {sid!r} is not in the timing (timing has: {', '.join(spanmap)}){hint}")
            continue
        if sid in entries:
            rep.error(f"storyboard section {sid!r} appears twice")
            continue
        entries[sid] = e
    for sp in spans:
        if sp.id not in entries and sp.end - sp.start >= MIN_SHOT_S:
            rep.error(f"section {sp.id!r} ({sp.start:.2f}-{sp.end:.2f} s) has no entry in the storyboard")
    # shot field checks
    seen_ids: dict = {}
    per_section: dict[str, list[Spec]] = {}
    for sp in spans:
        e = entries.get(sp.id)
        if e is None:
            continue
        specs = []
        for n, raw in enumerate(e.get("shots", [])):
            where = f"{sp.id}[{n}]"
            if not isinstance(raw, dict) or not raw.get("id"):
                rep.error(f"{where}: shot without an id")
                continue
            sid = raw["id"]
            where = f"{sp.id}/{sid}"
            if sid in seen_ids:
                rep.error(f"{where}: duplicate shot id (also in {seen_ids[sid]})")
            seen_ids[sid] = sp.id
            if not raw.get("tpl"):
                rep.error(f"{where}: no `tpl`")
            if "in" in raw and not IN_RE.match(str(raw["in"])):
                rep.error(f"{where}: unknown transition in={raw['in']!r} (cut|whip|dip|dip:<hex>|flash|seam)")
            if "cost" in raw and raw["cost"] not in ("A", "B", "C"):
                rep.error(f"{where}: cost {raw['cost']!r} is not A, B or C")
            sp_ = Spec(raw, sp.id, n)
            if sp_.fix is not None and not (isinstance(sp_.fix, (int, float)) and sp_.fix > 0):
                rep.error(f"{where}: fix must be a positive number of beats")
                sp_.fix = None
            if sp_.w <= 0:
                rep.error(f"{where}: w must be > 0")
                sp_.w = 1.0
            if sp_.mn > sp_.mx:
                rep.error(f"{where}: min {sp_.mn:g} > max {sp_.mx:g}")
                sp_.mx = sp_.mn
            specs.append(sp_)
        per_section[sp.id] = specs
    if rep.errors:
        return None
    all_specs: list[Spec] = []
    for sp in spans:
        if sp.id not in per_section:
            continue
        if not per_section[sp.id]:
            rep.error(f"section {sp.id!r} has no shots")
            continue
        if sp.end - sp.start < MIN_SHOT_S:
            rep.error(f"section {sp.id!r} is only {sp.end - sp.start:.2f} s long but has shots")
            continue
        got = resolve_section(sp, per_section[sp.id], R, rep, dropped)
        all_specs += got
    # ---- front and alive
    front, alive_at = [], None
    prev_t = None
    for n, k in enumerate(SB.get("front", [])):
        try:
            a = R.resolve(k["at"])
        except (AnchorError, KeyError) as e:
            rep.error(f"front[{n}]: {e}")
            continue
        ease = k.get("ease", "linear")
        if ease not in ("linear", "smooth"):
            rep.error(f"front[{n}]: unknown ease {ease!r}")
        if prev_t is not None and a.t < prev_t - 1e-3:
            rep.error(f"front[{n}] ({k['at']} = {a.t:.3f} s) comes before the previous key ({prev_t:.3f} s)")
        prev_t = a.t
        rv = k.get("R")
        if isinstance(rv, bool) or not isinstance(rv, (int, float)):
            rep.error(f"front[{n}] ({k['at']}): `R` must be a number of metres (-1 = not started), got {rv!r}")
            continue
        front.append({"t": round(a.t, 4), "R": rv, "ease": ease})
    if "alive" in SB:
        try:
            alive_at = round(R.resolve(SB["alive"]).t, 4)
        except AnchorError as e:
            rep.error(f"alive: {e}")
    else:
        rep.warn("no `alive` anchor in the storyboard: aliveAt is null")
    return spans, all_specs, front, alive_at, dropped


def line_for(T: Timing, t: float):
    """The lyric line sung at t, else the nearest following one: (line, sung)."""
    for l in T.lines:
        if l["t0"] - 0.05 <= t < l["t1"]:
            return l, True
    for l in T.lines:
        if l["t0"] > t:
            return l, False
    return None, False


def _num(x):
    r = round(x, 3)
    return int(r) if abs(r - round(r)) < 1e-9 else r


def build_shots_json(T: Timing, SB: dict, spans: list[Span], specs: list[Spec], front, alive_at, dropped, timing_path, sb_path, rep: Report) -> dict:
    tail = float(SB.get("tail", 0) or 0)
    total = T.duration + tail
    shots = []
    for i, s in enumerate(specs):
        t0 = round(s.t0, 4)
        t1 = round(s.t1, 4)
        line, sung = line_for(T, s.t0)
        rec = {
            "id": s.id, "section": s.section, "tpl": s.raw["tpl"], "t0": t0, "t1": t1,
            "beats": _num(T.beat_at(t1) - T.beat_at(t0)),
            "args": s.raw.get("args", {}), "in": s.raw.get("in", "cut"), "cost": s.raw.get("cost", "B"), "note": s.raw.get("note", ""),
            "snap": s.snap,
        }
        if s.raw.get("at"):
            rec["at"] = s.raw["at"]
        if line is not None:
            rec["line"] = line["id"]
            rec["text"] = line["text"]
            rec["sung"] = sung
        for k, v in s.raw.items():                       # unknown keys of the storyboard travel with the shot
            if k not in KNOWN_SHOT_KEYS and k not in rec:
                rec[k] = v
        shots.append(rec)
    for i, r in enumerate(shots):                        # `out` = the transition into the next shot (FILM.md record shape)
        r["out"] = shots[i + 1]["in"] if i + 1 < len(shots) else "cut"
    # ---- checks on the result
    if shots:
        if abs(shots[0]["t0"]) > 1e-9:
            rep.error(f"first shot starts at {shots[0]['t0']} s, not 0")
        if abs(shots[-1]["t1"] - round(total, 4)) > 1e-4:
            rep.error(f"last shot ends at {shots[-1]['t1']} s, not the duration {total:.4f} s")
        for a, b in zip(shots, shots[1:]):
            if a["t1"] != b["t0"]:
                rep.error(f"gap or overlap between {a['id']} (ends {a['t1']}) and {b['id']} (starts {b['t0']})")
        for r in shots:
            if r["t1"] - r["t0"] < MIN_SHOT_S - 1e-9:
                rep.error(f"{r['section']}/{r['id']}: only {r['t1'] - r['t0']:.2f} s long (minimum {MIN_SHOT_S} s)")
        for r in shots[1:]:
            if r["snap"] == "beat" and T.beat_error(r["t0"]) > BEAT_TOL_S:
                rep.warn(f"{r['id']}: cut at {r['t0']} s is {1000 * T.beat_error(r['t0']):.0f} ms from the nearest beat")
    # per-section averages, flash density
    for sp in spans:
        ss = [r for r in shots if r["section"] == sp.id]
        if ss and sp.kind != "card":
            avg = (sp.end - sp.start) / len(ss)
            if not 1.2 <= avg <= 6.0:
                rep.warn(f"{sp.id}: average shot length {avg:.2f} s is outside 1.2..6 s ({len(ss)} shots in {sp.end - sp.start:.1f} s)")
    fl = [r["t0"] for r in shots if str(r["in"]) == "flash"]
    for i, t in enumerate(fl):
        n = sum(1 for u in fl if t <= u < t + 1.0)
        if n > 3:
            rep.warn(f"more than 3 flash transitions within 1 s from {t:.2f} s ({n})")
            break
    js = {
        "schema": SCHEMA_SHOTS, "fps": SB.get("fps", 24), "duration": round(total, 4), "audio_duration": round(T.duration, 4), "tail": tail,
        "audio_id": T.T["meta"].get("audio_id"), "aliveAt": alive_at,
        "source": {"timing": str(timing_path), "storyboard": str(sb_path), "lyrics_sha": T.T["meta"].get("lyrics_sha"),
                   "song": T.T["meta"].get("song"), "created": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
        "sections": [{"id": sp.id, "t0": round(sp.start, 4), "t1": round(sp.end, 4)} for sp in spans],
        "front": front, "shots": shots, "dropped": dropped,
    }
    return js


# =====================================================================================================================================
# docs/SHOTS.md
# =====================================================================================================================================
def _fmt_len(x):
    return f"{x:.2f}"


def cut_audit(T: Timing, js: dict) -> dict:
    """Cut-versus-beat audit of the shot list: every cut is on a beat (within 20 ms) or forced to a word or a section edge."""
    rows = []
    for r in js["shots"][1:]:
        err = T.beat_error(r["t0"])
        rows.append({"id": r["id"], "t": r["t0"], "err_ms": round(1000 * err, 1), "snap": r.get("snap", "beat"), "in": r.get("in", "cut")})
    on = [x for x in rows if x["err_ms"] <= 1000 * BEAT_TOL_S]
    word = [x for x in rows if x["err_ms"] > 1000 * BEAT_TOL_S and x["snap"] == "word"]
    span = [x for x in rows if x["err_ms"] > 1000 * BEAT_TOL_S and x["snap"] == "span"]
    bad = [x for x in rows if x["err_ms"] > 1000 * BEAT_TOL_S and x["snap"] not in ("word", "span")]
    return {"cuts": len(rows), "on_beat": len(on), "max_on_beat_ms": max([x["err_ms"] for x in on], default=0.0), "word_forced": len(word),
            "section_edge_off_beat": len(span), "off_beat": bad, "ok": not bad, "word_rows": word, "span_rows": span}


def write_doc(T: Timing, js: dict, path: Path, stand_in: bool, sb_path):
    L = []
    P = L.append
    P("# Shot list (generated)")
    P("")
    P(f"Generated by `tools/make_shots.py` from `{js['source']['storyboard']}` and `{js['source']['timing']}`"
      f" ({js['source']['created']}). Do not edit; change the storyboard or the timing and run the tool again.")
    if stand_in:
        P("")
        P("> **Built from the STAND-IN timing** (a text-to-speech song at 128 BPM), not from the real song. Times will change when the mp3 is analysed.")
    P("")
    P(f"Video {js['duration']:.2f} s ({js['audio_duration']:.2f} s song + {js['tail']:g} s card), {js['fps']} fps, {len(js['shots'])} shots, "
      f"tempo {T.T['tempo']['bpm']:.2f} BPM, audio id `{js['audio_id']}`. Front keys: {len(js['front'])}; world alive at "
      f"{js['aliveAt'] if js['aliveAt'] is not None else 'never'} s.")
    P("")
    P("Lyric column: the line being sung when the shot starts; *italic* = not yet sung, the next line. `snap`: `b` on the beat grid, `w` exact word time, `s` section edge.")
    P("")
    by = {}
    for r in js["shots"]:
        by.setdefault(r["section"], []).append(r)
    summary = []
    for sec in js["sections"]:
        rows = by.get(sec["id"], [])
        if not rows:
            continue
        P(f"## {sec['id']}  ({sec['t0']:.2f} to {sec['t1']:.2f} s, {sec['t1'] - sec['t0']:.1f} s, {T.beat_at(sec['t1']) - T.beat_at(sec['t0']):.1f} beats)")
        P("")
        P("| id | start-end (s) | len s | beats | template | in | cost | snap | lyric at start | note |")
        P("|---|---|---|---|---|---|---|---|---|---|")
        lens = []
        for r in rows:
            ln = r["t1"] - r["t0"]
            lens.append(ln)
            txt = r.get("text", "")
            if txt:
                txt = txt.replace("|", "/")
                txt = f"{txt}" if r.get("sung") else f"*{txt}*"
            P(f"| {r['id']} | {r['t0']:.2f}-{r['t1']:.2f} | {_fmt_len(ln)} | {r['beats']} | {r['tpl']} | {r['in']} | {r['cost']} | {r['snap'][0]} | {txt} | {r['note'].replace('|', '/')} |")
        P("")
        summary.append((sec["id"], len(rows), sum(lens) / len(lens), min(lens), max(lens), sec["t1"] - sec["t0"]))
    P("## Per-section summary")
    P("")
    P("| section | shots | span s | average s | shortest s | longest s |")
    P("|---|---|---|---|---|---|")
    for sid, n, avg, mn, mx, span in summary:
        P(f"| {sid} | {n} | {span:.1f} | {avg:.2f} | {mn:.2f} | {mx:.2f} |")
    P("")
    P(f"**Total: {len(js['shots'])} shots** in {js['duration']:.1f} s (average {js['duration'] / len(js['shots']):.2f} s).")
    if js.get("dropped"):
        P("")
        P("Dropped `opt` shots: " + ", ".join(f"{d['id']} ({d['section']})" for d in js["dropped"]) + ".")
    au = cut_audit(T, js)
    P("")
    P("## Cut versus beat audit")
    P("")
    P(f"{au['cuts']} cuts: {au['on_beat']} within 20 ms of a beat (worst {au['max_on_beat_ms']} ms), {au['word_forced']} forced to an exact word time, "
      f"{au['section_edge_off_beat']} at a section edge that is off the beat grid (the audio end). Off the beat and not forced: **{len(au['off_beat'])}**. "
      f"Result: **{'PASS' if au['ok'] else 'FAIL'}**.")
    if au["word_rows"]:
        P("")
        P("Word-forced cuts (allowed off the beat): " + ", ".join(f"{x['id']} ({x['err_ms']:.0f} ms from a beat)" for x in au["word_rows"]) + ".")
    for x in au["off_beat"]:
        P(f"- OFF BEAT: {x['id']} at {x['t']} s, {x['err_ms']} ms from the nearest beat")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(L) + "\n")


# =====================================================================================================================================
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--timing", default=str(ROOT / "data" / "timing.json"))
    ap.add_argument("--storyboard", default=str(ROOT / "data" / "storyboard.json"))
    ap.add_argument("--out", default=None, help="default data/shots.json; for a timing file named timing.<tag>.json: data/shots.<tag>.json")
    ap.add_argument("--doc", default=None, help="markdown shot list ('' to skip); default docs/SHOTS.md, or docs/SHOTS.<tag>.md for timing.<tag>.json")
    ap.add_argument("--no-doc", action="store_true")
    ap.add_argument("--check", action="store_true", help="resolve and report, write nothing")
    ap.add_argument("--quiet", action="store_true", help="only errors and warnings")
    a = ap.parse_args(argv)

    tag = re.match(r"^timing\.(.+)\.json$", Path(a.timing).name)
    tag = tag.group(1) if tag else None
    if a.out is None:
        a.out = str(ROOT / "data" / (f"shots.{tag}.json" if tag else "shots.json"))
    if a.doc is None:
        a.doc = str(ROOT / "docs" / (f"SHOTS.{tag}.md" if tag else "SHOTS.md"))
    if not Path(a.timing).exists():
        hint = ""
        sp = ROOT / "data" / "timing.standin.json"
        if sp.exists():
            hint = f"  (the real song has not been analysed yet; the stand-in works: --timing {sp.relative_to(ROOT)})"
        print(f"ERROR: timing file not found: {a.timing}{hint}", file=sys.stderr)
        return 1
    if not Path(a.storyboard).exists():
        print(f"ERROR: storyboard not found: {a.storyboard}", file=sys.stderr)
        return 1
    try:
        T = load_timing(a.timing)
        SB = json.loads(Path(a.storyboard).read_text())
    except (json.JSONDecodeError, KeyError) as e:
        print(f"ERROR: cannot read input: {e}", file=sys.stderr)
        return 1
    rep = Report()
    res = resolve_all(T, SB, rep)
    js = None
    if res is not None and not rep.errors:
        spans, specs, front, alive_at, dropped = res
        js = build_shots_json(T, SB, spans, specs, front, alive_at, dropped, _rel(a.timing), _rel(a.storyboard), rep)
    for w in rep.warnings:
        print("WARNING:", w)
    for e in rep.errors:
        print("ERROR:", e)
    if rep.errors or js is None:
        print(f"\n{len(rep.errors)} error(s), {len(rep.warnings)} warning(s): nothing written.")
        return 1
    stand_in = "standin" in Path(a.timing).name or "mini" in Path(a.timing).name
    if not a.check:
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_text(json.dumps(js, indent=1))
        tmp.replace(out)
        if a.doc and not a.no_doc:
            write_doc(T, js, Path(a.doc), stand_in, a.storyboard)
    if not a.quiet:
        au = cut_audit(T, js)
        print(f"{len(js['shots'])} shots, {js['duration']:.2f} s ({js['audio_duration']:.2f} s song + {js['tail']:g} s card); "
              f"{au['cuts']} cuts: {au['on_beat']} on the beat (worst {au['max_on_beat_ms']} ms), {au['word_forced']} word-forced, "
              f"{len(au['off_beat'])} off the beat; {len(rep.warnings)} warning(s); dropped: {[d['id'] for d in js['dropped']] or 'none'}")
        for sec in js["sections"]:
            ss = [r for r in js["shots"] if r["section"] == sec["id"]]
            if ss:
                ln = [r["t1"] - r["t0"] for r in ss]
                print(f"  {sec['id']:<11s} {sec['t0']:7.2f}-{sec['t1']:7.2f}  {len(ss):>2} shots  avg {sum(ln) / len(ln):4.2f}  min {min(ln):4.2f}  max {max(ln):5.2f}")
        if not a.check:
            print(f"wrote {a.out}" + (f" and {a.doc}" if a.doc and not a.no_doc else ""))
    return 0


def _rel(p):
    try:
        return str(Path(p).resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


if __name__ == "__main__":
    sys.exit(main())
