"""Stage 4 - tempo, beats, downbeats (bars) and a confidence.

Method (designed for four-on-the-floor pop with handclaps on 2 and 4, but nothing here assumes a genre):
  1. onset-strength envelopes (5.8 ms hop) of the instrumental stem (+ a little of the mix): full-band, low band (kick/bass), backbeat band;
  2. nominal tempo by autocorrelation + a fine fold of the envelope, with a log-tempo prior around `beats.bpm_hint`;
  3. beat tracking that FOLLOWS tempo drift (real songs, especially generated ones, wander by several percent): Ellis-style DP through the
     onset score, then a refinement that re-picks the onset peak around every beat and smooths the peak times robustly, so the grid is
     smooth (no jitter) yet sits on the real drum hits; the beat curve is extrapolated to cover [0, duration];
  4. downbeat phase (which of the 4 beats is 'one') from cues summed over the whole song: harmonic change, bass/kick weight,
     loudness rise and the backbeat pattern;
  5. confidences: onset support of the grid, residual jitter, margin of the winning downbeat phase, kick-on-beat share.
Outputs: beats.json  {bpm, beats, bars, beat_strength, grid:{...}, downbeat_cues}
"""
from __future__ import annotations

import numpy as np

from .common import Ctx, dump_json, load_json, timer
from .sigproc import load_mono

SR = 22050


def _stft_bands(y, sr, hop, n_fft=2048):
    import librosa
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    return S, f


def _flux(band_pow: np.ndarray) -> np.ndarray:
    """half-wave rectified difference of the log energy (per frame)"""
    L = np.log1p(1e3 * band_pow / (band_pow.max() + 1e-12))
    d = np.maximum(0, np.diff(L, prepend=L[:1]))
    return d


def envelopes(y, sr, hop):
    import librosa
    S, f = _stft_bands(y, sr, hop)
    mel = librosa.feature.melspectrogram(S=S, sr=sr, n_mels=64, fmin=30, fmax=10000)
    L = librosa.power_to_db(mel, ref=np.max, top_db=60.0)
    d = np.maximum(0, L[:, 1:] - L[:, :-1])
    full = np.concatenate([[0.0], d.mean(0)])
    low_pow = S[(f >= 30) & (f <= 160)].sum(0)
    back_pow = S[(f >= 1200) & (f <= 6000)].sum(0)
    hi_pow = S[(f >= 6000) & (f <= 10000)].sum(0)
    return {"full": full, "low": _flux(low_pow), "back": _flux(back_pow), "hi": _flux(hi_pow),
            "low_pow": low_pow, "back_pow": back_pow, "S": S, "f": f}


def _norm_env(e):
    e = e - np.median(e)
    s = np.percentile(np.abs(e), 95) + 1e-9
    return np.maximum(0, e / s)


def global_tempo(env, hop_s, bpm_min, bpm_max, hint, sigma_oct):
    """Fold the envelope modulo a fine grid of periods; returns (bpm, phase_s, curve)"""
    n = len(env)
    t = np.arange(n) * hop_s
    # coarse: autocorrelation
    x = env - env.mean()
    ac = np.correlate(x, x, mode="full")[n - 1:]
    ac /= (ac[0] + 1e-12)
    bpms = np.arange(bpm_min, bpm_max, 0.25)
    lags = 60.0 / bpms / hop_s
    def acv(l):
        return np.interp(l, np.arange(len(ac)), ac)
    score = acv(lags) + 0.5 * acv(2 * lags) + 0.25 * acv(4 * lags) + 0.25 * acv(lags / 2)
    prior = np.exp(-0.5 * (np.log2(bpms / hint) / sigma_oct) ** 2)
    sc = score * prior
    b0 = float(bpms[int(np.argmax(sc))])
    # fine: fold at candidate periods around b0 (+-3 BPM)
    best = (-1, b0, 0.0)
    for b in np.arange(b0 - 3.0, b0 + 3.0001, 0.02):
        P = 60.0 / b
        nb = 64
        ph = ((t % P) / P * nb).astype(int) % nb
        hist = np.bincount(ph, weights=env, minlength=nb)
        hist = np.convolve(np.concatenate([hist[-2:], hist, hist[:2]]), [0.25, 0.5, 1.0, 0.5, 0.25], mode="same")[2:-2]
        k = int(np.argmax(hist))
        s = hist[k] / (hist.mean() + 1e-12)
        if s > best[0]:
            best = (s, float(b), (k + 0.5) / nb * P)
    return best[1], best[2], {"bpms": bpms, "score": sc, "coarse_bpm": b0, "fold_score": best[0]}


