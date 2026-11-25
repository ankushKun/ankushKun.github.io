// The /mii/ page: load a Mii from a QR code image or a code, see it in 3D, copy its code.
import * as THREE from 'three';
import { decodeMii, encodeMii, miiInfo } from './data';
import { loadMiiKit } from './kit';
import { miiFromQrImage } from './qr';
import { MiiSet, restPose, withLook } from './rig';
import type { MiiLook } from '../plaza/types';

/** Starts the viewer. Resolves to a function that stops it and frees its GPU memory. */
export async function mount(root: HTMLElement): Promise<() => void> {
  const need = <E extends Element>(el: E | null): E => {
    if (!el) throw new Error('Mii page markup is incomplete');
    return el;
  };
  const canvas = need(root.querySelector('canvas'));
  const stage = need(root.querySelector<HTMLElement>('[data-stage]'));
  const file = need(root.querySelector<HTMLInputElement>('[data-file]'));
  const code = need(root.querySelector<HTMLInputElement>('[data-code]'));
  const copy = need(root.querySelector<HTMLButtonElement>('[data-copy]'));
  const shuffle = root.querySelector<HTMLButtonElement>('[data-shuffle]');
  const crowdEl = root.querySelector<HTMLScriptElement>('[data-crowd]');
  const name = need(root.querySelector<HTMLElement>('[data-name]'));
  const status = need(root.querySelector<HTMLElement>('[data-status]'));
  const crowd: ({ name: string; code: string } & Pick<MiiLook, 'parts' | 'leftEye'>)[] = crowdEl?.textContent ? JSON.parse(crowdEl.textContent) : [];
  let lastPick = -1;

  const kit = await loadMiiKit();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);

  let set: MiiSet | null = null;
  let yaw = 0;
  let spin = 0;
  let shown = 0;

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
    code.setAttribute('aria-invalid', String(error));
  };

  /** Shows `mii`, in the look the code can't carry when it is one of the plaza's (LOOKS in src/data/plaza.ts). */
  function show(mii: Uint8Array, labelOverride?: string) {
    set?.dispose();
    const drawn = withLook(kit, mii, crowd.find((c) => c.code === encodeMii(mii)));
    set = new MiiSet(kit, renderer, [drawn], { resolution: 512, happy: true, shadows: true });
    set.build();
    scene.add(set.group);
    const info = miiInfo(mii);
    name.textContent = labelOverride || (info.creator ? `${info.name} by ${info.creator}` : info.name);
    code.value = encodeMii(mii);
    yaw = 0;
    shown = performance.now();
    const top = set.headTop(0);
    camera.position.set(0, top * 0.6, top * 2.75);
    camera.lookAt(0, top * 0.52, 0);
    say('');
  }

  async function fromImage(image: Blob) {
    try {
      show(await miiFromQrImage(image));
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), true);
    }
  }

  const initial = decodeMii(root.dataset.initial ?? '');
  if (initial) show(initial);

  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) fromImage(f);
    file.value = '';
  });
  code.addEventListener('input', () => {
    const mii = decodeMii(code.value);
    if (mii) show(mii);
    else say(code.value.trim() ? 'That is not a Mii code' : '', Boolean(code.value.trim()));
  });
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(code.value);
    say('Mii code copied to clipboard!');
  });
  shuffle?.addEventListener('click', () => {
    if (crowd.length === 0) return;
    let idx = Math.floor(Math.random() * crowd.length);
    if (crowd.length > 1 && idx === lastPick) idx = (idx + 1) % crowd.length;
    lastPick = idx;
    const pick = crowd[idx];
    const mii = decodeMii(pick.code);
    if (mii) {
      show(mii, pick.name);
      say(`Pulled ${pick.name} from the plaza crowd!`);
    }
  });
  const onPaste = (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (!blob) return;
    e.preventDefault();
    fromImage(blob);
  };
  addEventListener('paste', onPaste);
  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.dataset.drop = '';
  });
  stage.addEventListener('dragleave', () => delete stage.dataset.drop);
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    delete stage.dataset.drop;
    const f = e.dataTransfer?.files[0];
    if (f) fromImage(f);
  });

  let dragX: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragX === null) return;
    spin = (e.clientX - dragX) * 0.012;
    yaw += spin;
    dragX = e.clientX;
  });
  canvas.addEventListener('pointerup', () => (dragX = null));

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pose = restPose();
  let blinkAt = 2;
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now / 1000;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (set) {
      if (dragX === null) {
        spin *= Math.exp(-4 * dt);
        yaw += spin;
        yaw *= Math.exp(-1.5 * dt);
      }
      // Wave hello for a moment after a new Mii arrives, then idle.
      const since = (now - shown) / 1000;
      const wave = calm ? 0 : Math.max(0, Math.min(1, since * 4, (2.2 - since) * 4));
      const breathe = calm ? 0 : Math.sin(t * 2.1) * 0.02;
      Object.assign(pose, restPose(), { yaw, outL: 0.14 + breathe, outR: 0.14 + breathe });
      pose.outR += (1.35 - pose.outR) * wave;
      pose.swingR = 0.25 * wave;
      pose.elbowR = 0.14 + (1.42 + Math.sin(t * 12) * 0.32) * wave;
      pose.twistR = 0.24 * wave;
      pose.tilt = 0.09 * wave + (calm ? 0 : Math.sin(t * 0.9) * 0.03);
      if (t > blinkAt + 0.14) blinkAt = t + 2 + Math.random() * 3;
      pose.expr = wave > 0.35 ? 2 : t > blinkAt && !calm ? 1 : 0;
      set.setPose(0, pose);
      set.commit();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('paste', onPaste);
    set?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
