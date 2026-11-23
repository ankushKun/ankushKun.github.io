// What a Mii's body does: every clip writes joint angles for one moment. Where a Mii stands and
// which way it faces belongs to the crowd; clips only touch height, joints, a turn on the spot and
// the face (the moonwalk's glide is the one exception, given separately by `moonSlide`).
import type { Pose } from '../mii/rig';

/** `t` is seconds since the clip began (or stride phase for the two gaits), `k` a per Mii offset in 0..1. */
export type Clip = (p: Pose, t: number, k: number) => void;

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** 0 to 1 over [a, b], eased. */
const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Every joint a clip writes, `yaw` being the body's turn on the spot from wherever the crowd faces it. */
const FIELDS = [
  'y', 'yaw', 'pitch', 'roll', 'crouch', 'sway', 'leanX', 'leanZ', 'twist', 'nod', 'tilt', 'headYaw',
  'legL', 'legR', 'kneeL', 'kneeR', 'spread',
  'swingL', 'outL', 'twistL', 'elbowL', 'swingR', 'outR', 'twistR', 'elbowR',
] as const;

/** For a value swinging between -1 and 1: 0 at the bottom, 1 at the top, smooth all the way, with no corner where it turns. */
const fold = (v: number) => ((1 + v) / 2) ** 2;

/** Arms hanging and legs straight: the base every clip starts from. */
export function neutral(p: Pose) {
  p.y = p.yaw = 0;
  p.pitch = p.roll = 0;
  p.crouch = p.sway = 0;
  p.leanX = p.leanZ = p.twist = 0;
  p.nod = p.tilt = p.headYaw = 0;
  p.legL = p.legR = p.kneeL = p.kneeR = p.spread = 0;
  p.swingL = p.swingR = 0;
  p.outL = p.outR = 0.14;
  p.twistL = p.twistR = 0;
  p.elbowL = p.elbowR = 0.16;
  p.expr = 0;
}

/** Standing around: breathing, a slow shift of weight, a glance now and then. */
export const stand: Clip = (p, t, k) => {
  const breath = sin(t * 1.9 + k * TAU);
  const shift = sin(t * 0.47 + k * 9.1);
  p.outL = 0.14 + breath * 0.012;
  p.outR = 0.14 + breath * 0.012;
  p.elbowL = p.elbowR = 0.17 + breath * 0.02;
  p.leanZ = shift * 0.02;
  p.sway = shift * 0.12;
  p.tilt = -shift * 0.015;
  // A glance holds for a while, then the head comes back.
  const glance = sin(t * 0.29 + k * 17.3);
  p.headYaw = Math.sign(glance) * smooth((Math.abs(glance) - 0.55) / 0.3) * 0.34;
  p.nod = sin(t * 0.21 + k * 5.7) * 0.03;
};

/** A stroll. `t` is stride phase: one full turn is two steps. */
export const walk: Clip = (p, t) => {
  const s = sin(t);
  const c = cos(t);
  p.legL = s * 0.5;
  p.legR = -s * 0.5;
  p.kneeL = fold(c) * 0.55;
  p.kneeR = fold(-c) * 0.55;
  p.swingL = -s * 0.42;
  p.swingR = s * 0.42;
  p.elbowL = 0.24 + fold(-s) * 0.22;
  p.elbowR = 0.24 + fold(s) * 0.22;
  p.twist = s * 0.07;
  p.leanX = 0.035;
  p.leanZ = c * 0.018;
  p.y = Math.abs(c) * 0.018;
};

/** The plaza run: both arms thrown up, big bouncy strides. `t` is stride phase. */
export const run: Clip = (p, t, k) => {
  const s = sin(t);
  const c = cos(t);
  p.legL = s * 0.82;
  p.legR = -s * 0.82;
  p.kneeL = 0.14 + fold(c) * 1.0;
  p.kneeR = 0.14 + fold(-c) * 1.0;
  const reach = 2.08 + (k - 0.5) * 0.36;
  p.outL = reach + s * 0.13;
  p.outR = reach - s * 0.13;
  p.swingL = p.swingR = 0.18;
  p.elbowL = 0.34 + c * 0.1;
  p.elbowR = 0.34 - c * 0.1;
  p.twistL = p.twistR = -0.5;
  p.twist = s * 0.1;
  p.leanX = 0.13;
  p.leanZ = c * 0.03;
  p.nod = -0.06;
  p.y = Math.abs(s) * 0.075;
};

/** Applause, hands meeting in front of the chest. */
export const clap: Clip = (p, t, k) => {
  const beat = t * TAU * 3.3 + k * 2.2;
  const open = 0.5 + 0.5 * sin(beat);
  p.swingL = p.swingR = 0.56;
  p.outL = p.outR = 0.03 + open * 0.1;
  p.twistL = p.twistR = 0.97 - open * 0.42;
  p.elbowL = p.elbowR = 1.56 - open * 0.12;
  p.leanX = 0.05;
  p.crouch = 0.035 + 0.03 * sin(beat * 0.5);
  p.nod = 0.03 * sin(beat * 0.5 + 1);
  p.tilt = 0.035 * sin(t * 2.3 + k * 7);
  p.expr = 2;
};

/** Gravity for the opening fall, in world units per second squared. */
export const GRAVITY = 18;

/**
 * Falling from the sky. `t` is seconds into the fall, so the pose follows the speed: the rushing
 * air pushes the arms higher and makes them flutter faster, the legs kick, the body tips back a
 * little, the head turns down to watch the floor coming, and the face is pure surprise.
 */
export const fall: Clip = (p, t, k) => {
  const speed = Math.min(1, (GRAVITY * t) / 14);
  const flutter = sin(t * (11 + speed * 14) + k * 6);
  const flap = sin(t * (8 + speed * 10) + 1.7 + k * 3);
  p.outL = 1.6 + speed * 0.95 + flutter * (0.06 + speed * 0.12);
  p.outR = 1.6 + speed * 0.95 - flap * (0.06 + speed * 0.12);
  p.swingL = 0.1 - speed * 0.25;
  p.swingR = 0.1 - speed * 0.25;
  p.elbowL = 0.25 + speed * 0.2 + flap * 0.1;
  p.elbowR = 0.25 + speed * 0.2 + flutter * 0.1;
  // A slow bicycle of the legs, as anyone does with nothing under their feet.
  const kick = sin(t * 7 + k * 4);
  p.legL = 0.15 + kick * 0.28 * (0.4 + speed);
  p.legR = 0.15 - kick * 0.28 * (0.4 + speed);
  p.kneeL = 0.35 + fold(kick) * 0.5;
  p.kneeR = 0.35 + fold(-kick) * 0.5;
  p.spread = 0.08 + speed * 0.06;
  p.leanX = -0.06 - speed * 0.1;
  p.nod = 0.05 + speed * 0.28;
  p.tilt = flutter * 0.04;
  p.expr = 3;
};

/** Floating high in the sky before anything begins: arms out, legs dangling, drifting. */
export const float: Clip = (p, t) => {
  const a = sin(t * 1.6);
  const b = sin(t * 1.1 + 1.3);
  p.outL = 1.75 + a * 0.16;
  p.outR = 1.75 - a * 0.16;
  p.swingL = p.swingR = 0.08;
  p.elbowL = 0.18 + b * 0.08;
  p.elbowR = 0.18 - b * 0.08;
  p.legL = 0.1 + b * 0.12;
  p.legR = 0.02 - b * 0.12;
  p.kneeL = 0.15 + Math.max(0, b) * 0.2;
  p.kneeR = 0.15 + Math.max(0, -b) * 0.2;
  p.leanZ = a * 0.04;
  p.tilt = -a * 0.05;
  p.nod = -0.05 + b * 0.03;
  p.y = b * 0.06;
  p.expr = 2;
};

/**
 * Hello! A big wave after landing. Only the forearm swings; the upper arm holds out to the side,
 * the other hand rests on the hip, and the body stays steady apart from a happy bounce at the start.
 */
export const hello: Clip = (p, t) => {
  const up = ramp(t, 0, 0.3) * (1 - ramp(t, 1.8, 2.2));
  const swing = sin(t * 9.5);
  const bounce = Math.max(0, sin(t * 4.75)) * up * (1 - ramp(t, 0.5, 0.9));
  p.outR = mix(0.14, 1.95, up);
  p.swingR = 0.15 * up;
  p.twistR = -1.45 * up;
  p.elbowR = mix(0.16, 1.0 + swing * 0.45, up);
  p.outL = mix(0.14, 0.62, up);
  p.swingL = -0.4 * up;
  p.twistL = -0.7 * up;
  p.elbowL = mix(0.16, 1.75, up);
  p.leanZ = 0.04 * up;
  p.tilt = -0.08 * up;
  p.nod = -0.04 * up;
  p.y = bounce * 0.1;
  p.crouch = (1 - bounce) * 0.03 * up;
  p.expr = up > 0.3 ? 2 : 0;
};

/**
 * Touching down. The legs act as a spring: the impact drives the knees down, they bounce back up
 * a touch past straight and settle. The arms, still up from the fall, swing down with the jolt and
 * overshoot a little. Eyes squeeze shut on impact, then a grin.
 */
export const land: Clip = (p, t) => {
  const w = 15;
  const zeta = 0.38;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * w * t);
  const spring = decay * sin(wd * t);
  p.crouch = Math.max(-0.04, spring * 0.62);
  p.leanX = spring * 0.22;
  p.nod = spring * 0.25;
  // Arms fall from overhead to the sides, lagging the body, with a small swing past.
  const drop = 1 - Math.exp(-7 * t) * cos(9 * t);
  p.outL = p.outR = mix(2.4, 0.14, drop);
  p.swingL = p.swingR = 0.1 * Math.exp(-6 * t) * sin(11 * t);
  p.elbowL = p.elbowR = 0.16 + spring * 0.35;
  p.spread = 0.06 * decay;
  p.expr = t < 0.28 ? 1 : 2;
};

