// What the stage twirls in the polka (motion.polka), one in each dancer's right hand: Miku's leek,
// Neru's yellow flip phone, and Teto's French baguette. Built in code in the same lit colors as the
// DJ's boombox, each growing out of the fist as the twirl begins, turning about the forearm (the
// phone instead held up to Neru's face as she looks at it), and shrinking back in when it ends. One draw call per dancer while it shows, none while put away.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gearMaterial, paint } from './boombox';
import { MIRRORED } from './floor';
import type { StageProp } from './types';

/**
 * In world units at Mii size 1: how long each prop is from end to end, how far past the wrist the
 * fist holding it is, and where along it the fist closes (0 to 1 from the bottom end).
 */
const PROPS: Record<StageProp, { length: number; hand: number; grip: number }> = {
  leek: { length: 0.55, hand: 0.07, grip: 0.22 },
  phone: { length: 0.3, hand: 0.05, grip: 0.22 },
  baguette: { length: 0.58, hand: 0.07, grip: 0.28 },
};

function merge(parts: THREE.BufferGeometry[], grip: number) {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))).translate(0, -grip, 0);
}

/** A leek a unit long standing up along +y, the fist's grip at the origin. About 150 triangles. */
function leekShape() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => parts.push(paint(g, color));
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.5, 8, 1).translate(0, 0.25, 0), '#f4f2e8');
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8, 1).translate(0, 0.56, 0), '#c6e07c');
  add(new THREE.CylinderGeometry(0.035, 0.06, 0.03, 8, 1).translate(0, -0.015, 0), '#ddd5b4');
  // Three flat blades fanning out from the neck, each leaning off its own way.
  for (const [turn, lean] of [
    [0, 0.14],
    [2.1, -0.12],
    [4.2, 0.06],
  ]) {
    add(new THREE.ConeGeometry(0.06, 0.42, 6, 1).scale(1, 1, 0.45).translate(0, 0.21, 0).rotateZ(lean).rotateY(turn).translate(0, 0.6, 0), '#3d9a3a');
  }
  return merge(parts, PROPS.leek.grip);
}

/**
 * Akita Neru's open yellow flip phone, a unit tall along +y with its screen and keypad facing +x
 * (out of the fist toward the viewer), bent slightly open at the hinge with a stubby top antenna.
 */
function phoneShape() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => parts.push(paint(g, color));
  const BODY = '#ffd426';
  const HINGE = '#e2ae12';
  const TRIM = '#d7dee6';
  const BEZEL = '#232830';
  const SCREEN = '#b8ecff';
  const KEY = '#eef2f6';
  const DARK = '#2c313a';

  // Lower half (keypad body) held in the fist.
  add(new RoundedBoxGeometry(0.12, 0.48, 0.42, 1, 0.032).translate(0, 0.24, 0), BODY);
  add(new THREE.BoxGeometry(0.014, 0.38, 0.34).translate(0.059, 0.23, 0), BEZEL);
  // Circular D-pad and call/end buttons above the 3x4 keypad grid.
  add(new THREE.CylinderGeometry(0.062, 0.062, 0.016, 10).rotateZ(Math.PI / 2).translate(0.066, 0.345, 0), TRIM);
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8).rotateZ(Math.PI / 2).translate(0.067, 0.345, 0), BODY);
  add(new THREE.BoxGeometry(0.014, 0.034, 0.055).translate(0.065, 0.35, -0.115), '#4cd964');
  add(new THREE.BoxGeometry(0.014, 0.034, 0.055).translate(0.065, 0.35, 0.115), '#ff5252');
  for (const y of [0.085, 0.145, 0.205, 0.265]) {
    for (const z of [-0.1, 0, 0.1]) {
      add(new THREE.BoxGeometry(0.014, 0.036, 0.072).translate(0.065, y, z), KEY);
    }
  }

  // Hinge barrel joining the two halves.
  add(new THREE.CylinderGeometry(0.068, 0.068, 0.43, 10).rotateX(Math.PI / 2).translate(0, 0.5, 0), HINGE);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 8).rotateX(Math.PI / 2).translate(0, 0.5, side * 0.212), TRIM);
  }

  // Upper flip lid angled ~20 degrees toward +x like an open clamshell.
  const addLid = (g: THREE.BufferGeometry, color: string) => add(g.rotateZ(-0.34).translate(0, 0.5, 0), color);
  addLid(new RoundedBoxGeometry(0.1, 0.5, 0.42, 1, 0.03).translate(0, 0.26, 0), BODY);
  addLid(new THREE.BoxGeometry(0.016, 0.39, 0.34).translate(0.049, 0.26, 0), BEZEL);
  addLid(new THREE.BoxGeometry(0.018, 0.31, 0.27).translate(0.053, 0.25, 0), SCREEN);
  addLid(new THREE.BoxGeometry(0.018, 0.022, 0.1).translate(0.053, 0.435, 0), TRIM);
  // Outer cover sub-display and camera lens on the back (-x) face.
  addLid(new THREE.BoxGeometry(0.014, 0.15, 0.22).translate(-0.049, 0.29, 0), BEZEL);
  addLid(new THREE.BoxGeometry(0.016, 0.08, 0.16).translate(-0.052, 0.26, 0), SCREEN);
  addLid(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 8).rotateZ(Math.PI / 2).translate(-0.052, 0.405, 0), DARK);
  // Stubby retro antenna on the top corner of the lid.
  addLid(new THREE.CylinderGeometry(0.028, 0.034, 0.045, 6).translate(-0.012, 0.515, 0.145), HINGE);
  addLid(new THREE.CylinderGeometry(0.022, 0.026, 0.13, 6).translate(-0.012, 0.59, 0.145), DARK);
  addLid(new THREE.SphereGeometry(0.026, 6, 5).translate(-0.012, 0.655, 0.145), DARK);

  return merge(parts, PROPS.phone.grip);
}

