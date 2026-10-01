#!/bin/bash
# Split a big file into parts small enough for the desktop-link file copy (at most 20 MB each), keeping the file byte-exact.
#   tools/split_for_device.sh <file> <outdir> [--part-bytes 19000000]
# Writes <outdir>/p.000 p.001 ... and <outdir>/SHA256 (the checksum of the original, to compare after joining on the other side).
# The link's copy step stamps a provenance box into any file that starts like an MP4, so part 000 gets one extra zero byte in front
# (it no longer looks like an MP4); the joining side removes it with  tail -c +2 p.000 > first  and then  cat first p.001 p.002 ... > file
# For a file that is not an MP4 pass --no-prefix.
set -euo pipefail
PART=19000000; PREFIX=1; POS=()
while [ $# -gt 0 ]; do case "$1" in
  --part-bytes) PART="$2"; shift 2;; --no-prefix) PREFIX=0; shift;; -h|--help) sed -n 2,8p "$0"; exit 0;; *) POS+=("$1"); shift;; esac; done
[ ${#POS[@]} -eq 2 ] || { echo "usage: split_for_device.sh <file> <outdir> [--part-bytes N] [--no-prefix]" >&2; exit 2; }
FILE="${POS[0]}"; OUT="${POS[1]}"
[ -f "$FILE" ] || { echo "not found: $FILE" >&2; exit 2; }
mkdir -p "$OUT"; rm -f "$OUT"/p.* "$OUT"/SHA256
sha256sum "$FILE" | awk '{print $1}' > "$OUT/SHA256"
split -b "$PART" -d -a 3 "$FILE" "$OUT/p."
if [ "$PREFIX" = 1 ]; then
  { printf '\0'; cat "$OUT/p.000"; } > "$OUT/p.000.tmp" && mv "$OUT/p.000.tmp" "$OUT/p.000"
fi
N=$(ls "$OUT"/p.* | wc -l)
echo "split $FILE into $N parts in $OUT (sha256 $(cat "$OUT/SHA256" | cut -c1-16)...)$([ "$PREFIX" = 1 ] && echo ", part 000 has a one-byte prefix")"
