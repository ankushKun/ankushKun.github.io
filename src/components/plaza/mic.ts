// The mic each dancer on stage sings into in the Tetoris spin (motion.tetoris), held up at the
// mouth in the left hand as Teto holds hers. Built in code in the same lit colors as the DJ's
// boombox: a pale ball of mesh on a dark handle, banded in Teto's red. It grows out of the fist as
// the spin begins and back in when it ends. One draw call for each dancer while it shows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gearMaterial, paint } from './boombox';
import { MIRRORED } from './floor';

/**
 * In world units at Mii size 1: how long it is from the handle's end to the top of the ball, and
 * how far past the wrist the fist holding it is. `grip` is where along it the fist closes (0 to 1).
 */
const MIC = { length: 0.3, hand: 0.07, grip: 0.3 };

/** A mic a unit long standing up along +y, the fist's grip at the origin. About 200 triangles. */
function shape() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: string) => parts.push(paint(g, color));
  add(new THREE.CylinderGeometry(0.09, 0.06, 0.62, 10, 1).translate(0, 0.31, 0), '#3b3d42');
  add(new THREE.CylinderGeometry(0.105, 0.1, 0.08, 10, 1).translate(0, 0.62, 0), '#e8435f');
  add(new THREE.SphereGeometry(0.19, 12, 8).translate(0, 0.8, 0), '#d6d8dc');
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return g.translate(0, -MIC.grip, 0);
}

const _wrist = new THREE.Vector3();
const _along = new THREE.Vector3();
const _thumb = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Mics {
  private readonly meshes: THREE.Mesh[];

  /** `hands` are the dancers' left wrists in the world, as the rig keeps them (MiiSet.track). */
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

  /** Places dancer `i`'s mic in their left fist, `show` of it (0 puts it away), at Mii size `scale`. */
  place(i: number, show: number, scale: number) {
    const mesh = this.meshes[i];
    mesh.visible = show > 0.001;
    if (!mesh.visible) return;
    const hand = this.hands[i];
    // The left forearm runs along the wrist's +x toward the fingers, and the mic carries on the
    // same way out of the fist, up to the mouth with the forearm raised. Its z is the thumb's side.
    _along.set(1, 0, 0).transformDirection(hand);
    _thumb.set(0, 0, 1).transformDirection(hand);
    _thumb.addScaledVector(_along, -_thumb.dot(_along)).normalize();
    _side.crossVectors(_along, _thumb);
    _wrist.setFromMatrixPosition(hand).addScaledVector(_along, MIC.hand * scale);
    const k = MIC.length * scale * show;
    mesh.matrix.makeBasis(_side.multiplyScalar(k), _along.multiplyScalar(k), _thumb.multiplyScalar(k)).setPosition(_wrist);
  }
}
