"""Small signal-processing helpers shared by the alignment, beat and feature stages."""
from __future__ import annotations

import numpy as np
import soundfile as sf


def load_mono(path, sr=None, dtype="float32"):
    """Load a wav as mono float32, optionally resampled (soxr)."""
    import librosa
    y, fs = sf.read(path, dtype=dtype, always_2d=True)
    y = y.mean(1)
    if sr and fs != sr:
        y = librosa.resample(y, orig_sr=fs, target_sr=sr, res_type="soxr_hq")
        fs = sr
    return np.ascontiguousarray(y), fs


def frame_rms_db(y, sr, hop, win=None):
    import librosa
    win = win or 4 * hop
    r = librosa.feature.rms(y=y, frame_length=win, hop_length=hop, center=True)[0]
    return 20 * np.log10(r + 1e-7)


def otsu_threshold(x: np.ndarray, bins=128) -> float:
    lo, hi = np.percentile(x, [1, 99.5])
    x = np.clip(x, lo, hi)
    h, e = np.histogram(x, bins=bins, range=(lo, hi))
    h = h.astype(float)
    p = h / h.sum()
    w0 = np.cumsum(p)
    mu = np.cumsum(p * (e[:-1] + e[1:]) / 2)
    mt = mu[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        s = (mt * w0 - mu) ** 2 / (w0 * (1 - w0))
    s[~np.isfinite(s)] = 0
    return float((e[:-1] + e[1:])[np.argmax(s)] / 2)


def voiced_mask(db: np.ndarray, hop_s: float, thr=None, hyst_db=3.0, min_on=0.06, max_gap=0.10):
    """Voice-activity mask from a dB envelope: Otsu threshold with hysteresis, short gaps filled, blips removed."""
    thr = otsu_threshold(db) if thr is None else thr
    on = db > thr + hyst_db
    off = db < thr - hyst_db
    m = np.zeros(len(db), bool)
    state = False
    for i in range(len(db)):
        if not state and on[i]:
            state = True
        elif state and off[i]:
            state = False
        m[i] = state
    # fill short gaps, drop short blips
    m = fill_gaps(m, int(round(max_gap / hop_s)))
    m = drop_blips(m, int(round(min_on / hop_s)))
    return m, thr


def _runs(m: np.ndarray):
    """(start, end, value) run-length encoding of a boolean array."""
    if len(m) == 0:
        return []
    d = np.flatnonzero(np.diff(m.astype(np.int8))) + 1
    starts = np.concatenate([[0], d])
    ends = np.concatenate([d, [len(m)]])
    return [(int(a), int(b), bool(m[a])) for a, b in zip(starts, ends)]


def fill_gaps(m: np.ndarray, maxlen: int) -> np.ndarray:
    """Turn False runs of at most `maxlen` samples that sit between True runs into True."""
    m = m.copy()
    for a, b, v in _runs(m):
        if not v and a > 0 and b < len(m) and (b - a) <= maxlen:
            m[a:b] = True
    return m


def drop_blips(m: np.ndarray, minlen: int) -> np.ndarray:
    """Turn True runs shorter than `minlen` samples into False."""
    m = m.copy()
    for a, b, v in _runs(m):
        if v and (b - a) < minlen:
            m[a:b] = False
    return m


def mask_to_segments(m: np.ndarray, hop_s: float, t0=0.0):
    segs = []
    i, n = 0, len(m)
    while i < n:
        if m[i]:
            j = i
            while j < n and m[j]:
                j += 1
            segs.append((t0 + i * hop_s, t0 + j * hop_s))
            i = j
        else:
            i += 1
    return segs


def onset_curve(y, sr, hop, n_fft=1024, fmin=150, fmax=7000, n_mels=40, aggregate="median"):
    """Log-mel spectral-flux onset strength (broadband rises win with the median aggregate: consonant bursts and vowel
    onsets raise many bands together, pitch glides and vibrato raise only a few)."""
    import librosa
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=n_fft, hop_length=hop, n_mels=n_mels, fmin=fmin, fmax=fmax, power=2.0)
    L = librosa.power_to_db(S, ref=np.max(S) + 1e-12, top_db=70.0)
    d = np.maximum(0, L[:, 1:] - L[:, :-1])
    d = np.concatenate([np.zeros((d.shape[0], 1)), d], axis=1)
    env = np.median(d, axis=0) if aggregate == "median" else d.mean(0)
    return env


def pick_peaks(env: np.ndarray, hop_s: float, min_dist_s=0.04, rel_height=0.12, rel_prom=0.10, t0=0.0, norm_pct=97.0):
    """Peaks of an onset curve -> (times, strength 0..1)."""
    from scipy.signal import find_peaks
    scale = np.percentile(env, norm_pct) + 1e-9
    e = env / scale
    pk, props = find_peaks(e, height=rel_height, prominence=rel_prom, distance=max(1, int(round(min_dist_s / hop_s))))
    t = t0 + pk * hop_s
    s = np.clip(props["prominences"] / 0.6, 0, 1)
    return t, s


def smooth_ar(x: np.ndarray, rate_hz: float, attack_ms: float, release_ms: float) -> np.ndarray:
    """Asymmetric one-pole smoothing (fast attack, slow release) - an envelope follower."""
    a_att = np.exp(-1.0 / max(1e-6, rate_hz * attack_ms / 1000.0))
    a_rel = np.exp(-1.0 / max(1e-6, rate_hz * release_ms / 1000.0))
    y = np.empty_like(x, dtype=float)
    acc = float(x[0])
    for i, v in enumerate(x):
        a = a_att if v > acc else a_rel
        acc = a * acc + (1 - a) * v
        y[i] = acc
    return y
