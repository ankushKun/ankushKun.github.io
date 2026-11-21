// Runs the plaza: builds the scene, plays the opening, then keeps the place alive and answers
// zoom, the mouse and the cube links, in time with the sound.
import * as THREE from 'three';
import { loadMiiKit } from '../mii/kit';
import { SCORE, soundtrack } from './audio';
import { Bubbles } from './bubbles';
import { Crowd, SKYFALL } from './crowd';
import { GRAVITY } from './motion';
import { Cubes } from './cubes';
import { Floor, HAZE } from './floor';
import { HeadCards } from './heads';
import { drawIcons, thumb } from './icons';
import { applyView, blankView, copyView, makeLayout, mixViews, type Layout } from './layout';
import type { PlazaData } from './types';
import { clamp, damp, easeIn, easeInOut, rng, smoothstep } from './util';

/**
 * The opening, in seconds from the visitor's click. The page opens on your Mii floating high in the
 * haze and waits for a click, which is also what lets the browser play sound. Then you fall, the
 * camera riding down with you, and land among your friends; you wave hello while they stare up at
 * the sky; the camera pulls back and the cubes tumble in one after another. The crowd keeps time
 * with the recording: it sets off on the first footsteps and is home by the last.
 */
const INTRO = {
  drop: 0,
  down: SKYFALL.time,
  landed: SKYFALL.time + 0.6,
  gaze: SKYFALL.time + 0.5,
  pull: 3.65,
  wide: 4.35,
  cubes: 4.1,
  // The run sets off 2.5 s before the first footsteps in the recording; the talk starts after.
  crowd: SCORE.crowd - 2.5,
  talk: SCORE.crowd + 2.5,
};
/** Seconds the camera takes to dive at a cube before the page changes. */
const LEAVE = 0.5;
/** Zoom runs from 0 (farthest, where it starts) through 1 (the whole plaza) to 3 (the middle group up close). */
const ZOOM = { min: 0, rest: 0, max: 3, close: 2.5 };

