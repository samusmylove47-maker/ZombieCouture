"""Stage 0 - normalise the input to 44.1 kHz stereo 16-bit wav (+ 16 kHz mono for the ASR), measure it.

Outputs (audio_dir):  norm.wav  norm_16k.wav  meta.json
The content hash of the decoded 44.1 kHz PCM (`audio_id`) keys every downstream cache, so re-running on the
same song is free and a different song can never pick up stale stems.
"""
from __future__ import annotations

import json
import re
import subprocess
import wave

import numpy as np
import soundfile as sf

from .common import Ctx, dump_json, sha256_bytes, sha256_file, timer

SR = 44100


def _run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def _probe(path) -> dict:
    try:
        out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
        j = json.loads(out)
        a = next((s for s in j.get("streams", []) if s.get("codec_type") == "audio"), {})
        return {
            "codec": a.get("codec_name"), "sample_rate": int(a.get("sample_rate", 0) or 0), "channels": a.get("channels"),
            "bit_rate": int(j.get("format", {}).get("bit_rate", 0) or 0),
            "container_duration": float(j.get("format", {}).get("duration", 0) or 0),
            "start_time": float(a.get("start_time", 0) or 0),
        }
    except Exception as e:                                                   # pragma: no cover
        return {"error": str(e)}


def _loudness(path) -> dict:
    """EBU R128 integrated loudness / range / true peak via ffmpeg's ebur128 filter."""
    p = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    txt = p.stderr
    tail = txt[txt.rfind("Summary:"):] if "Summary:" in txt else ""

    def grab(pat):
        m = re.search(pat, tail)
        return float(m.group(1)) if m else None
    return {"lufs": grab(r"I:\s+(-?[\d.]+)\s+LUFS"), "lra": grab(r"LRA:\s+(-?[\d.]+)\s+LU"),
            "true_peak_dbtp": grab(r"Peak:\s+(-?[\d.]+)\s+dBFS")}


def run(ctx: Ctx) -> dict:
    assert ctx.song is not None and ctx.song.exists(), f"song not found: {ctx.song}"
    with timer() as tm:
        filt = []
        if ctx.excerpt:
            a, d = ctx.excerpt
            filt = ["-af", f"atrim=start={a}:duration={d},asetpts=PTS-STARTPTS"]
        base = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(ctx.song), "-vn"]
        _run(base + filt + ["-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(ctx.p("norm.wav"))])
        _run(base + filt + ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(ctx.p("norm_16k.wav"))])

        x, sr = sf.read(ctx.p("norm.wav"), dtype="float32", always_2d=True)
        assert sr == SR and x.shape[1] == 2
        dur = x.shape[0] / SR
        mono = x.mean(1)
        peak = float(np.abs(x).max())
        rms = float(np.sqrt(np.mean(mono ** 2)) + 1e-12)
        # hash of the PCM payload (not the container) so metadata edits / re-encodes of identical audio hash equal
        with wave.open(str(ctx.p("norm.wav")), "rb") as w:
            pcm = w.readframes(w.getnframes())
        audio_id = sha256_bytes(pcm, 16)
        meta = {
            "source": str(ctx.song), "source_sha256": sha256_file(ctx.song, 16), "audio_id": audio_id,
            "duration": round(dur, 4), "sample_rate": SR, "channels": 2,
            "peak_dbfs": round(20 * np.log10(peak + 1e-12), 2), "rms_dbfs": round(20 * np.log10(rms), 2),
            **{k: v for k, v in _loudness(ctx.p("norm.wav")).items()},
            "probe": _probe(ctx.song),
            "excerpt": list(ctx.excerpt) if ctx.excerpt else None,
        }
        if dur < 20:
            ctx.note_warning(f"audio is only {dur:.1f}s long; analysis is tuned for full songs")
        if meta["peak_dbfs"] < -30:
            ctx.note_warning(f"audio is very quiet (peak {meta['peak_dbfs']} dBFS) - check the input file")
        dump_json(ctx.p("meta.json"), meta)
    ctx.log("normalize", f"{dur:.2f}s  peak {meta['peak_dbfs']} dBFS  {meta['lufs']} LUFS  id {audio_id}  ({tm['dt']:.1f}s)")
    ctx.note_stage("normalize", tm["dt"], audio_id=audio_id)
    return meta
