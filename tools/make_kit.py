#!/usr/bin/env python3
"""Writes publish/youtube_kit.md: everything needed to upload the film, in the order Studio asks for it.

  python3 tools/make_kit.py [--timing data/timing.json] [--out publish/youtube_kit.md] [--repo-url URL] [--delivery out/delivery] [--thumb publish/thumb.jpg]

Reuses the pieces of tools/make_description.py (hook line, chapters, credit lines, tags, pinned comment), so the two files never disagree.
--delivery: a folder holding the delivered files under their final names; the sizes in the file list are read from it when the files are there.
{{REPO_URL}} stays a placeholder until --repo-url is given. Exit code 1 when a rule fails (chapters, lengths, credit lines, account name, e-mail).
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import make_description as md

TITLE = "Zombie Couture — Made by Claude Sonnet 5.5"
SHORT_TITLE = "Zombie Couture — Made by Claude Sonnet 5.5 #shorts"
FILES = [
    ("Zombie_Couture_1080p.mp4", "the film: 1080p, 24 fps, {dur}, BT.709. Upload this one."),
    ("Zombie_Couture_720p.mp4", "the same film at 720p for sharing by message or e-mail."),
    ("thumbnail.jpg", "the YouTube thumbnail, 1280 × 720."),
    ("captions.srt", "the lyrics as timed English captions."),
    ("hook_vertical_9x16.mp4", "the Short: the first chorus in a native 9:16 render, 15 seconds."),
    ("hook_15s_16x9.mp4", "the same 15 seconds in widescreen, with a small maker tag on screen, for X, Bluesky, Discord and the like."),
    ("youtube_kit.md", "this file."),
]


def size_txt(path):
    if not path or not os.path.exists(path):
        return ""
    n = os.path.getsize(path)
    return f" ({n / 1e6:.0f} MB)" if n >= 1e6 else f" ({n / 1e3:.0f} KB)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--timing", default=os.path.join(ROOT, "data", "timing.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "publish", "youtube_kit.md"))
    ap.add_argument("--credits", default=os.path.join(ROOT, "publish", "credits.txt"))
    ap.add_argument("--repo-url", default="{{REPO_URL}}")
    ap.add_argument("--delivery", default=os.path.join(ROOT, "out", "delivery"))
    ap.add_argument("--thumb", default=os.path.join(ROOT, "publish", "thumb.jpg"))
    ap.add_argument("--tail", type=float, default=None)
    a = ap.parse_args()

    T = json.load(open(a.timing))
    tail = a.tail
    if tail is None:
        try:
            tail = json.load(open(os.path.join(ROOT, "data", "storyboard.json"))).get("tail", 4.0)
        except Exception:
            tail = 4.0
    film_end = T["meta"]["duration"] + tail
    credits = [l.strip() for l in open(a.credits, encoding="utf-8").read().splitlines() if l.strip()]
    errs = []
    fixed = ["Directed and published by Avenrae / ShaeAI", None, "Music: Suno v5", "Animation and every line of code: Claude Sonnet 5.5, in Claude.ai"]
    lyric_line = credits[1] if len(credits) > 1 else ""
    m_lyric = re.match(r"^Lyrics: (\S.*) & ShaeAI$", lyric_line)
    if len(credits) != 4 or any(f and c != f for c, f in zip(credits, fixed)) or not m_lyric:
        errs.append(f"{a.credits} must hold exactly the four credit lines")
    chs = md.chapters(T, film_end)
    hours = film_end >= 3600
    body = md.description_body(chs, credits, a.repo_url, hours)
    pinned = md.PINNED.replace("{{REPO_URL}}", a.repo_url)
    titles = [TITLE] + md.TITLES
    errs += md.problems(chs, body, titles + [SHORT_TITLE], md.TAGS)
    if len(SHORT_TITLE) > 100:
        errs.append("short title over 100 characters")

    dur = md.stamp(round(film_end), hours)
    files_txt = "\n".join(
        f"- `{n}`{size_txt(os.path.join(a.delivery, n))} — {d.format(dur=dur)}" for n, d in FILES)

    thumb_note = "`thumbnail.jpg` (1280 × 720)."
    if os.path.exists(a.thumb):
        try:
            from PIL import Image
            w, h = Image.open(a.thumb).size
            thumb_note = f"`thumbnail.jpg` ({w} × {h}, {os.path.getsize(a.thumb) / 1e3:.0f} KB, so it clears YouTube's 2 MB limit)."
        except Exception:
            pass

    short_desc = ("The first chorus of Zombie Couture: a felt-and-thread music video where the undead get makeovers, animated entirely by "
                  "Claude Sonnet 5.5. Full video on the channel. Code (MIT licence): " + a.repo_url + "\n\n" + "\n".join(credits) + "\n\n#Shorts #ZombieCouture #Halloween")
    end_card_s = tail
    if a.repo_url == "{{REPO_URL}}":
        before_post = ("- Before you post: replace `{{{{REPO_URL}}}}` in the description, the pinned comment and the Short's description once the repository is public "
                       "(it stays a placeholder until then).")
    else:
        before_post = ("- The repository link is already in the description, the pinned comment and the Short's description. Once the video is live, "
                       "add its link to the repository's README, a line \"Watch it: <link>\" under the title.")

    md_text = f"""# Zombie Couture — YouTube upload kit

