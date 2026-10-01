"""Stage 5 - per-frame features for the renderer and drum events (kick / clap / hat).

Per-frame arrays (default 24 fps, `--fps N`; frame i is centred on t = i / fps, value = the peak of the smoothed signal within the
frame's window, so a hit that falls between two frames is never missed):
  sub bass lowmid mid high   band energies of the mix, dB -> 0..1 by song percentiles, attack/release smoothed
  rms                        overall level of the mix, 0..1 the same way
  onset                      broadband spectral-flux onset strength, 0..1 (p99 = 1), no release smoothing
  vocal                      level of the separated vocal stem, 0..1 (0 = silent / below the voice-activity threshold)
Drum events (seconds, with strength 0..1): kick (40-140 Hz), clap (1-5 kHz burst), hat (6.5-14 kHz).  They are found from band-limited
spectral flux of the instrumental stem (+ a little of the mix), not from the beat grid, so off-beat drums are kept; the constant
detector lead of each class is calibrated on the synthetic drum track (validation/synth.py) and applied by `features.drum_lead_ms`.
Outputs: features.json {fps, n, frames:{...}, drums:{kick:{t,s}, clap:{t,s}, hat:{t,s}}, stats}
"""
from __future__ import annotations

import numpy as np

from .common import Ctx, dump_json, load_json, timer
from .sigproc import load_mono, smooth_ar

DRUM_BANDS = {"kick": (40.0, 140.0), "clap": (1000.0, 5000.0), "hat": (6500.0, 14000.0)}


def _stft_pow(y, sr, n_fft, hop):
    import librosa
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    return S.astype(np.float32), f


def band_power(S, f, lo, hi):
    m = (f >= lo) & (f < hi)
    if not m.any():
        m = np.zeros_like(f, bool)
        m[int(np.argmin(np.abs(f - 0.5 * (lo + hi))))] = True
    return S[m].sum(0)


def norm01(db: np.ndarray, lo_pct=8.0, hi_pct=99.5, min_span_db=15.0) -> np.ndarray:
    """dB -> 0..1 with song-relative anchors; a band that hardly varies is not blown up (span >= min_span_db)."""
    lo, hi = np.percentile(db, [lo_pct, hi_pct])
    if hi - lo < min_span_db:
        lo = hi - min_span_db
    return np.clip((db - lo) / (hi - lo), 0.0, 1.0)


def resample_peak(x: np.ndarray, rate_in: float, fps: float, n_frames: int) -> np.ndarray:
    """Frame i covers [i/fps - 0.5/fps, i/fps + 0.5/fps]; value = max of x over that window."""
    out = np.zeros(n_frames)
    half = 0.5 / fps
    for i in range(n_frames):
        t = i / fps
        j0 = max(0, int(np.floor((t - half) * rate_in)))
        j1 = min(len(x), int(np.ceil((t + half) * rate_in)) + 1)
        out[i] = x[j0:j1].max() if j1 > j0 else (x[-1] if len(x) else 0.0)
    return out


def flux_db(P: np.ndarray, span: int = 2) -> np.ndarray:
    """Rise of the log band power over the last `span` frames (half-wave), lightly smoothed."""
    L = 10.0 * np.log10(P + 1e-9 * (P.max() + 1e-12))
    prev = np.minimum.reduce([np.concatenate([np.full(k, L[0]), L[:-k]]) for k in range(1, span + 1)])
    d = np.maximum(0.0, L - prev)
    return np.convolve(d, [0.25, 0.5, 0.25], mode="same")


def detect_drum(P, hop_s, min_dist_s, height_rel, prom_rel):
    """Peaks of the band flux -> (times, strengths, raw heights)."""
    from scipy.signal import find_peaks
    d = flux_db(P)
    ref = np.percentile(d, 98) + 1e-9
    pk, pr = find_peaks(d, height=height_rel * ref, prominence=prom_rel * ref, distance=max(1, int(round(min_dist_s / hop_s))))
    if len(pk) == 0:
        return np.array([]), np.array([]), d
    # parabolic refinement
    tt = []
    for k in pk:
        dl = 0.0
        if 0 < k < len(d) - 1:
            y0, y1, y2 = d[k - 1], d[k], d[k + 1]
            den = y0 - 2 * y1 + y2
            if abs(den) > 1e-12:
                dl = float(np.clip(0.5 * (y0 - y2) / den, -0.5, 0.5))
        tt.append((k + dl) * hop_s)
    h = d[pk]
    s = np.clip(h / (np.percentile(h, 90) + 1e-9), 0.0, 1.0)
    return np.array(tt), s, d


