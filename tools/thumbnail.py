#!/usr/bin/env python3
"""Thumbnail from a rendered frame: cover crop, gentle vignette, the title as stitched felt lettering, a small ribbon tag.

  python3 tools/thumbnail.py <frame.png|jpg> [--out publish/thumb.png] [--text "ZOMBIE COUTURE"] [--tag "the undead get makeovers"] [--pos auto|bl|br|tl|tr|center] [--width 0.40]
  python3 tools/thumbnail.py --pick [--shots data/shots.json]      # candidate shots (chorus hero poses) and the commands that render them

Writes <out> (1280x720), <out stem>_1080.png (1920x1080) and <out stem>.jpg (1280x720, under 2 MB: YouTube's limit).
Lettering: Fredoka (assets/FredokaOne-Regular.ttf) in hot pink with a felt grain and a padded edge, a dashed cream stitch line inset along the
letter outline, a paper-white outline and a plum drop shadow. It is meant to read at 320x180.
"""
import argparse, hashlib, json, os, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FONT = os.path.join(ROOT, "assets", "FredokaOne-Regular.ttf")
PINK, PINK_LIGHT, PINK_DEEP = (255, 47, 134), (255, 110, 172), (214, 18, 112)
CREAM, PAPER, PLUM = (255, 244, 224), (255, 250, 240), (74, 18, 58)
BUTTER, MINT = (255, 224, 102), (182, 255, 214)
SS = 2                                                       # supersampling of the lettering


def hrand(*k):
    h = hashlib.md5(repr(k).encode()).digest()
    return int.from_bytes(h[:4], "little") / 2 ** 32


def cover(im, W, H):
    s = max(W / im.width, H / im.height)
    r = im.resize((max(W, round(im.width * s)), max(H, round(im.height * s))), Image.LANCZOS)
    x, y = (r.width - W) // 2, (r.height - H) // 2
    return r.crop((x, y, x + W, y + H))


def vignette(im, strength=0.30):
    W, H = im.size
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 1.414
    k = np.clip((r - 0.45) / 0.65, 0, 1)
    k = k * k * (3 - 2 * k)
    a = np.asarray(im.convert("RGB"), np.float32) * (1 - strength * k[..., None])
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


