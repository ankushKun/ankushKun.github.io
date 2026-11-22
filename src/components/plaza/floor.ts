// The plaza floor: rows of dotted hexagon tiles in white grout, glossy enough to mirror the Miis
// and to catch broad soft glare, fading into pale haze with distance. Colors are written as
// display values, picked off captures of the Wii U. At night (dark mode) the same floor is lit
// low: dark tiles, dim grout, a cool glare and a deep blue-grey haze (`setNight`).
import * as THREE from 'three';
import { miiUniforms } from '../mii/rig';

/** The haze by day and by night. */
const HAZE_DAY = new THREE.Color(0.895, 0.94, 0.95);
const HAZE_NIGHT = new THREE.Color(0.075, 0.09, 0.102);
/** The haze, and the canvas behind everything: between day and night as the lights change. */
export const HAZE = HAZE_DAY.clone();
/** Layer for what the floor mirrors. */
export const MIRRORED = 1;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec2 uFog;
  uniform vec2 uRes;
  uniform sampler2D uMirror;
  uniform float uTime;
  uniform float uNight;
  varying vec3 vWorld;

  // Tiles sit on a triangular grid: PITCH apart along a row, rows half a step over.
  const float PITCH = 0.87;
  const float ROW = 0.8660254;

  // Hexagon with points left and right, r from center to its flat edges.
  float hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float clouds(vec2 p) {
    return 0.55 * noise(p) + 0.3 * noise(p * 2.07 + 7.1) + 0.15 * noise(p * 4.3 + 3.3);
  }

  void main() {
    vec3 GROUT = mix(vec3(0.93, 0.96, 0.96), vec3(0.155, 0.18, 0.195), uNight);
    vec3 TILE = mix(vec3(0.795, 0.835, 0.812), vec3(0.095, 0.112, 0.122), uNight);
    vec3 DOT = mix(vec3(0.915, 0.94, 0.925), vec3(0.17, 0.195, 0.205), uNight);
    vec3 GLARE = mix(vec3(0.972, 0.992, 0.992), vec3(0.24, 0.285, 0.31), uNight);

    vec2 p = vWorld.xz / PITCH;
    float row = floor(p.y / ROW + 0.5);
    vec2 c = vec2(p.x - 0.5 * mod(row, 2.0), p.y - row * ROW);
    c.x -= floor(c.x + 0.5);

    // How much of the pattern one pixel covers. Past a point it is drawn as its own average.
    float grain = length(fwidth(p));
    // A touch deeper than wide: through the long lens that reads as the plaza's woven net.
    float d = hexagon(vec2(c.x, c.y / 1.3), 0.27) - 0.085;
    float tile = 1.0 - smoothstep(-grain * 0.6, grain * 0.6, d);

    // Light dots across each tile, swelling toward its edge so the rim breaks up like a halftone.
    vec2 g = p * 16.0;
    float fine = length(fwidth(g));
    float swell = smoothstep(-0.17, 0.0, d);
    float size = mix(0.26, 0.5, swell * swell);
    float dots = 1.0 - smoothstep(size - fine * 0.6, size + fine * 0.6, length(fract(g) - 0.5));
    dots = mix(dots, 3.14159 * size * size, smoothstep(0.35, 0.9, fine));

    vec3 col = mix(GROUT, mix(TILE, DOT, dots), tile);
    // Far away the eye reads the tiles as a soft weave.
    col = mix(col, mix(GROUT, mix(TILE, DOT, 0.3), 0.5), smoothstep(0.7, 1.5, grain));

    // Glare: broad soft light sliding over the gloss, washing the pattern out where it lands.
    vec3 toEye = normalize(cameraPosition - vWorld);
    vec2 drift = vec2(vWorld.x * 0.04 + vWorld.z * 0.015, vWorld.z * 0.013 - vWorld.x * 0.012) + toEye.xz * 2.4 + vec2(uTime * 0.008, 0.0);
    float cloud = clouds(drift);
    float glare = smoothstep(0.34, 0.58, cloud);
    col = mix(col, GLARE, glare * 0.9);
    col *= mix(vec3(0.86, 0.91, 0.94), vec3(1.0), smoothstep(0.14, 0.46, cloud));
    // A breath of color along the edge of the glare, like light through glass.
    float fringe = smoothstep(0.36, 0.43, cloud) * (1.0 - smoothstep(0.45, 0.56, cloud));
    col += (cos(6.2831 * (cloud * 2.6 + vec3(0.0, 0.33, 0.67))) * 0.5) * 0.03 * fringe;

    // The Miis, mirrored: smeared a little down the screen and laid over the gloss.
    vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
    vec2 px = 1.0 / uRes;
    vec4 m = texture2D(uMirror, uv) * 0.34
      + texture2D(uMirror, uv + vec2(0.0, 2.0) * px) * 0.2
      + texture2D(uMirror, uv - vec2(0.0, 2.0) * px) * 0.2
      + texture2D(uMirror, uv + vec2(1.5, 4.5) * px) * 0.13
      + texture2D(uMirror, uv + vec2(-1.5, -4.5) * px) * 0.13;
    if (m.a > 0.002) col = mix(col, mix(m.rgb / m.a, GLARE, 0.22), min(m.a, 1.0) * 0.5);

    float haze = smoothstep(uFog.x, uFog.y, length(vWorld - cameraPosition));
    gl_FragColor = vec4(mix(col, uHaze, haze), 1.0);
  }
