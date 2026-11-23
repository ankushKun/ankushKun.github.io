// The glass blocks that carry the section icons: thin squircle slabs of clear glass, gently domed
// front and back with a fully rounded rim, and a squircle picture set in the middle. The glass
// really refracts: the scene is drawn without the blocks first and copied (see main.ts), then each
// block bends its view of that copy through its own surface, so Miis and floor behind it warp
// through the rim. Rays that reach past the rim fold back onto the picture, as in the real ones.
// A block can also show a video in place of its picture (`film`, film.ts): the video plays behind
// the canvas and the glass leaves the canvas clear where the picture would be, so the rim, the
// sheen and the reflections still lie over it. Over the picture, or the video, a block can carry
// marks of its own (`uOver`, the Music block's bars: nowplaying.ts), which the video never covers.
import * as THREE from 'three';
import { HAZE } from './floor';
import { CUBE } from './layout';
import { clamp01, damp, easeOut, easeOutQuint, smoothstep } from './util';

const HALF = CUBE.size / 2;
/** Squircle exponent of the outline and the picture. Higher is squarer. */
const ROUNDNESS = 4.6;
/** Half the slab's thickness at the rim, which is also the rim's radius, and the dome on each face. */
const EDGE = CUBE.depth / 2;
const DOME = CUBE.depth * 0.22;
/** Half width of the flat of the slab, inside the rim. */
const INNER = HALF - EDGE;
/** Half width of the picture, concentric with the outline. */
export const PICTURE = INNER * 0.97;
/** Half the size of the mark a block leaves on the floor. */
const RING = { x: CUBE.size * 0.445, z: CUBE.size * 0.34 };
/** Seconds one block takes to fly in. */
const FLIGHT = 0.85;
/** Seconds its slow idle sway takes to build up once it has landed, so it starts from rest. */
const SWAY_IN = 1.2;
/** Seconds a block takes to turn once round, changing its picture (`flip`). */
const FLIP = 1.3;

/** A point on the unit squircle at angle `a`, and the outward normal there. */
function squircle(a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = 2 / ROUNDNESS;
  const x = Math.sign(c) * Math.abs(c) ** e;
  const y = Math.sign(s) * Math.abs(s) ** e;
  const nx = Math.sign(x) * Math.abs(x) ** (ROUNDNESS - 1);
  const ny = Math.sign(y) * Math.abs(y) ** (ROUNDNESS - 1);
  const l = Math.hypot(nx, ny) || 1;
  return { x, y, nx: nx / l, ny: ny / l };
}

/** The slab: a domed face, a half round rim, a domed back, all one smooth surface. */
function slab() {
  const around = 96;
  const faceRings = 14;
  const rimSteps = 14;
  const outline = Array.from({ length: around }, (_, i) => squircle((i / around) * Math.PI * 2));
  // Each ring: how far out along the outline (0 center, 1 rim start), how far past it, and height.
  const rings: [number, number, number][] = [];
  for (let i = 0; i <= faceRings; i++) {
    const s = i / faceRings;
    // The dome flattens to level just where the rim begins, so face and rim meet with no crease.
    rings.push([s, 0, EDGE + DOME * (1 - s * s) ** 2]);
  }
  for (let i = 1; i < rimSteps; i++) {
    const phi = (i / rimSteps) * Math.PI;
    rings.push([1, EDGE * Math.sin(phi), EDGE * Math.cos(phi)]);
  }
  for (let i = faceRings; i >= 0; i--) {
    const s = i / faceRings;
    rings.push([s, 0, -(EDGE + DOME * (1 - s * s) ** 2)]);
  }
  const pos: number[] = [];
  for (const [s, out, z] of rings) {
    for (const o of outline) pos.push(o.x * INNER * s + o.nx * out, o.y * INNER * s + o.ny * out, z);
  }
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < around; i++) {
      const a = r * around + i;
      const b = r * around + ((i + 1) % around);
      idx.push(a, a + around, b, b, a + around, b + around);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The two center rings collapse to a point; their normals point straight out.
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < around; i++) {
    nor.setXYZ(i, 0, 0, 1);
    nor.setXYZ((rings.length - 1) * around + i, 0, 0, -1);
  }
  return geo;
}

const glassVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;
  void main() {
    vLocal = position;
    vNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vWorldNormal = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const glassFragment = /* glsl */ `
  uniform sampler2D uIcon;
  uniform sampler2D uOver;
  uniform sampler2D uBehind;
  uniform vec2 uRes;
  uniform vec3 uEye;
  uniform vec3 uHaze;
  uniform vec2 uFog;
  uniform float uHover;
  uniform float uShow;
  uniform float uFilm;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vWorldNormal;

  const float HALF = ${HALF.toFixed(4)};
  const float PICTURE = ${PICTURE.toFixed(4)};
  const float INNER = ${INNER.toFixed(4)};
  const float N = ${ROUNDNESS.toFixed(2)};
  const vec3 KEY = vec3(-0.5, 0.75, 0.45);

  // Squircle "radius": 1 on an outline of half width 1.
  float sq(vec2 p) {
    vec2 a = abs(p) + 1e-5;
    return pow(pow(a.x, N) + pow(a.y, N), 1.0 / N);
  }

  // What the glass mirrors: bright sky above, the pale floor below, a soft horizon between.
  vec3 surroundings(vec3 d) {
    vec3 sky = mix(vec3(0.95), vec3(1.0), smoothstep(0.0, 0.5, d.y));
    vec3 ground = mix(vec3(0.89), vec3(0.76), smoothstep(0.0, -0.8, d.y));
    return mix(ground, sky, smoothstep(-0.06, 0.06, d.y));
  }

  // The scene behind the block, seen through it: shifted by the bend and a little soft.
  vec3 behind(vec2 uv) {
    vec2 px = 1.5 / uRes;
    vec3 c = texture2D(uBehind, uv).rgb * 0.4;
    c += texture2D(uBehind, uv + vec2(px.x, px.y)).rgb * 0.15;
    c += texture2D(uBehind, uv + vec2(-px.x, px.y)).rgb * 0.15;
    c += texture2D(uBehind, uv + vec2(px.x, -px.y)).rgb * 0.15;
    c += texture2D(uBehind, uv + vec2(-px.x, -px.y)).rgb * 0.15;
    return c;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 nw = normalize(vWorldNormal);
    vec3 ray = normalize(vLocal - uEye);
    vec3 look = normalize(vWorld - cameraPosition);
    float facing = clamp(dot(-ray, n), 0.0, 1.0);
    // 0 across the domed faces, 1 on the rim.
    float rim = smoothstep(0.55, 0.15, abs(n.z));

    // Into the glass and on to the picture at the middle of the slab. Past the outline the ray
    // has met the wall, which mirrors it back in: the folded picture seen round the edges.
    vec3 bent = refract(ray, n, 1.0 / 1.5);
    float t = -vLocal.z / (abs(bent.z) > 0.02 ? bent.z : -sign(vLocal.z) * 0.02);
    vec2 hit = vLocal.xy + bent.xy * max(t, 0.0);
    float r = sq(hit);
    float folded = smoothstep(HALF * 0.97, HALF * 1.03, r);
    hit *= mix(1.0, max(2.0 * HALF - r, 0.0) / r, folded);
    // Through the rim the glass acts as a strong lens: it folds the picture's edge round the sides.
    float out_ = sq(vLocal.xy);
    float lens = smoothstep(INNER * 0.82, INNER * 1.12, out_);
    // The fold shows all round the rim, strongest down the sides.
    float flank = smoothstep(0.4, 0.85, abs(vLocal.x) / (abs(vLocal.x) + abs(vLocal.y) + 1e-4));
    vec2 wrapped = vLocal.xy * max(PICTURE - (out_ - INNER) * 1.8 - 0.02, 0.0) / out_;
    hit = mix(hit, wrapped, lens);
    folded = max(folded, lens);
    r = sq(hit);
    // No hard edge anywhere: the picture fades into the glass over a band, not a line.
    float soft = max(fwidth(r), 0.004);
    float there = (1.0 - smoothstep(PICTURE - 0.16 - soft, PICTURE + soft, r)) * smoothstep(-0.05, 0.05, t) * mix(1.0, mix(0.0, 0.85, flank), lens);
    vec2 uv = hit / (2.0 * PICTURE) + 0.5;
    // Seen from behind, the picture reads mirrored.
    if (vLocal.z < 0.0) uv.x = 1.0 - uv.x;
    vec3 picture = texture2D(uIcon, uv).rgb;
    vec4 over = texture2D(uOver, uv);
    vec3 art = mix(picture, over.rgb, over.a);
    // How much of the picture itself is left in the art after the fold dims and the lens whitens it.
    float dim = mix(1.0, 0.9, folded) * (1.0 - lens * 0.08);
    art *= mix(1.0, 0.9, folded);
    art = mix(art, vec3(1.0), lens * 0.08);

    // Whatever is behind, through the glass: bent by the surface, strongest where it curves.
    vec3 bendW = refract(look, nw, 1.0 / 1.5) - look;
    vec2 shift = (viewMatrix * vec4(bendW, 0.0)).xy * mix(0.035, 0.11, rim);
    vec3 through = behind(gl_FragCoord.xy / uRes + shift);
    through = mix(through, vec3(1.0), 0.04 + 0.05 * rim);

    vec3 col = mix(through, art, there);
    // How much of the picture reaches the eye through everything laid over it below.
    float seen = there;

    // Reflection off the surface: faint head on, strong as it turns away.
    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    // Facing the sky (the top of the rim from where the camera stands) the glass is mostly mirror.
    float sky = smoothstep(0.15, 0.75, nw.y) * rim;
    float mirror = clamp(fresnel * 0.9 + sky * 0.7, 0.0, 1.0);
    col = mix(col, surroundings(reflect(look, nw)), mirror);
    seen *= 1.0 - mirror;

    // Light on glass: a broad sheen on the top of the rim, a hard glint, and the thin dark line
    // glass shows right at its silhouette.
    float lit = max(dot(nw, normalize(KEY)), 0.0);
    col += rim * smoothstep(0.2, 0.9, lit) * 0.12;

    col += pow(max(dot(reflect(look, nw), normalize(KEY)), 0.0), 90.0) * 0.85;
    float edge = 1.0 - 0.28 * smoothstep(0.82, 0.98, 1.0 - facing);
    col *= edge;
    seen *= edge;

    float fog = smoothstep(uFog.x, uFog.y, length(vWorld - cameraPosition)) * 0.7;
    col = mix(col, uHaze, fog);
    seen *= 1.0 - fog;

    if (uFilm > 0.0) {
      // The video behind the canvas stands in for the picture seen straight through the face; the
      // picture folded round the rim stays, and so do the marks over it. Drawn without blending,
      // over the scene as copied.
      float clear = seen * (1.0 - folded) * uFilm * uShow * (1.0 - over.a);
      vec3 scene = texture2D(uBehind, gl_FragCoord.xy / uRes).rgb;
      gl_FragColor = vec4(mix(scene, col, uShow) - picture * dim * clear, 1.0 - clear);
      return;
    }
    gl_FragColor = vec4(col, uShow);
  }
`;

const ringVertex = /* glsl */ `
  varying vec2 vAt;
  void main() {
    vAt = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The mark a block leaves on the floor: the outline of its footprint, with the light it gathers inside.
const ringFragment = /* glsl */ `
  uniform float uShow;
  uniform float uHover;
  varying vec2 vAt;
  void main() {
    const vec2 HALF = vec2(${RING.x.toFixed(3)}, ${RING.z.toFixed(3)});
    const float ROUND = ${(RING.z * 0.82).toFixed(3)};
    vec2 q = abs(vAt) - HALF + ROUND;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ROUND;
    // A faint, soft mark: a light outline with a gentle shade and a little gathered light inside.
    float line = exp(-pow(d / 0.14, 2.0));
    float shade = exp(-pow((d - 0.05) / 0.55, 2.0)) * 0.35;
    float glow = smoothstep(0.05, -0.9, d);
    vec3 dark = vec3(0.64, 0.68, 0.68) * (1.0 - uHover * 0.1);
    float a = clamp(line * 0.2 + shade * 0.14, 0.0, 1.0);
    vec3 col = mix(vec3(1.0), dark, clamp(a / (a + glow * 0.12 + 0.001), 0.0, 1.0));
    gl_FragColor = vec4(col, (a + glow * 0.12) * uShow);
  }
`;

interface Item {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  home: THREE.Vector3;
  /** Where it starts its flight: a screen position just past the edge, and how near the lens. */
  from: THREE.Vector3;
  spin: THREE.Euler;
  delay: number;
  phase: number;
  hover: number;
  hovering: boolean;
  /** Where the pointer is over the block, -1..1 each way, and the lean it has eased into. */
  point: THREE.Vector2;
  lean: THREE.Vector2;
  /** How far it has turned to face the mouse, eased. */
  turn: THREE.Vector2;
  /** Spun by hand: where the drag wants it (x turns it round, y tips it over), where it is, how fast it moves. */
  twirl: { want: THREE.Vector2; at: THREE.Vector2; speed: THREE.Vector2; held: boolean };
  /** Turning once round to change its picture: when it began, which way, and the picture it shows once edge on (null after). */
  flip: { at: number; dir: number; next: THREE.Texture | null; done: (old: THREE.Texture) => void } | null;
}

const _spin = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
/** Nothing over the picture. */
const BARE = new THREE.DataTexture(new Uint8Array(4), 1, 1);
BARE.needsUpdate = true;
const REST = new THREE.Quaternion().setFromEuler(new THREE.Euler(-CUBE.tilt, 0, 0));

export class Cubes {
  readonly items: Item[] = [];
  private fog = new THREE.Vector2(80, 105);
  private launched = -Infinity;
  /** The mouse on screen, -1..1 across and up. Every block turns a little toward it. */
  private mouse = new THREE.Vector2();
  private watching = false;
  private behind = { value: null as THREE.Texture | null };
  private res = { value: new THREE.Vector2(1, 1) };

  /** The rings go in `scene`; the glass in `glass`, which is drawn after it. */
  constructor(scene: THREE.Scene, glass: THREE.Scene, icons: THREE.Texture[]) {
    const geo = slab();
    const ringGeo = new THREE.PlaneGeometry(RING.x * 2 + 2, RING.z * 2 + 2).rotateX(-Math.PI / 2);
    icons.forEach((icon, i) => {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          vertexShader: glassVertex,
          fragmentShader: glassFragment,
          uniforms: {
            uIcon: { value: icon },
            uOver: { value: BARE },
            uBehind: this.behind,
            uRes: this.res,
            uEye: { value: new THREE.Vector3(0, 0, 10) },
            uHaze: { value: HAZE },
            uFog: { value: this.fog },
            uHover: { value: 0 },
            uShow: { value: 1 },
            uFilm: { value: 0 },
          },
          transparent: true,
          depthWrite: true,
        }),
      );
      mesh.visible = false;
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.ShaderMaterial({
          vertexShader: ringVertex,
          fragmentShader: ringFragment,
          uniforms: { uShow: { value: 0 }, uHover: { value: 0 } },
          transparent: true,
          depthWrite: false,
        }),
      );
      ring.renderOrder = -1;
      ring.visible = false;
      glass.add(mesh);
      scene.add(ring);
      this.items.push({
        mesh,
        ring,
        home: new THREE.Vector3(),
        from: new THREE.Vector3(),
        spin: new THREE.Euler(),
        delay: 0,
        phase: i * 2.4,
        hover: 0,
        hovering: false,
        point: new THREE.Vector2(),
        lean: new THREE.Vector2(),
        turn: new THREE.Vector2(),
        twirl: { want: new THREE.Vector2(), at: new THREE.Vector2(), speed: new THREE.Vector2(), held: false },
        flip: null,
      });
    });
  }

  /**
   * How far block `i` shows the video behind the canvas in place of its picture, 0 to 1. While it
   * does, it writes the canvas's alpha itself rather than blending.
   */
  film(i: number, amount: number) {
    const material = this.items[i]?.mesh.material;
    if (!material) return;
    material.uniforms.uFilm.value = amount;
    material.blending = amount > 0 ? THREE.NoBlending : THREE.NormalBlending;
  }

  /** The copy of the scene the glass looks through, and its size in pixels. */
  setBehind(texture: THREE.Texture, width: number, height: number) {
    this.behind.value = texture;
    this.res.value.set(width, height);
  }

  /**
   * Hangs each block over its floor point and plans its flight in: every block starts just past
   * the edge of the screen it is nearest to, close to the lens, and tumbles out to its place.
   */
  place(anchors: THREE.Vector3[], camera: THREE.PerspectiveCamera) {
    // They arrive in turn, sweeping round the screen from the bottom left, as on the console.
    const turn = anchors.map((a) => {
      _v.set(a.x, CUBE.lift, a.z).project(camera);
      // Clockwise from the bottom left.
      return (((-0.75 * Math.PI - Math.atan2(_v.y, _v.x * camera.aspect)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    });
    const order = turn.map((_, i) => i).sort((a, b) => turn[a] - turn[b]);
    this.items.forEach((item, i) => {
      const a = anchors[i];
      if (!a) return;
      item.home.set(a.x, CUBE.lift, a.z);
      item.ring.position.set(a.x, 0.01, a.z);
      _v.copy(item.home).project(camera);
      // Straight out from the middle of the screen through the block's place, to past the edge.
      const out = Math.max(Math.abs(_v.x), Math.abs(_v.y)) || 1;
      const near = 0.24 + (i % 3) * 0.07;
      item.from.set((_v.x / out) * 1.9, (_v.y / out) * 1.9, near);
      const side = _v.x < 0 ? -1 : 1;
      item.spin.set(0.7 * (i % 2 ? 1 : -1), side * (2.3 + (i % 3) * 0.5), side * 0.5);
      item.delay = (order.indexOf(i) / Math.max(1, anchors.length - 1)) * 1.15;
    });
  }

  /** Starts the flight in at `time`. */
  launch(time: number) {
    this.launched = time;
  }

  /** Everything in place, no flight. */
  settle() {
    this.launched = -Infinity;
  }

  setHaze(near: number, far: number) {
    this.fog.set(near, far);
  }

  setHover(i: number, on: boolean) {
    const item = this.items[i];
    if (!item) return;
    item.hovering = on;
    if (!on) item.point.set(0, 0);
  }

  /** Where the mouse is, -1..1 across and up the screen; `null` when it has left the page. */
  setMouse(at: THREE.Vector2 | null) {
    this.watching = at !== null;
    if (at) this.mouse.copy(at);
  }

  /**
   * Turns block `i` once round on its upright axis, starting at `time`, its picture becoming `icon`
   * as it passes edge on. `done` is handed the picture it had, once nothing shows it.
   */
  flip(i: number, icon: THREE.Texture, time: number, done: (old: THREE.Texture) => void) {
    const item = this.items[i];
    if (!item || item.flip) return false;
    item.flip = { at: time, dir: item.phase % 2 < 1 ? 1 : -1, next: icon, done };
    return true;
  }

  /** Whether block `i` is pointed at or held, so its picture must not change under the pointer. */
  engaged(i: number) {
    const item = this.items[i];
    return !!item && (item.hovering || item.twirl.held);
  }

  /** Whether block `i` is turning to change its picture. */
  flipping(i: number) {
    return !!this.items[i]?.flip;
  }

  /** Starts spinning block `i` by hand. */
  grab(i: number) {
    const t = this.items[i]?.twirl;
    if (!t) return;
    t.held = true;
    t.want.copy(t.at);
  }

  /** Turns a held block: `x` round its upright axis, `y` tipping it over, in radians. */
  twist(i: number, x: number, y: number) {
    const t = this.items[i]?.twirl;
    if (t?.held) t.want.x += x, (t.want.y += y);
  }

  /** Lets go: the block springs back to rest, overshooting a little on the way. */
  release(i: number) {
    const t = this.items[i]?.twirl;
    if (!t) return;
    t.held = false;
    t.want.set(0, 0);
  }

  /** The pointer's place over block `i`, -1..1 across and down. The block leans to meet it. */
  setPoint(i: number, x: number, y: number) {
    this.items[i]?.point.set(x, y);
  }

  /**
   * `reach` is how far the camera stands from what it looks at. `shown` fades the blocks out, for
   * when the camera comes in so close that they would only be in the way.
   */
  update(time: number, dt: number, calm: boolean, camera: THREE.PerspectiveCamera, reach: number, shown: number) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const item of this.items) {
      const p = clamp01((time - this.launched - item.delay) / FLIGHT);
      item.mesh.visible = item.ring.visible = p > 0;
      if (p <= 0) continue;

      const fly = easeOutQuint(p);
      const mesh = item.mesh;
      // The start rides with the camera, so blocks sweep past the lens as it pulls back.
      const depth = reach * item.from.z;
      _v.set(item.from.x * tan * camera.aspect * depth, item.from.y * tan * depth, -depth).applyMatrix4(camera.matrixWorld);
      mesh.position.lerpVectors(_v, item.home, fly);

      // Tumbling that winds down, with a last small rock as it comes to rest.
      const wind = 1 - easeOut(p);
      const rock = Math.sin(p * 9) * Math.exp(-p * 5) * 0.5;
      _e.set(item.spin.x * wind + rock * 0.3, item.spin.y * wind + rock, item.spin.z * wind);
      mesh.quaternion.copy(REST).multiply(_spin.setFromEuler(_e));

      let bob = 0;
      // A slow sway, enough for the picture to shift behind the glass. It builds up from nothing
      // once the block has landed: switched on at full strength, it would jolt the block to
      // wherever the sway happened to be.
      const sway = calm ? 0 : smoothstep(0, SWAY_IN, time - this.launched - item.delay - FLIGHT);
      if (sway > 0) {
        bob = Math.sin(time * 0.75 + item.phase) * 0.055 * sway;
        _e.set(Math.sin(time * 0.5 + item.phase) * 0.03 * sway, Math.sin(time * 0.37 + item.phase * 0.7) * 0.07 * sway, Math.sin(time * 0.43 + item.phase) * 0.01 * sway);
        mesh.quaternion.multiply(_spin.setFromEuler(_e));
      }
      item.hover = damp(item.hover, item.hovering ? 1 : 0, 14, dt);
      item.lean.x = damp(item.lean.x, item.point.x, 9, dt);
      item.lean.y = damp(item.lean.y, item.point.y, 9, dt);
      // Turn a little toward the mouse, each from where it hangs, so the set follows it together.
      let tx = 0;
      let ty = 0;
      if (this.watching && !calm) {
        _v2.copy(item.home).project(camera);
        tx = Math.max(-1, Math.min(1, (this.mouse.x - _v2.x) * camera.aspect * 0.5));
        ty = Math.max(-1, Math.min(1, (this.mouse.y - _v2.y) * 0.5));
      }
      item.turn.x = damp(item.turn.x, tx, 4, dt);
      item.turn.y = damp(item.turn.y, ty, 4, dt);
      mesh.quaternion.multiply(_spin.setFromEuler(_e.set(item.lean.y * 0.3 - item.turn.y * 0.32, item.lean.x * 0.42 + item.turn.x * 0.42, 0)));

      // Turning once round to a new picture: eased in and out, the picture changing edge on, where
      // nobody sees it go.
      if (item.flip) {
        const f = clamp01((time - item.flip.at) / (calm ? 0.01 : FLIP));
        const turn = (f < 0.5 ? 4 * f * f * f : 1 - (-2 * f + 2) ** 3 / 2) * Math.PI * 2;
        const u = mesh.material.uniforms.uIcon;
        if (item.flip.next && (turn >= Math.PI / 2 || f >= 1)) {
          const old = u.value as THREE.Texture;
          u.value = item.flip.next;
          item.flip.next = null;
          item.flip.done(old);
        }
        if (f >= 1) item.flip = null;
        else mesh.quaternion.multiply(_spin.setFromAxisAngle(_up.set(0, 1, 0), turn * (item.flip?.dir ?? 1)));
      }

      // Spun by hand: a stiff spring while held, so it follows with a little give, and a soft,
      // springy one once let go, so it swings back past rest and settles. Small steps keep it stable.
      const tw = item.twirl;
      const stiff = tw.held ? 260 : calm ? 60 : 70;
      const drag = tw.held ? 28 : calm ? 16 : 7;
      for (let s = 0, n = Math.ceil(dt / 0.004); s < n; s++) {
        const h = dt / n;
        tw.speed.x += (stiff * (tw.want.x - tw.at.x) - drag * tw.speed.x) * h;
        tw.speed.y += (stiff * (tw.want.y - tw.at.y) - drag * tw.speed.y) * h;
        tw.at.x += tw.speed.x * h;
        tw.at.y += tw.speed.y * h;
      }
      if (tw.at.x || tw.at.y) {
        // Turn about the camera's own up and right, so the block rolls the way the hand moves.
        _q1.setFromAxisAngle(_up.set(0, 1, 0).applyQuaternion(camera.quaternion), tw.at.x);
        _q2.setFromAxisAngle(_right.set(1, 0, 0).applyQuaternion(camera.quaternion), tw.at.y);
        mesh.quaternion.premultiply(_q2).premultiply(_q1);
      }
      mesh.position.y += bob + item.hover * 0.12;
      mesh.scale.setScalar(1 + item.hover * 0.07);
      mesh.updateMatrixWorld();

      const u = mesh.material.uniforms;
      u.uHover.value = item.hover;
      u.uShow.value = smoothstep(0, 0.12, p) * shown;
      mesh.visible = shown > 0.01;
      (u.uEye.value as THREE.Vector3).copy(camera.position).applyMatrix4(_m.copy(mesh.matrixWorld).invert());

      const ru = item.ring.material.uniforms;
      ru.uShow.value = smoothstep(0.55, 1, p) * (1 - bob * 1.4) * shown;
      ru.uHover.value = item.hover;
      item.ring.scale.setScalar(1 + bob * 0.5 + item.hover * 0.06);
    }
  }

  /** Screen center and half width of block `i`, in pixels. */
  project(i: number, camera: THREE.Camera, w: number, h: number) {
    const mesh = this.items[i].mesh;
    _v.copy(mesh.position).project(camera);
    const x = (_v.x + 1) * 0.5 * w;
    const y = (1 - _v.y) * 0.5 * h;
    _v2.set(HALF * mesh.scale.x, 0, 0).applyQuaternion(camera.quaternion).add(mesh.position).project(camera);
    return { x, y, r: Math.abs((_v2.x + 1) * 0.5 * w - x), visible: mesh.visible && _v.z > -1 && _v.z < 1 && this.items[i].mesh.material.uniforms.uShow.value > 0.9 };
  }

  position(i: number, out: THREE.Vector3) {
    return out.copy(this.items[i].mesh.position);
  }
}
