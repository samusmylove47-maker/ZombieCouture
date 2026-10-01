"""Ground truth of the previous project ("Upping My P(Bloom)") and metric helpers.

What the ground truth really is (see README): <PBLOOM_DIR>/timing.json holds LINE starts only (no words),
each tagged with its provenance:
  checked - corrected by hand / against the vocal stem by the previous project (17 lines; ASR-word-time based)
  vocal   - the previous pipeline's own ASR estimate, NOT independently verified (27 lines; biased late, see README)
  grid    - chorus lines placed on the fitted bar grid minus a constant 0.85 s pickup (28 lines; a model, not a measurement)
plus a constant-tempo bar grid (bar0_s, bar_s) and section boundaries on that grid.
"""
import json, os
import numpy as np

# the previous project's folder (a sibling of this repository by default; set ZC_PBLOOM_DIR to move it)
PBLOOM_DIR = os.environ.get("ZC_PBLOOM_DIR", "../upping-my-p-bloom-")
GT_TIMING = os.path.join(PBLOOM_DIR, "timing.json")
GT_LYRICS = os.path.join(PBLOOM_DIR, "lyrics.json")
SONG = os.path.join(PBLOOM_DIR, "out", "audio", "song.mp3")


def load():
    j = json.load(open(GT_TIMING))
    lines, secs = [], []
    for s in j["sections"]:
        secs.append({"id": s["id"], "name": s["name"], "start_s": s["start_s"], "end_s": s["end_s"], "start_bar": s["start_bar"]})
        for li, l in enumerate(s["lines"]):
            lines.append({"section": s["id"], "li": li, "text": l["text"], "t": l["t"], "src": l["src"]})
    return {"lines": lines, "sections": secs, "bar0": j["song"]["bar0_s"], "bar": j["song"]["bar_s"], "bpm": j["song"]["bpm"],
            "duration": j["song"]["duration"]}


def stats(err, label=""):
    e = np.asarray(err, float)
    if len(e) == 0:
        return {"n": 0}
    a = np.abs(e)
    return {"n": int(len(e)), "median_abs_ms": round(float(np.median(a) * 1000), 1), "p90_abs_ms": round(float(np.percentile(a, 90) * 1000), 1),
            "mean_abs_ms": round(float(a.mean() * 1000), 1), "bias_ms": round(float(np.median(e) * 1000), 1),
            "within100": round(float((a <= 0.100).mean()), 3), "within200": round(float((a <= 0.200).mean()), 3), "max_abs_ms": round(float(a.max() * 1000), 1)}