/** Soaking up the applause: one hand behind the head, a sway, a grin. */
export const bashful: Clip = (p, t) => {
  const into = ramp(t, 0, 0.32);
  const rock = sin(t * 3.4);
  p.outR = mix(0.14, 2.18, into);
  p.twistR = -1.32 * into;
  p.elbowR = mix(0.16, 2.2 + sin(t * 6.8) * 0.1, into);
  p.swingR = -0.22 * into;
  p.outL = 0.2 + 0.1 * into;
  p.elbowL = 0.16 + 0.3 * into;
  p.leanZ = rock * 0.085 * into;
  p.sway = rock * 0.5 * into;
  p.tilt = (-0.1 + rock * 0.07) * into;
  p.nod = 0.07 * into;
  p.crouch = (0.05 + 0.04 * sin(t * 6.8 + 0.6)) * into;
  p.twist = rock * 0.07 * into;
  p.expr = into > 0.3 ? 2 : 0;
};

/** Arms thrown wide with a little bow: thanks, everyone. */
export const thanks: Clip = (p, t) => {
  const open = ramp(t, 0, 0.22) * (1 - ramp(t, 0.75, 1.15));
  p.outL = p.outR = mix(0.14, 1.12, open);
  p.swingL = p.swingR = 0.12 * open;
  p.elbowL = p.elbowR = 0.16 + 0.1 * open;
  p.leanX = 0.1 * open;
  p.nod = 0.05 * open;
  p.crouch = 0.05 * open;
  p.expr = open > 0.3 ? 2 : 0;
};

/** A wave with the right hand. */
export const wave: Clip = (p, t, k) => {
  const up = ramp(t, 0, 0.3) * (1 - ramp(t, 1.45, 1.8));
  // The upper arm holds still; the forearm does the waving.
  p.outR = mix(0.14, 1.72, up);
  p.twistR = -1.5 * up;
  p.elbowR = mix(0.16, 0.95 + sin(t * 11 + k) * 0.4, up);
  p.leanZ = -0.04 * up;
  p.tilt = 0.07 * up;
  p.expr = up > 0.4 ? 2 : 0;
};

/** A happy jump, arms up. */
export const hop: Clip = (p, t) => {
  const beat = t * 2.7;
  const air = Math.max(0, sin(beat * Math.PI));
  const live = 1 - ramp(t, 1.05, 1.11);
  const up = ramp(t, 0, 0.28) * (1 - ramp(t, 0.8, 1.2));
  p.y = air * 0.2 * live;
  p.crouch = (1 - air) * 0.22 * up;
  p.outL = p.outR = mix(0.14, 2.34, up);
  p.elbowL = p.elbowR = mix(0.16, 0.3 + (1 - air) * 0.3, up);
  p.twistL = p.twistR = -0.5 * up;
  p.spread = air * 0.1 * up;
  p.nod = -0.1 * up;
  p.expr = up > 0.4 ? 2 : 0;
};

/** Speaking up: the forearms do the talking. */
export const talk: Clip = (p, t, k) => {
  const into = ramp(t, 0, 0.25);
  const a = sin(t * 5.1 + k * 4);
  const b = sin(t * 3.7 + k * 9 + 1.4);
  p.swingR = 0.34 * into;
  p.elbowR = mix(0.16, 1.2 + a * 0.24, into);
  p.twistR = (0.22 + b * 0.2) * into;
  p.swingL = 0.2 * into;
  p.elbowL = mix(0.16, 0.75 + b * 0.2, into);
  p.twistL = 0.3 * into;
  p.nod = a * 0.05 * into;
  p.tilt = b * 0.06 * into;
  p.leanX = 0.03 * into;
};

/**
 * Staring up at the sky, each in their own way: `k` below a third shades their eyes, below two
 * thirds arches back with a fist up and a hand on the hip, otherwise leans back to one side.
 */
export const skyward: Clip = (p, t, k) => {
  const up = ramp(t, 0, 0.45);
  const sway = sin(t * 1.7 + k * 5) * 0.03;
  if (k < 1 / 3) {
    // Mii heads are big: a hand reaches eye level only with the upper arm raised nearly straight.
    p.swingR = 0.2 * up;
    p.outR = mix(0.14, 2.0, up);
    p.twistR = -1.4 * up;
    p.elbowR = mix(0.16, 1.3, up);
    p.nod = -0.32 * up;
    p.headYaw = 0.18 * up;
    p.leanX = -0.06 * up;
    p.tilt = sway;
    p.outL = 0.2;
  } else if (k < 2 / 3) {
    p.leanX = (-0.5 + sway) * up;
    p.nod = -0.72 * up;
    p.tilt = 0.1 * up;
    p.swingR = 0.5 * up;
    p.outR = mix(0.14, 2.75, up);
    p.elbowR = mix(0.16, 0.35, up);
    p.outL = mix(0.14, 0.7, up);
    p.swingL = -0.45 * up;
    p.twistL = -0.7 * up;
    p.elbowL = mix(0.16, 1.85, up);
    p.legR = 0.3 * up;
    p.legL = -0.18 * up;
    p.kneeR = 0.14 * up;
    p.crouch = 0.04 * up;
  } else {
    p.leanX = -0.34 * up;
    p.leanZ = (0.32 + sway) * up;
    p.nod = -0.62 * up;
    p.tilt = 0.32 * up;
    p.outL = mix(0.14, 2.45, up);
    p.elbowL = mix(0.16, 1.2, up);
    p.swingL = 0.3 * up;
    p.outR = mix(0.14, 0.7, up);
    p.swingR = -0.45 * up;
    p.twistR = -0.7 * up;
    p.elbowR = mix(0.16, 1.85, up);
    p.sway = -0.6 * up;
  }
};

/** Looking up at the icon overhead. */
export const gaze: Clip = (p, t, k) => {
  const into = ramp(t, 0, 0.4) * (1 - ramp(t, 2.3, 2.8));
  p.nod = -0.36 * into;
  p.headYaw = sin(t * 1.3 + k * 6) * 0.16 * into;
  p.leanX = -0.04 * into;
  p.outL = p.outR = 0.14 + 0.06 * into;
};

/** Listening to a neighbor: small nods, a tilt of the head. */
export const listen: Clip = (p, t, k) => {
  const breath = sin(t * 1.9 + k * TAU);
  p.outL = p.outR = 0.14 + breath * 0.012;
  p.nod = 0.03 + Math.max(0, sin(t * 4.3 + k * 11)) * 0.07;
  p.tilt = sin(t * 0.9 + k * 3) * 0.06;
  p.leanX = 0.03;
};

// The middle group's antics. Each loops for as long as it is held; the cross fade in and out
// (see crowd.ts) brings it on and takes it off smoothly.

/** Cracking up: head back, then doubled over, shoulders shaking, hands at the belly. */
export const laugh: Clip = (p, t, k) => {
  const shake = sin(t * 23 + k * 5);
  const over = ramp(t, 0.5, 1.1);
  p.leanX = mix(-0.14, 0.32, over) + shake * 0.025;
  p.nod = mix(-0.32, 0.18, over) + shake * 0.04;
  p.crouch = 0.04 + over * 0.08 + Math.abs(shake) * 0.02;
  p.swingL = p.swingR = 0.5;
  p.outL = p.outR = 0.12;
  p.twistL = p.twistR = 0.85;
  p.elbowL = p.elbowR = 1.5 + shake * 0.08;
  p.tilt = sin(t * 3 + k) * 0.08;
  p.expr = 2;
};

/** Dancing: arms pumping in turn, hips swaying, bobbing on the beat. */
export const dance: Clip = (p, t, k) => {
  const beat = t * Math.PI * 4 + k * 3;
  const s = sin(beat / 2);
  p.crouch = 0.05 + fold(sin(beat)) * 0.07;
  p.sway = s * 0.45;
  p.leanZ = -s * 0.06;
  p.twist = s * 0.18;
  p.tilt = s * 0.12;
  p.outL = 0.6 + fold(s) * 1.9;
  p.outR = 0.6 + fold(-s) * 1.9;
  p.elbowL = 0.5 + fold(-s) * 0.9;
  p.elbowR = 0.5 + fold(s) * 0.9;
  p.twistL = p.twistR = -0.5;
  p.kneeL = fold(s) * 0.3;
  p.kneeR = fold(-s) * 0.3;
  p.expr = 2;
};

/** Windmilling both arms in full circles, mouth open. */
export const windmill: Clip = (p, t, k) => {
  const a = t * 8.5 + k * 2;
  p.swingL = a;
  p.swingR = a + Math.PI;
  p.outL = p.outR = 0.3;
  p.elbowL = p.elbowR = 0.08;
  p.leanX = 0.06 + sin(a * 2) * 0.03;
  p.crouch = 0.04 + fold(sin(a * 2)) * 0.04;
  p.nod = -0.05;
  p.expr = 3;
};

/** Jumping jacks. */
export const jacks: Clip = (p, t, k) => {
  const c = sin(t * 9.4 + k * 4);
  const open = fold(c);
  p.outL = p.outR = 0.14 + open * 2.6;
  p.elbowL = p.elbowR = 0.2;
  p.spread = open * 0.32;
  p.y = Math.abs(sin(t * 9.4 + k * 4 + 0.6)) * 0.13;
  p.crouch = (1 - open) * 0.05;
  p.expr = 2;
};

/** Spinning on the spot, arms out. The crowd turns the body; this is the pose. */
export const spin: Clip = (p, t) => {
  p.outL = p.outR = 1.3 + sin(t * 6) * 0.08;
  p.elbowL = p.elbowR = 0.12;
  p.leanZ = 0.05;
  p.nod = -0.08;
  p.y = Math.abs(sin(t * 7)) * 0.04;
  p.expr = 3;
};

/** Arguing: hands on hips, leaning in, head bobbing, cross. */
export const argue: Clip = (p, t, k) => {
  const jab = sin(t * 7 + k * 6);
  p.outL = p.outR = 0.62;
  p.swingL = p.swingR = -0.4;
  p.twistL = p.twistR = -0.7;
  p.elbowL = p.elbowR = 1.75;
  p.leanX = 0.14 + jab * 0.05;
  p.nod = 0.04 + sin(t * 10 + k) * 0.07;
  p.headYaw = sin(t * 2.6 + k * 3) * 0.12;
  p.tilt = jab * 0.05;
  p.expr = 4;
};

