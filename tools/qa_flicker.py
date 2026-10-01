#!/usr/bin/env python3
"""Finds frames that disagree with BOTH neighbours: depth fighting, a texture that drops out for a frame, a stray flash.

  python3 tools/qa_flicker.py <frames_dir> [--first N] [--last M] [--thr 30] [--scale 2] [--block 16] [--top 40] [--out out/qa_flicker.json]

For every frame n the pixel-wise amount by which I(n) lies OUTSIDE the interval spanned by I(n-1) and I(n+1) is computed
(smooth motion and fades keep I(n) between its neighbours, so they score about zero; grain moves only a few levels).
A pixel is an outlier when that amount exceeds --thr (0..255, max over the colour channels).  The frame is scored by its densest
block of outliers (fraction of a --block x --block block), by the number of blocks that are at least a quarter full and by the
total outlier area.  The report lists the worst frames; a cut is not an outlier (the frame equals its next neighbour).
Exit code 0 always: this is a finding tool, the director decides what is worth a re-render (see docs/NEXT.md).
"""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image


def load(path, scale):
    im = Image.open(path)
    if scale > 1:
        im.draft("RGB", (im.size[0] // scale, im.size[1] // scale))
    im = im.convert("RGB")
    return np.asarray(im, dtype=np.int16)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir")
    ap.add_argument("--first", type=int, default=None)
    ap.add_argument("--last", type=int, default=None)
    ap.add_argument("--thr", type=int, default=30)
    ap.add_argument("--scale", type=int, default=2, help="decode at 1/scale size (1, 2, 4, 8)")
    ap.add_argument("--block", type=int, default=16)
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    names = sorted(f for f in os.listdir(a.dir) if re.fullmatch(r"f_\d{5}\.(jpg|png)", f))
    nums = [int(f[2:7]) for f in names]
    ext = names[0].rsplit(".", 1)[1]
    lo = nums[0] if a.first is None else a.first
    hi = nums[-1] if a.last is None else a.last
    have = set(nums)
    rows = []
    prev = cur = None
    B = a.block
    for n in range(lo, hi + 1):
        if n not in have:
            prev, cur = cur, None
            continue
        nxt = load(os.path.join(a.dir, f"f_{n:05d}.{ext}"), a.scale)
        # (prev, cur, nxt) are frames n-2, n-1, n: score the middle one
        if prev is not None and cur is not None and cur is not False:
            lo_ = np.minimum(prev, nxt)
            hi_ = np.maximum(prev, nxt)
            out = np.maximum(0, np.maximum(lo_ - cur, cur - hi_)).max(axis=2)
            m = out > a.thr
            h, w = m.shape
            hb, wb = h // B, w // B
            blk = m[: hb * B, : wb * B].reshape(hb, B, wb, B).sum(axis=(1, 3)) / float(B * B)
            j = int(blk.argmax())
            by, bx = divmod(j, wb)
            rows.append({"frame": n - 1, "dense": round(float(blk.max()), 3), "blocks25": int((blk >= 0.25).sum()),
                         "area": round(float(m.mean()) * 100, 3), "at": [int(bx * B * a.scale), int(by * B * a.scale)]})
        prev, cur = cur, nxt
    rows.sort(key=lambda r: (-r["blocks25"], -r["dense"]))
    print(f"{len(rows)} frames scored ({a.dir}), thr {a.thr}, 1/{a.scale} size, block {B}")
    print("frame  dense blocks>=25%  area%  where(x,y at full size)")
    for r in rows[: a.top]:
        print(f"{r['frame']:5d}  {r['dense']:.2f}  {r['blocks25']:5d}  {r['area']:6.3f}  {r['at']}")
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(rows, open(a.out, "w"))
        print("wrote", a.out)


if __name__ == "__main__":
    sys.exit(main())
