"""Stage 3 - align the user's lyrics to the sung audio.

1. DP alignment of lyric words to the recognised words (dpalign.py): tolerant of ASR errors, extra vocalisations, gang doubles.
2. Recognised words whose time falls in vocal silence are demoted (ASR hallucinations / first-token-of-window quirk).
3. Unmatched lyric words are interpolated between anchors along *voiced time* (pauses take no time), weighted by phoneme
   durations and holds (ellipsis) - so a word is never smeared across a breath.
4. Every word start (and, more loosely, each line's first word) is snapped to a real vocal onset by a monotone DP.
5. Word ends come from the vocal energy envelope (mouth closes in gaps) and never pass the next word's start.
Outputs align.json (per-word t0/t1/conf/src) - lines/sections/visemes are assembled in stage 7.
"""
from __future__ import annotations

import bisect
from pathlib import Path

import numpy as np

from . import g2p
from .common import Ctx, dump_json, load_json, timer
from .dpalign import Params, asr_norm, align as dp_align
from .lyrics import Lyrics, is_voc, load_lyrics
from .sigproc import (_runs, frame_rms_db, load_mono, mask_to_segments, onset_curve, pick_peaks, voiced_mask)

ENV_SR = 22050
ENV_HOP = 110            # 5 ms
HOP_S = ENV_HOP / ENV_SR
ONSET_LAG_S = 0.0        # calibrated in validation (see README); flux peaks already sit at the rise


# --------------------------------------------------------------------------------------------------------
# envelopes of the vocal stem
# --------------------------------------------------------------------------------------------------------
def vocal_envelopes(vocals_path) -> dict:
    y, sr = load_mono(vocals_path, ENV_SR)
    db = frame_rms_db(y, sr, ENV_HOP, win=4 * ENV_HOP)
    mask, thr = voiced_mask(db, HOP_S, hyst_db=3.0, min_on=0.06, max_gap=0.10)
    env = onset_curve(y, sr, ENV_HOP)
    n = min(len(db), len(env))
    db, mask, env = db[:n], mask[:n], env[:n]
    ot, os_ = pick_peaks(env, HOP_S)
    ot = ot - ONSET_LAG_S
    # separation artefacts hugging the very start / end of the file (model edge effects) are not singing
    edge = int(round(0.35 / HOP_S))
    for a, b, v in _runs(mask):
        if v and ((a <= 2 and b - a < edge) or (b >= len(mask) - 2 and b - a < edge)):
            mask[a:b] = False
    segs = mask_to_segments(mask, HOP_S)
    V = np.concatenate([[0.0], np.cumsum(mask.astype(float)) * HOP_S])       # voiced time up to frame k
    return {"db": db, "mask": mask, "thr": thr, "env": env, "onset_t": ot, "onset_s": os_, "segs": segs, "V": V,
            "n": n, "dur": n * HOP_S}


def voiced_near(E, t: float, radius: float, min_seg: float = 0.10) -> bool:
    """Is there a (non-blip) voiced segment within `radius` seconds of t?"""
    for a, b in E["segs"]:
        if b - a >= min_seg and a - radius <= t <= b + radius:
            return True
    return False


def t_of_v(E, x: float, side: str) -> float:
    """Inverse of the cumulative voiced time: side='start' -> first time voiced-time exceeds x (beginning of a voiced run);
    side='end' -> last time voiced time is still below x (end of a voiced run)."""
    V = E["V"]
    k = np.searchsorted(V, x, side="right" if side == "start" else "left")
    k = int(np.clip(k, 1, len(V) - 1))
    # V[k] is the voiced time at the *end* of frame k-1; frame k-1 spans [(k-1)*HOP, k*HOP]
    if side == "start":
        return (k - 1) * HOP_S
    return k * HOP_S


def v_of_t(E, t: float) -> float:
    return float(np.interp(t / HOP_S, np.arange(len(E["V"])), E["V"]))


# --------------------------------------------------------------------------------------------------------
# word duration model (only *relative* durations matter for interpolation)
# --------------------------------------------------------------------------------------------------------
def dur_weight(norm: str, hold: int) -> float:
    ph = g2p.phones(norm)[0]
    w = 0.0
    for p in ph:
        b = p.rstrip("012")
        if b in g2p.VOWELS:
            w += 0.16 if p.endswith("1") else 0.10
        else:
            w += 0.06
    w = max(w, 0.12)
    return w * (1.0, 1.8, 2.6)[min(hold, 2)]


