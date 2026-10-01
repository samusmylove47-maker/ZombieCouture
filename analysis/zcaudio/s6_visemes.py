"""Stage 6 - visemes: word phonemes (CMUdict / letter-to-sound fallback) -> 8 mouth-shape classes, timed inside each word.

Classes (index = position in VISEMES):  rest, MBP (lips closed), FV (lip-teeth), O (rounded), U (tight round),
AA (wide open), EE (narrow / spread), TLD (tongue-tip: TH, L, D, T, N).
Each phoneme becomes one or more events {t, d, v, w}: shape v is reached at t (attack before it), held for d seconds, weight w in 0..1
(vowel openness, consonant salience). Events of neighbouring phonemes overlap in the renderer's smoothing, which is what gives
coarticulation; consonants with no visible shape (K G NG HH) emit nothing but keep their time slot. Diphthongs emit two events.

Durations inside a word are vowel-weighted (stressed vowels longest) and stretched for held / elongated words ("Zom...bie...").
Outputs: visemes.json  {words:[{i, phones, src, events:[...]}]}
"""
from __future__ import annotations

import numpy as np

from . import g2p
from .common import Ctx, dump_json, load_json, timer
from .lyrics import load_lyrics

VISEMES = ["rest", "MBP", "FV", "O", "U", "AA", "EE", "TLD"]

# phoneme -> [(viseme, weight, share_of_segment)]  (two entries = diphthong: first part then second part)
VOWEL_SHAPES = {
    "AA": [("AA", 1.00, 1.0)],
    "AE": [("AA", 0.85, 1.0)],
    "AH": [("AA", 0.65, 1.0)],
    "AO": [("O", 1.00, 1.0)],
    "AW": [("AA", 1.00, 0.55), ("U", 0.75, 0.45)],
    "AY": [("AA", 1.00, 0.55), ("EE", 0.65, 0.45)],
    "EH": [("AA", 0.60, 1.0)],
    "ER": [("O", 0.45, 1.0)],
    "EY": [("AA", 0.45, 0.35), ("EE", 0.90, 0.65)],
    "IH": [("EE", 0.60, 1.0)],
    "IY": [("EE", 1.00, 1.0)],
    "OW": [("O", 1.00, 0.65), ("U", 0.55, 0.35)],
    "OY": [("O", 1.00, 0.55), ("EE", 0.65, 0.45)],
    "UH": [("U", 0.65, 1.0)],
    "UW": [("U", 1.00, 1.0)],
}
CONS_SHAPES = {
    "B": ("MBP", 1.0), "P": ("MBP", 1.0), "M": ("MBP", 0.95),
    "F": ("FV", 1.0), "V": ("FV", 0.95),
    "W": ("U", 0.90), "Y": ("EE", 0.50), "R": ("O", 0.35),
    "L": ("TLD", 0.65), "D": ("TLD", 0.45), "T": ("TLD", 0.45), "N": ("TLD", 0.40),
    "TH": ("TLD", 1.00), "DH": ("TLD", 0.90),
    "S": ("EE", 0.55), "Z": ("EE", 0.50),
    "SH": ("O", 0.40), "ZH": ("O", 0.40), "CH": ("O", 0.40), "JH": ("O", 0.40),
}
INVISIBLE = {"K", "G", "NG", "HH"}
STOPS = {"B", "P", "T", "D", "K", "G"}
NASALS = {"M", "N", "NG"}
FRIC = {"F", "V", "TH", "DH", "S", "Z", "SH", "ZH", "HH", "CH", "JH"}

VOWEL_DUR = {"1": 3.0, "2": 2.3, "0": 1.5}
CONS_DUR = {"stop": 0.8, "fric": 1.2, "nasal": 1.0, "other": 1.0}


def _cons_class(b: str) -> str:
    if b in STOPS:
        return "stop"
    if b in FRIC:
        return "fric"
    if b in NASALS:
        return "nasal"
    return "other"


