#!/usr/bin/env python3
"""qa_shots.py: audit data/shots.json against the timing it was made from.

    python3 tools/qa_shots.py [--shots data/shots.json] [--timing data/timing.json] [--json report.json] [--quiet]

Errors (exit code 1):  gaps / overlaps / wrong first or last time, a shot under 0.5 s, a cut that is more than 20 ms from a beat and is not word-forced,
                       a cut inside a held word (a word longer than 0.6 s) unless the incoming transition is flash / whip / dip,
                       more than 3 `flash` cuts inside any 1 s window.
Warnings:              average shot length in choruses outside 1.7..1.9 s, verse 1 or the bridge not longer than the choruses, per-section average outside 1.2..6 s,
                       shots under 0.8 s, `min`-less dropped shots.
Reports:               shot statistics per section, transition count table, cut alignment (bars / beats / words), estimated render time by cost class
                       (A = 3.0 s, B = 3.5 s, C = 4.5 s per rendered frame at 720p; on twos half the frames are rendered).
"""
from __future__ import annotations

import argparse
import bisect
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from make_shots import Timing, load_timing, BEAT_TOL_S, MIN_SHOT_S      # noqa: E402

COST_S = {"A": 3.0, "B": 3.5, "C": 4.5}          # seconds per rendered frame at 720p
HELD_WORD_S = 0.9       # nearly two beats at 126 BPM; shorter words are not "held notes"
FLASH_MAX = 3
CHORUS_AVG = (1.7, 1.9)


def trans_kind(s: str) -> str:
    return str(s).split(":")[0] if s else "cut"