def _robust_line(x, y, w, iters=6):
    """Weighted least-squares line with Huber-style re-weighting; returns (slope, intercept)."""
    ww = np.asarray(w, float).copy()
    if len(x) < 3:
        return 0.0, float(np.average(y, weights=ww)) if len(y) else 0.0
    for _ in range(iters):
        A = np.vstack([x, np.ones_like(x)]).T * np.sqrt(ww)[:, None]
        sol, *_ = np.linalg.lstsq(A, y * np.sqrt(ww), rcond=None)
        r = y - (sol[0] * x + sol[1])
        s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-4
        ww = np.asarray(w, float) * np.minimum(1.0, 2.0 * s / (np.abs(r) + 1e-9))
    return float(sol[0]), float(sol[1])


def dp_track(local: np.ndarray, P: float, tight: float = 120.0, lo: float = 0.55, hi: float = 1.8) -> np.ndarray:
    """Ellis (2007) dynamic-programming beat tracker. `local` is a per-frame onset score, `P` the nominal beat period in frames.
    Every beat pays -tight*log(interval/P)^2, so the tempo may wander slowly (tempo drift of a few percent is followed) but single
    off-beat onsets cannot pull the grid. Returns the frame indices of the beats."""
    N = len(local)
    w0, w1 = max(1, int(round(lo * P))), max(2, int(round(hi * P)))
    lags = np.arange(w0, w1 + 1)
    pen = -tight * np.log(lags / P) ** 2                          # index = lag - w0
    cum = local.astype(float).copy()
    back = -np.ones(N, dtype=np.int64)
    for i in range(w0, N):
        a = max(0, i - w1)
        js = np.arange(a, i - w0 + 1)
        cand = cum[js] + pen[i - js - w0]
        k = int(np.argmax(cand))
        if cand[k] > 0:                                           # continuing a chain beats starting a new one
            cum[i] = local[i] + cand[k]
            back[i] = js[k]
    tail = np.arange(max(0, N - int(P) - 1), N)
    i = int(tail[np.argmax(cum[tail])])
    out = [i]
    while back[i] >= 0:
        i = int(back[i])
        out.append(i)
    return np.array(out[::-1])


def whittaker(x: np.ndarray, w: np.ndarray, lam: float) -> np.ndarray:
    """Weighted second-difference smoother; w = 0 marks unobserved points (they are interpolated / extrapolated linearly)."""
    K = len(x)
    if K < 4:
        return x.copy()
    D = np.diff(np.eye(K), n=2, axis=0)
    A = np.diag(w) + lam * (D.T @ D) + 1e-9 * np.eye(K)
    return np.linalg.solve(A, w * x)


def _peak_obs(beats, sm, hop_s, win_s):
    """For every predicted beat: the (parabolically interpolated) envelope maximum within +-win_s and its strength."""
    K = len(beats)
    obs = beats.copy()
    st = np.zeros(K)
    for k, b in enumerate(beats):
        i0 = max(0, int(round((b - win_s) / hop_s)))
        i1 = min(len(sm), int(round((b + win_s) / hop_s)) + 1)
        if i1 - i0 < 3:
            continue
        seg = sm[i0:i1]
        j = int(np.argmax(seg))
        d = 0.0
        if 0 < j < len(seg) - 1:
            y0, y1, y2 = seg[j - 1], seg[j], seg[j + 1]
            den = y0 - 2 * y1 + y2
            if abs(den) > 1e-12:
                d = float(np.clip(0.5 * (y0 - y2) / den, -0.5, 0.5))
        obs[k] = (i0 + j + d) * hop_s
        st[k] = seg[j]
    return obs, st


