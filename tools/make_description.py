#!/usr/bin/env python3
"""Writes publish/description.md: title options, the YouTube description with chapters from timing.json, tags, pinned comment, checklist.

  python3 tools/make_description.py [--timing data/timing.json] [--out publish/description.md] [--repo-url URL]

The credit lines are read from publish/credits.txt (the four exact lines); nothing here spells them out.
{{REPO_URL}} stays a placeholder until --repo-url is given. Chapters follow YouTube's rules: first at 0:00, at least three, each at least 10 s.
Exit code 1 when a rule fails (chapters, description or tag length, credit lines).
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

FLAVOUR = {
    "intro1": "Intro", "verse1": "Verse 1 — barricaded in the mall", "prechorus1": "Pre-chorus — help us look cute",
    "chorus1": "Chorus — zombie couture", "verse2": "Verse 2 — the fitting room", "prechorus2": "Pre-chorus 2 — catwalk struts",
    "chorus2": "Chorus 2 — the mall wakes up", "bridge1": "Bridge — tea party", "chorus3": "Final chorus — forevermore",
    "outro1": "Outro — the care label",
}
KIND = {"intro": "Intro", "verse": "Verse", "prechorus": "Pre-chorus", "chorus": "Chorus", "postchorus": "Post-chorus", "bridge": "Bridge",
        "break": "Break", "outro": "Outro", "instrumental": "Instrumental", "spoken": "Spoken", "other": "Section"}

HOOK = "The zombies didn't want brains. They wanted a fitting."
HOOK_ALTS = [
    "Nobody warned me the apocalypse would come with a dress code.",
    "A dead grey mall, one sewing machine, and a very polite crowd of the undead.",
    "Apocalypse fashion: can't be beat.",
]
WHAT = ("Zombie Couture is an animated music video for a bubblegum-pop song about the end of the world going surprisingly well. "
        "A survivor barricaded in a dead grey shopping mall opens the door to the undead, and instead of biting they ask for a makeover. "
        "A pink stitch front spreads out from her sewing machine, sewing the colour back into the mall, and every zombie it reaches is made over "
        "into a couture doll: prom dresses, tulle, lace collars, bows.")
HOW = ("Everything on screen is procedural 3D in a felt-and-thread style, built in the browser with three.js and rendered frame by frame "
       "(every one of the 4,248 frames at 24 fps) in headless Chromium on a CPU-only two-core machine: no GPU, no downloaded models, no keyframed assets. "
       "The animation and every line of code were written by Claude Sonnet 5.5, in Claude.ai. An independent project, not an official Anthropic production.")
HASHTAGS = ["#ZombieCouture", "#Halloween", "#AIMusic", "#FeltAnimation", "#Suno"]
TITLES = [
    "Zombie Couture — a felt-and-thread music video where the undead get makeovers",
    "Zombie Couture (Music Video) — sewing a dead mall back to life, one zombie at a time",
    "Zombie Couture — the apocalypse, but make it pastel (animated music video)",
]
TAGS = ["zombie couture", "zombie music video", "halloween music video", "halloween song", "cute zombies", "kawaii zombie", "pastel zombie",
        "felt animation", "felt puppet animation", "procedural animation", "three.js", "ai music video", "suno v5", "ai generated music",
        "ai animation", "claude ai", "bubblegum pop", "sewing machine", "fashion makeover", "animated music video"]
PINNED = ("Everything you just watched is code: the mall, the felt, every stitch. The repo (MIT licence) is here: {{REPO_URL}}\n"
          "Which outfit was your favourite? Mine is the shy one at the end, still in grey.")


def stamp(t, hours=False):
    t = int(t)
    return f"{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}" if hours else f"{t // 60}:{t % 60:02d}"


def merge_names(a, b):
    if a == "Intro":
        return "Intro and " + b[0].lower() + b[1:]
    if a.startswith("Pre-chorus") and b.startswith("Chorus"):
        head, _, tail = a.partition(" — ")
        chorus = b.split(" — ")[0]
        return head + " and " + chorus[0].lower() + chorus[1:] + (" — " + tail if tail else "")
    return a


def chapters(T, film_end):
    secs = T["sections"]
    raw = []
    if secs and secs[0]["start"] > 0.5:
        raw.append([0, "Intro"])
    for s in secs:
        name = FLAVOUR.get(s["id"]) or (KIND.get(s.get("kind"), "Section") + (f" {s.get('index')}" if s.get("index", 1) > 1 else ""))
        raw.append([int(s["start"]), name])
    raw[0][0] = 0
    out = [raw[0]]
    for t, name in raw[1:]:
        if t - out[-1][0] < 10:                       # too close to the previous chapter: merge (an intro takes the next name, a pre-chorus its chorus)
            out[-1][1] = merge_names(out[-1][1], name)
            continue
        out.append([t, name])
    while len(out) > 1 and film_end - out[-1][0] < 10:
        out.pop()
    return out


def description_body(chs, credits, repo_url, hours=False):
    """The YouTube description text (hook, what it is, chapters, the four credit lines, how it was made, repo, hashtags)."""
    chap_txt = "\n".join(f"{stamp(t, hours)} {n}" for t, n in chs)
    return "\n".join([
        HOOK, "", WHAT, "", chap_txt, "", "\n".join(credits), "", HOW, "", f"Code (MIT licence): {repo_url}", "", " ".join(HASHTAGS),
    ])


def problems(chs, desc, title_opts, tags):
    p = []
    if chs[0][0] != 0:
        p.append("first chapter is not at 0:00")
    if len(chs) < 3:
        p.append(f"only {len(chs)} chapters (YouTube needs 3)")
    for (a, _), (b, n) in zip(chs, chs[1:]):
        if b - a < 10:
            p.append(f"chapter '{n}' starts only {b - a} s after the previous one")
    if len(desc) > 5000:
        p.append(f"description is {len(desc)} characters (limit 5000)")
    if "<" in desc or ">" in desc:
        p.append("description contains < or > (YouTube rejects them)")
    for t in title_opts:
        if len(t) > 100:
            p.append(f"title over 100 characters: {t}")
        if "Zombie Couture" not in t:
            p.append(f"title without 'Zombie Couture': {t}")
    if len(", ".join(tags)) > 500:
        p.append(f"tags are {len(', '.join(tags))} characters (limit 500)")
    if len([w for w in desc.split() if w.startswith('#')]) > 5:
        p.append("more than 5 hashtags in the description")
    return p


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--timing")
    ap.add_argument("--out", default=os.path.join(ROOT, "publish", "description.md"))
    ap.add_argument("--credits", default=os.path.join(ROOT, "publish", "credits.txt"))
    ap.add_argument("--repo-url", default="{{REPO_URL}}")
    ap.add_argument("--tail", type=float, default=None, help="seconds after the song (default: tail in data/storyboard.json, else 4)")
    a = ap.parse_args()
    tp, standin = a.timing, False
    if not tp:
        for c in ("data/timing.json", "data/timing.standin.json"):
            if os.path.exists(os.path.join(ROOT, c)):
                tp, standin = os.path.join(ROOT, c), "standin" in c
                break
    if not tp or not os.path.exists(tp):
        print("no timing file: give --timing data/timing.json", file=sys.stderr)
        return 2
    T = json.load(open(tp))
    tail = a.tail
    if tail is None:
        try:
            tail = json.load(open(os.path.join(ROOT, "data", "storyboard.json"))).get("tail", 4.0)
        except Exception:
            tail = 4.0
    film_end = T["meta"]["duration"] + tail
    if not os.path.exists(a.credits):
        print(f"credits file not found: {a.credits} (it holds the four exact credit lines and is not part of the public repository)", file=sys.stderr)
        return 2
    credits = [l.strip() for l in open(a.credits, encoding="utf-8").read().splitlines() if l.strip()]
    fixed = ["Directed and published by Avenrae / ShaeAI", None, "Music: Suno v5", "Animation and every line of code: Claude Sonnet 5.5, in Claude.ai"]
    errs = []
    if len(credits) != 4 or any(f and c != f for c, f in zip(credits, fixed)) or not re.match(r"^Lyrics: \S.* & ShaeAI$", credits[1] if len(credits) > 1 else ""):
        errs.append(f"{a.credits} must hold exactly the four credit lines")
    chs = chapters(T, film_end)
    hours = film_end >= 3600
    body = description_body(chs, credits, a.repo_url, hours)
    pinned = PINNED.replace("{{REPO_URL}}", a.repo_url)
    errs += problems(chs, body, TITLES, TAGS)
    shortest = min(b - a_ for (a_, _), (b, _) in zip(chs, chs[1:] + [(int(film_end), "")]))
    md = f"""# Zombie Couture: upload text

