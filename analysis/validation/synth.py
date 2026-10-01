"""Synthetic bubblegum-pop backing track with exact ground truth (for the beat / drum tests).

Four-on-the-floor kick, claps on 2 and 4, off-beat 8th hats (16ths in the 'chorus'), a tambourine shimmer, a root-note bass and a
4-bar chord loop (i-VI-III-VII) so the bar 'one' is defined by the harmony, an optional slow tempo drift and a 'vocal-like'
formant tone on top.  Usage:  python3 validation/synth.py out.wav truth.json [--bpm 128] [--drift 0.0] [--dur 48] [--pickup 0.35]
"""
import json
import sys

import numpy as np
import soundfile as sf

SR = 44100


def _env(n, decay_s):
    t = np.arange(n) / SR
    return np.exp(-t / decay_s)


def kick(n=SR // 4):
    t = np.arange(n) / SR
    f = 45 + 90 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * _env(n, 0.12) * 1.0 + 0.3 * np.random.default_rng(0).standard_normal(n) * _env(n, 0.004)


def clap(n=SR // 5, rng=None):
    rng = rng or np.random.default_rng(1)
    x = np.zeros(n)
    for off in (0, 0.009, 0.018):
        o = int(off * SR)
        nn = n - o
        x[o:] += rng.standard_normal(nn) * _env(nn, 0.05 if off == 0.018 else 0.012)
    from scipy.signal import butter, sosfilt
    sos = butter(4, [900, 4200], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x) * 0.6


def hat(n=SR // 10, rng=None):
    rng = rng or np.random.default_rng(2)
    from scipy.signal import butter, sosfilt
    sos = butter(4, 7000, btype="high", fs=SR, output="sos")
    return sosfilt(sos, rng.standard_normal(n)) * _env(n, 0.018) * 0.25


def tambo(n=SR // 8, rng=None):
    rng = rng or np.random.default_rng(3)
    from scipy.signal import butter, sosfilt
    sos = butter(4, [5000, 12000], btype="band", fs=SR, output="sos")
    x = rng.standard_normal(n) * _env(n, 0.03)
    x *= 1 + 0.6 * np.sin(2 * np.pi * 45 * np.arange(n) / SR)
    return sosfilt(sos, x) * 0.18


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def make(bpm=128.0, drift=0.0, dur=48.0, pickup=0.35, seed=0, with_vocal=True, tempo_map=None):
    """tempo_map: optional [(t_start, bpm), ...] - the tempo steps to bpm at t_start (a section change); overrides bpm/drift."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    truth = {"beats": [], "downbeats": [], "kick": [], "clap": [], "hat": [], "tambo": [], "bpm0": bpm, "drift_bpm": drift, "duration": dur}
    # beat times with tempo(t) = bpm + drift * t/dur
    def tempo_at(tt):
        if tempo_map:
            cur = tempo_map[0][1]
            for ts, bp in tempo_map:
                if tt >= ts:
                    cur = bp
            return cur
        return bpm + drift * (tt / dur)

    t = pickup
    k = 0
    beats = []
    while t < dur - 0.5:
        beats.append(t)
        cur = tempo_at(t)
        t += 60.0 / cur
        k += 1
    beats = np.array(beats)
    truth["beats"] = beats.tolist()
    truth["downbeats"] = beats[::4].tolist()
    K, C, H, T = kick(), clap(rng=rng), hat(rng=rng), tambo(rng=rng)
    prog = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [48, 52, 55]), (55, [55, 59, 62])]     # Am F C G

    def add(sig, x, t0, g=1.0, pan=0.0):
        i = int(round(t0 * SR))
        if i < 0 or i >= n:
            return
        m = min(len(x), n - i)
        L[i:i + m] += g * x[:m] * (1 - pan) / 1.0
        R[i:i + m] += g * x[:m] * (1 + pan) / 1.0

    for bi, b in enumerate(beats):
        pos = bi % 4
        bar = bi // 4
        root, chord = prog[bar % 4]
        beat_len = 60.0 / tempo_at(b)
        add(L, K, b, 1.0)
        truth["kick"].append(float(b))
        if pos in (1, 3):
            add(L, C, b, 0.9, 0.05)
            truth["clap"].append(float(b))
        chorus = (bar // 4) % 2 == 1
        # off-beat hats
        add(L, H, b + beat_len / 2, 1.0, -0.1)
        truth["hat"].append(float(b + beat_len / 2))
        if chorus:
            for q in (0.25, 0.75):
                add(L, H, b + beat_len * q, 0.7, 0.1)
                truth["hat"].append(float(b + beat_len * q))
            add(L, T, b + beat_len * 0.25, 1.0, 0.3)
        # bass: root on the one, octave pump on the off-beat
        tt = np.arange(int(beat_len * 0.9 * SR)) / SR
        f0 = midi(root - 12)
        saw = 2 * ((tt * f0) % 1) - 1
        bass = (saw * 0.5 + np.sin(2 * np.pi * f0 * tt)) * np.exp(-tt / 0.35) * (1.0 if pos == 0 else 0.55)
        add(L, bass, b, 0.5)
        # chord stab on the beat, sustained pad per bar (one)
        if pos == 0:
            ttp = np.arange(int(4 * beat_len * SR)) / SR
            pad = sum(np.sin(2 * np.pi * midi(nn) * ttp) for nn in chord) / len(chord)
            pad *= np.minimum(1, ttp / 0.02) * np.exp(-ttp / 1.4)
            add(L, pad, b, 0.28, 0.0)
    if with_vocal:
        # a formant-ish 'sung' tone that changes every beat
        for bi, b in enumerate(beats[::2]):
            f = midi(69 + [0, 4, 7, 4][bi % 4])
            tt = np.arange(int(0.8 * SR)) / SR
            v = (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * 2 * f * tt) + 0.3 * np.sin(2 * np.pi * 3 * f * tt)) * np.minimum(1, tt / 0.02) * np.exp(-tt / 0.5)
            add(L, v, b, 0.12, 0.0)
    R = R + L * 0.0
    x = np.stack([L, L], 1)
    x = x / (np.abs(x).max() + 1e-9) * 0.85
    return x.astype(np.float32), truth


if __name__ == "__main__":
    out, tj = sys.argv[1], sys.argv[2]
    bpm = float(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else 128.0
    drift = float(sys.argv[sys.argv.index("--drift") + 1]) if "--drift" in sys.argv else 0.0
    dur = float(sys.argv[sys.argv.index("--dur") + 1]) if "--dur" in sys.argv else 48.0
    pick = float(sys.argv[sys.argv.index("--pickup") + 1]) if "--pickup" in sys.argv else 0.35
    x, truth = make(bpm, drift, dur, pick)
    sf.write(out, x, SR, subtype="PCM_16")
    json.dump(truth, open(tj, "w"))
    print(out, x.shape, "beats", len(truth["beats"]))
