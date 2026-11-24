// The plaza's voices and Mii SFX: real Wii U WaraWara Plaza Mii voice clips (8 personalities x 6
// emotions x 5 takes) and Mii foley/interaction SFX (claps, landings, footsteps, sneezes, Mii tap,
// speech balloon pop), packed into one audio sprite (public/media/plaza-voices.mp3, voice-atlas.ts).
// Every trigger varies volume, pitch/rate, tonal warmth and sample choice so the same clips stay
// natural and never sound repetitive. No plaza or menu music lives here.
import * as motion from './motion';
import { clamp, rng } from './util';
import {
  FEMALE_VOICES,
  MALE_VOICES,
  SFX_SLICES,
  SPRITE_SRC,
  SYNC_AT,
  SYNC_THRESHOLD,
  VOICE_SLICES,
  type Emotion,
  type SfxId,
  type Slice,
  type VoiceId,
} from './voice-atlas';

/** Something a Mii did that may make a sound, from the crowd. */
export interface Cue {
  /** The clip it started, or null for a body hitting the floor (`hit`). */
  clip: motion.Clip | null;
  /** Seconds from now until it starts. */
  delay: number;
  /** How long it goes on for, where that matters: applause, cheering. */
  seconds: number;
  /** The visitor's own hand is behind it (a poke, a grab, a throw), so it always plays. */
  you: boolean;
  /** Said with a bubble over its head, and how many characters the bubble's line is. */
  bubble: boolean;
  line: number;
  /** Thrown or knocked flying. */
  flung: boolean;
  /** How hard it came down, as the speed it hit the floor at. */
  hit: number;
  /** One beat of the music, in seconds, for clapping along. */
  beat: number;
}

/** Who it is: `id` keeps their voice the same all visit, the rest shapes it. */
export interface Speaker {
  id: number;
  /** Stable for a named Mii, so they sound the same on every visit. */
  seed: number;
  female: boolean;
  /** 0 for the smallest Mii, 1 for the tallest. */
  size: number;
}

/** Where it is heard from: `pan` -1 left to 1 right, `gain` for distance, `seen` on screen. */
export interface Place {
  pan: number;
  gain: number;
  seen: boolean;
  /** True while the opening recording is still running (its own footsteps are in the theme). */
  intro?: boolean;
}

export type Sound =
  | Emotion
  | 'appeal'
  | 'clap'
  | 'land'
  | 'step'
  | 'sneeze'
  | 'select'
  | 'balloon';

/** What each animation clip maps to, plus how often it speaks (0..1). */
const SAYS = new Map<motion.Clip, readonly [Sound, number]>([
  [motion.talk, ['nor', 1]],
  [motion.listen, ['puz', 0.45]],
  [motion.laugh, ['hap', 1]],
  [motion.wave, ['appeal', 1]],
  [motion.hello, ['appeal', 1]],
  [motion.thanks, ['appeal', 0.75]],
  [motion.bashful, ['puz', 0.75]],
  [motion.wink, ['lik', 0.9]],
  [motion.hop, ['hap', 0.8]],
  [motion.jacks, ['hap', 0.65]],
  [motion.skyward, ['puz', 0.65]],
  [motion.gaze, ['puz', 0.6]],
  [motion.shock, ['sup', 1]],
  [motion.faint, ['fru', 1]],
  [motion.panic, ['sup', 1]],
  [motion.argue, ['fru', 1]],
  [motion.tantrum, ['fru', 1]],
  [motion.point, ['appeal', 0.9]],
  [motion.flex, ['hap', 0.9]],
  [motion.spin, ['lik', 0.9]],
  [motion.windmill, ['lik', 0.65]],
  [motion.dance, ['lik', 0.6]],
  [motion.dangle, ['sup', 1]],
  [motion.clap, ['clap', 1]],
  [motion.clapAlong, ['clap', 1]],
  [motion.fistPump, ['hap', 0.7]],
  [motion.penlight, ['lik', 0.55]],
  [motion.jumpAlong, ['hap', 0.75]],
  [motion.callOut, ['appeal', 0.95]],
  [motion.hype, ['hap', 1]],
  [motion.walk, ['step', 0.35]],
  [motion.run, ['step', 0.55]],
  [motion.flee, ['step', 1]],
  [motion.stand, ['sneeze', 0.025]],
]);