# --------------------------------------------------------------------------------------------- lettering
def letter_mask(lines, size, tilt):
    """L mask (SS x) of the lines, letters placed one by one with a small hand-cut wobble."""
    font = ImageFont.truetype(FONT, int(size * SS))
    pad = int(size * SS * 0.5)
    widths = []
    for ln in lines:
        w = 0.0
        for i, ch in enumerate(ln):
            w += font.getlength(ch) + (font.getlength(ln[i:i + 2]) - font.getlength(ch) - font.getlength(ln[i + 1]) if i + 1 < len(ln) else 0)
        widths.append(w)
    lh = size * SS * 1.0
    Wc, Hc = int(max(widths) + 2 * pad), int(lh * len(lines) + 2 * pad)
    canvas = Image.new("L", (Wc, Hc), 0)
    for li, ln in enumerate(lines):
        x = pad + (max(widths) - widths[li]) / 2
        for i, ch in enumerate(ln):
            g = Image.new("L", (int(size * SS * 1.6), int(size * SS * 1.6)), 0)
            ImageDraw.Draw(g).text((int(size * SS * 0.3), int(size * SS * 0.2)), ch, font=font, fill=255)
            g = g.rotate((hrand(li, i, "r") - 0.5) * 5.0, resample=Image.BICUBIC, center=(g.width // 2, g.height // 2))
            dy = (hrand(li, i, "y") - 0.5) * 0.05 * size * SS
            canvas.paste(255, (int(x - size * SS * 0.3), int(pad + li * lh + dy - size * SS * 0.2)), g)
            adv = font.getlength(ch)
            if i + 1 < len(ln):
                adv += font.getlength(ln[i:i + 2]) - font.getlength(ch) - font.getlength(ln[i + 1])
            x += adv
    if tilt:
        canvas = canvas.rotate(tilt, resample=Image.BICUBIC, expand=True)
    bb = canvas.getbbox()
    pad2 = int(size * SS * 0.22)
    canvas = canvas.crop((max(0, bb[0] - pad2), max(0, bb[1] - pad2), bb[2] + pad2, bb[3] + pad2))
    return canvas


def stitch_dashes(dist, level, cap, rng_key):
    """Polylines of the inset contour (distance field = level), cut into running-stitch dashes. Returns list of (points)."""
    import contourpy
    gen = contourpy.contour_generator(z=dist, line_type=contourpy.LineType.Separate)
    dashes = []
    L, G = 0.30 * cap, 0.19 * cap
    for pl in gen.lines(level):
        pts = np.asarray(pl, np.float32)
        if len(pts) < 8:
            continue
        seg = np.hypot(*np.diff(pts, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)])
        total = cum[-1]
        s = hrand(rng_key, len(pts)) * (L + G)
        while s < total - 0.4 * L:
            ln = L * (0.85 + 0.3 * hrand(rng_key, int(s)))
            e = min(s + ln, total)
            idx = np.where((cum >= s) & (cum <= e))[0]
            if len(idx) >= 1:
                xs = np.interp([s, *cum[idx], e], cum, pts[:, 0])
                ys = np.interp([s, *cum[idx], e], cum, pts[:, 1])
                dashes.append(np.stack([xs, ys], 1))
            s = e + G
    return dashes


def render_title(lines, target_w, tilt=-2.5):
    """RGBA lettering layer for the given target width (pixels at the final resolution)."""
    probe = letter_mask(lines, 100, tilt)
    size = 100 * target_w / (probe.width / SS)
    m = letter_mask(lines, size, tilt)
    cap = size * SS * 0.72
    a = np.asarray(m, np.float32) / 255
    H, W = a.shape
    ow = int(0.085 * cap)
    # outline (paper white) and drop shadow (plum)
    dist_out = ndi.distance_transform_edt(a < 0.5)
    outline = np.clip(ow + 0.5 - dist_out, 0, 1)                       # antialiased dilation by ow
    sh_off = (int(0.07 * cap), int(0.11 * cap))
    shadow = np.roll(np.roll(np.clip(ow + 0.5 - dist_out, 0, 1), sh_off[1], 0), sh_off[0], 1)
    shadow = ndi.gaussian_filter(shadow, 0.06 * cap)
    dist_in = ndi.distance_transform_edt(a > 0.5)
    fill_a = np.clip(dist_in + 0.5, 0, 1) * (a > 0.01)
    # felt fill: vertical gradient, padded edge, top-left light, grain
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    base = np.array(PINK_LIGHT, np.float32) * (1 - yy[..., None]) + np.array(PINK_DEEP, np.float32) * yy[..., None]
    base = base * 0.55 + np.array(PINK, np.float32) * 0.45
    edge = np.clip(1 - dist_in / (0.16 * cap), 0, 1)
    sm = ndi.gaussian_filter(a, 0.07 * cap)
    gy, gx = np.gradient(sm)
    light = -(gx * 0.6 + gy * 0.8)
    light = light / (np.abs(light).max() + 1e-6)
    rng = np.random.default_rng(7)
    grain = ndi.gaussian_filter(rng.normal(0, 1, (H, W)).astype(np.float32), 1.0) * 0.10
    shade = 1 - 0.18 * edge + 0.30 * light + grain
    fill = np.clip(base * shade[..., None], 0, 255)
    # layers: plum shadow, paper-white outline, felt fill
    def layer(rgb, alpha):
        rgb = np.broadcast_to(np.asarray(rgb, np.float32), (H, W, 3))
        return Image.fromarray(np.dstack([rgb, np.clip(alpha, 0, 1)[..., None] * 255]).astype(np.uint8), "RGBA")
    img = layer(PLUM, shadow * 0.55)
    img = Image.alpha_composite(img, layer(PAPER, outline))
    img = Image.alpha_composite(img, layer(fill, fill_a))
    # running stitch inset along the fill edge, drawn as rounded dashes (with a hairline shadow so the thread sits on the felt)
    level = 0.30 * float(dist_in.max())                                 # a border stitch: inside the edge, clear of the stroke middle
    dashes = stitch_dashes(ndi.gaussian_filter(dist_in, 1.2), level, cap, "t")
    lay_s = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay_s)
    w_th = max(2, int(0.052 * cap))
    for pts in dashes:
        p = [tuple(x) for x in pts]
        d.line([(x + w_th * 0.25, y + w_th * 0.35) for x, y in p], fill=PLUM + (110,), width=w_th, joint="curve")
    for pts in dashes:
        p = [tuple(x) for x in pts]
        d.line(p, fill=CREAM + (255,), width=w_th, joint="curve")
        for e in (p[0], p[-1]):
            d.ellipse((e[0] - w_th / 2, e[1] - w_th / 2, e[0] + w_th / 2, e[1] + w_th / 2), fill=CREAM + (255,))
    # keep the thread inside the letters
    keep = Image.fromarray((fill_a * 255).astype(np.uint8))
    la = np.asarray(lay_s.split()[3], np.float32) * (np.asarray(keep, np.float32) / 255)
    lay_s.putalpha(Image.fromarray(la.astype(np.uint8)))
    img = Image.alpha_composite(img, lay_s)
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


