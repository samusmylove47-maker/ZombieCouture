#!/bin/bash
# 9:16 Shorts cut.   tools/encode_short.sh <frames_dir> <audio> <start_s> <len_s> <out.mp4> [--crop] [--fps 24] [--crf 24] [--no-check]
# Takes frames round(start_s*fps) ... +round(len_s*fps) from the directory (absolute frame numbers; a clip numbered from 0 also works),
# cuts the audio at the same window with 20 ms fades, 1080x1920 crf 24 (about 13 Mbps: the felt grain is expensive), BT.709 tagged, +faststart.
# --crop: the frames are 16:9; a centre 9:16 slice is cropped out and scaled up (fallback when no native portrait render exists; soft).
source "$(dirname "${BASH_SOURCE[0]}")/encode_common.sh"
FPS=24; CRF=24; CHECK=1; CROP=0; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --fps) FPS="$2"; shift 2;; --crf) CRF="$2"; shift 2;; --crop) CROP=1; shift;; --no-check) CHECK=0; shift;;
  -h|--help) sed -n 2,6p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 5 ] || zc_die "usage: encode_short.sh <frames_dir> <audio> <start_s> <len_s> <out.mp4> [--crop]"
DIR="${POS[0]}"; AUDIO="${POS[1]}"; START="${POS[2]}"; LEN="${POS[3]}"; OUT="${POS[4]}"
zc_need ffmpeg; [ -f "$AUDIO" ] || zc_die "audio not found: $AUDIO"
zc_scan "$DIR"
S0="$(python3 -c "print(round($START*$FPS))")"; NF="$(python3 -c "print(round($LEN*$FPS))")"
if [ "$S0" -ge "$FIRST" ] && [ $((S0 + NF - 1)) -le "$LAST" ]; then SN="$S0"; MODE="absolute frame numbers"
elif [ "$FIRST" -eq 0 ] && [ "$COUNT" -ge "$NF" ]; then SN="$FIRST"; NF="$NF"; MODE="clip numbered from 0"
else zc_die "the directory holds frames $FIRST..$LAST, the window needs $S0..$((S0 + NF - 1))"; fi
VDUR="$(zc_num "$NF/$FPS")"
ASPECT_OK="$(python3 -c "print(1 if abs($W/$H - 9/16) < 0.01 else 0)")"
if [ "$CROP" = 1 ]; then VF="$(zc_vf 1080 1920 crop)"
elif [ "$ASPECT_OK" = 1 ]; then VF="$(zc_vf 1080 1920)"
else zc_die "frames are ${W}x${H} (not 9:16): render natively with tools/render_all.sh short, or pass --crop"; fi
echo "short: $NF frames from $SN ($MODE, ${W}x${H} $EXT), audio $START s + ${VDUR}s, 1080x1920 crf $CRF$([ $CROP = 1 ] && echo ' (centre crop)')"
mkdir -p "$(dirname "$OUT")"
FADE="$(zc_num "$VDUR-0.02")"
nice -n "$ZC_NICE" ffmpeg -nostdin -hide_banner -loglevel warning -stats -stats_period 10 -y \
  -framerate "$FPS" -start_number "$SN" -i "$DIR/f_%05d.$EXT" -ss "$START" -t "$VDUR" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 -vf "$VF" -af "$(zc_af "$VDUR" "afade=t=in:st=0:d=0.02,afade=t=out:st=$FADE:d=0.02")" \
  -c:v libx264 -preset slow -crf "$CRF" -profile:v high -pix_fmt yuv420p -g "$(python3 -c "print(round($FPS*2))")" -bf 2 "${ZC_TAGS[@]}" \
  -frames:v "$NF" -c:a aac -b:a 192k -ar 48000 -ac 2 -t "$VDUR" -movflags +faststart "${ZC_META[@]}" "$OUT"
ls -l "$OUT" | awk '{printf "wrote %s (%.1f MB)\n", $NF, $5/1e6}'
[ "$CHECK" = 1 ] && zc_check "$OUT" --fps "$FPS" --size 1080x1920 --expect-frames "$NF"
exit 0
