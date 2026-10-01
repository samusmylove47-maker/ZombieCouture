"""Shared helpers for the audio-analysis pipeline: paths, config, hashing, JSON IO, logging, thread limits.

Everything heavy in this package is meant to run on a shared 2-core box next to a render job, so the
thread limits below are applied at import time (before numpy / torch / onnxruntime are loaded).
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

# ---- thread limits (must precede numpy/scipy/torch/onnxruntime imports) ---------------------------------
for _k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS",
           "VECLIB_MAXIMUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ.setdefault(_k, "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

PIPELINE_VERSION = "1.0.0"
SCHEMA_ID = "zombie-couture.timing/1"

ANALYSIS_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ANALYSIS_DIR.parent

# --------------------------------------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------------------------------------
DEFAULTS: dict = {
    "fps": 24,                                   # feature frame rate written to timing.json
    "language": "en",
    "beats": {
        "bpm_hint": 130.0,                       # centre of the tempo prior (bubblegum pop ~125-135)
        "bpm_min": 90.0, "bpm_max": 180.0,       # search range (half/double-time errors are folded into it)
        "beats_per_bar": 4,
        "prior_sigma_oct": 0.6,                  # width of the log-tempo prior in octaves (large = weak prior)
        "tight": 120.0,                          # DP tracker: penalty for deviating from the nominal beat period (higher = stiffer)
        "smooth_lambda": 60.0,                   # smoothing of the refined beat curve (2nd-difference penalty; ~ 14-beat window)
        "snap_ms": [70.0, 45.0, 30.0, 25.0],     # search window around each beat for the onset peak, per refinement pass
        "onset_lead_ms": 19.0,                   # constant added to the beat times (calibrated on the synthetic track, see README)
        "downbeat_shift": 0,                     # rotate the bar phase by this many beats (manual fix, or overrides.json beats.downbeat_shift)
    },
    "asr": {
        "model": "zipformer-gigaspeech",
        "win": 12.0, "hop": 10.0, "guard": 1.0,  # seconds; overlap = win - hop, guard = trimmed at each side
        "decoding": "greedy_search",             # greedy_search | modified_beam_search (needed for hotwords)
        "hotwords": False,                       # bias the decoder toward lyric words (see README)
        "hotwords_score": 1.5,
        "normalize_peak": 0.7,                   # peak-normalise the 16 kHz vocal stem before decoding (0 = off)
    },
    "align": {
        "onset_window_ms": 80.0,                 # +-window for snapping a word start to a vocal onset
        "phrase_start_back_ms": 150.0,           # a line's first word may snap this far *earlier* (to the phrase onset)
        "snap": True,
        "min_word_ms": 60.0,
        "max_word_s": 2.6,                       # hard cap for a normal word (elongated words are exempt)
        "gap_lyric": 0.45, "gap_asr": 0.35, "gap_asr_voc": 0.05,
        "sim_floor": 0.5,
        "anchor_sim": 0.62,                      # DP matches below this similarity are not trusted as timing anchors
        "squeeze_factor": 0.6,                   # an anchor is dropped if the words between it and its neighbour would need to be sung faster than
                                                 # this fraction of their model duration (real gaps measure 0.9-1.3, wrong anchors 0.2-0.4)
    },
    "sections": {
        "pickup_beats": 2.25,                    # a section whose first word starts up to this many beats before a bar line begins on that bar line
    },
    "features": {
        "n_fft": 2048, "hop_ms": 5.0,
        "drum_lead_ms": {"kick": 4.0, "clap": 2.4, "hat": 3.6},   # detector lead per drum class (calibrated on validation/synth.py)
        "bands_hz": [[20, 60], [60, 200], [200, 1000], [1000, 4000], [4000, 16000]],
        "band_names": ["sub", "bass", "lowmid", "mid", "high"],
        "attack_ms": 15.0, "release_ms": 140.0,
        "gamma": 1.7,                            # contrast of the band / rms levels (song-relative dB 8th..99.5th percentile, then ^gamma)
    },
    "visemes": {
        "lead_ms": 0.0,                          # shift mouth events earlier (anticipation) if lips look late
        "min_closure_ms": 55.0,
    },
}


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def parse_set(cfg: dict, assignments: list[str]) -> dict:
    """Apply --set a.b=c assignments (values parsed as JSON when possible)."""
    for item in assignments or []:
        key, _, val = item.partition("=")
        try:
            v = json.loads(val)
        except Exception:
            v = val
        d = cfg
        parts = key.split(".")
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = v
    return cfg


# --------------------------------------------------------------------------------------------------------
# run context
# --------------------------------------------------------------------------------------------------------
class Ctx:
    """Everything a stage needs: where files live, the config, and a logger."""

    def __init__(self, out_dir, song=None, lyrics=None, cfg=None, excerpt=None, quiet=False):
        self.out_dir = Path(out_dir).resolve()
        self.audio_dir = self.out_dir / "audio"
        self.cache_dir = self.audio_dir / "cache"
        self.song = Path(song).resolve() if song else None
        self.lyrics = Path(lyrics).resolve() if lyrics else None
        self.cfg = cfg or copy.deepcopy(DEFAULTS)
        self.excerpt = excerpt                      # (start_s, dur_s) or None
        self.quiet = quiet
        self.current_stage = "pipeline"
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        gi = self.audio_dir / ".gitignore"                          # big intermediates stay out of git; the small JSONs can be committed
        if not gi.exists():
            gi.write_text("cache/\n*.wav\n")
        self._t0 = time.time()

    def p(self, name: str) -> Path:
        return self.audio_dir / name

    def log(self, stage: str, msg: str):
        if not self.quiet:
            print(f"[{time.time() - self._t0:7.1f}s] {stage:<10s} {msg}", flush=True)

    def warn(self, stage: str, msg: str):
        print(f"[{time.time() - self._t0:7.1f}s] {stage:<10s} WARNING: {msg}", file=sys.stderr, flush=True)

    # small state file shared between stages (durations, cache hits, warnings)
    def state(self) -> dict:
        p = self.p("state.json")
        if p.exists():
            try:
                st = json.loads(p.read_text())
                if not isinstance(st.get("warnings"), dict):
                    st["warnings"] = {}
                return st
            except Exception:
                pass
        return {"stages": {}, "warnings": {}}

    def save_state(self, st: dict):
        atomic_write_text(self.p("state.json"), json.dumps(st, indent=1))

    def note_stage(self, name: str, seconds: float, **info):
        st = self.state()
        st["stages"][name] = {"seconds": round(seconds, 2), **info}
        self.save_state(st)

    def begin_stage(self, name: str):
        """A stage re-run replaces the warnings that its previous run left behind."""
        self.current_stage = name
        st = self.state()
        st["warnings"].pop(name, None)
        self.save_state(st)

    def note_warning(self, msg: str):
        st = self.state()
        lst = st["warnings"].setdefault(self.current_stage, [])
        if msg not in lst:
            lst.append(msg)
        self.save_state(st)
        self.warn("warn", msg)

    def all_warnings(self) -> list:
        w = self.state()["warnings"]
        return [f"[{k}] {m}" for k, v in w.items() for m in v]


@contextlib.contextmanager
def timer():
    t = {"t0": time.time(), "dt": 0.0}
    yield t
    t["dt"] = time.time() - t["t0"]


# --------------------------------------------------------------------------------------------------------
# hashing / json
# --------------------------------------------------------------------------------------------------------
def sha256_file(path, n=None, chunk=1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    d = h.hexdigest()
    return d[:n] if n else d


def sha256_bytes(b: bytes, n=None) -> str:
    d = hashlib.sha256(b).hexdigest()
    return d[:n] if n else d


def stable_hash(obj, n=10) -> str:
    return sha256_bytes(json.dumps(obj, sort_keys=True, default=str).encode(), n)


def _round(x, nd):
    if isinstance(x, float):
        return round(x, nd)
    if isinstance(x, (list, tuple)):
        return [_round(v, nd) for v in x]
    if isinstance(x, dict):
        return {k: _round(v, nd) for k, v in x.items()}
    try:
        import numpy as np
        if isinstance(x, np.generic):
            return _round(x.item(), nd)
        if isinstance(x, np.ndarray):
            return _round(x.tolist(), nd)
    except Exception:
        pass
    return x


def to_jsonable(x, nd=4):
    return _round(x, nd)


def atomic_write_text(path, text: str):
    """Write via a temp file + rename: a killed run never leaves a half-written JSON, and a hard-linked file (the validation
    variants share files with the base run) is replaced instead of being modified in place."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def dump_json(path, obj, indent=1, nd=4):
    atomic_write_text(path, json.dumps(to_jsonable(obj, nd), indent=indent, ensure_ascii=False))


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def _scalarish(v) -> bool:
    return not isinstance(v, (list, dict))


