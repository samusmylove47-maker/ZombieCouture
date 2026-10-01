"""Monotone (Needleman-Wunsch style) alignment of the lyric words to the recognised words.

Tolerant of ASR errors: word similarity is max(character ratio, phonetic similarity via CMUdict/L2S, prefix containment),
1:2 and 2:1 merges are allowed (ASR splits or glues words), and gap costs depend on the token: extra recognised
vocalisations ("ooh", "ah", "mm") are almost free to skip, function words are cheap to lose, long content words are not.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from . import g2p
from .lyrics import is_voc

STOP = {"a", "an", "the", "to", "of", "and", "in", "on", "at", "it", "its", "is", "i", "im", "my", "me", "we", "you", "he", "she", "they",
        "for", "but", "or", "so", "as", "be", "by", "do", "if", "up", "no", "oh", "that", "this", "with", "are", "was", "all", "our", "your"}
VOWELS = g2p.VOWELS
CLASS = {}
for _p in "P B T D K G".split():
    CLASS[_p] = "stop"
for _p in "F V TH DH S Z SH ZH HH".split():
    CLASS[_p] = "fric"
for _p in "CH JH".split():
    CLASS[_p] = "affr"
for _p in "M N NG".split():
    CLASS[_p] = "nasal"
for _p in "L R W Y".split():
    CLASS[_p] = "glide"
for _p in VOWELS:
    CLASS[_p] = "vowel"


def asr_norm(w: str) -> str:
    return re.sub(r"[^a-z']", "", w.lower()).strip("'")


@lru_cache(maxsize=None)
def _ph(w: str):
    if not w:
        return ()
    return tuple(g2p.strip_stress(g2p.phones(w)[0]))


def _sub_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    ca, cb = CLASS.get(a), CLASS.get(b)
    if ca == cb:
        return 0.45
    if "vowel" in (ca, cb):
        return 1.0
    return 0.8


def _phone_sim(pa, pb) -> float:
    if not pa or not pb:
        return 0.0
    la, lb = len(pa), len(pb)
    prev = [j * 0.8 for j in range(lb + 1)]
    for i in range(1, la + 1):
        cur = [i * 0.8] + [0.0] * lb
        for j in range(1, lb + 1):
            cur[j] = min(prev[j] + 0.8, cur[j - 1] + 0.8, prev[j - 1] + _sub_cost(pa[i - 1], pb[j - 1]))
        prev = cur
    return max(0.0, 1.0 - prev[lb] / max(la, lb))


@lru_cache(maxsize=None)
def sim(a: str, b: str) -> float:
    """Similarity in [0, 1] between a lyric word and a recognised word (both normalised)."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    r = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
    if len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
        r = max(r, 0.6 + 0.4 * min(len(a), len(b)) / max(len(a), len(b)))
    p = _phone_sim(_ph(a), _ph(b))
    return max(r, 0.95 * p)


def importance(w: str) -> float:
    if is_voc(w):
        return 0.35
    if w in STOP or len(w) <= 2:
        return 0.55
    if len(w) >= 7:
        return 1.25
    return 1.0


@dataclass
class Params:
    gap_lyric: float = 0.45
    gap_asr: float = 0.35
    gap_asr_voc: float = 0.05
    floor: float = 0.5
    mismatch: float = -0.6