## Files

{files_txt}

## Title ({len(TITLE)} characters)

**{TITLE}**

Backups if you want a different angle:
""" + "\n".join(f"- {t}" for t in md.TITLES) + f"""

Other hook lines to swap in as the first line of the description: """ + " / ".join(f"“{h}”" for h in md.HOOK_ALTS) + f"""

## Thumbnail

{thumb_note} Set it in Studio under Customization → Thumbnail.

## Description (paste as is, {len(body)} of 5000 characters)

```text
{body}
```

{len(chs)} chapters, the first at 0:00 and none shorter than {min(b - a_ for (a_, _), (b, _) in zip(chs, chs[1:] + [(int(film_end), "")]))} seconds, so YouTube shows them on the timeline. The first three hashtags appear above the title: {" ".join(md.HASHTAGS[:3])}.

## Tags ({len(", ".join(md.TAGS))} of 500 characters)

```text
{", ".join(md.TAGS)}
```

## Pinned comment (post it as yourself)

```text
{pinned}
```

## The Short (vertical 9:16, 15 seconds)

File: `hook_vertical_9x16.mp4`. Title: **{SHORT_TITLE}** ({len(SHORT_TITLE)} characters)

Description:

```text
{short_desc}
```

`hook_15s_16x9.mp4` is the same 15 seconds in widescreen with a small "Zombie Couture · Made by Claude Sonnet 5.5" tag bottom left the whole time, so the clip names its maker where no caption shows.

## Upload settings

- Captions: Studio → Subtitles → Add language → English → Upload file → With timing, and pick `captions.srt`. It has {md_cue_count()} cues.
- End screen: the care-label card at the end runs {end_card_s:.0f} seconds (from {md.stamp(round(film_end - end_card_s), hours)}), long enough for YouTube's end-screen elements (video, subscribe).
- Altered or synthetic content: YouTube's question is aimed at realistic content that could pass for real. A felt-and-thread cartoon and a synthetic voice that imitates no real person likely don't require it, and answering yes does no harm, because the description already says how it was made.
- Audience: not made for kids (satirical pop with a zombie premise). Choosing "made for kids" would switch comments off.
- Language: English. Category: Music, or Film & Animation if you want it shown with the animation crowd.
- Timing: it is a Halloween-flavoured song, so October is the natural month; the Short can go out a day or two before the full video.
{before_post}
"""
    # rules that protect the credit scheme: the account name (taken from the lyric credit line) appears only inside that line,
    # and neither an e-mail address nor a build-machine path gets into the kit
    if m_lyric:
        name = m_lyric.group(1)
        rest = md_text.replace(lyric_line, "")
        if name in rest:
            errs.append("the account name appears outside the lyric-credit line")
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", md_text):
        errs.append("an e-mail address is in the kit")
    if re.search(r"(^|[\s`(])/(home|mnt|root|tmp|Users)/", md_text):
        errs.append("a build-machine path is in the kit")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(md_text)
    print(f"wrote {a.out}: {len(chs)} chapters, description {len(body)}/5000, tags {len(', '.join(md.TAGS))}/500, placeholders: {md_text.count('{{REPO_URL}}')}")
    for e in errs:
        print("ERROR", e)
    return 1 if errs else 0


def md_cue_count():
    p = os.path.join(ROOT, "publish", "zombie-couture.srt")
    try:
        return len(re.findall(r"^\d+\s*$", open(p, encoding="utf-8").read(), re.M))
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
