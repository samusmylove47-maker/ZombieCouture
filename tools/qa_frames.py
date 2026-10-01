#!/usr/bin/env python3
"""qa_frames.py: scan a directory of rendered frames (JPG or PNG) for problems, on 1/8 downscaled copies.

    python3 tools/qa_frames.py <frames_dir> [--shots data/shots.json] [--fps 24] [--twos] [--json report.json] [--first N] [--limit N] [--quiet]

The frame number is the last number in the file name (f_00123.jpg -> 123, the farm's absolute numbering); time = number / fps.
Checks
  blank    mean luma < 2 or std < 1.  Expected at the very start, and next to a planned `dip` cut; anywhere else it is an ERROR.
  frozen   more than 3 identical frames in a row (mean absolute difference under 0.05 on the 0..255 scale).  With --twos identical pairs are normal, so only
           runs longer than 3 are reported (as with ones).  4..12 frames: WARNING, more than 12 (0.5 s): ERROR.  Blank frames are not counted as frozen.
  jump     a large frame-to-frame difference that is not a planned cut of shots.json (+-1 frame, +-2 with --twos): ERROR.  A difference counts when it is above
           max(12, 5 x the median of the differences around it) on the 0..255 scale.  Planned cuts that show no change are listed as a note.
  flash    frames whose mean luma rises by more than 0.15 (of full scale) over the previous frame, or where more than 25 % of the picture is brighter than 250;
           adjacent flash frames count as one flash; more than 3 flashes in any 1 s window: ERROR (the photosensitivity guideline).
  drift    per shot (or the whole clip without --shots): mean luma and colour at the start and end, min / max of the mean luma, and the largest change.
Exit code 1 if there is an error, 2 for usage errors.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
BLANK_MEAN, BLANK_STD = 2.0, 1.0
FROZEN_MAD = 0.05
FROZEN_RUN = 3
FROZEN_ERR_RUN = 12
JUMP_MIN, JUMP_REL = 12.0, 5.0
FLASH_RISE, FLASH_AREA, FLASH_PEAK = 0.15, 0.25, 250
FLASH_MAX = 3


def frame_no(p: Path):
    m = re.findall(r"\d+", p.stem)
    return int(m[-1]) if m else None


def load_small(p: Path, k=8):
    im = Image.open(p)
    w, h = im.size
    try:
        im.draft("RGB", (max(1, w // k), max(1, h // k)))              # JPEG: decode at reduced size
    except Exception:                                                  # noqa: BLE001
        pass
    im = im.convert("RGB")
    if im.size != (max(1, w // k), max(1, h // k)):
        im = im.resize((max(1, w // k), max(1, h // k)), Image.BILINEAR)
    return np.asarray(im, np.float32), (w, h)


def scan(frames_dir: Path, first=None, limit=None):
    files = [(frame_no(p), p) for p in sorted(frames_dir.iterdir()) if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
    files = [(n, p) for n, p in files if n is not None]
    files.sort()
    if first is not None:
        files = [(n, p) for n, p in files if n >= first]
    if limit:
        files = files[:limit]
    return files


def runs(idx_list):
    """Merge sorted integers into (first, last) runs of consecutive numbers."""
    out = []
    for i in idx_list:
        if out and i == out[-1][1] + 1:
            out[-1][1] = i
        else:
            out.append([i, i])
    return [(a, b) for a, b in out]


def analyse(frames_dir, shots=None, fps=24.0, twos=False, first=None, limit=None):
    files = scan(Path(frames_dir), first, limit)
    if len(files) < 2:
        raise SystemExit(f"need at least 2 frames in {frames_dir} (found {len(files)})")
    nums = [n for n, _ in files]
    imgs, sizes = [], set()
    for _, p in files:
        a, sz = load_small(p)
        imgs.append(a)
        sizes.add(sz)
    n = len(imgs)
    luma = np.array([(a @ LUMA) for a in imgs])                        # n x h x w
    mean = luma.reshape(n, -1).mean(1)
    std = luma.reshape(n, -1).std(1)
    bright = (luma > FLASH_PEAK).reshape(n, -1).mean(1)
    rgb = np.array([a.reshape(-1, 3).mean(0) for a in imgs])
    diff = np.zeros(n)
    for i in range(1, n):
        diff[i] = np.abs(imgs[i] - imgs[i - 1]).mean()
    contiguous = [nums[i] == nums[i - 1] + 1 for i in range(1, n)]
    t_of = lambda k: nums[k] / fps                                      # noqa: E731
    errors, warnings, notes = [], [], []

    # ---- planned cuts
    cuts = []                     # (frame number of the first frame of the new shot, shot id, in)
    dips = []
    if shots:
        for s in shots["shots"][1:]:
            f = int(np.floor(s["t0"] * fps + 1e-6))
            cuts.append((f, s["id"], s.get("in", "cut")))
        for f, sid, tr in cuts:
            if str(tr).startswith("dip"):
                dips.append(f)
    planned = {}
    tol = 2 if twos else 1
    for f, sid, tr in cuts:
        for d in range(-tol, tol + 1):
            planned[f + d] = (sid, tr)

    # ---- blank
    blank_idx = [k for k in range(n) if mean[k] < BLANK_MEAN or std[k] < BLANK_STD]
    blank_runs = []
    for a, b in runs(blank_idx):
        fa, fb = nums[a], nums[b]
        expected = fa <= 1 or any(abs(fa - d) <= int(0.5 * fps) or abs(fb - d) <= int(0.5 * fps) or fa - int(0.5 * fps) <= d <= fb + int(0.5 * fps) for d in dips)
        if not shots and fa <= 1:
            expected = True
        blank_runs.append({"first": fa, "last": fb, "t0": round(fa / fps, 3), "t1": round((fb + 1) / fps, 3), "expected": bool(expected)})
        if not expected:
            errors.append(f"blank frames {fa}-{fb} ({fa / fps:.2f}-{(fb + 1) / fps:.2f} s): mean luma {mean[a:b + 1].min():.1f}, std {std[a:b + 1].min():.1f}")

    # ---- frozen
    blank_set = set(blank_idx)
    same = [False] + [bool(contiguous[i - 1] and diff[i] < FROZEN_MAD and i not in blank_set and (i - 1) not in blank_set) for i in range(1, n)]
    frozen_runs = []
    i = 0
    while i < n:
        if same[i]:
            j = i
            while j + 1 < n and same[j + 1]:
                j += 1
            length = j - i + 2                                          # frames i-1 .. j are identical
            if length > FROZEN_RUN:
                a, b = i - 1, j
                sid = None
                if shots:
                    t = nums[a] / fps
                    for s in shots["shots"]:
                        if s["t0"] <= t < s["t1"]:
                            sid = s["id"]
                            break
                rec = {"first": nums[a], "last": nums[b], "frames": length, "t0": round(nums[a] / fps, 3), "t1": round((nums[b] + 1) / fps, 3), "shot": sid}
                frozen_runs.append(rec)
                msg = f"frozen: {length} identical frames {nums[a]}-{nums[b]} ({rec['t0']:.2f}-{rec['t1']:.2f} s)" + (f" in shot {sid}" if sid else "")
                if length > FROZEN_ERR_RUN and sid != "k_card" and not (sid or "").startswith("card"):
                    errors.append(msg)
                else:
                    warnings.append(msg)
            i = j + 1
        else:
            i += 1

    # ---- jump cuts
    jump_rows, missed = [], []
    for k in range(1, n):
        if not contiguous[k - 1]:
            continue
        lo, hi = max(1, k - 12), min(n, k + 13)
        around = [diff[m] for m in range(lo, hi) if m != k and contiguous[m - 1] and diff[m] > FROZEN_MAD]
        base = float(np.median(around)) if around else 0.0
        thr = max(JUMP_MIN, JUMP_REL * base)
        if diff[k] > thr:
            f = nums[k]
            ok = f in planned
            row = {"frame": f, "t": round(f / fps, 3), "diff": round(float(diff[k]), 1), "threshold": round(thr, 1), "planned": bool(ok), "shot": planned[f][0] if ok else None}
            jump_rows.append(row)
            if not ok:
                errors.append(f"jump cut at frame {f} ({f / fps:.2f} s): difference {diff[k]:.1f} (limit {thr:.1f}) and no planned cut in shots.json")
    jf = {r["frame"] for r in jump_rows}
    have = set(nums)
    for f, sid, tr in cuts:
        if f in have and str(tr).split(":")[0] in ("cut", "seam") and not any((f + d) in jf for d in range(-tol, tol + 1)):
            if f - 1 in have:
                missed.append({"shot": sid, "frame": f, "t": round(f / fps, 3)})
    if missed:
        notes.append(f"{len(missed)} planned hard cut(s) show no visible change: " + ", ".join(f"{m['shot']}@{m['t']:.2f}" for m in missed[:12]) + (" ..." if len(missed) > 12 else ""))

    # ---- flash limiter
    rise = np.zeros(n)
    rise[1:] = (mean[1:] - mean[:-1]) / 255.0
    fl_idx = [k for k in range(n) if (k > 0 and rise[k] > FLASH_RISE) or bright[k] > FLASH_AREA]
    flashes = []
    for a, b in runs(fl_idx):
        flashes.append({"first": nums[a], "last": nums[b], "t": round(nums[a] / fps, 3), "rise": round(float(rise[a:b + 1].max()), 3), "bright_area": round(float(bright[a:b + 1].max()), 3)})
    worst, worst_t = 0, None
    for f in flashes:
        cnt = sum(1 for g in flashes if f["t"] <= g["t"] < f["t"] + 1.0)
        if cnt > worst:
            worst, worst_t = cnt, f["t"]
    if worst > FLASH_MAX:
        errors.append(f"{worst} flashes within 1 s starting at {worst_t:.2f} s (limit {FLASH_MAX})")

    # ---- drift per shot
    segs = []
    if shots:
        for s in shots["shots"]:
            ks = [k for k in range(n) if s["t0"] <= nums[k] / fps < s["t1"]]
            if len(ks) >= 2:
                segs.append((s["id"], s["section"] if "section" in s else "", ks))
    else:
        segs.append(("clip", "", list(range(n))))
    drift = []
    for sid, sec, ks in segs:
        m = mean[ks]
        c0, c1 = rgb[ks[0]], rgb[ks[-1]]
        drift.append({"shot": sid, "section": sec, "frames": len(ks), "t0": round(nums[ks[0]] / fps, 3), "luma_start": round(float(m[0]), 1), "luma_end": round(float(m[-1]), 1),
                      "luma_min": round(float(m.min()), 1), "luma_max": round(float(m.max()), 1), "luma_change": round(float(abs(m[-1] - m[0])), 1),
                      "rgb_start": [round(float(x), 1) for x in c0], "rgb_end": [round(float(x), 1) for x in c1], "colour_shift": round(float(np.linalg.norm(c1 - c0)), 1)})
    return {"frames_dir": str(frames_dir), "frames": n, "first": nums[0], "last": nums[-1], "fps": fps, "twos": twos, "size": sorted(list(s) for s in sizes)[0],
            "missing_numbers": int((nums[-1] - nums[0] + 1) - n),
            "blank": blank_runs, "frozen": frozen_runs, "jumps": jump_rows, "flashes": flashes, "flash_worst_in_1s": worst, "drift": drift,
            "luma_mean_range": [round(float(mean.min()), 1), round(float(mean.max()), 1)], "errors": errors, "warnings": warnings, "notes": notes}


def print_report(r: dict, quiet=False):
    P = print
    P(f"{r['frames']} frames {r['first']}..{r['last']} ({r['size'][0]}x{r['size'][1]}, fps {r['fps']:g}{', twos' if r['twos'] else ''}), {r['missing_numbers']} missing number(s) inside the range")
    if not quiet:
        P(f"mean luma over the clip {r['luma_mean_range'][0]}..{r['luma_mean_range'][1]}")
        for b in r["blank"]:
            P(f"  blank  {b['first']}-{b['last']} ({b['t0']:.2f}-{b['t1']:.2f} s) {'expected (start / dip)' if b['expected'] else 'UNEXPECTED'}")
        for f in r["frozen"]:
            P(f"  frozen {f['first']}-{f['last']}: {f['frames']} identical frames ({f['t0']:.2f}-{f['t1']:.2f} s){' shot ' + f['shot'] if f['shot'] else ''}")
        for j in r["jumps"]:
            P(f"  cut    frame {j['frame']} ({j['t']:.2f} s) diff {j['diff']} (limit {j['threshold']}) {'planned: ' + j['shot'] if j['planned'] else 'NOT PLANNED'}")
        for f in r["flashes"]:
            P(f"  flash  frames {f['first']}-{f['last']} ({f['t']:.2f} s) luma rise {f['rise']}, bright area {f['bright_area']}")
        P(f"flashes: {len(r['flashes'])} in total, worst {r['flash_worst_in_1s']} within one second (limit {FLASH_MAX})")
        P("")
        P("brightness / colour drift per shot (mean luma 0..255):")
        P(f"{'shot':<14s}{'frames':>7s}{'start':>7s}{'end':>7s}{'min':>7s}{'max':>7s}{'change':>8s}{'colour shift':>14s}")
        big = sorted(r["drift"], key=lambda d: -d["luma_change"])
        rows = r["drift"] if len(r["drift"]) <= 24 else big[:24]
        for d in rows:
            P(f"{d['shot']:<14s}{d['frames']:>7d}{d['luma_start']:>7.1f}{d['luma_end']:>7.1f}{d['luma_min']:>7.1f}{d['luma_max']:>7.1f}{d['luma_change']:>8.1f}{d['colour_shift']:>14.1f}")
        if len(r["drift"]) > 24:
            P(f"  (largest 24 of {len(r['drift'])} shots; all are in the JSON)")
        P("")
    for n in r["notes"]:
        P("NOTE:", n)
    for w in r["warnings"]:
        P("WARNING:", w)
    for e in r["errors"]:
        P("ERROR:", e)
    P(f"{len(r['errors'])} error(s), {len(r['warnings'])} warning(s)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_dir")
    ap.add_argument("--shots", default=None, help="data/shots.json: planned cuts and shot ids (without it every jump is unplanned)")
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--twos", action="store_true", help="frames were rendered on twos: identical pairs are expected, cuts may sit one frame later")
    ap.add_argument("--json", default=None)
    ap.add_argument("--first", type=int, default=None, help="only frames from this number")
    ap.add_argument("--limit", type=int, default=None, help="only this many frames")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    d = Path(a.frames_dir)
    if not d.is_dir():
        print(f"ERROR: {d} is not a directory", file=sys.stderr)
        return 2
    shots = json.loads(Path(a.shots).read_text()) if a.shots else None
    r = analyse(d, shots, a.fps, a.twos, a.first, a.limit)
    print_report(r, a.quiet)
    if a.json:
        Path(a.json).write_text(json.dumps(r, indent=1))
    return 1 if r["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
