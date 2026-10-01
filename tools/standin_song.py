#!/usr/bin/env python3
"""Stand-in for the real song: the Zombie Couture lyrics spoken word by word (espeak-ng) over a synthetic 128 BPM four-on-the-floor backing
with claps, laid out like the song the director is waiting for: a 4-bar backing-only intro, the nine lyric sections of data/lyrics.txt, one
bar of backing between sections, and an instrumental tail after the outro so that the file lasts about 171 s.  The exact truth (every word,
line, section, beat) is written next to the wav.  It exists so that the whole chain (analysis -> timing -> shots -> sheets -> QA) has run end
to end before the mp3 exists.  Adapted from analysis/validation/tts_song.py (copy; the original is untouched).

    python3 tools/standin_song.py [--out data/audio_standin] [--bpm 128] [--total 171] [--intro-bars 4] [--seed 0] [--dry]
    python3 tools/standin_song.py --mini data/timing.mini.json         (the hand-made 30 s timing file for quick tests, no audio)

Writes <out>/standin.wav and <out>/standin.truth.json.  Needs `pip install espeakng-loader` (validation-grade tool, not used by the film).
Speech is not singing: read the alignment numbers as a test of the mechanics on the real lyric text, not as a promise for the real vocal.
"""
from __future__ import annotations

import argparse
import ctypes as C
import json
import math
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "analysis"))
sys.path.insert(0, str(ROOT / "analysis" / "validation"))
from zcaudio.lyrics import parse_lyrics          # noqa: E402
import synth as S                                # noqa: E402

SR = 44100


class _EV(C.Structure):
    _fields_ = [("type", C.c_int), ("uid", C.c_uint), ("text_position", C.c_int), ("length", C.c_int), ("audio_position", C.c_int),
                ("sample", C.c_int), ("user_data", C.c_void_p), ("id", C.c_char * 8)]


class Espeak:
    def __init__(self):
        import espeakng_loader
        self.lib = C.CDLL(espeakng_loader.get_library_path())
        self.lib.espeak_Initialize.restype = C.c_int
        self.lib.espeak_Initialize.argtypes = [C.c_int, C.c_int, C.c_char_p, C.c_int]
        self.sr = self.lib.espeak_Initialize(2, 0, espeakng_loader.get_data_path().encode(), 0)
        self._pcm: list = []
        cb_t = C.CFUNCTYPE(C.c_int, C.POINTER(C.c_short), C.c_int, C.POINTER(_EV))

        def _cb(wav, n, ev):
            if wav and n > 0:
                self._pcm.append(np.ctypeslib.as_array(wav, shape=(n,)).copy())
            return 0
        self._cb = cb_t(_cb)
        self.lib.espeak_SetSynthCallback(self._cb)

    def say(self, text: str, voice="en-us+f3", wpm=170, pitch=60) -> np.ndarray:
        self.lib.espeak_SetVoiceByName(voice.encode())
        self.lib.espeak_SetParameter(1, int(wpm), 0)
        self.lib.espeak_SetParameter(3, int(pitch), 0)
        self._pcm.clear()
        b = text.encode("utf-8")
        self.lib.espeak_Synth(b, len(b) + 1, 0, 1, 0, 1, None, None)
        self.lib.espeak_Synchronize()
        x = np.concatenate(self._pcm).astype(np.float32) / 32768.0 if self._pcm else np.zeros(0, np.float32)
        if self.sr != SR:
            import librosa
            x = librosa.resample(x, orig_sr=self.sr, target_sr=SR, res_type="soxr_hq")
        return x


def trim(x: np.ndarray, thr_db=-38.0):
    """(trimmed audio, lead seconds, kept seconds): cut leading / trailing samples below thr_db relative to the peak."""
    if len(x) == 0:
        return x, 0.0, 0.0
    pk = np.abs(x).max() + 1e-9
    idx = np.where(np.abs(x) > pk * 10 ** (thr_db / 20))[0]
    a, b = int(idx[0]), int(idx[-1]) + 1
    return x[a:b], a / SR, (b - a) / SR


def speak_all(lyr, seed, wpm_normal, wpm_hold=100, voice="en-us+f3"):
    """One espeak call per lyric word, pitch varying per word (so it sounds sung-ish); held words are spoken slowly."""
    rng = np.random.default_rng(seed)
    tts = Espeak()
    clips = []
    for w in lyr.words:
        wpm = wpm_hold if w.hold else wpm_normal
        pitch = int(rng.integers(45, 80))
        x = tts.say(w.norm if w.norm else w.text, voice=voice, wpm=wpm, pitch=pitch)
        x, _lead, _dur = trim(x)
        clips.append(x)
    return clips


