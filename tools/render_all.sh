#!/bin/bash
# Start a render preset with the hardened farm (nohup, log, lock).
#   tools/render_all.sh <review|master|short|thumb> [--from T] [--to T] [--scene film|story] [--out DIR] [--only ids] [--fmt jpg|png]
#                       [--w W --h H] [--procs N] [--q "extra&query"] [--dry-run] [--foreground] [-- more farm.py options]
# review  1280x720  jpg q0.92  on twos   -> out/frames/review   (the cheap look-through; the film itself is ones)
# master  1920x1080 jpg q0.97 (or --fmt png) ONES: every frame, smooth 24 fps poses, fibre boil at 12 Hz (hand=1) -> out/frames/master
# short   1080x1920 portrait (&aspect=portrait), a 15 s window: --from T [--to T]  -> out/frames/short
# thumb   one 1920x1080 png frame at --from T (smooth motion, no stepping)         -> out/frames/thumb
# Frame files are numbered by absolute frame number (f_%05d = round(t*24)). Re-running the same command resumes.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
PY="${ZC_PYTHON:-python3}"
usage() { sed -n 2,10p "$0"; exit "${1:-0}"; }
PRESET="${1:-}"; [ -z "$PRESET" ] && usage 1; case "$PRESET" in -h|--help) usage 0;; esac; shift
FROM=""; TO=""; SCENE="film"; OUT=""; ONLY=""; FMT=""; W=""; H=""; PROCS=""; XQ=""; DRY=0; FG=0; EXTRA=()
while [ $# -gt 0 ]; do case "$1" in
  --from) FROM="$2"; shift 2;; --to) TO="$2"; shift 2;; --scene) SCENE="$2"; shift 2;; --out) OUT="$2"; shift 2;;
  --only) ONLY="$2"; shift 2;; --fmt) FMT="$2"; shift 2;; --w) W="$2"; shift 2;; --h) H="$2"; shift 2;; --procs) PROCS="$2"; shift 2;;
  --q) XQ="$2"; shift 2;; --dry-run) DRY=1; shift;; --foreground) FG=1; shift;; --) shift; EXTRA=("$@"); break;;
  -h|--help) usage 0;; *) echo "unknown option $1" >&2; usage 1;; esac; done

FILMQ="timing=/data/timing.json&shots=/data/shots.json"
case "$PRESET" in
  review) W="${W:-1280}"; H="${H:-720}"; FMT="${FMT:-jpg}"; JQ=0.92; ON=2; SPF=3.5; Q="motion=twos&hand=1&$FILMQ";;
  master) W="${W:-1920}"; H="${H:-1080}"; FMT="${FMT:-jpg}"; JQ=0.97; ON=1; SPF=6.2; Q="motion=ones&hand=1&$FILMQ";;
  short)  W="${W:-1080}"; H="${H:-1920}"; FMT="${FMT:-jpg}"; JQ=0.95; ON=1; SPF=6.5; Q="motion=ones&hand=1&aspect=portrait&$FILMQ"
          [ -z "$FROM" ] && { echo "short needs --from T (the window start in song seconds; the window is 15 s unless --to is given)" >&2; exit 1; }
          [ -z "$TO" ] && TO="$(python3 -c "print($FROM+15)")";;
  thumb)  W="${W:-1920}"; H="${H:-1080}"; FMT="${FMT:-png}"; JQ=0.97; ON=1; SPF=6.2; Q="motion=ones&hand=0&$FILMQ"
          [ -z "$FROM" ] && { echo "thumb needs --from T (song seconds; 'python3 tools/thumbnail.py --pick' lists candidates)" >&2; exit 1; }
          TO="$(python3 -c "print($FROM+1/24-1e-4)")";;
  *) echo "unknown preset '$PRESET' (review|master|short|thumb)" >&2; usage 1;;
