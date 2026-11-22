// The DJ's boombox, up on their left shoulder: it follows their hand, and while they dance it hops
// down to the floor in front of them and back up when the music stops. It thumps on the beat while
// music is heard, and lets a few notes float up out of it. Two of them to choose from (BOOMBOX in
// src/data/plaza.ts): 'model' is Supersiv11's low poly boom box (public/plaza/boombox.glb, CC BY,
// 596 triangles, 11 KB), 'drawn' is built here in the plaza's own style. Both are lit the way the
// block icons are drawn, from the top left with a chunky darker side, and fade into the haze and
// show in the floor as the Miis do. Either is a single draw call; the notes are a few sprites.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { miiUniforms } from '../mii/rig';
import { MIRRORED } from './floor';
import { pulse } from './motion';

export type BoomboxKind = 'model' | 'drawn';

/** Width of the boombox in world units, at Mii size 1. A Mii's head is about 0.5 across. */
const WIDTH = 0.5;
/**
 * Where the boombox's middle sits from the DJ's left wrist, in the DJ's own frame (x toward
 * their left, y up, z forward), at Mii size 1; how far it tips toward their head; and how far it
 * turns about the upright, its end by the head going back so it never shows through the face.
 */
const HOLD = { x: 0.17, y: 0.08, z: -0.03, tip: -0.12, turn: -0.3 };
/** How much it swells on each beat. */
const THUMP = 0.07;
/** Its hop between the DJ's hand and the floor: how long it takes, in seconds, and how high it arcs. */
const HOP = { time: 0.5, height: 0.28 };
/** Notes: how many at once, how long each floats, how high it rises, its size. */
const NOTES = { count: 4, life: 1.9, rise: 0.95, size: 0.2 };

const vertex = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDepth;
  varying float vWorldY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 view = viewMatrix * world;
    vColor = color;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    vDepth = -view.z;
    vWorldY = world.y;
    gl_Position = projectionMatrix * view;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uReflectPass;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDepth;
  varying float vWorldY;
  void main() {
    vec3 n = normalize(vNormal);
    // Lit from the top left and a little in front, as the block icons are drawn: faces turned
    // away from it settle into a darker shade of their own color, never black.
    vec3 light = normalize(vec3(-0.5, 0.85, 0.6));
    float lit = 0.6 + 0.4 * max(dot(n, light), 0.0);
    // A soft gloss, as on the console's plastic.
    float gloss = pow(max(dot(reflect(-light, n), normalize(vView)), 0.0), 18.0) * 0.22;
    vec3 col = vColor * lit + gloss;
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
    if (uReflectPass > 0.5) {
      float mirror = mix(0.35, 1.0, smoothstep(2.2, 0.0, vWorldY));
      gl_FragColor = vec4(col * mirror, mirror);
    }
  }