def pretty_json(obj, nd=4, level=0, inline_limit=170) -> str:
    """Readable-but-compact JSON: lists of scalars stay on one line, small records (dicts) stay on one line, lists of records one
    per line, lists of lists of numbers one row per line (a list of such lists: one line per item), top-level keys one per line.
    Diff-friendly and much smaller than indent=1."""
    obj = to_jsonable(obj, nd)
    pad = "  " * level

    def small(o):
        return json.dumps(o, ensure_ascii=False, separators=(",", ":"))

    if isinstance(obj, dict):
        s = small(obj)
        if len(s) <= inline_limit and all(_scalarish(v) or (isinstance(v, list) and all(_scalarish(x) for x in v) and len(v) < 16)
                                          for v in obj.values()):
            return json.dumps(obj, ensure_ascii=False, separators=(", ", ": "))
        items = []
        for k, v in obj.items():
            items.append(f'{pad}  {json.dumps(k, ensure_ascii=False)}: {pretty_json(v, nd, level + 1, inline_limit)}')
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(_scalarish(v) for v in obj):
            return small(obj)
        if all(isinstance(v, list) and all(_scalarish(x) for x in v) for v in obj):
            rows = [small(v) for v in obj]                              # matrix-like: one row per line
            return "[\n" + ",\n".join(f"{pad}  {r}" for r in rows) + f"\n{pad}]"
        if all(isinstance(v, list) and all(isinstance(x, list) and all(_scalarish(y) for y in x) for x in v) for v in obj):
            rows = [small(v) for v in obj]                              # e.g. per-word event lists: one line per word
            return "[\n" + ",\n".join(f"{pad}  {r}" for r in rows) + f"\n{pad}]"
        items = [f"{pad}  {pretty_json(v, nd, level + 1, inline_limit)}" for v in obj]
        return "[\n" + ",\n".join(items) + f"\n{pad}]"
    return json.dumps(obj, ensure_ascii=False)


