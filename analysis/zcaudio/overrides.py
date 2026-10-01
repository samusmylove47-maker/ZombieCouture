"""Hand corrections: `data/overrides.json` (applied last, by stage 7) and `data/pron.json` (pronunciations, used by stages 3 and 6).

overrides.json
{
  "words":    { "chorus1.3/2": {"t0": 47.31, "t1": 47.62, "expect": "helpers"},   # line id "/" 1-based word in the line
                "57":         {"t0": 12.0} },                                    # or the global word index (see timing.json words[].i)
  "lines":    { "verse1.2": {"t0": 9.8, "t1": 13.2} },                            # pins the line's first word start / last word end
  "sections": { "chorus1": {"start": 41.2, "end": 62.9} },                        # pins the musical (bar) boundaries used for cuts
  "beats":    { "downbeat_shift": 1,                                              # rotate which beat is 'one' (-3..3)
                "constant": {"bpm": 130.6, "first_beat": 0.42, "first_downbeat": 0.42} },   # replace the tracked grid by a constant one
  "vocalizations": [ {"t0": 88.0, "t1": 90.5, "kind": "moan"} ]                   # add / replace non-lyric vocal spans
}
Pinned words get src "pinned", conf 1. Runs of interpolated words next to a pin are re-spaced between their anchors; recognised
(asr) words are never moved except to keep the order (a warning is printed when a pin forces that).
"""
from __future__ import annotations

import numpy as np

from .common import load_json


def load(ctx) -> dict:
    p = ctx.out_dir / "overrides.json"
    if not p.exists():
        return {}
    try:
        ov = load_json(p)
    except Exception as e:                                        # a broken hand-edited file must not silently vanish
        raise SystemExit(f"{p}: not valid JSON ({e})")
    return ov or {}


def line_keys(lyr) -> list:
    """timing.json line ids: '<section id>.<n>' with n the 1-based line number inside the section."""
    keys = []
    for s in lyr.sections:
        for n, li in enumerate(s.lines, 1):
            keys.append((li, f"{s.id}.{n}"))
    keys.sort()
    return [k for _, k in keys]


def resolve_word(lyr, lkeys: list, key: str):
    """'12' / 'w12' -> global index; 'chorus1.3/2' -> 2nd word of that line."""
    k = str(key).strip()
    if "/" in k:
        lid, _, n = k.partition("/")
        if lid in lkeys and n.isdigit():
            line = lyr.lines[lkeys.index(lid)]
            i = line.words[0] + int(n) - 1
            return i if line.words[0] <= i < line.words[1] else None
        return None
    k = k[1:] if k[:1] in "wW" else k
    if k.isdigit() and int(k) < len(lyr.words):
        return int(k)
    return None


def apply_words(words: list, lyr, ov: dict, warn) -> set:
    """Pins word / line times in place. Returns the set of pinned word indices."""
    lkeys = line_keys(lyr)
    pinned = set()

    def pin(i, t0=None, t1=None, expect=None, label=""):
        w = words[i]
        if expect and w["n"] != _norm(expect):
            warn(f"override {label}: expected word '{expect}' but index {i} is '{w['w']}' - applied anyway")
        if t0 is not None:
            w["t0"] = float(t0)
        if t1 is not None:
            w["t1"] = float(t1)
        elif t0 is not None:
            w["t1"] = max(w["t1"], w["t0"] + 0.06) if w["t1"] > w["t0"] else w["t0"] + 0.25
        w["src"], w["conf"] = "pinned", 1.0
        pinned.add(i)

    for key, spec in (ov.get("lines") or {}).items():
        if key not in lkeys:
            warn(f"override lines.{key}: no such line (ids look like 'verse1.2')")
            continue
        line = lyr.lines[lkeys.index(key)]
        if "t0" in spec:
            pin(line.words[0], t0=spec["t0"], label=f"lines.{key}")
        if "t1" in spec:
            pin(line.words[1] - 1, t1=spec["t1"], label=f"lines.{key}")
            words[line.words[1] - 1]["t0"] = min(words[line.words[1] - 1]["t0"], float(spec["t1"]) - 0.06)
    for key, spec in (ov.get("words") or {}).items():
        i = resolve_word(lyr, lkeys, key)
        if i is None:
            warn(f"override words.{key}: no such word")
            continue
        pin(i, spec.get("t0"), spec.get("t1"), spec.get("expect"), label=f"words.{key}")
    if pinned:
        respace(words, pinned, warn)
    return pinned


def _norm(s: str) -> str:
    from .lyrics import norm_word
    return norm_word(s)


def respace(words: list, pinned: set, warn, min_gap: float = 0.02):
    """Keep the word order valid after pins: interpolated words that touch a pin are re-laid between their anchors, and anchors
    that would now be out of order are pushed (with a warning)."""
    n = len(words)
    fixed = lambda k: words[k]["src"] in ("asr", "pinned")
    k = 0
    while k < n:
        if fixed(k):
            k += 1
            continue
        j = k
        while j < n and not fixed(j):
            j += 1
        left = words[k - 1] if k > 0 else None
        right = words[j] if j < n else None
        touches = (k - 1 in pinned) or (j in pinned)
        run = words[k:j]
        lo = (max(left["t1"], left["t0"] + 0.05) + min_gap) if left else 0.0
        hi = (right["t0"] - min_gap) if right else max(w["t1"] for w in run)
        a0, b0 = run[0]["t0"], run[-1]["t1"]
        out_of_span = a0 < lo - 1e-6 or b0 > hi + 1e-6
        if (touches or out_of_span) and hi > lo:
            a1, b1 = max(a0, lo), min(b0, hi)
            if b1 - a1 < 0.05 * len(run) or not (a0 <= b0):
                a1, b1 = lo, hi
            scale = (b1 - a1) / max(b0 - a0, 1e-6)
            for w in run:
                t0 = a1 + (w["t0"] - a0) * scale
                t1 = a1 + (w["t1"] - a0) * scale
                w["t0"], w["t1"] = t0, max(t1, t0 + 0.03)
        k = j
    # final monotone pass over everything else
    for k in range(1, n):
        if words[k]["t0"] < words[k - 1]["t0"] + min_gap:
            if words[k]["src"] == "asr" and k not in pinned:
                warn(f"pin forces recognised word #{k} '{words[k]['w']}' to move from {words[k]['t0']:.2f}s to keep the order")
            shift = words[k - 1]["t0"] + min_gap - words[k]["t0"]
            words[k]["t0"] += shift
            words[k]["t1"] += shift
    for k in range(n - 1):
        if words[k]["t1"] > words[k + 1]["t0"]:
            words[k]["t1"] = max(words[k]["t0"] + 0.02, words[k + 1]["t0"])