esac
[ "$SCENE" != film ] && Q=$([ "$PRESET" = short ] && echo "aspect=portrait" || echo "")     # the story scene has no film parameters
[ -n "$XQ" ] && Q="${Q:+$Q&}$XQ"
OUT="${OUT:-out/frames/$PRESET}"

CMD=("$PY" -u tools/farm.py --scene "$SCENE" --w "$W" --h "$H" --fps 24 --on "$ON" --fmt "$FMT" --out "$OUT" --q "$Q")
[ "$FMT" != png ] && CMD+=(--jpgq "$JQ")
[ "$SCENE" = film ] && [ -f data/shots.json ] && CMD+=(--shots data/shots.json)
[ -n "$FROM" ] && CMD+=(--t0 "$FROM"); [ -n "$TO" ] && CMD+=(--t1 "$TO")
[ -n "$ONLY" ] && CMD+=(--only "$ONLY"); [ -n "$PROCS" ] && CMD+=(--procs "$PROCS")
CMD+=("${EXTRA[@]}")

if [ "$SCENE" = film ] && [ ! -f data/timing.json ] && [ "$DRY" = 0 ]; then
  echo "WARNING: data/timing.json does not exist yet (the film reads it); the render will fail at build time" >&2
fi
echo "preset $PRESET: ${W}x${H} $FMT on $ON scene=$SCENE out=$OUT"
PLAN="$("$PY" tools/farm.py --scene "$SCENE" --w "$W" --h "$H" --fps 24 --on "$ON" --out "$OUT" --q "$Q" $([ "$SCENE" = film ] && [ -f data/shots.json ] && echo "--shots data/shots.json") ${FROM:+--t0 $FROM} ${TO:+--t1 $TO} ${ONLY:+--only $ONLY} --plan 2>&1 | head -1)"
echo "plan: $PLAN"
NR="$(echo "$PLAN" | sed -n 's/.*, \([0-9]*\) rendered.*/\1/p')"
[ -n "$NR" ] && "$PY" -c "n=$NR; s=$SPF; print(f'estimate: {n} frames x about {s} s = {n*s/3600:.1f} h on a quiet box (more while other jobs run)')"
if [ "$DRY" = 1 ]; then printf 'command:'; printf ' %q' "${CMD[@]}"; echo; exit 0; fi

mkdir -p "$OUT"
if ! HELD="$("$PY" tools/farm.py --lock-status --out "$OUT")"; then
  echo "REFUSED: another farm is already rendering into $OUT ($HELD). Watch it with: $PY tools/farm.py --status --out $OUT" >&2; exit 3
fi
LOG="out/farm_${PRESET}.log"; mkdir -p out
echo "=== $(date '+%F %T') $PRESET: ${CMD[*]}" >> "$LOG"
if [ "$FG" = 1 ]; then exec "${CMD[@]}" 2>&1 | tee -a "$LOG"; fi
nohup "${CMD[@]}" >> "$LOG" 2>&1 &
PID=$!; echo "$PID" > "$OUT/farm.pid"; sleep 2
if ! kill -0 "$PID" 2>/dev/null; then echo "the farm exited at once, see $LOG:" >&2; tail -5 "$LOG" >&2; exit 1; fi
cat <<MSG
started, pid $PID
  log:     tail -f $LOG
  status:  $PY tools/farm.py --status --out $OUT
  stop:    kill -TERM $PID     (finishes the current frame; run this same command again to resume)
  frames:  $OUT   (progress.json, missing.txt when something failed)
MSG
case "$PRESET" in
  review) echo "  then:    tools/encode_review.sh $OUT <audio.mp3> publish/zombie-couture_review.mp4";;
  master) echo "  then:    tools/encode_master.sh $OUT <audio.mp3> publish/zombie-couture.mp4 [--grain]";;
  short)  echo "  then:    tools/encode_short.sh $OUT <audio.mp3> $FROM 15 publish/zombie-couture_short.mp4";;
  thumb)  echo "  then:    python3 tools/thumbnail.py $OUT/f_$(printf %05d "$("$PY" -c "print(round($FROM*24))")").png";;
esac