# --------------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------------
def align_words(lyr: Lyrics, asr_words: list, E: dict, cfg: dict, log=print) -> dict:
    N = len(lyr.words)
    prm = Params(gap_lyric=cfg["gap_lyric"], gap_asr=cfg["gap_asr"], gap_asr_voc=cfg["gap_asr_voc"], floor=cfg["sim_floor"])
    A = [asr_norm(a["w"]) for a in asr_words]
    keep_idx = [j for j, a in enumerate(A) if a]
    A_f = [A[j] for j in keep_idx]
    pairs, info = dp_align([w.norm for w in lyr.words], A_f, prm)

    W = []
    for w in lyr.words:
        W.append({"i": w.gid, "src": "interp", "t": None, "sim": 0.0, "j": None, "t_last": None, "conf": 0.0,
                  "wt": dur_weight(w.norm, w.hold), "snap_ms": None, "nlen": len(w.norm)})
    used_asr = set()
    weak_pairs = 0
    for li, ai, s in pairs:
        if s < cfg.get("anchor_sim", 0.62):
            # a phonetically similar but probably wrong recognised word: good for the DP's structure, not a trustworthy time
            weak_pairs += 1
            for q in ai:
                used_asr.add(keep_idx[q])
            continue
        j = keep_idx[ai[0]]
        a = asr_words[j]
        for k, i in enumerate(li):
            if k == 0:
                W[i].update(src="asr", t=float(a["t"]), sim=float(s), j=int(j), t_last=float(asr_words[keep_idx[ai[-1]]]["t_last"]))
            else:                                     # 2 lyric words glued into one recognised word: second one is placed after
                W[i].update(src="interp", sim=float(s) * 0.5)
        for q in ai:
            used_asr.add(keep_idx[q])

    # demote anchors that sit in vocal silence
    demoted = 0
    for wd in W:
        if wd["src"] == "asr" and not voiced_near(E, wd["t"], 0.20):
            wd.update(src="interp", tok_t=wd["t"], t=None, demoted=True)
            demoted += 1
    pruned = prune_squeezed(W, E, cfg)
    n_anchor = sum(1 for wd in W if wd["src"] == "asr")
    log(f"  DP matched {len(pairs)} pairs; anchors {n_anchor}/{N} (demoted {demoted} in silence, pruned {pruned} squeezed); ASR words {len(asr_words)}, unused {len(asr_words) - len(used_asr)}, weak {weak_pairs}")

    place_unmatched(lyr, W, E, cfg)
    snap_starts(lyr, W, E, cfg)
    word_ends(lyr, W, E, cfg)
    # confidence
    anchors = [k for k, wd in enumerate(W) if wd["src"] == "asr"]
    for k, wd in enumerate(W):
        if wd["src"] == "asr":
            wd["conf"] = 0.5 + 0.5 * min(1.0, (wd["sim"] - prm.floor) / (1 - prm.floor + 1e-9))
        else:
            d = min([abs(k - a) for a in anchors], default=99)
            wd["conf"] = 0.38 if d == 1 else (0.3 if d == 2 else 0.22)
        if wd.get("snap_ms") is not None:
            wd["conf"] = min(1.0, wd["conf"] + 0.05)
    stats = {"lyric_words": N, "anchors": n_anchor, "anchor_share": n_anchor / max(1, N), "asr_words": len(asr_words),
             "asr_unused": len(asr_words) - len(used_asr), "demoted": demoted, "pruned": pruned, "weak_pairs": weak_pairs, "dp_score": info["score"]}
    unused = [{"j": j, "w": asr_words[j]["w"], "t": asr_words[j]["t"]} for j in range(len(asr_words)) if j not in used_asr]
    return {"words": W, "stats": stats, "asr_unused": unused}


