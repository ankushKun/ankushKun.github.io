// Everyone in the plaza. Your Mii and friends hold the middle: they fall in from the sky together,
// land and stare up at it. Then the crowd runs in from the far end with their hands up, gathers
// under the cubes and mills about: strolling, chatting, looking up, dashing off to another cube.
import * as THREE from 'three';
import { decodeMii } from '../mii/data';
import type { MiiKit } from '../mii/kit';
import { MiiSet, randomMii, restPose, withLook, type Pose } from '../mii/rig';
import { MIRRORED } from './floor';
import type { Layout } from './layout';
import type { Track } from '../../data/music';
import { BeatClock } from './beat';
import { Leeks } from './leek';
import { Mics } from './mic';
import * as motion from './motion';
import * as toss from './toss';
import type { PlazaMii } from './types';
import type { Cue, Speaker } from './voices';
import { angleDelta, clamp, clamp01, type Rng } from './util';

/**
 * The floor the middle group stands on, from you: this far across either way, and from `back`
 * behind you to `front` in front (depth stretched for the long lens). Nobody stands in the lane
 * straight behind you (`BEHIND`), where you would hide them. Friends keep at least `APART` from
 * each other and from you, measured as the lens sees it (`apart`), and they are scattered afresh
 * on every visit, as friends hanging out stand, never in rows.
 */
const GROUP = { x: 2.7, back: -5.6, front: 0.45 };
const BEHIND = { x: 0.7, z: -3.4 };
const APART = 1.1;
/** How often a friend with nothing on wanders to another place in the group instead. */
const WANDER = 0.14;
/** How far a wander goes, as the lens sees it: a few steps, never across the whole group. */
const WANDER_SPAN = { min: 0.6, max: 2.2 };
const FRIENDS = 7;
/** Nobody else walks into the oval around the middle group. */
const KEEP_OUT = { x: -0.15, z: -2.3, r: 4.6 };
/**
 * The DJ stands this far in front of the floor point under the Music block, in the middle of its
 * ring, and nobody else takes a spot within CLEAR of them, so they stand out on their own.
 */
const DJ_SPOT = { forward: 0.9, clear: 2.2 };
/** The DJ's backup dancers stand this far to either side of them, and this far behind. */
const BACKUP = { gap: 0.95, back: -0.3 };
/** How far in front of the DJ the boombox is set down while they dance, clear of their feet. */
const BOOMBOX_DOWN = 0.9;
/**
 * The stage, as an oval round the DJ, measured with depth squeezed: `z` moves its middle toward
 * the camera, to take in the boombox. Nobody else stands within `keep` of it, so no one is hidden
 * behind the dancers, and anyone walking by goes round it at `pass`.
 */
const STAGE = { z: 0.3, keep: 1.25, pass: 2.4 };
/**
 * The DJ and their dancers are a wall: nobody on their feet comes nearer to one of them than this
 * (middle to middle, about two bodies' width), so no one slips between them, and anything thrown
 * at them bounces off (`physics`).
 */
const WALL = 0.55;
/** Seconds after which a Mii still on its way somewhere is taken to be caught on something (`unstick`). */
const STUCK = 30;
/**
 * While music is heard, now and then someone from the crowd runs over to dance with the stage
 * (`recruit`): one every `every` seconds (a range), each staying `stay` seconds, in places either
 * side of the dancers, carrying their row on (from the DJ's spot, nearest first on each side).
 * `near` is how many of the crowd nearest the stage one is picked from, so nobody crosses the
 * whole plaza.
 */
const FANS = {
  every: [6, 14],
  stay: [15, 30],
  near: 16,
  places: [
    { x: -1.75, z: -0.35 },
    { x: 1.75, z: -0.35 },
    { x: -2.5, z: -0.45 },
    { x: 2.5, z: -0.45 },
  ],
};
/** How far each dancer may be ahead of or behind the beat, in seconds, picked afresh each visit. */
const LAG = 0.09;
/**
 * While the stage dances, now and then one dancer breaks off the routine for a solo of its own
 * (`spotlight`): the first `first` seconds after the music starts, then `every` seconds after the
 * last one ends (ranges). A solo begins at the top of a time round the routine and lasts whole
 * times round, about `length` seconds, so its dancer falls back in where the routine starts again.
 * The three on stage are picked most; each fan counts `fan` as much. It fades in over `fade`.
 */
const SOLO = { first: [5, 10], every: [7, 16], length: 5, fan: 0.35, fade: 0.3 };
/**
 * Now and then the stage dances the polka (motion.polka) in place of the routine, all three as one
 * and once through, with no solos meanwhile: `first` seconds after the music starts, then `every`
 * seconds after the last one ends (ranges). A track named in the constructor's `polka` gets it
 * all the way through instead.
 */
const POLKA = { first: [15, 30], every: [45, 90] };
/**
 * While the stage dances, the crowd within `near` of the DJ (depth squeezed) is its audience: each
 * time one of them is free, they turn to the stage and, `share` of the time, cheer along on the
 * beat for `hold` seconds (a range), otherwise just watch a moment, or `leave` of the time wander
 * off to another block. Every `every` seconds (a range) someone from further off comes over to a
 * free spot near the stage (`gather`), so who is watching keeps changing. When a solo starts,
 * `hype` of those cheering go wild for it.
 */
const AUDIENCE = { near: 5, share: 0.8, hold: [4, 9], leave: 0.15, every: [3, 7], hype: 0.6 };
/** Pants for the DJ and their dancers, as on a stage. */
const STAGE_PANTS = 0x2a2c30;
/** How much deeper than wide everything is spaced, to look even through the lens. */
const DEEP = 2.6;

/** Whether a place, from you, is on the middle group's floor and out of the lane behind you. */
function inGroup(x: number, z: number) {
  const behind = Math.abs(x) < BEHIND.x && z < 0 && z > BEHIND.z;
  return Math.abs(x) <= GROUP.x && z >= GROUP.back && z <= GROUP.front && !behind;
}

/** How far apart two places look through the lens: depth squeezed, and closer still when one is in line behind the other, hidden. */
function apart(ax: number, az: number, bx: number, bz: number) {
  const dx = Math.abs(ax - bx);
  const d = Math.hypot(dx, (az - bz) / DEEP);
  return dx < 0.55 ? d * 0.65 : d;
}

/** How near the way from a to b passes to p, depth squeezed. */
function passes(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const ex = bx - ax;
  const ez = (bz - az) / DEEP;
  const qx = px - ax;
  const qz = (pz - az) / DEEP;
  const u = clamp01((qx * ex + qz * ez) / (ex * ex + ez * ez || 1));
  return Math.hypot(qx - ex * u, qz - ez * u);
}

/**
 * How good a place in the group is, given how near the nearest other is: enough room counts for
 * all of it, past that nearer you is better, so the group stays together and never spreads thin.
 */
const roomScore = (near: number, x: number, z: number) => Math.min(near, APART * 1.4) - 0.05 * Math.hypot(x, z / DEEP);

/** Places round you for `n` friends, each the best of a handful of random tries, new on every visit. */
function scatter(n: number) {
  const placed: [number, number][] = [[0, 0]];
  for (let i = 0; i < n; i++) {
    let best: [number, number] = [GROUP.x * (i % 2 ? 1 : -1), GROUP.back];
    let score = -Infinity;
    for (let t = 0; t < 40; t++) {
      const x = (Math.random() * 2 - 1) * GROUP.x;
      const z = GROUP.back + Math.random() * (GROUP.front - GROUP.back);
      if (!inGroup(x, z)) continue;
      const s = roomScore(Math.min(...placed.map(([px, pz]) => apart(x, z, px, pz))), x, z);
      if (s > score) {
        score = s;
        best = [x, z];
      }
    }
    placed.push(best);
  }
  return placed.slice(1);
}
const PERSONAL = 0.7;
/** Your own fall: from high in the sky, where the page opens on you floating, under real gravity. */
export const SKYFALL = { height: 6.5, time: Math.sqrt((2 * 6.5) / motion.GRAVITY) };
/** Seconds every change of animation blends over. */
const FADE = 0.45;
const RUN = 9.5;
const WALK = 1.25;
/** Slower than this, a Mii that has stood still has finished its last stride and is in one place. */
const STILL = WALK * 0.1;
/** Your Mii's pants. Everyone else's are picked from the rest on each visit. */
const YOUR_PANTS = 0x1c1d20;
const PANTS = [0x8c9096, 0x40474e, 0x2a2c30, 0x28407a, 0x702015, 0x5a4030, 0xc0a030];
/** Miis stand a little larger here than in Mii Maker, as they do on the console's plaza. */
const SIZE = 1.12;
/**
 * Picked up, a Mii's feet hang this far off the floor; its body swings below the hand on this
 * length, never further out than `reach` (radians) from hanging straight down, and the swing dies
 * away at `settle` a second.
 */
const GRAB = { clear: 0.2, swing: 0.42, reach: 1.15, settle: 1.6 };
/**
 * Through the long lens a flick up the screen covers a lot of floor, so depth counts for this
 * much less in how the held body swings.
 */
const SQUEEZE = 2.4;
/** Landing on its feet, a Mii catches itself if it is this near upright and slower than this. */
const CATCH = { upright: 0.78, speed: 7, spin: 7 };
/** How hard the floor grips shoes in a skid. */
const SKID = 0.6;
/** Hit slower than this, someone on their feet is only shoved aside, not sent staggering. */
const SHOVE = 0.8;
/**
 * Bodies move and meet in steps no longer than this, and short enough that none goes further than
 * `travel` in one, so even the hardest throw can't pass through someone between frames.
 */
const TICK = { step: 1 / 240, travel: 0.08, most: 48 };
/** Knocked flat, a Mii lies there for this long, give or take, and takes this long to spring back up. */
const DOWN = { lie: 0.8, rise: 0.45 };

/** What a Mii does when tapped. Poked again and again, it loses its temper. */
const REACTIONS: [motion.Clip, number][] = [
  [motion.wave, motion.LENGTH.wave],
  [motion.hop, motion.LENGTH.hop],
  [motion.laugh, 2],
  [motion.dance, 3],
  [motion.windmill, 2],
  [motion.jacks, 2.2],
  [motion.spin, 1.6],
  [motion.panic, 1.8],
  [motion.bashful, 1.8],
  [motion.thanks, motion.LENGTH.thanks],
  [motion.point, 2],
  [motion.shock, motion.LENGTH.shock],
  [motion.faint, motion.LENGTH.faint],
  [motion.flex, 2.2],
  [motion.wink, motion.LENGTH.wink],
  [motion.skyward, 2],
];
const ANNOYED: [motion.Clip, number][] = [
  [motion.argue, 2.2],
  [motion.tantrum, 2.4],
];

type Act = 'away' | 'stand' | 'stroll' | 'dash' | 'speak' | 'fall' | 'show' | 'hover' | 'held' | 'flung' | 'down' | 'stunned' | 'flee' | 'fan';
/** Acts where you have hold of a Mii, or it is getting over it. Nothing else may interrupt them. */
const HANDLED: ReadonlySet<Act> = new Set(['held', 'flung', 'down', 'stunned', 'flee']);

