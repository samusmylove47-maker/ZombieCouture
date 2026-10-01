#!/bin/bash
# A quick look at a stretch of the film while the master is still rendering: frames T0..T1 (song seconds) of a frame folder + the matching piece of the song,
# 720p, crf 22, BT.709 tags, faststart.  Not a release file (no gap scan, no padding to the film length): every frame in the range must exist.
#   tools/encode_preview.sh <frames_dir> <audio> <T0> <T1> <out.mp4> [--w 1280] [--h 720] [--crf 22] [--fps 24]
source "$(dirname "${BASH_SOURCE[0]}")/encode_common.sh"
FPS=24; CRF=22; W=1280; H=720; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --fps) FPS="$2"; shift 2;; --crf) CRF="$2"; shift 2;; --w) W="$2"; shift 2;; --h) H="$2"; shift 2;;
  -h|--help) sed -n 2,5p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 5 ] || zc_die "usage: encode_preview.sh <frames_dir> <audio> <T0> <T1> <out.mp4>"
DIR="${POS[0]}"; AUDIO="${POS[1]}"; T0="${POS[2]}"; T1="${POS[3]}"; OUT="${POS[4]}"
zc_need ffmpeg; [ -f "$AUDIO" ] || zc_die "audio not found: $AUDIO"
read -r A B < <(python3 -c "import math; print(round($T0*$FPS), math.ceil($T1*$FPS-1e-6))")      # first frame, end (exclusive)
N=$((B - A)); [ "$N" -gt 0 ] || zc_die "empty range"
EXT=jpg; [ -f "$DIR/$(printf 'f_%05d' "$A").jpg" ] || EXT=png
for i in $(seq "$A" "$((B - 1))"); do [ -f "$DIR/$(printf 'f_%05d' "$i").$EXT" ] || zc_die "frame $i is missing in $DIR (the preview needs every frame of the range)"; done
VDUR="$(zc_num "$N/$FPS")"
mkdir -p "$(dirname "$OUT")"
nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -y \
  -framerate "$FPS" -start_number "$A" -i "$DIR/f_%05d.$EXT" -ss "$T0" -t "$VDUR" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 -vf "$(zc_vf "$W" "$H")" -af "asetpts=PTS-STARTPTS,aresample=48000,apad=whole_dur=$VDUR" \
  -c:v libx264 -preset medium -profile:v high -pix_fmt yuv420p -crf "$CRF" -g $((FPS * 2)) "${ZC_TAGS[@]}" \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT"
ls -l "$OUT" | awk '{printf "wrote %s (%.1f MB), %d frames = %s s\n", $NF, $5/1e6, '"$N"', "'"$VDUR"'"}'