def ribbon(text, height, color=BUTTER):
    """A small swallow-tail ribbon with a stitched border and the tag text; returns RGBA."""
    f = ImageFont.truetype(FONT, int(height * SS * 0.50))
    tw = int(f.getlength(text))
    W, H = tw + int(height * SS * 1.5), int(height * SS)
    n = int(H * 0.28)
    pad = int(H * 0.25)
    img = Image.new("RGBA", (W + 2 * pad, H + 2 * pad), (0, 0, 0, 0))
    poly = [(pad, pad), (pad + W, pad), (pad + W - n, pad + H / 2), (pad + W, pad + H), (pad, pad + H), (pad + n, pad + H / 2)]
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + H * 0.06, y + H * 0.09) for x, y in poly], fill=PLUM + (140,))
    sh = sh.filter(ImageFilter.GaussianBlur(H * 0.05))
    img = Image.alpha_composite(img, sh)
    d = ImageDraw.Draw(img)
    d.polygon(poly, fill=color + (255,), outline=PAPER + (255,), width=max(2, int(H * 0.05)))
    m = H * 0.16
    inner = [(pad + m, pad + m), (pad + W - m, pad + m), (pad + W - n - m * 0.4, pad + H / 2), (pad + W - m, pad + H - m), (pad + m, pad + H - m), (pad + n + m * 0.4, pad + H / 2)]
    for i in range(len(inner)):
        a, b = np.array(inner[i]), np.array(inner[(i + 1) % len(inner)])
        ln = np.linalg.norm(b - a)
        k, step = 0.0, H * 0.20
        while k < ln:
            p0, p1 = a + (b - a) * (k / ln), a + (b - a) * (min(k + step * 0.6, ln) / ln)
            d.line([tuple(p0), tuple(p1)], fill=CREAM + (255,) if color != BUTTER else (255, 250, 235, 255), width=max(2, int(H * 0.035)))
            k += step
    d.text((pad + W / 2, pad + H / 2 + H * 0.02), text, font=f, fill=PLUM + (255,), anchor="mm")
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


# --------------------------------------------------------------------------------------------- composition
def calm_score(im, box):
    g = np.asarray(im.convert("L").resize((160, 90)), np.float32)
    x0, y0, x1, y1 = [int(v) for v in (box[0] * 160, box[1] * 90, box[2] * 160, box[3] * 90)]
    reg = g[y0:y1, x0:x1]
    gy, gx = np.gradient(reg)
    return float(np.hypot(gx, gy).mean() + 0.02 * reg.std())


def place(im, pos, tw_frac):
    """Choose where the title goes: returns (name, x0, y0 fractions of the frame for its top-left, width fraction)."""
    boxes = {"bl": (0.03, 0.50, 0.03 + tw_frac, 0.97), "br": (0.97 - tw_frac, 0.50, 0.97, 0.97), "tl": (0.03, 0.03, 0.03 + tw_frac, 0.50), "tr": (0.97 - tw_frac, 0.03, 0.97, 0.50)}
    if pos in boxes:
        return pos
    scores = {k: calm_score(im, b) * (0.85 if k in ("bl", "br") else 1.0) for k, b in boxes.items()}
    return min(scores, key=scores.get)


def compose(src, text, tag, pos, tilt, out_w=1920, out_h=1080, width=None):
    im = cover(Image.open(src).convert("RGB"), out_w, out_h)
    im = ImageEnhance.Color(im).enhance(1.08)
    im = ImageEnhance.Contrast(im).enhance(1.05)
    im = vignette(im, 0.30)
    lines = text.replace("|", "\n").split("\n") if ("|" in text or "\n" in text) else (text.split(" ") if text.count(" ") == 1 else [text])
    tw_frac = width or (0.50 if len(lines) > 1 else 0.62)
    where = place(im, pos, tw_frac)
    title = render_title(lines, int(out_w * tw_frac), tilt)
    mx, my = int(out_w * 0.035), int(out_h * 0.045)
    if where in ("bl", "tl", "center"):
        x = mx
    else:
        x = out_w - title.width - mx
    y = out_h - title.height - my - (int(out_h * 0.075) if tag else 0) if where in ("bl", "br", "center") else my
    if where == "center":
        x, y = (out_w - title.width) // 2, (out_h - title.height) // 2
    im = im.convert("RGBA")
    im.alpha_composite(title, (x, y))
    if tag:
        rb = ribbon(tag, int(out_h * 0.075), BUTTER)
        rx = x + (title.width - rb.width) // 2 if where != "center" else (out_w - rb.width) // 2
        ry = y + title.height - int(rb.height * 0.30) if where in ("bl", "br", "center") else y + title.height - int(rb.height * 0.30)
        rb = rb.rotate(-2.0, resample=Image.BICUBIC, expand=True)
        im.alpha_composite(rb, (max(0, rx), min(out_h - rb.height, max(0, ry))))
    return im.convert("RGB"), where


