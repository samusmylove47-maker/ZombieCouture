#!/usr/bin/env python3
"""A small on-screen tag for the widescreen hook clip: a plum felt pill with a dashed cream stitch and the text in Fredoka.

  python3 tools/hook_tag.py [--out out/hook_tag.png] [--text "Made by Claude Sonnet 5.5"] [--title "Zombie Couture"] [--h 64]

Writes an RGBA PNG cropped to the pill (transparent around it), ready for ffmpeg's overlay filter (tools/encode_hook169.sh).
With --title the pill reads "<title>  ·  <text>", the title in pink.
"""
import argparse, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FONT = os.path.join(ROOT, "assets", "FredokaOne-Regular.ttf")
PINK_LIGHT, CREAM, PLUM = (255, 130, 184), (255, 244, 224), (74, 18, 58)
SS = 4                                                       # supersampling


def dashed_round_rect(d, box, r, dash, gap, width, fill):
    """A dashed outline of a rounded rectangle: the straight sides and the four corner arcs, dashes laid along the path."""
    import math
    x0, y0, x1, y1 = box
    pts = []
    def arc(cx, cy, a0, a1):
        n = max(8, int(abs(a1 - a0) / 6))
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    arc(x1 - r, y0 + r, -90, 0); arc(x1 - r, y1 - r, 0, 90); arc(x0 + r, y1 - r, 90, 180); arc(x0 + r, y0 + r, 180, 270)
    pts.append(pts[0])
    acc, on = 0.0, True
    seg = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, by - ay)
        pos = 0.0
        while pos < L:
            step = min((dash if on else gap) - acc, L - pos)
            p0 = (ax + (bx - ax) * pos / L, ay + (by - ay) * pos / L)
            p1 = (ax + (bx - ax) * (pos + step) / L, ay + (by - ay) * (pos + step) / L)
            if on:
                d.line([p0, p1], fill=fill, width=width)
            acc += step
            pos += step
            if acc >= (dash if on else gap) - 1e-6:
                on, acc = not on, 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "hook_tag.png"))
    ap.add_argument("--text", default="Made by Claude Sonnet 5.5")
    ap.add_argument("--title", default="Zombie Couture")
    ap.add_argument("--h", type=int, default=64, help="pill height in pixels at 1080p")
    a = ap.parse_args()
    H = a.h
    size = H * 0.50
    font = ImageFont.truetype(FONT, int(size * SS))
    parts = []
    if a.title:
        parts.append((a.title, PINK_LIGHT))
        parts.append(("  ·  ", CREAM))
    parts.append((a.text, CREAM))
    widths = [font.getlength(t) for t, _ in parts]
    pad = H * 0.62
    W = int(sum(widths) / SS + 2 * pad) + 1
    im = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = H * SS / 2
    d.rounded_rectangle((0, 0, W * SS - 1, H * SS - 1), radius=r, fill=PLUM + (214,))
    inset = H * SS * 0.11
    dashed_round_rect(d, (inset, inset, W * SS - 1 - inset, H * SS - 1 - inset), r - inset, H * SS * 0.10, H * SS * 0.075, max(2, int(H * SS * 0.022)), CREAM + (200,))
    x = pad * SS
    asc, desc = font.getmetrics()
    y = (H * SS - (asc + desc)) / 2 - H * SS * 0.012
    for (t, col), w in zip(parts, widths):
        d.text((x, y), t, font=font, fill=col + (255,))
        x += w
    im = im.resize((W, H), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    im.save(a.out)
    print(f"wrote {a.out} ({W}x{H})")


if __name__ == "__main__":
    sys.exit(main())