`;

export class Floor {
  private target: THREE.WebGLRenderTarget;
  private eye = new THREE.PerspectiveCamera();
  private uniforms;
  private size = new THREE.Vector2();
  private look = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private scale: number,
  ) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    this.eye.layers.set(MIRRORED);
    this.uniforms = {
      uHaze: { value: HAZE },
      uFog: { value: new THREE.Vector2(80, 105) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uMirror: { value: this.target.texture },
      uTime: { value: 0 },
      uNight: { value: 0 },
    };
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, depthWrite: false }),
    );
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  resize(renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size);
    this.uniforms.uRes.value.copy(this.size);
    this.target.setSize(Math.max(2, Math.round(this.size.x * this.scale)), Math.max(2, Math.round(this.size.y * this.scale)));
  }

  setHaze(near: number, far: number) {
    this.uniforms.uFog.value.set(near, far);
    // Miis fade into the same haze as the floor, a touch later, so those running in from the far
    // edge come out of the mist gradually instead of appearing all at once.
    miiUniforms.uFogColor.value.copy(HAZE);
    miiUniforms.uFogNear.value = near + (far - near) * 0.2;
    miiUniforms.uFogFar.value = far + (far - near) * 0.12;
  }

  /** How far into night the plaza is, 0 (day) to 1 (night): the floor, and the haze everything shares. */
  setNight(t: number) {
    this.uniforms.uNight.value = t;
    HAZE.copy(HAZE_DAY).lerp(HAZE_NIGHT, t);
    miiUniforms.uFogColor.value.copy(HAZE);
  }

  /** Draws the mirrored Miis for this frame. Call before the main render. */
  mirror(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, target: THREE.Vector3, time: number) {
    this.uniforms.uTime.value = time;
    const eye = this.eye;
    eye.fov = camera.fov;
    eye.aspect = camera.aspect;
    eye.near = camera.near;
    eye.far = camera.far;
    eye.updateProjectionMatrix();
    eye.position.set(camera.position.x, -camera.position.y, camera.position.z);
    eye.lookAt(this.look.set(target.x, -target.y, target.z));
    eye.updateMatrixWorld();

    miiUniforms.uReflectPass.value = 1;
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.render(scene, eye);
    renderer.setRenderTarget(null);
    renderer.setClearAlpha(alpha);
    miiUniforms.uReflectPass.value = 0;
  }
}