/** Pointing at someone and laughing. */
export const point: Clip = (p, t, k) => {
  const shake = sin(t * 20 + k * 3);
  p.swingR = 1.45 + sin(t * 7) * 0.08;
  p.outR = 0.12;
  p.elbowR = 0.1;
  p.swingL = 0.5;
  p.twistL = 0.85;
  p.elbowL = 1.5;
  p.leanX = 0.1 + shake * 0.02;
  p.crouch = 0.05 + Math.abs(shake) * 0.02;
  p.nod = 0.06 + shake * 0.03;
  p.expr = 2;
};

/** Panicking: arms flailing over the head, hopping from foot to foot, mouth open. */
export const panic: Clip = (p, t, k) => {
  const a = sin(t * 13 + k * 4);
  const b = sin(t * 11.3 + k * 7 + 1.1);
  p.outL = 2.0 + a * 0.6;
  p.outR = 2.0 + b * 0.6;
  p.swingL = b * 0.6;
  p.swingR = a * 0.6;
  p.elbowL = 0.5 + fold(a) * 0.9;
  p.elbowR = 0.5 + fold(b) * 0.9;
  const step = sin(t * 12 + k);
  p.legL = fold(step) * 0.35;
  p.legR = fold(-step) * 0.35;
  p.kneeL = fold(step) * 0.6;
  p.kneeR = fold(-step) * 0.6;
  p.y = Math.abs(step) * 0.07;
  p.headYaw = sin(t * 5 + k) * 0.3;
  p.expr = 3;
};

// Being played with: picked up by the shirt, thrown, set down somewhere strange.

/**
 * Hanging by the scruff of the shirt. The collar rides up, so the arms are pushed up and flail,
 * the legs kick at nothing, and the face is shock. How the body swings is the crowd's business.
 */
export const dangle: Clip = (p, t, k) => {
  const a = sin(t * 9.5 + k * 5);
  const b = sin(t * 8.1 + k * 3 + 1.2);
  const kick = sin(t * 10.5 + k * 4);
  const into = ramp(t, 0, 0.18);
  p.outL = mix(0.14, 2.05 + a * 0.35, into);
  p.outR = mix(0.14, 2.05 + b * 0.35, into);
  p.swingL = b * 0.35 * into;
  p.swingR = a * 0.35 * into;
  p.elbowL = 0.4 + fold(a) * 0.7;
  p.elbowR = 0.4 + fold(b) * 0.7;
  p.legL = (0.15 + kick * 0.45) * into;
  p.legR = (0.15 - kick * 0.45) * into;
  p.kneeL = 0.25 + fold(kick) * 0.75;
  p.kneeR = 0.25 + fold(-kick) * 0.75;
  p.spread = 0.08;
  // Shoulders hunched up round the ears, looking down at the drop.
  p.nod = 0.22 + sin(t * 3.1 + k) * 0.08;
  p.headYaw = sin(t * 2.3 + k * 7) * 0.35;
  p.leanX = -0.08;
  p.expr = t < 0.12 ? 1 : 3;
};

/**
 * Set down somewhere new: a frozen moment of shock, then a quick bewildered look left and right,
 * the hands coming up in a "what just happened?" shrug, and it bolts.
 */
export const stunned: Clip = (p, t, k) => {
  const frozen = 1 - ramp(t, 0.25, 0.4);
  const look = ramp(t, 0.25, 0.4);
  const side = k < 0.5 ? 1 : -1;
  // Left, right, back again, whipping across.
  const sweep = ramp(t, 0.3, 0.42) - 2 * ramp(t, 0.5, 0.62) + ramp(t, 0.68, 0.78);
  p.headYaw = side * sweep * 0.75;
  p.twist = side * sweep * 0.22;
  p.outL = p.outR = mix(0.14, 0.55, frozen) + 0.5 * look;
  p.twistL = p.twistR = -0.9 * look;
  p.elbowL = p.elbowR = mix(0.16, 0.5, frozen) + 1.1 * look;
  p.swingL = p.swingR = 0.25 * look;
  p.leanX = -0.08 * frozen;
  p.crouch = 0.05 * frozen + 0.03 * look;
  p.nod = -0.08 * frozen + sin(t * 1.7) * 0.04 * look;
  p.y = Math.abs(sin(t * 2)) * 0.01;
  p.expr = 3;
};

/**
 * Knocked flat: limbs flung loose where they landed, eyes shut, then a twitch of the hands and
 * feet as it comes round. The crowd lays the body down and stands it back up.
 */
export const sprawl: Clip = (p, t, k) => {
  const limp = 1 - Math.exp(-9 * t);
  const twitch = ramp(t, 0.45, 0.6) * (1 - ramp(t, 0.7, 0.9));
  p.outL = mix(1.6, 1.15 + k * 0.4, limp);
  p.outR = mix(1.6, 1.45 - k * 0.4, limp);
  p.swingL = 0.3 * limp;
  p.swingR = -0.2 * limp;
  p.elbowL = 0.35 + twitch * 0.5;
  p.elbowR = 0.6 - twitch * 0.3;
  p.legL = 0.2 * limp;
  p.legR = -0.1 * limp + twitch * 0.25;
  p.kneeL = 0.3;
  p.kneeR = 0.15 + twitch * 0.4;
  p.spread = 0.14 * limp;
  p.nod = -0.15 * limp;
  p.headYaw = (k - 0.5) * 0.9 * limp;
  p.expr = t < 0.55 ? 1 : 3;
};

/** Running off after a fright: the plaza run, the same as the crowd's run in, with a scared face. `t` is stride phase. */
export const flee: Clip = (p, t, k) => {
  run(p, t, k);
  p.expr = 5;
};

/** Startled: a jump on the spot, arms flung out, then a hand clutched to the chest. */
export const shock: Clip = (p, t) => {
  const jump = Math.max(0, sin(clamp01(t / 0.42) * Math.PI));
  const after = ramp(t, 0.42, 0.7);
  p.y = jump * 0.22;
  p.outL = p.outR = mix(1.8 * Math.min(1, t * 6), 0.4, after);
  p.elbowL = mix(0.2, 1.7, after);
  p.swingL = 0.4 * after;
  p.twistL = 0.9 * after;
  p.elbowR = 0.2;
  p.spread = jump * 0.12;
  p.leanX = mix(-0.12, 0.06, after);
  p.crouch = after * 0.05 * (1 - ramp(t, 1.2, 1.6));
  p.expr = 3;
};

/** Too much: keels over backwards stiff as a board, lies there, then springs back up. */
export const faint: Clip = (p, t) => {
  const over = ramp(t, 0.35, 0.95);
  const up = ramp(t, 2.3, 2.75);
  const down = over * (1 - up);
  // Rocks back on the heels first; the fall gathers speed and bounces once on the floor.
  const bounce = ramp(t, 0.95, 1.05) * (1 - ramp(t, 1.05, 1.25)) * 0.12;
  p.pitch = -(Math.PI / 2) * (down * down) + bounce * (1 - up);
  p.y = 0.12 * down;
  p.outL = p.outR = 0.14 + 0.3 * down;
  p.legL = p.legR = 0;
  p.nod = mix(-0.15 * ramp(t, 0, 0.3), 0.2, down);
  p.crouch = up * (1 - ramp(t, 2.75, 3.1)) * 0.12;
  p.expr = t < 0.3 ? 3 : t < 2.3 ? 1 : 2;
};

/** A tantrum: stamping from foot to foot, fists pumping, furious. */
export const tantrum: Clip = (p, t, k) => {
  const stamp = sin(t * 13 + k * 3);
  const pump = sin(t * 13 + k * 3 + 1.2);
  p.legL = fold(stamp) * 0.4;
  p.legR = fold(-stamp) * 0.4;
  p.kneeL = fold(stamp) * 0.7;
  p.kneeR = fold(-stamp) * 0.7;
  p.y = Math.abs(stamp) * 0.06;
  p.outL = p.outR = 0.35;
  p.swingL = 0.5 + pump * 0.4;
  p.swingR = 0.5 - pump * 0.4;
  p.elbowL = p.elbowR = 1.7;
  p.leanX = 0.15;
  p.nod = 0.12 + pump * 0.06;
  p.headYaw = sin(t * 6 + k) * 0.18;
  p.expr = 4;
};

/** Showing off: both arms up in a flex, a little bounce, a grin. */
export const flex: Clip = (p, t) => {
  const into = ramp(t, 0, 0.3);
  const pulse = fold(sin(t * 7));
  p.outL = p.outR = mix(0.14, 1.45, into);
  p.twistL = p.twistR = -1.5 * into;
  p.elbowL = p.elbowR = mix(0.16, 2.2 + pulse * 0.15, into);
  p.leanX = -0.06 * into;
  p.crouch = 0.04 * pulse * into;
  p.spread = 0.12 * into;
  p.nod = -0.05 * into;
  p.expr = into > 0.3 ? 2 : 0;
};

/** A cheeky wink and a finger gun. */
export const wink: Clip = (p, t) => {
  const into = ramp(t, 0, 0.25) * (1 - ramp(t, 1.15, 1.4));
  const shot = Math.max(0, sin(clamp01((t - 0.35) / 0.25) * Math.PI));
  p.swingR = mix(0, 1.35, into) + shot * 0.25;
  p.outR = 0.2 * into;
  p.elbowR = 0.15;
  p.tilt = 0.14 * into;
  p.leanZ = -0.05 * into;
  p.headYaw = 0.1 * into;
  p.expr = into > 0.4 ? 6 : 0;
};

/**
 * How long the stage routine takes to come round at its own pace, in seconds: the 1.775 s loop of
 * the chibi Miku dance it is matched to, frame by frame, danced at 72% of its speed. To music it
 * is fitted to the beat at the nearest pace to this (plaza/beat.ts).
 */
