// A Mii let go of is a rigid body: three balls down its middle (feet, hips, a big head) under
// gravity. It keeps the spin the throw gave it, bounces off the floor and slides to a stop on it
// with friction, and knocks into whoever it hits, ball against ball, where they actually touch.
// Everything here is in world units and seconds.
import * as THREE from 'three';

export interface Body {
  /** Centre of mass, its velocity, which way the body is turned, and how fast it turns (world axis, radians a second). */
  com: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  omega: THREE.Vector3;
  /** Height of the centre of mass above the feet, standing, and of the top of the head. */
  low: number;
  top: number;
  /** How long it has lain nearly still on the floor. */
  still: number;
  /**
   * Since last cleared: which balls touched the floor (bit 0 the feet, 1 the hips, 2 the head),
   * and how hard the hardest of them hit, as the speed it came down at.
   */
  touched: number;
  hit: number;
}

/**
 * Each ball as [height above the feet, radius], in fractions of the body's height, and how much of
 * a knock it gives back: the head is the bounciest.
 */
const BALLS: [number, number, number][] = [
  [0.07, 0.07, 0.15],
  [0.32, 0.13, 0.2],
  [0.76, 0.24, 0.32],
];
/** How hard the floor grips, and how fast a body rolling over it slows. */
const FRICTION = 0.7;
const ROLLING = 3.5;
/** How bouncy and how grippy one Mii is against another. */
const BUMP = { bounce: 0.25, friction: 0.35 };
/** The longest step taken at once, so a fast body never sinks through the floor. */
const STEP = 1 / 240;

const UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _ra = new THREE.Vector3();
const _rb = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ca = BALLS.map(() => new THREE.Vector3());
const _cb = BALLS.map(() => new THREE.Vector3());
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function body(): Body {
  return { com: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), omega: new THREE.Vector3(), low: 0, top: 1, still: 0, touched: 0, hit: 0 };
}

/** Moment of inertia over mass, the same about every axis: near enough for a body this round. */
const inertia = (b: Body) => (b.top * b.top) / 10;

/** Sets `b` standing at feet (x, y, z), turned to `yaw` and tipped by `pitch` and `roll` as a Pose is. */
export function stand(b: Body, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, top: number) {
  b.top = top;
  b.low = top * 0.45;
  b.rot.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
  b.com.set(0, b.low, 0).applyQuaternion(b.rot).add(_v.set(x, y, z));
  b.vel.set(0, 0, 0);
  b.omega.set(0, 0, 0);
  b.still = 0;
}

/** Where the feet are, and the yaw, pitch and roll that turn a Pose the way the body is turned. */
export function pose(b: Body, feet: THREE.Vector3) {
  feet.set(0, -b.low, 0).applyQuaternion(b.rot).add(b.com);
  _e.setFromQuaternion(b.rot, 'YXZ');
  return { yaw: _e.y, pitch: _e.x, roll: _e.z };
}

/** Which way is up the body, from the feet to the head. */
export const upOf = (b: Body, out: THREE.Vector3) => out.copy(UP).applyQuaternion(b.rot);

/** How fast something turned from `from` to `to` in `dt`, about the world axes (radians a second). */
export function turnRate(from: THREE.Quaternion, to: THREE.Quaternion, dt: number, out: THREE.Vector3) {
  _q.copy(from).invert().premultiply(to);
  if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
  const s = Math.sqrt(1 - Math.min(1, _q.w * _q.w));
  if (s < 1e-6 || dt <= 0) return out.set(0, 0, 0);
  return out.set(_q.x, _q.y, _q.z).multiplyScalar((2 * Math.acos(Math.min(1, _q.w))) / s / dt);
}

/** Moves `b` on by `dt`, adding what touched the floor to `b.touched` and `b.hit`. */
export function step(b: Body, dt: number, gravity: number) {
  const n = Math.max(1, Math.ceil(dt / STEP));
  const h = dt / n;
  const k2 = inertia(b);
  for (let s = 0; s < n; s++) {
    b.vel.y -= gravity * h;
    // A little air drag, so a spin can't go on for ever.
    b.vel.multiplyScalar(Math.exp(-0.08 * h));
    b.omega.multiplyScalar(Math.exp(-0.25 * h));
    b.com.addScaledVector(b.vel, h);
    const w = b.omega.length();
    if (w > 1e-6) b.rot.premultiply(_q.setFromAxisAngle(_v.copy(b.omega).divideScalar(w), w * h)).normalize();

    let sink = 0;
    let grounded = false;
    BALLS.forEach(([y, radius, bounce], i) => {
      const r = radius * b.top;
      _r.set(0, y * b.top - b.low, 0).applyQuaternion(b.rot);
      const under = r - (b.com.y + _r.y);
      if (under <= 0) return;
      grounded = true;
      b.touched |= 1 << i;
      sink = Math.max(sink, under);
      // From the centre of mass to where the ball meets the floor, and how fast that point moves.
      _r.y -= r;
      _v.crossVectors(b.omega, _r).add(b.vel);
      if (_v.y >= 0) return;
      b.hit = Math.max(b.hit, -_v.y);
      // Bounce only off a real knock; resting on the floor, it just stops.
      const e = _v.y < -1.2 ? bounce : 0;
      _rn.crossVectors(_r, UP);
      const j = (-(1 + e) * _v.y) / (1 + _rn.lengthSq() / k2);
      b.vel.y += j;
      b.omega.addScaledVector(_rn, j / k2);
      // Friction against the slide, no more than the floor can give for how hard it pressed.
      _v.crossVectors(b.omega, _r).add(b.vel);
      _v.y = 0;
      const slide = _v.length();
      if (slide < 1e-5) return;
      _t.copy(_v).divideScalar(slide);
      _rn.crossVectors(_r, _t);
      const jt = Math.min(FRICTION * j, slide / (1 + _rn.lengthSq() / k2));
      b.vel.addScaledVector(_t, -jt);
      b.omega.addScaledVector(_rn, -jt / k2);
    });
    if (sink > 0) b.com.y += sink;
    if (grounded) b.omega.multiplyScalar(Math.exp(-ROLLING * h));
    b.still = grounded && b.vel.lengthSq() < 0.16 && b.omega.lengthSq() < 1 ? b.still + h : 0;
  }
}