def prune_squeezed(W: list, E: dict, cfg: dict) -> int:
    """A recognised word that is a wrong match (a mangled word matched to a similar lyric word far from where it is sung) leaves the lyric
    words between it and its neighbour anchor no room: e.g. seven words in half a second of voiced time.  Such an anchor is dropped
    (the one with the weaker match, or the two nearest) if that gives the run room, so its words are placed by the gap logic instead.
    If dropping one or two anchors does not help, the run itself is the odd one out (text the singer skipped, a repeated section that is
    sung once): the anchors are kept, and the run is crammed into what room there is (it then shows as low-confidence words)."""
    factor = float(cfg.get("squeeze_factor", 0.6))
    n_pruned = 0
    N = len(W)
    keep = set()                                                 # runs (a, b) judged to be unsung text: left alone

    def room(a, b):
        """(need, have) of the words strictly between anchors a and b (None = song edge)"""
        lo, hi = (0 if a is None else a + 1), (N if b is None else b)
        t_lo = 0.0 if a is None else W[a]["t"] + 0.08
        t_hi = E["dur"] if b is None else W[b]["t"]
        return factor * sum(W[q]["wt"] for q in range(lo, hi)), v_of_t(E, t_hi) - v_of_t(E, t_lo)

    def fits(a, b):
        need, have = room(a, b)
        return have >= need

    def weakness(x):
        return W[x]["sim"] * min(1.0, (W[x]["nlen"] + 1) / 7.0)      # short common words ("and", "the") match by chance far more often

    for _ in range(N):
        idx = [k for k, wd in enumerate(W) if wd["src"] == "asr"]
        victims = None
        for p in range(len(idx) + 1):
            a = idx[p - 1] if p > 0 else None
            b = idx[p] if p < len(idx) else None
            lo, hi = (0 if a is None else a + 1), (N if b is None else b)
            if hi - lo < 3 or (a, b) in keep:
                continue
            if fits(a, b):
                continue
            options = []                                         # (anchors dropped, their weakness, which)
            for kk in (1, 2):                                    # drop the anchor(s) after the run ...
                if b is not None and p + kk <= len(idx):
                    nb = idx[p + kk] if p + kk < len(idx) else None
                    if fits(a, nb):
                        options.append((kk, sum(weakness(x) for x in idx[p:p + kk]), idx[p:p + kk]))
                        break
            for kk in (1, 2):                                    # ... or the anchor(s) before it
                if a is not None and p - kk >= 0:
                    na = idx[p - kk - 1] if p - kk - 1 >= 0 else None
                    if fits(na, b):
                        options.append((kk, sum(weakness(x) for x in idx[p - kk:p]), idx[p - kk:p]))
                        break
            if not options:
                keep.add((a, b))
                continue
            victims = min(options, key=lambda o: (o[0], o[1]))[2]
            break
        if victims is None:
            break
        for x in victims:
            W[x].update(src="interp", t=None, pruned=True)
            n_pruned += 1
    return n_pruned


def local_sigma(W: list, k: int, default=1.4) -> float:
    """Sung-duration / model-duration ratio around word k (from consecutive anchored words in the same line)."""
    rs = []
    lo, hi = max(0, k - 40), min(len(W) - 1, k + 40)
    for i in range(lo, hi):
        a, b = W[i], W[i + 1]
        if a["src"] == "asr" and b["src"] == "asr" and 0.05 < b["t"] - a["t"] < 1.0 and a.get("line") == b.get("line"):
            rs.append((b["t"] - a["t"]) / max(a["wt"], 0.05))
    if len(rs) >= 4:
        return float(np.clip(np.median(rs), 0.7, 3.0))
    return default


def _spread_voiced(W: list, ks: list, segs: list, w: np.ndarray):
    """Words spread over the concatenated voiced segments, proportional to their weights (pauses take no time)."""
    dur = np.array([b - a for a, b in segs])
    tot = float(dur.sum())
    cum_seg = np.concatenate([[0.0], np.cumsum(dur)])
    cw = np.concatenate([[0.0], np.cumsum(w)])
    for q, kk in enumerate(ks):
        x = tot * cw[q] / max(cw[-1], 1e-9)                          # voiced time at the start of word q
        s = int(np.clip(np.searchsorted(cum_seg, x, side="right") - 1, 0, len(segs) - 1))
        W[kk]["t"] = float(segs[s][0] + min(x - cum_seg[s], dur[s]))
        W[kk]["seg"] = s


