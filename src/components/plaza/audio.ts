// The plaza's sound: one recording, cut from the console's own. It opens on the chime the plaza
// appears to, runs through the passage the crowd pours in over, then circles on the main theme.
const SRC = '/media/warawara-plaza.mp3';
const VOLUME = 0.5;

/** Moments in the recording, in seconds. The opening in main.ts keeps time with them. */
export const SCORE = {
  /** The crowd's first footsteps, and when the last of them have faded. */
  crowd: 8.47,
  settled: 24.97,
  /** The stretch that repeats from then on. */
  loop: [39.045, 71.045],
} as const;

export interface Soundtrack {
  /** Starts loading the recording, if it hasn't yet; settles once it can play, or has failed to load. */
  ready(): Promise<void>;
  /** Whether the browser is letting sound out. Most hold it until the visitor first touches the page. */
  readonly live: boolean;
  /**
   * Starts playback as soon as it can: now where the browser allows, otherwise on the first
   * touch. `at` is asked at that moment for where to come in, in seconds, or null for the loop.
   */
  begin(at: () => number | null): void;
  /** Seconds into the recording while it runs through the opening, otherwise null. */
  position(): number | null;
  /** Cuts to the looping theme. */
  settle(): void;
  /** Fades out, for leaving the page. `false` brings the sound back. */
  duck(on: boolean, seconds?: number): void;
  toggle(): void;
  /** Whether there is any sound to play here at all. */
  readonly available: boolean;
  /** Turned down by the visitor (the sound button, or M). */
  readonly muted: boolean;
  /** Whether the recording has started (it keeps running while muted). */
  readonly playing: boolean;
  setMuted(on: boolean): void;
  /** Calls `fn` whenever the sound starts or stops being heard: muted, unmuted, or let out by the browser. */
  onChange(fn: () => void): () => void;
}

const silent: Soundtrack = {
  ready: () => Promise.resolve(),
  live: true,
  begin() {},
  position: () => null,
  settle() {},
  duck() {},
  toggle() {},
  available: false,
  muted: true,
  playing: false,
  setMuted() {},
  onChange: () => () => {},
};

export function soundtrack(): Soundtrack {
  if (typeof AudioContext === 'undefined') return silent;
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);

  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let where: (() => number | null) | null = null;
  /** Context time at which the recording's first second would have played. */
  let origin = 0;
  let opening = false;
  let muted = false;
  let ducked = false;

  const level = () => (muted || ducked ? 0 : VOLUME);
  const fade = (to: number, seconds: number) => {
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(to, now + seconds);
  };

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());

  function play(at: number | null) {
    if (!buffer) return;
    source?.stop();
    opening = at !== null && at < SCORE.settled;
    const offset = opening ? Math.max(0, at ?? 0) : SCORE.loop[0];
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = SCORE.loop[0];
    source.loopEnd = SCORE.loop[1];
    source.connect(out);
    source.start(0, offset);
    origin = ctx.currentTime - offset;
    // From the top the chime keeps its attack. Anywhere else the sound eases in.
    fade(level(), offset < 0.3 ? 0.01 : 0.35);
    emit();
  }

  const start = () => {
    if (buffer && where && !source && ctx.state === 'running') play(where());
  };

  let loading: Promise<void> | null = null;
  const ready = () =>
    (loading ??= fetch(SRC)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Plaza sound failed to load (${r.status})`))))
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => {
        buffer = decoded;
        start();
      })
      .catch((err: unknown) => console.warn(err)));

  ctx.addEventListener('statechange', () => {
    start();
    emit();
  });
  const unlock = () => {
    if (ctx.state === 'suspended' && document.visibilityState === 'visible') void ctx.resume();
  };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(type, unlock, { passive: true });
  // The plaza keeps going in a background tab, so the music does too.

  return {
    ready,
    get live() {
      return ctx.state === 'running';
    },
    begin(at) {
      where = at;
      void ready();
      start();
    },
    position() {
      if (!opening || !source) return null;
      const at = ctx.currentTime - origin;
      if (at >= SCORE.settled) opening = false;
      return opening ? at : null;
    },
    settle() {
      if (!source || !opening) return;
      opening = false;
      fade(0, 0.18);
      setTimeout(() => play(null), 200);
    },
    duck(on, seconds = 0.4) {
      ducked = on;
      fade(level(), seconds);
    },
    toggle() {
      this.setMuted(!muted);
    },
    available: true,
    get muted() {
      return muted;
    },
    get playing() {
      return source !== null;
    },
    setMuted(on) {
      if (on === muted) return;
      muted = on;
      fade(level(), 0.15);
      emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
