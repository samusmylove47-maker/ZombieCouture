#!/usr/bin/env python3
"""consistency.py: the purity test.  A frame must be a pure function of the song time: the same time rendered in a different order, after a jump to the
other end of the film, or in a fresh page must give the same pixels.

    tools/rq.sh python3 -u tools/consistency.py [--scene auto|film|story] [--n 6] [--times 1.5,4,7.2] [--seed 1] [--w 320 --h 180]
                                                [--shots data/shots.json] [--timing (default: the one named in the shots file)] [--motion ones] [--fresh] [--out out/consistency]

One browser page, three passes over the same song times (setT then shoot, PNG bytes compared):
  A  ascending order
  B  every time rendered right after a jump to the far end of the film (the last time, then the time under test)
  C  shuffled order (seeded)
and with --fresh a fourth pass in a new page (a new shader compile, about 15 to 40 s) for the first three times, which is "rendered alone".
Reports the maximum absolute pixel difference (0..255, over the RGB channels) and the number of differing pixels for every pair; identical setups must give 0.
Exit code 0 when every pair is identical, 1 when not, 2 when the page could not be built.  Writes out/consistency/report.json and, for a failing pair, an amplified
difference picture.
--scene auto uses the film when web/film/film.js exists and builds, else the 10 s test scene (shot=story, times 0.5 to 9.5 s).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))


def choose_times(a, scene):
    if a.times:
        return [float(x) for x in a.times.split(",")]
    n = a.n
    if scene == "film":
        sp = Path(a.shots)
        if sp.exists():
            js = json.loads(sp.read_text())
            shots = js["shots"]
            step = max(1, len(shots) // n)
            pick = shots[step // 2::step][:n]
            return [round((s["t0"] + s["t1"]) / 2, 3) for s in pick]
        return [round(2.0 + 25.0 * k, 3) for k in range(n)]
    return [round(0.5 + 9.0 * k / max(1, n - 1), 3) for k in range(n)]


def timing_for(a):
    """--timing, else the timing file named in the shots file (so `--shots data/shots.standin.json` needs no second argument), else the film's default."""
    if a.timing:
        return a.timing
    sp = Path(a.shots)
    if sp.exists():
        try:
            t = json.loads(sp.read_text()).get("source", {}).get("timing")
        except (OSError, ValueError):
            t = None
        if t and (ROOT / t).exists():
            return str(ROOT / t)
    return None


def url_for(port, a, scene):
    base = f"http://127.0.0.1:{port}/web/index.html?style=felt&w={a.w}&h={a.h}"
    if scene == "film":
        tm = timing_for(a)
        tq = f"&timing=/{Path(tm).resolve().relative_to(ROOT)}" if tm else ""
        sq = f"&shots=/{Path(a.shots).resolve().relative_to(ROOT)}" if Path(a.shots).exists() else ""
        return base + f"&shot=film&motion={a.motion}{tq}{sq}&t=0"
    return base + "&shot=story&t=0"


async def open_page(pw, a, scene, port):
    from shoot import CHROME_ARGS                                    # noqa: E402
    b = await pw.chromium.launch(args=CHROME_ARGS)
    pg = await b.new_page(viewport={"width": a.w, "height": a.h})
    pg.on("pageerror", lambda e: print("pageerror:", str(e)[:300], flush=True))
    t0 = time.time()
    await pg.goto(url_for(port, a, scene))
    await pg.wait_for_function("window.ready===true", timeout=300000)
    err = await pg.evaluate("window.__err || null")
    if err:
        await b.close()
        raise RuntimeError("BUILD FAILED: " + str(err)[:800])
    print(f"page ready in {time.time() - t0:.1f}s ({scene})", flush=True)
    return b, pg


async def grab(pg, t):
    await pg.evaluate("t => window.setT(t)", t)
    data = await pg.evaluate("window.shoot('png')")
    return base64.b64decode(data.split(",")[1])


def compare(x: bytes, y: bytes):
    if x == y:
        return {"identical": True, "max_diff": 0, "pixels": 0, "mean_diff": 0.0}
    A = np.asarray(Image.open(io.BytesIO(x)).convert("RGB"), np.int16)
    B = np.asarray(Image.open(io.BytesIO(y)).convert("RGB"), np.int16)
    if A.shape != B.shape:
        return {"identical": False, "max_diff": 255, "pixels": int(A.shape[0] * A.shape[1]), "mean_diff": 255.0, "note": "sizes differ"}
    d = np.abs(A - B).max(-1)
    return {"identical": bool((d == 0).all()), "max_diff": int(d.max()), "pixels": int((d > 0).sum()), "mean_diff": round(float(d.mean()), 4)}