interface Mii {
  /** Its index in `Crowd.miis`. */
  i: number;
  set: MiiSet;
  slot: number;
  x: number;
  z: number;
  yaw: number;
  /** Where it is headed, and which way it turns once there. */
  tx: number;
  tz: number;
  face: number;
  act: Act;
  /** When the current act began and when it ends. */
  at: number;
  until: number;
  /** Cube it gathers under. -1 for the middle group. */
  home: number;
  pace: number;
  stride: number;
  /** A number of its own in 0..1, so no two move in step. */
  k: number;
  lift: number;
  clip: motion.Clip;
  since: number;
  /**
   * The animation being faded out, and when it began. It keeps playing while it fades, so a Mii
   * mid-stride or mid-wave carries on moving into the next thing rather than freezing.
   */
  prev: motion.Clip;
  prevSince: number;
  /** When the current fade began, below zero for none, and how long it lasts. */
  faded: number;
  fadeLen: number;
  /** The pose last drawn, and a frozen copy to fade from when a change comes mid fade. */
  shown: Pose;
  held: Pose;
  /** Speed over the ground right now, easing up and down rather than jumping. */
  vel: number;
  /** The speed of its current gait, which sets how big its strides look. */
  gaitSpeed: number;
  /** How far up it is looking at your falling Mii, eased in and out (0 to 1). */
  look: number;
  /** The expression on its face, and when a change to a new one began (a blink covers the swap). */
  exprShown: number;
  exprAt: number;
  /** Turning speed while spinning on the spot. */
  spinning: number;
  blink: number;
  friend: boolean;
  lead: boolean;
  /** The DJ under the Music block, boombox on their shoulder. */
  dj: boolean;
  /**
   * For the DJ and their dancers: where they stand from the DJ's spot, which side they dance on
   * (-1 left as you look, 1 right, 0 the DJ), and which of the stage's leeks is theirs. Null for
   * everyone else.
   */
  stage: { x: number; z: number; side: number; leek: number } | null;
  /** Dancing along with the stage (`fan`): which of FANS.places it has, or -1. */
  fan: number;
  /** How far ahead of the beat (or behind, below 0) this dancer dances, in seconds. */
  lag: number;
  /**
   * Its last solo or cheer: the beat it began on (0 for a cheer, which keeps the music's count), and
   * which way round it is danced (1, or -1 mirrored).
   */
  soloAt: number;
  soloSide: number;
  spot: Spot | null;
  /** Which way it is going round the middle group on this trip: 1, -1, or 0 for not yet chosen. */
  detour: number;
  /** Who it is, for Miis from a QR image and yours. */
  who: PlazaMii | null;
  /** For the middle group: where it stands in the group and which way it faces there. */
  homeX: number;
  homeZ: number;
  homeFace: number;
  // Being played with.
  /**
   * Where the pointer wants the hand holding it, the hand itself, and the hand's speed. `grab` is
   * how far across the floor the collar was from the pointer when it was picked up, kept the same
   * while it is carried.
   */
  grip: THREE.Vector3;
  grab: THREE.Vector3;
  hand: THREE.Vector3;
  handVel: THREE.Vector3;
  /** Held, the middle of the body hanging under the hand, now and a step ago (depth squeezed, see SQUEEZE). */
  bob: THREE.Vector3;
  bobPrev: THREE.Vector3;
  /** Held or skidding, how fast the body is really going over the floor; held, how fast it is turning. */
  vel3: THREE.Vector3;
  turn: THREE.Vector3;
  /** Held, the change in speed from bumping into someone, given to the swing on the next step. */
  kick: THREE.Vector3;
  /** Held, where the middle of the body was last frame and is this frame, swept between as bodies move. */
  last: THREE.Vector3;
  next: THREE.Vector3;
  /** Let go of or knocked over, the body as it flies, bounces and lies (see toss.ts). */
  body: toss.Body;
  /** Getting up off the floor: the way it lay and the way it will stand. */
  lay: THREE.Quaternion;
  rise: THREE.Quaternion;
  /** Skidding to a stop on its feet, how fast it is turning. */
  spin: number;
  /** The whole body tipped forward and to its left (radians). */
  tipX: number;
  tipZ: number;
  /** Taps in a row, and when the last came. */
  pokes: number;
  pokedAt: number;
}

/** A place to stand. Each belongs to a cube and holds at most one Mii. */
interface Spot {
  x: number;
  z: number;
  cube: number;
  owner: Mii | null;
}

const pose = restPose();
const other = restPose();
/** Stands for "the frozen pose a fade started from" in place of a real animation. */
const HOLD: motion.Clip = () => undefined;
const still = restPose();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
/** Where a walker heads this frame: its target, or a point round something in the way (`around`). */
const _goal = { x: 0, z: 0 };
const _up = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
/** Which way is up the body of a Mii turned to `yaw` and tipped by `pitch` and `roll`, as a Pose is. */
const upOf = (yaw: number, pitch: number, roll: number, out: THREE.Vector3) => out.set(0, 1, 0).applyEuler(_e.set(pitch, yaw, roll, 'YXZ'));
const smoothstep01 = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};


export class Crowd {
  readonly miis: Mii[] = [];
  private sets: MiiSet[];
  private layout!: Layout;
  private grid = new Map<number, number[]>();
  private r: Rng;
  private applause = { from: Infinity, to: -Infinity };
  private gazing = { from: Infinity, to: -Infinity };
  private spots: Spot[] = [];
  /** Whether your Mii has waved hello since landing. */
  private waved = false;
  /** Whether the camera is in close on the middle group, which then turns to look at it. */
  private noticed = false;
  /** The DJ's index, or -1 without a Music block; where they stand; whether music is heard. */
  readonly dj: number = -1;
  private djAt = { x: 0, z: 0 };
  private djCube: number;
  private grooving = false;
  /** The music's beat, which everyone on stage dances to, kept by `listen`. */
  readonly beat = new BeatClock();
  /** The same beat counted in the polka's bars, at its own pace. */
  private readonly bars = new BeatClock(motion.POLKA_BAR);
  /** Video ids of the tracks the polka is danced to all the way through, and whether one is playing. */
  private readonly polkaTracks: Set<string>;
  private polkaSong = false;
  /** The same beat counted in pairs of turns of the Tetoris spin, at its own pace. */
  private readonly spins = new BeatClock(2 * motion.TETO_TURN);
  /** The tracks the stage dances the Tetoris spin to, by video id, each with where in it the stage stops. */
  private readonly tetoTracks: Map<string, [number, number][]>;
  /** Where the stage stops in the Tetoris song playing, null with another playing; and where in it the radio is. */
  private tetoStops: [number, number][] | null = null;
  private songAt = 0;
  /** The spin asked for without its song, for checking it (`cueTetoris`). */
  private tetoCued = false;
  /**
   * What the stage dances while music is heard: motion.idol, or motion.polka from the top of bar
   * `from` (of `bars`) until the top of bar `until`. `next` is when the polka may next begin (-1
   * until the music starts), `bar` the bar it was last frame.
   */
  private routine = { clip: motion.idol as motion.Clip, from: 0, until: 0, next: -1, bar: 0 };
  /** The leeks the stage twirls in the polka, one for each of them. */
  private readonly leeks: Leeks | null = null;
  private readonly leekNow = { show: 0, spin: 0 };
  /** Where the phone dancer's head is, for the phone to face. */
  private readonly faceAt = new THREE.Vector3();
  /** The mics the stage sings into in the Tetoris spin, one each, and how far each is out (0 to 1) and when that was. */
  private readonly mics: Mics | null = null;
  private readonly micOut: { show: number; at: number }[] = [];
  /** Beats gone by while the DJ dances, for the boombox to thump on; null while they stand. */
  djBeats: number | null = null;
  /**
   * Whether the DJ is dancing, with both hands free: the boombox is set down on the floor in front
   * of them (`djSpot`, facing you) until the music stops and they take it up again.
   */
  djDancing = false;
  readonly djSpot = { x: 0, z: 0, yaw: 0 };
  /** Who has each of FANS.places, and when the next one is asked over (-1 until the music starts). */
  private fans: (Mii | null)[] = FANS.places.map(() => null);
  private fanAt = -1;
  /** When the next of the crowd comes over to watch the stage (-1 until the music starts). */
  private gatherAt = -1;
  /** Who danced the last solo, so the next goes to someone else. */
  private lastSolo: Mii | null = null;
  /**
   * The solo going on: who dances it (null for nobody), which, and the time round it ends at the
   * top of. `next` is when the next may begin (-1 until the music starts), `loop` the time round
   * the routine was on last frame, and `want` a solo asked for by name (`cue`).
   */
  private solo = {
    who: null as Mii | null,
    clip: motion.idol as motion.Clip,
    until: 0,
    next: -1,
    loop: 0,
    want: null as { clip: motion.Clip; who: number } | null,
  };
  /**
   * Told whenever someone starts something that may make a sound, or hits the floor: the plaza's
   * voices (voices.ts) decide what it sounds like. `now` is the scene's clock as of the last update.
   */
  onCue: ((i: number, cue: Cue) => void) | null = null;
  private now = 0;
  /** Set while the visitor's own hand is behind what happens: a poke, a grab, a throw. */
  private yours = false;
  /** Set while a Mii starts saying a bubble's line: how many characters long it is. */
  private line = 0;
  /** How much the DJ's left hand is up holding the boombox, eased: 1 holding, 0 dancing. */
  private djHold = 1;
  /** Where the DJ's left wrist (the boombox hand) is in the world, rewritten every frame they are posed. */
  readonly djWrist: THREE.Matrix4 | null = null;

  constructor(
    scene: THREE.Scene,
    opts: {
      kit: MiiKit;
      renderer: THREE.WebGLRenderer;
      /** The middle group, you first. */
      hero: PlazaMii[];
      /** Miis from QR images, used before random Miis. */
      pool: PlazaMii[];
      count: number;
      cubes: number;
      /** The Music block's index, which the DJ stands under, or -1 for no DJ. */
      djCube: number;
      /** Who the DJ is; null for a random Mii. */
      dj: PlazaMii | null;
      /** Who dances either side of the DJ, left then right as you look. */
      backup: PlazaMii[];
      /** Video ids of the tracks the stage dances the polka to from start to end. */
      polka: string[];
      /** Video ids of the tracks the stage dances the Tetoris spin to, each with where in it the stage stops. */
      tetoris: Record<string, [number, number][]>;
      /** Face texture size for the crowd. */
      resolution: number;
      random: Rng;
    },
  ) {
    const r = (this.r = opts.random);
    this.polkaTracks = new Set(opts.polka);
    this.tetoTracks = new Map(Object.entries(opts.tetoris));
    type Cast = { data: Uint8Array; who: PlazaMii | null };
    const decode = (miis: PlazaMii[]) =>
      miis.flatMap((who): Cast[] => {
        const data = decodeMii(who.code);
        if (!data) return [];
        return [{ data: withLook(opts.kit, data, who), who }];
      });
    const named = decode(opts.hero).slice(0, 10);
    // A different set of famous faces stands beside you on each visit.
    const pool = decode(opts.pool);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const next = (): Cast => pool.shift() ?? { data: randomMii(opts.kit, r), who: null };
    const middle = [...named, ...Array.from({ length: Math.max(0, FRIENDS + 1 - named.length) }, next)];
    // The DJ is drawn with the middle group, sharp up close and never a flat head, but lives in the crowd.
    this.djCube = opts.djCube;
    const dj = opts.djCube < 0 ? null : ((opts.dj && decode([opts.dj])[0]) ?? { data: randomMii(opts.kit, r), who: null });
    const stage = dj ? [dj, ...decode(opts.backup)] : [];
    const others = Array.from({ length: opts.count }, next);

    const headScale = 0.125;
    // Shirts are each Mii's favorite color. Mii data has no pants, so those change on every visit.
    const anyPants = (n: number) => Array.from({ length: n }, () => PANTS[Math.floor(Math.random() * PANTS.length)]);
    const middlePants = anyPants(middle.length);
    const crowdPants = anyPants(others.length);
    const near = [...middle, ...stage];
    const middleSet = new MiiSet(opts.kit, opts.renderer, near.map((c) => c.data), {
      resolution: 512, happy: true, headScale, layer: MIRRORED,
      pants: (i) => (i === 0 ? YOUR_PANTS : i >= middle.length ? STAGE_PANTS : middlePants[i]),
      // Short sleeves on stage, as in the dance the routine comes from, so arms crossing the body show.
      sleeves: (i) => i >= middle.length,
      noBun: (i) => !!near[i].who?.noBun,
    });
    const crowdSet = new MiiSet(opts.kit, opts.renderer, others.map((c) => c.data), {
      resolution: opts.resolution, headScale, layer: MIRRORED,
      pants: (i) => crowdPants[i],
      noBun: (i) => !!others[i].who?.noBun,
    });
    middleSet.build();
    this.sets = [middleSet, crowdSet];
    scene.add(middleSet.group, crowdSet.group);

    const add = (set: MiiSet, slot: number, friend: boolean, who: PlazaMii | null) =>
      this.miis.push({
        i: this.miis.length,
        set, slot,
        x: 0, z: 0, yaw: 0,
        tx: 0, tz: 0, face: 0,
        act: 'stand',
        at: 0,
        until: 1 + r() * 4,
        home: friend ? -1 : Math.floor(r() * opts.cubes),
        pace: 0.88 + r() * 0.24,
        stride: r() * 6.28,
        k: r(),
        lift: 0,
        clip: motion.stand,
        since: -r() * 20,
        prev: motion.stand,
        prevSince: 0,
        faded: -1,
        fadeLen: FADE,
        shown: restPose(),
        held: restPose(),
        vel: 0,
        gaitSpeed: 1,
        look: 0,
        exprShown: 0,
        exprAt: -1,
        spinning: 0,
        blink: 1 + r() * 4,
        friend,
        lead: friend && slot === 0,
        dj: false,
        stage: null,
        fan: -1,
        spot: null,
        detour: 0,
        who: who?.name ? who : null,
        homeX: 0,
        homeZ: 0,
        homeFace: 0,
        grip: new THREE.Vector3(),
        grab: new THREE.Vector3(),
        hand: new THREE.Vector3(),
        handVel: new THREE.Vector3(),
        bob: new THREE.Vector3(),
        bobPrev: new THREE.Vector3(),
        vel3: new THREE.Vector3(),
        turn: new THREE.Vector3(),
        kick: new THREE.Vector3(),
        last: new THREE.Vector3(),
        next: new THREE.Vector3(),
        body: toss.body(),
        lay: new THREE.Quaternion(),
        rise: new THREE.Quaternion(),
        spin: 0,
        tipX: 0,
        tipZ: 0,
        pokes: 0,
        pokedAt: -Infinity,
        lag: 0,
        soloAt: 0,
        soloSide: 1,
      });
    middle.forEach((c, i) => add(middleSet, i, true, c.who));
    // The DJ, then their dancers, out to either side in turn, left first.
    stage.forEach((c, j) => {
      const slot = middle.length + j;
      add(middleSet, slot, false, c.who);
      const m = this.miis[slot];
      m.home = opts.djCube;
      const side = j === 0 ? 0 : j % 2 ? -1 : 1;
      m.stage = { x: side * BACKUP.gap * Math.ceil(j / 2), z: side ? BACKUP.back : 0, side, leek: j };
      m.lag = (this.r() * 2 - 1) * LAG;
    });
    if (dj) {
      this.miis[middle.length].dj = true;
      this.dj = middle.length;
      this.djWrist = middleSet.track(middle.length, 'wrist_l');
      this.leeks = new Leeks(
        scene,
        stage.map((_, j) => middleSet.track(middle.length + j, 'wrist_r')),
        stage.map((c) => c.who?.prop ?? 'leek'),
      );
      this.mics = new Mics(scene, stage.map((_, j) => middleSet.track(middle.length + j, 'wrist_l')));
      this.micOut = stage.map(() => ({ show: 0, at: 0 }));
    }
    others.forEach((c, i) => add(crowdSet, i, false, c.who));
  }

