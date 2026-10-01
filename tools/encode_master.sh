#!/bin/bash
# 1080p master + 720p share copy in one pass.
#   tools/encode_master.sh <frames_dir> <audio> <out.mp4> [--fps 24] [--grain] [--crf 20] [--preset slow] [--no-720] [--no-check]
# Writes <out.mp4> (1920x1080 crf 20, AAC 320k) and <out>_720p.mp4 (crf 24, AAC 192k). --grain adds -tune grain (bigger files, keeps the film grain).
# The felt texture is expensive: measured on this film crf 16 is about 50 Mbps (1 GB), crf 20 about 26 Mbps (550 MB), crf 24 about 11 Mbps (240 MB) at 1080p;
# the 720p copy at crf 24 is about 4 Mbps (85 MB).
source "$(dirname "${BASH_SOURCE[0]}")/encode_common.sh"
FPS=24; CRF=20; PRESET=slow; CHECK=1; GRAIN=0; MAKE720=1; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --fps) FPS="$2"; shift 2;; --crf) CRF="$2"; shift 2;; --preset) PRESET="$2"; shift 2;; --grain) GRAIN=1; shift;;
  --no-720) MAKE720=0; shift;; --no-check) CHECK=0; shift;; -h|--help) sed -n 2,6p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 3 ] || zc_die "usage: encode_master.sh <frames_dir> <audio> <out.mp4> [--grain]"
DIR="${POS[0]}"; AUDIO="${POS[1]}"; OUT="${POS[2]}"; OUT720="${OUT%.mp4}_720p.mp4"
zc_need ffmpeg; [ -f "$AUDIO" ] || zc_die "audio not found: $AUDIO"
zc_scan "$DIR"
VDUR="$(zc_num "$COUNT/$FPS")"; KEY="$(python3 -c "print(round($FPS*2))")"
TUNE=(); [ "$GRAIN" = 1 ] && TUNE=(-tune grain)
echo "master: $COUNT frames ($FIRST..$LAST, ${W}x${H} $EXT) at $FPS fps = ${VDUR}s -> 1920x1080 crf $CRF ${TUNE[*]:-} $([ $MAKE720 = 1 ] && echo "+ 720p copy")"
zc_warn_audio "$AUDIO" "$VDUR"
mkdir -p "$(dirname "$OUT")"
V264=(-c:v libx264 -preset "$PRESET" -profile:v high -pix_fmt yuv420p -g "$KEY" -bf 3 "${TUNE[@]}" "${ZC_TAGS[@]}")
if [ "$MAKE720" = 1 ]; then
  nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -stats -stats_period 10 -y \
    -framerate "$FPS" -start_number "$FIRST" -i "$DIR/f_%05d.$EXT" -i "$AUDIO" \
    -filter_complex "[0:v]split=2[a][b];[a]$(zc_vf 1920 1080)[m];[b]$(zc_vf 1280 720)[s]" \
    -map "[m]" -map 1:a:0 -af "$(zc_af "$VDUR")" "${V264[@]}" -crf "$CRF" -c:a aac -b:a 320k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT" \
    -map "[s]" -map 1:a:0 -af "$(zc_af "$VDUR")" "${V264[@]}" -crf 24 -c:a aac -b:a 192k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT720"
else
  nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -stats -stats_period 10 -y \
    -framerate "$FPS" -start_number "$FIRST" -i "$DIR/f_%05d.$EXT" -i "$AUDIO" \
    -map 0:v:0 -map 1:a:0 -vf "$(zc_vf 1920 1080)" -af "$(zc_af "$VDUR")" "${V264[@]}" -crf "$CRF" -c:a aac -b:a 320k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT"
fi
for f in "$OUT" $([ $MAKE720 = 1 ] && echo "$OUT720"); do ls -l "$f" | awk '{printf "wrote %s (%.1f MB)\n", $NF, $5/1e6}'; done
if [ "$CHECK" = 1 ]; then
  zc_check "$OUT" --audio "$AUDIO" --fps "$FPS" --size 1920x1080 --expect-frames "$COUNT"
  [ "$MAKE720" = 1 ] && zc_check "$OUT720" --audio "$AUDIO" --fps "$FPS" --size 1280x720 --expect-frames "$COUNT"
fi
exit 0
