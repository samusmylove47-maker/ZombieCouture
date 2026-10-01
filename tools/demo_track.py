"""A 10-second PLACEHOLDER track for the animation test (130 BPM). Not the song: it only exists so the sizzle has a pulse to lock to.
   0-1.8 s  cold drone + heartbeat | 1.8 s  the machine starts: four-on-the-floor, claps, hats, needle ticks | 6.5 s riser, 7.6 s drop."""
import numpy as np, wave, sys
SR = 44100; DUR = 10.0; BPM = 130.0; B = 60.0 / BPM
n = int(SR * DUR); t = np.arange(n) / SR
out = np.zeros(n, np.float32)
rng = np.random.default_rng(3)

def env(x, a, d):  # attack/decay envelope, x in seconds since onset
    return np.where(x < 0, 0, np.minimum(x / a, 1) * np.exp(-np.maximum(x - a, 0) / d))

def put(sig, t0, gain=1.0):
    i = int(t0 * SR); m = min(len(sig), n - i)
    if m > 0: out[i:i + m] += sig[:m] * gain

def kick(t0, g=1.0):
    x = np.arange(int(0.35 * SR)) / SR
    f = 45 + 110 * np.exp(-x * 28); ph = 2 * np.pi * np.cumsum(f) / SR
    put(np.sin(ph) * np.exp(-x * 9) * 0.9, t0, g)
def clap(t0, g=1.0):
    x = np.arange(int(0.22 * SR)) / SR
    nz = rng.standard_normal(len(x)); nz = np.convolve(nz, np.ones(3) / 3, 'same')
    e = sum(np.exp(-np.maximum(x - d, 0) * 40) * (x >= d) for d in (0, 0.012, 0.024)) * 0.5 + np.exp(-x * 22) * 0.5
    put(nz * e * 0.5, t0, g)
def hat(t0, g=1.0):
    x = np.arange(int(0.06 * SR)) / SR
    nz = np.diff(rng.standard_normal(len(x) + 1))
    put(nz * np.exp(-x * 70) * 0.35, t0, g)
def tick(t0, g=1.0):
    x = np.arange(int(0.02 * SR)) / SR
    put(np.sin(2 * np.pi * 3200 * x) * np.exp(-x * 300) * 0.4 + (rng.standard_normal(len(x))) * np.exp(-x * 400) * 0.15, t0, g)
def pluck(t0, freq, g=1.0, dur=0.5):
    x = np.arange(int(dur * SR)) / SR
    s = sum(np.sin(2 * np.pi * freq * k * x) / k ** 1.4 * np.exp(-x * (5 + k * 3)) for k in range(1, 6))
    put(s * 0.25, t0, g)
def pad(t0, freqs, dur, g=1.0):
    x = np.arange(int(dur * SR)) / SR
    e = np.minimum(x / 0.3, 1) * np.minimum((dur - x) / 0.4, 1)
    s = 0
    for f in freqs:
        for det in (0.995, 1.0, 1.005):
            s = s + sum(np.sin(2 * np.pi * f * det * k * x) / k for k in range(1, 5)) * 0.05
    put(s * e, t0, g)
def sweep(t0, dur, f0, f1, g=1.0):
    x = np.arange(int(dur * SR)) / SR
    f = f0 * (f1 / f0) ** (x / dur); ph = 2 * np.pi * np.cumsum(f) / SR
    nz = rng.standard_normal(len(x))
    put((np.sin(ph) * 0.3 + nz * 0.12) * (x / dur) ** 2, t0, g)

# -- the dead world: A minor drone, a slow moan, a heartbeat
for f, gg in ((55, 0.5), (82.4, 0.35), (110, 0.25)): pad(0.0, [f], 2.2, gg)
x = np.arange(int(1.8 * SR)) / SR; moan = np.sin(2 * np.pi * np.cumsum(120 - 25 * np.sin(x * 2.0)) / SR) * np.sin(np.pi * x / 1.8) * 0.06; put(moan, 0.0)
for k0 in (0.35, 0.75, 1.35): kick(k0, 0.35)
# -- the machine starts
ign = 1.8
for i in range(int((DUR - ign) / B) + 1):
    tb = ign + i * B
    kick(tb, 1.0 if tb < 7.6 else 1.15)
    if i % 2 == 1: clap(tb, 0.9)
    hat(tb + B / 2, 0.8)
    if tb > 3.6: hat(tb + B / 4, 0.35); hat(tb + 3 * B / 4, 0.35)
    for j in range(4):
        if tb < 7.7: tick(tb + j * B / 4 + 0.002, 0.28)
# -- bell arpeggio (C major pentatonic) enters with the front
notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25]
for i in range(int((DUR - 3.0) / (B / 2))):
    tb = 3.0 + i * B / 2
    pluck(tb, notes[i % len(notes)] * (1 if tb < 6.5 else 1.0), 0.5 if tb < 6.5 else 0.8)
# -- chords: Am -> F -> C -> G, one bar each, the world goes major at the drop
prog = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]]
bar = 4 * B
for i in range(int(DUR / bar) + 1):
    tb = 2.4 + i * bar
    if tb < DUR - 0.5: pad(tb, prog[i % 4], bar, 0.55 if tb < 7.6 else 1.0)
# -- the wave: riser into the drop
sweep(6.5, 1.1, 200, 4000, 1.0); kick(7.6, 1.4); clap(7.6, 1.2)
for k0 in (7.6, 7.6 + B / 2):
    for f in (784, 987.8, 1174.7, 1568): pluck(k0, f, 0.6, 0.9)
# -- gentle master
out = np.tanh(out * 1.1) * 0.85
fade = np.minimum(1, (DUR - t) / 0.5); out *= fade
pcm = (np.clip(out, -1, 1) * 32767).astype('<i2')
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'out/audio/demo_track.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', n / SR, 's')
