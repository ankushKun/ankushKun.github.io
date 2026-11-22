// Finds a piece of music's beat from its samples alone (scripts/bpm.mjs): its tempo, and where
// every bar starts, as a short map of steady stretches.
//
// The sound is turned into an onset signal, how sharply it gets louder at each moment. The periods
// at which that signal repeats (its autocorrelation), weighed toward a natural dance tempo, say
// roughly how fast the beat is, and a comb of beats slid over it in fine steps pins that down. Then
// the beats themselves are followed through the piece by dynamic programming (Ellis's beat
// tracker, as in librosa), which lets the tempo give a little where the music does, and the beats
// are cut into stretches that each keep one steady tempo. Bars start on whichever beat in four the
// kick drum hits hardest.

/** Samples a second the analysis works at, mono. */
export const RATE = 22050;
/** Frames of 1024 samples every 256 (about 86 a second). */
const SIZE = 1024;
const HOP = 256;
const FPS = RATE / HOP;
/** Tempos considered, and where a guess leans when two octaves fit about as well (as in librosa). */
const SLOWEST = 60;
const FASTEST = 200;
const LEAN = { bpm: 120, octaves: 1 };
/** How far the fine search looks either side of the rough tempo, as a fraction of it. */
const FINE = 0.03;
/** How clearly the beat has to stand out of the rest for a piece to count as having one. */
const STEADY = 2.5;
/** How hard the beat tracker holds to the tempo (librosa's tightness). */
const TIGHT = 100;
/** How far a beat may stray from its stretch's steady line, as a fraction of a beat, and how few beats a stretch may have. */
const SLACK = 0.12;
const SHORTEST = 16;

/** An in-place radix-2 FFT of `re` and `im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/**
 * How sharply the sound gets louder at each frame: the rise in log loudness summed over the
 * spectrum up to 8 kHz (spectral flux), for all of it and for the low end alone (kick drums), each
 * with its slow swell taken out so only the hits are left.
 */
function onsets(samples) {
  const frames = Math.max(0, Math.floor((samples.length - SIZE) / HOP));
  const all = new Float32Array(frames);
  const low = new Float32Array(frames);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  const win = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
  const bins = Math.floor((8000 / RATE) * SIZE);
  const bass = Math.ceil((150 / RATE) * SIZE);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < SIZE; i++) {
      re[i] = samples[o + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    let sumLow = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const rise = Math.max(0, cur[k] - prev[k]);
      sum += rise;
      if (k <= bass) sumLow += rise;
    }
    all[f] = f ? sum : 0;
    low[f] = f ? sumLow : 0;
    [prev, cur] = [cur, prev];
  }
  return { all: detrend(all), low: detrend(low) };
}

/** Takes out the slow swell (a running mean over half a second), keeps the rises, scales to unit spread. */
function detrend(x) {
  const half = Math.round(FPS * 0.25);
  const out = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < Math.min(x.length, half); i++) acc += x[i];
  for (let i = 0; i < x.length; i++) {
    if (i + half < x.length) acc += x[i + half];
    if (i - half - 1 >= 0) acc -= x[i - half - 1];
    const n = Math.min(x.length, i + half + 1) - Math.max(0, i - half);
    out[i] = Math.max(0, x[i] - acc / n);
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  let sd = 0;
  for (const v of out) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / (out.length || 1)) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

/** The signal at a fractional frame, from the two frames either side. */
const at = (x, f) => {
  const i = Math.floor(f);
  if (i < 0 || i + 1 >= x.length) return 0;
  return x[i] + (x[i + 1] - x[i]) * (f - i);
};

/** How much a tempo is favored: a bell over octaves, centred on LEAN. */
const lean = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / LEAN.bpm) / LEAN.octaves) ** 2);

/**
 * The rough tempo: the period at which the onset signal best repeats, weighed by `lean`. Each
 * period also counts the repeat at twice its length, so a beat that hits every time wins over an
 * accent that falls on every third.
 */
function rough(x) {
  const corr = (lag) => {
    const i = Math.floor(lag);
    const f = lag - i;
    let s = 0;
    for (let t = 0; t + i + 1 < x.length; t++) s += x[t] * (x[t + i] * (1 - f) + x[t + i + 1] * f);
    return s / (x.length - i);
  };
  let best = { bpm: LEAN.bpm, score: -Infinity };
  for (let bpm = SLOWEST; bpm <= FASTEST; bpm += 0.5) {
    const lag = (60 / bpm) * FPS;
    const score = (corr(lag) + 0.5 * corr(lag * 2)) * lean(bpm);
    if (score > best.score) best = { bpm, score };
  }
  return best.bpm;
}

/**
 * How well a comb of beats at `bpm` sits on the hits: the best phase, the mean onset strength on
 * its beats there, and how far that stands out of every other phase (in spreads).
 */