def phoneme_durations(ph: list[str], span: float, hold: int, parts_vowel_idx: list[int] | None, min_closure: float) -> list[float]:
    """Split `span` seconds over the phonemes with vowel-weighted shares; held words stretch their vowels."""
    w = []
    vowel_pos = [k for k, p in enumerate(ph) if p.rstrip("012") in g2p.VOWELS]
    stretch_at = set()
    if hold and vowel_pos:
        if parts_vowel_idx:
            stretch_at = set(parts_vowel_idx)
        else:
            stretch_at = {vowel_pos[-1]}
    for k, p in enumerate(ph):
        b = p.rstrip("012")
        if b in g2p.VOWELS:
            st = p[-1] if p[-1] in "012" else "0"
            x = VOWEL_DUR[st]
            if k in stretch_at:
                x *= (1.0 + 2.2 * hold)
            w.append(x)
        else:
            w.append(CONS_DUR[_cons_class(b)])
    w = np.array(w, float)
    d = span * w / w.sum()
    # visible closures need a minimum time when the word is long enough
    need = 0.0
    for k, p in enumerate(ph):
        if p in ("B", "P", "M") and d[k] < min_closure:
            need += min_closure - d[k]
    if need > 0 and span > 3 * min_closure:
        vowels = [k for k in vowel_pos]
        if vowels:
            take = need / len(vowels)
            for k, p in enumerate(ph):
                if p in ("B", "P", "M") and d[k] < min_closure:
                    d[k] = min_closure
            for k in vowels:
                d[k] = max(0.02, d[k] - take)
            d *= span / d.sum()
    return d.tolist()


def part_vowels(ph: list, parts: list) -> list | None:
    """For a word written in parts ("Zom...bie..."): the vowel phoneme (index into ph) that belongs to each part, by letter share."""
    vowel_pos = [k for k, p in enumerate(ph) if p.rstrip("012") in g2p.VOWELS]
    if not parts or len(parts) < 2 or len(vowel_pos) < len(parts):
        return None
    tot = sum(len(p) for p in parts)
    out, cum = [], 0
    for p in parts:
        cum += len(p)
        target = cum / tot * len(vowel_pos)
        out.append(vowel_pos[min(len(vowel_pos) - 1, max(0, int(round(target)) - 1))])
    return out


def part_spans(spans: list, vidx: list, t0: float, t1: float) -> list:
    """Time span of every part: the boundary between two parts sits in the middle of the consonants between their vowels."""
    bounds = [t0]
    for a, b in zip(vidx[:-1], vidx[1:]):
        bounds.append(0.5 * (spans[a][1] + spans[b][0]))
    bounds.append(t1)
    return [(bounds[k], bounds[k + 1]) for k in range(len(vidx))]


def word_events(norm: str, t0: float, t1: float, hold: int, parts: list, voc: bool, min_closure: float, user_ph=None):
    """-> (phones, src, events, spans): events for the mouth, spans = (start, end) of every phoneme."""
    ph, src = g2p.phones(norm) if user_ph is None else (user_ph, "user")
    span = max(0.03, t1 - t0)
    parts_idx = part_vowels(ph, parts)
    dur = phoneme_durations(ph, span, hold, parts_idx, min_closure)
    events, spans = [], []
    t = t0
    for p, d in zip(ph, dur):
        b = p.rstrip("012")
        spans.append((t, t + d))
        if b in g2p.VOWELS:
            st = p[-1] if p[-1] in "012" else "0"
            emph = {"1": 1.0, "2": 0.9, "0": 0.75}[st]
            shapes = VOWEL_SHAPES[b]
            tt = t
            for v, w, share in shapes:
                events.append({"t": tt, "d": d * share, "v": v, "w": round(min(1.0, w * emph), 2)})
                tt += d * share
        elif b in CONS_SHAPES:
            v, w = CONS_SHAPES[b]
            events.append({"t": t, "d": d, "v": v, "w": w})
        t += d
    return ph, src, events, spans


