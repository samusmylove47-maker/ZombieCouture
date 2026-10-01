#!/bin/bash
# 720p review encode.   tools/encode_review.sh <frames_dir> <audio> <out.mp4> [--fps 24] [--crf 20] [--preset slow] [--no-check]
# libx264 yuv420p BT.709 tagged, +faststart, AAC 192k, one audio mux padded to the picture length.
source "$(dirname "${BASH_SOURCE[0]}")/encode_common.sh"
FPS=24; CRF=20; PRESET=slow; CHECK=1; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --fps) FPS="$2"; shift 2;; --crf) CRF="$2"; shift 2;; --preset) PRESET="$2"; shift 2;; --no-check) CHECK=0; shift;;
  -h|--help) sed -n 2,4p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 3 ] || zc_die "usage: encode_review.sh <frames_dir> <audio> <out.mp4> [--fps 24]"
DIR="${POS[0]}"; AUDIO="${POS[1]}"; OUT="${POS[2]}"
zc_need ffmpeg; [ -f "$AUDIO" ] || zc_die "audio not found: $AUDIO"
zc_scan "$DIR"
VDUR="$(zc_num "$COUNT/$FPS")"; KEY="$(python3 -c "print(round($FPS*2))")"
echo "review: $COUNT frames ($FIRST..$LAST, ${W}x${H} $EXT) at $FPS fps = ${VDUR}s -> 1280x720 crf $CRF"
zc_warn_audio "$AUDIO" "$VDUR"
mkdir -p "$(dirname "$OUT")"
nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -stats -stats_period 10 -y \
  -framerate "$FPS" -start_number "$FIRST" -i "$DIR/f_%05d.$EXT" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 -vf "$(zc_vf 1280 720)" -af "$(zc_af "$VDUR")" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -profile:v high -pix_fmt yuv420p -g "$KEY" -bf 2 "${ZC_TAGS[@]}" \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT"
ls -l "$OUT" | awk '{printf "wrote %s (%.1f MB)\n", $NF, $5/1e6}'
[ "$CHECK" = 1 ] && zc_check "$OUT" --audio "$AUDIO" --fps "$FPS" --size 1280x720 --expect-frames "$COUNT"
exit 0
