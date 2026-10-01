#!/usr/bin/env python3
"""Subtitles for the video: one cue per lyric line (two cues for a long line), timed from timing.json.

  python3 tools/make_srt.py [--timing data/timing.json] [--out publish/zombie-couture.srt] [--moans] [--max-chars 42]
  python3 tools/make_srt.py --check publish/zombie-couture.srt [--timing data/timing.json]     # parse and validate an existing file

Rules: cue start = line t0 - 0.05 s (never before the previous cue's end); end = line t1 + 0.35 s (never past the next cue's start);
minimum 0.9 s; at most 2 text lines of at most 42 characters. A line longer than 42 characters is split into two cues at a comma or dash
near the middle, else at the middle word, and each half is timed by its own words. Ellipses and em dashes stay as written.
--moans adds italic (moans) cues for long vocalizations in the bridge and outro. The file is checked after it is written; exit code 1 on any error.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
LEAD, TAIL, MIN_DUR = 0.05, 0.35, 0.9
TIME_RE = re.compile(r"^(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)$")


def fmt_t(t):
    ms = max(0, int(round(t * 1000)))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def norm_word(s):
    return re.sub(r"[^a-z0-9']", "", s.lower().replace("’", "'"))


def wrap_two(text, maxc):
    """Break text into at most two lines of at most maxc characters, as balanced as possible (prefer a comma near the middle)."""
    if len(text) <= maxc:
        return [text]
    best, mid = None, len(text) / 2
    for m in re.finditer(r"\s+", text):
        a, b = text[:m.start()].rstrip(), text[m.end():].lstrip()
        if not a or not b or len(a) > maxc or len(b) > maxc:
            continue
        score = abs(len(a) - mid) - (6 if a.endswith((",", ";", ":", "—", "…", ".", "?", "!")) else 0)
        if best is None or score < best[0]:
            best = (score, [a, b])
    return best[1] if best else [text[:maxc], text[maxc:].lstrip()]


def split_points(tokens, maxc):
    """Index k (1..len-1) after which to split the tokens: a comma or dash close to the middle, else the middle word."""
    text = " ".join(tokens)
    mid = len(text) / 2
    best, pos = None, 0
    for k, tok in enumerate(tokens[:-1], 1):
        pos += len(tok) + (1 if k > 1 else 0)
        punct = tok.endswith((",", ";", ":", "—", "…", "?", "!", ".")) or tokens[k] == "—"
        score = abs(pos - mid) - (8 if punct else 0)
        if best is None or score < best[0]:
            best = (score, k)
    return best[1]


def line_words(T, line):
    ws = T["words"][line["word0"]:line["word1"]]
    return [w for w in ws if w.get("t1", 0) >= w.get("t0", 0)]


def align_tokens(tokens, ws):
    """For every text token, the matching word (or None for tokens like a lone dash). Greedy, in order."""
    out, j = [], 0
    for tok in tokens:
        n = norm_word(tok)
        if not n:
            out.append(None)
            continue
        hit = None
        for jj in range(j, min(j + 3, len(ws))):
            wn = norm_word(ws[jj].get("n") or ws[jj].get("w", ""))
            if wn == n or norm_word(ws[jj].get("w", "")) == n:
                hit = jj
                break
        if hit is None and j < len(ws):
            hit = j                     # spelling differs (e.g. braaains): assume the next word
        if hit is None:
            out.append(None)
        else:
            out.append(ws[hit])
            j = hit + 1
    return out


def build_cues(T, maxc, moans=False, moan_min=1.0):
    cues = []
    for line in T["lines"]:
        text = re.sub(r"\s+", " ", line["text"]).strip()
        if not text:
            continue
        ws = line_words(T, line)
        t0, t1 = line["t0"], line["t1"]
        tokens = text.split(" ")
        if len(text) <= maxc or len(tokens) < 3:
            cues.append({"text": "\n".join(wrap_two(text, maxc)), "a": t0, "b": t1, "line": line["id"]})
            continue
        k = split_points(tokens, maxc)
        first, second = " ".join(tokens[:k]), " ".join(tokens[k:])
        al = align_tokens(tokens, ws)
        w1 = [w for w in al[:k] if w]
        w2 = [w for w in al[k:] if w]
        if w1 and w2:
            a1, b1, a2, b2 = w1[0]["t0"], w1[-1]["t1"], w2[0]["t0"], w2[-1]["t1"]
        else:
            frac = len(first) / len(text)
            a1, b2 = t0, t1
            b1 = a2 = t0 + (t1 - t0) * frac
        cues.append({"text": "\n".join(wrap_two(first, maxc)), "a": min(a1, t0) if w1 else a1, "b": b1, "line": line["id"]})
        cues.append({"text": "\n".join(wrap_two(second, maxc)), "a": a2, "b": max(b2, t1) if w2 else b2, "line": line["id"]})
    cues.sort(key=lambda c: c["a"])
    out = []
    n = len(cues)
    for i, c in enumerate(cues):
        nominal_next = cues[i + 1]["a"] - LEAD if i + 1 < n else float("inf")
        start = max(0.0, c["a"] - LEAD)
        if out:
            start = max(start, out[-1]["end"])
        end = min(c["b"] + TAIL, nominal_next)
        if end - start < MIN_DUR:
            end = min(start + MIN_DUR, nominal_next)
        if end - start < MIN_DUR:                     # still short: take the free time before the cue
            floor = out[-1]["end"] if out else 0.0
            start = max(floor, end - MIN_DUR)
        out.append({"text": c["text"], "start": start, "end": end, "line": c["line"], "a": c["a"], "b": c["b"]})
    if moans:
        out = add_moans(T, out, moan_min)
    return out


def add_moans(T, cues, moan_min):
    zones = [(s["start"], s["end"]) for s in T.get("sections", []) if s.get("kind") in ("outro", "bridge")]
    zones += [(i["t0"], i["t1"]) for i in T.get("instrumentals", []) if i.get("where") == "outro"]
    extra = []
    for v in T.get("vocalizations", []):
        if v["t1"] - v["t0"] < moan_min or not any(a - 0.5 <= v["t0"] <= b for a, b in zones):
            continue
        prev_end = max([c["end"] for c in cues if c["end"] <= v["t1"]] + [0.0])
        next_start = min([c["start"] for c in cues if c["start"] >= v["t0"]] + [1e9])
        start, end = max(v["t0"], prev_end), min(v["t1"] + 0.1, next_start)
        if end - start >= MIN_DUR:
            extra.append({"text": "<i>(moans)</i>", "start": start, "end": end, "line": "moan", "a": v["t0"], "b": v["t1"]})
    return sorted(cues + extra, key=lambda c: c["start"])


def render(cues):
    blocks = [f"{i}\n{fmt_t(c['start'])} --> {fmt_t(c['end'])}\n{c['text']}\n" for i, c in enumerate(cues, 1)]
    return "\n".join(blocks)


# --------------------------------------------------------------------------------------------- parser and checks
def parse_srt(text):
    """Returns (cues, errors). cue = {n, start, end, lines}."""
    errors, cues = [], []
    if text.startswith("﻿"):
        errors.append("file starts with a byte order mark")
        text = text[1:]
    blocks = re.split(r"\n\s*\n", text.strip("\n").replace("\r\n", "\n"))
    for bi, b in enumerate(blocks, 1):
        lines = b.split("\n")
        if len(lines) < 3:
            errors.append(f"block {bi}: needs number, time line and text")
            continue
        if not lines[0].strip().isdigit():
            errors.append(f"block {bi}: cue number expected, got {lines[0]!r}")
            continue
        m = TIME_RE.match(lines[1].strip())
        if not m:
            errors.append(f"cue {lines[0]}: bad time line {lines[1]!r}")
            continue
        g = list(map(int, m.groups()))
        s = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        e = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        cues.append({"n": int(lines[0]), "start": s, "end": e, "lines": lines[2:]})
    return cues, errors


def check_cues(cues, errors, maxc=42, T=None):
    errs = list(errors)
    plain = lambda s: re.sub(r"</?[a-z]+>", "", s)
    for i, c in enumerate(cues):
        tag = f"cue {c['n']} ({fmt_t(c['start'])})"
        if c["n"] != i + 1:
            errs.append(f"{tag}: numbered {c['n']}, expected {i + 1}")
        if c["end"] <= c["start"]:
            errs.append(f"{tag}: ends before it starts")
        elif c["end"] - c["start"] < MIN_DUR - 0.0015:
            errs.append(f"{tag}: only {c['end'] - c['start']:.2f} s long (minimum {MIN_DUR})")
        if i and c["start"] < cues[i - 1]["end"] - 0.0005:
            errs.append(f"{tag}: overlaps the previous cue by {cues[i - 1]['end'] - c['start']:.3f} s")
        if not 1 <= len(c["lines"]) <= 2:
            errs.append(f"{tag}: {len(c['lines'])} text lines (1 or 2 allowed)")
        for ln in c["lines"]:
            if not plain(ln).strip():
                errs.append(f"{tag}: empty text line")
            if len(plain(ln)) > maxc:
                errs.append(f"{tag}: line of {len(plain(ln))} characters: {ln!r}")
            if "..." in ln or "--" in ln:
                errs.append(f"{tag}: ASCII '...' or '--' where … or — is meant: {ln!r}")
    if T:
        allt = re.sub(r"\s+", " ", " ".join(" ".join(c["lines"]) for c in cues if "(moans)" not in " ".join(c["lines"])))
        for line in T["lines"]:
            want = re.sub(r"\s+", " ", line["text"]).strip()
            if want and want not in allt:
                errs.append(f"lyric line {line['id']} is not in the cues as written: {want!r}")
            hit = [c for c in cues if c["start"] <= line["t1"] and c["end"] >= line["t0"]]
            if want and not hit:
                errs.append(f"lyric line {line['id']} ({line['t0']:.2f}-{line['t1']:.2f}) has no cue on screen while it is sung")
    return errs


def check_file(path, T=None, maxc=42):
    try:
        text = open(path, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError) as e:
        return [f"cannot read {path} as UTF-8: {e}"], []
    cues, errors = parse_srt(text)
    return check_cues(cues, errors, maxc, T), cues


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--timing", default=None)
    ap.add_argument("--out", default=os.path.join(ROOT, "publish", "zombie-couture.srt"))
    ap.add_argument("--moans", action="store_true")
    ap.add_argument("--moan-min", type=float, default=1.0, help="shortest vocalization that gets a (moans) cue, seconds")
    ap.add_argument("--max-chars", type=int, default=42)
    ap.add_argument("--check", nargs="?", const="", default=None, metavar="FILE", help="validate FILE (default: --out) and exit")
    a = ap.parse_args()
    tp = a.timing
    if not tp:
        for c in ("data/timing.json", "data/timing.standin.json"):
            if os.path.exists(os.path.join(ROOT, c)):
                tp = os.path.join(ROOT, c)
                break
    T = json.load(open(tp)) if tp and os.path.exists(tp) else None
    if a.check is not None:
        f = a.check or a.out
        errs, cues = check_file(f, T, a.max_chars)
        for e in errs:
            print("ERROR", e)
        print(f"{'FAILED' if errs else 'OK'}: {len(cues)} cues in {f}" + (f", checked against {os.path.relpath(tp, ROOT)}" if T else ", no timing file to compare with"))
        return 1 if errs else 0
    if not T:
        print("no timing file: give --timing data/timing.json", file=sys.stderr)
        return 2
    if "standin" in os.path.basename(tp):
        print(f"note: using the stand-in timing {os.path.relpath(tp, ROOT)}; run again with the real data/timing.json", file=sys.stderr)
    cues = build_cues(T, a.max_chars, a.moans, a.moan_min)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(cues))
    errs, parsed = check_file(a.out, T, a.max_chars)
    for e in errs:
        print("ERROR", e)
    nm = sum(1 for c in cues if c["line"] == "moan")
    print(f"wrote {a.out}: {len(cues)} cues ({nm} moans), {'FAILED the check' if errs else 'check OK'}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
