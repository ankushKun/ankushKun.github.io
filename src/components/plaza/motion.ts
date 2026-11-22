// What a Mii's body does: every clip writes joint angles for one moment. Where a Mii stands and
// which way it faces belongs to the crowd; clips only touch height, joints and the face.
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
/** For a value swinging between -1 and 1: 0 at the bottom, 1 at the top, smooth all the way, with no corner where it turns. */
const fold = (v: number) => ((1 + v) / 2) ** 2;

/** Arms hanging and legs straight: the base every clip starts from. */
export function neutral(p: Pose) {
  p.y = 0;
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
 * Beats a second for everything that moves to the music. YouTube's sound plays in a frame of its
 * own, out of the page's reach, so this keeps its own steady time.
 */
export const TEMPO = 112 / 60;

/** Where `t` seconds falls in the beat: 1 on it, easing to 0 halfway to the next. */
export const onBeat = (t: number) => fold(cos(t * TAU * TEMPO));

/** Bobbing to the music: knees and head on every beat, hips swaying over two, the free hand keeping time. */
export const groove: Clip = (p, t) => {
  const into = ramp(t, 0, 0.5);
  const bob = onBeat(t);
  const s = sin(t * Math.PI * TEMPO);
  p.crouch = (0.02 + bob * 0.08) * into;
  p.nod = (0.02 + bob * 0.09) * into;
  p.sway = s * 0.3 * into;
  p.leanZ = -s * 0.04 * into;
  p.tilt = s * 0.07 * into;
  p.swingR = (0.2 + bob * 0.2) * into;
  p.elbowR = mix(0.16, 1 + bob * 0.35, into);
  p.twistR = 0.45 * into;
  p.expr = 2;
};

/**
 * Backup dancing beside the DJ, on the same beat: a step from side to side on every beat with a
 * bounce in the knees, the arms punching up and out in turn; then, for a bar out of every two, the
 * outside arm thrown up, pumping on the beat, and the other hand on the hip. `k` below a half is
 * the dancer on the left as you look, above it the one on the right, so the two mirror each other.
 */
export const idol: Clip = (p, t, k) => {
  const into = ramp(t, 0, 0.5);
  const beats = t * TEMPO;
  const bob = onBeat(t);
  const step = sin(beats * Math.PI);
  // Eases from punching (0) to the arm up (1) and back, a bar of four beats each way.
  const up = smooth((sin((beats * Math.PI) / 4) + 0.3) / 0.6) * into;
  const left = k < 0.5;
  p.crouch = (0.04 + bob * 0.12) * into;
  p.sway = step * 0.5 * into;
  p.leanZ = -step * 0.07 * into;
  p.tilt = step * 0.1 * into;
  p.nod = bob * 0.06 * into;
  p.kneeL = fold(step) * 0.3 * into;
  p.kneeR = fold(-step) * 0.3 * into;
  // Facing you, the dancer on the left has their right arm outside. Arms punch on alternate beats.
  const punch = (s: number) => ({ swing: 0.25 * into, out: mix(0.14, 0.5 + fold(s) * 1.3, into), twist: -0.4 * into, elbow: mix(0.16, 0.95 - fold(s) * 0.55, into) });
  const a = punch(step);
  const b = punch(-step);
  // Thrown up a little forward, so it shows in front of big hair rather than behind it.
  const outside = { swing: mix(a.swing, 0.5, up), out: mix(a.out, 2.3, up), twist: mix(a.twist, -0.5, up), elbow: mix(a.elbow, 0.2 + bob * 0.35, up) };
  const inside = { swing: mix(b.swing, 0.05, up), out: mix(b.out, 0.7, up), twist: mix(b.twist, 1.3, up), elbow: mix(b.elbow, 1.75, up) };
  const [r, l] = left ? [outside, inside] : [inside, outside];
  p.swingR = r.swing;
  p.outR = r.out;
  p.twistR = r.twist;
  p.elbowR = r.elbow;
  p.swingL = l.swing;
  p.outL = l.out;
  p.twistL = l.twist;
  p.elbowL = l.elbow;
  p.headYaw = (left ? -1 : 1) * 0.12 * up;
  p.expr = 2;
};

/**
 * A boombox up on the left shoulder (a headset's mic is on the right), over whatever else the
 * body is doing: the upper arm out level, the forearm folded back up beside the head, which tips
 * away to make room.
 */
export function carry(p: Pose) {
  p.swingL = 0.12;
  p.outL = 1.45;
  p.twistL = -1.5;
  p.elbowL = 1.15;
  p.tilt += 0.08;
}

/** How long the clips that end on their own last, in seconds. */
export const LENGTH = { land: 0.75, thanks: 1.15, wave: 1.8, hop: 1.2, gaze: 2.8, hello: 2.2, stunned: 0.8, shock: 1.6, faint: 3.2, wink: 1.4 } as const;

const FIELDS = [
  'y', 'pitch', 'roll', 'crouch', 'sway', 'leanX', 'leanZ', 'twist', 'nod', 'tilt', 'headYaw',
  'legL', 'legR', 'kneeL', 'kneeR', 'spread',
  'swingL', 'outL', 'twistL', 'elbowL', 'swingR', 'outR', 'twistR', 'elbowR',
] as const;

/** Moves every joint of `p` toward `to` by `w`. The face snaps once it is past halfway. */
export function blend(p: Pose, to: Pose, w: number) {
  for (const f of FIELDS) p[f] += (to[f] - p[f]) * w;
  if (w > 0.5) p.expr = to.expr;
}

export function copyJoints(from: Pose, to: Pose) {
  for (const f of FIELDS) to[f] = from[f];
  to.expr = from.expr;
}
