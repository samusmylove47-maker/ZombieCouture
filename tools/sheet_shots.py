#!/usr/bin/env python3
"""sheet_shots.py: contact sheets of every shot, to look at before any long render.

    tools/rq.sh python3 -u tools/sheet_shots.py [--shots data/shots.json] [--timing data/timing.json] [--only id,section,...]
                                                [--w 480 --h 270] [--frames 3] [--out out/sheets] [--motion ones] [--batch 24] [--force]
    python3 tools/sheet_shots.py --placeholder ...     tile with synthetic pictures (no browser): tests the layout and the labels
    python3 tools/sheet_shots.py --tile-only ...       tile the frames that already exist (missing ones are drawn as grey tiles)

For every shot it renders `--frames` pictures (3: progress 0.1, 0.5, 0.9) through the film runtime (`shot=film`, the song time
t = t0 + p * (t1 - t0)), in one browser page per batch of shots (the shader compile is paid once per page), and tiles them: one row per shot,
8 rows per sheet (`out/sheets/sheet_01.png` ...).  A row shows the shot id, cost class, template, start-end (length in s and beats), section,
the transition in, the lyric line sung at the start and the storyboard note; each picture is captioned with its progress and song time.
Frames are cached in `<out>/frames/<w>x<h>/<id>_<p>_<key>.png` and reused (resumable); the key is a hash of the shot's template, args, times and the timing file,
so a changed storyboard never shows an old picture (frames of changed shots are deleted).  A change to the film code itself is not seen: use `--force`.
Always run it through the render queue (tools/rq.sh); with 66 shots and 3 frames it costs about one page load per 24 shots plus 2 to 6 s per frame.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import statistics
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

ROWS_PER_SHEET = 8
COST_COL = {"A": (120, 200, 140), "B": (240, 200, 90), "C": (235, 110, 110)}
BG, PANEL, INK, DIM = (24, 22, 30), (38, 35, 48), (245, 240, 250), (170, 165, 185)


def font(kind: str, size: int):
    cands = {
        "display": [ROOT / "assets" / "FredokaOne-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
        "bold": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"],
        "text": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"],
        "mono": ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"],
        "italic": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    }[kind]
    for c in cands:
        try:
            return ImageFont.truetype(str(c), size)
        except OSError:
            continue
    return ImageFont.load_default()


def section_colour(name: str):
    h = sum((i + 1) * ord(c) for i, c in enumerate(name)) % 360
    import colorsys
    r, g, b = colorsys.hsv_to_rgb(h / 360.0, 0.45, 0.95)
    return int(r * 255), int(g * 255), int(b * 255)


def progress_list(n: int):
    if n <= 1:
        return [0.5]
    lo, hi = 0.1, 0.9
    return [round(lo + (hi - lo) * k / (n - 1), 4) for k in range(n)]


_KEYS: dict = {}                                                       # shot id -> short hash of everything that changes its picture


def shot_key(shot: dict, stamp: str) -> str:
    blob = json.dumps([shot.get("tpl"), shot.get("args"), round(shot["t0"], 3), round(shot["t1"], 3), shot.get("in"), shot.get("out"), shot.get("cost"), stamp],
                      sort_keys=True, default=str)
    return hashlib.md5(blob.encode()).hexdigest()[:6]


def register_keys(shots: list, stamp: str, cache: Path) -> int:
    """Name each cached frame after the shot's template, args, times and the timing file, so a changed storyboard never shows an old picture.
    Frames of an earlier version of a shot are deleted.  Returns how many were removed."""
    _KEYS.clear()
    for sh in shots:
        _KEYS[sh["id"]] = shot_key(sh, stamp)
    gone = 0
    for f in cache.glob("*_???_??????.png"):
        parts = f.stem.rsplit("_", 2)
        if len(parts) == 3 and parts[0] in _KEYS and parts[2] != _KEYS[parts[0]]:
            f.unlink()
            gone += 1
    return gone


def frame_path(cache: Path, sid: str, p: float) -> Path:
    return cache / f"{sid}_{int(round(p * 100)):03d}_{_KEYS.get(sid, 'nokey')}.png"


def song_time(shot: dict, p: float) -> float:
    return min(shot["t0"] + p * (shot["t1"] - shot["t0"]), shot["t1"] - 1e-3)


# ---------------------------------------------------------------------------------------------------------------------- rendering
def placeholder_frame(shot: dict, p: float, w: int, h: int) -> Image.Image:
    """A synthetic picture (no browser): colour from the template name, a moving circle for the progress, the time in large letters."""
    base = section_colour(shot["tpl"])
    im = Image.new("RGB", (w, h), tuple(int(c * 0.55) for c in base))
    d = ImageDraw.Draw(im)
    for k in range(0, w, 40):
        d.line([(k, 0), (k - h // 2, h)], fill=tuple(int(c * 0.65) for c in base), width=3)
    cx = int(w * (0.15 + 0.7 * p))
    d.ellipse([cx - h // 6, h // 2 - h // 6, cx + h // 6, h // 2 + h // 6], fill=base)
    d.text((10, 8), f"{song_time(shot, p):.2f} s", font=font("bold", 26), fill=INK)
    return im


async def render_frames(todo: list, shots_by_id: dict, cache: Path, a, timing_url: str, shots_url: str):
    """todo: list of (shot id, p).  One page per batch of shots.  Writes the PNGs; returns {(id, p): (ms, calls) or error string}."""
    from playwright.async_api import async_playwright
    from shoot import serve, CHROME_ARGS                               # noqa: E402
    results = {}
    by_shot = {}
    for sid, p in todo:
        by_shot.setdefault(sid, []).append(p)
    order = list(by_shot)
    batches = [order[i:i + a.batch] for i in range(0, len(order), a.batch)]
    srv = serve(0)
    port = srv.server_address[1]
    try:
        async with async_playwright() as pw:
            for bi, batch in enumerate(batches):
                for attempt in range(3):
                    remaining = [(sid, p) for sid in batch for p in by_shot[sid] if not frame_path(cache, sid, p).exists() or a.force and (sid, p) not in results]
                    if not remaining:
                        break
                    b = await pw.chromium.launch(args=CHROME_ARGS)
                    try:
                        pg = await b.new_page(viewport={"width": a.w, "height": a.h})
                        pg.on("pageerror", lambda e: print("pageerror:", str(e)[:300], flush=True))
                        t0 = time.time()
                        url = (f"http://127.0.0.1:{port}/web/index.html?style=felt&shot=film&w={a.w}&h={a.h}&motion={a.motion}"
                               f"&timing={timing_url}&shots={shots_url}&t=0")
                        await pg.goto(url)
                        await pg.wait_for_function("window.ready===true", timeout=300000)
                        err = await pg.evaluate("window.__err || null")
                        if err:
                            raise RuntimeError("BUILD FAILED: " + str(err)[:800])
                        print(f"[batch {bi + 1}/{len(batches)}] page ready in {time.time() - t0:.1f}s, {len(remaining)} frame(s)", flush=True)
                        for sid, p in remaining:
                            s = shots_by_id[sid]
                            t = song_time(s, p)
                            t1 = time.time()
                            try:
                                await pg.evaluate("t => window.setT(t)", t)
                                data = await pg.evaluate("window.shoot('png')")
                                png = base64.b64decode(data.split(",")[1])
                                tmp = frame_path(cache, sid, p).with_suffix(".tmp")
                                tmp.write_bytes(png)
                                tmp.replace(frame_path(cache, sid, p))
                                info = await pg.evaluate("window.filmInfo ? window.filmInfo() : {}")
                                results[(sid, p)] = (round((time.time() - t1) * 1000), info.get("drawCalls"))
                                print(f"  {sid} p={p:g} t={t:.2f}s {time.time() - t1:.1f}s calls={info.get('drawCalls')}", flush=True)
                            except Exception as e:                        # noqa: BLE001
                                results[(sid, p)] = f"{type(e).__name__}: {str(e)[:200]}"
                                print(f"  {sid} p={p:g} FAILED: {str(e)[:200]}", flush=True)
                        await b.close()
                        break
                    except Exception as e:                                # noqa: BLE001
                        print(f"[batch {bi + 1}] page failed (attempt {attempt + 1}): {str(e)[:300]}", flush=True)
                        try:
                            await b.close()
                        except Exception:                                 # noqa: BLE001
                            pass
                        if "BUILD FAILED" in str(e):
                            for sid in batch:
                                for p in by_shot[sid]:
                                    results.setdefault((sid, p), str(e)[:200])
                            break
    finally:
        srv.shutdown()
    return results


# ---------------------------------------------------------------------------------------------------------------------- tiling
def wrap(text: str, fnt, width: int, draw: ImageDraw.ImageDraw, max_lines: int):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" ,.;") + " ..."
    return lines


def draw_row(sheet: Image.Image, y: int, shot: dict, imgs: list, ps: list, a, panel_w: int, meta: dict):
    d = ImageDraw.Draw(sheet)
    gap = 10
    rowh = a.h + 2 * gap
    d.rectangle([0, y, sheet.width, y + rowh - 1], fill=BG)
    d.rectangle([gap, y + gap, panel_w - gap, y + gap + a.h], fill=PANEL)
    col = section_colour(shot["section"])
    d.rectangle([gap, y + gap, gap + 8, y + gap + a.h], fill=col)
    x0 = gap + 20
    yy = y + gap + 8
    d.text((x0, yy), shot["id"], font=font("display", 34), fill=INK)
    cw = font("display", 34).getlength(shot["id"])
    cc = shot.get("cost", "B")
    d.rounded_rectangle([x0 + cw + 14, yy + 4, x0 + cw + 14 + 30, yy + 4 + 32], radius=7, fill=COST_COL.get(cc, DIM))
    d.text((x0 + cw + 14 + 15, yy + 20), cc, font=font("bold", 22), fill=(20, 20, 20), anchor="mm")
    yy += 44
    d.text((x0, yy), shot["tpl"], font=font("bold", 24), fill=col)
    yy += 34
    n = shot["t1"] - shot["t0"]
    d.text((x0, yy), f"{shot['t0']:.2f} - {shot['t1']:.2f} s", font=font("mono", 20), fill=INK)
    yy += 26
    d.text((x0, yy), f"{n:.2f} s, {float(shot['beats']):.1f} beats", font=font("mono", 20), fill=INK)
    yy += 26
    snap = {"beat": "on a beat", "word": "on a word", "span": "section edge"}.get(shot.get("snap"), shot.get("snap") or "")
    d.text((x0, yy), f"{shot['section']}   in: {shot.get('in', 'cut')}", font=font("text", 19), fill=DIM)
    if snap:
        yy += 22
        d.text((x0, yy), f"cut {snap}", font=font("text", 17), fill=DIM)
    yy += 28
    room = y + gap + a.h - 8
    if shot.get("text") and yy < room - 40:
        txt = "“" + shot["text"] + "”"
        fnt = font("text" if shot.get("sung", True) else "italic", 19)
        for ln in wrap(txt, fnt, panel_w - x0 - 2 * gap - 8, d, 3):
            d.text((x0, yy), ln, font=fnt, fill=(255, 226, 150) if shot.get("sung", True) else DIM)
            yy += 24
        if not shot.get("sung", True):
            d.text((x0, yy - 2), "(next line, not yet sung)", font=font("text", 15), fill=DIM)
            yy += 20
    if shot.get("note") and yy < room - 20:
        for ln in wrap(shot["note"], font("text", 17), panel_w - x0 - 2 * gap - 8, d, max(1, (room - yy) // 22)):
            d.text((x0, yy), ln, font=font("text", 17), fill=(150, 200, 235))
            yy += 22
    if meta.get("ms"):
        lab, fnt = f"{meta['ms'] / 1000:.1f} s @ {a.w}x{a.h}", font("mono", 13)
        if panel_w - gap - 6 - fnt.getlength(lab) > x0 + cw + 14 + 30 + 10:              # only where it does not touch the id and the cost badge
            d.text((panel_w - gap - 6, y + gap + 10), lab, font=fnt, fill=DIM, anchor="ra")
    for k, (im, p) in enumerate(zip(imgs, ps)):
        x = panel_w + gap + k * (a.w + gap)
        d.rectangle([x - 1, y + gap - 1, x + a.w, y + gap + a.h], outline=(78, 74, 96))
        if im is None:
            d.rectangle([x, y + gap, x + a.w - 1, y + gap + a.h - 1], fill=(60, 60, 70))
            d.text((x + a.w // 2, y + gap + a.h // 2), "missing", font=font("bold", 26), fill=DIM, anchor="mm")
        elif isinstance(im, str):
            d.rectangle([x, y + gap, x + a.w - 1, y + gap + a.h - 1], fill=(90, 30, 30))
            for j, ln in enumerate(wrap(im, font("text", 16), a.w - 20, d, 6)):
                d.text((x + 10, y + gap + 10 + 20 * j), ln, font=font("text", 16), fill=(255, 200, 200))
        else:
            sheet.paste(im.convert("RGB").resize((a.w, a.h)) if im.size != (a.w, a.h) else im.convert("RGB"), (x, y + gap))
        cap = f"p {p:g}   {song_time(shot, p):.2f} s"
        tw = font("mono", 17).getlength(cap)
        d.rectangle([x, y + gap + a.h - 26, x + tw + 14, y + gap + a.h], fill=(0, 0, 0))
        d.text((x + 7, y + gap + a.h - 22), cap, font=font("mono", 17), fill=INK)


def build_sheets(js: dict, shots: list, cache: Path, out: Path, a, results: dict, title: str):
    ps = progress_list(a.frames)
    panel_w = 340
    gap = 10
    rowh = a.h + 2 * gap
    head = 54
    width = panel_w + gap + a.frames * (a.w + gap)
    sheets = []
    for si in range(0, len(shots), ROWS_PER_SHEET):
        chunk = shots[si:si + ROWS_PER_SHEET]
        sheet = Image.new("RGB", (width, head + rowh * len(chunk)), BG)
        d = ImageDraw.Draw(sheet)
        n_sheets = (len(shots) + ROWS_PER_SHEET - 1) // ROWS_PER_SHEET
        d.text((gap + 6, 8), f"Zombie Couture — shots {chunk[0]['id']} to {chunk[-1]['id']}   (sheet {si // ROWS_PER_SHEET + 1} of {n_sheets})", font=font("display", 30), fill=INK)
        d.text((width - gap - 6, 20), title, font=font("mono", 17), fill=DIM, anchor="ra")
        for r, shot in enumerate(chunk):
            imgs, ms = [], []
            for p in ps:
                fp = frame_path(cache, shot["id"], p)
                res = results.get((shot["id"], p))
                if isinstance(res, str):
                    imgs.append(res)
                elif fp.exists():
                    imgs.append(Image.open(fp))
                    if isinstance(res, tuple):
                        ms.append(res[0])
                else:
                    imgs.append(None)
            draw_row(sheet, head + r * rowh, shot, imgs, ps, a, panel_w, {"ms": statistics.median(ms) if ms else None})
        path = out / f"sheet_{si // ROWS_PER_SHEET + 1:02d}.png"
        sheet.save(path)
        sheets.append(str(path))
    return sheets


def rel_url(p: str) -> str:
    q = Path(p).resolve()
    try:
        return "/" + str(q.relative_to(ROOT))
    except ValueError:
        raise SystemExit(f"{p} must be inside the project ({ROOT}) so the page can load it")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shots", default=str(ROOT / "data" / "shots.json"))
    ap.add_argument("--timing", default=None, help="default: the timing named in shots.json")
    ap.add_argument("--only", default=None, help="comma list of shot ids or section ids")
    ap.add_argument("--w", type=int, default=480)
    ap.add_argument("--h", type=int, default=270)
    ap.add_argument("--frames", type=int, default=3)
    ap.add_argument("--out", default=str(ROOT / "out" / "sheets"))
    ap.add_argument("--motion", default="ones", choices=["ones", "twos", "mixed"])
    ap.add_argument("--batch", type=int, default=24, help="shots per browser page")
    ap.add_argument("--force", action="store_true", help="render again even if the frame exists")
    ap.add_argument("--placeholder", action="store_true", help="synthetic pictures instead of renders (tests the layout)")
    ap.add_argument("--tile-only", action="store_true", help="do not render, tile what exists")
    a = ap.parse_args(argv)

    sp = Path(a.shots)
    if not sp.exists():
        print(f"ERROR: {sp} not found (run tools/make_shots.py first)", file=sys.stderr)
        return 2
    js = json.loads(sp.read_text())
    shots = js["shots"]
    if a.only:
        want = {x.strip() for x in a.only.split(",") if x.strip()}
        shots = [s for s in shots if s["id"] in want or s["section"] in want]
        if not shots:
            print(f"ERROR: --only {a.only!r} matches no shot or section", file=sys.stderr)
            return 2
    out = Path(a.out)
    cache = out / "frames" / f"{a.w}x{a.h}"
    cache.mkdir(parents=True, exist_ok=True)
    ps = progress_list(a.frames)
    by_id = {s["id"]: s for s in js["shots"]}
    timing = a.timing or js.get("source", {}).get("timing") or "data/timing.json"
    tpath = Path(timing) if Path(timing).is_absolute() else ROOT / timing
    stamp = f"{tpath.name}:{tpath.stat().st_size}:{int(tpath.stat().st_mtime)}" if tpath.exists() else "no-timing"
    gone = register_keys(js["shots"], stamp + f":{a.motion}", cache)
    if gone:
        print(f"{gone} cached frame(s) of changed shots removed", flush=True)
    todo = [(s["id"], p) for s in shots for p in ps if a.force or not frame_path(cache, s["id"], p).exists()]
    results: dict = {}
    if a.placeholder:
        for sid, p in todo:
            placeholder_frame(by_id[sid], p, a.w, a.h).save(frame_path(cache, sid, p))
    elif todo and not a.tile_only:
        if not tpath.exists():
            print(f"ERROR: timing file {tpath} not found (--timing)", file=sys.stderr)
            return 2
        print(f"{len(todo)} frame(s) to render for {len({s for s, _ in todo})} shot(s) at {a.w}x{a.h}; timing {tpath.name}", flush=True)
        results = asyncio.run(render_frames(todo, by_id, cache, a, rel_url(str(tpath)), rel_url(a.shots)))
    else:
        print(f"nothing to render ({'tile-only' if a.tile_only else 'all frames exist'})", flush=True)
    # render times of earlier runs are kept beside the frames, so re-tiling (--tile-only) still shows them
    tj = cache / "times.json"
    try:
        times = json.loads(tj.read_text())
    except (OSError, ValueError):
        times = {}
    for (sid, p), v in results.items():
        if isinstance(v, tuple):
            times[frame_path(cache, sid, p).name] = v[0]
    try:
        tj.write_text(json.dumps(times))
    except OSError:
        pass
    for sh in shots:
        for p in ps:
            nm = frame_path(cache, sh["id"], p).name
            if (sh["id"], p) not in results and nm in times:
                results[(sh["id"], p)] = (times[nm], None)
    title = f"{Path(a.shots).name} / {js.get('source', {}).get('timing', '?')}"
    sheets = build_sheets(js, shots, cache, out, a, results, title)
    failed = [k for k, v in results.items() if isinstance(v, str)]
    for s in sheets:
        print(s)
    if failed:
        print(f"{len(failed)} frame(s) failed: " + ", ".join(f"{k[0]}@{k[1]:g}" for k in failed[:20]), file=sys.stderr)
    (out / "sheets.json").write_text(json.dumps({"sheets": sheets, "shots": [s["id"] for s in shots], "frames": ps, "size": [a.w, a.h], "failed": [list(k) for k in failed]}, indent=1))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