def save_all(im, out):
    stem = os.path.splitext(out)[0]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.resize((1280, 720), Image.LANCZOS).save(out, optimize=True)
    im.save(f"{stem}_1080.png", optimize=True)
    small = im.resize((1280, 720), Image.LANCZOS)
    q = 95
    while True:
        small.save(f"{stem}.jpg", quality=q, subsampling=0)
        if os.path.getsize(f"{stem}.jpg") < 1_900_000 or q <= 70:
            break
        q -= 4
    sizes = {p: os.path.getsize(p) / 1e6 for p in (out, f"{stem}_1080.png", f"{stem}.jpg")}
    return sizes


# --------------------------------------------------------------------------------------------- --pick
GOOD = [(r"pipHero", 10), (r"pipWink", 9), (r"finaleWide", 9), (r"finaleLow", 8), (r"coutureHits", 8), (r"adorableWide", 7), (r"confettiPeak", 7),
        (r"crowdCheer", 6), (r"pipBelt", 6), (r"lockstepFront", 5), (r"finaleOrbit", 5), (r"titleStitch", 4), (r"partyWide", 4)]


def pick(shots_path):
    cands = []
    src = "shots.json"
    if os.path.exists(shots_path):
        d = json.load(open(shots_path))
        shots = d["shots"] if isinstance(d, dict) else d
        for s in shots:
            sc = next((v for pat, v in GOOD if re.search(pat, s.get("tpl", ""), re.I)), 0)
            if str(s.get("section", "")).startswith("chorus"):
                sc += 2
            if sc >= 4:
                cands.append((sc, s["id"], s.get("section"), s.get("tpl"), s["t0"], s["t1"], s.get("note", "")))
    else:
        src = "storyboard.json (data/shots.json does not exist yet; times unknown)"
        sb = json.load(open(os.path.join(ROOT, "data", "storyboard.json")))
        for sec in sb["sections"]:
            for s in sec["shots"]:
                sc = next((v for pat, v in GOOD if re.search(pat, s.get("tpl", ""), re.I)), 0)
                if sec["id"].startswith("chorus"):
                    sc += 2
                if sc >= 4:
                    cands.append((sc, s["id"], sec["id"], s["tpl"], None, None, s.get("note", "")))
    cands.sort(key=lambda c: (-c[0], c[4] or 0))
    print(f"candidates from {src}: chorus hero poses first (score, shot, section, template, time)")
    for sc, sid, sec, tpl, t0, t1, note in cands[:12]:
        if t0 is None:
            print(f"  {sc:2d}  {sid:8} {sec:10} {tpl:14} (needs data/shots.json)")
            continue
        t = round(round((t0 + 0.6 * (t1 - t0)) * 24) / 24, 3)
        print(f"  {sc:2d}  {sid:8} {sec:10} {tpl:14} {t0:7.2f}-{t1:7.2f} s, use t={t}   {note[:40]}")
        print(f"        tools/render_all.sh thumb --from {t}        or   python3 tools/shoot.py felt film out/thumb_{sid}.png 1920 1080 \"sid={sid}&p=0.6&motion=ones&hand=0&timing=/data/timing.json&shots=/data/shots.json\"")
    print("Pick one where Pip's face and the front row of dolls are clear and the lower-left or lower-right third is calm (the title goes there).")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frame", nargs="?")
    ap.add_argument("--out", default=os.path.join(ROOT, "publish", "thumb.png"))
    ap.add_argument("--text", default="ZOMBIE COUTURE")
    ap.add_argument("--tag", default="the undead get makeovers")
    ap.add_argument("--pos", default="auto", choices=["auto", "bl", "br", "tl", "tr", "center"])
    ap.add_argument("--tilt", type=float, default=-2.5)
    ap.add_argument("--width", type=float, default=None, help="title width as a fraction of the frame (default 0.50 for two lines): smaller keeps faces clear")
    ap.add_argument("--pick", action="store_true")
    ap.add_argument("--shots", default=os.path.join(ROOT, "data", "shots.json"))
    a = ap.parse_args()
    if a.pick:
        return pick(a.shots)
    if not a.frame:
        ap.error("give a rendered frame, or --pick")
    im, where = compose(a.frame, a.text, a.tag, a.pos, a.tilt, width=a.width)
    sizes = save_all(im, a.out)
    print(f"title placed {where}; " + ", ".join(f"{os.path.relpath(p)} {mb:.2f} MB" for p, mb in sizes.items()))
    if sizes[a.out] > 2.0:
        print("note: the PNG is over 2 MB (YouTube's limit); upload the .jpg beside it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