def place_gap(lyr: Lyrics, W: list, E: dict, ks: list, t_lo: float, t_hi: float, sigma: float, min_w: float):
    """Place unmatched words `ks` (consecutive indices) inside [t_lo, t_hi]. The voiced segments of the gap are the slots; a small
    DP assigns consecutive groups of words to consecutive segments so that each segment's length matches the words' expected sung
    length, breaks fall on line boundaries where possible, and voiced segments with no words (moans, echoes) are penalised by their
    length. Words in a segment are spread over it by weight."""
    k = len(ks)
    segs = []
    virt = []                                                    # True for token slots (no voiced frames)
    for a, b in E["segs"]:
        a2, b2 = max(a, t_lo), min(b, t_hi)
        if b2 - a2 >= 0.05:
            segs.append((a2, b2))
            virt.append(False)
    # Token slots: a recognised word demoted because its token fell in silence is often right when the voice detector missed a soft
    # onset (plosive, breath) - the voiced run then starts a little after the token.  Offer the stretch from the token to that
    # voiced start as a slot, so the word is not forced into some unrelated voiced segment (a moan, an echo) earlier in the gap.
    for kk in ks:
        tt = W[kk].get("tok_t")
        if tt is None or not (t_lo - 0.02 <= tt <= t_hi):
            continue
        nxt = next((a for a, b in E["segs"] if b > tt), None)
        if nxt is None or nxt <= tt or nxt - tt > 0.45 or any(a <= tt <= b for a, b in E["segs"]):
            continue
        e2 = min(nxt - 0.02, t_hi - 0.05)
        if e2 - tt >= 0.08:
            segs.append((float(tt), float(e2)))
            virt.append(True)
    if len(segs) > 1:
        order = sorted(range(len(segs)), key=lambda q: segs[q])
        segs = [segs[q] for q in order]
        virt = [virt[q] for q in order]
        for q in range(1, len(segs)):                            # slots must not overlap
            if segs[q][0] < segs[q - 1][1]:
                segs[q] = (segs[q - 1][1], max(segs[q][1], segs[q - 1][1] + 0.02))
    if not segs or t_hi - t_lo < 0.02:
        # linear fallback
        for q, kk in enumerate(ks):
            W[kk]["t"] = float(t_lo + (t_hi - t_lo) * q / k)
        return
    m = len(segs)
    dur = np.array([b - a for a, b in segs])
    w = np.array([W[kk]["wt"] for kk in ks]) * sigma
    cw = np.concatenate([[0.0], np.cumsum(w)])
    G = min(k, max(30, 2 * int(np.ceil(k / m))))                # most words one slot may take (always enough to place all k)
    if m * k * G > 3_000_000:
        # far more words than the audio can hold (lyrics of a different song, or a short excerpt): no fine slot assignment is
        # meaningful, spread the words over the voiced time of the gap
        _spread_voiced(W, ks, segs, w)
        return
    line_start = [(ks[0] == 0) or lyr.words[ks[0]].line != lyr.words[ks[0] - 1].line] + [lyr.words[ks[q]].line != lyr.words[ks[q - 1]].line for q in range(1, k)]
    contig0 = segs[0][0] <= t_lo + 0.03
    contigN = segs[-1][1] >= t_hi - 0.03
    INF = 1e18
    lam_d, lam_empty, mu_split, lam_early, lam_tail = 1.0, 0.8, 0.55, 4.0, 0.6
    # Voiced material the words cannot account for (moans, echoes) may stay empty cheaply - but only when there clearly is more voiced
    # time than the words need.  When the words just about fill the voiced time (speech-like or staccato delivery: every word its own
    # short segment), a segment left empty means a word is misplaced, so leaving one empty is expensive.
    voiced_total = float(sum(d_ for d_, v_ in zip(dur, virt) if not v_))
    ratio = voiced_total / max(float(cw[-1]), 0.25)
    surplus = float(np.clip((ratio - 1.25) / 0.6, 0.0, 1.0))
    lam_full = 2.5 * (1.0 - surplus)
    # a recognised word whose time fell in silence was emitted *early* by the recogniser (never late): it cannot sit in a voiced
    # segment that ends before that token time
    tmin = np.array([(W[kk]["tok_t"] - 0.15) if W[kk].get("tok_t") is not None else -1e9 for kk in ks])
    f = np.full((m + 1, k + 1), INF)
    bp = np.zeros((m + 1, k + 1), dtype=np.int32)
    f[0, 0] = 0.0
    for s in range(m):
        d = dur[s]
        for q in range(k + 1):
            base = f[s, q]
            if base >= INF:
                continue
            for g in range(0, min(G, k - q) + 1):
                if g == 0:
                    c = 0.0 if virt[s] else lam_empty * max(0.0, d - 0.15) + lam_full * min(d, 0.8)
                else:
                    wsum = cw[q + g] - cw[q]
                    c = lam_d * (np.log((d + 0.08) / (wsum + 0.08))) ** 2
                    # a segment break in front of this group: free at a line start, penalised inside a line
                    at_anchor_edge = (q == 0 and s == 0 and contig0)
                    if not at_anchor_edge and not line_start[q]:
                        c += mu_split
                    c += lam_early * float(np.sum(tmin[q:q + g] > segs[s][1]))
                    if s == 0 and contig0 and line_start[q] and q > 0 or (s == 0 and contig0 and line_start[q] and ks[0] > 0):
                        c += lam_tail                    # a new line rarely starts inside the sustain of the previous word
                if base + c < f[s + 1, q + g]:
                    f[s + 1, q + g] = base + c
                    bp[s + 1, q + g] = g
    if f[m, k] >= INF:
        _spread_voiced(W, ks, segs, w)
        return
    # backtrack
    groups = [0] * m
    q = k
    for s in range(m, 0, -1):
        g = int(bp[s, q])
        groups[s - 1] = g
        q -= g
    pos = 0
    for s in range(m):
        g = groups[s]
        if g == 0:
            continue
        a, b = segs[s]
        ww = cw[pos + g] - cw[pos]
        cum = (cw[pos:pos + g] - cw[pos]) / max(ww, 1e-9)
        for r in range(g):
            W[ks[pos + r]]["t"] = float(a + cum[r] * (b - a))
            W[ks[pos + r]]["seg"] = s
        pos += g
    # keep strictly increasing
    for q in range(1, k):
        if W[ks[q]]["t"] < W[ks[q - 1]]["t"] + min_w * 0.5:
            W[ks[q]]["t"] = W[ks[q - 1]]["t"] + min_w * 0.5


