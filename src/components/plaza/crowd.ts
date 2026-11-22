// Everyone in the plaza. Your Mii and friends hold the middle: they fall in from the sky together,
// land and stare up at it. Then the crowd runs in from the far end with their hands up, gathers
// under the cubes and mills about: strolling, chatting, looking up, dashing off to another cube.
import * as THREE from 'three';
import { decodeMii } from '../mii/data';
import type { MiiKit } from '../mii/kit';
import { MiiSet, randomMii, restPose, type Pose } from '../mii/rig';
import { MIRRORED } from './floor';
import type { Layout } from './layout';
import * as motion from './motion';
import type { PlazaMii } from './types';
import { angleDelta, clamp, clamp01, type Rng } from './util';

/**
 * Where friend `i` stands, as [across, toward the camera] from you: a loose grid of three
 * staggered rows with you in the front one, so it reads as a group of friends hanging out, not a
 * ring closing in. Nobody stands straight behind you. Depth is stretched for the long lens.
 */
const GRID: [number, number][] = [
  [-1.55, 0.35], [1.45, -0.25],
  [-0.8, -2.55], [0.95, -2.2], [-2.3, -2.25], [2.35, -2.75],
  [0.2, -5.0], [-1.45, -4.85], [1.85, -4.65],
];
function spot(i: number): [number, number] {
  // Each friend is nudged by its own fixed amount, so the rows never line up, and stay the same on every visit.
  const jitter = (s: number) => {
    const v = Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  };
  const [x, z] = GRID[i % GRID.length];
  return [x + jitter(1) * 0.28, z + jitter(2) * 0.6];
}
const FRIENDS = 7;
/** Nobody else walks into the oval around the middle group. */
const KEEP_OUT = { x: -0.15, z: -2.3, r: 4.6 };
/** How much deeper than wide everything is spaced, to look even through the lens. */
const DEEP = 2.6;
const PERSONAL = 0.7;
/** Your own fall: from high in the sky, where the page opens on you floating, under real gravity. */
export const SKYFALL = { height: 6.5, time: Math.sqrt((2 * 6.5) / motion.GRAVITY) };
/** Seconds every change of animation blends over. */
const FADE = 0.45;
const RUN = 9.5;
const WALK = 1.25;
/** Your Mii's pants, your friends' and everyone else's. */
const PANTS = { you: 0x1c1d20, friends: 0x702015, theirs: 0x8c9096 };
/** Miis stand a little larger here than in Mii Maker, as they do on the console's plaza. */
const SIZE = 1.12;
/** Picked up, a Mii's feet hang this far off the floor; its body swings below the hand on this length. */
const GRAB = { clear: 0.45, swing: 0.42 };
/** The fastest a Mii can be thrown, across the floor. */
const THROW = 11;

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

type Act = 'away' | 'stand' | 'stroll' | 'dash' | 'speak' | 'fall' | 'show' | 'hover' | 'held' | 'flung' | 'stunned' | 'flee';
/** Acts where you have hold of a Mii, or it is getting over it. Nothing else may interrupt them. */
const HANDLED: ReadonlySet<Act> = new Set(['held', 'flung', 'stunned', 'flee']);

