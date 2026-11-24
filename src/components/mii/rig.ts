// Draws a group of Wii U Miis: FFL heads (one CharModel each) on Wii U bodies. All bodies of one
// gender share a single skinned draw call per material; each frame the pose of every Mii becomes
// bone matrices in a float texture. Shared by the plaza crowd and the /mii/ page.
import * as THREE from 'three';
import { FAVORITE_COLORS, MII_SIZE, PANTS, miiInfo } from './data';
import type { Body, MiiKit } from './kit';
import { bodyMaterial, miiUniforms, patchHead } from './shader';
import {
  FFLAge,
  FFLExpression,
  FFLGender,
  FFLRace,
  FFLModelFlag,
  FFLModulateType,
  FFLResourceType,
  FFLiCharInfo,
  createCharModel,
  getRandomCharInfo,
  initCharModelTextures,
  makeExpressionFlag,
  type CharModel,
} from './vendor/ffl.js';
import FFLShaderMaterial from './vendor/FFLShaderMaterial.js';

/**
 * One Mii's pose for a frame. Angles are radians. Left and right are the Mii's own, and a positive
 * leg or arm swing is forward.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** The whole body tipped about its feet, after the yaw: forward (pitch) and toward its left (roll). */
  pitch: number;
  roll: number;
  scale: number;
  /** Knee bend with the feet planted: the pelvis drops to match. */
  crouch: number;
  /** Pelvis shift toward the Mii's left, in body units. */
  sway: number;
  /** Forward lean of the chest. */
  leanX: number;
  /** Lean of the chest toward the Mii's left. */
  leanZ: number;
  /** Chest turn toward the Mii's left. */
  twist: number;
  /** Positive looks down. */
  nod: number;
  tilt: number;
  headYaw: number;
  legL: number;
  legR: number;
  /** Extra knee bend on top of what a swing adds. */
  kneeL: number;
  kneeR: number;
  /** Legs apart. */
  spread: number;
  swingL: number;
  /** Arm raised sideways: 0 hangs, about 1.4 is level, about 2.9 is straight up. */
  outL: number;
  /** Upper arm turned inward, so a bent forearm crosses the chest. */
  twistL: number;
  elbowL: number;
  swingR: number;
  outR: number;
  twistR: number;
  elbowR: number;
  /**
   * 0 neutral, 1 blink, 2 happy, 3 surprised, 4 angry, 5 scared, 6 a wink. 2 and up only show on
   * sets made with `happy`, or on a Mii brought to life with `liven`.
   */
  expr: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export const restPose = (): Pose => ({
  x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1,
  crouch: 0, sway: 0,
  leanX: 0, leanZ: 0, twist: 0,
  nod: 0, tilt: 0, headYaw: 0,
  legL: 0, legR: 0, kneeL: 0, kneeR: 0, spread: 0,
  swingL: 0, outL: 0.14, twistL: 0, elbowL: 0.14,
  swingR: 0, outR: 0.14, twistR: 0, elbowR: 0.14,
  expr: 0,
});

export { miiUniforms };

/** World units per Wii U body unit. A Mii of default height stands about 1.2 units tall. */
const UNIT = 0.06;
/** FFL head scale on the Wii U body, and its lift above the head bone (body units). */
const HEAD_SCALE = 0.14;
const HEAD_LIFT = 0.1;
/** FFL head height before its model exists (FFL units). */
const HEAD_HEIGHT = 72;
/** Wii U body arms hang a little away from the torso. */
const ARM_REST = 0.17;
/**
 * A piece of hair counts as a bun (or a puff) when all of it is above `above` and behind `behind`,
 * in FFL head units: the face is about 52 across, the top of the hair about 70 up, facing +z.
 */
const BUN = { above: 30, behind: -15 };
const BONES = 25;

const EXPRESSIONS = [
  FFLExpression.NORMAL,
  FFLExpression.BLINK,
  FFLExpression.SMILE,
  FFLExpression.SURPRISE_OPEN_MOUTH,
  FFLExpression.ANGER_OPEN_MOUTH,
  FFLExpression.SORROW_OPEN_MOUTH,
  FFLExpression.LIKE_WINK_LEFT,
];
/** Thigh and shin length, in body units. */
const LEG = 2.2;