def place_unmatched(lyr: Lyrics, W: list, E: dict, cfg: dict):
    N = len(W)
    min_w = cfg["min_word_ms"] / 1000.0
    for k, wd in enumerate(W):
        wd["line"] = lyr.words[k].line
    idx = [k for k, wd in enumerate(W) if wd["src"] == "asr"]
    dur = E["dur"]

    ot_, os_ = E["onset_t"], E["onset_s"]
    line_last = {ln.words[1] - 1 for ln in lyr.lines}

    def anchor_end(k, t_next):
        wd = W[k]
        e = max(wd["t"] + 0.9 * wd["wt"], (wd["t_last"] or wd["t"]) + 0.08, wd["t"] + 0.08)
        if k in line_last or lyr.words[k].hold:
            # a held final note: the voiced run that goes on after the word without a fresh onset is its sustain, not free slot time
            for a, b in E["segs"]:
                if a - 0.05 <= e <= b + 0.05 and b - e >= 0.25:
                    m = (ot_ > e + 0.15) & (ot_ < b - 0.12) & (os_ >= 0.55)
                    e = float(ot_[m][0] - 0.03) if m.any() else float(b)
                    break
        return min(e, max(wd["t"] + 0.05, t_next - 0.05))

    if not idx:
        place_gap(lyr, W, E, list(range(N)), 0.0, dur, local_sigma(W, 0), min_w)
        return
    if idx[0] > 0:
        ks = list(range(0, idx[0]))
        place_gap(lyr, W, E, ks, 0.0, W[idx[0]]["t"], local_sigma(W, idx[0]), min_w)
    for a, b in zip(idx[:-1], idx[1:]):
        ks = list(range(a + 1, b))
        if ks:
            t_lo = anchor_end(a, W[b]["t"])
            place_gap(lyr, W, E, ks, t_lo, W[b]["t"], local_sigma(W, a), min_w)
    if idx[-1] < N - 1:
        ks = list(range(idx[-1] + 1, N))
        a = idx[-1]
        place_gap(lyr, W, E, ks, anchor_end(a, dur), dur, local_sigma(W, a), min_w)
    for k in range(1, N):                                       # monotone guard
        if W[k]["t"] < W[k - 1]["t"] + 0.01:
            W[k]["t"] = W[k - 1]["t"] + 0.01


