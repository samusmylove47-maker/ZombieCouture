"""Structural checks of data/timing.json (schema documented in docs/TIMING_SCHEMA.md). `validate` returns a list of problems
(empty = fine); stage 7 refuses to write a file that fails, and `python3 -m zcaudio.schema data/timing.json` checks any file."""
from __future__ import annotations

import json
import sys

import numpy as np

REQUIRED = ["schema", "meta", "tempo", "beats", "bars", "sections", "lines", "words", "visemes", "vocalizations", "instrumentals",
            "frames", "drums", "quality"]
FRAME_KEYS = ["sub", "bass", "lowmid", "mid", "high", "rms", "onset", "vocal"]


def _mono(name, a, errs, strict=False, tol=1e-6):
    a = np.asarray(a, float)
    if len(a) > 1:
        d = np.diff(a)
        if (d < -tol).any() or (strict and (d <= 0).any()):
            errs.append(f"{name}: not {'strictly ' if strict else ''}ascending (first violation at index {int(np.argmax(d < (0 if strict else -tol)))})")


def validate(t: dict) -> list:
    errs: list = []
    for k in REQUIRED:
        if k not in t:
            errs.append(f"missing top-level key '{k}'")
    if errs:
        return errs
    if not str(t["schema"]).startswith("zombie-couture.timing/"):
        errs.append(f"unknown schema id {t['schema']!r}")
    dur = t["meta"]["duration"]
    _mono("beats", t["beats"], errs, strict=True)
    _mono("bars", t["bars"], errs, strict=True)
    if len(t["beats"]) != len(t.get("beat_strength", t["beats"])):
        errs.append("beat_strength length differs from beats")
    if t["beats"] and (t["beats"][0] < -1e-6 or t["beats"][-1] > dur + 1e-3):
        errs.append("beats outside [0, duration]")
    bs = set(round(b, 3) for b in t["beats"])
    if any(round(b, 3) not in bs for b in t["bars"]):
        errs.append("some bars are not beats")
    W, L, S = t["words"], t["lines"], t["sections"]
    for k, w in enumerate(W):
        if w["i"] != k:
            errs.append(f"words[{k}].i = {w['i']}")
            break
        if not (w["t1"] >= w["t0"]):
            errs.append(f"words[{k}] '{w['w']}': t1 < t0")
            break
    _mono("word t0", [w["t0"] for w in W], errs)
    for k in range(len(W) - 1):
        if W[k]["t1"] > W[k + 1]["t0"] + 1e-3:
            errs.append(f"words[{k}] '{W[k]['w']}' overlaps the next word")
            break
    if W and (W[0]["t0"] < -1e-6 or W[-1]["t1"] > dur + 1e-3):
        errs.append("words outside [0, duration]")
    nw = 0
    for k, l in enumerate(L):
        if l["word0"] != nw:
            errs.append(f"lines[{k}] does not continue the word range (word0 {l['word0']} != {nw})")
            break
        nw = l["word1"]
        if not (0 <= l["section"] < len(S)):
            errs.append(f"lines[{k}].section out of range")
    if L and nw != len(W):
        errs.append(f"lines cover {nw} words but there are {len(W)}")
    prev_end = -1.0
    for k, s in enumerate(S):
        if s["end"] < s["start"]:
            errs.append(f"sections[{k}] end < start")
        if s["start"] < prev_end - 1e-3:
            errs.append(f"sections[{k}] '{s['id']}' starts before the previous section ends")
        prev_end = s["end"]
        if not (0 <= s["line0"] <= s["line1"] <= len(L)):
            errs.append(f"sections[{k}] line range out of bounds")
    V = t["visemes"]
    if len(V["words"]) != len(W):
        errs.append(f"visemes.words has {len(V['words'])} entries for {len(W)} words")
    nset = len(V["set"])
    for k, evs in enumerate(V["words"]):
        for e in evs:
            if len(e) != 4 or not (0 <= int(e[2]) < nset) or not (0.0 <= e[3] <= 1.0 + 1e-6):
                errs.append(f"visemes.words[{k}] has a malformed event {e}")
                break
    F = t["frames"]
    n = F["n"]
    if abs(n - int(np.ceil(dur * F["fps"]))) > 1:
        errs.append(f"frames.n {n} inconsistent with duration {dur} at {F['fps']} fps")
    for key in FRAME_KEYS:
        if key not in F or len(F[key]) != n:
            errs.append(f"frames.{key} missing or wrong length")
        elif np.min(F[key]) < -1e-6 or np.max(F[key]) > 1 + 1e-6:
            errs.append(f"frames.{key} outside 0..1")
    for name, d in t["drums"].items():
        if len(d["t"]) != len(d["s"]):
            errs.append(f"drums.{name}: t and s differ in length")
        _mono(f"drums.{name}.t", d["t"], errs)
    for v in t["vocalizations"]:
        if v["t1"] < v["t0"]:
            errs.append("vocalization with t1 < t0")
    return errs


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "data/timing.json"
    problems = validate(json.load(open(path)))
    for p in problems:
        print("PROBLEM:", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    sys.exit(1 if problems else 0)