def layout(lyr, clips, bpm, first_downbeat, intro_bars, section_gap_bars=1):
    """Place every word.  Lines start on a bar line (odd lines of even sections one beat before it, a pickup); words sit on an eighth-note
    grid; a line takes as many whole bars as it needs; sections are separated by `section_gap_bars` bars of backing only.
    Returns (words_t, lines_t, sec_start_bar, end_bar) where end_bar is the first bar after the last line."""
    beat = 60.0 / bpm
    bar = 4 * beat
    eighth = beat / 2
    words_t = [None] * len(lyr.words)
    lines_t = []
    sec_start_bar = []
    bar_i = intro_bars
    prev_end = 0.0
    for si, sec in enumerate(lyr.sections):
        sec_start_bar.append(bar_i)
        for n, li in enumerate(sec.lines):
            ln = lyr.lines[li]
            i0, i1 = ln.words
            pickup = 1 if (n % 2 == 1 and si % 2 == 0) else 0            # some lines start a beat before the bar line
            while first_downbeat + bar_i * bar - pickup * beat < prev_end + 0.15:
                if pickup:
                    pickup = 0                                           # the pickup would overlap the previous line
                else:
                    bar_i += 1
            t_line = first_downbeat + bar_i * bar - pickup * beat
            cursor = t_line
            for i in range(i0, i1):
                dur = len(clips[i]) / SR
                g = math.ceil((cursor - first_downbeat) / eighth - 1e-6)
                t0 = first_downbeat + g * eighth
                if i > i0 and t0 - cursor > 0.16:                        # do not open big holes: stay on the previous grid point
                    t0 = first_downbeat + (g - 1) * eighth if (first_downbeat + (g - 1) * eighth) >= cursor - 0.02 else t0
                words_t[i] = [t0, t0 + dur]
                cursor = t0 + dur + 0.05
            line_end = words_t[i1 - 1][1]
            prev_end = line_end
            need = math.ceil((line_end - (first_downbeat + bar_i * bar) + 0.05) / bar)
            lines_t.append({"li": li, "t0": words_t[i0][0], "t1": line_end, "bar": bar_i, "pickup_beats": pickup, "bars": max(1, need)})
            bar_i += max(1, need)
        bar_i += section_gap_bars                                         # backing only between sections
    return words_t, lines_t, sec_start_bar, bar_i


def build(lyrics_path, bpm=128.0, seed=0, first_downbeat=0.35, intro_bars=4, total=171.0, min_tail_bars=5, wpm_start=250, fade_s=3.0):
    lyr = parse_lyrics(Path(lyrics_path).read_text())
    beat = 60.0 / bpm
    bar = 4 * beat
    # speak the words; if the sung part would leave less than `min_tail_bars` of tail inside `total`, speak faster (shorter clips fit tighter)
    wpm = wpm_start
    while True:
        clips = speak_all(lyr, seed, wpm)
        words_t, lines_t, sec_start_bar, end_bar = layout(lyr, clips, bpm, first_downbeat, intro_bars)
        tail_bars = (total - (first_downbeat + end_bar * bar)) / bar
        if tail_bars >= min_tail_bars or wpm >= 400:
            break
        wpm += 25
    dur = float(total)
    # ---- audio: backing (kick on every beat, claps on 2 and 4, off-beat hats, bass, pad) + the spoken words
    back, truth_b = S.make(bpm, 0.0, dur, first_downbeat, with_vocal=False)
    back = back[:, 0] if back.ndim == 2 else back
    voc = np.zeros(int(dur * SR) + SR, np.float32)
    for i, (t0, t1) in enumerate(words_t):
        a = int(round(t0 * SR))
        voc[a:a + len(clips[i])] += clips[i] * 0.9
    n = min(len(back), len(voc), int(dur * SR))
    rms_b = float(np.sqrt(np.mean(back[:n] ** 2)))
    rms_v = float(np.sqrt(np.mean(voc[:n][np.abs(voc[:n]) > 1e-4] ** 2)))
    voc *= 0.75 * rms_b / (rms_v + 1e-9)
    mix = back[:n] + voc[:n]
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.85
    if fade_s > 0:                                                        # the tail fades out like a produced track
        k = int(fade_s * SR)
        mix[-k:] *= np.linspace(1.0, 0.0, k) ** 1.5
    stereo = np.stack([mix, mix], 1).astype(np.float32)
    truth = {"standin": True, "bpm": bpm, "duration": n / SR, "first_downbeat": first_downbeat, "intro_bars": intro_bars, "wpm": wpm,
             "tail_bars": round(tail_bars, 2), "beats": truth_b["beats"], "downbeats": truth_b["downbeats"], "kick": truth_b["kick"],
             "clap": truth_b["clap"], "hat": truth_b["hat"],
             "words": [{"i": i, "w": lyr.words[i].text, "t0": words_t[i][0], "t1": words_t[i][1], "line": lyr.words[i].line, "hold": lyr.words[i].hold}
                       for i in range(len(lyr.words))],
             "lines": lines_t,
             "sections": [{"id": s.id, "start_bar": sec_start_bar[k], "start_s": first_downbeat + sec_start_bar[k] * bar,
                           "t0": words_t[lyr.lines[s.lines[0]].words[0]][0], "t1": words_t[lyr.lines[s.lines[-1]].words[1] - 1][1]}
                          for k, s in enumerate(lyr.sections)]}
    return stereo, truth