/**
 * Kasane Teto's French baguette, a unit long standing up along +y: a tapered golden-brown crusty
 * loaf with diagonal pale crumb slash scores and toasted ridges on both sides.
 */
function baguetteShape() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => parts.push(paint(g, color));
  const profile = [
    [0.0, 0.0],
    [0.055, 0.03],
    [0.092, 0.09],
    [0.11, 0.19],
    [0.115, 0.35],
    [0.115, 0.65],
    [0.11, 0.81],
    [0.092, 0.91],
    [0.055, 0.97],
    [0.0, 1.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(profile, 10).scale(0.86, 1, 1.04), '#d98d34');
  // Four diagonal scored slashes (grignes) on each face so it reads clearly from every angle.
  for (const side of [1, -1]) {
    for (const y of [0.24, 0.41, 0.58, 0.75]) {
      add(
        new THREE.CapsuleGeometry(0.022, 0.1, 3, 6)
          .scale(0.72, 1, 1)
          .rotateX(side * 0.52)
          .translate(side * 0.09, y, 0),
        '#f9e7bc',
      );
      add(
        new THREE.CapsuleGeometry(0.012, 0.095, 2, 5)
          .scale(0.65, 1, 0.85)
          .rotateX(side * 0.52)
          .translate(side * 0.091, y + 0.02, -side * 0.012),
        '#9e5214',
      );
    }
  }
  return merge(parts, PROPS.baguette.grip);
}

const BUILDERS: Record<StageProp, () => THREE.BufferGeometry> = {
  leek: leekShape,
  phone: phoneShape,
  baguette: baguetteShape,
};

const _wrist = new THREE.Vector3();
const _along = new THREE.Vector3();
const _thumb = new THREE.Vector3();
const _side = new THREE.Vector3();
const _line = new THREE.Vector3();
const _across = new THREE.Vector3();
const _screen = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Leeks {
  private readonly meshes: THREE.Mesh[];
  private readonly kinds: StageProp[];

  /** `hands` are the dancers' right wrists in the world, as the rig keeps them (MiiSet.track). */
  constructor(
    scene: THREE.Scene,
    private readonly hands: THREE.Matrix4[],
    kinds: StageProp[] = [],
  ) {
    const shapes = new Map<StageProp, THREE.BufferGeometry>();
    const material = gearMaterial();
    this.kinds = hands.map((_, i) => kinds[i] ?? 'leek');
    this.meshes = this.kinds.map((kind) => {
      let geometry = shapes.get(kind);
      if (!geometry) {
        geometry = BUILDERS[kind]();
        shapes.set(kind, geometry);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.layers.enable(MIRRORED);
      scene.add(mesh);
      return mesh;
    });
  }

  /**
   * Places dancer `i`'s prop in their hand, `show` of it (0 puts it away) at Mii size `scale`,
   * turned `spin` radians about the forearm from standing up off the thumb. A phone isn't twirled:
   * given `face` (where the head is in the world), it is held up with its screen toward it.
   */
  place(i: number, show: number, spin: number, scale: number, face?: THREE.Vector3) {
    const mesh = this.meshes[i];
    mesh.visible = show > 0.001;
    if (!mesh.visible) return;
    const hand = this.hands[i];
    const spec = PROPS[this.kinds[i]];
    // The right forearm runs along the wrist's -x toward the fingers; its z is the thumb's side.
    _along.set(-1, 0, 0).transformDirection(hand);
    _thumb.set(0, 0, 1).transformDirection(hand);
    _thumb.addScaledVector(_along, -_thumb.dot(_along)).normalize();
    _side.crossVectors(_along, _thumb);
    _line.copy(_thumb).multiplyScalar(Math.cos(spin)).addScaledVector(_side, Math.sin(spin));
    _across.crossVectors(_along, _line);
    _wrist.setFromMatrixPosition(hand).addScaledVector(_along, spec.hand * scale);
    const k = spec.length * scale * show;
    if (this.kinds[i] === 'phone' && face) {
      // The screen (the shape's +x) looks straight up at the face, and the phone stands as upright
      // as that allows, so it tips back from the fist rather than rising in front of the face.
      _screen.subVectors(face, _wrist).normalize();
      _line.copy(_up).addScaledVector(_screen, -_up.dot(_screen)).normalize();
      _across.crossVectors(_screen, _line);
      mesh.matrix.makeBasis(_screen.multiplyScalar(k), _line.multiplyScalar(k), _across.multiplyScalar(k)).setPosition(_wrist);
      return;
    }
    mesh.matrix.makeBasis(_along.multiplyScalar(k), _line.multiplyScalar(k), _across.multiplyScalar(k)).setPosition(_wrist);
  }
}