def refine_beats(beats, sm, hop_s, lam, win_ms, iters=4):
    """Pull the tracker's beats onto a smooth curve through the actual onsets: re-pick the envelope peak around every beat (window
    shrinking each pass), then smooth the peak times robustly (second-difference penalty = the tempo may change slowly, not jump)."""
    beats = np.asarray(beats, float).copy()
    ref = np.percentile(sm, 90) + 1e-9
    resid = np.zeros(len(beats))
    for it in range(iters):
        win = win_ms[min(it, len(win_ms) - 1)] / 1000.0
        obs, st = _peak_obs(beats, sm, hop_s, win)
        w0 = np.clip(st / ref, 0.0, 1.5) ** 2
        x = beats.copy()
        for _ in range(3):
            w = w0 * np.minimum(1.0, (0.020 / (np.abs(obs - x) + 1e-6)) ** 1.0)         # Huber-style: > 20 ms off the curve counts less
            w = np.where(np.abs(obs - x) > 0.9 * win, 0.0, w)
            x = whittaker(obs - beats, w, lam) + beats if w.sum() > 4 else x
        resid = obs - x
        beats = x
    return beats, resid


def extend_grid(beats, sm_len_s, P_med):
    """Continue the beat curve to cover [0, duration] with the local period at either end."""
    beats = list(beats)
    if len(beats) >= 8:
        p0 = float(np.median(np.diff(beats[:8])))
        p1 = float(np.median(np.diff(beats[-8:])))
    else:
        p0 = p1 = P_med
    pre = []
    t = beats[0] - p0
    while t >= 0:
        pre.append(t)
        t -= p0
    post = []
    t = beats[-1] + p1
    while t <= sm_len_s:
        post.append(t)
        t += p1
    return np.array(pre[::-1] + beats + post), len(pre), len(post)


def beat_features(y_inst, sr, beats, hop=512):
    """Per-beat cues for the downbeat decision."""
    import librosa
    n_fft = 4096
    S = np.abs(librosa.stft(y_inst, n_fft=n_fft, hop_length=hop, center=True)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    frame_t = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=hop, n_fft=n_fft)
    chroma = librosa.feature.chroma_stft(S=S, sr=sr, n_chroma=12, tuning=0.0)
    low = S[(f >= 30) & (f <= 160)].sum(0)
    total = S.sum(0)
    K = len(beats)
    edges = np.concatenate([beats, [beats[-1] + (beats[-1] - beats[-2])]])
    cvec = np.zeros((K, 12))
    lowE = np.zeros(K)
    rms = np.zeros(K)
    for k in range(K):
        m = (frame_t >= edges[k]) & (frame_t < edges[k + 1])
        if m.any():
            cvec[k] = np.median(chroma[:, m], axis=1)
            lowE[k] = low[m].mean()
            rms[k] = total[m].mean()
    cn = cvec / (np.linalg.norm(cvec, axis=1, keepdims=True) + 1e-9)
    change = np.zeros(K)
    change[1:] = 1.0 - np.sum(cn[1:] * cn[:-1], axis=1)
    lrms = 10 * np.log10(rms + 1e-9)
    rise = np.zeros(K)
    rise[1:] = np.maximum(0, lrms[1:] - lrms[:-1])
    return {"change": change, "low": lowE / (np.median(lowE) + 1e-9), "rise": rise}