export const LOOP = 1.775 / 0.72;

/** Where a count of beats falls in its beat: 1 on it, easing to 0 halfway to the next. */
export const pulse = (beats: number) => fold(cos(beats * TAU));

type Joint = (typeof FIELDS)[number];
type Key = Partial<Record<Joint, number>>;

/**
 * The stage routine: poses keyed by how far round the loop they fall (0 to 1), read off the
 * recording frame by frame. The arms were measured as where the upper arm and forearm point and
 * solved for a Mii's joints, so the gestures keep their shape on a Mii's shorter arms. Left and
 * right are the dancer's own.
 */
const ROUTINE: [number, Key][] = [
  // Hands low, the left forearm crossing down to the right hand.
  [0.000, { crouch: 0.26, leanX: 0.06, nod: 0.05, kneeL: 0.12, sway: -0.04, outR: -0.05, swingR: 0.20, twistR: 0.90, elbowR: 0.30, outL: -0.01, swingL: 0.25, twistL: 1.17, elbowL: 0.94 }],
  // Arms in an X: the left forearm across the waist, the right arm reaching down across it.
  [0.042, { crouch: 0.32, leanX: 0.07, nod: 0.06, kneeL: 0.10, sway: -0.05, outR: -0.30, swingR: 0.43, twistR: 1.60, elbowR: 0.52, outL: 0.02, swingL: 0.25, twistL: 1.07, elbowL: 1.56 }],
  // A squeeze: hands together low in front, knees bent.
  [0.085, { crouch: 0.30, leanX: 0.09, nod: 0.08, sway: -0.04, outR: -0.12, swingR: 0.37, twistR: 1.39, elbowR: 0.41, outL: -0.12, swingL: 0.37, twistL: 1.39, elbowL: 0.41 }],
  // Into the pivot: turning right, the right foot stepping out, the left arm swinging out.
  [0.120, { yaw: -0.45, headYaw: -0.15, crouch: 0.24, spread: 0.22, sway: -0.12, leanX: 0.03, outR: 0.04, swingR: 0.15, twistR: 0.80, elbowR: 0.07, outL: 0.37, swingL: -0.15, twistL: -0.81, elbowL: 0.07 }],
  // The pivot: turned right, feet split, the left arm thrown straight back and down.
  [0.170, { yaw: -0.95, twist: -0.10, headYaw: -0.20, crouch: 0.24, legR: 0.35, legL: -0.30, spread: 0.30, sway: -0.20, outR: -0.07, swingR: 0.20, twistR: 0.28, elbowR: 0.16, outL: 0.56, swingL: -0.59, twistL: 0.00, elbowL: 0.00 }],
  // Held.
  [0.200, { yaw: -0.92, twist: -0.10, headYaw: -0.20, crouch: 0.25, legR: 0.35, legL: -0.30, spread: 0.30, sway: -0.20, outR: -0.07, swingR: 0.20, twistR: 0.28, elbowR: 0.16, outL: 0.66, swingL: -0.62, twistL: 0.00, elbowL: 0.00 }],
  // Unwinding: the left arm coming down and in.
  [0.230, { yaw: -0.55, twist: -0.05, headYaw: -0.15, crouch: 0.24, legR: 0.22, legL: -0.20, spread: 0.30, sway: -0.12, outR: -0.07, swingR: 0.20, twistR: 0.28, elbowR: 0.16, outL: 0.26, swingL: -0.25, twistL: 0.25, elbowL: 0.63 }],
  // Front again, both hands down by the left thigh, the right foot still out.
  [0.255, { yaw: -0.18, headYaw: -0.05, crouch: 0.22, spread: 0.30, sway: 0.06, outR: -0.34, swingR: 0.47, twistR: 1.72, elbowR: 0.44, outL: -0.07, swingL: 0.20, twistL: 0.64, elbowL: 0.13 }],
  // The right forearm across the waist, the right knee coming up.
  [0.283, { yaw: -0.05, crouch: 0.24, spread: 0.10, legR: 0.45, kneeR: 0.75, sway: 0.04, outR: -0.04, swingR: 0.28, twistR: 1.14, elbowR: 1.48, outL: -0.07, swingL: 0.25, twistL: 0.69, elbowL: 0.15 }],
  // The cross step: right knee high across the left, forearms stacked, the right one high across the stomach.
  [0.315, { yaw: 0.08, crouch: 0.28, legR: 1.30, kneeR: 1.65, spread: -0.12, leanX: -0.02, sway: 0.04, outR: 0.07, swingR: 0.39, twistR: 1.07, elbowR: 1.74, outL: 0.06, swingL: 0.20, twistL: 1.19, elbowL: 1.48 }],
  // The right knee still up.
  [0.345, { yaw: 0.06, crouch: 0.22, legR: 0.75, kneeR: 1.05, spread: -0.10, sway: 0.03, outR: 0.07, swingR: 0.39, twistR: 1.08, elbowR: 1.73, outL: 0.06, swingL: 0.20, twistL: 1.19, elbowL: 1.48 }],
  // The right foot down, crossed in front of the left.
  [0.375, { yaw: 0.05, crouch: 0.14, legR: 0.15, kneeR: 0.20, spread: -0.07, sway: 0.03, outR: 0.07, swingR: 0.39, twistR: 1.08, elbowR: 1.72, outL: 0.06, swingL: 0.20, twistL: 1.19, elbowL: 1.48 }],
  // Forearms stacked, settling.
  [0.440, { yaw: 0.03, crouch: 0.24, leanX: 0.03, sway: 0.05, outR: -0.01, swingR: 0.34, twistR: 1.19, elbowR: 1.54, outL: 0.04, swingL: 0.22, twistL: 1.21, elbowL: 1.40 }],
  // The right fist pushed out past the left side, the left arm reaching down to the right.
  [0.520, { yaw: 0.08, crouch: 0.24, leanX: 0.04, sway: 0.08, outR: -0.54, swingR: 0.58, twistR: 1.49, elbowR: 0.96, outL: -0.15, swingL: 0.45, twistL: 1.55, elbowL: 0.66 }],
  // Stepping out to the left.
  [0.585, { yaw: 0.05, crouch: 0.28, spread: 0.24, sway: 0.12, leanX: 0.04, outR: -0.47, swingR: 0.53, twistR: 1.50, elbowR: 0.91, outL: -0.17, swingL: 0.45, twistL: 1.57, elbowL: 0.58 }],
  // Hands together low again, feet wide, knees bent.
  [0.620, { crouch: 0.27, spread: 0.40, sway: 0.12, leanX: 0.05, outR: -0.17, swingR: 0.39, twistR: 1.44, elbowR: 0.36, outL: -0.17, swingL: 0.39, twistL: 1.44, elbowL: 0.36 }],
  // The right arm out by the side, the left hand reaching across.
  [0.650, { crouch: 0.28, spread: 0.44, sway: 0.12, leanX: 0.04, outR: 0.19, swingR: 0.08, twistR: 0.80, elbowR: 0.10, outL: 0.00, swingL: 0.41, twistL: 1.46, elbowL: 0.82 }],
  // Wide stance, the right arm hanging out, the left hand on the belly.
  [0.695, { crouch: 0.30, spread: 0.46, sway: 0.10, leanZ: -0.05, headYaw: -0.10, leanX: 0.03, outR: 0.24, swingR: 0.00, twistR: 0.23, elbowR: 0.08, outL: 0.20, swingL: 0.25, twistL: 0.93, elbowL: 1.79 }],
  // The right elbow out, the left hand down on the thigh.
  [0.735, { crouch: 0.27, spread: 0.40, sway: 0.06, leanZ: -0.03, leanX: 0.03, outR: 0.49, swingR: -0.10, twistR: 0.96, elbowR: 0.72, outL: 0.06, swingL: 0.20, twistL: 1.13, elbowL: 0.75 }],
  // Feet coming in, arms hanging.
  [0.785, { crouch: 0.25, spread: 0.18, leanX: 0.04, outR: -0.02, swingR: 0.18, twistR: 0.54, elbowR: 0.18, outL: -0.02, swingL: 0.18, twistL: 0.54, elbowL: 0.18 }],
  // The right hand on the right thigh, the left heel up.
  [0.840, { crouch: 0.15, legL: -0.10, kneeL: 0.55, leanX: 0.02, outR: 0.15, swingR: 0.31, twistR: 0.99, elbowR: 0.62, outL: 0.08, swingL: 0.10, twistL: 0.26, elbowL: 0.11 }],
  // Standing tall, both hands on the hips.
  [0.905, { crouch: 0.00, leanX: -0.03, nod: -0.04, outR: 0.72, swingR: -0.39, twistR: 0.89, elbowR: 1.87, outL: 0.72, swingL: -0.39, twistL: 0.89, elbowL: 1.87 }],
  // Hands on the hips, a little lower.
  [0.955, { crouch: 0.10, nod: -0.02, outR: 0.59, swingR: -0.34, twistR: 0.95, elbowR: 1.57, outL: 0.59, swingL: -0.34, twistL: 0.95, elbowL: 1.57 }],
  // The right hand coming off the hip.
  [0.985, { crouch: 0.16, leanX: 0.03, nod: 0.02, outR: 0.02, swingR: 0.25, twistR: 0.72, elbowR: 0.33, outL: 0.45, swingL: -0.25, twistL: -0.50, elbowL: 1.40 }],
];

/** How far round the loop it is from `a` to `b`, the way the routine goes. */
const ahead = (a: number, b: number) => (b - a + 1) % 1 || 1;

/**
 * A looping move from poses keyed by how far round it they fall (0 to 1): a smooth curve through
 * every key that never overshoots one, coming back round to the first. Anything a key leaves out
 * stays as `neutral` has it. Returns a sampler that sets `p` to the move `u` of the way round.
 */