/** Where each of the body's balls is in the world. */
function balls(b: Body, out: THREE.Vector3[]) {
  BALLS.forEach(([y], i) => out[i].set(0, y * b.top - b.low, 0).applyQuaternion(b.rot).add(b.com));
}

/**
 * Two bodies meeting, ball against ball: the deepest pair touching is pushed apart, and if they
 * are closing there, each gets the knock two equal weights would give at that very point, turning
 * as well as moving, with a little rub between them. A head clipping a head spins both; feet swept
 * from under someone tip them over. A `fixed` b stands firm, as a wall does: a takes all of the
 * parting and all of the knock. Returns -1 if they don't touch, otherwise how fast they were
 * closing where they met.
 */
export function collide(a: Body, b: Body, fixed = false) {
  const near = (a.top + b.top) * 0.6;
  if (Math.abs(a.com.x - b.com.x) > near || Math.abs(a.com.z - b.com.z) > near || Math.abs(a.com.y - b.com.y) > near) return -1;
  balls(a, _ca);
  balls(b, _cb);
  let deepest = 0;
  let ia = -1;
  let ib = -1;
  for (let i = 0; i < BALLS.length; i++) {
    for (let j = 0; j < BALLS.length; j++) {
      const sink = BALLS[i][1] * a.top + BALLS[j][1] * b.top - _ca[i].distanceTo(_cb[j]);
      if (sink > deepest) {
        deepest = sink;
        ia = i;
        ib = j;
      }
    }
  }
  if (ia < 0) return -1;
  // From a to b at the touch; balls dead on top of each other part across the floor.
  _n.subVectors(_cb[ib], _ca[ia]);
  if (_n.lengthSq() < 1e-10) _n.subVectors(b.com, a.com).setY(0);
  if (_n.lengthSq() < 1e-10) _n.set(1, 0, 0);
  _n.normalize();
  _p.copy(_ca[ia]).addScaledVector(_n, BALLS[ia][1] * a.top - (fixed ? deepest : deepest / 2));
  a.com.addScaledVector(_n, fixed ? -deepest : -deepest / 2);
  if (!fixed) b.com.addScaledVector(_n, deepest / 2);
  _ra.subVectors(_p, a.com);
  _rb.subVectors(_p, b.com);
  const closing = relative(a, b).dot(_n);
  if (closing <= 0) return 0;
  const ka = 1 / inertia(a);
  // A fixed body has no give at all: no weight to shift, no turn to take up.
  const kb = fixed ? 0 : 1 / inertia(b);
  const mass = fixed ? 1 : 2;
  const j = ((1 + BUMP.bounce) * closing) / (mass + _r.crossVectors(_ra, _n).lengthSq() * ka + _r.crossVectors(_rb, _n).lengthSq() * kb);
  impulse(a, b, _n, j, ka, kb, fixed);
  // The rub: against the slide of one past the other, no more than how hard they met allows.
  _t.copy(relative(a, b));
  _t.addScaledVector(_n, -_t.dot(_n));
  const slide = _t.length();
  if (slide > 1e-5) {
    _t.divideScalar(slide);
    const most = slide / (mass + _r.crossVectors(_ra, _t).lengthSq() * ka + _r.crossVectors(_rb, _t).lengthSq() * kb);
    impulse(a, b, _t, Math.min(BUMP.friction * j, most), ka, kb, fixed);
  }
  return closing;
}

/** How fast the touching point on `a` moves against the one on `b` (`_ra`, `_rb` from each middle). */
function relative(a: Body, b: Body) {
  _v.crossVectors(a.omega, _ra).add(a.vel);
  return _v.sub(_rn.crossVectors(b.omega, _rb).add(b.vel));
}

/** Gives `b` the push `j` along `dir` at the touch, and `a` the same back; a fixed `b` takes none. */
function impulse(a: Body, b: Body, dir: THREE.Vector3, j: number, ka: number, kb: number, fixed: boolean) {
  a.vel.addScaledVector(dir, -j);
  a.omega.addScaledVector(_r.crossVectors(_ra, dir), -j * ka);
  if (fixed) return;
  b.vel.addScaledVector(dir, j);
  b.omega.addScaledVector(_r.crossVectors(_rb, dir), j * kb);
}
