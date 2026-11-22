// What a Mii's look draws on their head (MiiLook in plaza/types.ts): a headset with a mic, a long
// ponytail tied high on the left. Built in code in the same lit colors as the DJ's boombox and
// placed by the head itself each frame, so it turns, nods and bobs with it. One draw call per Mii.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gearMaterial, paint } from './boombox';
import { MIRRORED } from './floor';
import type { MiiLook } from './types';

/**
 * Everything is placed in the head's own units (FFL's: the face is about 52 across, the top of
 * the hair about 70 up, facing +z). The Mii's right is -x.
 */
const EAR = { x: 29, y: 27, z: -3 };
const BAND = { top: 72, width: 2.6 };
const CUP = { radius: 9.5, depth: 7 };
const DARK = '#2b2f36';
const RIM = '#5d6672';
/** The ponytail: where it is tied, the line it hangs along, and how thick it is at the tie. */
const TAIL = {
  tie: new THREE.Vector3(22, 62, -14),
  path: [new THREE.Vector3(24, 62, -16), new THREE.Vector3(36, 52, -20), new THREE.Vector3(42, 26, -18), new THREE.Vector3(40, -4, -14), new THREE.Vector3(34, -28, -10)],
  thick: 9,
};

/** A headset: a band over the head, a cup on each ear with a light in `light`, a mic at the mouth on the right. */
function headset(light: string) {
  const parts: THREE.BufferGeometry[] = [];
  const band = new THREE.CatmullRomCurve3(
    Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * Math.PI;
      return new THREE.Vector3(Math.cos(a) * (EAR.x + 1), EAR.y + Math.sin(a) * (BAND.top - EAR.y), EAR.z);
    }),
  );
  parts.push(paint(new THREE.TubeGeometry(band, 16, BAND.width, 6, false), DARK));
  for (const side of [-1, 1]) {
    const x = side * (EAR.x + CUP.depth / 2);
    const face = x + side * CUP.depth * 0.5;
    parts.push(paint(new THREE.CylinderGeometry(CUP.radius, CUP.radius, CUP.depth, 14).rotateZ(Math.PI / 2).translate(x, EAR.y, EAR.z), DARK));
    parts.push(paint(new THREE.CylinderGeometry(CUP.radius * 0.55, CUP.radius * 0.55, 1.5, 14).rotateZ(Math.PI / 2).translate(face, EAR.y, EAR.z), light));
    parts.push(paint(new THREE.TorusGeometry(CUP.radius, 1.2, 4, 14).rotateY(Math.PI / 2).translate(face, EAR.y, EAR.z), RIM));
  }
  const boom = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-EAR.x - CUP.depth * 0.6, EAR.y - 5, EAR.z + 4),
    new THREE.Vector3(-EAR.x + 1, EAR.y - 12, 16),
    new THREE.Vector3(-14, 11, 27),
  ]);
  parts.push(paint(new THREE.TubeGeometry(boom, 10, 1.1, 5, false), DARK));
  parts.push(paint(new THREE.SphereGeometry(3.2, 8, 6).translate(-13, 11, 28), DARK));
  return parts;
}

/** A ponytail in `color`, tied high on the left and swinging out and down past the shoulder, tapering to a point. */
function ponytail(color: string) {
  const curve = new THREE.CatmullRomCurve3(TAIL.path);
  const segments = 14;
  const radial = 8;
  const tube = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  // Taper it: full at the tie, a little fuller just below, down to a point at the tip.
  const pos = tube.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, centre);
    const r = TAIL.thick * (0.8 + 0.5 * Math.sin(Math.min(1, t * 2.5) * Math.PI * 0.5)) * (1 - t) ** 0.8 + 0.6;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  tube.computeVertexNormals();
  return [paint(tube, color), paint(new THREE.SphereGeometry(5.5, 10, 8).translate(TAIL.tie.x, TAIL.tie.y, TAIL.tie.z), DARK)];
}

const shapes = new Map<string, THREE.BufferGeometry>();

/** The merged shape for a look, built once for each and shared. */
function shapeFor(look: MiiLook) {
  const key = `${look.headset ?? ''}|${look.ponytail ?? ''}`;
  let shape = shapes.get(key);
  if (!shape) {
    const parts = [...(look.headset ? headset(look.headset) : []), ...(look.ponytail ? ponytail(look.ponytail) : [])];
    shape = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    shapes.set(key, shape);
  }
  return shape;
}

export class HeadGear {
  private readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, look: MiiLook) {
    this.mesh = new THREE.Mesh(shapeFor(look), gearMaterial());
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(MIRRORED);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Puts it on the head placed by `head` (the head's world matrix), or hides it with null. */
  place(head: THREE.Matrix4 | null) {
    this.mesh.visible = head !== null;
    if (!head) return;
    this.mesh.matrix.copy(head);
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