def add_rests(words: list):
    """Rest events in real gaps between words (>= 120 ms) and after the last word."""
    for k, wd in enumerate(words):
        nxt = words[k + 1]["t0"] if k + 1 < len(words) else wd["t1"] + 0.5
        gap = nxt - wd["t1"]
        if gap >= 0.12:
            wd["events"].append({"t": wd["t1"], "d": gap, "v": "rest", "w": 1.0})


def generate(lyr, aligned_words: list, cfg: dict) -> list:
    out = []
    for lw, aw in zip(lyr.words, aligned_words):
        ph, src, ev, spans = word_events(lw.norm, aw["t0"], aw["t1"], lw.hold, lw.parts, lw.voc, cfg["min_closure_ms"] / 1000.0)
        rec = {"i": lw.gid, "t0": aw["t0"], "t1": aw["t1"], "phones": ph, "src": src, "events": ev}
        vidx = part_vowels(ph, lw.parts)
        if vidx:
            rec["parts"] = [{"text": txt, "t0": a, "t1": b} for txt, (a, b) in zip(lw.parts, part_spans(spans, vidx, aw["t0"], aw["t1"]))]
        out.append(rec)
    add_rests(out)
    lead = cfg.get("lead_ms", 0.0) / 1000.0
    for wd in out:
        for e in wd["events"]:
            e["t"] = round(e["t"] - lead, 3)
            e["d"] = round(e["d"], 3)
        wd["events"].sort(key=lambda e: e["t"])
    return out


def sample_mouth(events: list, fps: int, n_frames: int, attack=0.04, release=0.07) -> np.ndarray:
    """Reference sampler: per-frame weights of the 8 classes (rest implicit = what is left). Renderers can reimplement this in JS;
    see docs/TIMING_SCHEMA.md."""
    T = np.arange(n_frames) / fps
    M = np.zeros((n_frames, len(VISEMES)))
    idx = {v: k for k, v in enumerate(VISEMES)}
    for e in events:
        v = idx[e["v"]]
        t, d, w = e["t"], e["d"], e["w"]
        a = attack if e["v"] != "rest" else 0.06
        lo, hi = t - a, t + d + release
        i0, i1 = max(0, int(np.floor(lo * fps))), min(n_frames, int(np.ceil(hi * fps)) + 1)
        if i1 <= i0:
            continue
        x = T[i0:i1]
        env = np.clip(np.minimum((x - (t - a)) / a, 1.0), 0, 1) * np.clip(np.minimum(1.0, (t + d + release - x) / release), 0, 1)
        M[i0:i1, v] = np.maximum(M[i0:i1, v], w * env)
    s = M[:, 1:].sum(1)
    scale = np.where(s > 1.0, 1.0 / np.maximum(s, 1e-9), 1.0)
    M[:, 1:] *= scale[:, None]
    M[:, 0] = np.clip(1.0 - M[:, 1:].sum(1), 0, 1)
    return M


def run(ctx: Ctx) -> dict:
    cfg = ctx.cfg["visemes"]
    g2p.load_user_pron(ctx.out_dir / "pron.json")
    lyr = load_lyrics(ctx.lyrics)
    al = load_json(ctx.p("align.json"))
    with timer() as tm:
        aw = [{"t0": w["t"], "t1": w["t1"]} for w in al["words"]]
        words = generate(lyr, aw, cfg)
        dump_json(ctx.p("visemes.json"), {"viseme_set": VISEMES, "words": words}, indent=None, nd=3)
    n_l2s = sum(1 for w in words if w["src"] == "l2s")
    n_ev = sum(len(w["events"]) for w in words)
    ctx.log("visemes", f"{n_ev} viseme events for {len(words)} words ({n_l2s} words via letter-to-sound fallback) ({tm['dt']:.1f}s)")
    ctx.note_stage("visemes", tm["dt"], events=n_ev, l2s_words=n_l2s)
    return {"words": words}
