#!/usr/bin/env bash
# One entry point for the audio analysis pipeline.
#
#   analysis/run_audio.sh <song.mp3> [lyrics.txt] [options]
#
# Runs stages 0-8 (normalize, separate vocals, ASR, lyric alignment, beats, features, visemes, timing.json, diagnostic sheet)
# and writes data/audio/* and data/timing.json (project-relative; change with --out DIR).
# Options are passed to `python3 -m zcaudio run`:
#   --out DIR         output root (default: <project>/data)      --stages 0-8 | 3,4,7 | names   (default: all)
#   --fps N           feature frame rate written to timing.json (default 24)
#   --excerpt S:D     analyse only D seconds starting at S (testing)
#   --set a.b=c       override any setting, e.g. --set beats.bpm_hint=128 --set align.snap=false
#   --config FILE     JSON merged over the defaults        --quiet   less output
# Lyrics default to <project>/data/lyrics.txt.  Heavy work runs at nice 19 with one thread per library (the machine is shared
# with the render job); stage results are cached by content hash, so re-running is cheap and safe.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(dirname "$HERE")"

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi
SONG="$1"; shift
LYRICS="$PROJECT/data/lyrics.txt"
if [[ $# -gt 0 && "$1" != --* ]]; then LYRICS="$1"; shift; fi
[[ -f "$SONG" ]]   || { echo "song not found: $SONG" >&2; exit 2; }
[[ -f "$LYRICS" ]] || { echo "lyrics not found: $LYRICS" >&2; exit 2; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (apt install ffmpeg)" >&2; exit 2; }

export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
export NUMBA_NUM_THREADS=1 ORT_NUM_THREADS=1 TOKENIZERS_PARALLELISM=false
export PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}"

# Python dependencies (PyPI only; nothing else is downloaded - model weights come from analysis/models or $ZC_MODELS)
MISSING="$(python3 - <<'PY'
import importlib.util as u
need = {"numpy": "numpy", "scipy": "scipy", "soundfile": "soundfile", "librosa": "librosa", "onnxruntime": "onnxruntime",
        "sherpa_onnx": "sherpa-onnx", "audio_separator": "audio-separator", "cmudict": "cmudict", "matplotlib": "matplotlib"}
print(" ".join(pkg for mod, pkg in need.items() if u.find_spec(mod) is None))
PY
)"
if [[ -n "$MISSING" ]]; then
  echo "missing Python packages: $MISSING" >&2
  echo "install with:  pip install -r $HERE/requirements.txt" >&2
  exit 3
fi

exec nice -n 19 python3 -m zcaudio run --song "$SONG" --lyrics "$LYRICS" "$@"
