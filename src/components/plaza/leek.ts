// The leek the stage twirls in the polka (motion.polka), one in each dancer's right hand. Built in
// code in the same lit colors as the DJ's boombox: a white stalk greening up into three dark
// leaves. It grows out of the fist as the twirl begins, turns about the forearm, and shrinks back
// in when it ends. One draw call for each dancer while it shows, none while it is put away.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gearMaterial, paint } from './boombox';
import { MIRRORED } from './floor';

/**
 * In world units at Mii size 1: how long it is from root to leaf tips, and how far past the wrist
 * the fist holding it is. `grip` is where along it the fist closes, from the root end (0 to 1).
 */
const LEEK = { length: 0.55, hand: 0.07, grip: 0.22 };

/** A leek a unit long standing up along +y, the fist's grip at the origin. About 150 triangles. */
function shape() {
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
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return g.translate(0, -LEEK.grip, 0);
}

const _wrist = new THREE.Vector3();
const _along = new THREE.Vector3();
const _thumb = new THREE.Vector3();
const _side = new THREE.Vector3();
const _line = new THREE.Vector3();
const _across = new THREE.Vector3();

export class Leeks {
  private readonly meshes: THREE.Mesh[];

  /** `hands` are the dancers' right wrists in the world, as the rig keeps them (MiiSet.track). */
  constructor(
    scene: THREE.Scene,
    private readonly hands: THREE.Matrix4[],
  ) {
    const geometry = shape();
    const material = gearMaterial();
    this.meshes = hands.map(() => {
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
   * Places dancer `i`'s leek in their hand, `show` of it (0 puts it away) at Mii size `scale`,
   * turned `spin` radians about the forearm from standing up off the thumb.
   */
  place(i: number, show: number, spin: number, scale: number) {
    const mesh = this.meshes[i];
    mesh.visible = show > 0.001;
    if (!mesh.visible) return;
    const hand = this.hands[i];
    // The right forearm runs along the wrist's -x toward the fingers; its z is the thumb's side.
    _along.set(-1, 0, 0).transformDirection(hand);
    _thumb.set(0, 0, 1).transformDirection(hand);
    _thumb.addScaledVector(_along, -_thumb.dot(_along)).normalize();
    _side.crossVectors(_along, _thumb);
    _line.copy(_thumb).multiplyScalar(Math.cos(spin)).addScaledVector(_side, Math.sin(spin));
    _across.crossVectors(_along, _line);
    _wrist.setFromMatrixPosition(hand).addScaledVector(_along, LEEK.hand * scale);
    const k = LEEK.length * scale * show;
    mesh.matrix.makeBasis(_along.multiplyScalar(k), _line.multiplyScalar(k), _across.multiplyScalar(k)).setPosition(_wrist);
  }
}
