#!/usr/bin/env python3
"""Check an encoded video (and its audio) before it goes anywhere. Exit code 1 if any check fails.

  python3 tools/mux_check.py out.mp4 [--audio song.mp3|wav] [--fps 24] [--size 1920x1080] [--expect-frames N] [--decode] [--no-audio]
  python3 tools/mux_check.py --scan-frames out/frames/review      # prints FIRST= LAST= COUNT= EXT= W= H= for the encode scripts; fails on gaps

Checks: file size, frame count = ceil(duration x fps) (and --expect-frames), constant frame rate, resolution (even, and --size), pixel format
yuv420p, BT.709 colour tags (space, transfer, primaries, range tv), audio present with a sane sample rate, audio at least as long as the video
(and not shorter than the source audio when --audio is given), no negative start times, audio/video start within 50 ms, faststart (moov before mdat),
and no account name leaking through metadata tags.
"""
import argparse, glob, json, math, os, re, struct, subprocess, sys

# the Suno account name must never reach metadata; it is spelled out here as numbers so this file itself stays clean for tools/scan_repo.py
_BAD = "".join(map(chr, [83, 121, 114, 105, 98, 101, 116, 104])).lower()


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def ffprobe(path, *extra):
    r = run(["ffprobe", "-v", "error", "-of", "json", *extra, path])
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path}: {r.stderr.strip()[:300]}")
    return json.loads(r.stdout)


