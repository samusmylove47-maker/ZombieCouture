"""Command line front-end:  python3 -m zcaudio run --song song.mp3 [--lyrics lyrics.txt] [--out data] ...

The stages are strictly sequential (never two heavy stages at once); `analysis/run_audio.sh` wraps this in `nice -n 19`.
"""
from __future__ import annotations

import argparse
import copy
import importlib
import sys
import time
from pathlib import Path

from .common import DEFAULTS, PROJECT_DIR, Ctx, deep_merge, load_json, parse_set

# (number, name, module)
STAGES = [
    (0, "normalize", "s0_normalize"),
    (1, "separate", "s1_separate"),
    (2, "asr", "s2_asr"),
    (3, "align", "s3_align"),
    (4, "beats", "s4_beats"),
    (5, "features", "s5_features"),
    (6, "visemes", "s6_visemes"),
    (7, "timing", "s7_timing"),
    (8, "sheet", "s8_sheet"),
]


def parse_stage_list(spec: str) -> list[int]:
    if spec in (None, "", "all"):
        return [n for n, _, _ in STAGES]
    out: list[int] = []
    names = {name: n for n, name, _ in STAGES}
    for part in spec.split(","):
        part = part.strip()
        if "-" in part and part.replace("-", "").isdigit():
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        elif part.isdigit():
            out.append(int(part))
        elif part in names:
            out.append(names[part])
        else:
            raise SystemExit(f"unknown stage '{part}' (use 0-8, names {list(names)}, or 'all')")
    return sorted(set(out))


def build_ctx(args) -> Ctx:
    cfg = copy.deepcopy(DEFAULTS)
    if args.config:
        cfg = deep_merge(cfg, load_json(args.config))
    if args.fps:
        cfg["fps"] = int(args.fps)
    parse_set(cfg, args.set or [])
    excerpt = None
    if args.excerpt:
        a, _, d = args.excerpt.partition(":")
        excerpt = (float(a), float(d))
    out = Path(args.out) if args.out else PROJECT_DIR / "data"
    song = args.song
    ctx = Ctx(out, song=song, lyrics=args.lyrics, cfg=cfg, excerpt=excerpt, quiet=args.quiet)
    return ctx


def run_stages(ctx: Ctx, stages: list[int]):
    for n, name, mod in STAGES:
        if n not in stages:
            continue
        t0 = time.time()
        ctx.begin_stage(name)
        m = importlib.import_module(f"zcaudio.{mod}")
        m.run(ctx)
        ctx.log(name, f"done in {time.time() - t0:.1f}s")


def summarize(ctx: Ctx):
    """Short health report after a full run: what to look at first."""
    tp = ctx.out_dir / "timing.json"
    if not tp.exists():
        return
    t = load_json(tp)
    q, tp_ = t["quality"], t["tempo"]
    a, b = q["alignment"], q.get("beats", {})
    lines = ["", "---- summary " + "-" * 60,
             (f"tempo {tp_['bpm']:.2f} BPM (local {tp_['bpm_range'][0]}..{tp_['bpm_range'][1]})  confidence {tp_['confidence']}"
              f" (beats {b.get('beat_conf')}, downbeat {b.get('downbeat_conf')})  first downbeat {tp_['first_downbeat']} s"
              if tp_.get("bpm_range") else f"tempo {tp_['bpm']:.2f} BPM"),
             f"lyrics {a['words']} words: {a['asr_anchored']} timed by the recogniser ({100 * a['anchor_share']:.0f}%), {a['interpolated']} interpolated, {a['pinned']} pinned;"
             f" {len(q['review'])} of {len(t['lines'])} lines to check; {len(t['vocalizations'])} non-lyric vocal spans"]
    for s in t["sections"]:
        lines.append(f"  {s['id']:<11s} bars {s['bar0']:>3}+{s['bars']:<3} {s['start']:7.2f}-{s['end']:7.2f} s   sung {s['t0']:7.2f}-{s['t1']:7.2f}")
    for r in q["review"][:8]:
        lines.append(f"  check {r['line']:<12s} at {r['t0']:7.2f} s: {r['why']}")
    if len(q["review"]) > 8:
        lines.append(f"  ... and {len(q['review']) - 8} more in quality.review")
    if q["pronunciations_to_check"]:
        lines.append("pronunciations to check: " + ", ".join(p["word"] for p in q["pronunciations_to_check"]))
    for w in q["warnings"]:
        lines.append("WARNING " + w)
    lines.append(f"open {ctx.p('sheet.html')} (player + tap-along) and sheet.png; corrections go in {ctx.out_dir / 'overrides.json'} (analysis/README.md)")
    print("\n".join(lines), flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="zcaudio", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run the pipeline")
    r.add_argument("--song", required=True, help="input audio (mp3/wav/flac/m4a...)")
    r.add_argument("--lyrics", default=str(PROJECT_DIR / "data" / "lyrics.txt"), help="lyrics with [Section - direction] tags")
    r.add_argument("--out", default=None, help="output root (default <project>/data); audio/* and timing.json go here")
    r.add_argument("--stages", default="all", help="e.g. all | 0-3 | 4,5 | align (default all)")
    r.add_argument("--fps", default=None, help="feature frame rate (default 24)")
    r.add_argument("--excerpt", default=None, help="START:DURATION seconds - analyse only an excerpt (tests)")
    r.add_argument("--config", default=None, help="JSON file merged over the defaults")
    r.add_argument("--set", action="append", help="override one setting, e.g. --set beats.bpm_hint=128")
    r.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "run":
        ctx = build_ctx(args)
        stages = parse_stage_list(args.stages)
        if 0 not in stages and not ctx.p("meta.json").exists():
            raise SystemExit("stage 0 has not been run for this output directory")
        run_stages(ctx, stages)
        if not ctx.quiet and 7 in stages:
            summarize(ctx)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
