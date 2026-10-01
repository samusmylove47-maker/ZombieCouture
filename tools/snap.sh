#!/bin/bash
# Freeze the current tree for the long master render: the farm runs from a COPY (default: a folder "zc_snap" next to the repository folder), so edits, half-written files and syntax
# errors in the working tree can never reach a running render.  Run it only after `node web/film/smoke.mjs data/shots.json` says "no problems found",
# and only edit shots / code that has not been rendered yet (frames of a shot changed after its render must be deleted and rendered again).
#   tools/snap.sh [DEST]
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
DEST="${1:-$(dirname "$PWD")/zc_snap}"
node web/film/smoke.mjs data/shots.json 2>&1 | tail -1 | grep -q "no problems found" || { echo "smoke test failed, not snapshotting" >&2; exit 1; }
mkdir -p "$DEST/data" "$DEST/out"
# A running farm reloads its page from the snapshot every few hundred frames, so every folder is swapped in one rename (copy next to it first, then move):
# there is never a moment with a missing or half-copied web/, tools/ or assets/.
swap() { rm -rf "$DEST/$1.new" "$DEST/$1.old"; cp -a "$1" "$DEST/$1.new"; [ -e "$DEST/$1" ] && mv "$DEST/$1" "$DEST/$1.old"; mv "$DEST/$1.new" "$DEST/$1"; rm -rf "$DEST/$1.old"; }
swap web; swap tools; swap assets
for f in timing.json shots.json; do cp "data/$f" "$DEST/data/$f.new" && mv "$DEST/data/$f.new" "$DEST/data/$f"; done
[ -e "$DEST/node_modules" ] || ln -s "$(pwd)/node_modules" "$DEST/node_modules"
[ -f package.json ] && cp package.json "$DEST/"
echo "snapshot of $(git rev-parse --short HEAD 2>/dev/null || echo tree) at $(date '+%F %T') -> $DEST"
