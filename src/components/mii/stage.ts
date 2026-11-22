// One Mii standing on a little stage: it waves hello when it appears and whenever it is tapped,
// with the plaza's own wave, and looks toward the pointer, turning to follow it across and nodding
// to follow it up and down. Used on the About page.
import * as THREE from 'three';
import { decodeMii } from './data';
import { loadMiiKit } from './kit';
import { MiiSet, restPose } from './rig';
import { LENGTH, wave } from '../plaza/motion';

/** Starts the stage. The returned function stops it and frees its GPU memory, at any point. */
export function mountStage(root: HTMLElement, code: string): () => void {
  const canvas = root.querySelector('canvas');
  const mii = decodeMii(code);
  let stopped = false;
  let cleanup = () => {};
  const stop = () => {
    stopped = true;
    cleanup();
  };
  if (!canvas || !mii) return stop;

  loadMiiKit()
    .then((kit) => {
      if (stopped) return;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
      const set = new MiiSet(kit, renderer, [mii], { resolution: 512, happy: true, shadows: true });
      set.build();
      scene.add(set.group);
      const top = set.headTop(0);
      camera.position.set(0, top * 0.62, top * 3.1);
      camera.lookAt(0, top * 0.5, 0);

      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const pose = restPose();
      let waveAt = performance.now() + 250;
      let yaw = 0;
      let aimYaw = 0;
      let nod = 0;
      let aimNod = 0;
      let blinkAt = 2;
      let last = performance.now();
      let visible = true;
      let raf = 0;

      const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
      // Where the pointer is from the Mii's eyes: across turns it, up and down nods its head.
      const onPointer = (e: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        aimYaw = clamp(((e.clientX - (box.left + box.width / 2)) / innerWidth) * 1.6, 0.7);
        const eyes = box.top + box.height * 0.3;
        aimNod = clamp(((e.clientY - eyes) / innerHeight) * 1.1, 0.4);
      };
      const onTap = () => {
        if (performance.now() - waveAt > LENGTH.wave * 1000) waveAt = performance.now();
      };
      addEventListener('pointermove', onPointer, { passive: true });
      canvas.addEventListener('click', onTap);
      const seen = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(frame);
      });
      seen.observe(canvas);

      function frame(now: number) {
        raf = 0;
        if (stopped || !visible) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const t = now / 1000;
        const w = canvas!.clientWidth;
        const h = canvas!.clientHeight;
        if (canvas!.width !== Math.round(w * renderer.getPixelRatio())) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
        const ease = 1 - Math.exp(-3 * dt);
        yaw += (aimYaw - yaw) * ease;
        nod += (aimNod - nod) * ease;
        const breathe = calm ? 0 : Math.sin(t * 2.1) * 0.02;
        Object.assign(pose, restPose(), { outL: 0.14 + breathe, outR: 0.14 + breathe });
        pose.tilt = calm ? 0 : Math.sin(t * 0.9) * 0.03;
        // Hello: the plaza's wave, the upper arm out to the side and the forearm waving up by the head.
        const since = (now - waveAt) / 1000;
        const waving = !calm && since >= 0 && since < LENGTH.wave;
        if (waving) wave(pose, since, 0);
        if (!calm) {
          // Half the turn is the body, half the head; the nod is all head, with a little lean.
          pose.yaw = yaw * 0.5;
          pose.headYaw = yaw * 0.5;
          pose.nod += nod;
          pose.leanX += nod * 0.12;
        }
        if (t > blinkAt + 0.14) blinkAt = t + 2 + Math.random() * 3;
        if (!waving) pose.expr = t > blinkAt && !calm ? 1 : 0;
        set.setPose(0, pose);
        set.commit();
        renderer.render(scene, camera);
        root.dataset.ready = '';
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        seen.disconnect();
        removeEventListener('pointermove', onPointer);
        canvas.removeEventListener('click', onTap);
        set.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
    })
    .catch((err: unknown) => console.warn('Mii stage failed to start', err));
  return stop;
}