# ---------------------------------------------------------------------------------------------------------------------------------------
# data/timing.mini.json: a tiny hand-made timing file (30 s, three sections, beats at exactly 120 BPM) for quick tests of the film runtime.
# Nothing is analysed: words sit on a fixed spacing inside one bar per line, the levels are simple functions of the beat.  Valid for
# `python3 -m zcaudio.schema` and for the readers in docs/TIMING_SCHEMA.md.  Sections: verse1 (2 lines), prechorus1 (2), chorus1 (3).
# ---------------------------------------------------------------------------------------------------------------------------------------
def make_mini_timing(lyrics_path, bpm=120.0, first_beat=0.25, duration=30.0, fps=24):
    import datetime
    import hashlib
    text = Path(lyrics_path).read_text()
    lyr = parse_lyrics(text)
    keep = {"verse1": 2, "prechorus1": 2, "chorus1": 3}
    beat = 60.0 / bpm
    bar = 4 * beat
    nb = int((duration - first_beat) / beat) + 1
    beats = [round(first_beat + k * beat, 6) for k in range(nb)]
    bars = beats[::4]
    words, lines, sections = [], [], []
    bar_i = 2                                                            # two bars of intro
    for sec in lyr.sections:
        if sec.id not in keep:
            continue
        sec_start = round(first_beat + bar_i * bar, 6)
        w0, l0 = len(words), len(lines)
        for n, li in enumerate(sec.lines[:keep[sec.id]]):
            ln = lyr.lines[li]
            ws = lyr.words[ln.words[0]:ln.words[1]]
            gap = min(0.2, 1.9 / len(ws))
            t_line = first_beat + bar_i * bar
            lw0 = len(words)
            for k, w in enumerate(ws):
                t0 = round(t_line + k * gap, 3)
                words.append({"i": len(words), "w": w.text, "n": w.norm, "t0": t0, "t1": round(t0 + gap * 0.8, 3), "conf": 1.0, "src": "pinned",
                              "line": len(lines), "sec": len(sections)})
            lines.append({"i": len(lines), "id": f"{sec.id}.{n + 1}", "section": len(sections), "text": ln.text, "t0": words[lw0]["t0"], "t1": words[-1]["t1"],
                          "word0": lw0, "word1": len(words), "conf": 1.0})
            bar_i += 1
        last = words[-1]["t1"]
        end = next(b for b in bars if b >= last - 1e-6)
        sections.append({"i": len(sections), "id": sec.id, "name": sec.name, "kind": sec.kind, "index": sec.index, "final": sec.final, "direction": sec.direction,
                         "t0": words[w0]["t0"], "t1": last, "start": sec_start, "end": end, "bar0": bars.index(sec_start), "bars": round((end - sec_start) / bar),
                         "pickup_beats": 0, "line0": l0, "line1": len(lines), "word0": w0, "word1": len(words)})
        bar_i += 1                                                       # a bar of backing between sections
    last_end = sections[-1]["end"]
    inst = [{"t0": 0.0, "t1": sections[0]["start"], "where": "intro", "after": None, "before": sections[0]["id"], "bar0": 0, "bars": 2},
            {"t0": last_end, "t1": duration, "where": "outro", "after": sections[-1]["id"], "before": None, "bar0": bars.index(last_end), "bars": int((duration - last_end) / bar)}]
    # mouth events: one open shape per word, cycling AA, O, EE, MBP
    shapes = [5, 3, 6, 1]
    vis = {"set": ["rest", "MBP", "FV", "O", "U", "AA", "EE", "TLD"],
           "words": [[[w["t0"], round(w["t1"] - w["t0"], 3), shapes[i % 4], 0.85]] for i, w in enumerate(words)]}
    n = int(math.ceil(duration * fps))
    tt = np.arange(n) / fps
    ph = np.mod((tt - first_beat) / beat, 1.0)
    ph = np.where(tt < first_beat, 0.5, ph)
    pulse = np.exp(-ph * 4.0)
    vocal = np.zeros(n)
    for w in words:
        a, b = int(w["t0"] * fps), int(math.ceil(w["t1"] * fps))
        vocal[a:b + 1] = 0.85
    lv = {"sub": 0.15 + 0.8 * pulse, "bass": 0.2 + 0.7 * pulse, "lowmid": 0.35 + 0.2 * pulse, "mid": 0.3 + 0.25 * vocal, "high": 0.2 + 0.3 * (ph > 0.45) * (ph < 0.6),
          "rms": 0.35 + 0.35 * pulse, "onset": pulse ** 3, "vocal": vocal}
    frames = {"fps": fps, "n": n, **{k: [round(float(min(1.0, max(0.0, x))), 3) for x in v] for k, v in lv.items()}}
    kick = [b for b in beats]
    clap = [b for i, b in enumerate(beats) if i % 4 in (1, 3)]
    hat = [round(b + beat / 2, 6) for b in beats if b + beat / 2 < duration]
    drums = {"kick": {"t": kick, "s": [1.0] * len(kick)}, "clap": {"t": clap, "s": [0.8] * len(clap)}, "hat": {"t": hat, "s": [0.5] * len(hat)}}
    return {
        "schema": "zombie-couture.timing/1",
        "meta": {"song": "mini (hand-made, no audio)", "duration": duration, "sample_rate": 44100, "audio_id": hashlib.sha1(b"zc-mini-timing").hexdigest()[:16],
                 "container_start_s": 0.0, "lufs": -14.0, "true_peak_dbtp": -1.0, "lyrics_file": "lyrics.txt", "lyrics_sha": hashlib.sha1(text.encode()).hexdigest()[:12],
                 "fps": float(fps), "excerpt": None, "pipeline": "hand-made (tools/standin_song.py --mini)",
                 "created": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "overrides": []},
        "tempo": {"bpm": bpm, "beat_s": beat, "beats_per_bar": 4, "bpm_range": [bpm, bpm], "first_downbeat": bars[0], "confidence": 1.0, "downbeat_confidence": 1.0,
                  "deviation_from_constant_ms": [0.0, 0.0]},
        "beats": beats, "beat_strength": [1.0] * len(beats), "bars": bars, "sections": sections, "instrumentals": inst, "lines": lines, "words": words,
        "visemes": vis, "vocalizations": [], "frames": frames, "drums": drums,
        "quality": {"alignment": {"words": len(words), "asr_anchored": 0, "interpolated": 0, "pinned": len(words), "anchor_share": 1.0, "low_conf_words": 0, "asr_words": 0,
                                  "asr_unused": 0, "demoted": 0, "pruned": 0, "weak_pairs": 0},
                    "beats": {"confidence": 1.0, "beat_conf": 1.0, "downbeat_conf": 1.0, "kick_on_beat_share": 1.0, "tempo_stability": 1.0, "jitter_ms": 0.0,
                              "deviation_from_constant_ms": [0.0, 0.0]},
                    "review": [], "pronunciations_to_check": [], "notes": ["hand-made mini timing for tests: not analysed from audio"], "warnings": [], "stage_seconds": {}}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "data" / "audio_standin"))
    ap.add_argument("--lyrics", default=str(ROOT / "data" / "lyrics.txt"))
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--total", type=float, default=171.0, help="length of the file in seconds")
    ap.add_argument("--intro-bars", type=int, default=4)
    ap.add_argument("--min-tail-bars", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dry", action="store_true", help="print the layout, write nothing")
    ap.add_argument("--mini", default=None, metavar="OUT.json", help="write the hand-made 30 s mini timing file (data/timing.mini.json) and exit")
    a = ap.parse_args(argv)
    if a.mini:
        mt = make_mini_timing(a.lyrics)
        Path(a.mini).write_text(json.dumps(mt))
        print(f"wrote {a.mini}: {mt['meta']['duration']} s, {len(mt['sections'])} sections, {len(mt['lines'])} lines, {len(mt['words'])} words, {len(mt['beats'])} beats at {mt['tempo']['bpm']} BPM")
        return 0
    x, truth = build(a.lyrics, a.bpm, a.seed, intro_bars=a.intro_bars, total=a.total, min_tail_bars=a.min_tail_bars)
    print(f"speech rate {truth['wpm']} wpm, {truth['duration']:.2f} s, sung part ends {truth['words'][-1]['t1']:.2f} s, tail {truth['tail_bars']} bars")
    for s in truth["sections"]:
        print(f"  {s['id']:<11s} bar {s['start_bar']:>3}  {s['start_s']:7.2f} s  sung {s['t0']:7.2f}-{s['t1']:7.2f}")
    if a.dry:
        return 0
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "standin.wav", x, SR, subtype="PCM_16")
    (out / "standin.truth.json").write_text(json.dumps(truth))
    print(out / "standin.wav", x.shape, f"{truth['duration']:.1f}s", len(truth["words"]), "words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
