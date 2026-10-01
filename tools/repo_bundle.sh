#!/usr/bin/env bash
# Build the public copy of the project in publish/repo/ (a clean directory; no git operations, nothing is pushed) and scan it.
#
#   tools/repo_bundle.sh [--out publish/repo] [--with-lyrics] [--with-tests] [--repo-url URL] [--video-url URL]
#                        [--exclude PATH-GLOB]... [--allow-code-file PATH]...
#
# Contents: web/ tools/ docs/ (not docs/briefs/) assets/ (Fredoka One + OFL.txt made from the font's own name table; any other .ttf there, e.g. the
# thumbnail label's Barlow Condensed, gets its own OFL-<Family>.txt and a notice) analysis/ (code, README,
# requirements only: no models, no audio, no caches, no validation runs) data/storyboard.json (+ data/shots.json and data/short.json if they exist) package.json
# package-lock.json README.md (from publish/README.public.md + publish/credits.txt) LICENSE (MIT) THIRD_PARTY_NOTICES.md .gitignore.
#   --with-lyrics   also data/lyrics.txt and data/timing.json (the words of the song) and no lyric-dump check.  Default: the lyrics stay out.
#   --with-tests    also tests/ (fixtures and all)
#   --exclude       drop files from the bundle after copying (find -path glob relative to the bundle, e.g. 'tools/sheet_story.sh')
# The bundle is built in publish/.repo_stage, checked with tools/scan_repo.py, and moved to --out only if the scan is clean; on a failure the
# stage is kept as publish/repo.FAILED (for reading the findings) and the old --out is left alone.  Exit code 0 only for a clean bundle.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

OUT="publish/repo"; WITH_LYRICS=0; WITH_TESTS=0; REPO_URL=""; VIDEO_URL=""
EXCLUDES=(); ALLOW_CODE=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --out) OUT="$2"; shift 2 ;;
    --with-lyrics) WITH_LYRICS=1; shift ;;
    --with-tests) WITH_TESTS=1; shift ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --video-url) VIDEO_URL="$2"; shift 2 ;;
    --exclude) EXCLUDES+=("$2"); shift 2 ;;
    --allow-code-file) ALLOW_CODE+=("$2"); shift 2 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# --out must be a new or existing directory under publish/ (this script deletes what it finds there, except .git)