`;

/**
 * The material the DJ's gear is drawn in (this boombox, the headset): vertex colors lit like the
 * block icons, fading into the haze and shown in the floor as the Miis are.
 */
export function gearMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: miiUniforms, vertexColors: true });
}

/** A color kept as written: every shader in the plaza writes display values directly. */
const raw = (c: string) => new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace);

export class Boombox {
  private readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly shapes = new Map<BoomboxKind, Promise<THREE.BufferGeometry | null>>();
  private kind: BoomboxKind;
  /** How much the music is heard, eased: the thump and the notes come and go with it. */
  private amp = 0;
  private readonly notes: { sprite: THREE.Sprite; born: number; drift: number; from: THREE.Vector3 }[] = [];
  /** Which pair of beats the last note floated up on. */
  private noted = -1;
  /** Whether it is on the floor, or on its way there; when it last set off; where from. */
  private down = false;
  private hopAt = -Infinity;
  private readonly hopFrom = new THREE.Vector3();
  private readonly hopTurn = new THREE.Quaternion();
  private placed = false;
  /** How far below its middle its base is, at a unit wide. */
  private base = 0.3;
  private readonly _p = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _t = new THREE.Quaternion();
  private readonly _o = new THREE.Vector3();

  /** With reduced motion it neither thumps nor lets notes float up. */
  constructor(scene: THREE.Scene, kind: BoomboxKind, private readonly calm = false) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), gearMaterial());
    this.mesh.layers.enable(MIRRORED);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.visible = false;
    scene.add(this.group);

    const tex = new THREE.CanvasTexture(noteImage());
    for (let i = 0; i < NOTES.count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      scene.add(sprite);
      this.notes.push({ sprite, born: -Infinity, drift: 0, from: new THREE.Vector3() });
    }
    this.kind = kind;
    this.show(kind);
  }

  /** Switches between the two boomboxes (`__plaza.boombox()` in dev). */
  show(kind: BoomboxKind) {
    this.kind = kind;
    let shape = this.shapes.get(kind);
    if (!shape) {
      shape = kind === 'drawn' ? Promise.resolve(drawn()) : loadModel('/plaza/boombox.glb');
      this.shapes.set(kind, shape);
    }
    void shape.then((geometry) => {
      if (!geometry || this.kind !== kind) return;
      this.mesh.geometry = geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      this.base = -geometry.boundingBox!.min.y;
    });
  }

  /**
   * Each frame: `wrist` is the DJ's left wrist in the world (null while they are out of sight),
   * `yaw` and `scale` how they stand, `beats` how many beats of the music have gone by while the
   * DJ dances (null while they stand), `heard` whether music is playing out loud, and `floor` where
   * it rests while the DJ dances (null while it is in their hand).
   */
  update(wrist: THREE.Matrix4 | null, yaw: number, scale: number, beats: number | null, heard: boolean, time: number, dt: number, floor: { x: number; z: number; yaw: number } | null) {
    const shown = wrist !== null && !!this.mesh.geometry.attributes.position;
    this.group.visible = shown;
    this.amp += ((heard && !this.calm ? 1 : 0) - this.amp) * Math.min(1, dt * 3);
    if (shown) {
      const { _p, _q, _t, _o } = this;
      if (floor) {
        // Standing on its base, facing you.
        _p.set(floor.x, this.base * WIDTH * scale, floor.z);
        _q.setFromAxisAngle(_o.set(0, 1, 0), floor.yaw);
      } else {
        _p.setFromMatrixPosition(wrist);
        _q.setFromAxisAngle(_o.set(0, 1, 0), yaw);
        _o.set(HOLD.x, HOLD.y, HOLD.z).multiplyScalar(scale).applyQuaternion(_q);
        _p.add(_o);
        // Turned so the end by the head sits back behind it rather than in it, and tipped in
        // toward the head, resting on the shoulder.
        _q.multiply(_t.setFromAxisAngle(_o.set(0, 1, 0), HOLD.turn)).multiply(_t.setFromAxisAngle(_o.set(0, 0, 1), HOLD.tip));
      }
      // Set down or taken up: it hops across from wherever it was, in an arc.
      if (!!floor !== this.down) {
        this.down = !!floor;
        if (this.placed) {
          this.hopAt = time;
          this.hopFrom.copy(this.group.position);
          this.hopTurn.copy(this.group.quaternion);
        }
      }
      const s = (time - this.hopAt) / HOP.time;
      if (s < 1 && !this.calm) {
        const e = s * s * (3 - 2 * s);
        _p.lerpVectors(this.hopFrom, _p, e);
        _p.y += HOP.height * scale * 4 * s * (1 - s);
        _q.slerpQuaternions(this.hopTurn, _t.copy(_q), e);
      }
      this.group.position.copy(_p);
      this.group.quaternion.copy(_q);
      this.group.scale.setScalar(WIDTH * scale * (1 + THUMP * this.amp * (beats === null ? 0 : pulse(beats) ** 3)));
      this.placed = true;
    }
    this.float(shown, beats, time);
  }

  /** Notes float up out of the boombox while the music plays and the DJ dances, one every other beat. */
  private float(shown: boolean, beats: number | null, time: number) {
    const pair = beats === null ? -1 : Math.floor(beats / 2);
    if (shown && this.amp > 0.5 && pair !== this.noted && pair >= 0) {
      this.noted = pair;
      const note = this.notes.find((n) => time - n.born > NOTES.life);
      if (note) {
        note.born = time;
        note.drift = (Math.random() - 0.5) * 0.5;
        note.from.copy(this.group.position);
      }
    }
    for (const n of this.notes) {
      const t = (time - n.born) / NOTES.life;
      const live = t >= 0 && t < 1;
      n.sprite.visible = live;
      if (!live) continue;
      const { from } = n;
      n.sprite.position.set(from.x + n.drift * t + Math.sin(t * 7 + n.drift * 9) * 0.06, from.y + NOTES.rise * (1 - (1 - t) ** 2), from.z);
      n.sprite.scale.setScalar(NOTES.size * (0.7 + 0.3 * Math.min(1, t * 4)));
      n.sprite.material.opacity = Math.min(1, t * 6) * (1 - t) ** 1.5;
    }
  }
}

/** Fills every vertex of `g` with one color. */
export function paint(g: THREE.BufferGeometry, color: string) {
  const c = raw(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * The plaza's own boombox, a unit wide and facing +z: a pink case with soft corners, two speakers
 * in white rims, a pale tape window, three keys and a handle, about 640 triangles.
 */
function drawn() {
  const D = 0.3;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
    g.rotateX(rx).rotateZ(rz).translate(x, y, z);
    parts.push(paint(g, color));
  };
  add(new RoundedBoxGeometry(1, 0.56, D, 1, 0.07), '#ff7eb6');
  for (const x of [-0.29, 0.29]) {
    add(new THREE.CylinderGeometry(0.195, 0.195, 0.04, 14, 1), '#f6f8fa', x, -0.03, D / 2, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 14, 1), '#2a2e36', x, -0.03, D / 2 + 0.005, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 14, 1), '#6b7380', x, -0.03, D / 2 + 0.01, Math.PI / 2);
  }
  add(new THREE.BoxGeometry(0.2, 0.13, 0.03), '#bfe8f8', 0, 0.05, D / 2);
  for (const x of [-0.07, 0, 0.07]) add(new THREE.BoxGeometry(0.05, 0.035, 0.07), '#f6f8fa', x, 0.29, 0.02);
  add(new THREE.TorusGeometry(0.3, 0.032, 6, 12, Math.PI), '#f6f8fa', 0, 0.28, -0.04);
  // The rounded case comes unindexed, so every part goes in that way.
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

/**
 * The downloaded boombox, merged into one geometry with each part's material color written onto
 * its vertices, then turned to face +z, centered on its case and scaled to a unit wide.
 */
async function loadModel(url: string) {
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Quantized attributes are copied out to plain floats before they are moved.
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal'] as const) {
        const a = mesh.geometry.getAttribute(name);
        const out = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) out.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3);
        g.setAttribute(name, new THREE.BufferAttribute(out, 3));
      }
      g.setIndex(mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null);
      g.applyMatrix4(mesh.matrixWorld);
      const base = (mesh.material as THREE.MeshStandardMaterial).color;
      // Its black case is lifted a little, so its sides still read against the night floor.
      parts.push(paint(g, base.getHex() === 0 ? '#23262c' : `#${base.getHexString(THREE.SRGBColorSpace)}`));
    });
    const g = mergeGeometries(parts);
    g.rotateY(Math.PI);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    g.translate(-(box.min.x + box.max.x) / 2, -box.min.y - size.y * 0.32, -(box.min.z + box.max.z) / 2);
    g.scale(1 / size.x, 1 / size.x, 1 / size.x);
    return g;
  } catch (err) {
    console.error('Boombox failed to load', err);
    return null;
  }
}

/** A single music note, pink with a white edge, so it reads on the pale floor and the dark one. */
function noteImage() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  const path = new Path2D();
  path.ellipse(24, 46, 11, 8.5, -0.45, 0, Math.PI * 2);
  path.rect(31, 10, 5, 37);
  path.moveTo(33, 10);
  path.bezierCurveTo(42, 14, 50, 18, 46, 32);
  path.bezierCurveTo(46, 24, 40, 21, 36, 21);
  path.closePath();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.stroke(path);
  g.fillStyle = '#e8488f';
  g.fill(path);
  return c;
}