def _cut_by_strength(h: np.ndarray, floor_rel=0.22):
    """Drop the weak tail of the peak heights: Otsu split of log-heights when clearly bimodal, else a floor relative to the p90."""
    if len(h) < 12:
        return np.ones(len(h), bool)
    lh = np.log(h + 1e-9)
    lo, hi = np.percentile(lh, [2, 98])
    if hi - lo < 1e-6:
        return np.ones(len(h), bool)
    hist, e = np.histogram(lh, bins=48, range=(lo, hi))
    p = hist / hist.sum()
    w0 = np.cumsum(p)
    mu = np.cumsum(p * (e[:-1] + e[1:]) / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        sb = (mu[-1] * w0 - mu) ** 2 / (w0 * (1 - w0))
    sb[~np.isfinite(sb)] = 0
    k = int(np.argmax(sb))
    thr_otsu = np.exp(e[k + 1])
    var_ratio = sb[k] / (lh.var() + 1e-12)
    floor = floor_rel * np.percentile(h, 90)
    thr = max(floor, thr_otsu) if var_ratio > 0.6 else floor
    return h >= thr


def _peak_near(P, hop_s, t, w=0.012):
    i0, i1 = max(0, int((t - w) / hop_s)), int((t + w) / hop_s) + 1
    return float(P[i0:i1].max()) if i1 > i0 else float(P[min(len(P) - 1, i0)])


def _two_cluster_cut(x: np.ndarray, min_sep_db=6.0, min_var_ratio=0.55):
    """Otsu split of a 1-D dB distribution; returns the threshold if the distribution is clearly bimodal, else None."""
    if len(x) < 16:
        return None
    lo, hi = np.percentile(x, [1, 99])
    if hi - lo < min_sep_db:
        return None
    hist, e = np.histogram(np.clip(x, lo, hi), bins=40, range=(lo, hi))
    p = hist / hist.sum()
    w0 = np.cumsum(p)
    mu = np.cumsum(p * (e[:-1] + e[1:]) / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        sb = (mu[-1] * w0 - mu) ** 2 / (w0 * (1 - w0))
    sb[~np.isfinite(sb)] = 0
    k = int(np.argmax(sb))
    thr = float(e[k + 1])
    a, b = x[x <= thr], x[x > thr]
    if len(a) < 4 or len(b) < 4 or (b.mean() - a.mean()) < min_sep_db or sb[k] / (x.var() + 1e-12) < min_var_ratio:
        return None
    return thr


def drum_events(y, sr, cfg):
    """Kick / clap / hat times. Clap and hat candidates are kept when their spectral balance against the low band says 'noise burst',
    not 'kick click that leaks into the upper bands': the balance distribution is split in two clusters (Otsu) when it is bimodal."""
    n_fft, hop = 1024, 128
    S, f = _stft_pow(y, sr, n_fft, hop)
    hop_s = hop / sr
    out = {}
    lead = cfg.get("drum_lead_ms", {})
    spec = {"kick": (0.11, 0.25, 0.15), "clap": (0.11, 0.25, 0.15), "hat": (0.045, 0.25, 0.15)}
    PL = band_power(S, f, *DRUM_BANDS["kick"])
    info = {}
    for name, (lo, hi) in DRUM_BANDS.items():
        P = band_power(S, f, lo, hi)
        md, hr, pr = spec[name]
        t, s, _ = detect_drum(P, hop_s, md, hr, pr)
        if len(t) and name in ("clap", "hat"):
            ratio = np.array([10 * np.log10(_peak_near(P, hop_s, x) / (_peak_near(PL, hop_s, x) + 1e-12) + 1e-12) for x in t])
            thr = _two_cluster_cut(ratio)
            info[name] = thr
            keep = np.ones(len(t), bool) if thr is None else ratio > thr
            # a clap is a mid-band burst, a hat sits above 6.5 kHz: drop candidates that are really the other one
            PM_ = band_power(S, f, *DRUM_BANDS["clap"])
            PH_ = band_power(S, f, *DRUM_BANDS["hat"])
            mh = np.array([10 * np.log10(_peak_near(PM_, hop_s, x) / (_peak_near(PH_, hop_s, x) + 1e-12) + 1e-12) for x in t])
            keep &= (mh > 0.0) if name == "clap" else (mh < 3.0)
            t, s = t[keep], s[keep]
        if len(t) and name == "kick":
            keep = _cut_by_strength(s + 1e-6, 0.25)
            t, s = t[keep], s[keep]
        t = t + float(lead.get(name, 0.0)) / 1000.0
        out[name] = {"t": t, "s": s}
    return out


def run(ctx: Ctx) -> dict:
    cfg = ctx.cfg["features"]
    fps = float(ctx.cfg["fps"])
    meta = load_json(ctx.p("meta.json"))
    dur = float(meta["duration"])
    with timer() as tm:
        mix, sr = load_mono(ctx.p("norm.wav"), 44100)
        hop = int(round(cfg["hop_ms"] / 1000.0 * sr))
        rate = sr / hop
        S, f = _stft_pow(mix, sr, int(cfg["n_fft"]), hop)
        n_frames = int(np.ceil(dur * fps))
        frames = {}
        names = cfg["band_names"]
        gamma = float(cfg.get("gamma", 1.0))           # >1 spreads the typical loud range downwards (dense pop mixes sit near the top)
        for nm, (lo, hi) in zip(names, cfg["bands_hz"]):
            P = band_power(S, f, lo, hi)
            db = 10.0 * np.log10(P + 1e-12)
            x = norm01(db) ** gamma
            x = smooth_ar(x, rate, cfg["attack_ms"], cfg["release_ms"])
            frames[nm] = np.round(resample_peak(x, rate, fps, n_frames), 3)
        tot = S.sum(0)
        rms_db = 10.0 * np.log10(tot / S.shape[0] + 1e-12)
        frames["rms"] = np.round(resample_peak(smooth_ar(norm01(rms_db) ** gamma, rate, cfg["attack_ms"], cfg["release_ms"]), rate, fps, n_frames), 3)
        # broadband onset strength (log-mel flux), 0..1
        import librosa
        mel = librosa.feature.melspectrogram(S=S, sr=sr, n_mels=48, fmin=40, fmax=12000)
        L = librosa.power_to_db(mel, ref=np.max(mel) + 1e-12, top_db=70.0)
        fl = np.concatenate([[0.0], np.maximum(0, L[:, 1:] - L[:, :-1]).mean(0)])
        fl = fl / (np.percentile(fl, 99) + 1e-9)
        frames["onset"] = np.round(np.clip(resample_peak(fl, rate, fps, n_frames), 0, 1), 3)
        # vocal level
        if ctx.p("vocals.wav").exists():
            v, _ = load_mono(ctx.p("vocals.wav"), 44100)
            Sv, fv = _stft_pow(v, sr, int(cfg["n_fft"]), hop)
            vdb = 10.0 * np.log10(Sv[(fv >= 100) & (fv < 8000)].sum(0) / Sv.shape[0] + 1e-12)
            from .sigproc import otsu_threshold
            thr = otsu_threshold(vdb)
            hi = np.percentile(vdb, 99.5)
            x = np.clip((vdb - thr) / max(6.0, hi - thr), 0.0, 1.0)
            x = np.where(vdb > thr - 3.0, x, 0.0)
            x = smooth_ar(x, rate, cfg["attack_ms"], cfg["release_ms"])
            frames["vocal"] = np.round(resample_peak(x, rate, fps, n_frames), 3)
        else:
            ctx.note_warning("no vocals.wav - the 'vocal' feature is all zeros")
            frames["vocal"] = np.zeros(n_frames)
        # drums from the instrumental (+ some mix so a hollow stem does not lose them)
        if ctx.p("inst.wav").exists():
            inst, _ = load_mono(ctx.p("inst.wav"), 44100)
            n = min(len(inst), len(mix))
            yd = inst[:n] + 0.25 * mix[:n]
        else:
            yd = mix
        drums = drum_events(yd, sr, cfg)
        out = {"fps": fps, "n": n_frames, "duration": dur, "frames": {k: v for k, v in frames.items()},
               "drums": {k: {"t": np.round(v["t"], 3), "s": np.round(v["s"], 2)} for k, v in drums.items()},
               "stats": {k: int(len(v["t"])) for k, v in drums.items()}}
        dump_json(ctx.p("features.json"), out, indent=None, nd=3)
    ctx.log("features", f"{n_frames} frames @ {fps:g} fps; drums " + ", ".join(f"{k} {len(v['t'])}" for k, v in drums.items()) + f" ({tm['dt']:.1f}s)")
    ctx.note_stage("features", tm["dt"], fps=fps, **{f"n_{k}": int(len(v['t'])) for k, v in drums.items()})
    return out
