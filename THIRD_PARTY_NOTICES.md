# Third-party notices

This project's own code is MIT (see `LICENSE`). The components below are used at run time or build time. Versions, licences and copyright lines were read
from the packages installed on the build machine when this file was generated (`importlib.metadata` and the licence files inside each package, `node_modules`,
and the font's own name table); a cell that says "not verified" could not be read there.

## In the repository

**Fredoka One Regular** (`assets/FredokaOne-Regular.ttf`, Version 1.001). Licence: SIL Open Font License 1.1, full text in `assets/OFL.txt`.
Copyright string from the font's name table: "Copyright (c) 2011 Milena B Brandao (milenabbrandao@gmail.com), with Reserved Font Name "Fredoka"". The font is included unmodified.

## npm (`package.json`)

| Package | Version | Licence | Copyright line as found |
|---|---|---|---|
| three | 0.170.0 | MIT | Copyright © 2010-2024 three.js authors |

## Python (installed with pip, not included)

| Package | Version | Licence | Copyright line as found |
|---|---|---|---|
| playwright | 1.56.0 | Apache-2.0 | no copyright line in the installed distribution |
| Pillow | 12.2.0 | MIT-CMU | no copyright line in the installed distribution |
| numpy | 2.4.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | no copyright line in the installed distribution |
| scipy | 1.17.1 | BSD License | no copyright line in the installed distribution |
| contourpy | 1.3.3 | BSD License | no copyright line in the installed distribution |
| soundfile | 0.14.0 | BSD License | no copyright line in the installed distribution |
| librosa | 0.11.0 | ISC License (ISCL) | no copyright line in the installed distribution |
| matplotlib | 3.10.9 | Python Software Foundation License | no copyright line in the installed distribution |
| onnxruntime | 1.25.0 | MIT License | no copyright line in the installed distribution |
| sherpa-onnx | 1.13.8 | Apache licensed, as found in the LICENSE file | no copyright line in the installed distribution |
| audio-separator | 0.47.0 | MIT License | no copyright line in the installed distribution |
| cmudict | 1.1.3 | GNU General Public License v3 or later (GPLv3+) | no copyright line in the installed distribution |

## Programs and files that are not included

* ffmpeg and ffprobe are called as external programs by `tools/encode_*.sh` and `tools/mux_check.py`. They are not bundled or linked.
* Chromium is downloaded by `playwright install chromium` and driven through Playwright. It is not bundled.
* The model weights that `analysis/` uses (vocal separation, speech recognition) are not part of this repository; each has its own licence. See `analysis/README.md`.
* The song is not part of this repository. Neither are its lyrics.

## Provenance of the code

No third-party source code has been copied into `web/`, `tools/` or `analysis/`. Basis, checked when this file was generated: no file there carries a copyright line, an SPDX tag or a link to a code host, which any copied MIT, BSD or Apache code would. `docs/PRIOR_ART.md` lists the public projects that were read for ideas and their licences. If code is copied from one of them later, add its notice here.
