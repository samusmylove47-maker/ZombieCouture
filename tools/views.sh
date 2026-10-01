#!/bin/bash
# usage: tools/views.sh <prefix> <w> <h> <sid> <specfile>   (one view per line: label|p|{json}; lines starting with # are skipped)
# Renders several views of one shot in one page load (tools/argtry.py) through the render queue.  See docs/FILM_RUNTIME.md 9.6 for the special JSON keys.
prefix=$1; w=$2; h=$3; sid=$4; f=$5
mapfile -t V < <(grep -v '^\s*#' "$f" | grep -v '^\s*$')
cd "$(dirname "$0")/.." && exec timeout 900 tools/rq.sh python3 -u tools/argtry.py "$prefix" "$w" "$h" "$sid" "${V[@]}"
