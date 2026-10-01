#!/bin/bash
# 16:9 hook clip with a small on-screen tag (for X, Bluesky, Discord and the like: the clip names its maker even where no description shows).
#   tools/encode_hook169.sh <frames_dir> <audio> <start_s> <len_s> <tag.png> <out.mp4> [--fps 24] [--crf 25] [--margin 48] [--no-check]
# Takes frames round(start_s*fps) ... +round(len_s*fps) from the directory (absolute frame numbers), cuts the audio at the same window with
# 20 ms fades, lays the tag (tools/hook_tag.py) bottom-left over the whole clip, 1920x1080 crf 25 (about 13 Mbps: the felt grain is expensive), BT.709 tagged, +faststart.
source "$(dirname "${BASH_SOURCE[0]}")/encode_common.sh"
FPS=24; CRF=25; CHECK=1; MARGIN=48; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --fps) FPS="$2"; shift 2;; --crf) CRF="$2"; shift 2;; --margin) MARGIN="$2"; shift 2;; --no-check) CHECK=0; shift;;
  -h|--help) sed -n 2,5p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 6 ] || zc_die "usage: encode_hook169.sh <frames_dir> <audio> <start_s> <len_s> <tag.png> <out.mp4>"
DIR="${POS[0]}"; AUDIO="${POS[1]}"; START="${POS[2]}"; LEN="${POS[3]}"; TAG="${POS[4]}"; OUT="${POS[5]}"
zc_need ffmpeg; [ -f "$AUDIO" ] || zc_die "audio not found: $AUDIO"; [ -f "$TAG" ] || zc_die "tag image not found: $TAG (python3 tools/hook_tag.py)"
zc_scan "$DIR"
S0="$(python3 -c "print(round($START*$FPS))")"; NF="$(python3 -c "print(round($LEN*$FPS))")"
[ "$S0" -ge "$FIRST" ] && [ $((S0 + NF - 1)) -le "$LAST" ] || zc_die "the directory holds frames $FIRST..$LAST, the window needs $S0..$((S0 + NF - 1))"
VDUR="$(zc_num "$NF/$FPS")"
echo "hook 16:9: $NF frames from $S0 (${W}x${H} $EXT), audio $START s + ${VDUR}s, tag bottom-left, crf $CRF"
mkdir -p "$(dirname "$OUT")"
FADE="$(zc_num "$VDUR-0.02")"
FC="[0:v][2:v]overlay=${MARGIN}:H-h-${MARGIN}:format=rgb[o];[o]$(zc_vf 1920 1080)[v]"
nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -stats -stats_period 10 -y \
  -framerate "$FPS" -start_number "$S0" -i "$DIR/f_%05d.$EXT" -ss "$START" -t "$VDUR" -i "$AUDIO" -loop 1 -framerate "$FPS" -i "$TAG" \
  -filter_complex "$FC" -map "[v]" -map 1:a:0 -af "$(zc_af "$VDUR" "afade=t=in:st=0:d=0.02,afade=t=out:st=$FADE:d=0.02")" \
  -c:v libx264 -preset slow -crf "$CRF" -profile:v high -pix_fmt yuv420p -g "$(python3 -c "print(round($FPS*2))")" -bf 2 "${ZC_TAGS[@]}" \
  -frames:v "$NF" -c:a aac -b:a 192k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT"
ls -l "$OUT" | awk '{printf "wrote %s (%.1f MB)\n", $NF, $5/1e6}'
[ "$CHECK" = 1 ] && zc_check "$OUT" --fps "$FPS" --size 1920x1080 --expect-frames "$NF"
exit 0