case "$OUT" in publish/*) ;; *) echo "--out must be inside publish/ (got $OUT)" >&2; exit 2 ;; esac
[[ "$OUT" != *..* ]] || { echo "--out must not contain .." >&2; exit 2; }
for f in publish/credits.txt publish/README.public.md publish/OFL-1.1.body.txt assets/FredokaOne-Regular.ttf package.json; do
  [[ -f "$f" ]] || { echo "missing $f" >&2; exit 2; }
done
[[ -d node_modules/three ]] || echo "note: node_modules/three is missing (npm install); the three.js notice will have no version" >&2

STAGE="publish/.repo_stage"; FAILED="publish/repo.FAILED"
rm -rf "$STAGE"; mkdir -p "$STAGE"

# copy the files named by NUL-separated relative paths on stdin into the stage (missing ones are skipped)
add() {
  local f list; list="$(mktemp)"
  while IFS= read -r -d '' f; do if [[ -f "$f" ]]; then printf '%s\0' "$f"; fi; done > "$list"
  tar --null -T "$list" -cf - | tar -C "$STAGE" -xf -
  rm -f "$list"
}
NOJUNK=( ! -path '*/__pycache__/*' ! -name '*.pyc' ! -name '.DS_Store' ! -name '*.swp' ! -name '*.log' )

find web tools docs -type f "${NOJUNK[@]}" ! -path 'docs/briefs/*' -print0 | add
find assets -type f \( -name '*.ttf' -o -name '*.otf' -o -name '*.woff2' \) -print0 | add
{ printf '%s\0' analysis/README.md analysis/requirements.txt analysis/run_audio.sh analysis/.gitignore
  find analysis/zcaudio -type f -name '*.py' "${NOJUNK[@]}" -print0
  find analysis/validation -maxdepth 1 -type f \( -name '*.py' -o -name '*.md' \) -print0; } | add
{ printf '%s\0' data/storyboard.json data/shots.json data/short.json package.json package-lock.json
  [[ $WITH_LYRICS == 1 ]] && printf '%s\0' data/lyrics.txt data/timing.json
  [[ $WITH_TESTS == 1 ]] && find tests -type f "${NOJUNK[@]}" -print0
  true; } | add

python3 - "$ROOT" "$STAGE" "$WITH_LYRICS" "$REPO_URL" "$VIDEO_URL" <<'PY'
import importlib.metadata as md, json, os, re, struct, sys
root, stage, with_lyrics, repo_url, video_url = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4], sys.argv[5]
os.chdir(root)
warn = []

def read(p):
    return open(p, encoding="utf-8", errors="replace").read()

def write(rel, text):
    p = os.path.join(stage, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)

# ---- the font: every fact comes from its name table
def name_table(path):
    b = open(path, "rb").read()
    n = struct.unpack(">H", b[4:6])[0]
    out = {}
    for i in range(n):
        tag, _, off, _ = struct.unpack(">4sIII", b[12 + 16 * i: 28 + 16 * i])
        if tag != b"name":
            continue
        cnt, so = struct.unpack(">HH", b[off + 2: off + 6])
        for j in range(cnt):
            pid, eid, lid, nid, ln, o = struct.unpack(">6H", b[off + 6 + 12 * j: off + 18 + 12 * j])
            raw = b[off + so + o: off + so + o + ln]
            try:
                s = raw.decode("utf-16-be") if pid in (0, 3) else raw.decode("mac_roman")
            except UnicodeDecodeError:
                continue
            if nid not in out or pid == 3:
                out[nid] = s
    return out

FONT = "assets/FredokaOne-Regular.ttf"
nt = name_table(FONT)
copyright_line, family, version = nt.get(0), nt.get(1), nt.get(5)
if not copyright_line or "SIL Open Font License" not in (nt.get(13) or ""):
    sys.exit(f"the font's name table has no copyright string or does not say SIL OFL: {nt}")
body = read("publish/OFL-1.1.body.txt").rstrip("\n") + "\n"
write("assets/OFL.txt", copyright_line + "\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n"
      "This license is copied below, and is also available with a FAQ at:\nhttp://scripts.sil.org/OFL\n\n\n" + body)
emails = re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", copyright_line)
open(os.path.join(stage, "..", ".stage_allow_email"), "w").write("".join(e + "\n" for e in emails))

# ---- the other fonts in assets/ (the thumbnail label's Barlow Condensed): one OFL-<Family>.txt per copyright string, read from the name table
import glob
extra_fonts = {}
for fp in sorted(glob.glob("assets/*.ttf")):
    if os.path.basename(fp) == os.path.basename(FONT):
        continue
    t = name_table(fp)
    if not t.get(0):
        sys.exit(f"{fp} has no copyright string in its name table, so no notice can be written for it")
    extra_fonts.setdefault(t[0], []).append((fp, t))
extra_text = ""
for cr, items in extra_fonts.items():
    fam = items[0][1].get(16) or items[0][1].get(1) or "Font"
    ofl_name = "OFL-" + re.sub(r"[^A-Za-z0-9]+", "", fam) + ".txt"
    write("assets/" + ofl_name, cr + "\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n"
          "This license is copied below, and is also available with a FAQ at:\nhttp://scripts.sil.org/OFL\n\n\n" + body)
    files = ", ".join(f"`{fp}`" for fp, _ in items)
    ver = items[0][1].get(5, "version not stated")
    extra_text += (f"\n**{fam}** ({files}, {ver}). Used only by `tools/thumbnail.py`, for the label on the thumbnail. Licence: SIL Open Font License 1.1, "
                   f"full text in `assets/{ofl_name}`. Copyright string from the fonts' name tables: \"{cr}\". These are the Latin subset of the Fontsource build "
                   f"(npm `@fontsource/barlow-condensed` 5.3.0, WOFF) saved as TrueType with fontTools; this project made no other change. The subset's name "
                   f"table carries no licence text, so the licence is the one stated in that package's LICENSE file.\n")

# ---- LICENSE, .gitignore
write("LICENSE", """MIT License

Copyright (c) 2026 Avenrae

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
""")
write(".gitignore", """node_modules/
out/
__pycache__/
*.pyc
.DS_Store
.env
# the song and everything derived from it stays local
*.mp3
*.wav
*.flac
*.m4a
data/audio/
analysis/models/
analysis/validation/*/
""")

# ---- the song's words stay out unless --with-lyrics: the generated shot tables quote the lyric lines, so they become a stub,
#      and the bundled data/shots.json loses its per-shot `text` (the rest of the shot list is unchanged)
if not with_lyrics:
    for rel in ("docs/SHOTS.md", "docs/SHOTS.mini.md"):
        if os.path.exists(os.path.join(stage, rel)):
            write(rel, "# Shot table\n\nThe generated shot table quotes the song's lyric lines, so it is not part of this repository. "
                       "`python3 tools/make_shots.py` rebuilds it (and `data/shots.json`) from `data/storyboard.json` and a timing file.\n")
    p = os.path.join(stage, "data", "shots.json")
    if os.path.exists(p):
        js = json.load(open(p, encoding="utf-8"))
        for s in js.get("shots", []):
            s.pop("text", None)
        with open(p, "w", encoding="utf-8") as f:
            f.write(json.dumps(js, indent=1, ensure_ascii=False) + "\n")

# ---- README: template + the credit lines exactly as publish/credits.txt has them
credits =[l.strip() for l in read("publish/credits.txt").splitlines() if l.strip()]
shot = next((p for p in ("publish/screenshot.jpg", "publish/screenshot.png", "publish/thumb.jpg") if os.path.exists(p)), None)
if shot:
    ext = os.path.splitext(shot)[1]
    os.makedirs(os.path.join(stage, "docs"), exist_ok=True)
    with open(shot, "rb") as a, open(os.path.join(stage, "docs", "screenshot" + ext), "wb") as b:
        b.write(a.read())
    shot_md = f"![Zombie Couture: a still from the film](docs/screenshot{ext})"
else:
    shot_md = "<!-- screenshot: put a still at docs/screenshot.jpg and point this line at it -->"
    warn.append("no publish/screenshot.jpg, screenshot.png or thumb.jpg: the README has a comment where the picture goes")
readme = read("publish/README.public.md")
readme = readme.replace("{{SCREENSHOT}}", shot_md).replace("{{CREDITS}}", "\n".join("* " + c for c in credits))
if video_url:
    readme = readme.replace("{{VIDEO_URL}}", video_url)
else:
    # no link yet, so no line that carries the placeholder (pass --video-url once the film is on YouTube); the blank line after it goes too
    readme = re.sub(r"^[^\n]*\{\{VIDEO_URL\}\}[^\n]*\n(?:[ \t]*\n)?", "", readme, flags=re.M)
readme = readme.replace("{{REPO_URL}}", repo_url or "{{REPO_URL}}")
write("README.md", readme)
for left in re.findall(r"\{\{[A-Z_]+\}\}", readme):
    warn.append(f"README.md still has {left} (pass --video-url / --repo-url, or edit by hand)")

# ---- third-party notices: only what can be read from the installed packages and the font
def dist_facts(name):
    try:
        d = md.distribution(name)
    except md.PackageNotFoundError:
        return None
    m = d.metadata
    lic = m.get("License-Expression") or ""
    if not lic:
        cls = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
        cls = [c for c in cls if c not in ("OSI Approved",)]
        lic = " / ".join(cls) or ((m.get("License") or "").strip().splitlines() or [""])[0][:80]
    copy = ""
    for f in d.files or []:
        if re.search(r"(?i)(^|/)(licen[sc]e|copying|notice)[^/]*$", str(f)):
            try:
                for line in f.read_text(errors="replace").splitlines():
                    if re.match(r"(?i)^\s*(copyright|\(c\)|©)", line):
                        copy = line.strip()
                        break
            except Exception:
                pass
        if copy:
            break
    return d.version, lic or "not stated in the package metadata", copy or "no copyright line in the installed distribution"

py = ["playwright", "Pillow", "numpy", "scipy", "contourpy"]
for line in read("analysis/requirements.txt").splitlines():
    m = re.match(r"^([A-Za-z0-9_.-]+)", line.strip())
    if m and not line.strip().startswith("#") and m.group(1).lower() not in [p.lower() for p in py]:
        py.append(m.group(1))
rows = []
for n in py:
    f = dist_facts(n)
    rows.append(f"| {n} | {f[0]} | {f[1]} | {f[2]} |" if f else f"| {n} | not installed on the build machine | not verified | not verified |")
    if f and re.search(r"(?i)\b(a?gpl|general public)", f[1]) and not re.search(r"(?i)lesser|lgpl", f[1]):
        warn.append(f"{n} {f[0]} is licensed {f[1]}: it stays a separate pip install (it is listed, not copied); do not copy it or its data into the repo")

npm_rows = []
pkg = json.load(open("package.json"))
for n in sorted(pkg.get("dependencies", {})):
    pj = f"node_modules/{n}/package.json"
    if not os.path.exists(pj):
        npm_rows.append(f"| {n} | not installed on the build machine | not verified | not verified |")
        continue
    j = json.load(open(pj))
    copy = ""
    for cand in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        p = f"node_modules/{n}/{cand}"
        if os.path.exists(p):
            copy = next((l.strip() for l in read(p).splitlines() if re.match(r"(?i)^\s*copyright", l)), "")
            break
    npm_rows.append(f"| {n} | {j.get('version')} | {j.get('license', 'not stated')} | {copy or 'no copyright line in the installed package'} |")

# has any third-party code been copied into the code directories?  A copied MIT/BSD/Apache file carries its copyright line, so look for those.
marker = re.compile(r"(?i)(copy" + r"right\s*(\(c\)|©|\d{4})|spdx-license|github\.com/|gitlab\.com/|shadertoy|stackoverflow|codepen|jsfiddle)")
hits = []
for base in ("web", "tools", "analysis"):
    for dp, dns, fns in os.walk(os.path.join(stage, base)):
        for fn in fns:
            p = os.path.join(dp, fn)
            rel = os.path.relpath(p, stage)
            if rel in ("tools/repo_bundle.sh", "tools/scan_repo.py") or not fn.endswith((".js", ".mjs", ".py", ".sh", ".html", ".css")):
                continue
            for i, line in enumerate(read(p).splitlines(), 1):
                if marker.search(line):
                    hits.append(f"{rel}:{i}")
                    break
if hits:
    provenance = ("**Check before publishing:** these files carry a copyright line, an SPDX tag or a link to a code host, which usually means borrowed code: "
                  + ", ".join(hits) + ". Add each source's licence text and copyright line to this file.")
    warn.append("possible borrowed code: " + ", ".join(hits))
else:
    provenance = ("No third-party source code has been copied into `web/`, `tools/` or `analysis/`. Basis, checked when this file was generated: "
                  "no file there carries a copyright line, an SPDX tag or a link to a code host, which any copied MIT, BSD or Apache code would. "
                  "`docs/PRIOR_ART.md` lists the public projects that were read for ideas and their licences. If code is copied from one of them later, "
                  "add its notice here.")

table = "| Package | Version | Licence | Copyright line as found |\n|---|---|---|---|\n"
notices = f"""# Third-party notices