export interface MiiSetOptions {
  /** Face texture size: 512 for close-ups, 256 for a crowd. */
  resolution: number;
  /** Happy faces for cheering. Blinking is always on. */
  happy?: boolean;
  shadows?: boolean;
  /** Pants color: one for the whole set, or one per Mii by its index. Gray unless given. */
  pants?: number | ((i: number) => number);
  /** Which Miis, by index, wear short sleeves: bare forearms and hands in their own skin color. */
  sleeves?: (i: number) => boolean;
  /** Which Miis, by index, have any bun or puff on the back of the head left off their hair (`leaveOffBun`). */
  noBun?: (i: number) => boolean;
  /** Head size on the body. Mii Maker's by default; the plaza draws heads a little smaller. */
  headScale?: number;
  /** An extra render layer for every body and head, e.g. one a floor reflection draws. */
  layer?: number;
}

interface Slot {
  data: Uint8Array;
  gender: 0 | 1;
  shirt: number;
  pants: number;
  row: number;
  sx: number;
  sy: number;
  top: number;
  model: CharModel | null;
  head: THREE.Group | null;
  expr: number;
  /** Has every expression, not just neutral and blink. */
  full: boolean;
  hidden: boolean;
  /** A flat stand-in is drawing this head, so the real one stays hidden. */
  card: boolean;
  /** Bones whose world placement is kept each pose, for something held (`track`). */
  tracks: { bone: number; matrix: THREE.Matrix4 }[];
  /** In short sleeves (`MiiSetOptions.sleeves`). */
  sleeves: boolean;
  /** Without the bun on the back of the head (`MiiSetOptions.noBun`). */
  noBun: boolean;
}

interface Batch {
  body: Body;
  bones: THREE.DataTexture;
  meshes: THREE.Mesh[];
  /** The shirts' skin color per Mii, filled in once each head (which knows it) is made. */
  skin: THREE.InstancedBufferAttribute;
}

/** Turns any supported Mii bytes into body traits. */
function traits(data: Uint8Array) {
  if (data.length === MII_SIZE) return miiInfo(data);
  const c = FFLiCharInfo.unpack(data);
  return {
    gender: (c.personal.gender ? 1 : 0) as 0 | 1,
    favoriteColor: c.personal.favoriteColor,
    height: c.body.height,
    build: c.body.build,
  };
}

/**
 * A random Mii from the Mii Maker's own generator (FFLiGetRandomCharInfo), with a random height,
 * build and favorite color so a crowd looks like the real thing.
 */
export function randomMii(kit: MiiKit, random: () => number = Math.random) {
  // Mostly adults and kids, like the people who post on Miiverse.
  const roll = random();
  const age = roll < 0.6 ? FFLAge.ADULT : roll < 0.9 ? FFLAge.CHILD : FFLAge.ELDER;
  const info = FFLiCharInfo.unpack(getRandomCharInfo(kit.ffl, FFLGender.ALL, age, FFLRace.ALL));
  const spread = (mid: number, range: number) => Math.round(Math.max(0, Math.min(127, mid + (random() + random() - 1) * range)));
  // The plaza crowd is mostly tall and slim, kids aside.
  info.body.height = age === FFLAge.CHILD ? spread(52, 34) : spread(98, 30);
  info.body.build = spread(52, 34);
  info.personal.favoriteColor = Math.floor(random() * 12);
  return FFLiCharInfo.pack(info);
}

/** Whether FFL takes a CharInfo as a valid Mii. */
function isValid(kit: MiiKit, info: Uint8Array) {
  const m = kit.ffl;
  const ptr = m._malloc(info.length);
  try {
    m.HEAPU8.set(info, ptr);
    return m._FFLiVerifyCharInfoWithReason(ptr, 0) === 0;
  } finally {
    m._free(ptr);
  }
}

/** Parts whose `color` is one of the Switch's hundred colors in a Mii's look. */
const COMMON_COLORED = new Set(['hair', 'eye', 'eyebrow', 'mouth', 'beard', 'glass']);

/**
 * Mii `data` with some of its parts changed, by FFL's CharInfo names: `{ hair: { type: 29 } }`.
 * The colors of hair, eyes, eyebrows, mouth, beard and glasses are the Switch's hundred (0 to 99):
 * FFL draws them all, but a QR code Mii only carries a few, so the result is a CharInfo. `data`
 * comes back as it was if FFL can't read it.
 */
