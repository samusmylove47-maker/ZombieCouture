"""Beat / downbeat evaluation.
  synthetic truth:   python3 validation/eval_beats.py <data_dir> --truth validation/synth/x.json
  P(Bloom) (no exact truth): python3 validation/eval_beats.py <data_dir> --pbloom
Metrics: beat error (est - nearest truth beat: median, p90, bias, share within 20/40 ms), bpm error, bar-phase agreement, F-measure at +-70 ms.
"""
import json, sys
import numpy as np
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
sys.path.insert(0, _HERE)


def nearest(a, b):
    """for each a: (b_nearest - a)"""
    b = np.asarray(b); a = np.asarray(a)
    j = np.clip(np.searchsorted(b, a), 1, len(b) - 1)
    c0, c1 = b[j - 1], b[j]
    return np.where(np.abs(c0 - a) <= np.abs(c1 - a), c0, c1) - a


def beat_metrics(est, truth, down_est=None, down_truth=None, skip_edges=0.0):
    est = np.asarray(est); truth = np.asarray(truth)
    m = (truth > skip_edges) & (truth < truth[-1] - skip_edges)
    e = nearest(truth[m], est)                                   # est - truth (positive = estimate is late)
    a = np.abs(e)
    out = {"n_truth": int(m.sum()), "median_abs_ms": round(float(np.median(a) * 1000), 1), "p90_abs_ms": round(float(np.percentile(a, 90) * 1000), 1),
           "bias_ms": round(float(np.median(e) * 1000), 1), "within20": round(float((a <= 0.02).mean()), 3),
           "within40": round(float((a <= 0.04).mean()), 3), "max_abs_ms": round(float(a.max() * 1000), 1)}
    # F-measure at +-70 ms
    tol = 0.07
    tp = int((a <= tol).sum())
    ne = nearest(est[(est > skip_edges) & (est < truth[-1])], truth)
    prec = float((np.abs(ne) <= tol).mean()) if len(ne) else 0.0
    rec = tp / max(1, m.sum())
    out["F70"] = round(2 * prec * rec / (prec + rec + 1e-9), 3)
    if down_est is not None and down_truth is not None and len(down_est) and len(down_truth):
        de = nearest(np.asarray(down_truth)[1:-1], np.asarray(down_est))
        out["bar_phase_ok"] = round(float((np.abs(de) <= 0.07).mean()), 3)
        out["bar_median_abs_ms"] = round(float(np.median(np.abs(de)) * 1000), 1)
    return out


if __name__ == "__main__":
    d = sys.argv[1]
    b = json.load(open(f"{d}/audio/beats.json"))
    if "--truth" in sys.argv:
        tr = json.load(open(sys.argv[sys.argv.index("--truth") + 1]))
        tb = np.array(tr["beats"])
        print(json.dumps(beat_metrics(b["beats"], tb, b["bars"], tr["downbeats"]), indent=None))
        bpm_t = 60.0 / np.median(np.diff(tb))
        print("bpm est %.3f truth %.3f" % (b["bpm"], bpm_t), "conf", b["grid"]["confidence"], "downbeat phase", b["downbeat_phase"])
    if "--pbloom" in sys.argv:
        import pbloom_gt as G
        gt = G.load()
        beats = np.array(b["beats"]); bars = np.array(b["bars"]); ph = b["downbeat_phase"]
        gbars = gt["bar0"] + gt["bar"] * np.arange(int((gt["duration"] - gt["bar0"]) / gt["bar"]))
        # (1) bar phase: nearest of my beats to each GT bar -> is it one of my downbeats?
        j = np.abs(gbars[:, None] - beats[None, :]).argmin(1)
        near_beat_d = beats[j] - gbars
        is_down = (j % 4 == ph)
        ok = np.abs(near_beat_d) < 0.5 * b["beat_s"]
        print("GT bars %d: nearest beat within half a beat for %.0f%%, of those %.0f%% are my downbeats (phase %d)" % (len(gbars), 100 * ok.mean(), 100 * is_down[ok].mean(), ph))
        # (2) offset between my nearest bar and the GT (constant-tempo) bar = tempo drift of the song vs the GT model
        jb = np.abs(gbars[:, None] - bars[None, :]).argmin(1)
        d = bars[jb] - gbars
        print("my bar minus GT bar (ms): median %.1f  p10 %.1f  p90 %.1f  min %.1f  max %.1f" % (*np.percentile(d * 1000, [50, 10, 90]), d.min() * 1000, d.max() * 1000))
        print("  by time (20 s bins, ms):", " ".join("%d:%+.0f" % (a, np.median(d[(gbars >= a) & (gbars < a + 20)]) * 1000) for a in range(0, 180, 20) if ((gbars >= a) & (gbars < a + 20)).any()))
        # (3) independent tracker (librosa DP) on the same audio
        import librosa
        from zcaudio.sigproc import load_mono
        y, sr = load_mono(f"{d_}/audio/inst.wav" if False else f"{sys.argv[1]}/audio/norm.wav", 22050)
        oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=256)
        tempo, bt = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=256, start_bpm=130, tightness=100, units="time")
        dd = nearest(beats, bt)
        m = np.abs(dd) < 0.15
        print("librosa beat_track: tempo %.2f, %d beats; mine vs librosa (within a beat): median %.1f ms, p90 %.1f, n %d of %d" % (float(np.squeeze(tempo)), len(bt), np.median(dd[m]) * 1000, np.percentile(np.abs(dd[m]), 90) * 1000, m.sum(), len(beats)))