This project's own code is MIT (see `LICENSE`). The components below are used at run time or build time. Versions, licences and copyright lines were read
from the packages installed on the build machine when this file was generated (`importlib.metadata` and the licence files inside each package, `node_modules`,
and the font's own name table); a cell that says "not verified" could not be read there.

## In the repository

**Fredoka One Regular** (`assets/FredokaOne-Regular.ttf`, {version}). Licence: SIL Open Font License 1.1, full text in `assets/OFL.txt`.
Copyright string from the font's name table: "{copyright_line}". The font is included unmodified.
{extra_text}
## npm (`package.json`)

{table}{chr(10).join(npm_rows)}

## Python (installed with pip, not included)

{table}{chr(10).join(rows)}

## Programs and files that are not included

* ffmpeg and ffprobe are called as external programs by `tools/encode_*.sh` and `tools/mux_check.py`. They are not bundled or linked.
* Chromium is downloaded by `playwright install chromium` and driven through Playwright. It is not bundled.
* The model weights that `analysis/` uses (vocal separation, speech recognition) are not part of this repository; each has its own licence. See `analysis/README.md`.
* The song is not part of this repository.{' The lyrics and the word timing derived from them are included (the bundle was built with --with-lyrics); they are not covered by the MIT licence.' if with_lyrics else ' Neither are its lyrics.'}

## Provenance of the code

{provenance}
"""
write("THIRD_PARTY_NOTICES.md", notices)
for w in warn:
    print("WARNING:", w)
print(f"notices: {len(npm_rows)} npm and {len(rows)} python packages, font {family} {version}")
PY

# --exclude: drop what the director does not want, and say so
for pat in "${EXCLUDES[@]+"${EXCLUDES[@]}"}"; do
  n="$(find "$STAGE" -path "$STAGE/$pat" | wc -l)"
  find "$STAGE" -path "$STAGE/$pat" -exec rm -rf {} +
  echo "excluded $pat ($n path(s))"
done

FILES="$(find "$STAGE" -type f | wc -l)"; SIZE="$(du -sh "$STAGE" | cut -f1)"
echo "staged $FILES files, $SIZE"

# the scan: any finding fails the bundle
ALLOW=()
if [[ -s publish/.stage_allow_email ]]; then while IFS= read -r e; do ALLOW+=(--allow-email "$e"); done < publish/.stage_allow_email; fi
for c in "${ALLOW_CODE[@]+"${ALLOW_CODE[@]}"}"; do ALLOW+=(--allow-code-file "$c"); done
[[ $WITH_LYRICS == 0 && -f data/lyrics.txt ]] && ALLOW+=(--lyrics data/lyrics.txt)
rm -f publish/.stage_allow_email
set +e
REPORT="$(python3 tools/scan_repo.py "$STAGE" "${ALLOW[@]+"${ALLOW[@]}"}" 2>&1)"
RC=$?
set -e
printf '%s\n' "$REPORT"
if [[ $RC -ne 0 ]]; then
  grep -q '\[lyrics\]' <<<"$REPORT" && echo "hint: [lyrics] means a file repeats the song's words. Publish them on purpose with --with-lyrics, or drop the file with --exclude." >&2
  rm -rf "$FAILED"; mv "$STAGE" "$FAILED"
  echo "BUNDLE FAILED: fix the files above (or drop them with --exclude PATH); the stage is in $FAILED, $OUT was not touched." >&2
  exit 1
fi

# clean: replace the old bundle but keep a .git the director may have created inside it
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
( cd "$STAGE" && tar -cf - . ) | tar -C "$OUT" -xf -
rm -rf "$STAGE" "$FAILED"
echo "BUNDLE OK: $OUT ($FILES files, $SIZE). Read README.md and THIRD_PARTY_NOTICES.md once, then git init / add / push yourself; this script never does."