  /**
   * Who wears something drawn on their head (a headset, a ponytail: MiiLook in plaza/types.ts), and
   * what: the DJ, their dancers and the middle group only, whose heads are always real. A crowd
   * Mii far off is a flat picture, which nothing can sit on.
   */
  get gear() {
    return this.miis.flatMap((m, i) => (m.who && (m.who.headset || m.who.ponytail) && m.set === this.sets[0] ? [{ i, look: m.who }] : []));
  }

  /** Where Mii `i`'s head is in the world this frame, or null while it is out of sight. */
  headOf(i: number) {
    const m = this.miis[i];
    return m.act === 'away' || m.set.isHidden(m.slot) ? null : m.set.headMatrix(m.slot);
  }

  /** Whether the DJ is out on the floor to be seen. */
  djShown() {
    if (this.dj < 0) return false;
    const m = this.miis[this.dj];
    return m.act !== 'away' && !m.set.isHidden(m.slot);
  }

  /** Which way the DJ faces, and how big they are drawn. */
  djFrame() {
    const m = this.miis[this.dj];
    return { yaw: m.yaw + m.shown.yaw, scale: SIZE };
  }

  /** Music is heard (`true`) or not: the DJ and their dancers dance the routine, or they stand. */
  setGroove(on: boolean) {
    this.grooving = on;
  }

  /**
   * Keeps the stage in time with the radio: `track` is what is playing out loud (null for nothing
   * heard), `at` where in it the radio is, in seconds.
   */
  listen(dt: number, track: Track | null, at: number) {
    this.beat.update(dt, track?.beats, at);
    this.bars.update(dt, track?.beats, at);
    this.spins.update(dt, track?.beats, at);
    this.polkaSong = !!track && this.polkaTracks.has(track.videoId);
    this.tetoStops = (track && this.tetoTracks.get(track.videoId)) ?? null;
    this.songAt = at;
  }

  /** Has the stage dance the Tetoris spin as if its song were playing (or stop with `false`), for checking it. */
  cueTetoris(on = true) {
    this.tetoCued = on;
  }

  /** Has the stage dance the polka from the top of the next bar (or stop it there with `false`), for checking it. */
  cuePolka(on = true) {
    const r = this.routine;
    if (on) r.next = 0;
    else if (r.clip === motion.polka) r.until = Math.floor(this.bars.loops) + 1;
  }

  /** The batch of Miis in the crowd (everyone but you and your friends). */
  get crowdSet() {
    return this.sets[1];
  }

  /** How many places to stand there are, and how many Miis have one. */
  stats() {
    return { spots: this.spots.length, placed: this.miis.filter((m) => m.spot).length, crowd: this.miis.filter((m) => !m.friend).length };
  }

  /** Builds crowd heads until `deadline` (performance.now() ms). True once every head exists. */
  build(deadline: number) {
    const set = this.sets.find((s) => !s.ready);
    return set ? set.build(deadline) && this.sets.every((s) => s.ready) : true;
  }

  /** Stands the middle group in its circle and gives everyone else a spot under their cube. */
  setLayout(layout: Layout) {
    const old: Layout | undefined = this.layout;
    this.layout = layout;
    const moved = old && old.tall === layout.tall && old.anchors.length === layout.anchors.length;
    const places = moved ? [] : scatter(this.miis.filter((m) => m.friend).length - 1);
    this.miis.forEach((m, i) => {
      if (moved) {
        // A resized window carries everyone along with their cube, mid step or not.
        const from = m.friend ? old.hero : old.anchors[m.home % old.anchors.length];
        const to = m.friend ? layout.hero : layout.anchors[m.home % layout.anchors.length];
        m.x += to.x - from.x;
        m.z += to.z - from.z;
        m.tx += to.x - from.x;
        m.tz += to.z - from.z;
        m.homeX += to.x - from.x;
        m.homeZ += to.z - from.z;
        m.grip.x += to.x - from.x;
        m.grip.z += to.z - from.z;
        return;
      }
      m.spot = null;
      if (m.lead) {
        m.x = layout.hero.x;
        m.z = layout.hero.z;
      } else if (m.friend) {
        // Friends come straight after you in the list.
        const [dx, dz] = places[i - 1];
        m.x = layout.hero.x + dx;
        m.z = layout.hero.z + dz;
        m.yaw = m.face = this.towardYou(m, Math.random());
      }
      if (m.friend) {
        m.homeX = m.x;
        m.homeZ = m.z;
        m.homeFace = m.face;
      }
    });
    if (this.dj >= 0) {
      const a = layout.anchors[this.djCube % layout.anchors.length];
      this.djAt = { x: a.x, z: a.z + DJ_SPOT.forward };
    }
    this.lay();
    for (const m of this.miis) {
      if (m.friend) continue;
      const keep = moved && m.act !== 'away';
      if (m.stage) {
        m.tx = this.djAt.x + m.stage.x;
        m.tz = this.djAt.z + m.stage.z;
        if (!keep) {
          m.x = m.tx;
          m.z = m.tz;
          m.yaw = m.face = 0;
        }
        continue;
      }
      this.claim(m, this.nearest(m.home, keep ? m.x : null, keep ? m.z : null));
      if (!keep) {
        m.x = m.tx;
        m.z = m.tz;
        m.yaw = m.face;
      }
    }
  }

  /**
   * Lays out places to stand around every cube: spread evenly, an arm's length apart, never in the
   * middle group's circle. Measured with depth squeezed, so they look even through the long lens.
   */
  private lay() {
    const { anchors } = this.layout;
    const spots: Spot[] = [];
    // Rows through the long lens stack up on screen, so spots sit further apart in depth than across.
    const gap = PERSONAL * 1.5;
    const deep = DEEP * 1.35;
    const dj = this.dj >= 0 ? this.djAt : null;
    const free = (x: number, z: number) => {
      if (this.outside(x, z) < 0.6) return false;
      if (dj && (x - dj.x) ** 2 + ((z - dj.z) / deep) ** 2 < DJ_SPOT.clear ** 2) return false;
      for (const s of spots) if ((s.x - x) ** 2 + ((s.z - z) / deep) ** 2 < gap * gap) return false;
      return true;
    };
    // Cubes take turns, one spot each round, so neighbors share the ground fairly. A third more
    // spots than Miis keeps room for strolling.
    const want = Math.ceil((this.miis.length / anchors.length) * 2.4);
    for (let round = 0; round < want; round++) {
      anchors.forEach((a, cube) => {
        for (let tries = 0; tries < 40; tries++) {
          // A loose oval around the mark, reaching further toward the camera than away from it.
          const angle = this.r() * Math.PI * 2;
          const u = Math.sqrt(this.r());
          // Groups behind the middle spread sideways, so they do not pile up in front of each other.
          const back = a.z < this.layout.hero.z;
          const x = a.x + Math.cos(angle) * u * (back ? 4.8 : 3.9);
          const z = a.z + 1.6 + Math.sin(angle) * u * (Math.sin(angle) > 0 ? (back ? 4.5 : 8.5) : 4.2);
          if (!free(x, z)) continue;
          spots.push({ x, z, cube, owner: null });
          break;
        }
      });
    }
    this.spots = spots;
  }

  /** The free spot of `cube` nearest to (x, z), or a random one. Any cube's, if that one is full. */
  private nearest(cube: number, x: number | null, z: number | null): Spot | null {
    const open = this.spots.filter((s) => !s.owner && s.cube === cube);
    const pool = open.length ? open : this.spots.filter((s) => !s.owner);
    if (!pool.length) return null;
    if (x === null || z === null) return pool[Math.floor(this.r() * pool.length)];
    let best = pool[0];
    let near = Infinity;
    for (const s of pool) {
      const d = (s.x - x) ** 2 + ((s.z - z) / DEEP) ** 2;
      if (d < near) {
        near = d;
        best = s;
      }
    }
    return best;
  }

  /** Moves Mii `m` to spot `s`, giving up the one it had. */
  private claim(m: Mii, s: Spot | null) {
    if (!s) return;
    if (m.spot) m.spot.owner = null;
    s.owner = m;
    m.spot = s;
    m.home = s.cube;
    m.tx = s.x;
    m.tz = s.z;
    m.detour = 0;
    const a = this.layout.anchors[s.cube];
    // Most face the middle of their group, the rest face out toward the camera.
    m.face = this.r() < 0.6 ? Math.atan2(a.x - s.x, (a.z + 1.3 - s.z) / DEEP) + (this.r() - 0.5) * 1.1 : (this.r() - 0.5) * 1.1;
  }

  /** A free spot near where Mii `m` stands now, for a stroll. */
  private wander(m: Mii) {
    const reach = 2.4;
    const near = this.spots.filter((s) => !s.owner && s.cube === m.home && Math.abs(s.x - m.x) < reach && Math.abs(s.z - m.z) < reach * DEEP);
    this.claim(m, near.length ? near[Math.floor(this.r() * near.length)] : this.nearest(m.home, m.x, m.z));
  }

  /** Steady state, no intro: everyone where they belong. */
  settle(time: number) {
    this.applause.to = -Infinity;
    this.gazing.to = -Infinity;
    for (const m of this.miis) {
      m.lift = 0;
      if (m.friend) {
        this.rest(m, time, 2 + this.r() * 5);
        continue;
      }
      if (m.act === 'away' || m.act === 'dash') {
        m.x = m.tx;
        m.z = m.tz;
        m.yaw = m.face;
      }
      this.rest(m, time, this.r() * 5);
    }
  }

  /** Before anything begins: only you, floating high in the sky. Everyone else waits out of sight. */
  hover(time: number) {
    for (const m of this.miis) {
      if (m.friend) {
        // Friends are already down on the floor, facing the spot where you will land.
        this.rest(m, time, Infinity);
        m.lift = 0;
        m.yaw = m.face;
        continue;
      }
      m.act = 'away';
      m.at = Infinity;
    }
    this.waved = false;
    const lead = this.miis[0];
    lead.act = 'hover';
    lead.lift = SKYFALL.height;
    lead.clip = motion.float;
    lead.since = time;
    lead.faded = -1;
  }

  /** The fall, from `time`: you drop from the sky to your friends waiting below. */
  drop(time: number) {
    const lead = this.miis[0];
    lead.act = 'fall';
    lead.at = time;
    lead.lift = SKYFALL.height;
    this.play(lead, motion.fall, time);
    for (const m of this.miis) {
      if (m.lead) continue;
      if (m.friend) {
        if (m.act !== 'stand') this.rest(m, time, Infinity);
        m.lift = 0;
        continue;
      }
      m.act = 'away';
      m.at = Infinity;
    }
  }

  /** How high your Mii is off the floor. */
  leadLift() {
    return this.miis[0].lift;
  }

  /** From `from` to `to`, you wave hello and your friends clap for you. */
  applaud(from: number, to: number) {
    this.applause = { from, to };
  }

  /**
   * Everyone who is free turns to the camera and dances, for a few seconds each (the Konami code).
   * You stay out of it, to say why.
   */
  party(time: number, camera: THREE.Vector3) {
    for (const m of this.miis) {
      if (m.lead || HANDLED.has(m.act) || m.act === 'away' || m.act === 'hover' || m.act === 'fall') continue;
      m.face = Math.atan2(camera.x - m.x, camera.z - m.z);
      this.perform(m, motion.dance, time, 3 + this.r() * 2);
    }
  }

  /** The camera has come in close (`true`) or gone back out: the middle group turns to look at it, or goes back to its own business. */
  notice(on: boolean, time: number) {
    if (on === this.noticed) return;
    this.noticed = on;
    for (const m of this.miis) {
      if (!m.friend || m.act === 'fall' || m.act === 'hover') continue;
      // Each turns in their own moment rather than all at once.
      if (m.act === 'stand' || m.act === 'show') this.rest(m, time, 0.15 + this.r() * 0.9);
    }
  }

  /** The middle group stares up at the sky between `from` and `to`. */
  gaze(from: number, to: number) {
    this.gazing = { from, to };
  }

