"""Stage 2 - word-level ASR timestamps with sherpa-onnx (local zipformer transducer) on the separated vocal stem.

Singing is hard for a speech model, so treat the output as *timing evidence*, not a transcript: stage 3 aligns the user's
lyrics against it. The decoder emits BPE tokens with frame times (40 ms); tokens starting with the sentencepiece mark
begin a word.  Long audio is decoded in overlapping windows; every token is kept from exactly one window.

Outputs: asr.json  {model, params, words:[{w,t,t_last,n_tok,lp}], tokens:[[t,tok],...]}
Cache:   audio_dir/cache/asr/<audio_id>/<key>/asr.json   (key = model sha + params [+ lyrics hash when hotwords are on])
"""
from __future__ import annotations

import glob
import os
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from .common import Ctx, dump_json, find_model, load_json, sha256_file, stable_hash, timer

SP = "▁"


def _model_dir() -> Path:
    return find_model("asr/zipformer-gigaspeech", "asr/sherpa-onnx-zipformer-gigaspeech-2023-12-12")


def _pick(mdir: Path, pattern: str) -> str:
    fs = sorted(glob.glob(str(mdir / pattern)))
    fs = [f for f in fs if "int8" in f] or fs
    return fs[0]


def load_mono16k(path: Path) -> np.ndarray:
    import librosa
    y, sr = sf.read(path, dtype="float32", always_2d=True)
    y = y.mean(1)
    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000, res_type="soxr_hq")
    return np.ascontiguousarray(y, dtype=np.float32)


def make_recognizer(cfg: dict, hotwords_file: str = ""):
    import sherpa_onnx
    mdir = _model_dir()
    kw = dict(encoder=_pick(mdir, "encoder*.onnx"), decoder=_pick(mdir, "decoder*.onnx"), joiner=_pick(mdir, "joiner*.onnx"),
              tokens=str(mdir / "tokens.txt"), num_threads=1, sample_rate=16000, feature_dim=80)
    if hotwords_file:
        kw.update(decoding_method="modified_beam_search", hotwords_file=hotwords_file, hotwords_score=float(cfg["hotwords_score"]),
                  modeling_unit="bpe", bpe_vocab=str(mdir / "bpe.vocab"))
    else:
        kw.update(decoding_method=cfg.get("decoding", "greedy_search"))
    return sherpa_onnx.OfflineRecognizer.from_transducer(**kw)


def decode_windows(rec, y: np.ndarray, cfg: dict, log=None):
    """Decode `y` (16 kHz) in overlapping windows; returns list of (t, token, logprob|None)."""
    sr = 16000
    win, hop, guard = cfg["win"], cfg["hop"], cfg["guard"]
    dur = len(y) / sr
    toks = []
    t = 0.0
    while t < dur:
        a, b = int(t * sr), int(min(dur, t + win) * sr)
        if b - a < int(0.3 * sr):
            break
        st = rec.create_stream()
        st.accept_waveform(sr, y[a:b])
        rec.decode_stream(st)
        r = st.result
        lo = t + (guard if t > 0 else 0.0)
        hi = t + win - guard if (t + win) < dur else dur + 1
        lps = getattr(r, "ys_log_probs", None)
        for k, (tk, ts) in enumerate(zip(r.tokens, r.timestamps)):
            T = t + ts
            if lo <= T < hi:
                toks.append((round(T, 3), tk, float(lps[k]) if lps is not None and len(lps) == len(r.tokens) else None))
        if log:
            log(f"[{t:6.1f}-{min(dur, t + win):6.1f}] {r.text.strip()[:100]}")
        t += hop
    return toks


def tokens_to_words(toks):
    words, cur = [], None
    for T, tk, lp in toks:
        starts = tk.startswith(" ") or tk.startswith(SP)
        piece = tk.lstrip(" " + SP)
        if cur is None or starts:
            if cur is not None:
                words.append(cur)
            cur = {"w": piece, "t": T, "t_last": T, "n_tok": 1, "lp": [lp] if lp is not None else []}
        else:
            cur["w"] += piece
            cur["t_last"] = T
            cur["n_tok"] += 1
            if lp is not None:
                cur["lp"].append(lp)
    if cur is not None:
        words.append(cur)
    out = []
    for w in words:
        lp = w.pop("lp")
        w["w"] = w["w"].lower()
        w["lp"] = round(float(np.mean(lp)), 3) if lp else None
        if w["w"]:
            out.append(w)
    return out


def _cache_paths(ctx: Ctx, meta: dict, hot_hash: str = ""):
    mdir = _model_dir()
    cfg = ctx.cfg["asr"]
    key = f"{sha256_file(_pick(mdir, 'encoder*.onnx'), 10)}_{stable_hash({k: cfg[k] for k in sorted(cfg)}, 8)}{hot_hash}"
    return ctx.cache_dir / "asr" / meta["audio_id"] / f"{key}_{sha256_file(ctx.p('vocals.wav'), 12)}"     # the stem's own content, not just how it was made


def run(ctx: Ctx) -> dict:
    meta = load_json(ctx.p("meta.json"))
    cfg = ctx.cfg["asr"]
    hot_hash = ""
    hot_file = ""
    if cfg.get("hotwords"):
        raise SystemExit("asr.hotwords=true is not supported in this build (the alignment stage already tolerates recognition errors); "
                         "leave it false, or fix the words by hand with data/overrides.json / data/pron.json - see analysis/README.md")
    cdir = _cache_paths(ctx, meta, hot_hash)
    with timer() as tm:
        cached = cdir / "asr.json"
        if cached.exists():
            out = load_json(cached)
            ctx.log("asr", f"cache hit ({len(out['words'])} words)")
            hit = True
        else:
            hit = False
            y = load_mono16k(ctx.p("vocals.wav"))
            pk = float(np.abs(y).max()) + 1e-9
            if cfg.get("normalize_peak"):
                y = y * (cfg["normalize_peak"] / pk)
            ctx.log("asr", f"decoding {len(y) / 16000:.1f}s of vocals in {cfg['win']:.0f}s windows (sherpa-onnx zipformer, 1 thread)")
            rec = make_recognizer(cfg, hot_file)
            toks = decode_windows(rec, y, cfg, log=None if ctx.quiet else (lambda s: ctx.log("asr", s)))
            words = tokens_to_words(toks)
            out = {"model": _model_dir().name, "params": cfg, "duration": len(y) / 16000,
                   "words": words, "tokens": [[t, k, lp] for t, k, lp in toks]}
            cdir.mkdir(parents=True, exist_ok=True)
            dump_json(cached, out, indent=None, nd=3)
        dump_json(ctx.p("asr.json"), out, indent=None, nd=3)
    ctx.log("asr", f"{len(out['words'])} recognised words ({tm['dt']:.1f}s, cache_hit={hit})")
    ctx.note_stage("asr", tm["dt"], cache_hit=hit, words=len(out["words"]))
    return out