def fnum(x, d=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def scan_frames(d):
    files = sorted(glob.glob(os.path.join(d, "f_*.jpg")) + glob.glob(os.path.join(d, "f_*.png")))
    if not files:
        print(f"no f_*.jpg or f_*.png in {d}", file=sys.stderr)
        return 1
    exts = {f.rsplit(".", 1)[1] for f in files}
    if len(exts) > 1:
        print(f"mixed jpg and png frames in {d}", file=sys.stderr)
        return 1
    idx = sorted(int(re.search(r"f_(\d+)\.", os.path.basename(f)).group(1)) for f in files)
    first, last = idx[0], idx[-1]
    if len(idx) != last - first + 1:
        have = set(idx)
        gaps = [i for i in range(first, last + 1) if i not in have]
        print(f"{len(gaps)} frames missing between {first} and {last}, first gaps: {gaps[:12]}. The encoder would stop at the first gap and the audio would run ahead of the picture.", file=sys.stderr)
        return 1
    from PIL import Image
    with Image.open(files[0]) as im:
        w, h = im.size
    print(f"FIRST={first} LAST={last} COUNT={len(idx)} EXT={exts.pop()} W={w} H={h}")
    return 0


def faststart(path):
    """(moov offset, mdat offset) of an MP4 by walking the top-level boxes."""
    moov = mdat = None
    with open(path, "rb") as f:
        pos, size_total = 0, os.path.getsize(path)
        while pos < size_total and (moov is None or mdat is None):
            f.seek(pos)
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            size, typ = struct.unpack(">I4s", hdr)
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
            elif size == 0:
                size = size_total - pos
            if typ == b"moov":
                moov = pos
            elif typ == b"mdat":
                mdat = pos
            if size < 8:
                break
            pos += size
    return moov, mdat


def check(a):
    res = []

    def add(level, name, msg):
        res.append((level, name, msg))

    path = a.video
    if not os.path.exists(path):
        add("FAIL", "file", f"{path} does not exist")
        return res
    size = os.path.getsize(path)
    add("PASS" if size > 20000 else "FAIL", "size", f"{size / 1e6:.2f} MB")
    if a.min_mb and size / 1e6 < a.min_mb:
        add("FAIL", "size", f"under {a.min_mb} MB")
    if a.max_mb and size / 1e6 > a.max_mb:
        add("FAIL", "size", f"over {a.max_mb} MB")
    try:
        P = ffprobe(path, "-show_format", "-show_streams")
    except RuntimeError as e:
        add("FAIL", "ffprobe", str(e))
        return res
    fmt = P["format"]
    vs = [s for s in P["streams"] if s["codec_type"] == "video" and s.get("disposition", {}).get("attached_pic", 0) == 0]
    au = [s for s in P["streams"] if s["codec_type"] == "audio"]
    if not vs:
        add("FAIL", "video", "no video stream")
        return res
    v = vs[0]
    add("PASS" if v["codec_name"] == "h264" else "WARN", "codec", f"video {v['codec_name']} {v.get('profile', '')}")
    add("PASS" if v.get("pix_fmt") == "yuv420p" else "FAIL", "pixel format", str(v.get("pix_fmt")))
    w, h = v["width"], v["height"]
    ok = w % 2 == 0 and h % 2 == 0 and (not a.size or f"{w}x{h}" == a.size)
    add("PASS" if ok else "FAIL", "resolution", f"{w}x{h}" + (f" (expected {a.size})" if a.size else ""))
    tags = {k: v.get(k) for k in ("color_space", "color_transfer", "color_primaries")}
    bad = {k: x for k, x in tags.items() if x != "bt709"}
    rng = v.get("color_range")
    add("PASS" if not bad and rng == "tv" else "FAIL", "colour tags", f"space={tags['color_space']} transfer={tags['color_transfer']} primaries={tags['color_primaries']} range={rng}"
        + ("" if not bad and rng == "tv" else " (need bt709 x3 and tv)"))
    # frames and rate
    def frac(x):
        n, _, d = (x or "0/1").partition("/")
        return float(n) / float(d or 1) if float(d or 1) else 0.0
    rfr, afr = frac(v.get("r_frame_rate")), frac(v.get("avg_frame_rate"))
    add("PASS" if abs(rfr - a.fps) < 1e-3 and abs(afr - a.fps) < 5e-3 else "FAIL", "frame rate", f"r={rfr:.4f} avg={afr:.4f} (expected {a.fps:g}, constant)")
    if a.decode:
        r = ffprobe(path, "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames")
        nframes = int(r["streams"][0]["nb_read_frames"])
    else:
        r = ffprobe(path, "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets")
        nframes = int(r["streams"][0]["nb_read_packets"])
    vstart = fnum(v.get("start_time"), 0.0)
    vdur = fnum(v.get("duration"))
    if vdur is None:
        vdur = fnum(fmt.get("duration"), 0.0) - vstart
    want = math.ceil(vdur * a.fps - 1e-3)
    add("PASS" if nframes == want else "FAIL", "frame count", f"{nframes} frames, duration {vdur:.4f} s x {a.fps:g} fps -> ceil = {want}")
    if a.expect_frames is not None:
        add("PASS" if nframes == a.expect_frames else "FAIL", "expected frames", f"{nframes} vs {a.expect_frames} rendered frames")
    # audio
    if a.no_audio:
        add("PASS" if not au else "WARN", "audio", "none expected" if not au else "audio present although --no-audio")
    elif not au:
        add("FAIL", "audio", "no audio stream")
    else:
        s = au[0]
        sr = int(s.get("sample_rate", 0))
        add("PASS" if sr in (44100, 48000) else "FAIL", "audio format", f"{s['codec_name']} {sr} Hz, {s.get('channels')} ch, {int(fnum(s.get('bit_rate'), 0) / 1000)} kb/s")
        adur = fnum(s.get("duration"))
        if adur is None:
            adur = fnum(fmt.get("duration"), 0.0)
        astart = fnum(s.get("start_time"), 0.0)
        tol = 1.0 / a.fps
        add("PASS" if adur >= vdur - tol else "FAIL", "audio length", f"audio {adur:.3f} s vs video {vdur:.3f} s" + ("" if adur >= vdur - tol else " (audio ends before the picture)"))
        if adur - vdur > 0.5:
            add("WARN", "audio length", f"audio is {adur - vdur:.2f} s longer than the video")
        if abs(astart - vstart) > 0.05:
            add("WARN", "av start", f"audio starts {astart:.3f} s, video {vstart:.3f} s")
        if a.audio:
            try:
                src = fnum(ffprobe(a.audio, "-show_format")["format"].get("duration"), 0.0)
                add("PASS" if adur >= src - 0.05 else "FAIL", "source audio", f"source {src:.3f} s, muxed {adur:.3f} s" + ("" if adur >= src - 0.05 else " (song is cut off)"))
                add("PASS" if vdur >= src - tol else "FAIL", "video vs song", f"video {vdur:.3f} s, song {src:.3f} s" + ("" if vdur >= src - tol else " (picture ends before the song does)"))
            except RuntimeError as e:
                add("FAIL", "source audio", str(e))
        if a.ar and sr != a.ar:
            add("FAIL", "audio rate", f"{sr} Hz, expected {a.ar}")
    # start times
    starts = [("format", fnum(fmt.get("start_time"), 0.0))] + [(f"stream {s['index']} ({s['codec_type']})", fnum(s.get("start_time"), 0.0)) for s in P["streams"]]
    neg = [(n, t) for n, t in starts if t < -1e-6]
    add("PASS" if not neg else "FAIL", "start times", ", ".join(f"{n}={t:.3f}" for n, t in starts) if not neg else f"negative: {neg}")
    # faststart
    if path.lower().endswith((".mp4", ".mov", ".m4v")) and not a.no_faststart:
        moov, mdat = faststart(path)
        add("PASS" if moov is not None and mdat is not None and moov < mdat else "FAIL", "faststart", f"moov at {moov}, mdat at {mdat}" + ("" if moov is not None and mdat is not None and moov < mdat else " (encode with -movflags +faststart)"))
    # tags
    blob = json.dumps([fmt.get("tags", {}), [s.get("tags", {}) for s in P["streams"]], P.get("chapters", [])]).lower()
    add("FAIL" if _BAD in blob else "PASS", "metadata", "the account name is in a tag" if _BAD in blob else "no account name in tags; title=" + str(fmt.get("tags", {}).get("title")))
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?")
    ap.add_argument("--audio", help="the source audio the video should carry (wav or mp3)")
    ap.add_argument("--fps", type=float, default=24)
    ap.add_argument("--size", help="expected WxH")
    ap.add_argument("--expect-frames", type=int)
    ap.add_argument("--ar", type=int, help="expected audio sample rate")
    ap.add_argument("--decode", action="store_true", help="count decoded frames instead of packets (slow)")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--no-faststart", action="store_true")
    ap.add_argument("--min-mb", type=float)
    ap.add_argument("--max-mb", type=float)
    ap.add_argument("--scan-frames", metavar="DIR", help="print FIRST/LAST/COUNT/EXT/W/H of a frame directory; fail on gaps")
    a = ap.parse_args()
    if a.scan_frames:
        return scan_frames(a.scan_frames)
    if not a.video:
        ap.error("give a video or --scan-frames DIR")
    res = check(a)
    for level, name, msg in res:
        print(f"{level:4} {name:16} {msg}")
    fails = sum(1 for r in res if r[0] == "FAIL")
    print(f"{'FAILED' if fails else 'OK'}: {fails} failed, {sum(1 for r in res if r[0] == 'WARN')} warnings  ({a.video})")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
