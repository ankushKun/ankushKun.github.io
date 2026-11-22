// Mii portraits for the chat, as Miiverse showed them: head and shoulders, one picture for each
// feeling. A Mii is photographed once, in every feeling, on one small offscreen canvas, and the
// pictures are kept for the rest of the visit. Miis are photographed one per frame so a room full
// of people never stalls the page. Without WebGL, or before FFL loads, the page shows a silhouette.
import * as THREE from 'three';
import { encodeMii, miiBytes } from '../mii/data';
import { loadMiiKit } from '../mii/kit';
import { MiiSet, randomMii, restPose, seededMii, type Pose } from '../mii/rig';

/** Miiverse's six feelings, in its order, and the face each one puts on (Pose.expr). */
export const FEELINGS: { name: string; expr: Pose['expr'] }[] = [
  { name: 'Normal', expr: 0 },
  { name: 'Happy', expr: 2 },
  { name: 'Like', expr: 6 },
  { name: 'Surprised', expr: 3 },
  { name: 'Frustrated', expr: 4 },
  { name: 'Puzzled', expr: 5 },
];

const SIZE = 192;

let renderer: THREE.WebGLRenderer | null = null;
let broken = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(18, 1, 0.05, 20);
const cache = new Map<string, Promise<string[] | null>>();
/** Miis waiting for their photographs. The newest asked for goes first: it's the one on screen. */
const waiting: { code: string; done: (shots: string[] | null) => void }[] = [];
let working = false;

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

function getRenderer() {
  if (renderer || broken) return renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  } catch {
    broken = true;
  }
  return renderer;
}

async function photograph(code: string): Promise<string[] | null> {
  const mii = miiBytes(code);
  if (!mii) return null;
  const kit = await loadMiiKit();
  const r = getRenderer();
  if (!r) return null;
  const set = new MiiSet(kit, r, [mii], { resolution: 256, happy: true });
  try {
    set.build();
    if (!set.hasHead(0)) return null;
    scene.add(set.group);
    const top = set.headTop(0);
    const collar = set.collar(0);
    const head = top - collar;
    const low = collar - head * 0.12;
    const high = top + head * 0.16;
    const mid = (low + high) / 2;
    const dist = (high - low) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, mid + head * 0.12, dist);
    camera.lookAt(0, mid, 0);
    const pose = restPose();
    return FEELINGS.map((f) => {
      pose.expr = f.expr;
      set.setPose(0, pose);
      set.commit();
      r.render(scene, camera);
      return r.domElement.toDataURL('image/webp', 0.9);
    });
  } finally {
    set.dispose();
  }
}

async function work() {
  if (working) return;
  working = true;
  while (waiting.length) {
    const job = waiting.pop()!;
    await nextFrame();
    try {
      job.done(await photograph(job.code));
    } catch (err) {
      console.warn('Mii portrait failed', err);
      job.done(null);
    }
  }
  working = false;
}

/** A Mii's portraits, one per feeling (FEELINGS order), or null if it can't be drawn here. */
export function portraits(code: string): Promise<string[] | null> {
  let shots = cache.get(code);
  if (!shots) {
    shots = new Promise((done) => waiting.push({ code, done }));
    cache.set(code, shots);
    void work();
  }
  return shots;
}

/** A new random Mii from the Mii Maker's own generator, as a Mii code. Null without FFL. */
export async function randomMiiCode(): Promise<string | null> {
  try {
    return encodeMii(randomMii(await loadMiiKit()));
  } catch (err) {
    console.warn('Could not make a Mii', err);
    return null;
  }
}

const standIns = new Map<string, Promise<string | null>>();

/**
 * A Mii for someone who never chose one (everyone from the old site): made from their name or id,
 * so it's the same Mii on every screen. Null without FFL.
 */
export function standIn(seed: string): Promise<string | null> {
  let code = standIns.get(seed);
  if (!code) {
    code = loadMiiKit()
      .then((kit) => encodeMii(seededMii(kit, seed)))
      .catch(() => null);
    standIns.set(seed, code);
  }
  return code;
}

/** Frees the GPU side when the chat closes. The pictures stay cached for the visit. */
export function releasePortraits() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
}