def snap_starts(lyr: Lyrics, W: list, E: dict, cfg: dict):
    """Monotone DP that moves each word start to a vocal onset near its estimate (or leaves it)."""
    if not cfg.get("snap", True):
        return
    N = len(W)
    ot, os_ = E["onset_t"], E["onset_s"]
    seg_starts = np.array([a for a, b in E["segs"]])
    first_of_line = {lyr.lines[w.line].words[0] for w in lyr.words}
    win = cfg["onset_window_ms"] / 1000.0
    back = cfg["phrase_start_back_ms"] / 1000.0
    min_gap = 0.02
    opts = []                                                    # per word: list of (time, reward)
    for k, wd in enumerate(W):
        p = wd["t"]
        first = k in first_of_line
        interp = wd["src"] != "asr"
        lo = win if first else (0.06 if interp else win)
        hi = 0.12 if first else (0.06 if interp else win)
        sigma = 0.25 if first else (0.06 if interp else 0.08)
        cand = [(p, 0.0, None)]
        m = (ot >= p - lo) & (ot <= p + hi)
        for t, s in zip(ot[m], os_[m]):
            if interp and s < 0.4:
                continue
            r = float(s) - 0.5 * ((t - p) / sigma) ** 2
            cand.append((float(t), r, float(t - p)))
        if first:                                                # onset after a pause is the phrase start
            m2 = (seg_starts >= p - back) & (seg_starts <= p + hi)
            for t in seg_starts[m2]:
                r = 0.9 + 0.35 - 0.5 * ((t - p) / sigma) ** 2
                cand.append((float(t), r, float(t - p)))
        opts.append(cand)
    # Viterbi
    prev_scores = [c[1] for c in opts[0]]
    back_ptr = []
    for k in range(1, N):
        cur = []
        ptr = []
        for (t, r, d) in opts[k]:
            best, bi = -1e18, 0
            for q, (t0, r0, d0) in enumerate(opts[k - 1]):
                if t - t0 >= min_gap and prev_scores[q] > best:
                    best, bi = prev_scores[q], q
            if best < -1e17:                                       # no compatible predecessor: allow with heavy penalty
                bi = int(np.argmax(prev_scores))
                best = prev_scores[bi] - 5.0
            cur.append(best + r)
            ptr.append(bi)
        back_ptr.append(ptr)
        prev_scores = cur
    q = int(np.argmax(prev_scores))
    choice = [0] * N
    for k in range(N - 1, -1, -1):
        choice[k] = q
        if k > 0:
            q = back_ptr[k - 1][q]
    for k, wd in enumerate(W):
        t, r, d = opts[k][choice[k]]
        wd["t_pre_snap"] = wd["t"]
        wd["t"] = float(t)
        wd["snap_ms"] = None if d is None else round(d * 1000, 1)
    for k in range(1, N):                                          # safety
        if W[k]["t"] < W[k - 1]["t"] + 0.02:
            W[k]["t"] = W[k - 1]["t"] + 0.02


def word_ends(lyr: Lyrics, W: list, E: dict, cfg: dict):
    N = len(W)
    db = E["db"]
    max_w = cfg["max_word_s"]
    min_w = cfg["min_word_ms"] / 1000.0
    for k, wd in enumerate(W):
        t0 = wd["t"]
        hold = lyr.words[k].hold
        nxt = W[k + 1]["t"] if k + 1 < N else E["dur"]
        cap = t0 + (max_w * (1.8 if hold else 1.0))
        limit = min(nxt, cap)
        a = int(t0 / HOP_S)
        b = max(a + 2, int(limit / HOP_S))
        seg = db[a:b]
        if len(seg) < 3:
            wd["t1"] = float(max(t0 + min_w, min(limit, t0 + min_w)))
            continue
        pk = np.max(seg)
        loud = np.where(seg >= pk - 14.0)[0]
        last_loud = loud[-1] if len(loud) else len(seg) - 1
        t_rel = (a + last_loud + 1) * HOP_S
        # a word ends where its own voiced run ends - sound after a silence (a moan, an echo, the next phrase) is not part of it
        run_end = next((b_ for a_, b_ in E["segs"] if a_ - 0.05 <= t0 <= b_ + 0.02), None)
        if run_end is not None and run_end < limit - 0.07:
            t_rel = min(t_rel, run_end)
            t1 = t_rel + 0.03
            t1 = min(max(t1, t0 + min_w), max(limit, t0 + min_w))
            wd["t1"] = float(t1)
            continue
        if limit - t_rel >= 0.07 and pk - seg[-1] > 6.0:
            t1 = t_rel + 0.03                                       # release then silence
        else:
            t1 = limit                                              # legato into the next word
        # never shorter than the minimum, never past the limit
        t1 = min(max(t1, t0 + min_w), max(limit, t0 + min_w))
        wd["t1"] = float(t1)
    for k in range(N - 1):                                          # no overlaps
        if W[k]["t1"] > W[k + 1]["t"]:
            W[k]["t1"] = max(W[k]["t"] + 0.02, W[k + 1]["t"])