function curve(keys: [number, Key | Pose][]) {
  const all = keys.map(([at, key]) => {
    const p = {} as Pose;
    neutral(p);
    Object.assign(p, key);
    return { at, pose: FIELDS.map((f) => p[f]), slope: FIELDS.map(() => 0) };
  });
  // Slopes flat where a joint turns back, otherwise a weighted mean of the two sides (Fritsch and
  // Butland's, as in PCHIP).
  all.forEach((k, i) => {
    const prev = all[(i + all.length - 1) % all.length];
    const next = all[(i + 1) % all.length];
    const h0 = ahead(prev.at, k.at);
    const h1 = ahead(k.at, next.at);
    for (let j = 0; j < FIELDS.length; j++) {
      const d0 = (k.pose[j] - prev.pose[j]) / h0;
      const d1 = (next.pose[j] - k.pose[j]) / h1;
      if (d0 * d1 <= 0) continue;
      const w0 = 2 * h1 + h0;
      const w1 = h1 + 2 * h0;
      k.slope[j] = (w0 + w1) / (w0 / d0 + w1 / d1);
    }
  });
  return (p: Pose, u: number) => {
    u = ((u % 1) + 1) % 1;
    let i = all.length - 1;
    while (i >= 0 && all[i].at > u) i--;
    const a = all[i < 0 ? all.length - 1 : i];
    const b = all[(i + 1) % all.length];
    const h = ahead(a.at, b.at);
    const s = ((u - a.at + 1) % 1) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    // Cubic Hermite between the two keys.
    const ka = 2 * s3 - 3 * s2 + 1;
    const ma = (s3 - 2 * s2 + s) * h;
    const kb = 3 * s2 - 2 * s3;
    const mb = (s3 - s2) * h;
    for (let j = 0; j < FIELDS.length; j++) p[FIELDS[j]] = ka * a.pose[j] + ma * a.slope[j] + kb * b.pose[j] + mb * b.slope[j];
  };
}

const sample = curve(ROUTINE);

const PAIRS = [['legL', 'legR'], ['kneeL', 'kneeR'], ['swingL', 'swingR'], ['outL', 'outR'], ['twistL', 'twistR'], ['elbowL', 'elbowR']] as const;
const SIDEWAYS = ['yaw', 'roll', 'sway', 'leanZ', 'twist', 'tilt', 'headYaw'] as const;

/** The same pose the other way round: left for right, and every lean, turn and shift reversed. */
export function mirror(p: Pose) {
  for (const [l, r] of PAIRS) {
    const v = p[l];
    p[l] = p[r];
    p[r] = v;
  }
  for (const f of SIDEWAYS) p[f] = -p[f];
}

/**
 * Where in the loop the dancers change sides: both hands on the hips, a pose the same either way
 * round, so the swap never shows.
 */
const SWAP = 0.93;

/**
 * The stage routine, danced by the DJ and both backup dancers together, with the recording's
 * straight face. `t` is how far into it they are, in seconds at its own pace (LOOP to a time
 * round); the crowd sets it from the music's beat. Every other time round it is danced the other
 * way round, so the pivot goes right, then left, then right.
 */
export const idol: Clip = (p, t) => {
  const u = t / LOOP;
  sample(p, u);
  p.expr = 0;
  if (Math.floor(u + 1 - SWAP) % 2 === 1) mirror(p);
};

// Solos: now and then one dancer breaks off the routine for a move of their own, then falls back
// in. Each is keyed by beats, not seconds, so it lands on the music, and comes back round every
// so many beats (2 or 4) so it ends where the routine picks up. For each, `t` is beats since it
// began. Left and right are the dancer's own; the crowd mirrors a whole solo at random.

/** A key and the same key the other way round, as a whole pose. */
function flip(key: Key): Pose {
  const p = {} as Pose;
  neutral(p);
  Object.assign(p, key);
  mirror(p);
  return p;
}

/** Both hands on the hips, as the routine measured them. */
const HIPS: Key = { outR: 0.72, swingR: -0.39, twistR: 0.89, elbowR: 1.87, outL: 0.72, swingL: -0.39, twistL: 0.89, elbowL: 1.87 };
const HIP_L: Key = { outL: 0.72, swingL: -0.39, twistL: 0.89, elbowL: 1.87 };
const HIP_R: Key = { outR: 0.72, swingR: -0.39, twistR: 0.89, elbowR: 1.87 };

/** The dab: the face buried in the crook of the left elbow, the right arm flung straight up and out. */
const DAB: Key = {
  crouch: 0.14, spread: 0.22, leanX: 0.12, leanZ: 0.14, twist: 0.16, nod: 0.4, headYaw: 0.32, tilt: 0.1,
  outR: 2.0, swingR: 0.12, twistR: 0, elbowR: 0.02,
  outL: 1.5, swingL: 0.75, twistL: 0.3, elbowL: 2.15,
};
/** Gathering for the next one: hands crossed low, knees bent. */
const GATHER: Key = { crouch: 0.24, spread: 0.18, leanX: 0.06, nod: 0.08, outR: -0.1, swingR: 0.35, twistR: 1.3, elbowR: 0.5, outL: -0.1, swingL: 0.35, twistL: 1.3, elbowL: 0.5 };
const dabMove = curve([
  [0.0, DAB],
  [0.3, { ...DAB, crouch: 0.18, nod: 0.44 }],
  [0.42, GATHER],
  [0.5, flip(DAB)],
  [0.8, flip({ ...DAB, crouch: 0.18, nod: 0.44 })],
  [0.92, GATHER],
]);
/** Dab on the one, the other way on the three. 4 beats. */
export const dab: Clip = (p, t) => {
  dabMove(p, t / 4);
};

/** The disco point: up to the corner of the ceiling, then down across to the floor, hips popping. */
const POINT_UP: Key = {
  ...HIP_L, crouch: 0.06, sway: 0.34, leanZ: -0.1, kneeR: 0.28, legR: 0.08, headYaw: -0.3, nod: -0.24, tilt: -0.06,
  outR: 2.45, swingR: 0.45, twistR: 0, elbowR: 0.03,
};
const POINT_DOWN: Key = {
  ...HIP_L, crouch: 0.17, sway: -0.3, leanZ: 0.1, leanX: 0.06, kneeL: 0.28, headYaw: 0.24, nod: 0.3,
  outR: -0.4, swingR: 0.55, twistR: 1.2, elbowR: 0.05,
};
const discoMove = curve([
  [0.0, POINT_UP],
  [0.22, POINT_UP],
  [0.5, POINT_DOWN],
  [0.72, POINT_DOWN],
]);
/** Up on the beat, down on the next. 2 beats. */
export const disco: Clip = (p, t) => {
  discoMove(p, t / 2);
  p.expr = 2;
};

/** The robot: four stiff poses, each snapped to on its beat and held dead still until the next. */
const BOX: Key = { crouch: 0.05, outR: 0.18, elbowR: 1.57, outL: 0.18, elbowL: 1.57 };
const SIGNAL: Key = { crouch: 0.08, twist: -0.18, headYaw: -0.55, outR: 1.45, twistR: -1.5, elbowR: 1.57, outL: 1.45, twistL: 1.5, elbowL: 1.57 };
const REACH: Key = { crouch: 0.12, nod: 0.14, outR: 0.1, swingR: 1.5, elbowR: 0.03, outL: 0.1, swingL: 1.5, elbowL: 0.03 };
/** How far into a beat each snap takes, as a share of the whole move. */
const SNAP = 0.06;
const robotMove = curve([
  [0.0, REACH],
  [SNAP, BOX],
  [0.25, BOX],
  [0.25 + SNAP, SIGNAL],
  [0.5, SIGNAL],
  [0.5 + SNAP, flip(SIGNAL)],
  [0.75, flip(SIGNAL)],
  [0.75 + SNAP, REACH],
]);
/** A pose a beat, deadpan. 4 beats. */
export const robot: Clip = (p, t) => {
  robotMove(p, t / 4);
};

/** The running man: a knee up on the off beat, the foot down and the other sliding back on the beat. */
const STRIDE: Key = {
  yaw: -0.55, crouch: 0.14, leanX: 0.08, legR: 0.32, kneeR: 0.12, legL: -0.36, kneeL: 0.32,
  swingR: -0.2, twistR: 0.3, elbowR: 1.35, swingL: 0.6, twistL: 0.3, elbowL: 1.35,
};
const KNEE: Key = {
  yaw: -0.55, crouch: 0.03, y: 0.03, leanX: 0.05, legR: -0.1, kneeR: 0.08, legL: 1.3, kneeL: 1.7,
  swingR: 0.7, twistR: 0.3, elbowR: 1.4, swingL: -0.3, twistL: 0.3, elbowL: 1.4,
};
/** The other foot, still turned the same way (a knee coming straight at you is lost). */
const other = (key: Key): Pose => Object.assign(flip(key), { yaw: key.yaw });
const runningMove = curve([
  [0.0, STRIDE],
  [0.25, KNEE],
  [0.5, other(STRIDE)],
  [0.75, other(KNEE)],
]);
/** A step a beat, turned three quarters on so the knees show. 2 beats. */
export const runningMan: Clip = (p, t) => {
  runningMove(p, t / 2);
  p.expr = 2;
};

