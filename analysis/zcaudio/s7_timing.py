"""Stage 7 - assemble data/timing.json from the stage outputs (schema: docs/TIMING_SCHEMA.md).

Reads   data/audio/{meta,align,beats,features}.json, the lyrics file, data/overrides.json (optional), data/pron.json (optional)
Writes  data/timing.json  (and re-runs the viseme generator on the *final* word times, so pins are honoured by the mouth events)

What happens here, in order:
  1. words / lines / sections are built from the lyrics structure and the aligned times;
  2. hand overrides are applied last (pinned words / lines, section boundaries, beat-grid fixes, vocalisations);
  3. sections get musical boundaries: `start` = the bar line the section is felt to begin on (a first word within `pickup_beats`
     before a bar line is a pickup to it), `end` = the bar line after the last sung word; gaps between sections become `instrumentals`;
  4. visemes are generated from the final word times; per-frame features and drum events are attached;
  5. a quality block lists what to check by ear (interpolated / low-confidence lines, guessed pronunciations, warnings);
  6. the result is validated (zcaudio.schema) before it is written.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import os

import numpy as np

from . import g2p, overrides as OV
from . import s6_visemes as V
from .common import PIPELINE_VERSION, SCHEMA_ID, Ctx, load_json, timer, write_pretty_json
from .lyrics import load_lyrics
from .schema import validate


def sanitize_words(words: list, duration: float, min_len: float = 0.02):
    """Final safety net: every word inside [0, duration], starts non-decreasing, t1 >= t0 + min_len (when room), no overlaps."""
    n = len(words)
    for w in words:
        w["t0"] = float(min(max(w["t0"], 0.0), duration))
        w["t1"] = float(min(max(w["t1"], w["t0"]), duration))
    for k in range(1, n):
        if words[k]["t0"] < words[k - 1]["t0"]:
            words[k]["t0"] = words[k - 1]["t0"]
            words[k]["t1"] = max(words[k]["t1"], words[k]["t0"])
    for k in range(n - 1):
        if words[k]["t1"] > words[k + 1]["t0"]:
            words[k]["t1"] = max(words[k]["t0"], words[k + 1]["t0"])
    for k in range(n):
        if words[k]["t1"] - words[k]["t0"] < min_len:
            nxt = words[k + 1]["t0"] if k + 1 < n else duration
            words[k]["t1"] = min(words[k]["t0"] + min_len, max(nxt, words[k]["t0"]))


# --------------------------------------------------------------------------------------------------------
# beats
# --------------------------------------------------------------------------------------------------------
def build_beats(bt: dict | None, ovb: dict, duration: float, bpb_default: int, notes: list):
    if bt is None:
        return [], [], [], {}, bpb_default
    bpb = int(bt.get("beats_per_bar", bpb_default))
    beats = np.array(bt["beats"], float)
    strength = np.array(bt.get("beat_strength", np.ones(len(beats))), float)
    ph = int(bt.get("downbeat_phase", 0))
    info = dict(bt.get("grid", {}))
    if ovb.get("constant"):
        c = ovb["constant"]
        P = 60.0 / float(c["bpm"])
        t0 = float(c["first_beat"])
        start = t0 - P * np.floor(t0 / P)                      # earliest beat in [0, P)
        beats = np.arange(start, duration + 1e-6, P)
        strength = np.ones(len(beats))
        fd = float(c.get("first_downbeat", t0))
        ph = int(np.argmin(np.abs(beats - fd))) % bpb
        info = {"override": "constant grid", "confidence": 1.0}
        notes.append(f"beat grid replaced by the constant grid from overrides.json ({c['bpm']} BPM, first beat {t0}s)")
    elif ovb.get("downbeat_shift"):
        sh = int(ovb["downbeat_shift"])
        ph = (ph + sh) % bpb
        notes.append(f"bar phase rotated by {sh} beat(s) (overrides.beats.downbeat_shift)")
    bars = beats[ph::bpb]
    return beats, bars, strength, info, bpb


# --------------------------------------------------------------------------------------------------------
# sections
# --------------------------------------------------------------------------------------------------------
def local_beat_s(bars: np.ndarray, t: float, beat_s: float, bpb: int = 4) -> float:
    """Beat length around time t taken from the neighbouring bar lines (the tempo may change between sections)."""
    if len(bars) < 2:
        return beat_s
    j = int(np.clip(np.searchsorted(bars, t), 1, len(bars) - 1))
    return float((bars[j] - bars[j - 1]) / bpb)


def musical_bounds(t_first: float, t_last: float, bars: np.ndarray, beat_s: float, duration: float, pickup_beats: float, bpb: int = 4):
    """(start, end) on bar lines around the sung extent [t_first, t_last]."""
    if len(bars) == 0:
        return t_first, t_last
    j = int(np.searchsorted(bars, t_first + 0.03))            # first bar line strictly after the first word (30 ms grace)
    prev = bars[j - 1] if j > 0 else None
    nxt = bars[j] if j < len(bars) else None
    if nxt is not None and (nxt - t_first) <= pickup_beats * local_beat_s(bars, t_first, beat_s, bpb):
        start = float(nxt)                                     # the first word is a pickup into the next bar
    elif prev is not None:
        start = float(prev)
    else:
        start = float(nxt) if nxt is not None else t_first
    k = int(np.searchsorted(bars, t_last - 0.15))              # first bar line at / after the end of the last word
    end = float(bars[k]) if k < len(bars) else duration
    if duration - end < bpb * beat_s:                          # less than a bar left: the section runs to the end of the file
        end = duration
    return start, max(end, start)


def build_sections(lyr, words, lines, bars, beat_s, duration, cfg, ovs, warn, bpb=4):
    secs = []
    pickup = float(cfg["sections"].get("pickup_beats", 2.0))
    for si, s in enumerate(lyr.sections):
        l0, l1 = s.lines[0], s.lines[-1] + 1
        w0, w1 = lines[l0]["word0"], lines[l1 - 1]["word1"]
        t0, t1 = words[w0]["t0"], words[w1 - 1]["t1"]
        start, end = musical_bounds(t0, t1, bars, beat_s, duration, pickup, bpb)
        secs.append({"i": si, "id": s.id, "name": s.name, "kind": s.kind, "index": s.index, "final": bool(s.final),
                     "direction": s.direction, "t0": t0, "t1": t1, "start": start, "end": end,
                     "line0": l0, "line1": l1, "word0": w0, "word1": w1})
    for k in range(len(secs) - 1):                             # a section never ends after the next one starts
        if secs[k]["end"] > secs[k + 1]["start"]:
            secs[k]["end"] = secs[k + 1]["start"]
    pins = {}
    for s in secs:
        pin = (ovs or {}).get(s["id"])
        if pin:
            if "start" in pin:
                s["start"] = float(pin["start"])
            if "end" in pin:
                s["end"] = float(pin["end"])
            s["pinned"] = True
            pins[s["id"]] = set(pin) & {"start", "end"}
    for key in (ovs or {}):
        if key not in {s["id"] for s in secs}:
            warn(f"override sections.{key}: no such section (ids: {', '.join(s['id'] for s in secs)})")
    # pins must not make sections overlap: the side that was not pinned gives way (both pinned: the earlier section's end yields)
    for s in secs:
        if s["end"] < s["start"]:
            warn(f"override sections.{s['id']}: end {s['end']:.2f}s is before start {s['start']:.2f}s - end set to start")
            s["end"] = s["start"]
    for k in range(len(secs) - 1):
        a, b = secs[k], secs[k + 1]
        if a["end"] > b["start"] + 1e-6:
            if "start" in pins.get(b["id"], ()) and "end" in pins.get(a["id"], ()):
                warn(f"overrides: {a['id']} ends at {a['end']:.2f}s but {b['id']} starts at {b['start']:.2f}s - {a['id']} end moved to {b['start']:.2f}s")
                a["end"] = b["start"]
            elif "start" in pins.get(b["id"], ()) or "end" not in pins.get(a["id"], ()):
                a["end"] = b["start"]
            else:
                b["start"] = min(a["end"], b["end"])
    for s in secs:
        if len(bars):
            s["bar0"] = int(np.argmin(np.abs(bars - s["start"])))
            s["bars"] = int(np.sum((bars >= s["start"] - 0.05) & (bars < s["end"] - 0.05)))
            s["pickup_beats"] = round(max(0.0, (s["start"] - s["t0"]) / local_beat_s(bars, s["start"], beat_s, bpb)), 2)
        else:
            s["bar0"], s["bars"], s["pickup_beats"] = None, None, 0.0
    return secs


def build_instrumentals(secs, bars, bar_s, duration):
    out = []
    edges = []
    prev_end, prev_id = 0.0, None
    for s in secs:
        edges.append((prev_end, s["start"], "intro" if prev_id is None else "between", prev_id, s["id"]))
        prev_end, prev_id = s["end"], s["id"]
    edges.append((prev_end, duration, "outro", prev_id, None))
    for a, b, where, after, before in edges:
        if b - a >= 1.5 * bar_s:
            r = {"t0": a, "t1": b, "where": where, "after": after, "before": before}
            if len(bars):
                r["bar0"] = int(np.argmin(np.abs(bars - a)))
                r["bars"] = int(round((b - a) / bar_s))
            out.append(r)
    return out


# --------------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------------
def run(ctx: Ctx) -> dict:
    cfg = ctx.cfg
    if ctx.lyrics is None or not ctx.lyrics.exists():
        raise SystemExit(f"lyrics file not found: {ctx.lyrics}")
    g2p.load_user_pron(ctx.out_dir / "pron.json")
    lyr = load_lyrics(ctx.lyrics)
    meta = load_json(ctx.p("meta.json"))
    al = load_json(ctx.p("align.json"))
    bt = load_json(ctx.p("beats.json"), default=None) if ctx.p("beats.json").exists() else None
    ft = load_json(ctx.p("features.json"), default=None) if ctx.p("features.json").exists() else None
    ov = OV.load(ctx)
    warn = ctx.note_warning
    notes: list = []
    duration = float(meta["duration"])
    with timer() as tm:
        lkeys = OV.line_keys(lyr)
        # ---- words
        words = []
        for lw, aw in zip(lyr.words, al["words"]):
            rec = {"i": lw.gid, "w": lw.text, "n": lw.norm, "t0": float(aw["t"]), "t1": float(aw["t1"]), "conf": float(aw["conf"]),
                   "src": aw["src"], "line": lw.line, "sec": lw.section}
            if lw.hold:
                rec["hold"] = int(lw.hold)
            if lw.bg:
                rec["bg"] = True
            if lw.voc:
                rec["voc"] = True
            if aw.get("snap_ms") is not None:
                rec["snap_ms"] = aw["snap_ms"]
            words.append(rec)
        pinned = OV.apply_words(words, lyr, ov, warn)
        sanitize_words(words, duration)
        if pinned:
            notes.append(f"{len(pinned)} word time(s) pinned by overrides.json")
        # ---- visemes on the final times
        vis = V.generate(lyr, [{"t0": w["t0"], "t1": w["t1"]} for w in words], cfg["visemes"])
        vset = V.VISEMES
        vidx = {v: k for k, v in enumerate(vset)}
        for w, vw in zip(words, vis):
            if vw.get("parts"):
                w["parts"] = [p["text"] for p in vw["parts"]]
                w["syl"] = [[round(p["t0"], 3), round(p["t1"], 3)] for p in vw["parts"]]
        # ---- lines
        lines = []
        for li, l in enumerate(lyr.lines):
            w0, w1 = l.words
            cs = [words[k]["conf"] for k in range(w0, w1)]
            lines.append({"i": li, "id": lkeys[li], "section": l.section, "text": l.text, "t0": words[w0]["t0"], "t1": words[w1 - 1]["t1"],
                          "word0": w0, "word1": w1, "conf": float(np.mean(cs))})
        # ---- beats & sections
        beats, bars, strength, binfo, bpb = build_beats(bt, ov.get("beats") or {}, duration, cfg["beats"]["beats_per_bar"], notes)
        if bt is not None and not (ov.get("beats") or {}).get("constant") and bt.get("bpm"):
            bpm = float(bt["bpm"])                                 # slope of the tracked curve (the median of frame-quantised intervals is biased)
        elif len(beats) > 2:
            bpm = 60.0 / float(np.mean(np.diff(beats)))
        else:
            bpm = 130.0
        beat_s = 60.0 / bpm
        sections = build_sections(lyr, words, lines, bars, beat_s, duration, cfg, ov.get("sections"), warn, bpb)
        instr = build_instrumentals(sections, bars, beat_s * bpb, duration)
        # ---- vocalisations (non-lyric voiced regions)
        if "vocalizations" in ov:
            vocs = [{"t0": float(v["t0"]), "t1": float(v["t1"]), "kind": v.get("kind", "vocal"), "src": "pinned"} for v in ov["vocalizations"]]
        else:
            vocs = [{"t0": v["t0"], "t1": v["t1"], "kind": "vocal", "src": v.get("src", "energy"), **({"text": v["text"]} if v.get("text") else {}),
                     **({"level_db": v["level_db"]} if v.get("level_db") is not None else {})} for v in al.get("vocalizations", [])]
        # ---- frames & drums
        if ft:
            frames = {"fps": ft["fps"], "n": ft["n"]}
            for k in ("sub", "bass", "lowmid", "mid", "high", "rms", "onset", "vocal"):
                frames[k] = ft["frames"][k]
            drums = {k: {"t": v["t"], "s": v["s"]} for k, v in ft["drums"].items()}
        else:
            n = int(np.ceil(duration * cfg["fps"]))
            frames = {"fps": cfg["fps"], "n": n, **{k: [0.0] * n for k in ("sub", "bass", "lowmid", "mid", "high", "rms", "onset", "vocal")}}
            drums = {k: {"t": [], "s": []} for k in ("kick", "clap", "hat")}
            warn("stage 5 (features) has not been run: frames are zeros and drums are empty")
        # ---- quality block
        n_words = len(words)
        cnt = {s: sum(1 for w in words if w["src"] == s) for s in ("asr", "interp", "pinned")}
        review = []
        for l in lines:
            ws = words[l["word0"]:l["word1"]]
            n_int = sum(1 for w in ws if w["src"] == "interp")
            why = []
            if l["conf"] < 0.5:
                why.append(f"low confidence ({l['conf']:.2f})")
            if n_int >= max(2, (len(ws) + 1) // 2):
                why.append(f"{n_int} of {len(ws)} words interpolated")
            elif ws[0]["src"] == "interp" and n_int >= 2:
                why.append("line start is interpolated")
            n_short = sum(1 for w in ws if w["src"] == "interp" and w["t1"] - w["t0"] < 0.08)
            if n_short >= 3:                                     # crammed between two anchors: text that is not sung, or a lyric / audio mismatch
                why.append(f"{n_short} of {len(ws)} words squeezed under 80 ms (not sung? the lyrics and the audio may differ here)")
            if why:
                review.append({"line": l["id"], "t0": round(l["t0"], 2), "why": "; ".join(why)})
        prons = []
        seen = set()
        for lw in lyr.words:
            if lw.norm in seen or lw.voc:
                continue
            seen.add(lw.norm)
            ph, src = g2p.phones(lw.norm)
            if src in ("l2s", "user"):
                prons.append({"word": lw.norm, "phones": " ".join(ph), "src": src})
        st = ctx.state()
        stage_secs = {k: v.get("seconds") for k, v in st.get("stages", {}).items()}
        quality = {
            "alignment": {"words": n_words, "asr_anchored": cnt["asr"], "interpolated": cnt["interp"], "pinned": cnt["pinned"],
                          "anchor_share": round(cnt["asr"] / max(1, n_words), 3), "low_conf_words": sum(1 for w in words if w["conf"] < 0.35),
                          **{k: v for k, v in (al.get("stats") or {}).items() if k in ("asr_words", "asr_unused", "demoted", "pruned", "weak_pairs")}},
            "beats": {k: binfo.get(k) for k in ("confidence", "beat_conf", "downbeat_conf", "kick_on_beat_share", "tempo_stability", "jitter_ms",
                                                 "deviation_from_constant_ms") if k in binfo},
            "review": review,
            "pronunciations_to_check": prons,
            "notes": notes,
            "warnings": ctx.all_warnings(),
            "stage_seconds": stage_secs,
        }
        tempo = {"bpm": round(bpm, 3), "beat_s": round(beat_s, 5), "beats_per_bar": bpb,
                 "bpm_range": [binfo.get("bpm_local_min"), binfo.get("bpm_local_max")] if binfo.get("bpm_local_min") else None,
                 "first_downbeat": round(float(bars[0]), 4) if len(bars) else None, "confidence": binfo.get("confidence"),
                 "downbeat_confidence": binfo.get("downbeat_conf"),
                 "deviation_from_constant_ms": binfo.get("deviation_from_constant_ms")}
        lyr_sha = hashlib.sha256(ctx.lyrics.read_bytes()).hexdigest()[:12]
        out = {
            "schema": SCHEMA_ID,
            "meta": {"song": os.path.basename(meta.get("source", "")), "duration": duration, "sample_rate": meta.get("sample_rate"),
                     "audio_id": meta.get("audio_id"), "container_start_s": (meta.get("probe") or {}).get("start_time"),
                     "lufs": meta.get("lufs"), "true_peak_dbtp": meta.get("true_peak_dbtp"),
                     "lyrics_file": ctx.lyrics.name, "lyrics_sha": lyr_sha, "fps": frames["fps"], "excerpt": meta.get("excerpt"),
                     "pipeline": PIPELINE_VERSION, "created": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "overrides": sorted(ov.keys())},
            "tempo": tempo,
            "beats": [round(float(b), 3) for b in beats],
            "beat_strength": [round(float(s), 2) for s in strength],
            "bars": [round(float(b), 3) for b in bars],
            "sections": sections,
            "instrumentals": instr,
            "lines": lines,
            "words": words,
            "visemes": {"set": vset, "words": [[[e["t"], e["d"], vidx[e["v"]], e["w"]] for e in vw["events"]] for vw in vis]},
            "vocalizations": vocs,
            "frames": frames,
            "drums": drums,
            "quality": quality,
        }
        # round for size (words: ms; sections: ms)
        for w in out["words"]:
            w["t0"], w["t1"], w["conf"] = round(w["t0"], 3), round(w["t1"], 3), round(w["conf"], 2)
        for l in out["lines"]:
            l["t0"], l["t1"], l["conf"] = round(l["t0"], 3), round(l["t1"], 3), round(l["conf"], 2)
        for s in out["sections"]:
            for k in ("t0", "t1", "start", "end"):
                s[k] = round(s[k], 3)
        for v in out["vocalizations"]:
            v["t0"], v["t1"] = round(v["t0"], 3), round(v["t1"], 3)
        for r in out["instrumentals"]:
            r["t0"], r["t1"] = round(r["t0"], 3), round(r["t1"], 3)
        problems = validate(out)
        if problems:
            for p in problems[:12]:
                ctx.warn("timing", f"schema: {p}")
            raise SystemExit(f"timing.json failed validation ({len(problems)} problem(s)); not written")
        write_pretty_json(ctx.out_dir / "timing.json", out, nd=3)
    ctx.log("timing", f"data/timing.json: {len(words)} words, {len(lines)} lines, {len(sections)} sections, {len(bars)} bars, "
                      f"{len(review)} line(s) flagged for review ({tm['dt']:.1f}s)")
    ctx.note_stage("timing", tm["dt"], words=len(words), review=len(review))
    return out