/**
 * Rate limits for each sound category. Each kind waits `gap` seconds after the last of its kind
 * and plays only while fewer than `most` voices are active. One Mii speaks at most every `own`
 * seconds. Claps and footsteps have their own budgets so they never crowd out voices.
 */
const POLICY = {
  you: { gap: [0, 0], most: 4 },
  bubble: { gap: [1.1, 1.5], most: 2 },
  cheer: { gap: [0.9, 2.6], most: 2 },
  ambient: { gap: [3.2, 8.5], most: 2 },
  own: 0.9,
  rate: 4,
  clappers: 6,
  claps: 12,
  stepGap: [1.8, 4.5] as const,
  walkers: 2,
  sneezeGap: [20, 42] as const,
  /** Lighter landings than this make no sound, and one body lands at most every `landEvery` s. */
  land: 1.2,
  landEvery: 0.16,
  /** Harder impacts also draw a vocal reaction. */
  oof: 5,
} as const;
type Kind = 'you' | 'bubble' | 'cheer' | 'ambient';

/** A Mii's stable voice personality, derived from its gender, height and seed. */
interface Persona {
  voice: VoiceId;
  /** Subtle permanent pitch offset in cents (-85..+85). */
  baseCents: number;
  /** Subtle permanent loudness personality (0.88..1.06). */
  baseGain: number;
  /** Subtle permanent brightness tilt (0.88..1.14). */
  baseTone: number;
}

interface PlayOpts {
  at: number;
  where: Place;
  /** Base mix gain before random variation and distance attenuation. */
  mix: number;
  /** Randomized per-play volume range [min, max]. */
  volRange: readonly [number, number];
  /** Base pitch shift in cents. */
  cents: number;
  /** Per-play random pitch spread (+/- cents). */
  jitterCents: number;
  /** Clamp bounds for final pitch shift in cents. */
  clampCents?: readonly [number, number];
  /** Brightness multiplier for the per-play lowpass filter. */
  tone?: number;
}

const between = ([a, b]: readonly number[]) => a + Math.random() * (b - a);
const centsToRate = (cents: number) => 2 ** (cents / 1200);

export class Voices {
  private readonly out: GainNode;
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  /** Runtime correction for browser MP3 decoder priming delay, measured once on decode. */
  private shift = 0;
  private readonly personas = new Map<number, Persona>();
  /** Recently played indices per pool key, so consecutive plays avoid repeating the same clip. */
  private readonly recent = new Map<string, number[]>();
  /** When each kind may next be heard, in context time. */
  private readonly next: Record<Kind, number> = { you: 0, bubble: 0, cheer: 0, ambient: 0 };
  /** When each active voice finishes, in context time. */
  private ends: number[] = [];
  /** When each Mii last spoke or last landed, in context time. */
  private readonly said = new Map<number, number>();
  private readonly landed = new Map<number, number>();
  /** When each clapping Mii or stepping Mii stops. */
  private clapping: number[] = [];
  private stepping: number[] = [];
  private nextStep = 0;
  private nextSneeze = 0;

  constructor(private readonly ctx: AudioContext) {
    // Gentle master lowpass keeps everything warm and rounded under the music.
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 8200;
    soft.Q.value = 0.5;
    soft.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(soft);
  }

