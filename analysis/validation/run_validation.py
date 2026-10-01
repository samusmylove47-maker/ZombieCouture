#!/usr/bin/env python3
"""Validation suite for the audio pipeline.  Everything runs on the previous project's song ("Upping My P(Bloom)") and its ground
truth (line starts + bar grid, see pbloom_gt.py for what that truth is and is not) or on synthetic tracks with exact truth.

  python3 validation/run_validation.py [--parts main,synth,lyrics,audio,wrong,tts] [--out validation/results.json]

parts
  main    metrics of the full P(Bloom) run in validation/pbloom/data (refreshed first: stages 0-8, cached ones skipped; the very first time
          this separates the vocals, 6 min)
  synth   beats / downbeats / drum events on synthetic bubblegum tracks (constant tempo, drift, other tempi) with exact truth
  lyrics  robustness to wrong lyric text: 3 dropped words, inserted vocalisations, misspelt words
  audio   robustness to a perturbed vocal stem: stacked (gang) doubles, spliced moans, hiss, instrument bleed
  wrong   the other song's lyrics on this audio: must degrade loudly (warning) and still write a valid timing.json
  tts     the Zombie Couture lyrics spoken by espeak-ng on a synthetic backing (tts_song.py) with exact word-level truth; runs the whole
          pipeline into validation/tts/data (stage 1 included the first time, about 6 min; later stages 0-8 are refreshed in ~25 s).
          Needs `pip install espeakng-loader` only when validation/tts/song.wav has to be (re)built.
Heavy stages run under nice -n 19 with one thread; the variants reuse the base run's stems / ASR by hard links.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
import pbloom_gt as G                               # noqa: E402
from eval_beats import beat_metrics, nearest        # noqa: E402
from eval_drums import match as drum_match          # noqa: E402
from zcaudio.lyrics import parse_lyrics             # noqa: E402
from zcaudio.schema import validate                 # noqa: E402

SONG = G.SONG
BASE = HERE / "pbloom" / "data"
LYR = HERE / "pbloom" / "lyrics.txt"
ZC_LYR = ROOT.parent / "data" / "lyrics.txt"
ENV = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1", NUMBA_NUM_THREADS="1", TOKENIZERS_PARALLELISM="false")


def sh_stages(out_dir, song, lyrics, stages, extra=()):
    cmd = ["nice", "-n", "19", sys.executable, "-m", "zcaudio", "run", "--song", str(song), "--lyrics", str(lyrics), "--out", str(out_dir),
           "--stages", stages, "--quiet", *extra]
    t0 = time.time()
    r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{r.stdout}\n{r.stderr}")
    return time.time() - t0, r.stderr


def variant_dir(name, copy=(), skip=()):
    """hard-linked copy of the base audio dir (large files shared, JSON copied when listed in `copy`)"""
    d = HERE / "variants" / name / "data"
    if d.parent.exists():
        subprocess.run(["rm", "-rf", str(d.parent)])
    (d / "audio").mkdir(parents=True)
    for f in (BASE / "audio").iterdir():
        if f.is_dir() or f.name in skip or f.name in ("state.json", "sheet.png", "sheet.html"):
            continue
        dst = d / "audio" / f.name
        if f.name in copy:
            dst.write_bytes(f.read_bytes())
        else:
            os.link(f, dst)
    return d


def load_timing(d):
    return json.load(open(Path(d) / "timing.json"))


# ------------------------------------------------------------------------------------------------------------------ main
def line_metrics(timing):
    gt = G.load()
    err = {"checked": [], "vocal": [], "grid": []}
    for k, l in enumerate(timing["lines"]):
        g = gt["lines"][k]
        err[g["src"]].append(l["t0"] - g["t"])
    out = {k: G.stats(v) for k, v in err.items()}
    out["all"] = G.stats(sum(err.values(), []))
    return out


def main_metrics():
    t = load_timing(BASE)
    gt = G.load()
    out = {"lines_vs_gt": line_metrics(t)}
    beats, bars = np.array(t["beats"]), np.array(t["bars"])
    # bar phase / tempo
    gbars = gt["bar0"] + gt["bar"] * np.arange(int((gt["duration"] - gt["bar0"]) / gt["bar"]))
    j = np.abs(gbars[:, None] - beats[None, :]).argmin(1)
    ok = np.abs(beats[j] - gbars) < 0.5 * t["tempo"]["beat_s"]
    ph = int(np.argmin(np.abs(beats - bars[0]))) % 4
    is_down = (j % 4 == ph)
    d = nearest(gbars, bars)
    out["beats"] = {"bpm": t["tempo"]["bpm"], "gt_bpm": round(gt["bpm"], 3), "bpm_err": round(t["tempo"]["bpm"] - gt["bpm"], 3),
                    "gt_bars_that_are_my_downbeats": round(float(is_down[ok].mean()), 3), "n_gt_bars": int(len(gbars)),
                    "my_bar_minus_gt_bar_ms": {"median": round(float(np.median(d) * 1000), 1), "p10": round(float(np.percentile(d, 10) * 1000), 1),
                                               "p90": round(float(np.percentile(d, 90) * 1000), 1), "min": round(float(d.min() * 1000), 1), "max": round(float(d.max() * 1000), 1)},
                    "note": "the GT bar grid has a constant tempo; the song's tempo wanders by up to +-150 ms around it, so the differences are the "
                            "song's drift, not tracker error (kicks confirm: see README)"}
    # inside the stretch where the constant GT grid is valid (40-120 s) the two agree to a few ms
    m = (gbars > 40) & (gbars < 120)
    out["beats"]["my_bar_minus_gt_bar_ms_40_120s"] = {"median": round(float(np.median(d[m]) * 1000), 1), "max_abs": round(float(np.abs(d[m]).max() * 1000), 1)}
    # sections
    mine = {s["id"]: s for s in t["sections"]}
    rows = []
    kmap = {"intro": "intro1", "verse1": "verse1", "pre1": "prechorus1", "chorus1": "chorus1", "verse2": "verse2", "pre2": "prechorus2", "chorus2": "chorus2",
            "dance": "break1", "verse3": "verse3", "bridge": "bridge1", "final": "chorus3", "outro": "outro1"}
    for g in gt["sections"]:
        m_ = mine[kmap[g["id"]]]
        if g["start_bar"] is None:
            continue
        rows.append({"section": g["id"], "gt_bar": g["start_bar"], "bar": m_["bar0"], "d_bar": m_["bar0"] - g["start_bar"], "start_err_s": round(m_["start"] - g["start_s"], 2)})
    db = np.array([r["d_bar"] for r in rows])
    out["sections"] = {"n": len(rows), "same_bar": int((db == 0).sum()), "within_1_bar": int((np.abs(db) <= 1).sum()), "rows": rows,
                       "note": "the GT outro starts where the last chorus ends, mine where the first outro word is sung (definition difference)"}
    a = json.load(open(BASE / "audio" / "align.json"))
    out["alignment"] = a["stats"]
    # internal consistency: word starts on vocal onsets
    on = np.array([o[0] for o in a["onsets"] if o[1] >= 0.4])
    ws = np.array([w["t0"] for w in t["words"]])
    dd = np.abs(nearest(ws, on))
    out["word_starts_within_50ms_of_a_vocal_onset"] = round(float((dd <= 0.05).mean()), 3)
    out["timing_json_valid"] = validate(t) == []
    return out


# ------------------------------------------------------------------------------------------------------------------ synth
def synth_run(name, bpm, drift, dur, pickup, tempo_map=None):
    import synth as S
    import soundfile as sf
    d = HERE / "synth"
    d.mkdir(exist_ok=True)
    wav, tj = d / f"{name}.wav", d / f"{name}.json"
    x, truth = S.make(bpm, drift, dur, pickup, tempo_map=tempo_map)
    sf.write(wav, x, S.SR, subtype="PCM_16")
    json.dump(truth, open(tj, "w"))
    out = d / f"{name}_data"
    sh_stages(out, wav, ZC_LYR, "0,4,5")
    b = json.load(open(out / "audio" / "beats.json"))
    f = json.load(open(out / "audio" / "features.json"))
    res = beat_metrics(b["beats"], truth["beats"], b["bars"], truth["downbeats"])
    res["bpm_est"], res["bpm_truth"] = b["bpm"], round(60 / float(np.mean(np.diff(truth["beats"]))), 3)
    res["confidence"] = b["grid"]["confidence"]
    res["drums"] = {k: drum_match(f["drums"][k]["t"], truth[k], 0.03) for k in ("kick", "clap", "hat")}
    (d / f"{name}.wav").unlink(missing_ok=True)
    return res


def synth_metrics():
    return {"const128": synth_run("const128", 128.0, 0.0, 48.0, 0.35),
            "drift126to134": synth_run("drift", 126.0, 8.0, 90.0, 0.60),
            "const100": synth_run("const100", 100.0, 0.0, 48.0, 0.20),
            "const145": synth_run("const145", 145.0, 0.0, 48.0, 0.50),
            "steps124_134_116": synth_run("steps", 124.0, 0.0, 115.0, 0.40, tempo_map=[(0, 124.0), (38, 134.0), (76, 116.0)])}


# ------------------------------------------------------------------------------------------------------------------ lyrics
def word_map(base_words, var_words):
    """indices of baseline words that survive unchanged in the variant -> variant index"""
    sm = difflib.SequenceMatcher(None, base_words, var_words, autojunk=False)
    m = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            m[a + k] = b + k
    return m


def compare_words(base_t, var_t, mapping):
    """displacement of the surviving words (final t0) between two timing.json files"""
    bw, vw = base_t["words"], var_t["words"]
    dl, anch = [], []
    for a, b in mapping.items():
        dl.append(vw[b]["t0"] - bw[a]["t0"])
        anch.append(bw[a]["src"] == "asr")
    dl, anch = np.abs(np.array(dl)), np.array(anch)
    def st(x):
        return {"n": int(len(x)), "median_ms": round(float(np.median(x) * 1000), 1) if len(x) else None,
                "p90_ms": round(float(np.percentile(x, 90) * 1000), 1) if len(x) else None, "max_ms": round(float(x.max() * 1000), 1) if len(x) else None,
                "within100": round(float((x <= 0.1).mean()), 3) if len(x) else None}
    return {"all": st(dl), "asr_anchored_in_base": st(dl[anch]), "interpolated_in_base": st(dl[~anch])}


def lyric_variants():
    text = LYR.read_text()
    lines = text.split("\n")
    base = parse_lyrics(text)
    # locate raw tokens of some lyric lines (plain words only)
    def find_line(prefix):
        for i, l in enumerate(lines):
            if l.strip().startswith(prefix):
                return i
        raise KeyError(prefix)
    out = {}
    # A: drop 3 words (one mid-line content word in three different sections)
    a = list(lines)
    for prefix, tok in (("Big scary chart", "scary"), ("Somebody's teaching the kids", "kids"), ("Rules are a trellis", "trellis")):
        i = find_line(prefix)
        toks = a[i].split(" ")
        k = [n for n, t in enumerate(toks) if t.strip(",.!?:").lower() == tok][0]
        del toks[k]
        a[i] = " ".join(toks)
    out["drop3"] = "\n".join(a)
    # B: inserted vocalisations - a leading "Ooh,", a "(ah)" inside a line and an extra line of "Ooh ooh ooh" after a chorus line
    b = list(lines)
    i = find_line("Big scary chart")
    b[i] = "Ooh, " + b[i]
    i = find_line("Somebody's teaching the kids")
    toks = b[i].split(" ")
    toks.insert(3, "(ah)")
    b[i] = " ".join(toks)
    i = find_line("Rules are a trellis")
    b.insert(i + 1, "Ooh ooh ooh")
    out["insert_vocalizations"] = "\n".join(b)
    # C: six misspelt / substituted words
    c = text
    for old, new in (("scary chart", "scarry chard"), ("teaching the kids", "teechin the kidz"), ("trellis", "trelis"), ("Somebody's testing", "Somebodies testin"),
                     ("fast melodic", "fast melodik")):
        c = c.replace(old, new, 1)
    out["misspelt"] = c
    # D: a line that is sung but missing from the text (the singer added a line, the lyrics file is older)
    d_ = list(lines)
    del d_[find_line("Clouds can lurk")]
    out["missing_line"] = "\n".join(d_)
    # E: a line in the text that is not sung (the singer skipped it)
    e_ = list(lines)
    e_.insert(find_line("Test it, poke it") + 1, "Zombies knit sweaters for the rain,")
    out["unsung_line"] = "\n".join(e_)
    # F: a whole section in the text that is not sung (a repeated pre-chorus that the song only sings once)
    i0 = find_line("[Pre-chorus – same words")
    f_ = list(lines)
    f_[i0 + 5:i0 + 5] = lines[i0:i0 + 5]                                # the same block again, tag and four lines
    out["unsung_section"] = "\n".join(f_)
    return base, out


def lyrics_metrics():
    base_t = load_timing(BASE)
    base_words = [w["n"] for w in base_t["words"]]
    base, variants = lyric_variants()
    res = {}
    for name, txt in variants.items():
        d = variant_dir("lyr_" + name)
        lp = d.parent / "lyrics.txt"
        lp.write_text(txt)
        secs, _ = sh_stages(d, SONG, lp, "3,6,7")
        t = load_timing(d)
        var_words = [w["n"] for w in t["words"]]
        mapping = word_map(base_words, var_words)
        r = {"seconds": round(secs, 1), "words": len(var_words), "base_words": len(base_words), "surviving_words": len(mapping),
             "displacement_vs_base": compare_words(base_t, t, mapping), "timing_json_valid": validate(t) == [],
             "anchor_share": t["quality"]["alignment"]["anchor_share"]}
        inserted = [k for k in range(len(var_words)) if k not in set(mapping.values())]
        if inserted:
            r["inserted_words"] = [{"word": t["words"][k]["w"], "t0": t["words"][k]["t0"], "src": t["words"][k]["src"],
                                    "between": [t["words"][k - 1]["t0"] if k else None, t["words"][k + 1]["t0"] if k + 1 < len(t["words"]) else None]} for k in inserted[:8]]
            r["inserted_monotone"] = all((t["words"][k - 1]["t0"] < t["words"][k]["t0"] < t["words"][k + 1]["t0"]) for k in inserted if 0 < k < len(t["words"]) - 1)
        # line starts vs GT: variant lines are mapped to the baseline lines by a sequence match on the line texts (repeated choruses!)
        gt = G.load()
        btxt = [l["text"] for l in base_t["lines"]]
        vtxt = [l["text"] for l in t["lines"]]
        lm = word_map(btxt, vtxt)
        err = {"checked": [], "vocal": [], "grid": []}
        for a, b in lm.items():
            e = t["lines"][b]["t0"] - gt["lines"][a]["t"]
            err[gt["lines"][a]["src"]].append(e)
        r["lines_vs_gt_all"] = G.stats(sum(err.values(), []))
        res[name] = r
    return res


# ------------------------------------------------------------------------------------------------------------------ audio
def audio_variants():
    import soundfile as sf
    import librosa
    y, sr = sf.read(BASE / "audio" / "vocals.wav", dtype="float32", always_2d=True)
    inst, _ = sf.read(BASE / "audio" / "inst.wav", dtype="float32", always_2d=True)
    rng = np.random.default_rng(7)
    out = {}
    # gang double: +3 semitones copy, 45 ms late, -5 dB, plus a -3 semitone copy 80 ms late at -8 dB (a stacked chorus)
    m = y.mean(1)
    up = librosa.effects.pitch_shift(m, sr=sr, n_steps=3.0)
    dn = librosa.effects.pitch_shift(m, sr=sr, n_steps=-3.0)
    def shift(x, s):
        n = int(s * sr)
        return np.concatenate([np.zeros(n, np.float32), x[:len(x) - n]])
    g = m + 0.56 * shift(up, 0.045) + 0.40 * shift(dn, 0.08)
    out["gang_double"] = np.stack([g, g], 1) * 0.6
    # moans: synthetic 'aaah' with vibrato (a) in real gaps between sung words (>= 1.3 s of nothing) and (b) on top of sung words
    base_t = load_timing(BASE)
    W = base_t["words"]
    gaps = [(W[k]["t1"], W[k + 1]["t0"]) for k in range(len(W) - 1) if W[k + 1]["t0"] - W[k]["t1"] >= 1.3]
    pick, last = [], -99.0
    for g0, g1 in gaps:
        if g0 - last > 20 and g0 > 5:
            pick.append(0.5 * (g0 + g1) - 0.45); last = g0
        if len(pick) == 3:
            break

    def moan(n):
        t = np.arange(n) / sr
        f0 = 150 + 6 * np.sin(2 * np.pi * 5.5 * t) + 10 * t
        ph = 2 * np.pi * np.cumsum(f0) / sr
        v = sum(np.sin(k * ph) / k for k in range(1, 12)) * np.minimum(1, t / 0.08) * np.minimum(1, (n / sr - t) / 0.15)
        return (v / np.abs(v).max() * 0.25).astype(np.float32)
    n = int(0.9 * sr)
    zg = y.copy()
    for t0 in pick:
        zg[int(t0 * sr):int(t0 * sr) + n, :] += moan(n)[:, None]
    out["moans_in_gaps"] = zg
    out["moans_in_gaps_at"] = [[round(t0, 2), round(t0 + 0.9, 2)] for t0 in pick]
    zo = y.copy()
    over = [W[60]["t0"], W[200]["t0"], W[330]["t0"]]
    for t0 in over:
        zo[int(t0 * sr):int(t0 * sr) + n, :] += moan(n)[:, None]
    out["moans_over_words"] = zo
    # hiss: pink-ish noise at -24 dB relative to the vocal rms
    noise = np.cumsum(rng.standard_normal(len(m)).astype(np.float32)); noise -= np.convolve(noise, np.ones(4000) / 4000, mode="same")
    noise = noise / (noise.std() + 1e-9) * m.std() * 0.06
    out["hiss"] = np.stack([m + noise, m + noise], 1)
    # bleed: instruments leaking into the vocal stem at -9 dB
    out["bleed"] = y + 0.35 * inst
    return out, sr


def audio_metrics():
    import soundfile as sf
    base_t = load_timing(BASE)
    variants, sr = audio_variants()
    moans_at = variants.pop("moans_in_gaps_at")
    res = {}
    for name, arr in variants.items():
        d = variant_dir("aud_" + name, skip=("vocals.wav", "asr.json", "align.json", "timing.json", "visemes.json"))
        sf.write(d / "audio" / "vocals.wav", np.clip(arr, -1, 1), sr, subtype="PCM_16")
        secs, _ = sh_stages(d, SONG, LYR, "2,3,6,7")
        t = load_timing(d)
        mapping = {k: k for k in range(len(base_t["words"]))}
        r = {"seconds": round(secs, 1), "displacement_vs_base": compare_words(base_t, t, mapping), "anchor_share": t["quality"]["alignment"]["anchor_share"],
             "lines_vs_gt_all": line_metrics(t)["all"], "timing_json_valid": validate(t) == [], "vocalizations": len(t["vocalizations"])}
        if name == "moans_in_gaps":
            found = []
            for a, b in moans_at:
                hit = [v for v in t["vocalizations"] if v["t0"] < b + 0.3 and v["t1"] > a - 0.3]
                found.append({"spliced": [a, b], "detected": bool(hit)})
            r["moan_detection"] = found
        res[name] = r
    return res


# ------------------------------------------------------------------------------------------------------------------ wrong lyrics
def wrong_metrics():
    d = variant_dir("wrong_lyrics")
    secs, err = sh_stages(d, SONG, ZC_LYR, "3,6,7")
    t = load_timing(d)
    st = json.load(open(d / "audio" / "state.json"))
    return {"seconds": round(secs, 1), "anchor_share": t["quality"]["alignment"]["anchor_share"], "asr_anchored": t["quality"]["alignment"]["asr_anchored"],
            "words": t["quality"]["alignment"]["words"], "warnings": t["quality"]["warnings"], "lines_flagged_for_review": len(t["quality"]["review"]),
            "timing_json_valid": validate(t) == [],
            "first_last_word": [t["words"][0]["t0"], t["words"][-1]["t1"]]}


# ------------------------------------------------------------------------------------------------------------------ tts (word-level truth)
def word_stats(err):
    e = np.abs(np.asarray(err, float))
    if not len(e):
        return {"n": 0}
    return {"n": int(len(e)), "median_ms": round(float(np.median(e) * 1000), 1), "p90_ms": round(float(np.percentile(e, 90) * 1000), 1),
            "mean_ms": round(float(e.mean() * 1000), 1), "max_ms": round(float(e.max() * 1000), 1),
            "within50": round(float((e <= 0.05).mean()), 3), "within100": round(float((e <= 0.1).mean()), 3), "within200": round(float((e <= 0.2).mean()), 3)}


def tts_metrics():
    d = HERE / "tts"
    out_dir = d / "data"
    if not (d / "song.wav").exists() or not (d / "truth.json").exists():
        d.mkdir(exist_ok=True)
        r = subprocess.run([sys.executable, str(HERE / "tts_song.py"), str(d / "song.wav"), str(d / "truth.json")], env=dict(ENV, PYTHONPATH=os.environ.get("PYTHONPATH", "")),
                           capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr)
    sh_stages(out_dir, d / "song.wav", ZC_LYR, "0-8")               # cached stems / ASR are reused (about 25 s), so the numbers describe the current code
    tr = json.load(open(d / "truth.json"))
    t = load_timing(out_dir)
    f = json.load(open(out_dir / "audio" / "features.json"))
    W, TW = t["words"], tr["words"]
    err = [w["t0"] - g["t0"] for w, g in zip(W, TW)]
    res = {"words": word_stats(err), "bias_ms": round(float(np.median(err) * 1000), 1)}
    res["by_src"] = {s: word_stats([e for e, w in zip(err, W) if w["src"] == s]) for s in ("asr", "interp")}
    res["held_words"] = word_stats([e for e, g in zip(err, TW) if g["hold"]])
    res["word_ends"] = word_stats([w["t1"] - g["t1"] for w, g in zip(W, TW)])
    res["anchor_share"] = t["quality"]["alignment"]["anchor_share"]
    le = [t["lines"][k]["t0"] - tr["lines"][k]["t0"] for k in range(len(t["lines"]))]
    res["lines"] = word_stats(le)
    res["beats"] = beat_metrics(t["beats"], tr["beats"], t["bars"], tr["downbeats"])
    res["beats"]["bpm_est"] = t["tempo"]["bpm"]
    res["beats"]["confidence"] = t["tempo"]["confidence"]
    sec = []
    for g in tr["sections"]:
        m = next(s for s in t["sections"] if s["id"] == g["id"])
        sec.append({"id": g["id"], "truth_start": round(g["start_s"], 2), "start": m["start"], "err_s": round(m["start"] - g["start_s"], 2),
                    "pickup_beats": m["pickup_beats"]})
    res["sections"] = {"same_bar": int(sum(1 for r in sec if abs(r["err_s"]) < 0.5 * 60 / tr["bpm"])), "n": len(sec), "rows": sec}
    res["drums"] = {k: drum_match(f["drums"][k]["t"], tr[k], 0.03) for k in ("kick", "clap", "hat")}
    res["instrumentals"] = t["instrumentals"]
    res["review_lines"] = len(t["quality"]["review"])
    res["warnings"] = t["quality"]["warnings"]
    res["timing_json_valid"] = validate(t) == []
    # words whose error is large: which are they
    big = sorted(((abs(e), k) for k, e in enumerate(err)), reverse=True)[:10]
    res["worst_words"] = [{"i": k, "w": W[k]["w"], "err_ms": round(err[k] * 1000), "src": W[k]["src"], "conf": W[k]["conf"]} for _, k in big]
    return res


PARTS = {"tts": tts_metrics, "main": main_metrics, "synth": synth_metrics, "lyrics": lyrics_metrics, "audio": audio_metrics, "wrong": wrong_metrics}


def refresh_base():
    """Re-run stages 0-8 on the P(Bloom) base run (stems and ASR come from the cache: about 25 s; from scratch 6 min), so that the metrics
    and the variants always describe the current code instead of whatever run_audio.sh last wrote there."""
    print("== refreshing validation/pbloom/data (stages 0-8, cached stages are skipped)", flush=True)
    sh_stages(BASE, SONG, LYR, "0-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parts", default="main,synth,lyrics,audio,wrong,tts")
    ap.add_argument("--out", default=str(HERE / "results.json"))
    a = ap.parse_args()
    res = json.load(open(a.out)) if os.path.exists(a.out) else {}
    parts = a.parts.split(",")
    if any(p in ("main", "lyrics", "audio", "wrong") for p in parts):
        refresh_base()
    for p in parts:
        t0 = time.time()
        print(f"== {p}", flush=True)
        res[p] = PARTS[p]()
        print(json.dumps(res[p], indent=1)[:6000], flush=True)
        print(f"   ({time.time() - t0:.0f}s)", flush=True)
        json.dump(res, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