/** The twirl: wound up low, a full turn on the spot with arms out, and a V with a wink to finish. */
const twirlMove = curve([
  [0.0, { crouch: 0.26, twist: 0.35, headYaw: 0.2, outR: 0.15, swingR: 0.5, twistR: 1.1, elbowR: 1.7, outL: 0.15, swingL: 0.5, twistL: 1.1, elbowL: 1.7 }],
  [0.2, { crouch: 0.3, twist: 0.38, headYaw: 0.22, outR: 0.15, swingR: 0.5, twistR: 1.1, elbowR: 1.75, outL: 0.15, swingL: 0.5, twistL: 1.1, elbowL: 1.75 }],
  [0.32, { crouch: 0.04, y: 0.05, outR: 1.3, elbowR: 0.15, outL: 1.3, elbowL: 0.15 }],
  [0.55, { crouch: 0.02, y: 0.08, leanZ: 0.05, nod: -0.08, outR: 1.38, elbowR: 0.15, outL: 1.38, elbowL: 0.15 }],
  [0.66, { crouch: 0.14, spread: 0.3, nod: -0.12, outR: 2.5, swingR: 0.2, elbowR: 0.1, outL: 2.5, swingL: 0.2, elbowL: 0.1 }],
  [0.88, { crouch: 0.1, spread: 0.3, nod: -0.1, outR: 2.45, swingR: 0.2, elbowR: 0.12, outL: 2.45, swingL: 0.2, elbowL: 0.12 }],
]);
/** Once round a beat and a half after winding up, then the pose. 4 beats. */
export const twirl: Clip = (p, t) => {
  const u = (((t / 4) % 1) + 1) % 1;
  twirlMove(p, u);
  // Wound a little the other way first, then all the way round, quickest in the middle.
  const turn = 0.5 * ramp(u, 0, 0.2) - (TAU + 0.5) * ramp(u, 0.24, 0.62);
  p.yaw = turn - TAU * Math.round(turn / TAU);
  p.expr = u > 0.64 && u < 0.92 ? 6 : 2;
};

/** Kicks: hands on the hips, a high kick on every beat, left then right. */
const KICK: Key = { ...HIPS, yaw: -0.5, y: 0.05, leanX: -0.12, nod: -0.05, sway: -0.08, legL: 1.6, kneeL: 0.04, kneeR: 0.08 };
const LAND: Key = { ...HIPS, yaw: -0.5, crouch: 0.14, sway: -0.04, legL: 0.1, kneeL: 0.35 };
const SET: Key = { ...HIPS, yaw: -0.5, crouch: 0.12 };
const kickMove = curve([
  [0.0, KICK],
  [0.18, LAND],
  [0.25, SET],
  [0.5, other(KICK)],
  [0.68, other(LAND)],
  [0.75, SET],
]);
/** Turned three quarters on so the kicks show. 2 beats. */
export const kicks: Clip = (p, t) => {
  kickMove(p, t / 2);
  p.expr = 2;
};

/** Raise the roof: palms pushed up on the beat from beside the head, hips swinging side to side. */
const PUSH: Key = { crouch: 0.02, sway: 0.2, leanZ: -0.05, nod: -0.15, outR: 2.3, swingR: 0.15, twistR: -1.5, elbowR: 0.5, outL: 2.3, swingL: 0.15, twistL: -1.5, elbowL: 0.5 };
const READY: Key = { crouch: 0.16, nod: 0.05, outR: 1.45, twistR: -1.5, elbowR: 1.7, outL: 1.45, twistL: -1.5, elbowL: 1.7 };
const roofMove = curve([
  [0.0, PUSH],
  [0.25, READY],
  [0.5, flip(PUSH)],
  [0.75, READY],
]);
/** 2 beats. */
export const roof: Clip = (p, t) => {
  roofMove(p, t / 2);
  p.expr = 2;
};

/** Where in its beat `t` is, 0 on the beat to 1 just before the next. */
const within = (t: number) => ((t % 1) + 1) % 1;
/** 0 to 1 over [a, b], straight. */
const lin = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/**
 * The horse dance: wrists crossed in front as if on the reins, galloping from foot to foot with a
 * bounce on every beat, then the right hand swings a lasso round over the head. 8 beats.
 */
export const gangnam: Clip = (p, t) => {
  const u = within(t / 8);
  const hit = pulse(t);
  const air = sin(within(t) * Math.PI);
  // Two hops on one foot, then two on the other.
  const s = sin((t * Math.PI) / 2);
  const onL = clamp01(0.5 + s * 1.5);
  p.legL = air * 0.55 * (1 - onL);
  p.kneeL = 0.12 + air * 0.95 * (1 - onL);
  p.legR = air * 0.55 * onL;
  p.kneeR = 0.12 + air * 0.95 * onL;
  p.y = air * 0.05;
  p.crouch = 0.14 + hit * 0.07;
  p.sway = s * 0.12;
  p.leanX = -0.04;
  p.nod = -0.05 + hit * 0.04;
  p.swingL = p.swingR = 0.95;
  p.outL = p.outR = -0.12;
  p.twistL = p.twistR = 1.15;
  p.elbowL = p.elbowR = 1.4 + hit * 0.12;
  // The lasso, one turn a beat, over the second half.
  const lasso = ramp(u, 0.46, 0.53) * (1 - ramp(u, 0.94, 1));
  const a = t * TAU;
  p.outR = mix(p.outR, 2.65 + cos(a) * 0.18, lasso);
  p.swingR = mix(p.swingR, 0.25 + sin(a) * 0.25, lasso);
  p.twistR = mix(p.twistR, -0.6, lasso);
  p.elbowR = mix(p.elbowR, 0.5, lasso);
  p.headYaw = -0.15 * lasso;
  p.expr = 2;
};

/** How far the moonwalk glides each way, in world units. */
const MOON = 0.45;
/**
 * The moonwalk: side on, gliding backwards a step a beat, one foot flat and sliding back while
 * the other rests on its toes, then round the other way to glide back, and up on the toes facing
 * you, a hand at the hat, to finish. Where it has glided to is `moonSlide`. 8 beats.
 */
export const moonwalk: Clip = (p, t) => {
  const u = within(t / 8);
  const glide = ramp(u, 0.03, 0.07) * (1 - ramp(u, 0.44, 0.48)) + ramp(u, 0.52, 0.56) * (1 - ramp(u, 0.86, 0.9));
  const toes = ramp(u, 0.9, 0.95) * (1 - ramp(u, 0.985, 1));
  p.yaw = (-Math.PI / 2) * ramp(u, 0, 0.06) + Math.PI * ramp(u, 0.45, 0.55) - (Math.PI / 2) * ramp(u, 0.88, 0.94);
  // Each leg in turn: flat and sliding back for a beat, then resting bent on its toes for one.
  const leg = (q: number) => {
    if (q < 1) {
      const e = smooth(q / 0.15);
      return [mix(-0.05, mix(0.15, -0.25, q), e), mix(0.55, 0.05, e)];
    }
    const e = smooth((q - 1) / 0.15);
    return [mix(-0.25, -0.05, e), mix(0.05, 0.55, e)];
  };
  const q = within(t / 2) * 2;
  const [legL, kneeL] = leg(q);
  const [legR, kneeR] = leg((q + 1) % 2);
  p.legL = legL * glide;
  p.kneeL = kneeL * glide;
  p.legR = legR * glide;
  p.kneeR = kneeR * glide;
  const step = sin(t * Math.PI);
  p.crouch = 0.06 * glide;
  p.leanX = 0.05 * glide;
  p.nod = 0.05 * glide - 0.1 * toes;
  p.swingL = step * 0.15 * glide;
  p.swingR = -step * 0.15 * glide;
  p.elbowL = 0.16 + 0.5 * glide;
  p.elbowR = 0.16 + 0.5 * glide;
  // Up on the toes, the right hand at the brim of a hat.
  p.y += 0.05 * toes;
  p.spread = -0.03 * toes;
  p.outR = mix(p.outR, 1.25, toes);
  p.swingR = mix(p.swingR, 0.4, toes);
  p.twistR = mix(p.twistR, -1.4, toes);
  p.elbowR = mix(p.elbowR, 2.3, toes);
  p.outL = mix(p.outL, 0.35, toes);
  p.expr = toes > 0.5 ? 6 : 0;
};

/** How far the moonwalk has glided toward the dancer's own left, `t` beats into it, in world units. */
export function moonSlide(t: number) {
  const u = within(t / 8);
  return MOON * (lin(u, 0.06, 0.45) - lin(u, 0.55, 0.88));
}

/** Both hands clawed and up off to the left, a foot dragging. */
const CLAW: Key = {
  twist: 0.3, leanZ: 0.1, leanX: 0.06, tilt: -0.16, headYaw: 0.25, crouch: 0.12, spread: 0.22, kneeR: 0.3, legR: -0.1,
  outL: 1.85, swingL: 0.3, twistL: -1.2, elbowL: 1.2,
  outR: -0.2, swingR: 1.45, twistR: 1.0, elbowR: 1.0,
};
const thrillerMove = curve([
  [0.0, CLAW],
  [0.42, CLAW],
  [0.5, flip(CLAW)],
  [0.92, flip(CLAW)],
]);
/** Thriller's zombies: claws up to the left, the claws and the head jerking on every beat, then over to the right. 8 beats. */
export const thriller: Clip = (p, t) => {
  const u = within(t / 8);
  thrillerMove(p, u);
  const jerk = pulse(t) ** 2;
  const side = u < 0.46 ? 1 : -1;
  p.elbowL += jerk * 0.3;
  p.elbowR += jerk * 0.3;
  p.nod += jerk * 0.1;
  p.headYaw += side * jerk * 0.12;
  p.crouch += jerk * 0.05;
  p.expr = 4;
};

// The polka: the Ievan Polkka dance from Hatsune Miku's Project DIVA video for the song, danced by
// all three on stage together in place of the routine. Its eight phrases of eight beats come in
// the video's order, read off it beat by beat wherever the camera shows the whole body: hands on
// the hips swaying, arms flung open, waving, the leek twirl, flapping and pointing, arms up over
// the head, pointing off to either side, then a turn to show the back, a kick and a big wave. `t`
// is beats into it. Left and right are the dancer's own.

/** Beats a time through the polka takes. */
export const POLKA_BEATS = 64;
/**
 * How long a bar of four beats takes at the video's own pace, 119 beats a minute. To music it is
 * fitted to the beat at the nearest pace to this (plaza/beat.ts).
 */
export const POLKA_BAR = (4 * 60) / 119;

