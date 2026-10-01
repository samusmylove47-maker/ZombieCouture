#!/bin/bash
# Keeps the 1080p master farm busy for the whole build: renders every shot listed in data/ready.txt (ids, one per line or comma separated) that is not complete yet,
# from the frozen copy made by tools/snap.sh, into out/frames/master of the project.  Re-reads the list after every pass, so shots can be added while it runs.
#   nohup tools/master_driver.sh >> out/master_driver.log 2>&1 &        stop: touch out/master_driver.stop  (or kill it; the farm resumes)
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; SNAP="${ZC_SNAP:-$(dirname "$SRC")/zc_snap}"; OUT="$SRC/out/frames/master"
mkdir -p "$OUT"
while [ ! -e "$SRC/out/master_driver.stop" ]; do
  IDS="$(tr ',\n ' '\n\n\n' < "$SRC/data/ready.txt" 2>/dev/null | sed '/^$/d' | paste -sd, -)"
  if [ -z "$IDS" ]; then sleep 60; continue; fi
  echo "=== $(date '+%F %T') pass over: $IDS"
  ( cd "$SNAP" && tools/render_all.sh master --foreground --out "$OUT" --only "$IDS" ) 2>&1 | grep -v '^$' | tail -n 25
  sleep 30
done
echo "stopped $(date '+%F %T')"