  /** Fetches and decodes the WaraWara Plaza voice/SFX sprite once, without blocking startup. */
  ready(): Promise<void> {
    return (this.loading ??= fetch(SPRITE_SRC)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Plaza voices failed to load (${r.status})`))))
      .then((data) => this.ctx.decodeAudioData(data))
      .then((decoded) => {
        this.buffer = decoded;
        this.shift = this.calibrate(decoded);
      })
      .catch((err: unknown) => console.warn(err)));
  }

  /** Measures the browser's MP3 priming offset against the known first clap transient. */
  private calibrate(buf: AudioBuffer) {
    const ch = buf.getChannelData(0);
    const limit = Math.min(ch.length, Math.floor(buf.sampleRate * 0.35));
    for (let i = 0; i < limit; i++) {
      if (Math.abs(ch[i]) > SYNC_THRESHOLD) {
        return clamp(i / buf.sampleRate - SYNC_AT, -0.06, 0.06);
      }
    }
    return 0;
  }

  /** Overall gain for all plaza voices and SFX, 0 for silent, eased over `seconds`. */
  setLevel(level: number, seconds = 0.3) {
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.max(0, level), now + seconds);
  }

  /** Whether `cue` could make any sound at all, to skip projecting off-screen cues. */
  hears(cue: Cue) {
    if (this.ctx.state !== 'running' || !this.buffer) return false;
    if (cue.clip === null) return cue.hit >= POLICY.land;
    if (cue.clip === motion.fall) return cue.flung;
    return SAYS.has(cue.clip) && !(cue.clip === motion.dangle && cue.flung);
  }

  /** Something happened to `who` at `where`: maybe a real WaraWara voice or SFX, maybe quiet. */
  cue(cue: Cue, who: Speaker, where: Place) {
    if (!this.hears(cue)) return;
    const now = this.ctx.currentTime;
    const at = now + Math.max(0, cue.delay);
    if (cue.clip === null) return this.onLand(cue, who, where, at);

    const [sound, chance] = cue.clip === motion.fall ? (['sup', 1] as const) : SAYS.get(cue.clip)!;
    if (sound === 'clap') return this.applaud(cue, who, where, at);
    if (sound === 'step') return this.footsteps(cue, who, where, at, chance);
    if (sound === 'sneeze') return this.maybeSneeze(who, where, at, chance);

    // During the opening recording, let greeting/applause through and skip random background chatter.
    const kind: Kind = cue.you ? 'you' : cue.bubble ? 'bubble' : motion.cheering(cue.clip) ? 'cheer' : 'ambient';
    if (where.intro && kind === 'ambient') return;
    if (kind !== 'you' && (!where.seen || Math.random() > chance)) return;

    // Tactile Nintendo pop when the visitor pokes or grabs a Mii.
    if (cue.you && !cue.flung && cue.clip !== motion.fall) {
      this.playSfx('select', where, at, 0.55, [0.68, 1], 0, 90);
    }

    // A hype moment may let a second voice in straight after the first so the crowd feels alive.
    const rush = cue.clip === motion.hype && Math.random() < 0.4;
    if (!this.allow(kind, who.id, now, rush)) return;

    // Speech bubbles pop open with Nintendo's balloon sound just ahead of the Mii's voice.
    let speakAt = at;
    if (cue.bubble) {
      this.playSfx('balloon', where, at, 0.48, [0.68, 1], -1200, 80);
      speakAt = at + 0.045;
    } else if (kind === 'ambient' || kind === 'cheer') {
      speakAt = at + Math.random() * 0.045;
    }

    const picked = this.pickEmotion(cue, sound);
    const length = this.playVoice(picked, who, where, speakAt, cue.bubble ? 0.96 : kind === 'cheer' ? 0.92 : 0.88);
    let total = length;

    // Longer speech bubbles sometimes get a softer second phrase with a different take and pitch.
    if (cue.bubble && cue.line > 28 && length > 0 && Math.random() < 0.3) {
      const gap = 0.12 + Math.random() * 0.14;
      const follow = Math.random() < 0.7 ? 'nor' : picked;
      const len2 = this.playVoice(follow, who, where, speakAt + length + gap, 0.7);
      if (len2 > 0) total = length + gap + len2;
    }

    // Physical foley accents for dramatic reactions (stomp on tantrum/hop, thump on faint).
    if (cue.clip === motion.faint) {
      this.playSfx('land', where, at + 0.58, 0.55, [0.7, 1], -60, 130);
    } else if (cue.clip === motion.hop || cue.clip === motion.tantrum) {
      this.playSfx('step', where, at + 0.22, 0.4, [0.6, 1], 0, 180);
    }

    this.hold(kind, who.id, speakAt, total);
  }

  /** Plays `sound` from Mii `who` now, ignoring rate limits, for checking by ear in dev. */
  test(sound: Sound, who: Speaker) {
    if (this.ctx.state !== 'running' || !this.buffer) return 0;
    const at = this.ctx.currentTime + 0.02;
    const here: Place = { pan: 0, gain: 1, seen: true };
    switch (sound) {
      case 'clap':
        return this.applaud(
          { clip: motion.clap, delay: 0.02, seconds: 2, you: true, bubble: false, line: 0, flung: false, hit: 0, beat: 0.5 },
          who,
          here,
          at,
        );
      case 'land':
        return this.playSfx('land', here, at, 0.9, [0.85, 1], 0, 150);
      case 'step':
        return this.playSfx('step', here, at, 0.65, [0.8, 1], 0, 200);
      case 'sneeze':
        return this.playSfx(who.female ? 'sneezeF' : 'sneezeM', here, at, 0.85, [0.8, 1], this.personaOf(who).baseCents * 0.7, 110);
      case 'select':
        return this.playSfx('select', here, at, 0.6, [0.85, 1], 0, 90);
      case 'balloon':
        return this.playSfx('balloon', here, at, 0.55, [0.85, 1], -1200, 80);
      default:
        return this.playVoice(sound, who, here, at, 1);
    }
  }

  private pickEmotion(cue: Cue, fallback: Sound): Emotion | 'appeal' {
    if (cue.bubble) {
      const r = Math.random();
      if (r < 0.58) return 'nor';
      if (r < 0.8) return 'hap';
      return 'lik';
    }
    if (cue.clip === motion.listen) return Math.random() < 0.55 ? 'nor' : 'puz';
    if (cue.clip === motion.bashful) return Math.random() < 0.6 ? 'puz' : 'lik';
    if (cue.clip === motion.faint) return Math.random() < 0.55 ? 'puz' : 'fru';
    if (cue.clip === motion.skyward && !cue.you && Math.random() < 0.12) {
      // Rare extra curiosity: occasionally let a skyward glance stay puzzled.
      return 'puz';
    }
    if (fallback === 'appeal' || fallback === 'nor' || fallback === 'hap' || fallback === 'lik' || fallback === 'sup' || fallback === 'puz' || fallback === 'fru') {
      return fallback;
    }
    return 'nor';
  }

  private allow(kind: Kind, id: number, now: number, rush: boolean) {
    this.ends = this.ends.filter((t) => t > now);
    if (this.ends.length >= POLICY[kind].most) return false;
    if (kind === 'you') return true;
    if (now < this.next[kind] && !rush) return false;
    return now - (this.said.get(id) ?? -Infinity) >= POLICY.own;
  }

  private hold(kind: Kind, id: number, at: number, length: number) {
    this.ends.push(at + length);
    this.said.set(id, at + length);
    this.next[kind] = Math.max(this.next[kind], at + length + between(POLICY[kind].gap));
  }

  /** A body hitting the floor: real Wii U landing SFX scaled by impact, plus a vocal reaction on hard hits. */
  private onLand(cue: Cue, who: Speaker, where: Place, at: number) {
    if (at - (this.landed.get(who.id) ?? -Infinity) < POLICY.landEvery) return;
    this.landed.set(who.id, at);
    const strength = clamp(cue.hit / 10, 0.3, 1);
    // Harder impacts sound slightly lower and fuller; softer bounces stay light.
    const impactCents = (1 - strength) * 90 - 40;
    this.playSfx('land', where, at, 0.95 * strength, [0.75, 1], impactCents, 150);
    if (cue.hit > POLICY.oof && this.allow('you', who.id, at, false) && at - (this.said.get(who.id) ?? -Infinity) >= POLICY.own) {
      const emo: Emotion = Math.random() < 0.65 ? 'fru' : 'sup';
      const length = this.playVoice(emo, who, where, at + 0.04, 0.9);
      this.hold('you', who.id, at, length);
    }
  }

  /** Real 4-sample Wii U Mii clapping, on the beat for the stage audience or free applause. */
  private applaud(cue: Cue, who: Speaker, where: Place, at: number) {
    if (!where.seen && !cue.you) return 0;
    const now = this.ctx.currentTime;
    this.clapping = this.clapping.filter((t) => t > now);
    if (this.clapping.length >= POLICY.clappers) return 0;
    const along = cue.clip === motion.clapAlong;
    const every = along ? Math.max(0.25, cue.beat) : 1 / (POLICY.rate * (0.85 + Math.random() * 0.3));
    const count = Math.min(POLICY.claps, Math.max(1, Math.floor(Math.max(0.5, cue.seconds) / every)));
    const length = count * every + 0.14;
    this.clapping.push(at + length);
    const p = this.personaOf(who);
    const handCents = p.baseCents * 0.8 + (who.female ? 40 : -30);
    for (let n = 0; n < count; n++) {
      const t = at + n * every + (Math.random() - 0.5) * (along ? 0.032 : 0.055);
      this.playSfx('clap', where, t, 0.82 * p.baseGain, [0.5, 1], handCents, 180, p.baseTone);
    }
    return length;
  }

  /** Subtle pattering Mii footsteps for nearby walkers/runners or a Mii fleeing after a throw. */
  private footsteps(cue: Cue, who: Speaker, where: Place, at: number, chance: number) {
    if (where.intro || !where.seen) return;
    const flee = cue.clip === motion.flee;
    if (!flee && (where.gain < 0.35 || Math.random() > chance)) return;
    const now = this.ctx.currentTime;
    this.stepping = this.stepping.filter((t) => t > now);
    if (!flee && (now < this.nextStep || this.stepping.length >= POLICY.walkers)) return;
    const fast = flee || cue.clip === motion.run;
    const every = fast ? 0.145 + Math.random() * 0.035 : 0.25 + Math.random() * 0.06;
    const count = flee ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3);
    const length = count * every + 0.06;
    this.stepping.push(at + length);
    if (!flee) this.nextStep = at + length + between(POLICY.stepGap);
    const p = this.personaOf(who);
    for (let n = 0; n < count; n++) {
      const t = at + n * every + (Math.random() - 0.5) * 0.02;
      // Gently taper footsteps in and out so a burst blends naturally into the plaza.
      const edge = n === 0 || n === count - 1 ? 0.72 : 1;
      this.playSfx('step', where, t, (fast ? 0.42 : 0.32) * edge * p.baseGain, [0.45, 0.95], p.baseCents * 0.6, 200, p.baseTone);
    }
  }

  /** Rare charming idle Mii sneeze ("kushami"), matching gender. */
  private maybeSneeze(who: Speaker, where: Place, at: number, chance: number) {
    if (where.intro || !where.seen || where.gain < 0.28 || Math.random() > chance) return;
    const now = this.ctx.currentTime;
    if (now < this.nextSneeze || !this.allow('ambient', who.id, now, false)) return;
    const p = this.personaOf(who);
    const when = at + 0.2 + Math.random() * 0.5;
    const len = this.playSfx(who.female ? 'sneezeF' : 'sneezeM', where, when, 0.85 * p.baseGain, [0.65, 1], p.baseCents * 0.7, 110, p.baseTone);
    this.nextSneeze = when + len + between(POLICY.sneezeGap);
    this.hold('ambient', who.id, when, len);
  }

  /** Deterministic voice personality for a Mii, kept consistent across a visit and for named Miis. */
  private personaOf(who: Speaker): Persona {
    let p = this.personas.get(who.id);
    if (!p) {
      const r = rng(Math.floor(who.seed * 0x7fffffff));
      const pool = who.female ? FEMALE_VOICES : MALE_VOICES;
      const voice = pool[Math.floor(r() * pool.length)];
      // Shorter Miis sit slightly brighter, taller Miis slightly lower, plus individual character.
      const heightCents = (0.5 - clamp(who.size, 0, 1)) * 90;
      const baseCents = clamp(heightCents + (r() * 2 - 1) * 40, -85, 85);
      p = {
        voice,
        baseCents,
        baseGain: 0.88 + r() * 0.18,
        baseTone: 0.88 + r() * 0.26,
      };
      this.personas.set(who.id, p);
    }
    return p;
  }

  /** Picks a slice from `list` while avoiding the last 2 picks in `poolKey`. */
  private pickSlice(poolKey: string, list: readonly Slice[]): Slice {
    if (list.length <= 1) return list[0];
    const prev = this.recent.get(poolKey) ?? [];
    const choices: number[] = [];
    for (let i = 0; i < list.length; i++) {
      if (!prev.includes(i)) choices.push(i);
    }
    const idx = choices.length ? choices[Math.floor(Math.random() * choices.length)] : Math.floor(Math.random() * list.length);
    prev.push(idx);
    if (prev.length > Math.min(2, list.length - 1)) prev.shift();
    this.recent.set(poolKey, prev);
    return list[idx];
  }

  /** Plays a real WaraWara Plaza Mii voice clip with randomized volume, pitch and tonal variation. */
  private playVoice(sound: Emotion | 'appeal', who: Speaker, where: Place, at: number, mix: number) {
    const p = this.personaOf(who);
    const bank = VOICE_SLICES[p.voice];
    let slice: Slice;
    let level = mix;
    if (sound === 'appeal') {
      // Nintendo's APPEAL_1..4 reuse HAP_1, HAP_2, LIK_4 and NOR_5 at slightly softer volume (80/96).
      const appealSlices: readonly Slice[] = [bank.hap[0], bank.hap[1], bank.lik[3], bank.nor[4]];
      slice = this.pickSlice(`v:${p.voice}:appeal`, appealSlices);
      level *= 0.86;
    } else {
      slice = this.pickSlice(`v:${p.voice}:${sound}`, bank[sound]);
    }
    return this.playSlice(slice, {
      at,
      where,
      mix: level * p.baseGain,
      volRange: [0.58, 1],
      cents: p.baseCents,
      jitterCents: 95,
      clampCents: [-180, 180],
      tone: p.baseTone,
    });
  }

  /** Plays a real WaraWara Plaza SFX clip with randomized volume, pitch and tonal variation. */
  private playSfx(
    id: SfxId,
    where: Place,
    at: number,
    mix: number,
    volRange: readonly [number, number],
    cents: number,
    jitterCents: number,
    tone = 1,
  ) {
    const slice = this.pickSlice(`sfx:${id}`, SFX_SLICES[id]);
    return this.playSlice(slice, { at, where, mix, volRange, cents, jitterCents, tone });
  }

  /** Schedules one sprite slice with distance panning, air absorption, and randomized volume/pitch/tone. */
  private playSlice(slice: Slice, opts: PlayOpts) {
    const buffer = this.buffer;
    if (!buffer) return 0;
    const { ctx } = this;
    const [rawStart, rawDur] = slice;
    const offset = clamp(rawStart + this.shift, 0, Math.max(0, buffer.duration - 0.01));
    const dur = Math.min(rawDur, buffer.duration - offset);
    if (dur <= 0.005) return 0;

    const rawCents = opts.cents + (Math.random() * 2 - 1) * opts.jitterCents;
    const cents = opts.clampCents ? clamp(rawCents, opts.clampCents[0], opts.clampCents[1]) : rawCents;
    const rate = centsToRate(cents);
    const playDur = dur / rate;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    // Gentle distance + per-play tonal color shift so repeated clips have organic warmth variation.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const dist = clamp(opts.where.gain, 0.15, 1);
    const baseCut = 2600 + dist * 4800;
    const colorJitter = 0.78 + Math.random() * 0.44;
    filter.frequency.value = clamp(baseCut * (opts.tone ?? 1) * colorJitter, 1800, 12000);
    filter.Q.value = 0.55;

    const env = ctx.createGain();
    const peak = clamp(opts.mix * between(opts.volRange) * clamp(opts.where.gain, 0, 1), 0, 1.2);
    const fadeIn = Math.min(0.004, playDur * 0.15);
    const fadeOut = Math.min(0.012, playDur * 0.2);
    const startAt = Math.max(ctx.currentTime, opts.at);
    const endAt = startAt + playDur;
    env.gain.setValueAtTime(0, startAt);
    env.gain.linearRampToValueAtTime(peak, startAt + fadeIn);
    env.gain.setValueAtTime(peak, Math.max(startAt + fadeIn, endAt - fadeOut));
    env.gain.linearRampToValueAtTime(0, endAt);

    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(opts.where.pan, -1, 1);

    src.connect(filter).connect(env).connect(pan).connect(this.out);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
      pan.disconnect();
    };
    src.start(startAt, offset, dur);
    return playDur;
  }
}

/** The plaza's voices on `ctx`, or null with no sound at all. */
export const voices = (ctx: AudioContext | null) => (ctx ? new Voices(ctx) : null);