def downbeat_phase(beats, hop_s, envs, bf, bpb=4):
    """Score the `bpb` possible bar phases; returns (phase, scores, margin, cue_detail)."""
    K = len(beats)
    t = np.arange(len(envs["low"])) * hop_s

    def at(e, tt, w=0.03):
        i0, i1 = int(max(0, (tt - w) / hop_s)), int((tt + w) / hop_s) + 1
        return e[i0:i1].max() if i1 > i0 else 0.0
    low_flux = np.array([at(envs["low"], b) for b in beats])
    back = np.array([at(envs["back"], b) for b in beats])

    def phase_profile(x):
        prof = np.array([x[p::bpb].mean() if len(x[p::bpb]) else 0.0 for p in range(bpb)])
        return prof

    def z(v):
        s = v.std()
        return (v - v.mean()) / (s + 1e-9) if s > 1e-9 else np.zeros_like(v)

    cues = {}
    cues["change"] = z(phase_profile(bf["change"]))
    cues["bass"] = z(phase_profile(bf["low"]))
    cues["rise"] = z(phase_profile(bf["rise"]))
    cues["kick"] = z(phase_profile(low_flux))
    bp = phase_profile(back)
    # claps on the backbeat: the 'one' is a beat *before* a clap beat, i.e. score(p) = clap(p+1) + clap(p+3) - clap(p) - clap(p+2)
    cues["backbeat"] = z(np.array([(bp[(p + 1) % bpb] + bp[(p + 3) % bpb] - bp[p] - bp[(p + 2) % bpb]) if bpb == 4 else 0.0 for p in range(bpb)]))
    weights = {"change": 0.35, "bass": 0.20, "rise": 0.15, "kick": 0.10, "backbeat": 0.20}
    tot = sum(weights[k] * cues[k] for k in weights)
    order = np.argsort(-tot)
    margin = float((tot[order[0]] - tot[order[1]]) / (np.abs(tot).mean() + 1e-9)) if bpb > 1 else 1.0
    return int(order[0]), tot, margin, {k: v.tolist() for k, v in cues.items()}