def write_pretty_json(path, obj, nd=4):
    atomic_write_text(path, pretty_json(obj, nd) + "\n")


# --------------------------------------------------------------------------------------------------------
# model lookup
# --------------------------------------------------------------------------------------------------------
MODEL_SEARCH = [
    os.environ.get("ZC_MODELS", ""),
    str(ANALYSIS_DIR / "models"),
]


def find_model(*rel_candidates: str) -> Path:
    """Find a local model file/dir. `rel_candidates` are tried under every search root."""
    tried = []
    for root in MODEL_SEARCH:
        if not root:
            continue
        for rel in rel_candidates:
            p = Path(root) / rel
            tried.append(str(p))
            if p.exists():
                return p
    raise FileNotFoundError("model not found; tried:\n  " + "\n  ".join(tried) +
                            "\nSet ZC_MODELS=/dir/with/models (no downloads are attempted).")


def limit_ort_threads(n=1):
    """Force every onnxruntime session created after this call to use n intra-op threads (audio-separator
    builds its sessions internally with default options, which would grab all cores)."""
    import onnxruntime as ort
    if getattr(ort, "_zc_patched", False):
        return
    orig = ort.InferenceSession

    class _Limited(orig):                                           # type: ignore[misc, valid-type]
        def __init__(self, path_or_bytes, sess_options=None, providers=None, provider_options=None, **kw):
            so = sess_options or ort.SessionOptions()
            so.intra_op_num_threads = n
            so.inter_op_num_threads = 1
            super().__init__(path_or_bytes, sess_options=so, providers=providers or ["CPUExecutionProvider"],
                             provider_options=provider_options, **kw)

    ort.InferenceSession = _Limited
    ort._zc_patched = True
    try:
        import torch
        torch.set_num_threads(n)
        torch.set_num_interop_threads(1)
    except Exception:
        pass


# --------------------------------------------------------------------------------------------------------
# tiny numeric helpers
# --------------------------------------------------------------------------------------------------------
def fmt_time(t: float) -> str:
    m, s = divmod(t, 60)
    return f"{int(m)}:{s:05.2f}"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())