def audit(js: dict, T: Timing) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    S = js["shots"]
    fps = js.get("fps", 24)
    total = js["duration"]
    rep: dict = {"shots": len(S), "duration": total}

    # ---- structure
    if not S:
        errors.append("no shots")
        return {"errors": errors, "warnings": warnings, **rep}
    if abs(S[0]["t0"]) > 1e-6:
        errors.append(f"first shot starts at {S[0]['t0']} s, not 0")
    if abs(S[-1]["t1"] - total) > 1e-3:
        errors.append(f"last shot ends at {S[-1]['t1']} s, not the duration {total} s")
    for a, b in zip(S, S[1:]):
        if abs(a["t1"] - b["t0"]) > 1e-6:
            errors.append(f"{'gap' if b['t0'] > a['t1'] else 'overlap'} between {a['id']} (ends {a['t1']}) and {b['id']} (starts {b['t0']})")
    ids = Counter(s["id"] for s in S)
    for k, n in ids.items():
        if n > 1:
            errors.append(f"duplicate shot id {k}")
    for s in S:
        if s["t1"] - s["t0"] < MIN_SHOT_S - 1e-9:
            errors.append(f"{s['id']}: {s['t1'] - s['t0']:.3f} s long (minimum {MIN_SHOT_S} s)")

    # ---- cuts against the beat grid and the words
    starts = [w["t0"] for w in T.words]
    ends = [w["t1"] for w in T.words]

    def near_word_edge(t):
        for arr in (starts, ends):
            i = bisect.bisect_left(arr, t - 0.005)
            if i < len(arr) and abs(arr[i] - t) <= 0.005:
                return True
        return False

    cuts = []
    bars = set(round(b, 3) for b in T.bars)
    for s in S[1:]:
        t = s["t0"]
        err = T.beat_error(t)
        snap = s.get("snap")
        on_beat = err <= BEAT_TOL_S
        word_forced = (snap == "word") or near_word_edge(t)
        edge = snap == "span" and abs(t - T.duration) < 1e-3                      # the card starts at the audio end
        row = {"id": s["id"], "t": t, "err_ms": round(1000 * err, 1), "on_beat": on_beat, "word_forced": word_forced, "in": s.get("in", "cut"),
               "downbeat": any(abs(t - b) < 0.001 for b in T.bars)}
        cuts.append(row)
        if not on_beat and not word_forced and not edge:
            errors.append(f"{s['id']}: cut at {t:.3f} s is {row['err_ms']:.0f} ms from the nearest beat and is not word-forced")
        if snap == "word" and not near_word_edge(t) and not on_beat:
            # a word-forced anchor with an offset (line2w4+1b) is fine; only note it
            pass
        # inside a held word?
        wi = bisect.bisect_right(starts, t) - 1
        if wi >= 0:
            w = T.words[wi]
            excused = snap == "span" or s.get("held") == "ok"       # a section downbeat rides over a held note; `"held": "ok"` in the storyboard = a knowing cut on a bar line with no singer on screen
            if (w["t1"] - w["t0"] > HELD_WORD_S and w["t0"] + 0.02 < t < w["t1"] - 0.02 and not excused
                    and trans_kind(s.get("in", "cut")) not in ("flash", "whip", "dip")):
                errors.append(f"{s['id']}: cut at {t:.3f} s falls inside the held word {w['w']!r} ({w['t0']:.2f}-{w['t1']:.2f} s, {w['t1'] - w['t0']:.2f} s long) with a plain `{s.get('in', 'cut')}`")
    rep["cuts"] = {"n": len(cuts), "on_beat": sum(c["on_beat"] for c in cuts), "word_forced": sum(1 for c in cuts if c["word_forced"] and not c["on_beat"]),
                   "downbeats": sum(c["downbeat"] for c in cuts), "worst_on_beat_ms": max([c["err_ms"] for c in cuts if c["on_beat"]], default=0.0)}

    # ---- flash budget
    fl = [s["t0"] for s in S if trans_kind(s.get("in")) == "flash"]
    worst = 0
    for t in fl:
        n = sum(1 for u in fl if t <= u < t + 1.0)
        worst = max(worst, n)
        if n > FLASH_MAX:
            errors.append(f"{n} flash cuts within 1 s starting at {t:.2f} s (limit {FLASH_MAX})")
            break
    rep["flash"] = {"count": len(fl), "max_in_1s": worst}

    # ---- lengths
    by = defaultdict(list)
    for s in S:
        by[s["section"]].append(s["t1"] - s["t0"])
    secinfo = {sec["id"]: sec for sec in js.get("sections", [])}
    stats = {}
    for sid, ls in by.items():
        span = (secinfo[sid]["t1"] - secinfo[sid]["t0"]) if sid in secinfo else sum(ls)
        stats[sid] = {"n": len(ls), "avg": sum(ls) / len(ls), "min": min(ls), "max": max(ls), "span": span}
        if sid != "card" and not 1.2 <= stats[sid]["avg"] <= 6.0:
            warnings.append(f"{sid}: average shot length {stats[sid]['avg']:.2f} s is outside 1.2..6 s")
    for sid, st in stats.items():
        if sid.startswith("chorus") and not CHORUS_AVG[0] <= st["avg"] <= CHORUS_AVG[1]:
            warnings.append(f"{sid}: average shot length {st['avg']:.2f} s, the target in choruses is {CHORUS_AVG[0]}..{CHORUS_AVG[1]} s")
    ch = [st["avg"] for sid, st in stats.items() if sid.startswith("chorus")]
    if ch:
        m = sum(ch) / len(ch)
        for sid in ("verse1", "bridge1"):
            if sid in stats and stats[sid]["avg"] <= m:
                warnings.append(f"{sid}: average shot length {stats[sid]['avg']:.2f} s is not longer than the choruses' {m:.2f} s (verse 1 and the bridge should breathe)")
    short = [s["id"] for s in S if s["t1"] - s["t0"] < 0.8]
    if short:
        warnings.append(f"{len(short)} shot(s) under 0.8 s: {', '.join(short)}")
    rep["sections"] = stats

    # ---- transitions
    tc = Counter(trans_kind(s.get("in")) for s in S[1:])
    per = defaultdict(Counter)
    for s in S:
        per[s["section"]][trans_kind(s.get("in"))] += 1
    rep["transitions"] = dict(tc)
    rep["transitions_by_section"] = {k: dict(v) for k, v in per.items()}

    # ---- render cost
    cost = {}
    for k in "ABC":
        secs = sum(s["t1"] - s["t0"] for s in S if s.get("cost", "B") == k)
        cost[k] = {"seconds": secs, "shots": sum(1 for s in S if s.get("cost", "B") == k), "frames": secs * fps,
                   "hours_ones": secs * fps * COST_S[k] / 3600, "hours_twos": secs * fps * COST_S[k] / 7200}
    rep["cost"] = cost
    rep["render_hours_ones"] = sum(c["hours_ones"] for c in cost.values())
    rep["render_hours_twos"] = sum(c["hours_twos"] for c in cost.values())
    rep["errors"], rep["warnings"] = errors, warnings
    rep["dropped"] = [d["id"] for d in js.get("dropped", [])]
    return rep