def align(lyr: list[str], asr: list[str], prm: Params | None = None):
    """Returns (pairs, info): pairs = list of (lyric_indices, asr_indices, sim) for accepted matches (sim >= floor)."""
    prm = prm or Params()
    n, m = len(lyr), len(asr)
    if n == 0 or m == 0:
        return [], {"score": 0.0, "n": n, "m": m}
    imp = np.array([importance(w) for w in lyr])
    gl = np.array([prm.gap_lyric * (0.5 if (w in STOP or is_voc(w)) else 1.0) for w in lyr])
    ga = np.array([prm.gap_asr * (prm.gap_asr_voc / prm.gap_asr if is_voc(w) else (0.6 if (w in STOP or len(w) <= 2) else 1.0)) for w in asr])

    # pairwise match scores
    uniq_l = {w: k for k, w in enumerate(dict.fromkeys(lyr))}
    uniq_a = {w: k for k, w in enumerate(dict.fromkeys(asr))}
    SM = np.zeros((len(uniq_l), len(uniq_a)))
    for wl, kl in uniq_l.items():
        for wa, ka in uniq_a.items():
            SM[kl, ka] = sim(wl, wa)
    li = np.array([uniq_l[w] for w in lyr])
    ai = np.array([uniq_a[w] for w in asr])
    SIM = SM[np.ix_(li, ai)]                                                       # n x m
    M = np.where(SIM >= prm.floor, imp[:, None] * (2 * SIM - 1.0), prm.mismatch)

    # merges: two recognised words glued into one lyric word / two lyric words into one recognised word
    NEG = -1e9
    M21 = np.full((n, m), NEG)          # lyric i  <->  asr j-1 + j   (index j = second word)
    for i in range(n):
        if len(lyr[i]) < 5:
            continue
        for j in range(1, m):
            c = asr[j - 1] + asr[j]
            if abs(len(c) - len(lyr[i])) <= 3 and c[:1] == lyr[i][:1]:
                s = sim(lyr[i], c)
                if s >= max(prm.floor + 0.2, 0.7):
                    M21[i, j] = imp[i] * (2 * s - 1.0) * 0.9
    M12 = np.full((n, m), NEG)          # lyric i-1 + i  <->  asr j
    for j in range(m):
        if len(asr[j]) < 5:
            continue
        for i in range(1, n):
            c = lyr[i - 1] + lyr[i]
            if abs(len(c) - len(asr[j])) <= 3 and c[:1] == asr[j][:1]:
                s = sim(c, asr[j])
                if s >= max(prm.floor + 0.2, 0.7):
                    M12[i, j] = 0.5 * (imp[i] + imp[i - 1]) * (2 * s - 1.0) * 0.9

    S = np.full((n + 1, m + 1), NEG)
    B = np.zeros((n + 1, m + 1), dtype=np.int8)     # 0 diag, 1 lyric skip, 2 asr skip, 3 merge asr2->lyric, 4 merge lyric2->asr
    S[0, 0] = 0.0
    for i in range(1, n + 1):
        S[i, 0] = S[i - 1, 0] - gl[i - 1]
        B[i, 0] = 1
    for j in range(1, m + 1):
        S[0, j] = S[0, j - 1] - ga[j - 1]
        B[0, j] = 2
    for i in range(1, n + 1):
        Si, Sp = S[i], S[i - 1]
        Mi = M[i - 1]
        for j in range(1, m + 1):
            best = Sp[j - 1] + Mi[j - 1]
            b = 0
            v = Sp[j] - gl[i - 1]
            if v > best:
                best, b = v, 1
            v = Si[j - 1] - ga[j - 1]
            if v > best:
                best, b = v, 2
            if j >= 2 and M21[i - 1, j - 1] > NEG / 2:
                v = Sp[j - 2] + M21[i - 1, j - 1]
                if v > best:
                    best, b = v, 3
            if i >= 2 and M12[i - 1, j - 1] > NEG / 2:
                v = S[i - 2, j - 1] + M12[i - 1, j - 1]
                if v > best:
                    best, b = v, 4
            Si[j], B[i, j] = best, b
    # traceback
    i, j = n, m
    pairs = []
    weak = []
    while i > 0 or j > 0:
        b = B[i, j]
        if i == 0:
            b = 2
        if j == 0:
            b = 1
        if b == 0:
            s = float(SIM[i - 1, j - 1])
            (pairs if s >= prm.floor else weak).append(((i - 1,), (j - 1,), s))
            i, j = i - 1, j - 1
        elif b == 1:
            i -= 1
        elif b == 2:
            j -= 1
        elif b == 3:
            pairs.append(((i - 1,), (j - 2, j - 1), float(sim(lyr[i - 1], asr[j - 2] + asr[j - 1]))))
            i, j = i - 1, j - 2
        else:
            pairs.append(((i - 2, i - 1), (j - 1,), float(sim(lyr[i - 2] + lyr[i - 1], asr[j - 1]))))
            i, j = i - 2, j - 1
    pairs.reverse()
    weak.reverse()
    return pairs, {"score": float(S[n, m]), "n": n, "m": m, "weak": weak}