Made by `tools/make_description.py` from `{os.path.relpath(tp, ROOT)}`. Edit freely; run the tool again after the timing changes.
{"**Stand-in timing was used: the chapter times are not final. Run again with the real data/timing.json.**" if standin else ""}
Still to fill in: `{{{{REPO_URL}}}}` (description and pinned comment), the thumbnail frame, upload of `zombie-couture.srt`.

## Title options (all under 100 characters)

""" + "\n".join(f"{i}. {t}  ({len(t)})" for i, t in enumerate(TITLES, 1)) + f"""

Other hook lines to swap in: """ + " / ".join(f"“{h}”" for h in HOOK_ALTS) + f"""

## Description (paste the whole block, {len(body)} of 5000 characters)

```text
{body}
```

{len(chs)} chapters, first at 0:00, shortest {shortest} s (YouTube needs at least three and 10 s each). The first three hashtags show above the title: {" ".join(HASHTAGS[:3])}.

## Tags ({len(", ".join(TAGS))} of 500 characters)

```text
{", ".join(TAGS)}
```

## Pinned comment

```text
{pinned}
```

## Before you publish

- [ ] `{{{{REPO_URL}}}}` replaced everywhere (search the description and the pinned comment)
- [ ] Thumbnail uploaded (`publish/thumb.png`, 1280x720; `python3 tools/thumbnail.py --pick` lists frame candidates)
- [ ] Captions: upload `publish/zombie-couture.srt` (language English, timing as file)
- [ ] YouTube Studio question about altered or synthetic content answered (the song is AI-generated, the animation is stylised)
- [ ] Music credit and lyric credit lines match the end card
- [ ] Shorts cut uploaded separately with the same tags and a link back to the full video
"""
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"wrote {a.out}: {len(chs)} chapters, description {len(body)}/5000 characters, tags {len(', '.join(TAGS))}/500")
    for e in errs:
        print("ERROR", e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
