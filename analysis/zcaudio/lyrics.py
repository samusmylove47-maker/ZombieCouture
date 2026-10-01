"""Lyrics file parsing: `[Section - direction]` tags, lines, words.

Format (data/lyrics.txt):
    [Chorus - upbeat, major key, bubbly synths + handclaps]      <- section tag: name, then the performance direction
    I'm sewing dresses for the undead crew,                      <- one sung line per text line
    Zom...bie... cute...                                         <- ellipsis inside a word = a held / stretched word
    (Bloom!)                                                     <- parentheses = backing / gang vocal, still aligned
Anything in [square brackets] inside a line, and parentheses that only contain a stage direction ("(moans)"), are notes,
not sung words. Dashes standing alone are punctuation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# vocalisation-like tokens: cheap to skip in alignment, never lip-synced as words
VOC_RE = re.compile(r"^(o+h+|o{2,}|a+h+|a{2,}|u+h+|u+m+|m{2,}|h+m+|h+u+h+|ha(ha)*h?|he(he)+|na+|la+|da+|do{2,}|whoa+|woah|wow|ay+e?|yeah|yea|hey|ye+|yo|eh|mm+h?m*|oh+)$")
DIRECTION_WORDS = {"moan", "moans", "moaning", "laugh", "laughs", "laughing", "sigh", "sighs", "gasp", "gasps", "scream", "screams",
                   "clap", "claps", "clapping", "whisper", "whispers", "whispered", "spoken", "speaks", "giggle", "giggles",
                   "instrumental", "music", "fade", "fades", "fading", "click", "clicks", "cough", "breath", "breathes", "chorus",
                   "sfx", "sound", "noise", "growl", "groan", "groans"}
NUM_WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
QUOTES = {"“": '"', "”": '"', "‘": "'", "’": "'", "`": "'", "´": "'"}
ELLIPSIS = "…"


def _num2words(n: int) -> str:
    if n < 20:
        return NUM_WORDS[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + NUM_WORDS[n % 10])
    if n < 1000:
        return NUM_WORDS[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _num2words(n % 100))
    return " ".join(NUM_WORDS[int(c)] for c in str(n))


def clean_quotes(s: str) -> str:
    for a, b in QUOTES.items():
        s = s.replace(a, b)
    return s.replace("–", "-").replace("—", "-").replace("−", "-")


def norm_word(w: str) -> str:
    """Lower-case alphanumerics + inner apostrophes; the form used for matching against ASR output."""
    w = clean_quotes(w).lower()
    w = re.sub(r"\d+", lambda m: " " + _num2words(int(m.group())) + " ", w)
    w = re.sub(r"[^a-z' ]", "", w)
    w = re.sub(r"\s+", "", w)
    return w.strip("'")


def is_voc(norm: str) -> bool:
    return bool(VOC_RE.match(norm))


@dataclass
class LWord:
    text: str                     # display token (punctuation kept)
    norm: str                     # matching form
    line: int = 0
    section: int = 0
    idx: int = 0                  # index within line
    bg: bool = False              # inside (parentheses): backing / gang vocal
    hold: int = 0                 # 0 normal, 1 stretched / trailing ellipsis, 2 ellipsis inside the word
    parts: list = field(default_factory=list)
    voc: bool = False             # ooh / ah / na / la ...
    gid: int = 0                  # global index in the song


@dataclass
class LLine:
    id: int
    text: str
    section: int
    words: list                   # global word indices [i0, i1)
    notes: list = field(default_factory=list)


@dataclass
class LSection:
    id: str
    name: str
    kind: str
    index: int
    direction: str
    raw_tag: str
    lines: list                   # line ids
    final: bool = False


@dataclass
class Lyrics:
    sections: list
    lines: list
    words: list
    source: str = ""

    def word_norms(self):
        return [w.norm for w in self.words]


KIND_PATTERNS = [
    ("prechorus", r"pre[\s-]*chorus|build[\s-]*up|pre[\s-]*hook"),
    ("postchorus", r"post[\s-]*chorus|^tag\b(?![\s-]*out)"),
    ("chorus", r"chorus|hook|refrain|drop"),
    ("verse", r"verse"),
    ("bridge", r"bridge|middle[\s-]*8"),
    ("break", r"break|dance"),
    ("intro", r"intro"),
    ("outro", r"outro|ending|coda|tag[\s-]*out"),
    ("instrumental", r"instrumental|interlude|solo"),
    ("spoken", r"spoken|monologue|talk"),
]
TAG_SPLIT = re.compile(r"\s+[-–—]\s+|\s*[–—]\s*|\s*:\s+|\s*\|\s*")


def parse_tag(raw: str):
    inner = raw.strip()[1:-1].strip()
    parts = TAG_SPLIT.split(inner, maxsplit=1)
    name = parts[0].strip()
    direction = parts[1].strip() if len(parts) > 1 else ""
    return name, direction


def kind_of(name: str) -> str:
    n = name.lower()
    for kind, pat in KIND_PATTERNS:
        if re.search(pat, n):
            return kind
    return "other"


def _split_token(tok: str):
    """Split one whitespace token into sung word records (handles hyphens and ellipses)."""
    raw = clean_quotes(tok)
    out = []
    # hyphen compounds: P-bloom, five-point-five -> separate sung words, hyphen kept on the first for display
    pieces = re.split(r"(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])", raw)
    for k, p in enumerate(pieces):
        disp = p + ("-" if k < len(pieces) - 1 else "")
        out.append(disp)
    return out


def parse_lyrics(text: str, source: str = "") -> Lyrics:
    sections: list[LSection] = []
    lines: list[LLine] = []
    words: list[LWord] = []
    counts: dict = {}
    cur: LSection | None = None

    def new_section(raw_tag: str, name: str, direction: str):
        nonlocal cur
        kind = kind_of(name)
        m = re.search(r"(\d+)\s*$", name)
        if m:
            idx = int(m.group(1))
        else:
            idx = counts.get(kind, 0) + 1
        while any(s.kind == kind and s.index == idx for s in sections):
            idx += 1
        counts[kind] = max(counts.get(kind, 0), idx)
        sid = f"{kind}{idx}"
        final = bool(re.search(r"\b(final|last|closing)\b", name.lower()))
        cur = LSection(id=sid, name=name or kind.title(), kind=kind, index=idx, direction=direction, raw_tag=raw_tag, lines=[], final=final)
        sections.append(cur)

    for raw in text.splitlines():
        s = raw.strip().lstrip("﻿")
        if not s:
            continue
        if re.fullmatch(r"\[[^\]]+\]", s):
            name, direction = parse_tag(s)
            new_section(s, name, direction)
            continue
        if s.startswith("#") or s.startswith("//"):
            continue
        if cur is None:
            new_section("[Verse]", "Verse", "")
        # notes in [brackets]
        notes = re.findall(r"\[([^\]]+)\]", s)
        body = re.sub(r"\[[^\]]+\]", " ", s)
        body = clean_quotes(body).replace("...", ELLIPSIS)
        line_id = len(lines)
        sec_i = len(sections) - 1
        i0 = len(words)
        depth = 0
        idx = 0
        for tok in body.split():
            t = tok
            opens = t.count("(")
            closes = t.count(")")
            in_par = depth > 0 or opens > 0
            depth = max(0, depth + opens - closes)
            core = t.strip("()")
            if not re.search(r"[A-Za-z0-9]", core):
                continue                                       # bare dash / ellipsis / punctuation
            # stage direction in parentheses: "(moans)" -> note, not a word
            if in_par and norm_word(core) in DIRECTION_WORDS:
                notes.append(core)
                continue
            for disp in _split_token(core):
                hold = 0
                parts: list = []
                if re.search(r"[A-Za-z]" + ELLIPSIS + r"+[A-Za-z]", disp):
                    hold = 2
                    parts = [p for p in re.split(ELLIPSIS + "+", disp) if p]
                elif disp.endswith(ELLIPSIS):
                    hold = 1
                if re.search(r"([A-Za-z])\1\1", disp):
                    hold = max(hold, 1)
                n = norm_word(disp.replace(ELLIPSIS, ""))
                n = re.sub(r"(.)\1{2,}", r"\1", n)                # braaains -> brains
                if not n:
                    continue
                w = LWord(text=disp.replace("(", "").replace(")", ""), norm=n, line=line_id, section=sec_i, idx=idx, bg=in_par,
                          hold=hold, parts=parts, voc=is_voc(n), gid=len(words))
                words.append(w)
                idx += 1
        line_text = re.sub(r"\s+", " ", re.sub(r"\[[^\]]+\]", " ", s)).strip()
        lines.append(LLine(id=line_id, text=line_text, section=sec_i, words=[i0, len(words)], notes=notes))
        cur.lines.append(line_id)
    if not words:
        raise ValueError("no lyric words found")
    return Lyrics(sections=sections, lines=lines, words=words, source=source)


def load_lyrics(path) -> Lyrics:
    with open(path, encoding="utf-8") as f:
        return parse_lyrics(f.read(), source=str(path))


def from_lyrics_json(j: dict) -> str:
    """Convert the previous project's lyrics.json to the bracket-tag text format (used by the validation harness)."""
    out = []
    for s in j["sections"]:
        d = s.get("direction", "")
        out.append(f"[{s['name']}" + (f" – {d}" if d else "") + "]")
        out += s["lines"]
        out.append("")
    return "\n".join(out)