export function withParts(kit: MiiKit, data: Uint8Array, parts: Record<string, Record<string, number>>) {
  const m = kit.ffl;
  const info = m._malloc(FFLiCharInfo.size);
  const src = m._malloc(data.length);
  try {
    m.HEAPU8.set(data, src);
    if (data.length !== FFLiCharInfo.size && !m._FFLpGetCharInfoFromStoreData(info, src)) return data;
    const parsed = FFLiCharInfo.unpack(data.length === FFLiCharInfo.size ? data : m.HEAPU8.slice(info, info + FFLiCharInfo.size));
    for (const [part, fields] of Object.entries(parts)) {
      const into = parsed[part] as Record<string, number> | undefined;
      if (!into) continue;
      for (const [field, value] of Object.entries(fields)) {
        // FFL reads a color with the top bit set as one of the Switch's common colors.
        into[field] = field === 'color' && COMMON_COLORED.has(part) ? (value | 0x80000000) >>> 0 : value;
      }
    }
    return FFLiCharInfo.pack(parsed);
  } finally {
    m._free(info);
    m._free(src);
  }
}

/**
 * Leaves off the pieces of a head's hair that sit wholly up on the back of it, a bun or a puff,
 * and keeps the rest of the style exactly as it is. A piece is whatever its triangles join up
 * into by shared vertices. A bun often covers an opening in the hair under it, so any opening the
 * removal leaves near it is closed with a cap domed to the head's curve.
 */
function leaveOffBun(head: THREE.Object3D) {
  head.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!(o as THREE.Mesh).isMesh || g.userData.modulateType !== FFLModulateType.SHAPE_HAIR || !g.index) return;
    const pos = g.getAttribute('position');
    const index = g.index;
    const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
    const find = (i: number) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (let t = 0; t < index.count; t += 3) {
      const a = find(index.getX(t));
      parent[find(index.getX(t + 1))] = a;
      parent[find(index.getX(t + 2))] = a;
    }
    // Each piece's lowest point and its point furthest forward.
    const low = new Map<number, number>();
    const front = new Map<number, number>();
    for (let v = 0; v < pos.count; v++) {
      const p = find(v);
      low.set(p, Math.min(low.get(p) ?? Infinity, pos.getY(v)));
      front.set(p, Math.max(front.get(p) ?? -Infinity, pos.getZ(v)));
    }
    const keep: number[] = [];
    const gone = new THREE.Box3();
    for (let t = 0; t < index.count; t += 3) {
      const p = find(index.getX(t));
      if (low.get(p)! > BUN.above && front.get(p)! < BUN.behind) {
        for (let k = 0; k < 3; k++) gone.expandByPoint(_v.fromBufferAttribute(pos, index.getX(t + k)));
        continue;
      }
      keep.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    }
    if (keep.length === index.count) return;
    capOpenings(g, keep, gone.expandByScalar(4));
  });
}

/**
 * Closes the openings in `keep` (a triangle list of `g`) that lie within `near`: every loop of
 * edges with a triangle on one side only is filled with a fan to a point raised off its middle,
 * so the cap bulges out like the rest of the head. Then sets the geometry's triangles.
 */
