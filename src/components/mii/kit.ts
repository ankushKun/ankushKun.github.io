// Loads everything a Wii U Mii needs: FFL (Nintendo's face library, compiled to WebAssembly), its
// resource file, and the Wii U body models. Loaded once per page and shared.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import ModuleFFL from './vendor/ffl-emscripten.js';
import { initializeFFL, type FFLModule } from './vendor/ffl.js';

const ASSETS = '/ffl/';

export interface Bone {
  name: string;
  /** Index of the parent bone, -1 for the root. */
  parent: number;
  /** Rest offset from the parent, in body units. */
  offset: THREE.Vector3;
}

/** One Wii U body: a 25 bone skeleton and two skinned meshes (shirt with hands, pants). */
export interface Body {
  bones: Bone[];
  /** Bone indices with every parent before its children. */
  order: number[];
  inverses: THREE.Matrix4[];
  bone: (name: string) => number;
  shirt: THREE.BufferGeometry;
  pants: THREE.BufferGeometry;
}

export interface MiiKit {
  ffl: FFLModule;
  /** Male and female bodies, indexed by Mii gender. */
  bodies: [Body, Body];
}

let kit: Promise<MiiKit> | undefined;

/** Starts loading on first call; later calls share the same promise. */
export function loadMiiKit(): Promise<MiiKit> {
  kit ??= (async () => {
    const [module, resource, male, female] = await Promise.all([
      ModuleFFL({ locateFile: () => `${ASSETS}ffl.wasm` }),
      fetch(`${ASSETS}FFLResHigh.dat`).then((r) => {
        if (!r.ok) throw new Error(`Mii resource failed to load (${r.status})`);
        return r.arrayBuffer();
      }),
      loadBody(`${ASSETS}body-m.glb`),
      loadBody(`${ASSETS}body-f.glb`),
    ]);
    const { module: ffl } = await initializeFFL(new Uint8Array(resource), module);
    return { ffl, bodies: [male, female] };
  })();
  kit.catch(() => (kit = undefined));
  return kit;
}

async function loadBody(url: string): Promise<Body> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const skinned: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  const shirtMesh = skinned.find((m) => m.name.startsWith('body_'));
  const pantsMesh = skinned.find((m) => m.name.startsWith('legs_'));
  if (!shirtMesh || !pantsMesh) throw new Error(`${url} is not a Wii U Mii body`);

  const joints = shirtMesh.skeleton.bones;
  const names = joints.map((b) => b.name);
  const bones: Bone[] = joints.map((b) => ({
    name: b.name,
    parent: names.indexOf(b.parent?.name ?? ''),
    offset: b.position.clone(),
  }));
  const order: number[] = [];
  const visit = (i: number) => {
    if (order.includes(i)) return;
    if (bones[i].parent >= 0) visit(bones[i].parent);
    order.push(i);
  };
  bones.forEach((_, i) => visit(i));

  // Rest pose in body units. The root stands at the origin, upright.
  const rest = bones.map(() => new THREE.Matrix4());
  for (const i of order) {
    const p = bones[i].parent;
    if (p >= 0) rest[i].multiplyMatrices(rest[p], new THREE.Matrix4().setPosition(bones[i].offset));
  }

  return {
    bones,
    order,
    inverses: rest.map((m) => m.clone().invert()),
    bone: (name) => names.indexOf(name),
    shirt: part(shirtMesh, names),
    pants: part(pantsMesh, names),
  };
}

/**
 * Keeps only what the batched body shader reads: bind pose positions in body units (the file stores
 * them quantized, with the scale folded into each mesh's inverse bind matrices) and joint indices
 * in the shirt skeleton's order.
 */
function part(mesh: THREE.SkinnedMesh, names: string[]) {
  const src = mesh.geometry;
  const root = mesh.skeleton.bones.findIndex((b) => !mesh.skeleton.bones.includes(b.parent as THREE.Bone));
  const dequantize = mesh.skeleton.boneInverses[root];
  const pos = src.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(dequantize).toArray(positions, i * 3);

  const map = mesh.skeleton.bones.map((b) => names.indexOf(b.name));
  const skin = src.getAttribute('skinIndex');
  const joints = new Uint8Array(skin.count * 4);
  for (let i = 0; i < skin.count; i++) {
    for (let k = 0; k < 4; k++) joints[i * 4 + k] = map[skin.getComponent(i, k)];
  }
  // How much each vertex belongs to a forearm or a hand, for Miis drawn in short sleeves.
  const weights = src.getAttribute('skinWeight');
  const forearm = new Set(['arm_l2', 'arm_r2', 'wrist_l', 'wrist_r'].map((n) => names.indexOf(n)));
  const bare = new Float32Array(skin.count);
  for (let i = 0; i < skin.count; i++) {
    for (let k = 0; k < 4; k++) if (forearm.has(joints[i * 4 + k])) bare[i] += weights.getComponent(i, k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(src.getIndex());
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', src.getAttribute('normal'));
  geo.setAttribute('aJoint', new THREE.BufferAttribute(joints, 4));
  geo.setAttribute('aWeight', src.getAttribute('skinWeight'));
  geo.setAttribute('aBare', new THREE.BufferAttribute(bare, 1));
  return geo;
}