export async function start(root: HTMLElement, data: PlazaData) {
  const need = <E extends Element>(el: E | null): E => {
    if (!el) throw new Error('Plaza markup is incomplete');
    return el;
  };
  const canvas = need(root.querySelector('canvas'));
  const bubbleLayer = need(root.querySelector<HTMLElement>('.plaza-bubbles'));
  const veil = need(root.querySelector<HTMLElement>('.plaza-veil'));
  const begin = need(root.querySelector<HTMLButtonElement>('.plaza-start'));
  const card = need(root.querySelector<HTMLElement>('.plaza-who'));
  const cardImg = need(card.querySelector('img'));
  const cardName = need(card.querySelector('span'));
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[data-cube]')];

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = root.clientWidth;
  let h = root.clientHeight;
  const small = matchMedia('(pointer: coarse)').matches || Math.min(w, h) < 640;
  const device = navigator as Navigator & { deviceMemory?: number };
  const weak = (device.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency || 8) < 4;

  // The feature slots get a random pick of posts and projects on every visit.
  const picks = [...data.featured].sort(() => Math.random() - 0.5);
  data.cubes.forEach((cube, i) => {
    if (!cube.feature || !picks.length) return;
    const pick = picks.shift()!;
    data.cubes[i] = pick;
    const link = links[i];
    if (link) {
      link.href = pick.href;
      const tag = link.querySelector('span');
      if (tag) tag.textContent = pick.label;
    }
  });

  // The sound loads alongside everything else. A slow one is not waited for: it joins in step.
  const music = soundtrack();
  const [kit, icons] = await Promise.all([
    loadMiiKit(),
    drawIcons(data.cubes, 512),
    Promise.race([music.ready, new Promise((done) => setTimeout(done, 3000))]),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Resolution steps the plaza can drop through if a device can't keep up (see `govern` below).
  const ratios = [Math.min(devicePixelRatio, 2), 1.5, 1.25, 1, 0.8, 0.65].filter((r, i, all) => r <= all[0] && all.indexOf(r) === i);
  let ratioLevel = small || weak ? ratios.findIndex((r) => r <= 1.5) : 0;
  renderer.setPixelRatio(ratios[ratioLevel]);
  renderer.setSize(w, h, false);
  // Every shader here writes display colors directly, as the Mii shader does.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(HAZE, 1);

  const scene = new THREE.Scene();
  // The blocks are drawn last, over a copy of everything else, which their glass looks through.
  const glass = new THREE.Scene();
  let behind = new THREE.FramebufferTexture(1, 1);
  const size = new THREE.Vector2();
  function sizeBehind() {
    renderer.getDrawingBufferSize(size);
    if (behind.image.width === size.x && behind.image.height === size.y) return;
    behind.dispose();
    behind = new THREE.FramebufferTexture(size.x, size.y);
    behind.minFilter = behind.magFilter = THREE.LinearFilter;
    cubes.setBehind(behind, size.x, size.y);
  }
  const camera = new THREE.PerspectiveCamera(5.2, w / h, 1, 2500);
  const floor = new Floor(scene, weak ? 0.35 : 0.5);
  floor.resize(renderer);

  const cubes = new Cubes(
    scene,
    glass,
    icons.map((icon) => {
      const tex = new THREE.CanvasTexture(icon);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }),
  );
  const random = rng(2012);
  const crowd = new Crowd(scene, {
    kit,
    renderer,
    hero: data.hero,
    pool: data.pool,
    count: small || weak ? data.crowd.mobile : data.crowd.desktop,
    cubes: data.cubes.length,
    resolution: 128,
    random,
  });
  sizeBehind();
  // Heads small on screen are drawn as flat pictures, all in one draw call.
  const cards = new HeadCards(scene, renderer, crowd.crowdSet, small || weak ? 56 : 80);
  let carded = false;
  const bubbles = new Bubbles(
    bubbleLayer,
    data.posts,
    icons.map((icon) => thumb(icon, 128)),
  );

  // Camera ---------------------------------------------------------------------------------------

  let layout: Layout = makeLayout(w / h, data.cubes.length);
  const now = blankView();
  const eye = blankView();
  const landing = blankView();
  const zoomed = blankView();
  const shown = blankView();
  /** Where zoom is headed, and where it is now; it eases between the two. */
  let zoomTo: number = ZOOM.rest;
  let zoom: number = ZOOM.rest;
  let close = false;
  /** The pointer, -1..1 across and up the screen, and the camera's eased response to it. */
  const pointer = new THREE.Vector2();
  const follow = new THREE.Vector2();
  let time = 0;
  let opening = !calm;
  /**
   * The first time a visitor sees the opening in this browser session it plays through: clicks,
   * Escape and zoom don't skip it. After that, they do.
   */
  const SEEN = 'plaza-opening-seen';
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN) === '1';
  } catch {
    // Storage can be blocked; then every visit counts as the first.
  }
  function markSeen() {
    if (seen) return;
    seen = true;
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      // Not remembered; nothing else to do.
    }
  }
  /** Waiting for the visitor's click, which starts everything. */
  let waiting = !calm;
  /** When the opening began, on the scene's clock. Until the click, never. */
  let start = calm ? -Infinity : Infinity;
  /** Seconds into the opening. */
  const since = () => time - start;
  /** Whether the scene is still following the recording through the opening. */
  let scored = !calm;
  let leaving: { at: number; cube: number; from: THREE.Vector3; dist: number } | null = null;
  let built = false;

  function arrange(moveCrowd: boolean) {
    layout = makeLayout(w / h, data.cubes.length);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyView(camera, layout.views[1]);
    cubes.place(layout.anchors, camera);
    if (moveCrowd) crowd.setLayout(layout);
  }
  arrange(true);

  if (waiting) {
    crowd.hover(0);
    cubes.launch(Infinity);
    copyView(layout.sky, now);
  } else {
    crowd.settle(0);
    cubes.settle();
    copyView(layout.views[1], now);
  }

  /** The click: sound starts, you fall, the opening plays from here. */
  function go(withSound = true) {
    if (!waiting) return;
    waiting = false;
    start = time;
    root.dataset.waiting = 'false';
    crowd.drop(start + INTRO.drop);
    crowd.applaud(start + INTRO.gaze, start + INTRO.pull + 0.4);
    crowd.arrive(start + INTRO.crowd, SCORE.settled - INTRO.crowd);
    cubes.launch(start + INTRO.cubes);
    if (withSound) music.begin(() => (scored && since() < SCORE.settled ? since() : null));
    else scored = false;
  }

  /** Skips the rest of the opening, if this visitor has already seen it once this session. */
  function skip() {
    if (seen) endOpening();
  }

  function endOpening() {
    if (!opening || waiting) return;
    opening = false;
    if (since() < INTRO.wide) {
      // Skipped: everyone is simply there, so the sound moves on to the theme too.
      time = start + INTRO.wide;
      scored = false;
      cubes.settle();
      crowd.settle(time);
      music.settle();
    }
  }

  function zoomBy(amount: number) {
    if (waiting || (opening && !seen)) return;
    endOpening();
    zoomTo = clamp(zoomTo + amount, ZOOM.min, ZOOM.max);
  }

  /** The view for a zoom level between the four set ones. */
  function zoomView(level: number, out: typeof now) {
    const { views } = layout;
    const i = Math.min(Math.floor(level), views.length - 2);
    return mixViews(views[i], views[i + 1], level - i, out);
  }

  function aim(dt: number) {
    const { views, sky } = layout;
    if (leaving) {
      const e = easeIn(Math.min(1, (time - leaving.at) / LEAVE));
      eye.target.lerpVectors(leaving.from, cubes.position(leaving.cube, eye.target), e);
      eye.dist = leaving.dist * (1 - e * 0.82);
      eye.pitch = now.pitch;
      eye.fov = now.fov;
      eye.haze[0] = now.haze[0];
      eye.haze[1] = now.haze[1];
      return eye;
    }
    if (waiting) return copyView(sky, now);
    if (opening) {
      const t = since();
      // The camera rides down with you, keeping you in frame, and opens out to the group as you land.
      mixViews(views[3], views[3], 0, landing);
      landing.target.y += 0.75;
      landing.dist *= 1.25;
      if (t < INTRO.landed) {
        // One unbroken move from the sky to the group: framing eases over the whole fall and
        // landing, and the camera's height follows you down on a spring, so it never jerks.
        const e = smoothstep(0, INTRO.landed, t);
        mixViews(sky, landing, smoothstep(0, INTRO.down * 1.15, t), now);
        if (t > INTRO.down * 0.6) mixViews(now, views[3], smoothstep(INTRO.down * 0.6, INTRO.landed, t), now);
        // The camera rides down with you, then brakes just before you land and settles; it hands
        // over to the group's framing as it does.
        const ride = rideHeight(t);
        now.target.y = ride + (now.target.y - ride) * e * e;
        return now;
      }
      if (t < INTRO.pull) {
        // Hold on the middle group, drifting back by a hair so the shot stays alive.
        mixViews(views[3], views[3], 0, now);
        now.dist *= 1 + ((t - INTRO.landed) / (INTRO.pull - INTRO.landed)) * 0.035;
        return now;
      }
      if (t < INTRO.wide) {
        const p = (t - INTRO.pull) / (INTRO.wide - INTRO.pull);
        return mixViews(views[3], zoomView(zoom, zoomed), easeInOut(p), now);
      }
      opening = false;
      markSeen();
    }
    zoom = calm ? zoomTo : damp(zoom, zoomTo, 7, dt);
    // Coming in close, the middle group gives a little show; the bubbles make way.
    if (zoom > ZOOM.close !== close) {
      close = !close;
      if (close) bubbles.dismiss();
      crowd.notice(close, time);
    }
    return mixViews(now, zoomView(zoom, zoomed), calm ? 1 : 1 - Math.exp(-14 * dt), now);
  }

  /** The view actually shown: the aimed one, eased a little toward the pointer, as in a game. */
  function lean(v: typeof now, dt: number) {
    copyView(v, shown);
    if (calm || leaving) return shown;
    follow.x = damp(follow.x, pointer.x, 2.6, dt);
    follow.y = damp(follow.y, pointer.y, 2.6, dt);
    const span = shown.dist * Math.tan(THREE.MathUtils.degToRad(shown.fov / 2));
    shown.target.x += follow.x * span * camera.aspect * 0.035;
    shown.target.z -= follow.y * span * 0.12;
    shown.yaw -= follow.x * 0.03;
    shown.pitch += follow.y * 0.012;
    return shown;
  }

  // Input ----------------------------------------------------------------------------------------

  // The first click anywhere starts it all; once it is running, a click skips the opening.
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (waiting) go();
    else skip();
  });
  begin.addEventListener('click', () => go());
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') music.toggle();
    else if (e.key === '+' || e.key === '=') zoomBy(0.5);
    else if (e.key === '-' || e.key === '_') zoomBy(-0.5);
    else if (waiting && (e.key === 'Enter' || e.key === ' ')) go();
    else if (e.key === 'Escape') skip();
  });
  // Wheel and trackpad zoom smoothly; a trackpad pinch arrives as a wheel with ctrl held.
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? h : 1;
      zoomBy(-e.deltaY * lines * (e.ctrlKey ? 0.012 : 0.0025));
    },
    { passive: false },
  );
  // Touch does what the mouse does. One finger on open floor is the cursor: the camera drifts
  // toward it and the blocks turn to face it, easing back when it lifts. Two fingers pinch to
  // zoom, and a second finger landing turns any block being spun into a pinch instead.
  const touches = new Map<number, { x: number; y: number; onBlock: boolean }>();
  let pinch = 0;
  const spread = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const point = (x: number, y: number) => {
    pointer.set((x / w) * 2 - 1, 1 - (y / h) * 2);
    cubes.setMouse(pointer);
  };
  const letLook = () => {
    pointer.set(0, 0);
    cubes.setMouse(null);
  };
  /** Set by each block: lets go of a spin in progress without counting as a tap. */
  const dropSpins: (() => void)[] = [];
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const onBlock = !!(e.target as Element).closest('a') || press?.id === e.pointerId;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, onBlock });
    if (touches.size === 2) {
      pinch = spread();
      for (const drop of dropSpins) drop();
      letGoMii(false);
      letLook();
    } else if (!onBlock) point(e.clientX, e.clientY);
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return point(e.clientX, e.clientY);
    const t = touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (touches.size === 1) {
      if (!t.onBlock) point(e.clientX, e.clientY);
      return;
    }
    if (touches.size !== 2) return;
    const d = spread();
    zoomBy(Math.log(d / pinch) * 1.6);
    pinch = d;
  });
  const lift = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size === 0) letLook();
  };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') letLook();
  });

  // Miis: tap one and it does something for you; press and drag to pick it up by the shirt, and
  // let go to set it down or fling it. A short press on a touch screen lifts it without moving.
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  const rayAt = (x: number, y: number) => {
    raycaster.setFromCamera(_ndc.set((x / w) * 2 - 1, 1 - (y / h) * 2), camera);
    return raycaster.ray;
  };
  const local = (e: PointerEvent) => {
    const box = root.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };
  const playful = () => !waiting && !opening && !leaving;
  let press: { id: number; mii: number; x: number; y: number; at: number; holding: boolean } | null = null;
  function liftMii() {
    if (!press || press.holding) return;
    press.holding = crowd.grab(press.mii, time, rayAt(press.x, press.y));
    if (press.holding) root.dataset.holding = 'true';
  }
  /** Ends a press: a tap pokes (when `tap`), a hold lets go. */
  function letGoMii(tap: boolean) {
    if (!press) return;
    if (press.holding) crowd.release(press.mii, time);
    else if (tap) crowd.poke(press.mii, time, camera.position);
    if (root.hasPointerCapture(press.id)) root.releasePointerCapture(press.id);
    press = null;
    delete root.dataset.holding;
  }
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button > 0 || press || touches.size > 0 || !playful() || (e.target as Element).closest('a, button')) return;
      const [x, y] = local(e);
      const mii = crowd.pick(camera, x, y, w, h);
      if (mii < 0) return;
      press = { id: e.pointerId, mii, x, y, at: performance.now(), holding: false };
      root.setPointerCapture(e.pointerId);
      hideCard();
    },
    // Ahead of the touch handling below, so it knows this finger is on a Mii.
    { capture: true },
  );
  root.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (e.pointerType === 'mouse') mouse = { x, y };
    if (!press || e.pointerId !== press.id) return;
    if (!press.holding && Math.hypot(x - press.x, y - press.y) > 6) liftMii();
    press.x = x;
    press.y = y;
  });
  root.addEventListener('pointerup', (e) => {
    if (press?.id === e.pointerId) letGoMii(true);
  });
  root.addEventListener('pointercancel', (e) => {
    if (press?.id === e.pointerId) letGoMii(false);
  });

  // On a desktop, resting the pointer on a named Mii for a moment shows who it is, and its QR code.
  const hovers = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let mouse: { x: number; y: number } | null = null;
  let hovered = -1;
  let hoverSince = 0;
  let shownCard = -1;
  let lastPick = 0;
  /** When the pointer last slipped off the hovered Mii. Miis move, so a brief miss doesn't count. */
  let missedAt = -1;
  function hideCard() {
    if (shownCard < 0) return;
    shownCard = -1;
    card.classList.remove('is-in');
  }
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse = null;
    hovered = -1;
    hideCard();
  });
  /** Each frame: what the mouse is over, the cursor for it, and the card. */
  function hover() {
    if (!hovers) return;
    const now = performance.now();
    if (now - lastPick > 90 || !mouse) {
      lastPick = now;
      let over = mouse && playful() && !press ? crowd.pick(camera, mouse.x, mouse.y, w, h, hovered) : -1;
      if (over < 0 && hovered >= 0 && mouse && !press) {
        if (missedAt < 0) missedAt = now;
        if (now - missedAt < 350) over = hovered;
      } else missedAt = -1;
      if (over !== hovered) {
        hovered = over;
        hoverSince = now;
        hideCard();
      }
      root.dataset.over = String(hovered >= 0);
    }
    const who = hovered >= 0 ? crowd.who(hovered) : null;
    if (who && shownCard !== hovered && now - hoverSince > 1400) {
      shownCard = hovered;
      cardName.textContent = who.name;
      cardImg.hidden = !who.qr;
      if (who.qr) cardImg.src = who.qr;
      card.classList.add('is-in');
    }
    if (shownCard < 0) return;
    crowd.headTop(shownCard, _at).project(camera);
    const x = (_at.x + 1) * 0.5 * w;
    const y = (1 - _at.y) * 0.5 * h;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    // Above the head, kept on screen; under the pointer instead when there is no room above.
    const top = y - ch - 10 >= 8 ? y - ch - 10 : Math.min(h - ch - 8, (mouse?.y ?? y) + 24);
    card.style.transform = `translate3d(${Math.round(clamp(x - cw / 2, 8, w - cw - 8))}px, ${Math.round(top)}px, 0)`;
  }

  links.forEach((link, i) => {
    // Drag a block to spin it; it springs back when let go. A drag is not a click.
    let grip: { id: number; x: number; y: number; moved: number } | null = null;
    let spun = false;
    link.draggable = false;
    link.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || leaving) return;
      grip = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      spun = false;
      link.setPointerCapture(e.pointerId);
      cubes.grab(i);
    });
    link.addEventListener('pointermove', (e) => {
      if (!grip || e.pointerId !== grip.id) return;
      const dx = e.clientX - grip.x;
      const dy = e.clientY - grip.y;
      grip.x = e.clientX;
      grip.y = e.clientY;
      grip.moved += Math.abs(dx) + Math.abs(dy);
      if (grip.moved > 6) spun = true;
      // About a half turn for a drag across the block.
      const size = Math.max(40, link.offsetWidth);
      cubes.twist(i, (dx / size) * Math.PI * 0.9, (dy / size) * Math.PI * 0.9);
    });
    const letGo = (e: PointerEvent) => {
      if (!grip || e.pointerId !== grip.id) return;
      grip = null;
      cubes.release(i);
    };
    dropSpins.push(() => {
      if (!grip) return;
      if (link.hasPointerCapture(grip.id)) link.releasePointerCapture(grip.id);
      grip = null;
      spun = true;
      cubes.release(i);
    });
    link.addEventListener('pointerup', letGo);
    link.addEventListener('pointercancel', letGo);
    const hover = (on: boolean) => () => cubes.setHover(i, on);
    link.addEventListener('pointerenter', hover(true));
    link.addEventListener('pointermove', (e) => {
      if (calm || grip) return;
      const box = link.getBoundingClientRect();
      cubes.setPoint(i, ((e.clientX - box.left) / box.width) * 2 - 1, ((e.clientY - box.top) / box.height) * 2 - 1);
    });
    link.addEventListener('pointerleave', hover(false));
    link.addEventListener('focus', hover(true));
    link.addEventListener('blur', hover(false));
    link.addEventListener('click', (e) => {
      if (spun) {
        e.preventDefault();
        spun = false;
        return;
      }
      if (calm || leaving || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      endOpening();
      leaving = { at: time, cube: i, from: now.target.clone(), dist: now.dist };
      bubbles.dismiss();
      music.duck(true, LEAVE * 0.9);
      veil.style.transition = `opacity ${LEAVE * 0.55}s ease ${LEAVE * 0.45}s`;
      veil.style.opacity = '1';
      setTimeout(() => location.assign(link.href), LEAVE * 1000 + 30);
    });
  });
  // Coming back with the back button restores the page as it was left: mid dive, behind the veil.
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    leaving = null;
    veil.style.transition = 'opacity 0.4s ease';
    veil.style.opacity = '0';
    music.duck(false);
  });

  const sizes = links.map(() => 0);
  /** Where each section block is on screen, for bubbles to keep clear of. */
  const blocks: { x: number; y: number; w: number; h: number }[] = [];
  function placeLinks() {
    blocks.length = 0;
    const hidden = opening || leaving !== null;
    links.forEach((link, i) => {
      const at = cubes.project(i, camera, w, h);
      const size = Math.round(at.r * 2);
      if (size !== sizes[i]) {
        sizes[i] = size;
        link.style.width = link.style.height = `${size}px`;
      }
      link.style.transform = `translate3d(${Math.round(at.x - size / 2)}px, ${Math.round(at.y - size / 2)}px, 0)`;
      link.style.visibility = at.visible && !hidden ? 'visible' : 'hidden';
      if (at.visible) blocks.push({ x: at.x - size / 2, y: at.y - size / 2, w: size, h: size });
    });
  }

  // Loop -----------------------------------------------------------------------------------------

  function tick(dt: number) {
    time += dt;
    const v = lean(aim(dt), dt);
    applyView(camera, v);
    floor.setHaze(v.haze[0], v.haze[1]);
    cubes.setHaze(v.haze[0], v.haze[1]);
    // The camera drifts with the pointer, so the hand is placed again every step, not only when it moves.
    if (press?.holding) crowd.carry(press.mii, rayAt(press.x, press.y));
    crowd.update(dt, time, camera.position, calm);
    // Blocks belong to the wide views. Closer in than about two thirds of the standard view they fade.
    const open = (v.dist * Math.tan(THREE.MathUtils.degToRad(v.fov / 2))) / (layout.views[1].dist * Math.tan(THREE.MathUtils.degToRad(layout.views[1].fov / 2)));
    cubes.update(time, dt, calm, camera, v.dist, opening && time < INTRO.wide ? 1 : smoothstep(0.55, 0.78, open));
    return v;
  }

  function draw(target: THREE.Vector3) {
    renderer.getDrawingBufferSize(size);
    cards.update(camera, size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), true);
    floor.mirror(renderer, scene, camera, target, time);
    renderer.render(scene, camera);
    // The glass looks through a copy of everything drawn so far, then goes on top of it.
    if (cubes.items.some((item) => item.mesh.visible)) {
      renderer.copyFramebufferToTexture(behind);
      renderer.autoClear = false;
      renderer.render(glass, camera);
      renderer.autoClear = true;
    }
    placeLinks();
    if (press && !press.holding && performance.now() - press.at > 350) liftMii();
    hover();
    bubbles.update(time, crowd, camera, w, h, !opening && !leaving && !close && (calm || since() > INTRO.talk), blocks);
    if (waiting) pointAt();
  }

  /**
   * The camera's height through the fall: level with you while you drop, then a smooth braking
   * curve that starts a little before you land and comes to rest at standing height, so the
   * impact reads in the frame without the camera itself jolting.
   */
  function rideHeight(t: number) {
    const fall = (s: number) => SKYFALL.height - 0.5 * GRAVITY * s * s + 0.72;
    const brake = SKYFALL.time * 0.74;
    if (t <= brake) return fall(t);
    const span = SKYFALL.time + 0.3 - brake;
    const s = Math.min(1, (t - brake) / span);
    const y0 = fall(brake);
    const m0 = -GRAVITY * brake * span;
    // Cubic Hermite from the falling speed to rest.
    return (2 * s ** 3 - 3 * s * s + 1) * y0 + (s ** 3 - 2 * s * s + s) * m0 + (-2 * s ** 3 + 3 * s * s) * 0.72;
  }

  /** Keeps the click prompt on your floating Mii. */
  function pointAt() {
    crowd.headTop(0, _at).project(camera);
    const top = (1 - _at.y) * 0.5 * h;
    crowd.headTop(0, _at);
    _at.y = crowd.leadLift();
    _at.project(camera);
    const x = (_at.x + 1) * 0.5 * w;
    const feet = (1 - _at.y) * 0.5 * h;
    const y = (top + feet) / 2;
    // Wide enough that the ring clears the Mii, outstretched arms and all.
    const size = Math.max(120, (feet - top) * 1.55);
    begin.style.transform = `translate3d(${Math.round(x - size / 2)}px, ${Math.round(y - size / 2)}px, 0)`;
    begin.style.setProperty('--size', `${Math.round(size)}px`);
  }
  const _at = new THREE.Vector3();

  let raf = 0;
  let last = 0;
  /**
   * Keeps the frame rate up on slow machines. It watches real frame times, and if they stay slow
   * for a moment it drops the resolution a step, easing back up later if there is room. Steps are
   * spaced out, so it settles rather than hunting.
   */
  let slowFor = 0;
  let fastFor = 0;
  let lastChange = 0;
  function govern(realDt: number) {
    if (realDt > 0.25) return; // a stall (tab switch, compile), not a slow device
    if (realDt > 1 / 45) slowFor += realDt;
    else slowFor = Math.max(0, slowFor - realDt * 0.5);
    if (realDt < 1 / 57) fastFor += realDt;
    else fastFor = 0;
    const now = performance.now();
    if (now - lastChange < 2500) return;
    let next = ratioLevel;
    if (slowFor > 1.2 && ratioLevel < ratios.length - 1) next++;
    else if (fastFor > 12 && ratioLevel > 0) next--;
    if (next === ratioLevel) return;
    ratioLevel = next;
    slowFor = fastFor = 0;
    lastChange = now;
    renderer.setPixelRatio(ratios[ratioLevel]);
    renderer.setSize(w, h, false);
    floor.resize(renderer);
    sizeBehind();
  }

  /**
   * Moves the world on by `real` seconds of wall time, in small steps so nothing is skipped. While
   * the recording runs through the opening the scene is eased toward it, a few percent faster or
   * slower, so the two never drift apart without ever jumping or stalling to catch up.
   */
  function advance(real: number) {
    // A tab the browser froze for minutes just picks up again; anything shorter is caught up.
    let left = Math.min(real, 30);
    let v = null;
    do {
      let dt = Math.min(left, 0.05);
      left -= dt;
      const heard = scored && !waiting ? music.position() : null;
      if (heard !== null) dt *= 1 + clamp((heard - since()) * 2, -0.15, 0.15);
      v = tick(dt);
    } while (left > 1e-6);
    return v;
  }

  function frame(t: number) {
    if (resized) applyResize();
    const real = Math.max(0, (t - last) / 1000);
    govern(real);
    last = t;
    // Crowd heads are made a few per frame, so the opening never stalls on them.
    if (!built) built = crowd.build(performance.now() + 5);
    if (!carded) carded = cards.bake(performance.now() + 3);
    draw(advance(real).target);
    if (root.dataset.state !== 'live') {
      root.dataset.state = 'live';
      root.dataset.waiting = String(waiting);
      // With nothing to wait for, sound joins whenever the browser lets it.
      if (!waiting) music.begin(() => null);
    }
    raf = requestAnimationFrame(frame);
  }
  function resume() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  /**
   * A tab that isn't showing gets no frames, but the plaza doesn't stop: the music plays on, and a
   * timer keeps the Miis and the opening moving (without drawing), so coming back finds them
   * wherever they have got to.
   */
  setInterval(() => {
    if (document.visibilityState === 'visible') return;
    const t = performance.now();
    if (!built) built = crowd.build(t + 5);
    advance(Math.max(0, (t - last) / 1000));
    last = t;
  }, 100);

  // Resizing a canvas wipes it, and the browser can paint it blank before the next frame draws:
  // that is what made everything flicker as the window was dragged. So a resize is only noted
  // here, and applied at the start of the next frame, which then draws straight away.
  let resized = false;
  new ResizeObserver(() => {
    resized = true;
    resume();
  }).observe(root);
  function applyResize() {
    resized = false;
    const nw = root.clientWidth;
    const nh = root.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    const flipped = makeLayout(nw / nh, data.cubes.length).tall !== layout.tall;
    w = nw;
    h = nh;
    renderer.setSize(w, h, false);
    floor.resize(renderer);
    sizeBehind();
    arrange(true);
    // Bubbles follow their speakers anyway; only a switch between wide and tall clears them.
    if (flipped) bubbles.clear();
    if (!opening) zoomView(zoom, now);
  }

  // Compile every shader before the first frame, so the drop plays without a hitch.
  applyView(camera, now);
  for (const item of cubes.items) item.mesh.visible = item.ring.visible = true;
  renderer.compile(scene, camera);
  renderer.compile(glass, camera);

  if (import.meta.env.DEV) {
    // For checking a moment of the opening in the console: __plaza.seek(4.2), __plaza.zoom(2.5).
    // __plaza.still() redraws the waiting scene without starting.
    Object.assign(window, {
      __plaza: {
        /** Seconds after the click; starts the opening silently if it is still waiting. */
        seek(to: number) {
          go(false);
          scored = false;
          music.settle();
          built = crowd.build(Infinity);
          carded = cards.bake(Infinity);
          while (since() < to) tick(1 / 60);
          cancelAnimationFrame(raf);
          raf = 0;
          draw(tick(0).target);
        },
        zoom(level: number) {
          endOpening();
          zoom = zoomTo = clamp(level, ZOOM.min, ZOOM.max);
          zoomView(zoom, now);
        },
        spin(i: number, x: number, y: number) {
          cubes.grab(i);
          cubes.twist(i, x, y);
        },
        drop: (i: number) => cubes.release(i),
        point(x: number, y: number) {
          pointer.set(x, y);
          follow.set(x, y);
          cubes.setMouse(pointer);
        },
        play: resume,
        still() {
          built = crowd.build(Infinity);
          for (let i = 0; i < 90; i++) tick(1 / 60);
          cancelAnimationFrame(raf);
          raf = 0;
          draw(tick(0).target);
        },
        crowd: () => crowd.stats(),
        /** Where Mii `i` is on screen (CSS pixels): its feet and the top of its head, and what it is doing. */
        mii(i: number) {
          crowd.headTop(i, _at).project(camera);
          const top = [(_at.x + 1) * 0.5 * w, (1 - _at.y) * 0.5 * h];
          crowd.headTop(i, _at);
          _at.y -= crowd.headTop(i, new THREE.Vector3()).y - crowd.miis[i].lift;
          _at.project(camera);
          const m = crowd.miis[i];
          return { top, feet: [(_at.x + 1) * 0.5 * w, (1 - _at.y) * 0.5 * h], act: m.act, lift: +m.lift.toFixed(2), who: crowd.who(i)?.name ?? null, vel: +m.vel.toFixed(2), x: +m.x.toFixed(2), z: +m.z.toFixed(2), legL: +m.shown.legL.toFixed(2) };
        },
        /** What a frame costs: draw calls, triangles, textures. */
        info() {
          renderer.info.autoReset = false;
          renderer.info.reset();
          draw(camera.position);
          const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, programs: renderer.info.programs?.length, px: [renderer.domElement.width, renderer.domElement.height] };
          renderer.info.autoReset = true;
          return r;
        },
        /** Average CPU time per frame over 60 frames, split into simulation and draw submission. */
        profile() {
          const t0 = performance.now(); let a = 0, b = 0;
          for (let i = 0; i < 60; i++) { const s = performance.now(); tick(1 / 60); const m = performance.now(); draw(camera.position); const e = performance.now(); a += m - s; b += e - m; }
          return { tickMs: +(a / 60).toFixed(2), drawSubmitMs: +(b / 60).toFixed(2), total: +((performance.now() - t0) / 60).toFixed(2) };
        },
      },
    });
  }

  last = performance.now();
  raf = requestAnimationFrame(frame);
}
