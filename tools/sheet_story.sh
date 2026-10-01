#!/bin/bash
# quick contact sheet of the story scene at several times
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
for t in "$@"; do
  timeout 200 python3 tools/shoot.py felt story out/cs_$t.png 640 360 "t=$t" 2>&1 | tail -1
done