def run(ctx: Ctx) -> dict:
    cfg = ctx.cfg["beats"]
    hop = 128
    with timer() as tm:
        src = ctx.p("inst.wav") if ctx.p("inst.wav").exists() else ctx.p("norm.wav")
        y, sr = load_mono(src, SR)
        ym, _ = load_mono(ctx.p("norm.wav"), SR)
        n = min(len(y), len(ym))
        # instrumental carries the drums cleanly; add a little of the full mix so a hollow stem does not lose the kick
        yb = y[:n] + 0.25 * ym[:n]
        hop_s = hop / sr
        dur = n / sr
        envs = envelopes(yb, sr, hop)
        env = _norm_env(0.6 * envs["full"] / (envs["full"].std() + 1e-9) + 0.4 * envs["low"] / (envs["low"].std() + 1e-9))
        bpm0, phi0, tinfo = global_tempo(env, hop_s, cfg["bpm_min"], cfg["bpm_max"], cfg["bpm_hint"], cfg["prior_sigma_oct"])
        P0 = 60.0 / bpm0
        # --- track: DP through the onset score (follows slow tempo drift), then refine onto a smooth curve through the real onsets
        g = np.exp(-0.5 * (np.arange(-6, 7) / 2.2) ** 2)
        local = np.convolve(env / (env.std() + 1e-9), g / g.sum(), mode="same")
        fr = dp_track(local, P0 / hop_s, tight=float(cfg["tight"]))
        beats0 = fr * hop_s
        sm = np.convolve(env, np.exp(-0.5 * (np.arange(-4, 5) / 1.6) ** 2) / 4.0, mode="same")
        beats1, resid = refine_beats(beats0, sm, hop_s, float(cfg["smooth_lambda"]), cfg["snap_ms"])
        beats, n_pre, n_post = extend_grid(beats1, dur, P0)
        lead = float(cfg.get("onset_lead_ms", 0.0)) / 1000.0
        beats = beats + lead
        beats = beats[(beats >= 0) & (beats <= dur)]
        # --- per-beat onset support
        peak_ref = np.percentile(sm, 90)
        strength = np.array([sm[int(max(0, (b - 0.03) / hop_s)):int((b + 0.03) / hop_s) + 1].max() / (peak_ref + 1e-9) for b in beats])
        strength = np.clip(strength, 0, 1.5)
        bpb = int(cfg["beats_per_bar"])
        bf = beat_features(y[:n], sr, beats)
        ph, tot, margin, cue_detail = downbeat_phase(beats, hop_s, envs, bf, bpb)
        shift = int(cfg.get("downbeat_shift", 0))
        ph = (ph + shift) % bpb
        bars = beats[ph::bpb]
        bar_int = np.diff(bars)
        bpm_local = 60.0 * bpb / bar_int if len(bar_int) else np.array([bpm0])
        beat_int = np.diff(beats)
        # constant-tempo deviation of the final curve (how much the tempo really wanders)
        idx = np.arange(len(beats))
        sl, ic = _robust_line(idx.astype(float), beats, np.ones(len(beats)))
        dev = beats - (sl * idx + ic)
        # --- confidences
        support_share = float((strength > 0.35).mean())
        ok = strength > 0.5
        r_ms = np.abs(resid) * 1000
        jitter_ms = float(1.4826 * np.median(r_ms)) if len(r_ms) else 0.0
        beat_conf = float(np.clip(support_share / 0.8, 0, 1) * np.clip(1 - jitter_ms / 40.0, 0, 1))
        down_conf = float(np.clip(margin / 1.2, 0, 1))
        tempo_stab = float(np.clip(1.0 - (np.percentile(bpm_local, 95) - np.percentile(bpm_local, 5)) / (0.05 * float(np.median(bpm_local))), 0, 1))
        # share of low-band (kick) flux peaks that sit on the beat rather than half a beat away
        kick_share = _kick_on_beat_share(envs["low"], hop_s, beats)
        out = {
            "bpm": round(60.0 / float(sl), 3), "bpm_nominal": round(bpm0, 3), "beat_s": round(float(sl), 5),
            "beats_per_bar": bpb, "beats": [round(float(b), 4) for b in beats], "bars": [round(float(b), 4) for b in bars],
            "beat_strength": [round(float(s), 2) for s in strength],
            "downbeat_phase": int(ph), "first_downbeat": round(float(bars[0]), 4) if len(bars) else None,
            "grid": {"support_share": round(support_share, 3), "jitter_ms": round(jitter_ms, 1),
                     "tempo_stability": round(tempo_stab, 3), "beat_conf": round(beat_conf, 3), "downbeat_conf": round(down_conf, 3),
                     "confidence": round(0.7 * beat_conf + 0.3 * down_conf, 3), "kick_on_beat_share": round(kick_share, 3),
                     "bpm_local_min": round(float(np.percentile(bpm_local, 5)), 2), "bpm_local_max": round(float(np.percentile(bpm_local, 95)), 2),
                     "deviation_from_constant_ms": [round(float(np.percentile(dev, 2)) * 1000, 1), round(float(np.percentile(dev, 98)) * 1000, 1)],
                     "coarse_bpm": tinfo["coarse_bpm"], "fold_score": round(tinfo["fold_score"], 2),
                     "extrapolated_beats": [int(n_pre), int(n_post)]},
            "downbeat_cues": {"total": [round(float(x), 3) for x in tot], **{k: [round(x, 3) for x in v] for k, v in cue_detail.items()}},
        }
        if out["grid"]["confidence"] < 0.4:
            ctx.note_warning(f"low beat-grid confidence ({out['grid']['confidence']}); confirm tempo/downbeat by ear or set overrides.beats")
        if kick_share < 0.5:
            ctx.note_warning(f"only {kick_share:.0%} of the kick-band onsets sit on the beat grid - the grid may be half a beat off (off-beat kicks?)")
        dump_json(ctx.p("beats.json"), out, indent=None, nd=4)
    g = out["grid"]
    ctx.log("beats", f"{out['bpm']:.2f} BPM (local {g['bpm_local_min']}..{g['bpm_local_max']})  first downbeat {out['first_downbeat']}s (phase {ph})  "
                     f"conf {g['confidence']} [beat {g['beat_conf']} downbeat {g['downbeat_conf']}]  jitter {g['jitter_ms']} ms  "
                     f"deviation from constant tempo {g['deviation_from_constant_ms']} ms ({tm['dt']:.1f}s)")
    ctx.note_stage("beats", tm["dt"], bpm=out["bpm"], confidence=g["confidence"])
    return out


def _kick_on_beat_share(low_flux, hop_s, beats, tol=0.06):
    """Of the strong low-band onsets, the share within +-tol of a beat (rather than off the grid)."""
    from scipy.signal import find_peaks
    thr = 0.5 * np.percentile(low_flux, 90)
    pk, _ = find_peaks(low_flux, height=thr, distance=int(0.2 / hop_s))
    if len(pk) < 8 or len(beats) < 4:
        return 1.0
    t = pk * hop_s
    j = np.clip(np.searchsorted(beats, t), 1, len(beats) - 1)
    d = np.minimum(np.abs(t - beats[j - 1]), np.abs(t - beats[j]))
    return float((d <= tol).mean())