/** Arms flung open wide and low, palms up. */
const OPEN: Key = { crouch: 0.08, nod: -0.06, outR: 0.95, swingR: 0.3, twistR: -0.3, elbowR: 0.35, outL: 0.95, swingL: 0.3, twistL: -0.3, elbowL: 0.35 };
/** Both arms swept over to the left, the right reaching across the chest, the body turning with them. */
const SWEEP: Key = {
  yaw: 0.3, twist: 0.3, headYaw: 0.15, crouch: 0.16, sway: 0.08, leanZ: 0.04,
  outR: -1.2, swingR: 1.0, twistR: 0.3, elbowR: 0.35, outL: 1.15, swingL: 0.45, twistL: 0, elbowL: 0.3,
};
/** One side of the wave: the right forearm up beside the head, palm out, the left arm down and out. */
const WAVE: Key = {
  crouch: 0.1, sway: 0.05, leanZ: -0.06, tilt: 0.06,
  outR: 1.55, swingR: 0.1, twistR: -1.45, elbowR: 1.6, outL: 0.7, swingL: 0.15, twistL: 0.2, elbowL: 0.2,
};
/** The leek held out to the right, twirling clear of the face, the left hand on the hip. */
const LEEK_OUT: Key = { ...HIP_L, yaw: 0.15, crouch: 0.12, headYaw: -0.1, outR: 1.1, swingR: 0.8, twistR: -0.3, elbowR: 0.4 };
/** Twirled in close in front of the chest. */
const LEEK_IN: Key = { ...HIP_L, yaw: 0.1, crouch: 0.16, nod: 0.05, outR: 0.35, swingR: 0.85, twistR: 0.5, elbowR: 1.25 };
/** Thrown up high. */
const LEEK_UP: Key = { ...HIP_L, yaw: 0.1, crouch: 0.04, nod: -0.12, outR: 2.0, swingR: 0.2, twistR: -0.6, elbowR: 0.15 };
/** Flapping: the right arm up and bent, the left straight out to the side. */
const FLAP: Key = {
  crouch: 0.1, sway: 0.05, leanZ: -0.04,
  outR: 1.9, swingR: 0.15, twistR: -1.4, elbowR: 1.3, outL: 1.35, swingL: 0.15, twistL: 0, elbowL: 0.15,
};
/** Hands brought in to the chest. */
const CHEST: Key = { crouch: 0.14, nod: 0.06, outR: 0.15, swingR: 0.6, twistR: 1.2, elbowR: 2.0, outL: 0.15, swingL: 0.6, twistL: 1.2, elbowL: 2.0 };
/** Fists up beside the shoulders, pointing at the sky. */
const SKY: Key = { crouch: 0.06, nod: -0.1, outR: 1.0, swingR: 0.25, twistR: -1.2, elbowR: 2.0, outL: 1.0, swingL: 0.25, twistL: -1.2, elbowL: 2.0 };
/** Both arms straight, down and out to either side, pointing at the floor. */
const FLOOR: Key = { crouch: 0.12, nod: 0.04, outR: 0.8, swingR: 0.35, twistR: 0, elbowR: 0.05, outL: 0.8, swingL: 0.35, twistL: 0, elbowL: 0.05 };
/** Both arms up over the head, a little bent, palms forward (wide enough to show past a Mii's big head). */
const OVER: Key = { crouch: 0.06, nod: -0.1, outR: 2.2, swingR: 0.1, twistR: -0.4, elbowR: 0.25, outL: 2.2, swingL: 0.1, twistL: -0.4, elbowL: 0.25 };
/** Both arms pointing off to the left, the body turned and stepping that way. */
const AWAY: Key = {
  yaw: 0.45, twist: 0.2, headYaw: 0.2, crouch: 0.12, spread: 0.22, sway: 0.1,
  outR: -1.35, swingR: 1.0, twistR: 0.3, elbowR: 0.12, outL: 1.5, swingL: 0.2, twistL: 0, elbowL: 0.05,
};
/** The left arm up high for a big wave, the right hand on the hip. */
const BYE: Key = { ...HIP_R, crouch: 0.08, sway: -0.05, leanZ: 0.04, tilt: -0.06, outL: 1.7, swingL: 0.1, twistL: -1.5, elbowL: 1.2 };
const ON_HIPS: Key = { ...HIPS, crouch: 0.1 };

/** Keyed by beat, 0 to POLKA_BEATS. Each pose lands on its beat and holds a moment before the next. */
const POLKA: [number, Key | Pose][] = [
  // Hands on the hips, swaying on every beat (the sway is added in `polka`).
  [0, ON_HIPS],
  [7.4, ON_HIPS],
  // Arms flung open, swept over to the left, open again, hands on the hips; then to the right.
  [8, OPEN], [8.55, OPEN], [9, SWEEP], [9.55, SWEEP], [10, OPEN], [10.55, OPEN], [11, ON_HIPS], [11.55, ON_HIPS],
  [12, OPEN], [12.55, OPEN], [13, flip(SWEEP)], [13.55, flip(SWEEP)], [14, OPEN], [14.55, OPEN], [15, ON_HIPS], [15.5, ON_HIPS],
  // Waving: one forearm up and the other arm down, changing sides every other beat.
  [16, WAVE], [17.5, WAVE], [18, flip(WAVE)], [19.5, flip(WAVE)],
  [20, WAVE], [21.5, WAVE], [22, flip(WAVE)], [23.4, flip(WAVE)],
  // The leek (shown by plaza/leek.ts): held out twirling, then twirled in close and thrown up high by turns.
  [24, LEEK_OUT], [27.5, LEEK_OUT],
  [28, LEEK_IN], [28.55, LEEK_IN], [29, LEEK_UP], [29.55, LEEK_UP],
  [30, LEEK_IN], [30.55, LEEK_IN], [31, LEEK_UP], [31.5, LEEK_UP],
  // Arms open low, flapping, hands in to the chest, pointing at the sky, then at the floor either side.
  [32, OPEN], [32.55, OPEN], [33, FLAP], [33.5, FLAP], [34, flip(FLAP)], [34.5, flip(FLAP)], [35, FLAP], [35.4, FLAP],
  [35.8, CHEST], [36.2, SKY], [37.6, SKY], [38, FLOOR], [39.5, FLOOR],
  // Arms up over the head, swaying (added in `polka`).
  [40, OVER],
  [47.4, OVER],
  // Pointing off to the left with a step that way, then to the right, twice over.
  [48, AWAY], [49.5, AWAY], [50, flip(AWAY)], [51.5, flip(AWAY)],
  [52, AWAY], [53.5, AWAY], [54, flip(AWAY)], [55.5, flip(AWAY)],
  // Hands on the hips, turned round to show the back (the turn is added in `polka`), a kick
  // back, round to the front again and a big wave, then back to the hips to begin again.
  [56, ON_HIPS], [57.8, { ...HIPS, crouch: 0.14 }],
  [58.2, { ...HIPS, crouch: 0.02, leanX: 0.12, legL: -0.75, kneeL: 0.5 }],
  [58.7, { ...HIPS, crouch: 0.12 }], [59.6, ON_HIPS],
  [60.2, BYE], [63.4, BYE],
];
const polkaMove = curve(POLKA.map(([b, key]) => [b / POLKA_BEATS, key]));
/** The face in each phrase: the video's straight face, or smiling. */
const POLKA_FACE = [0, 2, 2, 0, 2, 2, 0, 2] as const;

export const polka: Clip = (p, t) => {
  const b = within(t / POLKA_BEATS) * POLKA_BEATS;
  polkaMove(p, b / POLKA_BEATS);
  /** All of it from half a beat into [a, z] until half a beat before its end, eased in and out. */
  const during = (a: number, z: number) => ramp(b, a, a + 0.5) * (1 - ramp(b, z - 0.5, z));
  // Knees giving on every beat all the way through.
  p.crouch += pulse(b) * 0.05;
  // Swaying with the beat, hips one way and head the other: on the hips, under the arms up over
  // the head (which lean with it), and with the back turned.
  const s = cos(b * Math.PI) * (during(0, 8) + 1.1 * during(40, 48) + 0.8 * during(56, 59.6));
  p.sway += s * 0.15;
  p.leanZ -= s * 0.07;
  p.tilt += s * 0.16;
  const over = during(40, 48);
  p.outL += s * 0.3 * over;
  p.outR -= s * 0.3 * over;
  // The raised hand of the wave waggling.
  const waggle = sin(b * TAU) * 0.12 * during(16, 24);
  p.twistR += waggle;
  p.twistL -= waggle;
  // The hand holding the leek out circling as it twirls.
  const twirl = during(24, 28);
  p.outR += sin(b * TAU) * 0.1 * twirl;
  p.swingR += cos(b * TAU) * 0.1 * twirl;
  // Stepping off to the side pointed at: the trailing knee comes up between beats.
  const step = sin(within(b) * Math.PI) * during(48, 56);
  const left = Math.floor((b - 48) / 2) % 2 === 0;
  p.kneeR += step * (left ? 0.45 : 0);
  p.kneeL += step * (left ? 0 : 0.45);
  p.y += step * 0.02;
  // Turned round to show the back, and on round to the front.
  const turn = Math.PI * (ramp(b, 56.1, 56.9) + ramp(b, 59.4, 60.2));
  p.yaw += turn - TAU * Math.round(turn / TAU);
  // The big wave: the forearm swinging from side to side across two beats.
  const bye = cos(b * Math.PI) * during(60.2, 64);
  p.outL += bye * 0.1;
  p.twistL += bye * 0.45;
  p.sway += bye * 0.05;
  p.expr = POLKA_FACE[Math.floor(b / 8)];
};

/**
 * The leek in each dancer's right hand `t` beats into the polka: how much of it shows (0 to 1),
 * growing out of the fist as the twirl begins and back in as it ends, and how far it has turned
 * about the forearm (radians), once round a beat. On each beat it points away from the thumb,
 * which keeps it clear of the face when the hand is held up high or in close.
 */
export function leek(t: number, out: { show: number; spin: number }) {
  const b = within(t / POLKA_BEATS) * POLKA_BEATS;
  out.show = ramp(b, 23.5, 24) * (1 - ramp(b, 31.6, 32));
  out.spin = (b + 0.5) * TAU;
  return out;
}

