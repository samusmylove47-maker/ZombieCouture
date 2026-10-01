# Publishing checklist (from the mp3 to the upload)

Every command is run from the repository root. Long jobs run in the background (`nohup`, log file) and are polled; a stopped or crashed render is resumed by running the same command again. Run times are estimates from the cost table in `docs/ENGINE.md` and from encodes measured while the machine was loaded (2 cores, load 5 to 6); read the real rate from `--status` after the first minutes. Do not edit `web/` while a review or master render is running: every frame is a pure function of the code, so a change halfway through changes the look halfway through.

## 0. Before anything

- [ ] `uptime` shows a load under 2 (other jobs share the two cores); `df -h .` shows more than 10 GB free (estimates: 720p jpg frames are about 0.3 MB each, so 1.3 GB for the review; 1080p jpg about 1 MB each, so 2 GB for the rendered frames and twice that with the repeated frames as copies; add `-- --link` to hard-link them; png frames are several times bigger).
- [ ] `python3 tools/farm.py --out out/frames/review --lock-status` says no farm is running there (the lock is per output folder; `pgrep -af "[f]arm.py"` shows all farms).
- [ ] The song is `data/song.mp3` (git-ignored). File names, tags and folders never carry the Suno account name (`mux_check` and `scan_repo` fail if they do).

## 1. Analysis and shots (see `docs/NEXT.md` steps 1 to 5)

- [ ] `analysis/run_audio.sh data/song.mp3` (about 6 min first run). Read the summary; open `data/audio/sheet.html`; pin fixes in `data/overrides.json`, rerun `--stages 7,8`. Lands: `data/timing.json`, `data/audio/`.
- [ ] `python3 tools/make_shots.py` then `python3 tools/qa_shots.py`. Zero errors; read the warnings. Lands: `data/shots.json`, `docs/SHOTS.md`.
- [ ] Contact sheets: `tools/rq.sh python3 -u tools/sheet_shots.py`, then look at `out/sheets/sheet_*.png`. Nothing long is rendered before the sheets have been read.

## 2. Review render (720p, on twos; optional)

The film is Motion = Ones and the 1080p master is rendered shot by shot while the film is finished (`tools/master_driver.sh`, `docs/NEXT.md` section 2), so this separate cheap look-through was not used for the real film: the 720p copy written by `encode_master.sh` is the review cut. Steps 2 and 3 are still correct for a project that wants one.

- [ ] `tools/render_all.sh review` (about 2 h; `--dry-run` prints the plan and the estimate). Log: `out/farm_review.log`. Poll: `python3 tools/farm.py --out out/frames/review --status`.
- [ ] Exit state: `done: N/N frames`. If frames are missing, `out/frames/review/missing.txt` lists them; run the same command again. Exit codes: 0 complete, 1 frames missing (or bad options: read the message), 2 the page failed to build (the log has the JavaScript error; fix the code, rerun), 3 eight frames failed in a row, 75 another farm holds the folder, 143 stopped by a signal.
- [ ] `python3 tools/qa_frames.py out/frames/review --shots data/shots.json --twos`: no blank, frozen, jump or flash errors.
- [ ] `tools/encode_review.sh out/frames/review data/song.mp3 out/review.mp4` (about 12 min). It runs `mux_check`: all PASS (frame count = ceil(duration x fps), BT.709 tags, audio at least as long as the song, faststart, no name in the tags).
- [ ] Watch `out/review.mp4` with sound; note fixes; rerender only the shots that changed: `tools/render_all.sh review --only <shot ids>` then the encode again.

## 3. Master (1080p) and share copy

- [ ] Freeze the tree (no edits to `web/`, `data/`). Either `tools/render_all.sh master` (every frame, Motion = Ones: 4,248 frames at 7 to 12 s each on this box, so 8 to 14 h; jpg q0.97 by default, `--fmt png` for a lossless master) or the driver that renders shots as they are finished (`nohup tools/master_driver.sh >> out/master_driver.log 2>&1 &`, see `docs/NEXT.md`).
- [ ] `python3 tools/qa_frames.py out/frames/master --shots data/shots.json` (no `--twos`: the master is on ones).
- [ ] `tools/encode_master.sh out/frames/master data/song.mp3 out/zombie-couture_master.mp4 [--grain]` (crf 16, AAC 320k; also writes `out/zombie-couture_master_720p.mp4`; about 40 min on a loaded box; `--grain` keeps the film grain and makes the file much bigger: a 10 s test came out at 43 MB, the 720p copy at 16 MB). The upload file is the master; the 720p copy is for sending around.
- [ ] `python3 tools/mux_check.py out/zombie-couture_master.mp4 --audio data/song.mp3 --size 1920x1080` is OK (the encode script already ran it).

