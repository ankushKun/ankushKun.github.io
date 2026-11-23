// Where everything stands. The numbers come from the Wii U itself, measured off captures of the
// real plaza: a very long lens (about 5 degrees) looking down at 13, ten glass blocks over an oval
// of floor. The cubes are stored as screen positions, so the framing survives any window shape.
import * as THREE from 'three';
import { SKYFALL } from './crowd';

/** One glass block: width, thickness at the rim, how high its center hangs, how far it leans back. */
export const CUBE = { size: 3.34, depth: 0.5, lift: 3.6, tilt: 0.1 };

const DEG = Math.PI / 180;
/** World units from the top of the screen to the bottom, where the standard view looks. */
const SPAN = 17.5;

/** A camera pose: what it looks at, how steeply, through what lens, and where the haze sits. */
export interface View {
  target: THREE.Vector3;
  pitch: number;
  /** Turn around the target, left or right. Only the mouse-follow camera sets it. */
  yaw: number;
  fov: number;
  dist: number;
  /** Distances where the floor starts to fade and where it is gone. */
  haze: [number, number];
}

export interface Layout {
  tall: boolean;
  /** One per zoom orb: far, standard, closer, the group in the middle. */
  views: [View, View, View, View];
  /** Where the page opens: up in the haze, level with your Mii floating there. */
  sky: View;
  /** The floor point under each cube. */
  anchors: THREE.Vector3[];
  /** Where your Mii stands. */
  hero: THREE.Vector3;
  /** The far edge of the widest view, lost in haze: the crowd runs in from behind it. */
  far: { z: number; halfWidth: number };
}

// Floor points under the cubes as [x, y] on screen: x from -1 (left edge) to 1, y from 0 (top) to 1.
// Back row, the two sides, front row: the order cubes are listed in src/data/plaza.ts.
const WIDE: [number, number][] = [
  [-0.558, 0.343], [-0.192, 0.2875], [0.192, 0.2875], [0.558, 0.343],
  [-0.883, 0.525], [0.883, 0.525],
  [-0.667, 0.774], [-0.243, 0.864], [0.243, 0.864], [0.667, 0.774],
];
// Portrait: rows of three, two, two and three, by cube center. The floor points follow from them.
const TALL: [number, number][] = [
  [-0.66, 0.095], [0, 0.095], [0.66, 0.095],
  [-0.5, 0.25], [0.5, 0.25],
  [-0.5, 0.585], [0.5, 0.585],
  [-0.66, 0.76], [0, 0.76], [0.66, 0.76],
];
const HERO_Y = { wide: 0.478, tall: 0.455 };

/** A view that shows `span` world units top to bottom at its target. */
function view(target: THREE.Vector3, pitch: number, fov: number, span: number, haze: [number, number]): View {
  const dist = span / (2 * Math.tan((fov * DEG) / 2));
  return { target, pitch: pitch * DEG, yaw: 0, fov, dist, haze: [dist * haze[0], dist * haze[1]] };
}

/** Puts `camera` at a view. */
export function applyView(camera: THREE.PerspectiveCamera, v: View) {
  if (camera.fov !== v.fov) {
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
  }
  const flat = Math.cos(v.pitch) * v.dist;
  camera.position.set(v.target.x + Math.sin(v.yaw) * flat, v.target.y + Math.sin(v.pitch) * v.dist, v.target.z + Math.cos(v.yaw) * flat);
  camera.lookAt(v.target);
  camera.updateMatrixWorld();
}

/**
 * A view between two others. What changes evenly is how much of the scene fits the screen, so a
 * zoom feels the same speed all the way even as the lens changes with it.
 */
export function mixViews(a: View, b: View, t: number, out: View) {
  const spanA = Math.log(a.dist * Math.tan((a.fov * DEG) / 2));
  const spanB = Math.log(b.dist * Math.tan((b.fov * DEG) / 2));
  const fov = a.fov + (b.fov - a.fov) * t;
  out.target.lerpVectors(a.target, b.target, t);
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.yaw = a.yaw + (b.yaw - a.yaw) * t;
  out.haze[0] = a.haze[0] + (b.haze[0] - a.haze[0]) * t;
  out.haze[1] = a.haze[1] + (b.haze[1] - a.haze[1]) * t;
  out.fov = fov;
  out.dist = Math.exp(spanA + (spanB - spanA) * t) / Math.tan((fov * DEG) / 2);
  return out;
}

export const blankView = (): View => ({ target: new THREE.Vector3(), pitch: 0.23, yaw: 0, fov: 5.2, dist: 190, haze: [190, 250] });

/** Copies one view into another. */
export function copyView(from: View, out: View) {
  return mixViews(from, from, 0, out);
}

const _ray = new THREE.Vector3();

/** `wide` is the slot each block takes on a wide screen; a tall one puts block `i` in slot `i`. */
export function makeLayout(aspect: number, count: number, wide: readonly number[] = []): Layout {
  const tall = aspect < 0.9;
  // Keep the long lens and step back until the cubes fit the width.
  const span = tall ? Math.max(27.5, 13.4 / aspect) : Math.max(SPAN, 22.3 / aspect);
  const standard = view(new THREE.Vector3(), 13.2, 5.2, span, [0.97, 1.24]);

  const camera = new THREE.PerspectiveCamera(standard.fov, aspect, 1, 2000);
  applyView(camera, standard);
  /** The floor point seen at a screen position. */
  const floor = (x: number, y: number) => {
    _ray.set(x, 1 - 2 * y, 0.5).unproject(camera).sub(camera.position);
    return camera.position.clone().addScaledVector(_ray, -camera.position.y / _ray.y);
  };

  // A cube's half width and the drop from its center to its floor point, as fractions of the screen.
  const half = CUBE.size / (span * aspect);
  const drop = (CUBE.lift * Math.cos(standard.pitch)) / span;
  const squeeze = Math.min(1, 2.05 / aspect);
  const slots = tall
    ? TALL.map(([x, y]) => floor(x === 0 ? 0 : Math.sign(x) * Math.min(Math.abs(x), 1 - half * 1.3), y + drop))
    : WIDE.map(([x, y], i) => floor((i === 4 || i === 5 ? Math.sign(x) * Math.min(0.883, 1 - half * 1.1) : x) * squeeze, y));

  const hero = floor(0, tall ? HERO_Y.tall : HERO_Y.wide);
  const group = new THREE.Vector3(hero.x, 0.62, hero.z - 0.6);
  // Up close a wide screen holds the whole group; a phone holds you and whoever stands nearest.
  const near = Math.max(3.25, 3.1 / aspect);
  const widest = view(new THREE.Vector3(0, 0, -1), 13.6, 5.2, span * 1.2, [0.98, 1.26]);
  applyView(camera, widest);
  const corner = floor(1, 0);

  return {
    tall,
    views: [
      widest,
      standard,
      view(new THREE.Vector3(hero.x, 0.4, hero.z - 0.5), 12, 7, Math.max(span * 0.46, near * 1.8), [1.08, 1.9]),
      view(group, 10.4, 10, near, [1.6, 5]),
    ],
    // Up in the haze, level with your Mii floating there, the floor a pale blur far below.
    sky: view(new THREE.Vector3(hero.x, SKYFALL.height + 0.72, hero.z), 7, 10, Math.max(4.2, 2.4 / aspect), [1.3, 4.2]),
    anchors: Array.from({ length: count }, (_, i) => slots[tall ? i : (wide[i] ?? i)]),
    hero,
    far: { z: corner.z, halfWidth: corner.x },
  };
}