  /**
   * The crowd runs in from the far end, starting at `time` and all home `span` seconds later.
   * They come the way the footsteps in the recording do: a few scouts, a rush, a lull, a second rush.
   */
  arrive(time: number, span: number) {
    const { far } = this.layout;
    for (const m of this.miis) {
      if (m.friend) continue;
      m.x = m.tx * 0.6 + (this.r() - 0.5) * far.halfWidth * 0.9;
      m.z = far.z - 3 - this.r() * 10;
      m.yaw = Math.atan2(m.tx - m.x, m.tz - m.z);
      m.act = 'away';
      const roll = this.r();
      const wave = roll < 0.08 ? this.r() * 3 : roll < 0.64 ? 3 + this.r() * 5.5 : roll < 0.72 ? 8.5 + this.r() * 2.5 : 11 + this.r() * 3.5;
      // Whoever has the longest way to go sets off early enough to be home with the rest.
      const trip = Math.hypot(m.tx - m.x, m.tz - m.z) / (RUN * m.pace);
      m.at = time + Math.max(0.1, Math.min(wave, span - trip));
    }
  }

  /** Miis under `cube` who are free to speak, shuffled: only those standing still in one place, never one on its way. */
  speakers(cube: number) {
    const out: number[] = [];
    this.miis.forEach((m, i) => {
      if (m.home === cube && !m.stage && this.still(m)) out.push(i);
    });
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Whether Mii `i` can take a bubble right now: standing still in one place. */
  free(i: number) {
    return this.still(this.miis[i]);
  }

  /** Whether Mii `m` has arrived and stopped: standing, its last stride done, not between one place and the next. */
  private still(m: Mii) {
    return m.act === 'stand' && m.vel < STILL;
  }

  /** Mii `i` turns to the camera and talks for `seconds`, saying `line` (out loud, as a Mii would: voices.ts). */
  say(i: number, time: number, seconds: number, line = '') {
    const m = this.miis[i];
    m.act = 'speak';
    m.at = time;
    m.until = time + seconds;
    this.line = line.length;
    this.play(m, motion.talk, time);
    this.line = 0;
  }

  /** Mii `i` stops talking, if it was: its bubble was pressed. */
  hush(i: number, time: number) {
    const m = this.miis[i];
    if (m.act === 'speak') this.rest(m, time, 1 + this.r() * 2);
  }

  headTop(i: number, out: THREE.Vector3) {
    const m = this.miis[i];
    return out.set(m.x, m.set.headTop(m.slot) * SIZE + m.lift, m.z);
  }

  // Playing with them -----------------------------------------------------------------------------

  /** Who Mii `i` is, if it has a name. */
  who(i: number) {
    return this.miis[i].who;
  }

  /** Whether Mii `i` is being held. */
  held(i: number) {
    return this.miis[i].act === 'held';
  }

  /**
   * The Mii under the screen point (x, y) in CSS pixels, nearest the camera first, or -1. Each Mii
   * is a band from its feet to the top of its head, along the body however it lies, wide enough to
   * catch small ones far away.
   */
  pick(camera: THREE.Camera, x: number, y: number, w: number, h: number, prefer = -1) {
    let best = -1;
    let kept = false;
    let near = Infinity;
    this.miis.forEach((m, i) => {
      if (m.act === 'away' || m.act === 'hover' || m.act === 'fall' || m.act === 'held' || m.set.isHidden(m.slot)) return;
      upOf(m.yaw, m.tipX, m.tipZ, _up);
      _a.set(m.x, m.lift, m.z);
      _b.copy(_a).addScaledVector(_up, m.set.headTop(m.slot) * SIZE);
      _a.project(camera);
      if (_a.z > 1) return;
      _b.project(camera);
      const fx = (_a.x + 1) * 0.5 * w;
      const fy = (1 - _a.y) * 0.5 * h;
      const depth = _a.z;
      // From the feet to the head on screen, and how far along and off to the side the point is.
      const lx = (_b.x + 1) * 0.5 * w - fx;
      const ly = (1 - _b.y) * 0.5 * h - fy;
      const len = Math.hypot(lx, ly) || 1;
      const along = ((x - fx) * lx + (y - fy) * ly) / len;
      const off = Math.abs((x - fx) * ly - (y - fy) * lx) / len;
      if (off > Math.max(9, len * 0.3) || along < -4 || along > len + 4) return;
      // The one already pointed at stays picked while it is under the pointer, whoever walks past.
      if (i === prefer) kept = true;
      if (depth < near) {
        near = depth;
        best = i;
      }
    });
    return kept ? prefer : best;
  }

  /** Tapped: Mii `i` turns to the camera and does something for it, or loses it if you keep on. */
  poke(i: number, time: number, camera: THREE.Vector3) {
    const m = this.miis[i];
    if (HANDLED.has(m.act) || m.act === 'away' || m.act === 'hover' || m.act === 'fall') return;
    m.set.liven(m.slot);
    m.face = Math.atan2(camera.x - m.x, camera.z - m.z);
    m.pokes = time - m.pokedAt < 4 ? m.pokes + 1 : 1;
    m.pokedAt = time;
    const list = m.pokes >= 4 ? ANNOYED : REACTIONS;
    let pick = list[Math.floor(this.r() * list.length)];
    // Never the same thing twice running.
    if (pick[0] === m.clip) pick = list[(list.indexOf(pick) + 1) % list.length];
    const [clip, seconds] = pick;
    if (clip === motion.spin) m.spinning = (this.r() < 0.5 ? -1 : 1) * (8 + this.r() * 4);
    this.yours = true;
    this.perform(m, clip, time, seconds);
    this.yours = false;
  }

  /** Picks Mii `i` up by the back of its shirt, the hand following `ray` (see `carry`). */
  grab(i: number, time: number, ray: THREE.Ray) {
    const m = this.miis[i];
    // The DJ won't be parted from the boombox, nor the dancers from the DJ.
    if (m.stage || m.act === 'away' || m.act === 'hover' || m.act === 'fall' || m.act === 'held') return false;
    m.set.liven(m.slot);
    if (m.spot) m.spot.owner = null;
    m.spot = null;
    const collar = m.set.collar(m.slot) * SIZE;
    // The hand closes on the collar wherever it is, standing, lying or in the air, then lifts it
    // to the pointer, and the body swings down under it from the way it was.
    upOf(m.yaw, m.tipX, m.tipZ, _up);
    m.hand.set(m.x, m.lift, m.z).addScaledVector(_up, collar);
    m.grip.copy(m.hand);
    m.handVel.set(0, 0, 0);
    m.bob.set(m.hand.x, m.hand.y, m.hand.z / SQUEEZE).addScaledVector(_up, -GRAB.swing);
    m.bobPrev.copy(m.bob);
    m.vel3.set(0, 0, 0);
    m.turn.set(0, 0, 0);
    m.kick.set(0, 0, 0);
    toss.stand(m.body, m.x, m.lift, m.z, m.yaw, m.tipX, m.tipZ, m.set.headTop(m.slot) * SIZE);
    m.spin = 0;
    m.vel = 0;
    m.act = 'held';
    m.at = time;
    this.yours = true;
    this.play(m, motion.dangle, time, true);
    this.yours = false;
    // It is lifted straight up where it was, whatever part of it was pressed: through the long lens
    // the pointer's spot at carrying height can be well behind or in front of the Mii itself.
    m.grab.set(0, 0, 0);
    if (this.atCarry(m, ray, _b)) m.grab.set(m.hand.x - _b.x, 0, m.hand.z - _b.z);
    this.carry(i, ray);
    return true;
  }

  /** Where `ray` meets the height Mii `m` is carried at, into `out`; false if it never does. */
  private atCarry(m: Mii, ray: THREE.Ray, out: THREE.Vector3) {
    if (ray.direction.y > -1e-4) return false;
    ray.at((m.set.collar(m.slot) * SIZE + GRAB.clear - ray.origin.y) / ray.direction.y, out);
    return true;
  }

  /**
   * Moves the hand holding Mii `i` with `ray` (from the camera through the pointer) where it meets
   * the height it is carried at, so the Mii moves just as far as the pointer does.
   */
  carry(i: number, ray: THREE.Ray) {
    const m = this.miis[i];
    if (m.act !== 'held' || !this.atCarry(m, ray, _b)) return;
    _b.add(m.grab);
    const { far } = this.layout;
    _b.x = clamp(_b.x, -far.halfWidth * 1.1, far.halfWidth * 1.1);
    _b.z = Math.max(_b.z, far.z - 4);
    m.grip.copy(_b);
  }

  /**
   * Lets go of Mii `i`. It carries on exactly as it was going in your hand, no faster and no other
   * way: let go while still it drops where it is, let go on the move and it flies on, turning as it
   * swung, slowed only by the air and then the floor. Landing near upright it catches itself and
   * skids; any other way it bounces, slides, lies there a moment and gets up. Then it runs for it.
   */
  release(i: number, time: number) {
    const m = this.miis[i];
    if (m.act !== 'held') return;
    const b = m.body;
    b.vel.copy(m.vel3);
    b.omega.copy(m.turn);
    m.act = 'flung';
    m.at = time;
    this.play(m, Math.hypot(b.vel.x, b.vel.z) > 2.2 ? motion.fall : motion.dangle, time);
  }

  update(dt: number, time: number, camera: THREE.Vector3, calm: boolean) {
    this.now = time;
    this.recruit(time, calm);
    this.program(time, calm);
    this.spotlight(time, calm);
    this.gather(time, calm);
    for (const m of this.miis) this.think(m, dt, time, camera, calm);
    this.djHold += ((this.djDancing ? 0 : 1) - this.djHold) * Math.min(1, dt * 7);
    this.physics(dt, time);
    this.separate();
    this.wall();
    for (const m of this.miis) this.draw(m, time, calm);
    for (const set of this.sets) set.commit();
  }

  // Behavior -------------------------------------------------------------------------------------

  /** Distance from the edge of the middle group's oval. Negative inside it. */
  private outside(x: number, z: number) {
    const { hero } = this.layout;
    return Math.hypot(x - hero.x - KEEP_OUT.x, (z - hero.z - KEEP_OUT.z) / (DEEP * 0.75)) - KEEP_OUT.r;
  }

  /**
   * Switches to `clip`, blending from whatever is playing over `fade` seconds. `again`
   * restarts a clip already playing.
   */
  private play(m: Mii, clip: motion.Clip, time: number, again = false, fade = FADE) {
    if (m.clip === clip && !again) return;
    // Restarted every frame (a held Mii's stagger), a clip is heard only the first time.
    if (this.onCue && (m.clip !== clip || time - m.since > 0.3)) this.heard(m, clip, time);
    // Mid fade, start the new fade from exactly what is on screen, so nothing jumps.
    const w = m.faded >= 0 ? clamp01((time - m.faded) / m.fadeLen) : 1;
    if (w < 1) {
      motion.copyJoints(m.shown, m.held);
      m.prev = HOLD;
    } else {
      m.prev = m.clip;
    }
    m.prevSince = m.since;
    m.faded = time;
    m.fadeLen = fade;
    m.clip = clip;
    m.since = time;
  }

  /** Tells `onCue` that `m` starts `clip` at `time` (or comes down `hit` hard, with no clip). */
  private heard(m: Mii, clip: motion.Clip | null, time: number, hit = 0) {
    const flung = m.act === 'flung';
    this.onCue?.(m.i, {
      clip,
      delay: Math.max(0, time - this.now),
      seconds: Math.max(0, m.until - time),
      // Whoever goes flying, the visitor threw something.
      you: this.yours || flung || clip === null,
      bubble: m.act === 'speak',
      line: this.line,
      flung,
      hit,
      beat: this.beat.beatLength,
    });
  }

  /** What Mii `i` sounds like: the same all visit, and for a named Mii on every visit. */
  speaker(i: number): Speaker {
    const m = this.miis[i];
    let seed = m.k;
    if (m.who?.name) {
      let h = 2166136261;
      for (const c of m.who.name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      seed = (h >>> 0) / 4294967296;
    }
    return { id: i, seed, ...m.set.figure(m.slot) };
  }

  private rest(m: Mii, time: number, seconds: number) {
    m.act = 'stand';
    m.at = time;
    m.until = time + seconds;
    this.play(m, motion.stand, time);
  }

  /** A one off: wave, hop, look up. The Mii stays put until it ends. */
  private perform(m: Mii, clip: motion.Clip, time: number, seconds: number) {
    m.act = 'show';
    m.at = time;
    m.until = time + seconds;
    this.play(m, clip, time, true);
  }

  private think(m: Mii, dt: number, time: number, camera: THREE.Vector3, calm: boolean) {
    if (time > m.blink + 0.13) m.blink = time + 1.6 + this.r() * 4.5;
    // Standing still, any leftover speed dies away, so strides shrink to nothing rather than stop.
    const going = m.act === 'dash' || m.act === 'stroll' || m.act === 'flee' || (m.act === 'fan' && m.until === Infinity);
    if (!going) m.vel *= Math.exp(-8 * dt);
    const toCamera = Math.atan2(camera.x - m.x, camera.z - m.z);

    if (HANDLED.has(m.act)) return this.handled(m, dt, time, toCamera);
    if (m.friend) return this.middle(m, dt, time, toCamera, calm);

    switch (m.act) {
      case 'away':
        if (time >= m.at) {
          // They set off out in the haze already at a run.
          m.act = 'dash';
          m.vel = RUN * m.pace;
          m.gaitSpeed = RUN * m.pace;
          this.play(m, motion.run, time);
          m.faded = -1;
        }
        return;
      case 'dash':
        if (this.step(m, RUN * m.pace, 1.75, dt)) this.rest(m, time, 1.5 + this.r() * 4);
        else this.unstick(m, time);
        return;
      case 'stroll':
        if (this.step(m, WALK * m.pace, 5.6, dt)) this.rest(m, time, 2 + this.r() * 5);
        else this.unstick(m, time);
        return;
      case 'speak':
        this.turn(m, toCamera, dt);
        this.keepSpot(m, dt);
        if (time >= m.until) this.rest(m, time, 2 + this.r() * 3);
        return;
      case 'show': {
        if (m.clip === motion.spin) m.yaw += m.spinning * dt;
        else this.turn(m, m.face, dt);
        this.keepSpot(m, dt);
        // The music stopped: the audience stops cheering, each in their own moment.
        const cheering = motion.cheering(m.clip);
        if (cheering && !this.grooving && m.until > time + 1.5) m.until = time + this.r() * 1.5;
        if (time < m.until) return;
        if (cheering && !calm && this.watching(m)) this.decide(m, time, toCamera);
        else this.rest(m, time, 1.5 + this.r() * 4);
        return;
      }
      case 'fan':
        return this.fan(m, dt, time, toCamera);
      default:
        if (m.stage) return this.onStage(m, dt, time, toCamera, calm);
        this.turn(m, m.face, dt);
        this.keepSpot(m, dt);
        if (!calm && time >= m.until) this.decide(m, time, toCamera);
    }
  }

  /**
   * The DJ and their dancers keep their places facing out, and while music is heard all three
   * dance the routine as one, square on to you.
   */
  private onStage(m: Mii, dt: number, time: number, toCamera: number, calm: boolean) {
    const side = m.stage!.side;
    const dancing = this.grooving && !calm;
    // Standing, the DJ turns a touch to their right, so the boombox on the left shoulder faces you
    // too, and the dancers turn a little in toward them.
    this.turn(m, toCamera + (dancing ? 0 : side ? -side * 0.2 : -0.25), dt);
    this.keepSpot(m, dt);
    const clip = !dancing ? motion.stand : this.solo.who === m ? this.solo.clip : this.routine.clip;
    if (m.clip !== clip) this.play(m, clip, time);
    if (m.dj) {
      this.djDancing = dancing;
      this.djSpot.x = this.djAt.x + Math.sin(toCamera) * BOOMBOX_DOWN;
      this.djSpot.z = this.djAt.z + Math.cos(toCamera) * BOOMBOX_DOWN;
      this.djSpot.yaw = toCamera;
    }
  }

  /**
   * Starts and ends the polka (see POLKA): it begins at the top of a bar once no solo is going on,
   * and once through it is back to the routine, unless the track it is danced to all the way
   * through is still playing.
   */
  private program(time: number, calm: boolean) {
    const r = this.routine;
    const bar = Math.floor(this.bars.loops);
    const top = bar !== r.bar;
    r.bar = bar;
    const between = ([a, b]: number[]) => a + this.r() * (b - a);
    if (this.dj < 0 || calm || !this.grooving) {
      r.clip = motion.idol;
      r.next = -1;
      return;
    }
    if (r.next < 0) r.next = time + between(POLKA.first);
    // The Tetoris song: the spin from start to end, standing square on wherever Teto stops, and
    // neither polka nor solos meanwhile. Once it is over, back to the routine for a while first.
    const stops = this.tetoStops ?? (this.tetoCued ? [] : null);
    if (stops) {
      r.clip = stops.some(([a, z]) => this.songAt >= a && this.songAt < z) ? motion.tetoPose : motion.tetoris;
      return;
    }
    if (r.clip === motion.tetoris || r.clip === motion.tetoPose) {
      r.clip = motion.idol;
      r.next = time + between(POLKA.every);
      this.solo.next = Math.max(this.solo.next, time + between(SOLO.first));
      return;
    }
    if (!top) return;
    if (r.clip === motion.polka) {
      if (bar < r.until) return;
      if (this.polkaSong) {
        r.until = bar + motion.POLKA_BEATS / 4;
        return;
      }
      r.clip = motion.idol;
      r.next = time + between(POLKA.every);
      // A moment all together again before anyone breaks off for a solo.
      this.solo.next = Math.max(this.solo.next, time + between(SOLO.first));
      return;
    }
    if (this.solo.who || (time < r.next && !this.polkaSong)) return;
    r.clip = motion.polka;
    r.from = bar;
    r.until = bar + motion.POLKA_BEATS / 4;
  }

  /**
   * Starts and ends solos (see SOLO). One dancer at a time, never the same one or the same move
   * twice running, and only someone dancing the routine right now.
   */
  private spotlight(time: number, calm: boolean) {
    const s = this.solo;
    const loop = Math.floor(this.beat.loops);
    const top = loop !== s.loop;
    s.loop = loop;
    const between = ([a, b]: number[]) => a + this.r() * (b - a);
    if (this.dj < 0 || calm || !this.grooving) {
      s.who = null;
      s.next = -1;
      return;
    }
    if (s.next < 0) s.next = time + between(SOLO.first);
    const m = s.who;
    if (m) {
      // Picked up, knocked over or gone home mid solo: it is over.
      if (m.clip !== s.clip) s.who = null;
      else if (top && loop >= s.until) {
        s.who = null;
        this.play(m, this.routine.clip, time);
      }
      if (!s.who) s.next = time + between(SOLO.every);
      return;
    }
    if (!top || this.routine.clip !== motion.idol || (time < s.next && !s.want)) return;
    const pool = this.miis.filter((o) => o.clip === motion.idol && (o.stage || o.act === 'fan'));
    const wanted = s.want && this.miis[s.want.who];
    let who = wanted && pool.includes(wanted) ? wanted : null;
    if (!who) {
      const fresh = pool.filter((o) => o !== this.lastSolo);
      const from = fresh.length ? fresh : pool;
      const weight = (o: Mii) => (o.stage ? 1 : SOLO.fan);
      let pick = this.r() * from.reduce((sum, o) => sum + weight(o), 0);
      who = from.find((o) => (pick -= weight(o)) < 0) ?? from[0];
    }
    if (!who) return;
    const moves = Object.values(motion.SOLOS).filter((c) => c !== s.clip);
    s.clip = s.want?.clip ?? moves[Math.floor(this.r() * moves.length)];
    s.want = null;
    s.who = who;
    this.lastSolo = who;
    // Whole times round, and whole times round the solo, so it ends where it began.
    let n = Math.max(1, Math.round(SOLO.length / this.beat.period));
    while ((n * this.beat.perLoop) % motion.soloBeats(s.clip)) n++;
    s.until = loop + n;
    who.soloAt = Math.round(this.beat.beats);
    who.soloSide = this.r() < 0.5 ? 1 : -1;
    this.play(who, s.clip, time, false, SOLO.fade);
    // The audience goes wild for it, for as long as it lasts.
    for (const o of this.miis) {
      if (o.act === 'show' && motion.cheering(o.clip) && this.r() < AUDIENCE.hype) this.cheer(o, time, motion.hype, n * this.beat.period);
    }
  }

  /** Whether `m`, from the crowd and on its own spot, is near enough the dancing stage to watch it. */
  private watching(m: Mii) {
    if (this.dj < 0 || !this.grooving || m.friend || m.stage || m.fan >= 0 || !m.spot) return false;
    return this.byStage(m.x, m.z);
  }

  /** Whether a place is near enough the stage to watch it from. */
  private byStage(x: number, z: number) {
    return (x - this.djAt.x) ** 2 + ((z - this.djAt.z) / DEEP) ** 2 < AUDIENCE.near ** 2;
  }

  /**
   * While the stage dances, now and then someone standing about further off comes over to a free
   * spot near it to watch, at a walk or, keen, at a run.
   */
  private gather(time: number, calm: boolean) {
    if (this.dj < 0 || calm || !this.grooving) {
      this.gatherAt = -1;
      return;
    }
    const wait = () => AUDIENCE.every[0] + this.r() * (AUDIENCE.every[1] - AUDIENCE.every[0]);
    if (this.gatherAt < 0) this.gatherAt = time + wait();
    if (time < this.gatherAt) return;
    this.gatherAt = time + wait();
    const free = this.spots.filter((s) => !s.owner && this.byStage(s.x, s.z));
    const idle = this.miis.filter((m) => !m.friend && !m.stage && m.fan < 0 && m.act === 'stand' && m.spot && !this.byStage(m.x, m.z));
    if (!free.length || !idle.length) return;
    const m = idle[Math.floor(this.r() * idle.length)];
    this.claim(m, free[Math.floor(this.r() * free.length)]);
    m.at = time;
    if (this.r() < 0.5) {
      m.act = 'dash';
      this.play(m, motion.run, time);
    } else {
      m.act = 'stroll';
      this.play(m, motion.walk, time);
    }
  }

  /** Cheers the stage on (one of motion.CHEERS, or `clip`) for `seconds`, on the beat give or take a little. */
  private cheer(m: Mii, time: number, clip?: motion.Clip, seconds?: number) {
    if (!clip) {
      let pick = this.r() * motion.CHEERS.reduce((sum, [, w]) => sum + w, 0);
      clip = (motion.CHEERS.find(([, w]) => (pick -= w) < 0) ?? motion.CHEERS[0])[0];
    }
    m.lag = (this.r() * 2 - 1) * LAG;
    m.soloAt = 0;
    m.soloSide = 1;
    this.perform(m, clip, time, seconds ?? AUDIENCE.hold[0] + this.r() * (AUDIENCE.hold[1] - AUDIENCE.hold[0]));
  }

  /**
   * Asks for a solo by name (any, without one) from Mii `who` (whoever is picked, without one) at
   * the top of the next time round, for checking them one by one.
   */
  cue(name?: motion.SoloName, who = -1) {
    const all = Object.values(motion.SOLOS);
    this.solo.want = { clip: name ? motion.SOLOS[name] : all[Math.floor(this.r() * all.length)], who };
  }

  /**
   * While music is heard, now and then asks someone from the crowd near the stage over to dance
   * with it, if a place is free. Places given up (the fan was picked up, knocked over or set
   * dancing by the Konami code) are free again.
   */
  private recruit(time: number, calm: boolean) {
    if (this.dj < 0 || calm || !this.grooving) {
      this.fanAt = -1;
      return;
    }
    const wait = () => FANS.every[0] + this.r() * (FANS.every[1] - FANS.every[0]);
    // The first comes over a little after the music starts, not on its first beat.
    if (this.fanAt < 0) this.fanAt = time + wait() * 0.5;
    if (time < this.fanAt) return;
    this.fanAt = time + wait();
    this.fans.forEach((o, i) => {
      if (o && (o.act !== 'fan' || o.fan !== i)) {
        if (o.fan === i) o.fan = -1;
        this.fans[i] = null;
      }
    });
    const place = this.fans.indexOf(null);
    if (place < 0) return;
    const free = this.miis.filter((m) => !m.friend && !m.stage && m.act === 'stand' && m.spot);
    if (!free.length) return;
    const far = (m: Mii) => (m.x - this.djAt.x) ** 2 + ((m.z - this.djAt.z) / DEEP) ** 2;
    const near = free.sort((a, b) => far(a) - far(b)).slice(0, FANS.near);
    const m = near[Math.floor(this.r() * near.length)];
    if (m.spot) m.spot.owner = null;
    m.spot = null;
    m.fan = place;
    this.fans[place] = m;
    m.tx = this.djAt.x + FANS.places[place].x;
    m.tz = this.djAt.z + FANS.places[place].z;
    m.detour = 0;
    m.lag = (this.r() * 2 - 1) * LAG;
    m.act = 'fan';
    m.at = time;
    m.until = Infinity;
    this.play(m, motion.run, time);
  }

  /**
   * A fan runs over to its place, then dances whatever the stage dances on its beat, square on to you,
   * until its time is up or a moment after the music stops, and walks back to its own block.
   */
  private fan(m: Mii, dt: number, time: number, toCamera: number) {
    if (m.until === Infinity) {
      if (!this.grooving || time - m.at > STUCK) return this.unfan(m, time);
      if (this.step(m, RUN * m.pace, 1.75, dt)) {
        m.until = time + FANS.stay[0] + this.r() * (FANS.stay[1] - FANS.stay[0]);
        this.play(m, this.routine.clip, time);
      }
      return;
    }
    this.turn(m, toCamera, dt);
    this.keepSpot(m, dt);
    // The stage changed dances: so do they, unless dancing a solo of their own.
    if (this.grooving && motion.stageDance(m.clip)) this.play(m, this.routine.clip, time);
    // The music stopped: they stop with the stage, and each wanders off in their own moment.
    if (!this.grooving && motion.dancing(m.clip)) {
      this.play(m, motion.stand, time);
      m.until = Math.min(m.until, time + 0.4 + this.r() * 1.4);
    }
    if (time >= m.until) this.unfan(m, time);
  }

  private unfan(m: Mii, time: number) {
    if (this.fans[m.fan] === m) this.fans[m.fan] = null;
    m.fan = -1;
    this.claim(m, this.nearest(m.home, m.x, m.z));
    m.act = 'stroll';
    m.at = time;
    m.until = Infinity;
    this.play(m, motion.walk, time);
  }

  /** Held, flying, down, stunned or running off: the same for the crowd and the middle group. */
  private handled(m: Mii, dt: number, time: number, toCamera: number) {
    const collar = m.set.collar(m.slot) * SIZE;
    switch (m.act) {
      case 'held': {
        if (dt <= 0) return;
        // The hand follows the pointer closely, not rigidly, and its speed is kept for a throw.
        _a.copy(m.hand);
        m.hand.lerp(m.grip, 1 - Math.exp(-30 * dt));
        m.handVel.lerp(_b.subVectors(m.hand, _a).divideScalar(dt), 1 - Math.exp(-16 * dt));
        // The body hangs from the hand like a weight on a string: the hand speeding up leaves it
        // trailing, gravity swings it back under, and it settles. Worked in small steps, with the
        // hand moving through them, so a fast flick swings it as hard as it should.
        const n = Math.max(1, Math.ceil(dt * 240));
        const h = dt / n;
        const keep = Math.exp(-GRAB.settle * h);
        const low = GRAB.swing * Math.cos(GRAB.reach);
        const wide = GRAB.swing * Math.sin(GRAB.reach);
        for (let s = 1; s <= n; s++) {
          _b.lerpVectors(_a, m.hand, s / n);
          _b.z /= SQUEEZE;
          _c.subVectors(m.bob, m.bobPrev).multiplyScalar(keep);
          m.bobPrev.copy(m.bob);
          m.bob.add(_c);
          m.bob.y -= motion.GRAVITY * h * h;
          // A bump against someone knocks the swing, and it rocks back from them.
          if (s === 1) m.bob.add(_c.set(m.kick.x, m.kick.y, m.kick.z / SQUEEZE).multiplyScalar(h));
          // The string keeps it at arm's length from the hand, and the shirt won't let it swing up over it.
          _c.subVectors(m.bob, _b).setLength(GRAB.swing);
          if (-_c.y < low) {
            const out = Math.hypot(_c.x, _c.z) || 1;
            _c.set((_c.x / out) * wide, -low, (_c.z / out) * wide);
          }
          m.bob.addVectors(_b, _c);
        }
        // It squirms round to face you, twisting as it hangs.
        m.yaw += angleDelta(m.yaw, toCamera + Math.sin(time * 1.4 + m.k * 9) * 0.55) * (1 - Math.exp(-3 * dt));
        // Up the body, from its middle to the hand; in the Mii's own frame that is its tip.
        _b.set(m.hand.x, m.hand.y, m.hand.z / SQUEEZE).sub(m.bob).normalize();
        const c = Math.cos(m.yaw);
        const s = Math.sin(m.yaw);
        const ux = _b.x * c - _b.z * s;
        const uz = _b.x * s + _b.z * c;
        m.tipZ = Math.asin(clamp(-ux, -1, 1));
        m.tipX = Math.atan2(uz, _b.y);
        // Feet hang below the collar, along the body.
        m.x = m.hand.x - _b.x * collar;
        m.z = m.hand.z - _b.z * collar;
        m.lift = m.hand.y - _b.y * collar;
        m.kick.set(0, 0, 0);
        // It is a body like any other while it hangs, solid to anyone it swings into. How fast it
        // really goes and turns, as seen, is kept for when it is let go.
        const b = m.body;
        _a.copy(b.com);
        m.last.copy(b.com);
        _q.copy(b.rot);
        toss.stand(b, m.x, m.lift, m.z, m.yaw, m.tipX, m.tipZ, m.set.headTop(m.slot) * SIZE);
        const smooth = 1 - Math.exp(-20 * dt);
        m.vel3.lerp(_a.subVectors(b.com, _a).divideScalar(dt), smooth);
        m.turn.lerp(toss.turnRate(_q, b.rot, dt, _a), smooth);
        b.vel.copy(m.vel3);
        b.omega.copy(m.turn);
        return;
      }
      case 'flung':
        // Moved with everyone else in `physics`.
        return;
      case 'down': {
        const b = m.body;
        // Lying there, it is moved with everyone else in `physics`.
        if (time < m.until) return;
        // It springs back up stiff as a board, pivoting on its feet, with a little hop at the end.
        if (m.clip === motion.sprawl) {
          m.lay.copy(b.rot);
          toss.upOf(b, _up);
          m.rise.setFromUnitVectors(_up, _c.set(0, 1, 0)).multiply(b.rot);
          // Feet stay where they lay.
          toss.pose(b, _a);
          m.hand.set(_a.x, Math.max(0, _a.y), _a.z);
          this.play(m, motion.stand, time, false, DOWN.rise);
        }
        const u = clamp01((time - m.until) / DOWN.rise);
        const k = 1 - Math.pow(1 - u, 3) * Math.cos(u * 4);
        b.rot.slerpQuaternions(m.lay, m.rise, Math.min(1.08, k));
        b.com.set(0, b.low, 0).applyQuaternion(b.rot).add(m.hand);
        b.vel.set(0, 0, 0);
        b.omega.set(0, 0, 0);
        this.place(m);
        m.lift = m.hand.y * (1 - u) + Math.sin(u * Math.PI) * 0.06;
        if (u < 1) return;
        m.tipX = m.tipZ = 0;
        m.vel3.set(0, 0, 0);
        m.spin = 0;
        m.act = 'stunned';
        m.at = time;
        this.play(m, motion.stunned, time, true, 0.2);
        return;
      }
      case 'stunned': {
        // A skid on its shoes, slowed by friction till it stops, then still.
        const v = m.vel3;
        const speed = Math.hypot(v.x, v.z);
        if (speed > 0) v.multiplyScalar(Math.max(0, speed - SKID * motion.GRAVITY * dt) / speed);
        m.x += v.x * dt;
        m.z += v.z * dt;
        m.tipX *= Math.exp(-12 * dt);
        m.tipZ *= Math.exp(-12 * dt);
        m.yaw += m.spin * dt;
        m.spin *= Math.exp(-10 * dt);
        if (m.clip === motion.land && time - m.at > 0.3 + speed * 0.05) this.play(m, motion.stunned, time);
        if (m.clip === motion.stunned && time - m.since > motion.LENGTH.stunned) this.flee(m, time);
        return;
      }
      case 'flee':
        // Back to the group for the middle; off to some far spot for the crowd. The run they came in with.
        if (this.step(m, RUN * m.pace, 1.75, dt, !m.friend)) {
          if (m.friend) m.face = m.homeFace;
          this.rest(m, time, 1 + this.r() * 2);
        }
        return;
    }
  }

  /** Puts a Mii where its body is: feet, facing and tip. */
  private place(m: Mii) {
    const p = toss.pose(m.body, _a);
    m.x = _a.x;
    m.z = _a.z;
    m.lift = _a.y;
    m.yaw = p.yaw;
    m.tipX = p.pitch;
    m.tipZ = p.roll;
  }

  /** Keeps a body tumbling about inside the plaza you can see, rebounding off its edges. */
  private fence(b: toss.Body) {
    const { far, hero } = this.layout;
    const room = far.halfWidth * 0.95;
    if (Math.abs(b.com.x) > room) {
      b.com.x = Math.sign(b.com.x) * room;
      if (b.vel.x * b.com.x > 0) b.vel.x *= -0.3;
    }
    const back = far.z + 2;
    const front = hero.z + 32;
    if (b.com.z < back || b.com.z > front) {
      const out = b.com.z < back ? -1 : 1;
      b.com.z = clamp(b.com.z, back, front);
      if (b.vel.z * out > 0) b.vel.z *= -0.3;
    }
  }

  /** Whether Mii `m` is a loose body, tumbling or lying, moved by the physics alone. */
  private loose(m: Mii, time: number) {
    return m.act === 'flung' || (m.act === 'down' && time < m.until);
  }

  /** Whether Mii `m` can be bumped into while it stands, walks or gets up. */
  private solid(m: Mii, time: number) {
    return !m.stage && !this.loose(m, time) && m.act !== 'away' && m.act !== 'hover' && m.act !== 'fall' && m.act !== 'held';
  }

  /**
   * Moves every loose body on by `dt`, and the one in your hand along its swing, in short steps,
   * meeting whoever they touch on the way. A soft touch shoves someone standing aside; anything
   * firmer knocks them loose too, staggering or over depending on where it struck. The one held
   * rocks back from whatever it hits.
   */
  private physics(dt: number, time: number) {
    if (dt <= 0) return;
    const moving: Mii[] = [];
    let fastest = 0;
    for (const m of this.miis) {
      if (m.act !== 'held' && !this.loose(m, time)) continue;
      moving.push(m);
      m.body.touched = 0;
      m.body.hit = 0;
      if (m.act === 'held') m.next.copy(m.body.com);
      fastest = Math.max(fastest, m.body.vel.length());
    }
    if (!moving.length) return;
    const n = Math.min(TICK.most, Math.max(Math.ceil(dt / TICK.step), Math.ceil((fastest * dt) / TICK.travel)));
    const h = dt / n;
    for (let s = 1; s <= n; s++) {
      for (const m of moving) {
        if (m.act === 'held') {
          m.body.com.lerpVectors(m.last, m.next, s / n);
          continue;
        }
        toss.step(m.body, h, motion.GRAVITY);
        this.fence(m.body);
      }
      // Each pair of moving bodies once, then each against anyone in the way.
      const count = moving.length;
      for (let i = 0; i < count; i++) {
        const a = moving[i];
        for (let j = i + 1; j < moving.length; j++) this.bump(a, moving[j]);
        for (const o of this.miis) {
          if (Math.abs(o.x - a.body.com.x) > 1.6 || Math.abs(o.z - a.body.com.z) > 1.6) continue;
          // The stage stands firm: whatever is thrown at the DJ or a dancer bounces off.
          if (o.stage) {
            toss.stand(o.body, o.x, o.lift, o.z, o.yaw, o.tipX, o.tipZ, o.set.headTop(o.slot) * SIZE);
            this.bump(a, o, true);
            continue;
          }
          if (!this.solid(o, time)) continue;
          // Someone on their feet is stood up as a body to be hit.
          toss.stand(o.body, o.x, o.lift, o.z, o.yaw, o.tipX, o.tipZ, o.set.headTop(o.slot) * SIZE);
          _c.copy(o.body.com);
          const hit = this.bump(a, o);
          if (hit < 0) continue;
          if (hit < SHOVE) {
            // Barely touched, they are only moved out of the way.
            o.x += o.body.com.x - _c.x;
            o.z += o.body.com.z - _c.z;
            continue;
          }
          o.set.liven(o.slot);
          if (o.spot) o.spot.owner = null;
          o.spot = null;
          o.vel = 0;
          o.act = 'flung';
          o.at = time;
          this.play(o, motion.fall, time, true, 0.15);
          o.body.touched = 0;
          o.body.hit = 0;
          moving.push(o);
        }
      }
    }
    for (const m of moving) {
      if (m.act !== 'held' && m.body.hit > 0) this.heard(m, null, time, m.body.hit);
      if (m.act === 'held') m.body.com.copy(m.next);
      else {
        this.place(m);
        if (m.act === 'flung') this.landed(m, time);
      }
    }
  }

  /** Two bodies meeting (see toss.collide), b standing firm if `fixed`; one held passes what it felt on to its swing. */
  private bump(a: Mii, b: Mii, fixed = false) {
    _a.copy(a.body.vel);
    _b.copy(b.body.vel);
    const hit = toss.collide(a.body, b.body, fixed);
    if (hit < 0) return hit;
    if (a.act === 'held') a.kick.add(a.body.vel).sub(_a);
    if (b.act === 'held' && !fixed) b.kick.add(b.body.vel).sub(_b);
    return hit;
  }

  /** A loose body that has come down: does it catch itself, go limp, or lie still at last? */
  private landed(m: Mii, time: number) {
    const b = m.body;
    if (!b.touched) return;
    // Down on its feet, near enough upright and not going too fast: it catches itself.
    toss.upOf(b, _up);
    if (b.touched === 1 && _up.y > CATCH.upright && Math.hypot(b.vel.x, b.vel.z) < CATCH.speed && b.omega.length() < CATCH.spin) {
      m.lift = 0;
      m.vel3.set(b.vel.x, 0, b.vel.z);
      m.spin = b.omega.y;
      m.act = 'stunned';
      m.at = time;
      this.play(m, motion.land, time, true, b.hit > 4 ? 0.12 : 0.25);
      return;
    }
    // Anything else and it goes limp, rolling and sliding till it lies still.
    if (b.touched & 6 && m.clip !== motion.sprawl) this.play(m, motion.sprawl, time, true, 0.18);
    if (b.still > 0.25) {
      this.play(m, motion.sprawl, time, false, 0.18);
      m.act = 'down';
      m.at = time;
      m.until = time + DOWN.lie * (0.7 + m.k * 0.6);
    }
  }

  /** Runs off in a fright: the middle group back to its places, the crowd somewhere well away. */
  private flee(m: Mii, time: number) {
    m.act = 'flee';
    m.at = time;
    m.tipX = m.tipZ = m.spin = 0;
    // It bolts, already at a run, as the crowd does when it first comes in.
    m.vel = m.gaitSpeed = RUN * m.pace;
    m.detour = 0;
    if (m.friend) {
      m.tx = m.homeX;
      m.tz = m.homeZ;
    } else {
      const away = this.spots.filter((s) => !s.owner && (s.x - m.x) ** 2 + ((s.z - m.z) / DEEP) ** 2 > 49 && this.outside(s.x, s.z) > 0.6);
      this.claim(m, away.length ? away[Math.floor(this.r() * away.length)] : this.nearest(m.home, null, null));
    }
    // Already facing the way it runs, so it sets off at full stride rather than turning on the spot.
    m.yaw = Math.atan2(m.tx - m.x, m.tz - m.z);
    // It bolts at full speed, so the legs must be running at once: a slow blend from standing
    // would leave it gliding along on still feet. A push off the back foot starts the stride.
    m.stride = Math.PI * 0.5;
    this.play(m, motion.flee, time, false, 0.1);
  }

  /**
   * A Mii that has been on its way somewhere for far longer than any trip takes is caught on
   * something: it makes for the nearest free spot from where it is instead.
   */
  private unstick(m: Mii, time: number) {
    if (time - m.at < STUCK) return;
    m.at = time;
    this.claim(m, this.nearest(m.home, m.x, m.z));
  }

  /** What a Mii in the crowd does next. */
  private decide(m: Mii, time: number, toCamera: number) {
    const roll = this.r();
    m.at = time;
    if (this.watching(m)) {
      if (this.r() < AUDIENCE.leave && this.layout.anchors.length > 1) {
        const others = this.layout.anchors.length - 1;
        const to = (this.djCube + 1 + Math.floor(this.r() * others)) % this.layout.anchors.length;
        m.act = 'stroll';
        this.claim(m, this.nearest(to, null, null));
        this.play(m, motion.walk, time);
        return;
      }
      m.face = Math.atan2(this.djAt.x - m.x, this.djAt.z - m.z);
      if (roll < AUDIENCE.share) this.cheer(m, time);
      else this.rest(m, time, 0.8 + this.r() * 2);
      return;
    }
    const a = this.layout.anchors[m.home % this.layout.anchors.length];
    // A few at a time cross the plaza to another cube; the rest keep to their own.
    const dashing = this.miis.reduce((n, o) => n + (o.act === 'dash' ? 1 : 0), 0);
    if (roll < 0.075 && this.layout.anchors.length > 1 && dashing < Math.max(3, this.miis.length * 0.06)) {
      const to = (m.home + 1 + Math.floor(this.r() * (this.layout.anchors.length - 1))) % this.layout.anchors.length;
      m.act = 'dash';
      this.claim(m, this.nearest(to, null, null));
      this.play(m, motion.run, time);
    } else if (roll < 0.33) {
      m.act = 'stroll';
      this.wander(m);
      this.play(m, motion.walk, time);
    } else if (roll < 0.44) {
      m.face = Math.atan2(a.x - m.x, a.z - m.z);
      this.perform(m, motion.gaze, time, motion.LENGTH.gaze);
    } else if (roll < 0.49) {
      this.perform(m, motion.hop, time, motion.LENGTH.hop);
    } else if (roll < 0.53) {
      m.face = toCamera;
      this.perform(m, motion.wave, time, motion.LENGTH.wave);
    } else if (roll < 0.74) {
      const other = this.neighbor(m);
      if (other) m.face = Math.atan2(other.x - m.x, other.z - m.z);
      this.perform(m, this.r() < 0.5 ? motion.talk : motion.listen, time, 2.5 + this.r() * 3.5);
    } else {
      m.face += (this.r() - 0.5) * 1.6;
      this.rest(m, time, 2 + this.r() * 5);
    }
  }

  /**
   * You and your friends. You fall, land and wave; they watch you come down and clap. After that
   * they keep easy company, and when the camera comes in close they turn to it, each doing their
   * own thing.
   */
  private middle(m: Mii, dt: number, time: number, toCamera: number, calm: boolean) {
    const clapping = time >= this.applause.from && time < this.applause.to;
    const lead = this.miis[0];
    const watching = lead.act === 'fall' || lead.act === 'hover';
    // Friends look up at you while you are in the air, and their heads come down gently after.
    if (!m.lead) {
      const target = watching ? 0.3 + 0.7 * clamp01(lead.lift / 4) : 0;
      m.look += (target - m.look) * (1 - Math.exp(-(target > m.look ? 6 : 3.5) * dt));
    }

    if (m.act === 'away') return;
    // Wandering to another place in the group (`drift`): there, it makes that its place and turns
    // back toward you. Caught on something, it stays where it got to.
    if (m.act === 'stroll') {
      if (!this.step(m, WALK * m.pace, 5.6, dt, false) && time - m.at < STUCK) return;
      m.homeX = m.x;
      m.homeZ = m.z;
      m.face = m.homeFace = this.towardYou(m, this.r());
      return this.rest(m, time, 0.6 + this.r() * 1.6);
    }
    // Through the opening you face the camera and friends face you; after that everyone faces
    // whoever they are busy with, and the camera when it comes in close.
    const opening = watching || !this.waved || time < this.applause.to || m.clip === motion.land || m.clip === motion.hello;
    const face = this.noticed || (m.lead && opening) ? toCamera : m.face;
    if (m.act === 'show' && m.clip === motion.spin) m.yaw += m.spinning * dt;
    else m.yaw += angleDelta(m.yaw, face) * (1 - Math.exp(-(this.noticed ? 4 : 5) * dt));
    if (m.act === 'hover') {
      m.lift = SKYFALL.height;
      return;
    }
    if (m.act === 'fall') {
      // Real gravity: still at first, faster and faster all the way to the floor.
      const t = time - m.at;
      m.lift = Math.max(0, SKYFALL.height - 0.5 * motion.GRAVITY * t * t);
      if (m.lift <= 0) this.perform(m, motion.land, time, motion.LENGTH.land);
      return;
    }
    if (m.lead && clapping && !this.waved && (m.clip !== motion.land || time >= m.until)) {
      this.waved = true;
      this.perform(m, motion.hello, time, motion.LENGTH.hello);
    }
    if (m.act === 'show' && (m.clip === motion.land || m.clip === motion.hello) && time < m.until) return;
    if (!m.lead && clapping) {
      if (m.clip !== motion.clap) {
        m.act = 'show';
        m.until = this.applause.to;
        this.play(m, motion.clap, time + m.k * 0.3);
      }
      return;
    }
    if (watching) return;
    if (m.act === 'show' && time < m.until) return;
    if (m.act !== 'stand') return this.rest(m, time, 0.8 + this.r() * 2.2);
    if (calm || time < m.until) return;
    if (this.noticed) return this.pose(m, time);
    this.mingle(m, time);
  }

  /** Friends in the middle who are free right now, nearest to `m` first. */
  private idle(m: Mii) {
    return this.miis
      .filter((o) => o.friend && o !== m && o.act === 'stand' && o.until !== Infinity)
      .sort((a, b) => (a.x - m.x) ** 2 + (a.z - m.z) ** 2 - ((b.x - m.x) ** 2 + (b.z - m.z) ** 2));
  }

  /** Two Miis turn to face each other. */
  private faceOff(a: Mii, b: Mii) {
    a.face = Math.atan2(b.x - a.x, b.z - a.z);
    b.face = Math.atan2(a.x - b.x, a.z - b.z);
  }

  /**
   * What the middle group gets up to: mostly chatting in pairs, with a steady supply of nonsense.
   * Everything is short, so the group always has something going on.
   */
  private mingle(m: Mii, time: number) {
    if (!m.lead && this.r() < WANDER && this.drift(m, time)) return;
    const roll = this.r();
    const partner = this.idle(m)[Math.floor(this.r() * 2)];
    const len = (a: number, b: number) => a + this.r() * (b - a);
    if (roll < 0.34 && partner) {
      // A chat: one talks, the other listens (and may crack up).
      this.faceOff(m, partner);
      const d = len(2.5, 4.5);
      this.perform(m, motion.talk, time, d);
      this.perform(partner, this.r() < 0.3 ? motion.laugh : motion.listen, time, d + 0.1);
    } else if (roll < 0.42 && partner) {
      this.faceOff(m, partner);
      const d = len(2, 3.5);
      this.perform(m, motion.argue, time, d);
      this.perform(partner, motion.argue, time, d);
    } else if (roll < 0.48 && partner) {
      this.faceOff(m, partner);
      const d = len(1.6, 2.6);
      this.perform(m, motion.point, time, d);
      this.perform(partner, motion.bashful, time, d);
    } else if (roll < 0.56) this.perform(m, motion.laugh, time, len(1.6, 2.6));
    else if (roll < 0.64) this.perform(m, motion.dance, time, len(2.5, 4.5));
    else if (roll < 0.7) this.perform(m, motion.windmill, time, len(1.4, 2.4));
    else if (roll < 0.76) this.perform(m, motion.jacks, time, len(1.8, 3));
    else if (roll < 0.82) {
      m.spinning = (this.r() < 0.5 ? -1 : 1) * (8 + this.r() * 4);
      this.perform(m, motion.spin, time, len(1.1, 1.8));
    } else if (roll < 0.86) this.perform(m, motion.panic, time, len(1.4, 2.2));
    else if (roll < 0.9) this.perform(m, motion.hop, time, motion.LENGTH.hop);
    else {
      m.face = (this.r() - 0.5) * Math.PI * 2;
      this.rest(m, time, len(1, 3));
    }
  }

  /**
   * A friend wanders a few steps to another place in the group: one with room, not in the lane
   * behind you, reached without walking through anyone. False if there is nowhere like that.
   */
  private drift(m: Mii, time: number) {
    const { hero } = this.layout;
    const others = this.miis.filter((o) => o.friend && o !== m && o.act !== 'away');
    let best: { x: number; z: number } | null = null;
    let score = -Infinity;
    for (let t = 0; t < 24; t++) {
      const x = (this.r() * 2 - 1) * GROUP.x;
      const z = GROUP.back + this.r() * (GROUP.front - GROUP.back);
      if (!inGroup(x, z)) continue;
      const wx = hero.x + x;
      const wz = hero.z + z;
      const walk = Math.hypot(wx - m.x, (wz - m.z) / DEEP);
      if (walk < WANDER_SPAN.min || walk > WANDER_SPAN.max) continue;
      // Clear of where everyone is and where anyone wandering is headed, and of the way there.
      let near = Infinity;
      let blocked = false;
      for (const o of others) {
        near = Math.min(near, apart(wx, wz, o.x, o.z), apart(wx, wz, o.homeX, o.homeZ));
        if (passes(m.x, m.z, wx, wz, o.x, o.z) < 0.6) blocked = true;
      }
      if (blocked || near < APART) continue;
      const s = roomScore(near, x, z);
      if (s > score) {
        score = s;
        best = { x: wx, z: wz };
      }
    }
    if (!best) return false;
    m.tx = m.homeX = best.x;
    m.tz = m.homeZ = best.z;
    m.act = 'stroll';
    m.at = time;
    m.until = Infinity;
    this.play(m, motion.walk, time);
    return true;
  }

  /** Mostly turned your way and toward the front, at an angle of its own (`k`, 0 to 1). */
  private towardYou(m: Mii, k: number) {
    const you = this.miis[0];
    const dx = you.x - m.x;
    const dz = you.z - m.z;
    return (dx || dz ? Math.atan2(dx, dz) : 0) * 0.55 + (k - 0.5);
  }

  /** With the camera in close, each Mii in the middle picks something to do for it. */
  private pose(m: Mii, time: number) {
    const roll = this.r();
    if (roll < 0.34) this.rest(m, time, 1.5 + this.r() * 3);
    else if (roll < 0.52) this.perform(m, motion.wave, time, motion.LENGTH.wave);
    else if (roll < 0.62) this.perform(m, motion.hop, time, motion.LENGTH.hop);
    else if (roll < 0.72) this.perform(m, motion.bashful, time, 1.6 + this.r());
    else if (roll < 0.8) this.perform(m, motion.thanks, time, motion.LENGTH.thanks);
    else if (roll < 0.85) this.perform(m, motion.dance, time, 2 + this.r() * 2);
    else if (roll < 0.9) this.perform(m, motion.laugh, time, 1.6 + this.r());
    else if (roll < 0.95) this.perform(m, motion.jacks, time, 1.8 + this.r());
    else this.perform(m, motion.skyward, time, 1.8 + this.r());
  }

  private neighbor(m: Mii) {
    let best: Mii | null = null;
    let near = 2.4 * 2.4;
    for (const o of this.miis) {
      if (o === m || o.friend || o.act === 'away') continue;
      const d = (o.x - m.x) ** 2 + ((o.z - m.z) / DEEP) ** 2;
      if (d < near) {
        near = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * One frame of travel toward the target. If the straight way runs through the middle group's
   * circle or across the stage, the Mii heads for a point at its edge on the near side instead, so
   * it walks round rather than pushing against it. Without `avoid` it still goes round the stage,
   * which everyone does but the dancers. True on arrival.
   */
  private step(m: Mii, speed: number, cadence: number, dt: number, avoid = true) {
    const d = Math.hypot(m.tx - m.x, m.tz - m.z);
    if (d < 0.06 || (d < 0.25 && m.vel < 0.15)) {
      m.detour = 0;
      return true;
    }
    _goal.x = m.tx;
    _goal.z = m.tz;
    // Round the middle group, then round the stage on the way to wherever that leaves it heading.
    if (avoid) {
      const { hero } = this.layout;
      this.around(m, hero.x + KEEP_OUT.x, hero.z + KEEP_OUT.z, DEEP * 0.75, KEEP_OUT.r + 0.9);
    }
    if (this.dj >= 0 && !m.stage) this.around(m, this.djAt.x, this.djAt.z + STAGE.z, DEEP, STAGE.pass);
    const gx = _goal.x;
    const gz = _goal.z;
    const want = Math.atan2(gx - m.x, gz - m.z);
    const turn = angleDelta(m.yaw, want);
    m.yaw += clamp(turn, -9 * dt, 9 * dt);
    // Speed builds up over a few steps and brakes into the stop, the way a body moves.
    const want_ = speed * Math.max(0.25, Math.cos(turn)) * Math.min(1, Math.sqrt(d / (speed * 0.55)));
    m.vel += (want_ - m.vel) * (1 - Math.exp(-(want_ > m.vel ? 3.2 : 7) * dt));
    m.gaitSpeed = speed;
    const move = Math.min(d, m.vel * dt);
    m.x += Math.sin(m.yaw) * move;
    m.z += Math.cos(m.yaw) * move;
    m.stride += move * cadence;
    return false;
  }

  /**
   * If the straight way from Mii `m` to `_goal` runs within `clearance` of (cx, cz), where an oval
   * is round once depth is divided by `sq`, moves `_goal` to a point a quarter of the way round its
   * edge on the near side, and is true.
   */
  private around(m: Mii, cx: number, cz: number, sq: number, clearance: number) {
    const px = m.x - cx;
    const pz = (m.z - cz) / sq;
    const ex = _goal.x - cx - px;
    const ez = (_goal.z - cz) / sq - pz;
    const len2 = ex * ex + ez * ez || 1;
    const u = clamp(-(px * ex + pz * ez) / len2, 0, 1);
    if (!(u > 0 && u < 1 && Math.hypot(px + ex * u, pz + ez * u) < clearance)) return false;
    // Round on whichever side the path already leans to, chosen once for the trip so a path
    // straight through the middle cannot flip between the two.
    if (!m.detour) {
      const cross = px * ez - pz * ex;
      m.detour = Math.abs(cross) > 0.3 ? Math.sign(cross) : this.r() < 0.5 ? 1 : -1;
    }
    const r = Math.hypot(px, pz) || 1;
    const ang = Math.atan2(pz, px) + m.detour * -0.7;
    const out = Math.max(clearance + 0.4, Math.min(r, clearance + 2));
    _goal.x = cx + Math.cos(ang) * out;
    _goal.z = cz + Math.sin(ang) * out * sq;
    return true;
  }

  /** A Mii standing about drifts back onto its spot if it has been nudged off it. */
  private keepSpot(m: Mii, dt: number) {
    const dx = m.tx - m.x;
    const dz = m.tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const k = Math.min(1, dt * 1.5);
    m.x += dx * k;
    m.z += dz * k;
  }

  private turn(m: Mii, to: number, dt: number) {
    m.yaw += angleDelta(m.yaw, to) * (1 - Math.exp(-6 * dt));
  }

  /** Keeps everyone an arm's length apart, and the crowd out of the middle. */
  private separate() {
    const cell = PERSONAL * 1.2;
    const grid = this.grid;
    grid.clear();
    // Depth is squeezed before measuring, so the gap between two Miis looks the same from any side.
    const key = (x: number, z: number) => (Math.floor(x / cell) + 2048) * 4096 + Math.floor(z / DEEP / cell) + 2048;
    this.miis.forEach((m, i) => {
      // Miis up in the air are no one's to step round; one lying on the floor is.
      if (m.act === 'away' || m.act === 'held' || m.act === 'flung') return;
      const k = key(m.x, m.z);
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    });
    const { hero } = this.layout;
    for (const m of this.miis) {
      if (m.act === 'away' || m.friend || m.stage || (HANDLED.has(m.act) && m.act !== 'flee')) continue;
      const cx = Math.floor(m.x / cell);
      const cz = Math.floor(m.z / DEEP / cell);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = grid.get((ix + 2048) * 4096 + iz + 2048);
          if (!list) continue;
          for (const j of list) {
            const o = this.miis[j];
            if (o === m) continue;
            const dx = m.x - o.x;
            const dz = (m.z - o.z) / DEEP;
            const d2 = dx * dx + dz * dz;
            if (d2 > PERSONAL * PERSONAL || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            // Whoever is standing gives way less than whoever is moving.
            const running = m.act === 'dash' || m.act === 'stroll' || (m.act === 'fan' && m.until === Infinity);
            const give = (PERSONAL - d) * (o.friend || o.stage ? 1 : running ? 0.5 : 0.12);
            m.x += (dx / d) * give;
            m.z += (dz / d) * give * DEEP;
          }
        }
      }
      // One set down in the middle makes its own way out, so it is not shoved.
      const inside = m.act === 'flee' ? 0 : -this.outside(m.x, m.z);
      if (inside > 0) {
        const ox = m.x - hero.x - KEEP_OUT.x;
        const oz = m.z - hero.z - KEEP_OUT.z;
        const od = Math.hypot(ox, oz) || 1;
        m.x += (ox / od) * inside;
        m.z += (oz / od) * inside;
      }
      // Nobody stands on the stage, where the dancers would hide them: whoever is on it eases off.
      if (this.dj >= 0) {
        const ox = m.x - this.djAt.x;
        const oz = (m.z - this.djAt.z - STAGE.z) / DEEP;
        const od = Math.hypot(ox, oz);
        if (od < STAGE.keep && od > 1e-6) {
          const push = (STAGE.keep - od) * 0.2;
          m.x += (ox / od) * push;
          m.z += (oz / od) * push * DEEP;
        }
      }
    }
  }

  /**
   * The DJ and their dancers as a wall: anyone on their feet who has come within WALL of one is put
   * back toward its edge, half the way each frame, so a walker never gets more than a step in and
   * slides along it rather than through, and one that landed close gets up and eases clear rather
   * than jumping. Bodies in the air or lying loose meet the stage in `physics` instead.
   */
  private wall() {
    if (this.dj < 0) return;
    for (const o of this.miis) {
      if (!o.stage) continue;
      for (const m of this.miis) {
        if (m.stage || m.act === 'away' || m.act === 'hover' || m.act === 'fall' || m.act === 'held' || m.act === 'flung' || m.act === 'down') continue;
        const dx = m.x - o.x;
        const dz = m.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= WALL * WALL) continue;
        const d = Math.sqrt(d2);
        // Dead on top of them: out toward the camera, the near side of the stage.
        const nx = d > 1e-6 ? dx / d : 0;
        const nz = d > 1e-6 ? dz / d : 1;
        m.x += (o.x + nx * WALL - m.x) * 0.5;
        m.z += (o.z + nz * WALL - m.z) * 0.5;
      }
    }
  }

  // Drawing --------------------------------------------------------------------------------------

  /**
   * The expression actually shown. A face can't fade between two expressions, so a change goes
   * through a quick blink, the way it does on the console, rather than snapping across.
   */
  private face(m: Mii, want: Pose['expr'], time: number): Pose['expr'] {
    if (want === 1) return 1;
    if (want === m.exprShown) {
      m.exprAt = -1;
      return want;
    }
    if (m.exprAt < 0) m.exprAt = time;
    if (time - m.exprAt < 0.11) return 1;
    m.exprShown = want;
    m.exprAt = -1;
    return want;
  }

  /** Beats into its solo or cheer `m` is, a touch ahead or behind (`lag`). */
  private beatsIn(m: Mii) {
    return this.beat.beats + m.lag / this.beat.beatLength - m.soloAt;
  }

  /** Beats into the polka `m` is, a touch ahead or behind (`lag`). */
  private polkaIn(m: Mii) {
    return (this.bars.loops - this.routine.from) * 4 + (m.lag / this.bars.period) * 4;
  }

  /** Writes one animation's pose for this moment into `out`. */
  private evaluate(m: Mii, clip: motion.Clip, since: number, time: number, calm: boolean, out: Pose) {
    if (clip === HOLD) return motion.copyJoints(m.held, out);
    motion.neutral(out);
    const gait = clip === motion.run || clip === motion.walk || clip === motion.flee;
    // Your Mii arches back to look up; friends take whichever way their own number gives them.
    const k = m.lead && clip === motion.skyward ? 0.5 : m.k;
    if (calm && gait) return;
    // Dancing keeps the music's beat, so everyone on stage dances together however they came to
    // start, each a touch ahead or behind (`lag`).
    const solo = motion.onBeat(clip);
    const t =
      clip === motion.idol
        ? (this.beat.loops + m.lag / this.beat.period) * motion.LOOP
        : clip === motion.polka
          ? this.polkaIn(m)
          : clip === motion.tetoris
            ? (this.spins.loops + m.lag / this.spins.period) * 2
            : solo
            ? this.beatsIn(m)
            : gait
              ? m.stride
              : Math.max(0, time - since);
    clip(out, t, k);
    if (solo && m.soloSide < 0) motion.mirror(out);
    if (gait) {
      // Strides grow with speed: barely a shuffle when starting off, full swing at pace.
      motion.neutral(still);
      motion.stand(still, time, m.k);
      motion.blend(out, still, 1 - smoothstep01(m.vel / m.gaitSpeed));
    }
  }

  private draw(m: Mii, time: number, calm: boolean) {
    if (m.act === 'away') return m.set.hide(m.slot);

    this.evaluate(m, m.clip, m.since, time, calm, pose);
    // A clip can be queued to start a moment from now (so a group doesn't move in unison); until
    // then the blend holds at the old pose. Never let it run outside 0..1, where the smoothing
    // curve would push past either pose and fling the arms about.
    const w = clamp01((time - m.faded) / m.fadeLen);
    if (m.faded >= 0 && w < 1) {
      // The old animation still plays underneath and gives way along a soft S curve.
      this.evaluate(m, m.prev, m.prevSince, time, calm, other);
      motion.blend(pose, other, 1 - w * w * w * (w * (w * 6 - 15) + 10));
    }
    motion.copyJoints(pose, m.shown);
    if (m.dj) {
      if (this.djHold > 0.001) motion.carry(pose, this.djHold);
      this.djBeats = motion.dancing(m.clip) ? this.beat.beats : null;
    }


    // Friends follow you with their eyes as you come down, and look surprised to see you.
    if (m.look > 0.001) {
      pose.nod -= m.look * 0.5;
      pose.leanX -= m.look * 0.06;
      if (m.look > 0.45 && this.miis[0].act === 'fall') pose.expr = 3;
    }
    if (pose.expr === 0 && time > m.blink) pose.expr = 1;
    pose.expr = this.face(m, pose.expr, time);
    pose.x = m.x;
    pose.z = m.z;
    if (m.clip === motion.moonwalk) {
      // The moonwalk is the one solo that goes anywhere: off to the dancer's side and back.
      const d = motion.moonSlide(this.beatsIn(m)) * m.soloSide;
      pose.x += Math.cos(m.yaw) * d;
      pose.z -= Math.sin(m.yaw) * d;
    }
    pose.y += m.lift;
    pose.yaw += m.yaw;
    pose.pitch += m.tipX;
    pose.roll += m.tipZ;
    pose.scale = SIZE;
    // The leek comes out for the polka's twirl, and goes the moment anything else is danced. A phone
    // isn't twirled: its dancer looks at it instead.
    const prop = m.stage && this.leeks && m.clip === motion.polka ? motion.leek(this.polkaIn(m), this.leekNow) : null;
    const phone = m.who?.prop === 'phone';
    if (prop && phone) motion.texting(pose, prop.show);
    m.set.setPose(m.slot, pose);
    if (m.stage && this.leeks) {
      const now = prop && !m.set.isHidden(m.slot) ? prop : null;
      const head = phone && now ? m.set.headMatrix(m.slot) : null;
      this.leeks.place(m.stage.leek, now ? now.show : 0, now ? now.spin : 0, SIZE, head ? this.faceAt.setFromMatrixPosition(head) : undefined);
    }
    if (m.stage && this.mics) {
      // The mic comes out for the Tetoris spin, quickly, and goes back as quickly after.
      const mic = this.micOut[m.stage.leek];
      const want = (m.clip === motion.tetoris || m.clip === motion.tetoPose) && !m.set.isHidden(m.slot) ? 1 : 0;
      mic.show += (want - mic.show) * clamp01((time - mic.at) * 6);
      mic.at = time;
      this.mics.place(m.stage.leek, mic.show < 0.01 && !want ? 0 : mic.show, SIZE);
    }
  }
}
