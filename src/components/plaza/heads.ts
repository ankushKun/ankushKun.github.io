// Distant heads as flat pictures. A Mii head is six separate meshes, so a crowd of a hundred is
// some six hundred draw calls a frame, twice over with the floor's reflection, which is what slows
// cheap laptops and phones. Yet across the plaza a head is only twenty-odd pixels tall. So once
// each head exists it is photographed from eight angles into one texture, and every head small
// enough on screen is drawn instead as a picture facing the camera, all of them in a single draw
// call, showing whichever photograph is nearest the angle it's seen from. (Blending two neighbours
// laid two half-faces over each other.) Up close the real heads return. Each photograph has a
// depth picture beside it, so every pixel of a card sits as deep as the head it shows: long hair
// hanging behind the shoulders goes behind the body, as it does on a real head, while the face and
// a beard stay in front of it.
import * as THREE from 'three';
import { miiUniforms, type MiiSet } from '../mii/rig';
import { MIRRORED } from './floor';

/** Photographs per head, evenly round: one every 30 degrees, so turning steps are small. */
const ANGLES = 12;
/** Square framing for a head, in its own units (FFL units): half its size, and its centre height. */
const FRAME = { half: 56, mid: 35 };
/**
 * A head's frame larger on screen than this many times its photograph is drawn for real, as the
 * picture would look soft; with a little give either way so it doesn't flicker at the line.
 */
const SWAP = { up: 1.5, down: 1.3 };
/**
 * How far in front of or behind the head's middle a depth picture reaches, in its own units. Depth
 * pictures are half the photographs' size, one channel: depth needs far less detail than color.
 */
const REACH = 80;

const vertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute float aTile;
  attribute float aYaw;
  attribute float aShow;
  uniform vec2 uGrid;
  uniform float uReflectPass;
  varying vec2 vUv0;
  varying float vShow;
  varying float vDepth;
  varying float vY;
  // For placing each pixel at its real depth: the card's own depth in view, how far the head's
  // middle and the card are from the camera, world units per head unit, and the projection's depth terms.
  varying float vViewZ;
  varying float vDist;
  varying float vCard;
  varying float vScale;
  varying vec2 vProj;

  void main() {
    // Upright, turned to face the camera about the vertical only, like a person would be.
    vec3 toCam = cameraPosition - aCenter;
    vec3 level = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-5, 0.0, 0.0));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), level));
    // A picture through the middle of the head would let the top of the neck, which reaches up
    // inside the real head, poke out in front of the face. So it stands at the front of the head
    // instead, moved along the line of sight and shrunk to match, which looks exactly the same.
    float dist = length(toCam);
    float push = min(aSize * 0.42, dist * 0.5);
    vec3 center = aCenter + toCam / dist * push;
    vec3 world = center + (right * position.x + vec3(0.0, 1.0, 0.0) * position.y) * aSize * ((dist - push) / dist);

    // Which photograph: the one taken nearest the angle the camera sees the face from.
    float rel = atan(level.x, level.z) - aYaw;
    float a0 = mod(floor(rel / 6.2831853 * ${ANGLES.toFixed(1)} + 0.5), ${ANGLES.toFixed(1)});
    vec2 uv = position.xy + 0.5;
    float t0 = aTile * ${ANGLES.toFixed(1)} + a0;
    vUv0 = (vec2(mod(t0, uGrid.x), floor(t0 / uGrid.x)) + uv) / uGrid;

    vShow = aShow;
    vY = world.y;
    vec4 view = viewMatrix * vec4(world, 1.0);
    vDepth = -view.z;
    vViewZ = view.z;
    vDist = dist;
    vCard = dist - push;
    vScale = aSize / ${(FRAME.half * 2).toFixed(1)};
    vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
    gl_Position = projectionMatrix * view;
    if (aShow < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform sampler2D uDepthAtlas;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uReflectPass;
  varying vec2 vUv0;
  varying float vDepth;
  varying float vY;
  varying float vViewZ;
  varying float vDist;
  varying float vCard;
  varying float vScale;
  varying vec2 vProj;

  void main() {
    vec4 c = texture2D(uAtlas, vUv0);
    if (c.a < 0.5) discard;
    // How far toward the camera this pixel of the head is from its middle, in head units, and so
    // how far along its line of sight the real head is: the card stands in front of it, scaled down.
    float toward = (texture2D(uDepthAtlas, vUv0).r - 0.5) * ${(2 * REACH).toFixed(1)};
    float z = vViewZ * (vDist - toward * vScale) / vCard;
    gl_FragDepth = (vProj.x * z + vProj.y) / -z * 0.5 + 0.5;
    vec3 col = c.rgb / max(c.a, 1e-3);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
    if (uReflectPass > 0.5) {
      float mirror = mix(0.35, 1.0, smoothstep(2.2, 0.0, vY));
      gl_FragColor = vec4(col * mirror, mirror);
    }
  }
`;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3();
const _v = new THREE.Vector3();

export class HeadCards {
  private atlas: THREE.WebGLRenderTarget;
  private depthAtlas: THREE.WebGLRenderTarget;
  /** Draws a head as its depth toward the eye, for the depth pictures. */
  private depthOnly = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vToward;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vToward = view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vToward;
      void main() {
        gl_FragColor = vec4(clamp(0.5 + vToward / ${(2 * REACH).toFixed(1)}, 0.0, 1.0), 0.0, 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  private mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private grid: THREE.Vector2;
  private baked: boolean[];
  private next = 0;
  private using: boolean[];
  private stage = new THREE.Scene();
  private empty = new THREE.Scene();
  private eye: THREE.OrthographicCamera;
  private tile: number;
  private attrs: Record<'center' | 'size' | 'yaw' | 'show', THREE.InstancedBufferAttribute>;

  constructor(
    scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private set: MiiSet,
    /** Pixels per photograph (may come down to fit the texture). */
    tile: number,
  ) {
    const n = set.count;
    // Within the GPU's texture limit: shrink the photographs if the crowd wouldn't fit.
    const limit = Math.min(4096, renderer.capabilities.maxTextureSize);
    while (Math.ceil((n * ANGLES) / Math.floor(limit / tile)) * tile > limit && tile > 24) tile -= 8;
    this.tile = tile;
    const perRow = Math.floor(Math.min(limit, 2048 * 2) / tile);
    const rows = Math.ceil((n * ANGLES) / perRow);
    this.grid = new THREE.Vector2(perRow, rows);
    this.atlas = new THREE.WebGLRenderTarget(perRow * tile, rows * tile, {
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    // Half size, no smaller copies: the card picks its depth at the same place as its color.
    this.depthAtlas = new THREE.WebGLRenderTarget((perRow * tile) / 2, (rows * tile) / 2, {
      depthBuffer: true,
      format: THREE.RedFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.baked = new Array(n).fill(false);
    this.using = new Array(n).fill(false);
    this.eye = new THREE.OrthographicCamera(-FRAME.half, FRAME.half, FRAME.mid + FRAME.half, FRAME.mid - FRAME.half, -300, 300);

    const geo = new THREE.PlaneGeometry(1, 1);
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { center: attr(3), size: attr(1), yaw: attr(1), show: attr(1) };
    const tiles = new THREE.InstancedBufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1);
    geo.setAttribute('aCenter', this.attrs.center);
    geo.setAttribute('aSize', this.attrs.size);
    geo.setAttribute('aYaw', this.attrs.yaw);
    geo.setAttribute('aShow', this.attrs.show);
    geo.setAttribute('aTile', tiles);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uAtlas: { value: this.atlas.texture }, uDepthAtlas: { value: this.depthAtlas.texture }, uGrid: { value: this.grid }, ...miiUniforms },
      alphaToCoverage: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(MIRRORED);
    scene.add(this.mesh);
  }

  /** Photographs heads that are built but not yet taken, until `deadline` (performance.now() ms). */
  bake(deadline: number) {
    const r = this.renderer;
    const n = this.set.count;
    if (this.next >= n) return true;
    const target = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color());
    const clearAlpha = r.getClearAlpha();
    const fog = [miiUniforms.uFogNear.value, miiUniforms.uFogFar.value];
    const reflect = miiUniforms.uReflectPass.value;
    miiUniforms.uFogNear.value = 1e6;
    miiUniforms.uFogFar.value = 2e6;
    miiUniforms.uReflectPass.value = 0;
    r.setClearColor(0x000000, 0);
    const autoClear = r.autoClear;
    r.autoClear = false;
    // Smaller copies of the texture (for distant heads) are made once at the end, not per photo.
    this.atlas.texture.generateMipmaps = false;
    this.atlas.scissorTest = true;
    this.depthAtlas.scissorTest = true;
    let done = 0;
    while (this.next < n && (done === 0 || performance.now() < deadline)) {
      const i = this.next;
      if (!this.set.hasHead(i)) break;
      for (let a = 0; a < ANGLES; a++) {
        const t = i * ANGLES + a;
        const x = (t % this.grid.x) * this.tile;
        const y = Math.floor(t / this.grid.x) * this.tile;
        this.atlas.viewport.set(x, y, this.tile, this.tile);
        this.atlas.scissor.set(x, y, this.tile, this.tile);
        r.setRenderTarget(this.atlas);
        r.clear();
        // Turned so the camera sees it from angle a, counted round from the front.
        _m.makeRotationY(-(a / ANGLES) * Math.PI * 2);
        this.set.lendHead(i, _m, (head) => {
          const parent = head.parent;
          this.stage.add(head);
          r.render(this.stage, this.eye);
          // The same view again as depth, into the same place in the depth pictures.
          const half = this.tile / 2;
          this.depthAtlas.viewport.set(x / 2, y / 2, half, half);
          this.depthAtlas.scissor.set(x / 2, y / 2, half, half);
          r.setRenderTarget(this.depthAtlas);
          r.clear();
          this.stage.overrideMaterial = this.depthOnly;
          r.render(this.stage, this.eye);
          this.stage.overrideMaterial = null;
          r.setRenderTarget(this.atlas);
          parent?.add(head);
        });
      }
      this.baked[i] = true;
      this.next++;
      done++;
    }
    if (done) {
      // An empty draw, so three.js rebuilds the texture's smaller copies once for this batch.
      this.atlas.texture.generateMipmaps = true;
      this.atlas.scissor.set(0, 0, 1, 1);
      r.setRenderTarget(this.atlas);
      r.render(this.empty, this.eye);
    }
    this.atlas.scissorTest = false;
    this.depthAtlas.scissorTest = false;
    r.autoClear = autoClear;
    r.setRenderTarget(target);
    r.setClearColor(clear, clearAlpha);
    miiUniforms.uFogNear.value = fog[0];
    miiUniforms.uFogFar.value = fog[1];
    miiUniforms.uReflectPass.value = reflect;
    return this.next >= n;
  }

  /**
   * Chooses, Mii by Mii, picture or real head for this frame, and places the pictures.
   * `pxPerUnit` is device pixels per world unit at distance 1 (screen height over 2 tan(fov/2)).
   */
  update(camera: THREE.Camera, pxPerUnit: number, enabled: boolean) {
    const { center, size, yaw, show } = this.attrs;
    for (let i = 0; i < this.set.count; i++) {
      const m = this.set.headMatrix(i);
      let on = false;
      // A Mii someone is playing with keeps its real head, which can pull faces.
      if (m && enabled && this.baked[i] && !this.set.isHidden(i) && !this.set.isFull(i)) {
        m.decompose(_p, _q, _s);
        const scale = _s.x;
        // The head's centre, up its own axis, and the way its face points.
        _v.set(0, FRAME.mid * scale, 0).applyQuaternion(_q).add(_p);
        const px = (FRAME.half * 2 * scale * pxPerUnit) / Math.max(0.1, _v.distanceTo(camera.position));
        on = this.using[i] ? px < SWAP.up * this.tile : px < SWAP.down * this.tile;
        if (on) {
          _z.set(0, 0, 1).applyQuaternion(_q);
          center.setXYZ(i, _v.x, _v.y, _v.z);
          size.setX(i, FRAME.half * 2 * scale);
          yaw.setX(i, Math.atan2(_z.x, _z.z));
        }
      }
      if (on !== this.using[i]) {
        this.using[i] = on;
        this.set.setCard(i, on);
      }
      show.setX(i, on ? 1 : 0);
    }
    center.needsUpdate = size.needsUpdate = yaw.needsUpdate = show.needsUpdate = true;
  }
}