function comb(x, bpm) {
  const period = (60 / bpm) * FPS;
  const n = Math.floor(x.length / period) - 1;
  let best = -Infinity;
  let phase = 0;
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let p = 0; p < period; p += 0.5) {
    let s = 0;
    for (let k = 0; k < n; k++) s += at(x, p + k * period);
    s /= n;
    sum += s;
    sum2 += s * s;
    count++;
    if (s > best) [best, phase] = [s, p];
  }
  const mean = sum / count;
  const sd = Math.sqrt(Math.max(1e-9, sum2 / count - mean * mean));
  return { bpm, period, phase, strength: best, clarity: (best - mean) / sd };
}

/** The tempo to a hundredth of a beat a minute, near the rough one, and its beats. */
function fine(x, near) {
  let best = comb(x, near);
  for (let step of [0.05, 0.01]) {
    const from = best.bpm;
    const span = step === 0.05 ? near * FINE : 0.06;
    for (let bpm = from - span; bpm <= from + span; bpm += step) {
      const c = comb(x, bpm);
      if (c.strength > best.strength) best = c;
    }
  }
  return best;
}

/**
 * Every beat, by dynamic programming: each frame's best chain of beats ending there is its own
 * onset strength plus the best earlier chain a beat before, less a penalty the further that gap is
 * from the tempo's period. The chain with the best ending is read back. In frames.
 */
function track(x, period) {
  const n = x.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    for (let d = lo; d <= hi && t - d >= 0; d++) {
      const s = score[t - d] - TIGHT * Math.log(d / period) ** 2;
      if (s > best) [best, from] = [s, t - d];
    }
    score[t] = x[t] + best;
    back[t] = from;
  }
  // End on the best chain in the last beat's worth, then walk back.
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

/**
 * The beats cut into stretches of one steady tempo: a stretch grows beat by beat for as long as a
 * straight line through its beat times keeps every beat within SLACK of a beat of the line, and the
 * next stretch starts where it no longer does. Too-short stretches join the one before. Each is
 * `{ from, to, first, period }` in beats (indices) and frames.
 */
function stretches(beats) {
  const fit = (i, j) => {
    // Least squares through (k, beats[k]) for k in i..j.
    const m = j - i + 1;
    let sk = 0;
    let st = 0;
    let skk = 0;
    let skt = 0;
    for (let k = i; k <= j; k++) {
      sk += k;
      st += beats[k];
      skk += k * k;
      skt += k * beats[k];
    }
    const period = (m * skt - sk * st) / (m * skk - sk * sk || 1);
    const first = (st - period * sk) / m;
    let worst = 0;
    for (let k = i; k <= j; k++) worst = Math.max(worst, Math.abs(beats[k] - (first + period * k)) / period);
    return { first, period, worst };
  };
  const out = [];
  let i = 0;
  while (i < beats.length - 1) {
    let j = Math.min(beats.length - 1, i + SHORTEST);
    let good = fit(i, j);
    while (j + 1 < beats.length) {
      const next = fit(i, j + 1);
      if (next.worst > SLACK) break;
      j++;
      good = next;
    }
    out.push({ from: i, to: j, first: good.first, period: good.period });
    i = j + 1;
  }
  // A stretch shorter than SHORTEST beats is folded into the one before it.
  for (let k = out.length - 1; k > 0; k--) {
    if (out[k].to - out[k].from >= SHORTEST) continue;
    const a = out[k - 1];
    const merged = fit(a.from, out[k].to);
    out.splice(k - 1, 2, { from: a.from, to: out[k].to, first: merged.first, period: merged.period });
  }
  return out;
}

/**
 * Which beat in four starts a bar: of the four ways to group the beats in fours, the one whose first
 * beats hit hardest in the low end, where the kick drum lands on the one.
 */
function barStart(beats, low) {
  const sums = [0, 0, 0, 0];
  beats.forEach((b, k) => (sums[k % 4] += at(low, b)));
  return sums.indexOf(Math.max(...sums));
}

/**
 * The beat of `samples` (mono at RATE), or nulls where none stands out clearly enough to dance to:
 *
 *   bpm    the tempo of the longest steady stretch, in beats a minute
 *   beats  each steady stretch as [seconds where a bar starts in it, beats a minute from there]
 *
 * `clarity` says how clearly the beat stood out.
 */
export function measure(samples) {
  const { all, low } = onsets(samples);
  const found = fine(all, rough(all));
  if (found.clarity < STEADY) return { bpm: null, beats: null, clarity: found.clarity };
  const beats = track(all, found.period);
  const one = barStart(beats, low);
  const parts = stretches(beats);
  const map = parts.map((p) => {
    // The first beat of the stretch that starts a bar, on its straight line.
    let k = p.from;
    while ((k - one) % 4 !== 0) k++;
    // A frame's hit is heard at its middle, not its start.
    const time = (p.first + p.period * k) / FPS + SIZE / 2 / RATE;
    return [Math.round(time * 1000) / 1000, Math.round(6000 * (FPS / p.period)) / 100];
  });
  const longest = parts.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  return { bpm: Math.round(6000 * (FPS / longest.period)) / 100, beats: map, clarity: found.clarity };
}
