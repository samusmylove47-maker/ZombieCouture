// Timing readers: loadTiming(url) -> T.  A faithful port of the reference code in docs/TIMING_SCHEMA.md ("Reading it") plus the
// three helpers the film needs (moan, sing, sectionById).  Everything here is a pure function of T and its arguments.
//
// URL rules: the caller's `url` (the ?timing= param), else /data/timing.json, /data/timing.standin.json, /data/timing.mini.json,
// /data/timing.fake.json (first one that loads).  T.url tells which one was used.

const ub = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };   // first index with a[i] > x
const lb = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };   // first index with a[i] >= x
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export const DEFAULT_TIMING_URLS = ['/data/timing.json', '/data/timing.standin.json', '/data/timing.mini.json', '/data/timing.fake.json'];

export async function loadTiming(url) {
  const urls = url ? [url] : DEFAULT_TIMING_URLS;
  let T = null, used = null;
  for (const u of urls) {
    try { const r = await fetch(u); if (r.ok) { T = await r.json(); used = u; break; } } catch (e) { /* try the next one */ }
  }
  if (!T) throw new Error('loadTiming: no timing file found (tried ' + urls.join(', ') + ')');
  return attachReaders(T, used);
}

export function attachReaders(T, url = '') {
  const B = T.beats, nB = B.length, W = T.words, W0 = W.map((w) => w.t0), V = T.visemes, bpb = T.tempo?.beats_per_bar ?? 4;
  const VOC = (T.vocalizations || []).slice().sort((a, b) => a.t0 - b.t0), VOC0 = VOC.map((v) => v.t0);
  T.url = url;
  T.duration = T.meta?.duration ?? (B[nB - 1] || 0);

  // ---- beats and bars
  T.beatAt = (t) => {
    if (t <= B[0]) return (t - B[0]) / (B[1] - B[0]);
    if (t >= B[nB - 1]) return (nB - 1) + (t - B[nB - 1]) / (B[nB - 1] - B[nB - 2]);
    const i = ub(B, t) - 1;
    return i + (t - B[i]) / (B[i + 1] - B[i]);
  };
  T.timeOfBeat = (x) => {
    if (x <= 0) return B[0] + x * (B[1] - B[0]);
    if (x >= nB - 1) return B[nB - 1] + (x - (nB - 1)) * (B[nB - 1] - B[nB - 2]);
    const i = Math.floor(x);
    return B[i] + (x - i) * (B[i + 1] - B[i]);
  };
  T.barPos = (t) => {
    const rel = T.beatAt(t) - T.beatAt(T.bars[0]), bar = Math.floor(rel / bpb);
    return { bar, beat: rel - bar * bpb };
  };
  T.beatPulse = (t, sharp = 4) => { const f = T.beatAt(t) % 1; return Math.pow(1 - (f < 0 ? f + 1 : f), sharp); };

  // ---- levels and drum events
  T.env = (name, t) => {
    const F = T.frames, a = F[name];
    if (!a) return 0;
    const x = Math.min(Math.max(t * F.fps, 0), a.length - 1), i = Math.floor(x);
    return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (x - i);
  };
  T.events = (kind, t0, t1) => {
    const d = T.drums?.[kind], out = [];
    if (!d) return out;
    for (let i = lb(d.t, t0); i < d.t.length && d.t[i] < t1; i++) out.push({ t: d.t[i], s: d.s[i] });
    return out;
  };
  T.hit = (kind, t, halfLife = 0.12) => {
    const d = T.drums?.[kind];
    let v = 0;
    if (!d) return v;
    for (let i = ub(d.t, t) - 1; i >= 0 && t - d.t[i] < 6 * halfLife; i--) v = Math.max(v, d.s[i] * Math.pow(0.5, (t - d.t[i]) / halfLife));
    return v;
  };

  // ---- words, lines, sections
  T.wordAt = (t) => { const i = ub(W0, t) - 1; return i >= 0 && t < W[i].t1 ? W[i] : null; };
  T.wordProgress = (w, t) => Math.min(1, Math.max(0, (t - w.t0) / Math.max(1e-6, w.t1 - w.t0)));
  T.lineAt = (t) => { const pad = 0.25; for (const l of T.lines) if (t >= l.t0 - pad && t < l.t1 + pad) return l; return null; };
  T.sectionAt = (t) => { for (const s of T.sections) if (t >= s.start && t < s.end) return s; return null; };
  T.sectionById = (id) => T.sections.find((s) => s.id === id) || null;
  T.cutFirstWords = (k) => { const t0 = T.sections[k].t0 + 0.02; return T.timeOfBeat(Math.floor(T.beatAt(t0) + 1e-6)); };

  // ---- mouth: viseme weights (reference sampler, identical to the Python one)
  const ATTACK = 0.04, RELEASE = 0.07, REST_ATTACK = 0.06;
  T.visemeSet = V?.set || ['rest', 'MBP', 'FV', 'O', 'U', 'AA', 'EE', 'TLD'];
  T.mouth = (t) => {
    const m = new Float32Array(T.visemeSet.length);
    if (!V || !V.words) { m[0] = 1; return m; }
    const i0 = ub(W0, t) - 1;
    for (let i = Math.max(0, i0 - 3); i < Math.min(W.length, i0 + 4); i++) {
      const evs = V.words[i]; if (!evs) continue;
      for (const [te, d, v, w] of evs) {
        const a = v === 0 ? REST_ATTACK : ATTACK, lo = te - a, hi = te + d + RELEASE;
        if (t < lo || t > hi) continue;
        m[v] = Math.max(m[v], w * Math.min(1, (t - lo) / a) * Math.min(1, (hi - t) / RELEASE));
      }
    }
    let s = 0;
    for (let k = 1; k < m.length; k++) s += m[k];
    if (s > 1) for (let k = 1; k < m.length; k++) m[k] /= s;
    m[0] = Math.max(0, 1 - Math.min(1, s));
    return m;
  };

  // ---- moan: 1 inside a `vocalizations` span, smoothed with a 60 ms attack and release
  T.moan = (t) => {
    let v = 0;
    const i = ub(VOC0, t) - 1;
    for (let j = Math.max(0, i - 2); j <= Math.min(VOC.length - 1, i + 1); j++) {
      const s = VOC[j];
      v = Math.max(v, Math.min(clamp01((t - s.t0) / 0.06), clamp01((s.t1 + 0.06 - t) / 0.06)));
    }
    return v;
  };

  // ---- sing: the vocal level gated to sung words (lead voice only with which = 'lead', backing/gang only with 'bg')
  T.sing = (t, which) => {
    let g = 0;
    const i = ub(W0, t) - 1;
    for (let j = Math.max(0, i - 1); j <= Math.min(W.length - 1, i + 1); j++) {
      const w = W[j];
      if (which === 'lead' && w.bg) continue;
      if (which === 'bg' && !w.bg) continue;
      g = Math.max(g, Math.min(clamp01((t - (w.t0 - 0.03)) / 0.04), clamp01((w.t1 + 0.08 - t) / 0.08)));
    }
    return g * Math.min(1, T.env('vocal', t) * 1.25);
  };
  return T;
}
