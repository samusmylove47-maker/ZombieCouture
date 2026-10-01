#!/usr/bin/env python3
"""A test song with exact word-level truth, built from the Zombie Couture lyrics: every lyric word is spoken by espeak-ng (one call per
word, a different pitch per word so it sounds sung-ish), placed on an eighth-note grid of a synthetic four-on-the-floor backing track
(validation/synth.py), lines start on a bar line or one beat before it (pickup), sections are separated by a bar of backing only, held
words ("Zom...bie...", "beautiful...") are spoken slowly.  Truth = the trimmed onset / offset of each word's audio as placed.

  python3 validation/tts_song.py out.wav truth.json [--lyrics data/lyrics.txt] [--bpm 128] [--seed 0]

Needs `pip install espeakng-loader` (PyPI; bundles libespeak-ng and its data) - used for the validation only, not by the pipeline.
Speech is not singing (no sustained notes, no vibrato, robotic timbre), so read the numbers as a test of the alignment mechanics on the
real lyric text (repeated choruses, holds, pickups, section gaps), not as a promise for the real vocal.
"""
from __future__ import annotations

import ctypes as C
import json
import math
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
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


def build(lyrics_path, bpm=128.0, seed=0, first_downbeat=0.35, intro_bars=2, voice="en-us+f3"):
    lyr = parse_lyrics(Path(lyrics_path).read_text())
    rng = np.random.default_rng(seed)
    tts = Espeak()
    beat = 60.0 / bpm
    bar = 4 * beat
    eighth = beat / 2
    # ---- speak every word once
    clips = []
    for w in lyr.words:
        wpm = 100 if w.hold else 250
        pitch = int(rng.integers(45, 80))
        x = tts.say(w.norm if w.norm else w.text, voice=voice, wpm=wpm, pitch=pitch)
        x, lead, dur = trim(x)
        if w.hold:                                                       # a held vowel: stretch the tail a little
            pass
        clips.append(x)
    # ---- layout
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
            lines_t.append({"li": li, "t0": words_t[i0][0], "t1": line_end, "bar": bar_i, "pickup_beats": pickup})
            bar_i += max(1, need)
        bar_i += 1                                                        # a bar of backing only between sections
    total_bars = bar_i + 2
    dur = first_downbeat + total_bars * bar
    # ---- audio
    back, truth_b = S.make(bpm, 0.0, dur, first_downbeat, with_vocal=False)
    back = back[:, 0] if back.ndim == 2 else back
    voc = np.zeros(int(dur * SR) + SR, np.float32)
    for i, (t0, t1) in enumerate(words_t):
        a = int(round(t0 * SR))
        voc[a:a + len(clips[i])] += clips[i] * 0.9
    n = min(len(back), len(voc))
    rms_b = float(np.sqrt(np.mean(back[:n] ** 2)))
    rms_v = float(np.sqrt(np.mean(voc[:n][np.abs(voc[:n]) > 1e-4] ** 2)))
    voc *= 0.75 * rms_b / (rms_v + 1e-9)
    mix = back[:n] + voc[:n]
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.85
    stereo = np.stack([mix, mix], 1).astype(np.float32)
    truth = {"bpm": bpm, "duration": n / SR, "first_downbeat": first_downbeat,
             "beats": truth_b["beats"], "downbeats": truth_b["downbeats"], "kick": truth_b["kick"], "clap": truth_b["clap"], "hat": truth_b["hat"],
             "words": [{"i": i, "w": lyr.words[i].text, "t0": words_t[i][0], "t1": words_t[i][1], "line": lyr.words[i].line, "hold": lyr.words[i].hold}
                       for i in range(len(lyr.words))],
             "lines": lines_t,
             "sections": [{"id": s.id, "start_bar": sec_start_bar[k], "start_s": first_downbeat + sec_start_bar[k] * bar} for k, s in enumerate(lyr.sections)]}
    return stereo, truth


if __name__ == "__main__":
    out, tj = sys.argv[1], sys.argv[2]
    lyr = sys.argv[sys.argv.index("--lyrics") + 1] if "--lyrics" in sys.argv else str(HERE.parents[1] / "data" / "lyrics.txt")
    bpm = float(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else 128.0
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 0
    x, truth = build(lyr, bpm, seed)
    sf.write(out, x, SR, subtype="PCM_16")
    json.dump(truth, open(tj, "w"))
    print(out, x.shape, f"{truth['duration']:.1f}s", len(truth["words"]), "words")