interface Mii {
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
  /** Where the pointer wants the hand holding it, the hand itself, and the hand's speed. */
  grip: THREE.Vector3;
  hand: THREE.Vector3;
  handVel: THREE.Vector3;
  /** How far the body has swung out from hanging straight down, toward +x and +z (radians), and how fast. */
  sway: THREE.Vector2;
  swayVel: THREE.Vector2;
  /** Speed through the air once thrown, and how fast it is spinning. */
  vel3: THREE.Vector3;
  spin: number;
  bounced: boolean;
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
      /** Face texture size for the crowd. */
      resolution: number;
      random: Rng;
    },
  ) {
    const r = (this.r = opts.random);
    type Cast = { data: Uint8Array; who: PlazaMii | null };
    const decode = (miis: PlazaMii[]) =>
      miis.flatMap((who): Cast[] => {
        const data = decodeMii(who.code);
        return data ? [{ data, who }] : [];
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
    const others = Array.from({ length: opts.count }, next);

    const headScale = 0.125;
    const middleSet = new MiiSet(opts.kit, opts.renderer, middle.map((c) => c.data), { resolution: 512, happy: true, pants: (i) => (i === 0 ? PANTS.you : PANTS.friends), headScale, layer: MIRRORED });
    const crowdSet = new MiiSet(opts.kit, opts.renderer, others.map((c) => c.data), { resolution: opts.resolution, pants: PANTS.theirs, headScale, layer: MIRRORED });
    middleSet.build();
    this.sets = [middleSet, crowdSet];
    scene.add(middleSet.group, crowdSet.group);

    const add = (set: MiiSet, slot: number, friend: boolean, who: PlazaMii | null) =>
      this.miis.push({
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
        spot: null,
        detour: 0,
        who: who?.name ? who : null,
        homeX: 0,
        homeZ: 0,
        homeFace: 0,
        grip: new THREE.Vector3(),
        hand: new THREE.Vector3(),
        handVel: new THREE.Vector3(),
        sway: new THREE.Vector2(),
        swayVel: new THREE.Vector2(),
        vel3: new THREE.Vector3(),
        spin: 0,
        bounced: false,
        tipX: 0,
        tipZ: 0,
        pokes: 0,
        pokedAt: -Infinity,
      });
    middle.forEach((c, i) => add(middleSet, i, true, c.who));
    others.forEach((c, i) => add(crowdSet, i, false, c.who));
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
        const [dx, dz] = spot(i - 1);
        m.x = layout.hero.x + dx;
        m.z = layout.hero.z + dz;
        // Mostly turned your way and toward the front, each at its own angle.
        const toYou = Math.atan2(layout.hero.x - m.x, layout.hero.z - m.z);
        m.yaw = m.face = toYou * 0.55 + (Math.sin(i * 7.31) * 0.5);
      }
      if (m.friend) {
        m.homeX = m.x;
        m.homeZ = m.z;
        m.homeFace = m.face;
      }
    });
    this.lay();
    for (const m of this.miis) {
      if (m.friend) continue;
      const keep = moved && m.act !== 'away';
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
    const free = (x: number, z: number) => {
      if (this.outside(x, z) < 0.6) return false;
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

  /** Miis under `cube` who are free to speak, shuffled. */
  speakers(cube: number) {
    const out: number[] = [];
    this.miis.forEach((m, i) => {
      if (m.home === cube && (m.act === 'stand' || m.act === 'stroll')) out.push(i);
    });
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Whether Mii `i` can take a bubble right now. */
  free(i: number) {
    return this.miis[i].act === 'stand';
  }

  /** Mii `i` turns to the camera and talks for `seconds`. */
  say(i: number, time: number, seconds: number) {
    const m = this.miis[i];
    m.act = 'speak';
    m.at = time;
    m.until = time + seconds;
    this.play(m, motion.talk, time);
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
   * is a box from its feet to the top of its head, wide enough to catch small ones far away.
   */
  pick(camera: THREE.Camera, x: number, y: number, w: number, h: number, prefer = -1) {
    let best = -1;
    let kept = false;
    let near = Infinity;
    this.miis.forEach((m, i) => {
      if (m.act === 'away' || m.act === 'hover' || m.act === 'fall' || m.act === 'held' || m.set.isHidden(m.slot)) return;
      _a.set(m.x, m.lift, m.z).project(camera);
      if (_a.z > 1) return;
      const fx = (_a.x + 1) * 0.5 * w;
      const fy = (1 - _a.y) * 0.5 * h;
      const depth = _a.z;
      _a.set(m.x, m.lift + m.set.headTop(m.slot) * SIZE, m.z).project(camera);
      const ty = (1 - _a.y) * 0.5 * h;
      const half = Math.max(9, (fy - ty) * 0.3);
      if (Math.abs(x - fx) > half || y < ty - 4 || y > fy + 4) return;
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
    this.perform(m, clip, time, seconds);
  }

  /** Picks Mii `i` up by the back of its shirt, the hand following `ray` (see `carry`). */
  grab(i: number, time: number, ray: THREE.Ray) {
    const m = this.miis[i];
    if (m.act === 'away' || m.act === 'hover' || m.act === 'fall' || m.act === 'held') return false;
    m.set.liven(m.slot);
    if (m.spot) m.spot.owner = null;
    m.spot = null;
    const collar = m.set.collar(m.slot) * SIZE;
    // The hand closes on the collar where the Mii stands, then lifts it to the pointer.
    m.hand.set(m.x, m.lift + collar, m.z);
    m.grip.copy(m.hand);
    m.handVel.set(0, 0, 0);
    m.sway.set(0, 0);
    m.swayVel.set(0, 0);
    m.vel = 0;
    m.act = 'held';
    m.at = time;
    this.play(m, motion.dangle, time, true);
    this.carry(i, ray);
    return true;
  }

  /**
   * Moves the hand holding Mii `i` to where `ray` (from the camera through the pointer) meets
   * the height it is carried at, so the collar stays under the pointer as it goes.
   */
  carry(i: number, ray: THREE.Ray) {
    const m = this.miis[i];
    if (m.act !== 'held' || ray.direction.y > -1e-4) return;
    const height = m.set.collar(m.slot) * SIZE + GRAB.clear;
    ray.at((height - ray.origin.y) / ray.direction.y, _b);
    const { far } = this.layout;
    _b.x = clamp(_b.x, -far.halfWidth * 1.1, far.halfWidth * 1.1);
    _b.z = Math.max(_b.z, far.z - 4);
    m.grip.copy(_b);
  }

  /**
   * Lets go of Mii `i`. Let go while still it drops where it is; flung, it flies off with the
   * hand's speed. Wherever it comes down, it stands there stunned, looks about, and runs for it.
   */
  release(i: number, time: number) {
    const m = this.miis[i];
    if (m.act !== 'held') return;
    // Through the long lens a flick up the screen covers a lot of floor, so depth counts for less.
    const v = m.vel3.set(m.handVel.x, 0, m.handVel.z / 2.4);
    const speed = Math.min(THROW, v.length());
    if (speed > 0) v.setLength(speed);
    const thrown = speed > 2.2;
    v.y = thrown ? 2 + speed * 0.3 + Math.min(3, Math.max(0, m.handVel.y) * 0.2) : 0;
    // However hard the throw, it comes down somewhere you can still see it.
    const air = (v.y + Math.sqrt(v.y * v.y + 2 * motion.GRAVITY * Math.max(0, m.lift))) / motion.GRAVITY;
    const { far, hero } = this.layout;
    const room = far.halfWidth * 0.85;
    const x = m.x + v.x * air;
    const z = m.z + v.z * air;
    if (Math.abs(x) > room) v.x = (Math.sign(x) * room - m.x) / air;
    if (z < far.z + 3) v.z = (far.z + 3 - m.z) / air;
    if (z > hero.z + 30) v.z = (hero.z + 30 - m.z) / air;
    m.spin = thrown ? (this.r() < 0.5 ? -1 : 1) * speed * 0.7 : 0;
    m.bounced = false;
    m.act = 'flung';
    m.at = time;
    this.play(m, thrown ? motion.fall : motion.dangle, time);
  }

  update(dt: number, time: number, camera: THREE.Vector3, calm: boolean) {
    for (const m of this.miis) this.think(m, dt, time, camera, calm);
    this.separate();
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
    if (m.act !== 'dash' && m.act !== 'stroll' && m.act !== 'flee') m.vel *= Math.exp(-8 * dt);
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
        return;
      case 'stroll':
        if (this.step(m, WALK * m.pace, 5.6, dt)) this.rest(m, time, 2 + this.r() * 5);
        return;
      case 'speak':
        this.turn(m, toCamera, dt);
        this.keepSpot(m, dt);
        if (time >= m.until) this.rest(m, time, 2 + this.r() * 3);
        return;
      case 'show':
        if (m.clip === motion.spin) m.yaw += m.spinning * dt;
        else this.turn(m, m.face, dt);
        this.keepSpot(m, dt);
        if (time >= m.until) this.rest(m, time, 1.5 + this.r() * 4);
        return;
      default:
        this.turn(m, m.face, dt);
        this.keepSpot(m, dt);
        if (!calm && time >= m.until) this.decide(m, time, toCamera);
    }
  }

  /** Held, flying, stunned or running off: the same for the crowd and the middle group. */
  private handled(m: Mii, dt: number, time: number, toCamera: number) {
    const collar = m.set.collar(m.slot) * SIZE;
    switch (m.act) {
      case 'held': {
        if (dt <= 0) return;
        // The hand follows the pointer closely, not rigidly, and its speed is kept for a throw.
        _a.copy(m.hand);
        m.hand.lerp(m.grip, 1 - Math.exp(-30 * dt));
        const ax = m.handVel.x;
        const az = m.handVel.z;
        m.handVel.lerp(_b.subVectors(m.hand, _a).divideScalar(dt), 1 - Math.exp(-16 * dt));
        // The body swings under the hand like a pendulum: the hand speeding up leaves it trailing
        // behind, gravity brings it back, and it settles. Depth counts for less, as with a throw.
        const pull = motion.GRAVITY / GRAB.swing;
        const accX = ((m.handVel.x - ax) / dt) * 0.6;
        const accZ = ((m.handVel.z - az) / dt) * 0.25;
        const damp = Math.exp(-3.2 * dt);
        m.swayVel.x = (m.swayVel.x + (-pull * Math.sin(m.sway.x) - (accX / GRAB.swing) * Math.cos(m.sway.x)) * dt) * damp;
        m.swayVel.y = (m.swayVel.y + (-pull * Math.sin(m.sway.y) - (accZ / GRAB.swing) * Math.cos(m.sway.y)) * dt) * damp;
        m.sway.x = clamp(m.sway.x + m.swayVel.x * dt, -0.85, 0.85);
        m.sway.y = clamp(m.sway.y + m.swayVel.y * dt, -0.85, 0.85);
        // It squirms round to face you, twisting as it hangs.
        m.yaw += angleDelta(m.yaw, toCamera + Math.sin(time * 1.4 + m.k * 9) * 0.55) * (1 - Math.exp(-3 * dt));
        // Up the body, from its swung-out middle to the hand; in the Mii's own frame that is its tip.
        _b.set(Math.sin(m.sway.x), Math.cos(m.sway.x) * Math.cos(m.sway.y), Math.sin(m.sway.y)).normalize();
        _b.x = -_b.x;
        _b.z = -_b.z;
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
        return;
      }
      case 'flung': {
        const v = m.vel3;
        v.y -= motion.GRAVITY * dt;
        m.x += v.x * dt;
        m.z += v.z * dt;
        m.lift += v.y * dt;
        m.yaw += m.spin * dt;
        m.spin *= Math.exp(-1.2 * dt);
        // It rights itself in the air, feet first by the time it lands.
        const right = Math.exp(-(m.clip === motion.fall ? 5 : 9) * dt);
        m.tipX *= right;
        m.tipZ *= right;
        if (m.lift > 0) return;
        m.lift = 0;
        if (v.y < -9 && !m.bounced) {
          // A hard landing bounces once.
          m.bounced = true;
          v.y *= -0.3;
          v.x *= 0.5;
          v.z *= 0.5;
          return;
        }
        v.y = 0;
        m.act = 'stunned';
        m.at = time;
        this.play(m, motion.land, time, true);
        return;
      }
      case 'stunned': {
        // A short skid, then still.
        const v = m.vel3;
        v.multiplyScalar(Math.exp(-12 * dt));
        m.x += v.x * dt;
        m.z += v.z * dt;
        m.tipX *= Math.exp(-12 * dt);
        m.tipZ *= Math.exp(-12 * dt);
        m.yaw += m.spin * dt;
        m.spin *= Math.exp(-10 * dt);
        if (m.clip === motion.land && time - m.at > 0.3) this.play(m, motion.stunned, time);
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

  /** What a Mii in the crowd does next. */
  private decide(m: Mii, time: number, toCamera: number) {
    const roll = this.r();
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
   * circle, the Mii heads for the point at its edge on the near side instead, so it walks round
   * the circle rather than pushing against it. True on arrival.
   */
  private step(m: Mii, speed: number, cadence: number, dt: number, avoid = true) {
    const d = Math.hypot(m.tx - m.x, m.tz - m.z);
    if (d < 0.06 || (d < 0.25 && m.vel < 0.15)) {
      m.detour = 0;
      return true;
    }
    let gx = m.tx;
    let gz = m.tz;
    // Work in squeezed space, where the circle is round.
    const { hero } = this.layout;
    const cx = hero.x + KEEP_OUT.x;
    const cz = hero.z + KEEP_OUT.z;
    const sq = DEEP * 0.75;
    const px = m.x - cx;
    const pz = (m.z - cz) / sq;
    const qx = m.tx - cx;
    const qz = (m.tz - cz) / sq;
    const ex = qx - px;
    const ez = qz - pz;
    const len2 = ex * ex + ez * ez || 1;
    const u = clamp(-(px * ex + pz * ez) / len2, 0, 1);
    const nx = px + ex * u;
    const nz = pz + ez * u;
    const clearance = KEEP_OUT.r + 0.9;
    if (avoid && u > 0 && u < 1 && Math.hypot(nx, nz) < clearance) {
      // Round the circle on whichever side the path already leans to, chosen once for the trip so
      // a path straight through the middle cannot flip between the two.
      if (!m.detour) {
        const cross = px * ez - pz * ex;
        m.detour = Math.abs(cross) > 0.3 ? Math.sign(cross) : this.r() < 0.5 ? 1 : -1;
      }
      const side = m.detour;
      const r = Math.hypot(px, pz) || 1;
      // A point a quarter of the way round from here, just outside the edge.
      const ang = Math.atan2(pz, px) + side * -0.7;
      const out = Math.max(clearance + 0.4, Math.min(r, clearance + 2));
      gx = cx + Math.cos(ang) * out;
      gz = cz + Math.sin(ang) * out * sq;
    }
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
      // Miis up in the air are no one's to step round.
      if (m.act === 'away' || m.act === 'held' || m.act === 'flung') return;
      const k = key(m.x, m.z);
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    });
    const { hero } = this.layout;
    for (const m of this.miis) {
      if (m.act === 'away' || m.friend || m.act === 'held' || m.act === 'flung' || m.act === 'stunned') continue;
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
            const give = (PERSONAL - d) * (o.friend ? 1 : m.act === 'dash' || m.act === 'stroll' ? 0.5 : 0.12);
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

  /** Writes one animation's pose for this moment into `out`. */
  private evaluate(m: Mii, clip: motion.Clip, since: number, time: number, calm: boolean, out: Pose) {
    if (clip === HOLD) return motion.copyJoints(m.held, out);
    motion.neutral(out);
    const gait = clip === motion.run || clip === motion.walk || clip === motion.flee;
    // Your Mii arches back to look up; friends take whichever way their own number gives them.
    const k = m.lead && clip === motion.skyward ? 0.5 : m.k;
    if (calm && gait) return;
    clip(out, gait ? m.stride : Math.max(0, time - since), k);
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
    pose.y += m.lift;
    pose.yaw = m.yaw;
    pose.pitch += m.tipX;
    pose.roll += m.tipZ;
    pose.scale = SIZE;
    m.set.setPose(m.slot, pose);
  }
}
