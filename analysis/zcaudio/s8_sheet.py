"""Stage 8 - diagnostic sheets: data/audio/sheet.png (rows of ~30 s) and data/audio/sheet.html (player + correction helper).

Every PNG row shows, from top to bottom:
  waveform of the mix with section bands, bar lines (bar numbers every 4) and beat ticks;
  mel spectrogram of the mix; vocal-stem level (voiced segments) below it;
  the five band features and the vocal level, drum events (kick red, clap green, hat blue);
  the words as boxes in three tiers (green = recognised, orange = interpolated, blue = pinned; dashed = low confidence),
  line ids, and non-lyric vocalisations (grey).
Run after stage 7:  python3 -m zcaudio run --song ... --stages 8
"""
from __future__ import annotations

import json
import os

import numpy as np

from .common import Ctx, load_json, timer
from .sigproc import load_mono

SRC_COLOR = {"asr": "#2e9b47", "interp": "#e08a1e", "pinned": "#2f6fd0"}
SEC_COLORS = ["#f4c2d7", "#c9e4f5", "#d9f2c4", "#fde7a8", "#e3d3f5", "#c4f0e6"]


def _wave_env(y, sr, t0, t1, n=1400):
    a, b = int(t0 * sr), int(min(t1 * sr, len(y)))
    seg = y[a:b]
    if len(seg) < n:
        return np.linspace(t0, t1, max(2, len(seg))), seg, seg
    k = len(seg) // n
    seg = seg[:k * n].reshape(n, k)
    return np.linspace(t0, t0 + k * n / sr, n), seg.min(1), seg.max(1)