## 4. Shorts (9:16, 15 s)

- [ ] Pick a bar-aligned window at the strongest chorus: `python3 tools/thumbnail.py --pick` lists chorus shots and times.
- [ ] `tools/render_all.sh short --from <start_s>` (native portrait, 15 s on ones = 360 frames, about 45 to 60 min), then `tools/encode_short.sh out/frames/short data/song.mp3 <start_s> 15 out/zombie-couture_short.mp4`. Fallback without a portrait render: `tools/encode_short.sh out/frames/master data/song.mp3 <start_s> 15 out/zombie-couture_short.mp4 --crop` (soft, centre slice).

## 5. Thumbnail

- [ ] The director picks the frame from `--pick`. `tools/render_all.sh thumb --from <t>` renders one smooth 1920x1080 png (about a minute, mostly page start-up), then `python3 tools/thumbnail.py out/frames/thumb/f_*.png`. Lands: `publish/thumb.png` (1280x720), `publish/thumb_1080.png`, `publish/thumb.jpg` (under 2 MB, the upload file), `publish/thumb_320.png`.
- [ ] Look at it at full size and at 320x180: the title reads, the ribbon tag reads, nothing important sits under the timestamp corner. `--pos`, `--tag`, `--text`, `--tilt` adjust it.

## 6. Captions

- [ ] `python3 tools/make_srt.py --timing data/timing.json --out publish/zombie-couture.srt` (`--moans` adds italic sound cues from the vocalizations), then `python3 tools/make_srt.py --check publish/zombie-couture.srt`: no overlaps, at most 2 lines of 42 characters, nothing under 0.9 s, cues start 50 ms before the word. Upload as the English track.

## 7. Description

- [ ] `python3 tools/make_description.py --timing data/timing.json --repo-url <repo url>` writes `publish/description.md` (three titles, hook, chapters, credits from `publish/credits.txt`, tags, pinned comment, upload checklist). The script checks the chapters (first at 0:00, at least three, each at least 10 s), the 5000 character limit and the hashtag count. The director edits the words.
- [ ] The four credit lines are exactly the ones in `publish/credits.txt`.

## 8. Repository

- [ ] `tools/repo_bundle.sh --video-url <url>` builds `publish/repo/` and runs `tools/scan_repo.py` on it. A finding stops the bundle and leaves the stage in `publish/repo.FAILED`. Fix the file, or drop it with `--exclude`. `[lyrics]` findings mean a file repeats the song's words: `--with-lyrics` publishes them on purpose (and adds `data/lyrics.txt` and `data/timing.json`).
- [ ] Read `publish/repo/README.md` and `THIRD_PARTY_NOTICES.md` once (the notices list what could be verified and say "not verified" for the rest). Then `git init`, add, commit and push by hand; the scripts never touch git.

## 9. Last look before upload

- [ ] `python3 tools/mux_check.py <each mp4>` is OK. Play the first and last 10 s of the master with sound: the picture must not end before the song, and the end card must show all four credit lines.
- [ ] Upload: master mp4, `publish/thumb.jpg`, `publish/zombie-couture.srt`, title and description from `publish/description.md`, pinned comment. Short: its own upload with `#Shorts`.

## Where things land

| What | Where |
|---|---|
| frames | `out/frames/{review,master,short,thumb}/f_%05d.jpg` (number = round(t x 24)); state in `progress.json`, `run.json`, `missing.txt` in the same folder |
| farm logs | `out/farm_<preset>.log` |
| videos | `out/review.mp4`, `out/zombie-couture_master.mp4`, `..._master_720p.mp4`, `out/zombie-couture_short.mp4` |
| thumbnail, captions, description | `publish/thumb*.png|jpg`, `publish/zombie-couture.srt`, `publish/description.md` |
| public repository | `publish/repo/` |

## When something goes wrong

- A stuck or slow farm: `python3 tools/farm.py --out <dir> --status` shows progress and the estimate; `--out <dir> --lock-status` names the owner. Stop it with `pkill -TERM -f "[f]arm.py"` (the workers finish or drop the frame in progress; nothing half-written is left) and start it again later.
- Frames that look wrong, or a changed storyboard or timing: the farm skips a frame that exists and is intact; it does not know what it shows. Rerender the changed shots with `tools/render_all.sh <preset> --only <shot ids> -- --force`, or empty the folder for a full rerun.
- `--procs 2` is only worth trying on a quiet machine; the default is one worker. Compare the s/frame in `--status` for a few minutes each.
- The encode stops with "frames missing between": a gap in the frame numbers; `missing.txt` has them. The encoder would otherwise stop at the gap and the audio would run ahead of the picture.
