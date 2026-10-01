"""Drum-event evaluation against the synthetic truth:  python3 validation/eval_drums.py <data_dir> <truth.json> [tol_ms]"""
import json, sys
import numpy as np


def match(est, truth, tol):
    est = np.asarray(est); truth = np.asarray(truth)
    if len(est) == 0 or len(truth) == 0:
        return {"P": 0.0, "R": 0.0, "F1": 0.0, "n_est": int(len(est)), "n_truth": int(len(truth)), "median_err_ms": None}
    used = set(); errs = []
    for tt in truth:
        j = int(np.argmin(np.abs(est - tt)))
        if abs(est[j] - tt) <= tol and j not in used:
            used.add(j); errs.append(est[j] - tt)
    tp = len(errs)
    P = tp / len(est); R = tp / len(truth)
    return {"P": round(P, 3), "R": round(R, 3), "F1": round(2 * P * R / (P + R + 1e-9), 3), "n_est": int(len(est)), "n_truth": int(len(truth)),
            "median_err_ms": round(float(np.median(errs)) * 1000, 1) if errs else None,
            "p90_abs_ms": round(float(np.percentile(np.abs(errs), 90)) * 1000, 1) if errs else None}


if __name__ == "__main__":
    d, tj = sys.argv[1], sys.argv[2]
    tol = float(sys.argv[3]) / 1000 if len(sys.argv) > 3 else 0.03
    f = json.load(open(f"{d}/audio/features.json"))
    tr = json.load(open(tj))
    for k in ("kick", "clap", "hat"):
        print(k, match(f["drums"][k]["t"], tr[k], tol))
