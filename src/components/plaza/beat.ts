// Keeps the stage in time with the radio: how far round a dance the dancers are, and how many beats
// have gone by, following the playing track's beat (measured by `pnpm bpm` into
// src/data/music.json) wherever it is in the track.
//
// A dance is fitted to the music a whole number of beats at a time round, 2, 4 or 8, whichever
// keeps it nearest its own pace (motion.LOOP for the routine, motion.POLKA_BAR for a bar of the
// polka), and each time round starts on a bar. The count never jumps: when the music moves on (a
// new track, a change of tempo, a seek) it speeds up or slows down a little until it is back on
// the beat. With no beat to follow it keeps its own pace.
import { LOOP } from './motion';

/** Beats to a time round, from which the nearest to the dance's own pace is taken. */
const FITS = [2, 4, 8];
/** How much nearer its own pace another fit must be before the dance changes to it, in octaves. */
const STICK = 0.15;
/** How hard it pulls back onto the beat, and the most it changes speed doing so (a fraction). */
const PULL = 1.5;
const MOST = 0.35;
/** Beats to a time round with no beat to follow. */
const OWN = 4;

/** The nearer way round from `a` to `b`, for counts that wrap at 1: -0.5 to 0.5. */
const ahead = (a: number, b: number) => ((((b - a) % 1) + 1.5) % 1) - 0.5;

export class BeatClock {
  /** Times round the dance so far. */
  loops = 0;
  /** Beats gone by so far; each whole one is a beat. */
  beats = 0;
  /** Seconds a time round takes now. */
  period: number;
  /** Beats to a time round now. */
  private fit = OWN;

  /** `pace` is how long a time round of the dance takes at its own pace, in seconds. */
  constructor(private readonly pace = LOOP) {
    this.period = pace;
  }

  /** Beats to a time round now, for anyone dancing by the beat rather than the time round. */
  get perLoop() {
    return this.fit;
  }

  /** Seconds a beat takes now. */
  get beatLength() {
    return this.period / this.fit;
  }

  /**
   * Moves on by `dt` seconds. `map` is the playing track's beat (Track.beats), or null with none
   * to follow, and `at` where in the track it is now, in seconds.
   */
  update(dt: number, map: readonly (readonly [number, number])[] | null | undefined, at: number) {
    if (!map?.length) {
      this.fit = OWN;
      this.period = this.pace;
      this.loops += dt / this.pace;
      this.beats += (dt * OWN) / this.pace;
      return;
    }
    // The steady stretch the track is in (before the first, the first runs back to the start).
    let i = 0;
    while (i + 1 < map.length && map[i + 1][0] <= at) i++;
    const [bar, bpm] = map[i];
    const beat = 60 / bpm;
    const into = (at - bar) / beat;
    // The fit nearest the dance's own pace, kept unless another is clearly nearer.
    const off = (n: number) => Math.abs(Math.log2((n * beat) / this.pace));
    const best = FITS.reduce((a, b) => (off(b) < off(a) ? b : a));
    if (off(best) < off(this.fit) - STICK || !FITS.includes(this.fit)) this.fit = best;
    this.period = this.fit * beat;
    this.loops += (dt / this.period) * (1 + Math.max(-MOST, Math.min(MOST, PULL * ahead(this.loops, into / this.fit))));
    this.beats += (dt / beat) * (1 + Math.max(-MOST, Math.min(MOST, PULL * ahead(this.beats, into))));
  }
}