def print_report(rep: dict, quiet=False):
    P = print
    if not quiet:
        P(f"{rep['shots']} shots, {rep['duration']:.2f} s")
        c = rep["cuts"]
        P(f"cuts: {c['n']}: {c['on_beat']} within 20 ms of a beat (worst {c['worst_on_beat_ms']} ms; {c['downbeats']} on a downbeat), {c['word_forced']} word-forced off the beat")
        P("")
        P(f"{'section':<12s}{'shots':>6s}{'span s':>8s}{'avg s':>7s}{'min s':>7s}{'max s':>7s}")
        for sid, st in rep["sections"].items():
            P(f"{sid:<12s}{st['n']:>6d}{st['span']:>8.1f}{st['avg']:>7.2f}{st['min']:>7.2f}{st['max']:>7.2f}")
        P("")
        P("transitions into shots (first shot excluded): " + ", ".join(f"{k} {v}" for k, v in sorted(rep["transitions"].items())) + f"; flash: {rep['flash']['count']} (worst {rep['flash']['max_in_1s']} in one second, limit {FLASH_MAX})")
        P("")
        P("estimated render time (A 3.0 s, B 3.5 s, C 4.5 s per rendered frame at 720p):")
        P(f"{'class':<7s}{'shots':>6s}{'film s':>9s}{'frames':>8s}{'ones h':>8s}{'twos h':>8s}")
        for k, v in rep["cost"].items():
            P(f"{k:<7s}{v['shots']:>6d}{v['seconds']:>9.1f}{v['frames']:>8.0f}{v['hours_ones']:>8.2f}{v['hours_twos']:>8.2f}")
        P(f"{'total':<7s}{rep['shots']:>6d}{rep['duration']:>9.1f}{'':>8s}{rep['render_hours_ones']:>8.2f}{rep['render_hours_twos']:>8.2f}")
        if rep["dropped"]:
            P(f"\ndropped opt shots: {', '.join(rep['dropped'])}")
        P("")
    for w in rep["warnings"]:
        P("WARNING:", w)
    for e in rep["errors"]:
        P("ERROR:", e)
    P(f"{len(rep['errors'])} error(s), {len(rep['warnings'])} warning(s)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shots", default=str(ROOT / "data" / "shots.json"))
    ap.add_argument("--timing", default=None, help="default: the timing named inside shots.json")
    ap.add_argument("--json", default=None, help="also write the report as JSON")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    sp = Path(a.shots)
    if not sp.exists():
        print(f"ERROR: {sp} not found (run tools/make_shots.py first)", file=sys.stderr)
        return 2
    js = json.loads(sp.read_text())
    tp = Path(a.timing) if a.timing else ROOT / js.get("source", {}).get("timing", "data/timing.json")
    if not tp.exists():
        print(f"ERROR: timing file {tp} not found (--timing)", file=sys.stderr)
        return 2
    T = load_timing(tp)
    aid = T.T["meta"].get("audio_id")
    rep = audit(js, T)
    if js.get("audio_id") and aid and js["audio_id"] != aid:
        rep["errors"].append(f"shots.json was made for audio {js['audio_id']} but {tp.name} is audio {aid}: run tools/make_shots.py again")
    print_report(rep, a.quiet)
    if a.json:
        Path(a.json).write_text(json.dumps(rep, indent=1))
    return 1 if rep["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