// The Tetoris spin: Kasane Teto's dance in Hiiragi Magnetite's video for the song, danced by the
// three on stage all the way through it. Read off the video frame by frame, it is one move from
// the first verse to the last chorus: once round to her right on every beat, facing you on the
// beat and lingering a moment front and back, singing into a mic held at her mouth in her left
// hand, the right arm thrown up and out over her head and pumping once a turn, the left knee
// lifted as she pivots on the right foot. `t` is turns into it. Left and right are the dancer's own.

/** How long a turn takes at the video's own pace, a beat at 85 a minute. */
export const TETO_TURN = 60 / 85;
/** How much the turn slows facing front and back (and hurries past side on), 0 for an even turn. */
const LINGER = 0.2;

/**
 * The mic up at the mouth in the left hand, the right arm thrown up and out: straight and on the
 * diagonal, a little forward, as in the video, which on a Mii's short arms is also the one way the
 * hand clears the big head and hair rather than getting lost beside them.
 */
const SING: Key = {
  crouch: 0.06, leanX: -0.03, nod: -0.06,
  swingL: 1.0, outL: 0.38, twistL: 0.45, elbowL: 2.2,
  outR: 2.2, swingR: 0.3, twistR: -0.3, elbowR: 0.12,
};

/** The spin. A turn a beat. */
export const tetoris: Clip = (p, t) => {
  Object.assign(p, SING);
  const u = within(t);
  // Up on the right foot, the left knee lifted, a little bounce as each turn begins.
  const hit = pulse(t);
  p.kneeL = 1.05;
  p.legL = 0.18;
  p.kneeR = 0.08 + hit * 0.12;
  p.crouch += hit * 0.06;
  p.y = (1 - hit) * 0.025;
  // The raised arm pumps once a turn: bent in as she comes round to face you, flung up after.
  const pump = fold(cos((u + 0.08) * TAU));
  p.elbowR += pump * 0.45;
  p.outR -= pump * 0.1;
  // Swaying a touch with the turn, head the other way.
  const sway = sin(u * TAU);
  p.tilt += sway * 0.08;
  p.leanZ -= sway * 0.03;
  // Turning to her right: a whole turn a beat, slowest square on and back on.
  const turn = -(u * TAU - LINGER * sin(u * 2 * TAU));
  p.yaw = turn - TAU * Math.round(turn / TAU);
  p.expr = 2;
};

/** Where she stops: square on, the mic at the mouth and the arm up, swaying gently. `t` is seconds. */
export const tetoPose: Clip = (p, t) => {
  Object.assign(p, SING);
  const breath = sin(t * 2.4);
  p.tilt += breath * 0.05;
  p.elbowR += 0.15 + breath * 0.08;
  p.expr = 2;
};

/** Every solo, by name. */
export const SOLOS ={ dab, disco, robot, runningMan, twirl, kicks, roof, gangnam, moonwalk, thriller } as const;
export type SoloName = keyof typeof SOLOS;
const SOLO_SET = new Set<Clip>(Object.values(SOLOS));
/** Beats a solo takes to come round, for those longer than 4, so it is always danced to the end. */
const LONG = new Map<Clip, number>([
  [gangnam, 8],
  [moonwalk, 8],
  [thriller, 8],
]);
/** Beats `clip` takes to come round: a solo always ends where it began. */
export const soloBeats = (clip: Clip) => LONG.get(clip) ?? 4;
/** Whether a clip is one of the stage's dances: the routine, the polka, the Tetoris spin or a solo. */
export const dancing = (clip: Clip) => stageDance(clip) || SOLO_SET.has(clip);
/** Whether a clip is one the whole stage dances together (and the fans with it): the routine, the polka or the Tetoris spin. */
export const stageDance = (clip: Clip) => clip === idol || clip === polka || clip === tetoris || clip === tetoPose;

// Cheers: the crowd watching the stage, along with the music. For each, `t` is beats gone by
// (whole on the beat), so everyone watching keeps the same beat, and `k` the Mii's own number.

/** Clapping along, hands meeting on every beat, knees giving with it. */
export const clapAlong: Clip = (p, t) => {
  const open = 1 - pulse(t);
  p.swingL = p.swingR = 0.62;
  p.outL = p.outR = 0.03 + open * 0.12;
  p.twistL = p.twistR = 0.97 - open * 0.42;
  p.elbowL = p.elbowR = 1.56 - open * 0.12;
  p.crouch = 0.03 + (1 - open) * 0.05;
  p.nod = 0.03 - open * 0.05;
  p.leanX = 0.04;
  p.expr = 2;
};

/** A fist punched up on every beat (the right, or the left for half of them), a little hop with it. */
export const fistPump: Clip = (p, t, k) => {
  const hit = pulse(t);
  p.outR = mix(1.5, 2.65, hit);
  p.swingR = 0.25;
  p.twistR = mix(-1.5, -0.4, hit);
  p.elbowR = mix(1.7, 0.2, hit);
  p.outL = 0.2;
  p.elbowL = 0.5;
  p.y = hit * 0.035;
  p.crouch = (1 - hit) * 0.06;
  p.nod = -0.08 * hit;
  p.expr = 2;
  if (k < 0.5) mirror(p);
};

/** Both arms up, swaying over the head from side to side across two beats, as with penlights. */
export const penlight: Clip = (p, t, k) => {
  const s = sin(t * Math.PI + k * 0.4);
  const hit = pulse(t);
  p.outL = 2.35 + s * 0.4;
  p.outR = 2.35 - s * 0.4;
  p.swingL = p.swingR = 0.3;
  p.elbowL = p.elbowR = 0.22;
  p.sway = s * 0.25;
  p.leanZ = -s * 0.07;
  p.tilt = s * 0.08;
  p.crouch = 0.02 + hit * 0.04;
  p.nod = -0.12;
  p.expr = 2;
};

/** Jumping on the spot, up between beats and landing on them, both fists up. */
export const jumpAlong: Clip = (p, t) => {
  const air = sin(within(t) * Math.PI);
  const land = pulse(t);
  p.y = air * 0.13;
  p.crouch = land * 0.1;
  p.outL = p.outR = 2.4 + air * 0.2;
  p.twistL = p.twistR = -0.5;
  p.elbowL = p.elbowR = 0.6 - air * 0.3;
  p.kneeL = p.kneeR = air * 0.2;
  p.nod = -0.1;
  p.expr = 2;
};

/** Hands cupped round the mouth, calling out on every beat. */
export const callOut: Clip = (p, t, k) => {
  const hit = pulse(t);
  p.swingL = p.swingR = 0.85;
  p.outL = p.outR = 0.28;
  p.twistL = p.twistR = 1.1;
  p.elbowL = p.elbowR = 2.25;
  p.leanX = 0.06 + hit * 0.08;
  p.nod = -0.12 + hit * 0.06;
  p.crouch = hit * 0.06;
  p.tilt = sin(t * 0.5 + k * 6) * 0.06;
  p.expr = 3;
};

/** Just nodding along, weight going from foot to foot. */
export const nodAlong: Clip = (p, t, k) => {
  const hit = pulse(t);
  const s = sin(t * Math.PI + k * 3);
  p.nod = 0.02 + hit * 0.12;
  p.crouch = hit * 0.045;
  p.sway = s * 0.16;
  p.leanZ = -s * 0.03;
  p.swingL = s * 0.08;
  p.swingR = -s * 0.08;
  p.elbowL = p.elbowR = 0.3;
  p.kneeL = Math.max(0, s) * 0.12;
  p.kneeR = Math.max(0, -s) * 0.12;
};

/** Going wild for a solo: jumping, both arms waving over the head, mouth open. */
export const hype: Clip = (p, t, k) => {
  const air = sin(within(t) * Math.PI);
  const a = sin(t * TAU + k * 4);
  p.y = air * 0.11;
  p.crouch = pulse(t) * 0.08;
  p.outL = 2.35 + a * 0.35;
  p.outR = 2.35 - a * 0.35;
  p.swingL = p.swingR = 0.2;
  p.elbowL = 0.35 + fold(a) * 0.5;
  p.elbowR = 0.35 + fold(-a) * 0.5;
  p.twistL = p.twistR = -0.5;
  p.nod = -0.14;
  p.expr = 3;
};

/** The cheers the crowd picks from, and how often each comes up against the others. */
export const CHEERS: readonly [Clip, number][] = [
  [clapAlong, 3],
  [penlight, 2],
  [fistPump, 2],
  [nodAlong, 2],
  [jumpAlong, 1.5],
  [callOut, 1],
];
const CHEER_SET = new Set<Clip>([...CHEERS.map(([c]) => c), hype]);
/** Whether a clip is one of the crowd's cheers. */
export const cheering = (clip: Clip) => CHEER_SET.has(clip);
/** Whether a clip keeps time by beats (a solo or a cheer) rather than seconds. */
export const onBeat = (clip: Clip) => SOLO_SET.has(clip) || CHEER_SET.has(clip);

/**
 * A boombox up on the left shoulder (a headset's mic is on the right), over whatever else the
 * body is doing: the upper arm out level, the forearm folded back up beside the head, which tips
 * away to make room. `w` eases it on and off (1 holds it).
 */
export function carry(p: Pose, w = 1) {
  p.swingL = mix(p.swingL, 0.12, w);
  p.outL = mix(p.outL, 1.45, w);
  p.twistL = mix(p.twistL, -1.5, w);
  p.elbowL = mix(p.elbowL, 1.15, w);
  p.tilt += 0.08 * w;
}

/** How long the clips that end on their own last, in seconds. */
export const LENGTH = { land: 0.75, thanks: 1.15, wave: 1.8, hop: 1.2, gaze: 2.8, hello: 2.2, stunned: 0.8, shock: 1.6, faint: 3.2, wink: 1.4 } as const;


/** Moves every joint of `p` toward `to` by `w`. The face snaps once it is past halfway. */
export function blend(p: Pose, to: Pose, w: number) {
  for (const f of FIELDS) p[f] += (to[f] - p[f]) * w;
  if (w > 0.5) p.expr = to.expr;
}

export function copyJoints(from: Pose, to: Pose) {
  for (const f of FIELDS) to[f] = from[f];
  to.expr = from.expr;
}
