"""Word -> ARPAbet phonemes: CMU dictionary first, then morphology (suffix / compound), then letter-to-sound rules.

`phones(word)` returns (list of ARPAbet symbols with stress digits on vowels, source) where source is one of
dict | user | morph | compound | l2s.  User pronunciations live in data/pron.json ({"couture": "K UW0 T UH1 R"}).
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}

# words that are missing from CMUdict / commonly mis-guessed (pop-lyric vocabulary; extend as needed)
EXTRA = {
    "couture": "K UW0 T UH1 R",
    "shoggoth": "SH AA1 G AA0 TH",
    "foom": "F UW1 M",
    "zombie": "Z AA1 M B IY0",
    "zombies": "Z AA1 M B IY0 Z",
    "undead": "AH0 N D EH1 D",
    "braains": "B R EY1 N Z",
    "brainz": "B R EY1 N Z",
    "ooh": "UW1", "oooh": "UW1", "oh": "OW1", "ohh": "OW1", "ah": "AA1", "aah": "AA1", "ahh": "AA1", "mm": "M", "mmm": "M", "hmm": "HH M",
    "uh": "AH1", "huh": "HH AH1", "yeah": "Y AE1", "hey": "HH EY1", "whoa": "W OW1", "woah": "W OW1", "la": "L AA1", "na": "N AA1",
    "ha": "HH AA1", "haha": "HH AA1 HH AA1", "doo": "D UW1", "da": "D AA1", "wow": "W AW1", "yo": "Y OW1",
    "pbloom": "P IY1 B L UW1 M", "gonna": "G AH1 N AH0", "wanna": "W AA1 N AH0", "gotta": "G AA1 T AH0", "cuz": "K AH1 Z",
    "em": "AH0 M", "til": "T IH1 L", "ya": "Y AH0", "tulle": "T UW1 L", "petticoat": "P EH1 T IY0 K OW2 T", "petticoats": "P EH1 T IY0 K OW2 T S",
    "catwalk": "K AE1 T W AO2 K", "ribbons": "R IH1 B AH0 N Z",
}

_cmu = None
_user: dict = {}


def load_user_pron(path):
    global _user
    p = Path(path)
    if p.exists():
        try:
            _user = {k.lower(): v.split() if isinstance(v, str) else v for k, v in json.loads(p.read_text()).items()}
        except Exception:
            _user = {}


def _load_cmu():
    global _cmu
    if _cmu is None:
        try:
            import cmudict
            _cmu = cmudict.dict()
        except Exception:
            _cmu = {}
    return _cmu


def _lookup(w: str):
    d = _load_cmu()
    v = d.get(w)
    return list(v[0]) if v else None


# --------------------------------------------------------------------------------------------------------
# letter-to-sound rules (compact; good enough for viseme classes, not for TTS)
# --------------------------------------------------------------------------------------------------------
_CONS_RULES = [
    ("tch", ["CH"]), ("dge", ["JH"]), ("sch", ["S", "K"]), ("tion", ["SH", "AH0", "N"]), ("sion", ["ZH", "AH0", "N"]),
    ("ture", ["CH", "ER0"]), ("ough", ["AH1", "F"]), ("augh", ["AE1", "F"]), ("igh", ["AY1"]),
    ("ch", ["CH"]), ("sh", ["SH"]), ("th", ["TH"]), ("ph", ["F"]), ("ck", ["K"]), ("ng", ["NG"]), ("nk", ["NG", "K"]),
    ("wh", ["W"]), ("wr", ["R"]), ("kn", ["N"]), ("gn", ["N"]), ("qu", ["K", "W"]), ("gh", []), ("mb", ["M"]),
    ("x", ["K", "S"]), ("j", ["JH"]), ("z", ["Z"]), ("q", ["K"]), ("v", ["V"]), ("w", ["W"]), ("h", ["HH"]),
    ("b", ["B"]), ("d", ["D"]), ("f", ["F"]), ("k", ["K"]), ("l", ["L"]), ("m", ["M"]), ("n", ["N"]), ("p", ["P"]),
    ("r", ["R"]), ("t", ["T"]),
]
_VOW_RULES = [
    ("eau", ["OW1"]), ("ai", ["EY1"]), ("ay", ["EY1"]), ("ee", ["IY1"]), ("ea", ["IY1"]), ("ie", ["IY1"]), ("ei", ["EY1"]),
    ("oa", ["OW1"]), ("oo", ["UW1"]), ("ou", ["AW1"]), ("ow", ["OW1"]), ("oi", ["OY1"]), ("oy", ["OY1"]), ("au", ["AO1"]),
    ("aw", ["AO1"]), ("ue", ["UW1"]), ("ui", ["UW1"]), ("eu", ["Y", "UW1"]), ("ew", ["Y", "UW1"]),
    ("ar", ["AA1", "R"]), ("or", ["AO1", "R"]), ("er", ["ER0"]), ("ir", ["ER1"]), ("ur", ["ER1"]),
    ("a", ["AE1"]), ("e", ["EH1"]), ("i", ["IH1"]), ("o", ["AA1"]), ("u", ["AH1"]), ("y", ["IY0"]),
]
_LONG = {"a": "EY1", "e": "IY1", "i": "AY1", "o": "OW1", "u": "UW1"}


def l2s(word: str) -> list[str]:
    """Rule-based grapheme-to-phoneme. Deliberately simple: it only has to land in the right mouth-shape class."""
    w = re.sub(r"[^a-z]", "", word.lower())
    w = re.sub(r"(.)\1{2,}", r"\1", w)          # elongation braaains -> brains
    out: list[str] = []
    i, n = 0, len(w)
    multi = sorted([r for r in _CONS_RULES + _VOW_RULES if len(r[0]) > 1], key=lambda r: -len(r[0]))
    while i < n:
        c = w[i]
        rest = w[i:]
        # word-final silent e after a consonant (magic-e): lengthen the previous vowel, emit nothing
        if c == "e" and i == n - 1 and i > 1 and w[i - 1] not in "aeiouy":
            for k in range(len(out) - 1, -1, -1):
                base = out[k].rstrip("012")
                if base in VOWELS:
                    lettermap = {"AE": "EY1", "EH": "IY1", "IH": "AY1", "AA": "OW1", "AH": "UW1"}
                    if base in lettermap:
                        out[k] = lettermap[base]
                    break
            i += 1
            continue
        # plural / past endings: "-es", "-ed" after a consonant
        if c == "e" and i == n - 2 and w[-1] in "sd" and i > 1 and w[i - 1] not in "aeiouy":
            if w[i - 1] in "sztdcgx":
                out.append("AH0")
            i += 1
            continue
        hit = next((r for r in multi if rest.startswith(r[0])), None)
        if hit:
            out += hit[1]
            i += len(hit[0])
            continue
        if c == "c":
            out.append("S" if (i + 1 < n and w[i + 1] in "eiy") else "K"); i += 1; continue
        if c == "g":
            out.append("JH" if (i > 0 and i + 1 < n and w[i + 1] in "eiy") else "G"); i += 1; continue
        if c == "s":
            if i + 1 < n and w[i + 1] == "s":
                out.append("S"); i += 2; continue
            if 0 < i == n - 1 and w[i - 1] in "aeioubdglmnrvwyz":
                out.append("Z")
            elif 0 < i < n - 1 and w[i - 1] in "aeiouy" and w[i + 1] in "aeiouy":
                out.append("Z")
            else:
                out.append("S")
            i += 1
            continue
        if c == "y":
            out.append("Y" if i == 0 else ("AY1" if (i == n - 1 and n <= 3) else ("IY0" if i == n - 1 else "IH1"))); i += 1; continue
        if c in "aeiou":
            out += dict(_VOW_RULES)[c]; i += 1; continue
        single = dict(r for r in _CONS_RULES if len(r[0]) == 1)
        out += single.get(c, []); i += 1
    # doubled consonant letters make one sound
    out = [p for k, p in enumerate(out) if not (k > 0 and p == out[k - 1] and p not in VOWELS and p.rstrip("012") not in VOWELS)]
    # stress: first vowel primary unless a rule already marked one; every other vowel unstressed
    has1 = any(p.endswith("1") for p in out)
    res, first = [], True
    for p in out:
        b = p.rstrip("012")
        if b in VOWELS:
            if p[-1] in "012":
                res.append(p)
            else:
                res.append(b + ("1" if (first and not has1) else "0"))
            first = False
        else:
            res.append(p)
    return res


_SUFFIXES = [("ies", "y", ["Z"]), ("es", "", ["IH0", "Z"]), ("s", "", ["S"]), ("ing", "", ["IH0", "NG"]), ("ed", "", ["D"]),
             ("d", "", ["D"]), ("ly", "", ["L", "IY0"]), ("er", "", ["ER0"]), ("est", "", ["AH0", "S", "T"]), ("'s", "", ["Z"]),
             ("in'", "", ["IH0", "N"])]


def _voiced_end(ph: list[str]) -> bool:
    last = ph[-1].rstrip("012")
    return last in VOWELS or last in {"B", "D", "G", "JH", "L", "M", "N", "NG", "R", "V", "W", "Y", "Z", "ZH", "DH"}


@lru_cache(maxsize=4096)
def phones(word: str):
    w = word.lower().strip("'")
    w0 = w
    if w in _user:
        return list(_user[w]), "user"
    w = re.sub(r"(.)\1{2,}", r"\1", w)               # elongation
    if w in _user:
        return list(_user[w]), "user"
    if w in EXTRA:
        return EXTRA[w].split(), "dict"
    p = _lookup(w)
    if p:
        return p, "dict"
    if "'" in w:                                      # contractions missing from the dictionary
        p = _lookup(w.replace("'", ""))
        if p:
            return p, "dict"
    # morphology: strip a suffix and re-attach its sound
    for suf, repl, sph in _SUFFIXES:
        if w.endswith(suf) and len(w) > len(suf) + 2:
            stem = w[: -len(suf)] + repl
            for cand in (stem, stem + "e", stem[:-1] if len(stem) > 2 and stem[-1] == stem[-2] else None):
                if not cand:
                    continue
                base = EXTRA.get(cand)
                base = base.split() if base else _lookup(cand)
                if base:
                    add = list(sph)
                    if suf in ("s", "'s"):
                        last = base[-1].rstrip("012")
                        add = ["IH0", "Z"] if last in {"S", "Z", "SH", "ZH", "CH", "JH"} else (["Z"] if _voiced_end(base) else ["S"])
                    if suf in ("ed", "d"):
                        last = base[-1].rstrip("012")
                        add = ["IH0", "D"] if last in {"T", "D"} else (["D"] if _voiced_end(base) else ["T"])
                    return base + add, "morph"
    # compounds of two dictionary words (catwalk, sunflower...)
    if len(w) >= 6:
        for k in range(3, len(w) - 2):
            a, b = w[:k], w[k:]
            pa = EXTRA.get(a) and EXTRA[a].split() or _lookup(a)
            pb = EXTRA.get(b) and EXTRA[b].split() or _lookup(b)
            if pa and pb and len(a) >= 3 and len(b) >= 3:
                pb = [x.rstrip("12") + "0" if x.rstrip("012") in VOWELS and x.endswith("1") else x for x in pb]
                return pa + pb, "compound"
    return l2s(w0), "l2s"


def strip_stress(ph: list[str]) -> list[str]:
    return [p.rstrip("012") for p in ph]


def is_vowel(p: str) -> bool:
    return p.rstrip("012") in VOWELS
