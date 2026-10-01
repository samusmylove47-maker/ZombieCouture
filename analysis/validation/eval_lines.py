"""Quick line-start evaluation from align.json (dev tool):  python3 validation/eval_lines.py [data_dir] [--worst N]"""
import json, sys
import numpy as np
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, _HERE)
import pbloom_gt as G
from zcaudio.lyrics import load_lyrics

d = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "validation/pbloom/data"
worst = int(sys.argv[sys.argv.index("--worst") + 1]) if "--worst" in sys.argv else 20
gt = G.load()
lyr = load_lyrics("validation/pbloom/lyrics.txt")
W = json.load(open(f"{d}/audio/align.json"))["words"]
err = {"checked": [], "vocal": [], "grid": []}
rows = []
for k, l in enumerate(lyr.lines):
    g = gt["lines"][k]
    t = W[l.words[0]]["t"]
    e = t - g["t"]
    err[g["src"]].append(e)
    rows.append((k, g["section"], g["li"], g["src"], g["t"], t, e, W[l.words[0]]["src"], lyr.words[l.words[0]].text))
for k, v in err.items():
    print("%-8s" % k, G.stats(v))
print("%-8s" % "all", G.stats([r[6] for r in rows]))
for r in sorted(rows, key=lambda r: -abs(r[6]))[:worst]:
    print("%3d %-8s %d %-8s gt %7.2f mine %7.2f err %+6.3f  %s %s" % r)