async def main_async(a):
    from playwright.async_api import async_playwright
    from shoot import serve                                          # noqa: E402
    scene = a.scene
    if scene == "auto":
        scene = "film" if (ROOT / "web" / "film" / "film.js").exists() else "story"
    times = choose_times(a, scene)
    rnd = random.Random(a.seed)
    asc = sorted(times)
    far = asc[-1]
    shuf = asc[:]
    while len(shuf) > 2 and shuf == asc:
        rnd.shuffle(shuf)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    srv = serve(0)
    port = srv.server_address[1]
    rep = {"scene": scene, "size": [a.w, a.h], "times": asc, "passes": {}, "pairs": [], "ok": True}
    imgs: dict = {"A": {}, "B": {}, "C": {}, "D": {}}
    try:
        async with async_playwright() as pw:
            try:
                b, pg = await open_page(pw, a, scene, port)
            except RuntimeError as e:
                if scene == "film" and a.scene == "auto":
                    print(f"{e}\nfalling back to the story scene", flush=True)
                    scene = "story"
                    rep["scene"] = scene
                    asc = sorted(choose_times(a, scene))
                    rep["times"] = asc
                    far = asc[-1]
                    shuf = asc[:]
                    rnd.shuffle(shuf)
                    b, pg = await open_page(pw, a, scene, port)
                else:
                    raise
            t0 = time.time()
            for t in asc:                                                   # A: ascending
                imgs["A"][t] = await grab(pg, t)
            print(f"pass A (ascending) done in {time.time() - t0:.1f}s", flush=True)
            t0 = time.time()
            for t in asc:                                                   # B: jump to the far end, then back to t
                await grab(pg, far + 1.0 if scene == "story" and far + 1.0 < 9.9 else far)
                imgs["B"][t] = await grab(pg, t)
            print(f"pass B (after a jump to the end) done in {time.time() - t0:.1f}s", flush=True)
            t0 = time.time()
            for t in shuf:                                                  # C: shuffled
                imgs["C"][t] = await grab(pg, t)
            print(f"pass C (shuffled: {shuf}) done in {time.time() - t0:.1f}s", flush=True)
            await b.close()
            if a.fresh:
                b, pg = await open_page(pw, a, scene, port)
                for t in asc[:3]:
                    imgs["D"][t] = await grab(pg, t)
                print("pass D (fresh page) done", flush=True)
                await b.close()
    finally:
        srv.shutdown()
    names = [("A", "B"), ("A", "C"), ("B", "C")] + ([("A", "D")] if imgs["D"] else [])
    worst = 0
    print(f"\n{'time':>8s}  " + "  ".join(f"{x}-{y}: max diff / px" for x, y in names))
    for t in asc:
        cells = []
        for x, y in names:
            if t in imgs[x] and t in imgs[y]:
                c = compare(imgs[x][t], imgs[y][t])
                rep["pairs"].append({"t": t, "a": x, "b": y, **c})
                worst = max(worst, c["max_diff"])
                cells.append(f"{c['max_diff']:>3d} / {c['pixels']:<7d}      ")
                if not c["identical"]:
                    A = np.asarray(Image.open(io.BytesIO(imgs[x][t])).convert("RGB"), np.int16)
                    B = np.asarray(Image.open(io.BytesIO(imgs[y][t])).convert("RGB"), np.int16)
                    if A.shape == B.shape:
                        d = np.clip(np.abs(A - B) * 8, 0, 255).astype(np.uint8)
                        Image.fromarray(d).save(out / f"diff_{t:g}_{x}{y}.png")
            else:
                cells.append(" " * 22)
        print(f"{t:>8.3f}  " + "  ".join(cells))
    for name in "ABCD":
        for t, png in imgs[name].items():
            if name == "A":
                (out / f"A_{t:g}.png").write_bytes(png)
    rep["max_diff"] = worst
    rep["ok"] = worst == 0
    (out / "report.json").write_text(json.dumps(rep, indent=1))
    print(f"\nmaximum absolute difference over all pairs: {worst}  ->  {'PASS: frames are pure functions of time' if rep['ok'] else 'FAIL: frames depend on history'}")
    return 0 if rep["ok"] else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", default="auto", choices=["auto", "film", "story"])
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--times", default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--w", type=int, default=320)
    ap.add_argument("--h", type=int, default=180)
    ap.add_argument("--shots", default=str(ROOT / "data" / "shots.json"))
    ap.add_argument("--timing", default=None)
    ap.add_argument("--motion", default="ones", choices=["ones", "twos", "mixed"])
    ap.add_argument("--fresh", action="store_true", help="also render the first three times in a brand-new page")
    ap.add_argument("--out", default=str(ROOT / "out" / "consistency"))
    a = ap.parse_args(argv)
    try:
        return asyncio.run(main_async(a))
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
