"""Stage 1 - vocal / instrumental separation with audio-separator + the local UVR-MDX-NET-Voc_FT onnx model.

Cache key = content hash of the decoded audio (stage 0 `audio_id`) + sha256 of the model file + separator settings, so a
different song, model or setting can never reuse stale stems.  Outputs (audio_dir): vocals.wav inst.wav sep.json
Cache: audio_dir/cache/sep/<audio_id>/<model12>_<settings10>/{vocals.wav,inst.wav,manifest.json}
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from .common import Ctx, dump_json, find_model, limit_ort_threads, load_json, sha256_file, stable_hash, timer

MODEL_FILE = "UVR-MDX-NET-Voc_FT.onnx"
# audio-separator 0.47 defaults; spelled out so that they are part of the cache key
SEP_SETTINGS = {
    "model": MODEL_FILE, "output_format": "WAV", "sample_rate": 44100,
    "normalization_threshold": 0.9, "amplification_threshold": 0.0,
    "mdx_params": {"hop_length": 1024, "segment_size": 256, "overlap": 0.25, "batch_size": 1, "enable_denoise": False},
}


def cache_dir(ctx: Ctx, audio_id: str) -> Path:
    model = find_model(MODEL_FILE)
    key = f"{sha256_file(model, 12)}_{stable_hash(SEP_SETTINGS, 10)}"
    return ctx.cache_dir / "sep" / audio_id / key


def _link(src: Path, dst: Path):
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def _publish(ctx: Ctx, cdir: Path):
    _link(cdir / "vocals.wav", ctx.p("vocals.wav"))
    _link(cdir / "inst.wav", ctx.p("inst.wav"))


def separate(wav: Path, out_dir: Path, log_level=logging.WARNING):
    """Run audio-separator on `wav`; returns (vocals_path, inst_path)."""
    limit_ort_threads(1)
    from audio_separator.separator import Separator
    model = find_model(MODEL_FILE)
    s = SEP_SETTINGS
    sep = Separator(log_level=log_level, model_file_dir=str(model.parent), output_dir=str(out_dir), output_format=s["output_format"],
                    normalization_threshold=s["normalization_threshold"], amplification_threshold=s["amplification_threshold"],
                    sample_rate=s["sample_rate"], mdx_params=dict(s["mdx_params"]))
    sep.load_model(MODEL_FILE)
    outs = sep.separate(str(wav), custom_output_names={"Vocals": "vocals", "Instrumental": "inst"})
    got = {Path(o).name: Path(o) if Path(o).is_absolute() else Path(out_dir) / o for o in outs}
    return got["vocals.wav"], got["inst.wav"]


def run(ctx: Ctx) -> dict:
    meta = load_json(ctx.p("meta.json"))
    audio_id = meta["audio_id"]
    cdir = cache_dir(ctx, audio_id)
    with timer() as tm:
        hit = (cdir / "vocals.wav").exists() and (cdir / "inst.wav").exists()
        if hit:
            ctx.log("separate", f"cache hit {cdir.relative_to(ctx.audio_dir)}")
        else:
            ctx.log("separate", "running UVR-MDX-NET-Voc_FT (1 thread, this is the slow stage: about 2x realtime on a shared 2-core box, ~6 min for a 3 min song)")
            cdir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=str(cdir.parent)) as tmp:
                v, i = separate(ctx.p("norm.wav"), Path(tmp))
                shutil.move(str(v), cdir / "vocals.wav")
                shutil.move(str(i), cdir / "inst.wav")
            model = find_model(MODEL_FILE)
            dump_json(cdir / "manifest.json", {"audio_id": audio_id, "settings": SEP_SETTINGS, "model_sha256": sha256_file(model),
                                                "origin": "computed", "seconds": round(time.time() - tm["t0"], 1)})
        _publish(ctx, cdir)
        info = sf.info(ctx.p("vocals.wav"))
        dur_v = info.frames / info.samplerate
        if abs(dur_v - meta["duration"]) > 0.05:
            ctx.note_warning(f"vocal stem duration {dur_v:.3f}s differs from the mix {meta['duration']:.3f}s")
        d = {"cache": str(cdir), "cache_hit": hit, "settings": SEP_SETTINGS}
        dump_json(ctx.p("sep.json"), d)
    ctx.log("separate", f"vocals.wav / inst.wav ready ({tm['dt']:.1f}s, cache_hit={hit})")
    ctx.note_stage("separate", tm["dt"], cache_hit=hit)
    return d


def verify_stems_match_mix(mix_wav: Path, vocals: Path, inst: Path) -> dict:
    """Check that two stems are a decomposition of `mix_wav` (least-squares fit of a*vocals + b*inst to the mix)."""
    m, _ = sf.read(mix_wav, dtype="float32", always_2d=True)
    v, _ = sf.read(vocals, dtype="float32", always_2d=True)
    i, _ = sf.read(inst, dtype="float32", always_2d=True)
    n = min(len(m), len(v), len(i))
    m, v, i = m[:n].mean(1), v[:n].mean(1), i[:n].mean(1)
    A = np.stack([v, i], 1)
    coef, *_ = np.linalg.lstsq(A, m, rcond=None)
    fit = A @ coef
    resid = m - fit
    snr = 10 * np.log10(np.sum(m ** 2) / (np.sum(resid ** 2) + 1e-12))
    return {"fit_snr_db": float(snr), "coef_vocals": float(coef[0]), "coef_inst": float(coef[1]), "samples": int(n),
            "len_mix": int(len(m)), "len_vocals": int(len(v))}


def seed_cache(ctx: Ctx, vocals: Path, inst: Path, note: str, min_snr_db=12.0) -> dict:
    """Pre-populate the separation cache for the *current* audio with stems computed earlier by a byte-identical model +
    settings (e.g. the previous project's run). Refuses unless the stems provably decompose this audio."""
    meta = load_json(ctx.p("meta.json"))
    chk = verify_stems_match_mix(ctx.p("norm.wav"), vocals, inst)
    if chk["fit_snr_db"] < min_snr_db:
        raise RuntimeError(f"refusing to seed cache: stems do not reconstruct the mix (SNR {chk['fit_snr_db']:.1f} dB)")
    cdir = cache_dir(ctx, meta["audio_id"])
    cdir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(vocals, cdir / "vocals.wav")
    shutil.copyfile(inst, cdir / "inst.wav")
    dump_json(cdir / "manifest.json", {"audio_id": meta["audio_id"], "settings": SEP_SETTINGS,
                                        "model_sha256": sha256_file(find_model(MODEL_FILE)),
                                        "origin": "seeded", "note": note, "verification": chk})
    return chk
