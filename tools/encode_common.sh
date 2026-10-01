#!/bin/bash
# Shared pieces of tools/encode_*.sh (sourced, not run). All output is tagged BT.709, limited range, yuv420p.
# Rules kept here: one audio mux padded with apad=whole_dur (never -shortest); frame directory must have no gaps;
# global metadata of the inputs is dropped (an mp3 carries tags that must not reach the video).
set -euo pipefail
ZC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZC_NICE="${ZC_NICE:-5}"

zc_die() { echo "ERROR: $*" >&2; exit 1; }
zc_need() { command -v "$1" >/dev/null 2>&1 || zc_die "$1 not found"; }
zc_num() { python3 -c "import sys; print('%.6f' % ($1))"; }

# zc_scan DIR -> FIRST LAST COUNT EXT W H (fails on gaps, mixed types, empty dirs)
zc_scan() {
  local out
  out="$(python3 "$ZC_ROOT/tools/mux_check.py" --scan-frames "$1")" || exit 1
  eval "$out"
}

zc_dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

# zc_vf W H [crop]   the scale + colour conversion + tagging chain
zc_vf() {
  local w="$1" h="$2" crop="${3:-}"
  local pre=""
  [ -n "$crop" ] && pre="crop=trunc(ih*9/16/2)*2:ih:(iw-trunc(ih*9/16/2)*2)/2:0,"
  echo "${pre}scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
}

ZC_TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
ZC_META=(-map_metadata -1 -map_chapters -1
  -metadata "title=Zombie Couture"
  -metadata "artist=Avenrae / ShaeAI"
  -metadata "comment=Directed and published by Avenrae / ShaeAI. Music: Suno v5. Animation and every line of code: Claude Sonnet 5.5, in Claude.ai.")

# zc_af DURATION [extra filters]   audio: start at 0 (mp3 start offset removed), 48 kHz, padded to the video length (never -shortest)
zc_af() { echo "asetpts=PTS-STARTPTS,aresample=48000${2:+,$2},apad=whole_dur=$1"; }

# zc_warn_audio AUDIO VDUR   loud warning when the song and the picture disagree
zc_warn_audio() {
  local ad; ad="$(zc_dur "$1")" || zc_die "cannot read $1"
  python3 - "$ad" "$2" <<'PY'
import sys
a, v = float(sys.argv[1]), float(sys.argv[2])
if a > v + 0.5: print(f"WARNING: the audio is {a - v:.2f} s longer than the picture ({a:.2f} s vs {v:.2f} s): the end of the song will be cut. Missing frames?", file=sys.stderr)
elif a < v - 0.05: print(f"note: the audio is {v - a:.2f} s shorter than the picture; it is padded with silence")
PY
}

# zc_check VIDEO [mux_check args...]
zc_check() { python3 "$ZC_ROOT/tools/mux_check.py" "$@"; }