def render_png(ctx: Ctx, timing: dict, path, row_s: float = 30.0, dpi: int = 65):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import librosa

    dur = timing["meta"]["duration"]
    y, sr = load_mono(ctx.p("norm.wav"), 22050)
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512, n_mels=72, fmin=30, fmax=9000)
    SdB = librosa.power_to_db(S, ref=np.max(S), top_db=70)
    hop_s = 512 / sr
    voc_wav = None
    if ctx.p("vocals.wav").exists():
        yv, _ = load_mono(ctx.p("vocals.wav"), 22050)
        rv = librosa.feature.rms(y=yv, frame_length=2048, hop_length=512)[0]
        voc_wav = 20 * np.log10(rv + 1e-6)
    beats, bars = np.array(timing["beats"]), np.array(timing["bars"])
    F = timing["frames"]
    fps = F["fps"]
    nrows = int(np.ceil(dur / row_s))
    fig, axes = plt.subplots(nrows * 4, 1, figsize=(26, nrows * 5.6), gridspec_kw={"height_ratios": [1.0, 1.5, 1.0, 1.35] * nrows})
    for r in range(nrows):
        t0, t1 = r * row_s, min(dur, (r + 1) * row_s)
        a_w, a_s, a_f, a_t = axes[4 * r:4 * r + 4]
        # --- waveform + sections + bars
        x, lo, hi = _wave_env(y, sr, t0, t1)
        a_w.fill_between(x, lo, hi, color="#555", lw=0)
        for k, s in enumerate(timing["sections"]):
            if s["end"] > t0 and s["start"] < t1:
                a_w.axvspan(max(s["start"], t0), min(s["end"], t1), color=SEC_COLORS[k % len(SEC_COLORS)], alpha=0.55, lw=0)
                a_w.text(max(s["start"], t0) + 0.1, 0.93, f"{s['name']}", transform=a_w.get_xaxis_transform(), fontsize=9, fontweight="bold", va="top")
        bb = bars[(bars >= t0) & (bars <= t1)]
        for k, b in enumerate(bars):
            if t0 <= b <= t1:
                a_w.axvline(b, color="#222", lw=0.8, alpha=0.7)
                if k % 4 == 0:
                    a_w.text(b + 0.05, -0.08, str(k), transform=a_w.get_xaxis_transform(), fontsize=6, va="top", color="#222")
        a_w.plot(beats[(beats >= t0) & (beats <= t1)], np.full(((beats >= t0) & (beats <= t1)).sum(), -0.97), "|", color="#c00", ms=4)
        a_w.set_xlim(t0, t1)
        a_w.set_ylim(-1, 1)
        a_w.set_yticks([])
        a_w.set_title(f"{t0:.0f}-{t1:.0f} s", fontsize=8, loc="left", pad=2)
        # --- spectrogram + vocal level
        i0, i1 = int(t0 / hop_s), int(t1 / hop_s)
        a_s.imshow(SdB[:, i0:i1], origin="lower", aspect="auto", extent=[t0, i1 * hop_s, 0, 1], cmap="magma", vmin=-70, vmax=0)
        if voc_wav is not None:
            v = np.clip((voc_wav[i0:i1] + 60) / 60, 0, 1)
            a_s.plot(np.arange(i0, i0 + len(v)) * hop_s, v * 0.5, color="#7df", lw=0.8)
        a_s.set_xlim(t0, t1)
        a_s.set_yticks([])
        # --- features & drums
        n = len(F["sub"])
        f0, f1 = int(t0 * fps), min(n, int(t1 * fps) + 1)
        tt = np.arange(f0, f1) / fps
        for name, col in (("sub", "#7b1fa2"), ("bass", "#d81b60"), ("lowmid", "#f57c00"), ("mid", "#2e9b47"), ("high", "#1e88e5")):
            a_f.plot(tt, np.array(F[name][f0:f1]), color=col, lw=0.9, label=name)
        a_f.fill_between(tt, 0, np.array(F["vocal"][f0:f1]), color="#999", alpha=0.35, lw=0)
        for name, col, yy in (("kick", "#d32f2f", -0.08), ("clap", "#2e7d32", -0.16), ("hat", "#1565c0", -0.24)):
            d = np.array(timing["drums"][name]["t"])
            d = d[(d >= t0) & (d <= t1)]
            a_f.plot(d, np.full(len(d), yy), "|", color=col, ms=5)
        a_f.set_xlim(t0, t1)
        a_f.set_ylim(-0.3, 1.05)
        a_f.set_yticks([])
        if r == 0:
            a_f.legend(loc="upper right", fontsize=6, ncol=5, frameon=False)
        # --- words
        for v in timing["vocalizations"]:
            if v["t1"] > t0 and v["t0"] < t1:
                a_t.axvspan(v["t0"], v["t1"], ymin=0.0, ymax=0.12, color="#888", alpha=0.6)
        for l in timing["lines"]:
            if l["t1"] > t0 and l["t0"] < t1:
                a_t.plot([max(l["t0"], t0), min(l["t1"], t1)], [3.55, 3.55], color="#444", lw=1.2)
                a_t.text(max(l["t0"], t0), 3.62, l["id"], fontsize=6, color="#333", va="bottom")
        for w in timing["words"]:
            if w["t1"] > t0 and w["t0"] < t1:
                k = w["i"] % 3
                col = SRC_COLOR.get(w["src"], "#777")
                a_t.add_patch(plt.Rectangle((w["t0"], k + 0.05), max(0.02, w["t1"] - w["t0"]), 0.85, fc=col, ec=col, alpha=0.30 if w["conf"] < 0.5 else 0.55,
                                            ls="--" if w["conf"] < 0.5 else "-", lw=0.6))
                a_t.text(w["t0"] + 0.01, k + 0.47, w["w"], fontsize=6.5, va="center", clip_on=True)
        a_t.set_xlim(t0, t1)
        a_t.set_ylim(0, 4.0)
        a_t.set_yticks([])
        if r == nrows - 1:
            a_t.set_xlabel("seconds")
    fig.tight_layout(pad=0.4, h_pad=0.15)
    fig.savefig(path, dpi=dpi)
    plt.close(fig)


def run(ctx: Ctx) -> dict:
    tp = ctx.out_dir / "timing.json"
    if not tp.exists():
        raise SystemExit("stage 8 needs data/timing.json (run stage 7 first)")
    timing = load_json(tp)
    cfg = ctx.cfg.get("sheet", {})
    with timer() as tm:
        png = ctx.p("sheet.png")
        render_png(ctx, timing, png, row_s=float(cfg.get("row_s", 30.0)), dpi=int(cfg.get("dpi", 65)))
        from .sheet_html import write_html
        html = ctx.p("sheet.html")
        write_html(ctx, timing, html)
    ctx.log("sheet", f"{png.relative_to(ctx.out_dir.parent) if png.is_relative_to(ctx.out_dir.parent) else png}, {html.name} ({tm['dt']:.1f}s)")
    ctx.note_stage("sheet", tm["dt"])
    return {"png": str(png), "html": str(html)}