function capOpenings(g: THREE.BufferGeometry, keep: number[], near: THREE.Box3) {
  const pos = g.getAttribute('position');
  // Vertices are split along seams, so edges are matched by where their ends are.
  const at = (v: number) => `${pos.getX(v).toFixed(2)},${pos.getY(v).toFixed(2)},${pos.getZ(v).toFixed(2)}`;
  const uses = new Map<string, number>();
  const edges: [number, number][] = [];
  for (let t = 0; t < keep.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = keep[t + k];
      const b = keep[t + ((k + 1) % 3)];
      const [ka, kb] = [at(a), at(b)];
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      edges.push([a, b]);
    }
  }
  // The open edges near where the bun was, each as it runs round its one triangle.
  const next = new Map<string, [number, number]>();
  for (const [a, b] of edges) {
    const [ka, kb] = [at(a), at(b)];
    if (uses.get(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`) !== 1) continue;
    if (!near.containsPoint(_v.fromBufferAttribute(pos, a)) || !near.containsPoint(_v.fromBufferAttribute(pos, b))) continue;
    next.set(ka, [a, b]);
  }
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const middle = box.getCenter(new THREE.Vector3());
  const caps: { rim: [number, number][]; tip: THREE.Vector3; out: THREE.Vector3 }[] = [];
  const seen = new Set<string>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const rim: [number, number][] = [];
    let key = start;
    while (!seen.has(key) && next.has(key) && rim.length <= next.size) {
      seen.add(key);
      const e = next.get(key)!;
      rim.push(e);
      key = at(e[1]);
    }
    if (rim.length < 3 || key !== start) continue;
    const c = new THREE.Vector3();
    for (const [a] of rim) c.add(_v.fromBufferAttribute(pos, a));
    c.divideScalar(rim.length);
    let r = 0;
    for (const [a] of rim) r += _v.fromBufferAttribute(pos, a).distanceTo(c);
    const out = c.clone().sub(middle).normalize();
    caps.push({ rim, tip: c.addScaledVector(out, (r / rim.length) * 0.3), out });
  }
  if (caps.length) {
    // One new vertex per cap, at its tip, otherwise copied from a vertex on its rim.
    const base = pos.count;
    // Attributes may be packed or interleaved, so each is read out value by value into plain floats.
    for (const [name, attr] of Object.entries(g.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const n = a.itemSize;
      const out = new Float32Array((base + caps.length) * n);
      for (let v = 0; v < base; v++) for (let k = 0; k < n; k++) out[v * n + k] = a.getComponent(v, k);
      caps.forEach((cap, i) => {
        for (let k = 0; k < n; k++) out[(base + i) * n + k] = a.getComponent(cap.rim[0][0], k);
        if (name === 'position') cap.tip.toArray(out, (base + i) * n);
        if (name === 'normal') cap.out.toArray(out, (base + i) * n);
      });
      g.setAttribute(name, new THREE.BufferAttribute(out, n));
    }
    // Wound against the rim's own triangles, so the cap faces out.
    caps.forEach((cap, i) => {
      for (const [a, b] of cap.rim) keep.push(b, a, base + i);
    });
  }
  g.setIndex(keep);
}

/** A small seeded random number generator (mulberry32 over a string hash). */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The same Mii for the same seed on every screen, as a CharInfo: every part picked by a seeded
 * random from the Mii Maker's ranges and set where the Mii Maker sets it. FFL's own generator
 * can't be seeded, so it only supplies a valid starting point whose looks are all overwritten.
 */
export function seededMii(kit: MiiKit, seed: string) {
  const random = seeded(seed);
  const pick = (n: number) => Math.floor(random() * n);
  const base = FFLiCharInfo.unpack(getRandomCharInfo(kit.ffl, FFLGender.ALL, FFLAge.ADULT, FFLRace.ALL));
  for (let tries = 0; tries < 8; tries++) {
    const info = structuredClone(base) as Record<string, Record<string, number>> & typeof base;
    const male = random() < 0.5;
    const hairColor = pick(8);
    const set = (part: string, values: Record<string, number>) => Object.assign(info[part], values);
    set('faceline', { type: pick(12), color: pick(6), texture: 0, make: 0 });
    set('hair', { type: pick(132), color: hairColor, flip: pick(2) });
    set('eye', { type: pick(60), color: pick(6), scale: 4, aspect: 3, rotate: 4, x: 2, y: 12 });
    set('eyebrow', { type: pick(24), color: hairColor, scale: 4, aspect: 3, rotate: 6, x: 2, y: 10 });
    set('nose', { type: pick(18), scale: 4, y: 9 });
    set('mouth', { type: pick(36), color: pick(5), scale: 4, aspect: 3, y: 13 });
    const beard = male && random() < 0.18;
    set('beard', { mustache: beard ? 1 + pick(5) : 0, type: beard ? pick(6) : 0, color: hairColor, scale: 4, y: 10 });
    const glasses = random() < 0.16;
    set('glass', { type: glasses ? 1 + pick(8) : 0, color: pick(6), scale: 4, y: 10 });
    set('mole', { type: 0, scale: 4, x: 2, y: 20 });
    set('body', { height: Math.round(40 + random() * 60), build: Math.round(30 + random() * 60) });
    info.personal.gender = male ? 0 : 1;
    info.personal.favoriteColor = pick(12);
    const data = FFLiCharInfo.pack(info);
    if (isValid(kit, data)) return data;
  }
  return randomMii(kit, random);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _down = [new THREE.Quaternion(), new THREE.Quaternion()];
const _downInv = [new THREE.Quaternion(), new THREE.Quaternion()];
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _t = new THREE.Vector3();
// Arms rest along +x (index 0) and -x (index 1) in the model; these turn them to hang down.
_down[0].setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
_down[1].setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
_downInv[0].copy(_down[0]).invert();
_downInv[1].copy(_down[1]).invert();

export class MiiSet {
  readonly group = new THREE.Group();
  readonly shadowGroup = new THREE.Group();
  /** Every head, one child group per Mii. */
  readonly heads = new THREE.Group();
  /** The batched shirt and pants meshes. */
  readonly bodies: THREE.Mesh[] = [];
  private slots: Slot[];
  private batches: (Batch | null)[];
  private shadow?: THREE.InstancedMesh;
  private built = 0;
  private local: THREE.Quaternion[] = Array.from({ length: BONES }, () => new THREE.Quaternion());
  private world: THREE.Matrix4[] = Array.from({ length: BONES }, () => new THREE.Matrix4());
  private disposables: { dispose(): void }[] = [];
  private headScale: number;

  constructor(
    private kit: MiiKit,
    private renderer: THREE.WebGLRenderer,
    miis: Uint8Array[],
    private opts: MiiSetOptions,
  ) {
    const rows = [0, 0];
    this.headScale = opts.headScale ?? HEAD_SCALE;
    this.slots = miis.map((data, i) => {
      const t = traits(data);
      // Wii U body scale (nn::mii GetBodyScale).
      const sx = (t.build * (t.height * 0.003671875 + 0.4)) / 128 + t.height * 0.001796875 + 0.4;
      const sy = t.height * 0.006015625 + 0.5;
      return {
        data,
        gender: t.gender,
        row: rows[t.gender]++,
        sx,
        sy,
        top: (10.9 * sy + HEAD_LIFT + HEAD_HEIGHT * this.headScale) * UNIT,
        shirt: FAVORITE_COLORS[t.favoriteColor] ?? FAVORITE_COLORS[0],
        pants: typeof opts.pants === 'function' ? opts.pants(i) : (opts.pants ?? PANTS.gray),
        model: null,
        head: null,
        expr: -1,
        full: !!opts.happy,
        hidden: true,
        card: false,
        tracks: [],
        sleeves: !!opts.sleeves?.(i),
        noBun: !!opts.noBun?.(i),
      };
    });

    this.batches = [0, 1].map((g) => {
      const n = rows[g];
      if (!n) return null;
      const body = kit.bodies[g];
      const bones = new THREE.DataTexture(new Float32Array(BONES * 4 * 4 * n), BONES * 4, n, THREE.RGBAFormat, THREE.FloatType);
      bones.needsUpdate = true;
      const tint = (geo: THREE.BufferGeometry, color: (s: Slot) => number) => {
        const g2 = new THREE.InstancedBufferGeometry();
        g2.setIndex(geo.getIndex());
        for (const [name, attr] of Object.entries(geo.attributes)) g2.setAttribute(name, attr);
        const tints = new Float32Array(n * 3);
        const c = new THREE.Color();
        for (const s of this.slots) {
          if (s.gender === g) c.setHex(color(s), THREE.LinearSRGBColorSpace).toArray(tints, s.row * 3);
        }
        g2.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
        g2.setAttribute('aSkin', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
        g2.instanceCount = n;
        return g2;
      };
      const shirt = new THREE.Mesh(
        tint(body.shirt, (s) => s.shirt),
        bodyMaterial(bones, 9),
      );
      const pants = new THREE.Mesh(tint(body.pants, (s) => s.pants), bodyMaterial(bones, 10));
      for (const m of [shirt, pants]) {
        m.frustumCulled = false;
        if (opts.layer !== undefined) m.layers.enable(opts.layer);
        this.bodies.push(m);
        this.group.add(m);
        this.disposables.push(m.geometry, m.material as THREE.Material);
      }
      this.disposables.push(bones);
      return { body, bones, meshes: [shirt, pants], skin: shirt.geometry.getAttribute('aSkin') as THREE.InstancedBufferAttribute };
    });

    if (opts.shadows) {
      const map = blobTexture();
      const mat = new THREE.MeshBasicMaterial({ map, color: '#3b4e4c', transparent: true, opacity: 0.32, depthWrite: false });
      this.shadow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), mat, miis.length);
      this.shadow.renderOrder = 1;
      this.shadow.frustumCulled = false;
      this.disposables.push(map, mat, this.shadow.geometry);
      this.shadowGroup.add(this.shadow);
      this.group.add(this.shadowGroup);
    }
    this.group.add(this.heads);
    this.slots.forEach((_, i) => this.hide(i));
  }

  get count() {
    return this.slots.length;
  }

  get ready() {
    return this.built === this.slots.length;
  }

  /** Builds at least one head, then more until `deadline` (performance.now() ms). True once all exist. */
  build(deadline = Infinity) {
    while (this.built < this.slots.length) {
      this.buildHead(this.slots[this.built++]);
      if (performance.now() > deadline) break;
    }
    return this.ready;
  }

  private buildHead(s: Slot) {
    const model = this.makeModel(s, s.full ? EXPRESSIONS : EXPRESSIONS.slice(0, 2), this.opts.resolution);
    if (!model) return;
    this.mount(s, model);
  }

  private makeModel(s: Slot, expressions: number[], resolution: number) {
    let model: CharModel;
    try {
      model = createCharModel(
        s.data,
        {
          resolution,
          allExpressionFlag: makeExpressionFlag(expressions),
          modelFlag: FFLModelFlag.NORMAL,
          resourceType: FFLResourceType.HIGH,
        },
        FFLShaderMaterial,
        this.kit.ffl,
        false,
      );
      initCharModelTextures(model, this.renderer, FFLShaderMaterial);
    } catch (err) {
      console.warn('Skipping a Mii FFL could not build', err);
      return null;
    }
    if (!model.meshes) {
      model.dispose();
      return null;
    }
    return model;
  }

  private mount(s: Slot, model: CharModel) {
    const head = model.meshes!;
    head.matrixAutoUpdate = false;
    if (s.noBun) leaveOffBun(head);
    head.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) patchHead(mesh.material as THREE.Material);
    });
    model.setExpression(FFLExpression.NORMAL);
    s.expr = FFLExpression.NORMAL;
    s.model = model;
    s.head = head;
    if (s.sleeves) {
      const skin = this.batches[s.gender]!.skin;
      const c = model.facelineColor;
      skin.setXYZW(s.row, c.r, c.g, c.b, 1);
      skin.needsUpdate = true;
    }
    s.top = (10.9 * s.sy + HEAD_LIFT + model.boundingBox.max.y * this.headScale) * UNIT;
    head.visible = !s.hidden && !s.card;
    const layer = this.opts.layer;
    if (layer !== undefined) head.traverse((o) => o.layers.enable(layer));
    this.heads.add(head);
  }

  /**
   * Rebuilds Mii `i`'s head with every expression and a sharper face, for a crowd Mii someone
   * is playing with. Crowd heads start with only neutral and blink to save memory.
   */
  liven(i: number) {
    const s = this.slots[i];
    if (s.full || !s.head || !s.model) return;
    const model = this.makeModel(s, EXPRESSIONS, Math.max(256, this.opts.resolution));
    if (!model) return;
    const old = s.model;
    const matrix = s.head.matrix.clone();
    s.head.removeFromParent();
    old.dispose();
    s.full = true;
    this.mount(s, model);
    s.head!.matrix.copy(matrix);
    s.head!.matrixWorldNeedsUpdate = true;
  }

  /** Height of the shirt collar above the feet, at pose scale 1. */
  collar(i: number) {
    return 10.2 * this.slots[i].sy * UNIT;
  }

  /** Whether Mii `i` has every expression (see `liven`). */
  isFull(i: number) {
    return this.slots[i].full;
  }

  /** Whether Mii `i` has its head built yet. */
  hasHead(i: number) {
    return this.slots[i].head !== null;
  }

  /**
   * Keeps `bone` of Mii `i` placed in the world: the matrix returned is rewritten with the bone's
   * world placement (scale included) every time the Mii is posed, so a prop can follow a hand.
   */
  track(i: number, bone: string) {
    const s = this.slots[i];
    const body = this.batches[s.gender]?.body;
    const j = body ? body.bone(bone) : -1;
    if (j < 0) throw new Error(`No bone ${bone}`);
    const matrix = new THREE.Matrix4();
    s.tracks.push({ bone: j, matrix });
    return matrix;
  }

  /** Mii `i`'s gender, and its height from 0 (shortest) to 1 (tallest), which the plaza's voices pitch to. */
  figure(i: number) {
    const s = this.slots[i];
    return { female: s.gender === 1, size: Math.min(1, Math.max(0, (s.sy - 0.5) / 0.764)) };
  }

  /** Whether Mii `i` is out of sight. */
  isHidden(i: number) {
    return this.slots[i].hidden;
  }

  /** Mii `i`'s head placement this frame (world space, scale included), or null before it exists. */
  headMatrix(i: number) {
    return this.slots[i].head?.matrix ?? null;
  }

  /** Hides Mii `i`'s real head while a flat stand-in draws it, or brings it back. */
  setCard(i: number, on: boolean) {
    const s = this.slots[i];
    s.card = on;
    if (s.head) s.head.visible = !s.hidden && !on;
  }

  /**
   * Lends Mii `i`'s head, posed by `matrix` with a neutral face, to `use` (which renders it
   * somewhere), then puts everything back as it was.
   */
  lendHead(i: number, matrix: THREE.Matrix4, use: (head: THREE.Object3D) => void) {
    const s = this.slots[i];
    if (!s.head || !s.model) return;
    const head = s.head;
    const saved = head.matrix.clone();
    const visible = head.visible;
    const expr = s.expr;
    if (expr !== FFLExpression.NORMAL) s.model.setExpression(FFLExpression.NORMAL);
    head.matrix.copy(matrix);
    head.matrixWorld.copy(matrix);
    head.visible = true;
    head.traverse((o) => {
      if (o !== head) o.updateMatrixWorld(true);
    });
    use(head);
    head.matrix.copy(saved);
    head.matrixWorldNeedsUpdate = true;
    head.updateMatrixWorld(true);
    head.visible = visible;
    if (expr !== FFLExpression.NORMAL && expr >= 0) s.model.setExpression(expr);
  }

  /** Height of the top of the head above the feet, at pose scale 1. */
  headTop(i: number) {
    return this.slots[i].top;
  }

  hide(i: number) {
    const s = this.slots[i];
    s.hidden = true;
    if (s.head) s.head.visible = false;
    const b = this.batches[s.gender];
    if (b) (b.bones.image.data as Float32Array).fill(0, s.row * BONES * 16, (s.row + 1) * BONES * 16);
    if (this.shadow) this.shadow.setMatrixAt(i, _m.makeScale(0, 0, 0));
  }

  setPose(i: number, p: Pose) {
    const s = this.slots[i];
    // A Mii without its head yet stays hidden, so nobody walks around headless.
    if (!s.head) return this.hide(i);
    const b = this.batches[s.gender]!;
    const body = b.body;
    s.hidden = false;
    s.head.visible = !s.card;

    const L = this.local;
    for (const q of L) q.identity();
    const set = (name: string, q: THREE.Quaternion) => {
      const j = body.bone(name);
      if (j >= 0) L[j].copy(q);
    };
    set('chest', _q.setFromEuler(_e.set(p.leanX, p.twist, -p.leanZ, 'YXZ')));
    set('chest_2', _q.setFromEuler(_e.set(p.leanX * 0.4, p.twist * 0.4, -p.leanZ * 0.4, 'YXZ')));
    set('head', _q.setFromEuler(_e.set(p.nod, p.headYaw, p.tilt, 'YXZ')));

    // An arm hangs along -y: x is the hinge it swings and bends on, y its own length, z the axis
    // that lifts it sideways.
    const arm = (side: 1 | -1, swing: number, out: number, twist: number, elbow: number) => {
      const k = side === 1 ? 0 : 1;
      _q.setFromAxisAngle(AZ, side * (out + ARM_REST))
        .multiply(_q2.setFromAxisAngle(AX, -swing))
        .multiply(_q2.setFromAxisAngle(UP, -side * twist))
        .multiply(_down[k]);
      set(side === 1 ? 'arm_l1' : 'arm_r1', _q);
      _q2.setFromAxisAngle(AX, -elbow);
      _q.copy(_downInv[k]).multiply(_q2).multiply(_down[k]);
      set(side === 1 ? 'arm_l2' : 'arm_r2', _q);
    };
    arm(1, p.swingL, p.outL, p.twistL, p.elbowL);
    arm(-1, p.swingR, p.outR, p.twistR, p.elbowR);

    // A crouch folds hip, knee and ankle by the same angle, so the foot stays flat under the hip.
    const leg = (side: 1 | -1, swing: number, bend: number) => {
      const knee = Math.max(0, -swing) * 0.7 + 0.04 + bend + p.crouch * 2;
      const hip = -swing - 0.02 - p.crouch;
      _q.setFromAxisAngle(AZ, side * p.spread).multiply(_q2.setFromAxisAngle(AX, hip));
      set(side === 1 ? 'foot_l1' : 'foot_r1', _q);
      set(side === 1 ? 'foot_l2' : 'foot_r2', _q.setFromAxisAngle(AX, knee));
      set(side === 1 ? 'ankle_l' : 'ankle_r', _q.setFromAxisAngle(AX, -(hip + knee)));
    };
    leg(1, p.legL, p.kneeL);
    leg(-1, p.legR, p.kneeR);

    // Root: position, facing and Wii U body proportions.
    const k = UNIT * p.scale;
    _hq.setFromAxisAngle(UP, p.yaw);
    if (p.pitch || p.roll) _hq.multiply(_q2.setFromEuler(_e.set(p.pitch, 0, p.roll, 'XYZ')));
    const W = this.world;
    const out = b.bones.image.data as Float32Array;
    const base = s.row * BONES * 16;
    const pelvis = body.bone('skl_root');
    const drop = 2 * LEG * (1 - Math.cos(p.crouch)) + LEG * (1 - Math.cos(p.spread)) * 2;
    for (const j of body.order) {
      const bone = body.bones[j];
      if (bone.parent < 0) {
        W[j].compose(_p.set(p.x, p.y, p.z), _hq, _s.set(k * s.sx, k * s.sy, k * s.sx));
      } else {
        _t.copy(bone.offset);
        if (j === pelvis) _t.set(_t.x + p.sway, _t.y - drop, _t.z);
        _m.compose(_t, L[j], _s.set(1, 1, 1));
        W[j].multiplyMatrices(W[bone.parent], _m);
      }
      _m.multiplyMatrices(W[j], body.inverses[j]).toArray(out, base + j * 16);
    }
    for (const t of s.tracks) t.matrix.copy(W[t.bone]);

    // Head: constant size, placed and turned by the head bone.
    const hb = body.bone('head');
    _p.setFromMatrixPosition(W[hb]);
    _q.copy(_hq).multiply(L[body.bone('chest')]).multiply(L[hb]);
    _s.set(0, HEAD_LIFT * k, 0).applyQuaternion(_q);
    s.head.matrix.compose(_p.add(_s), _q, _s.setScalar(this.headScale * k));
    s.head.matrixWorldNeedsUpdate = true;

    const expr = EXPRESSIONS[p.expr >= 2 && !s.full ? 0 : p.expr];
    if (expr !== s.expr && s.model) {
      s.model.setExpression(expr);
      s.expr = expr;
    }

    if (this.shadow) {
      // Under the middle of the body, so one lying down or tumbling has it in the right place, and
      // shrinking as the lower of the feet and the head leaves the floor.
      _s.set(0, s.top * p.scale * 0.45, 0).applyQuaternion(_hq);
      const up = Math.max(0, Math.min(p.y, p.y + _s.y * 2));
      const sh = Math.max(0, p.scale * (0.85 + s.sx * 0.25) * (1 - up * 1.9));
      this.shadow.setMatrixAt(i, _m.compose(_p.set(p.x + _s.x, 0.004, p.z + _s.z), _q.setFromAxisAngle(UP, p.yaw), _s.set(sh, 1, sh)));
    }
  }

  commit() {
    for (const b of this.batches) if (b) b.bones.needsUpdate = true;
    if (this.shadow) this.shadow.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    for (const s of this.slots) s.model?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/** Soft round contact shadow, drawn once into a small texture. */
function blobTexture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r) ** 1.6;
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