def find_vocalizations(lyr: Lyrics, W: list, E: dict, asr_unused: list) -> list:
    """Voiced regions that no lyric word explains (moans, ooh, laughs, stray gang shouts)."""
    spans = sorted((wd["t"] - 0.06, wd["t1"] + 0.06) for wd in W)
    out = []
    db = E["db"]
    ref = np.percentile(db[E["mask"]], 90) if E["mask"].any() else 0.0
    for a, b in E["segs"]:
        # subtract word spans from the segment
        cur = a
        free = []
        for s, e in spans:
            if e <= cur or s >= b:
                continue
            if s > cur:
                free.append((cur, min(s, b)))
            cur = max(cur, e)
            if cur >= b:
                break
        if cur < b:
            free.append((cur, b))
        for s, e in free:
            if e - s >= 0.25:
                lv = float(np.mean(db[int(s / HOP_S):int(e / HOP_S) + 1]))
                if lv > ref - 20:
                    out.append({"t0": round(s, 3), "t1": round(e, 3), "level_db": round(lv - ref, 1), "src": "energy"})
    # recognised vocalisation tokens (ooh / ah ...) that were skipped
    for u in asr_unused:
        if is_voc(asr_norm(u["w"])) and voiced_near(E, u["t"], 0.1):
            if not any(o["t0"] - 0.1 <= u["t"] <= o["t1"] + 0.1 for o in out):
                out.append({"t0": round(u["t"], 3), "t1": round(u["t"] + 0.3, 3), "level_db": None, "src": "asr", "text": u["w"]})
    return sorted(out, key=lambda o: o["t0"])


def run(ctx: Ctx) -> dict:
    cfg = ctx.cfg["align"]
    if ctx.lyrics is None or not ctx.lyrics.exists():
        raise SystemExit(f"lyrics file not found: {ctx.lyrics}")
    g2p.load_user_pron(ctx.out_dir / "pron.json")
    lyr = load_lyrics(ctx.lyrics)
    asr = load_json(ctx.p("asr.json"))
    meta = load_json(ctx.p("meta.json"), default={})
    with timer() as tm:
        E = vocal_envelopes(ctx.p("vocals.wav"))
        if meta.get("duration"):
            E["dur"] = min(E["dur"], float(meta["duration"]))                  # the envelope frames may overshoot the file by a hop
        res = align_words(lyr, asr["words"], E, cfg, log=lambda s: ctx.log("align", s))
        voc = find_vocalizations(lyr, res["words"], E, res["asr_unused"])
        out = {"words": res["words"], "stats": res["stats"], "vocalizations": voc, "asr_unused": res["asr_unused"],
               "voiced_segments": [[round(a, 3), round(b, 3)] for a, b in E["segs"]],
               "onsets": [[round(float(t), 3), round(float(s), 2)] for t, s in zip(E["onset_t"], E["onset_s"])],
               "vad_thr_db": round(float(E["thr"]), 1)}
        dump_json(ctx.p("align.json"), out, indent=None, nd=4)
    st = res["stats"]
    ctx.log("align", f"{st['anchors']}/{st['lyric_words']} lyric words anchored to the recognised words ({100 * st['anchor_share']:.0f}%), "
                     f"{len(voc)} non-lyric vocalisations ({tm['dt']:.1f}s)")
    if st["anchor_share"] < 0.35:
        ctx.note_warning(f"only {100 * st['anchor_share']:.0f}% of the lyric words matched the recognised words - the lyrics may not match "
                         "the audio, or the vocals are hard to recognise; word times are mostly interpolated (see README: overrides)")
    ctx.note_stage("align", tm["dt"], **st)
    return out
