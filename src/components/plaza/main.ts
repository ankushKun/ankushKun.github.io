// Runs the plaza: builds the scene, plays the opening, then keeps the place alive and answers
// zoom, the mouse and the cube links, in time with the sound. It stays alive for the whole visit:
// going to another page puts it to sleep (no frames, the scene's clock stopped) and coming back
// wakes it, pulling back out of the block you went in through (Plaza.astro).
import * as THREE from 'three';
import { navigate } from 'astro:transitions/client';
import { sectionOf } from '../../lib/nav';
import { previousPath } from '../../scripts/motion';
import * as radio from '../../scripts/music/engine';
import { closeOver, followPlayer, openOver, playerOpen, showOver, type Spot } from '../../scripts/music/widget';
import { loadMiiKit } from '../mii/kit';
import { SCORE, soundtrack } from './audio';
import { Boombox, type BoomboxKind } from './boombox';
import { Bubbles } from './bubbles';
import type { Chatter } from './chatter';
import { HeadGear } from './headgear';
import { Crowd, SKYFALL } from './crowd';
import { GRAVITY } from './motion';
import { Cubes } from './cubes';
import { Floor, HAZE } from './floor';
import { HeadCards } from './heads';
import { drawIcons, thumb } from './icons';
import { NowPlaying } from './nowplaying';
import { CUBE, applyView, blankView, copyView, makeLayout, mixViews, type Layout } from './layout';
import type { PlazaCube, PlazaData } from './types';
import { clamp, damp, easeInOut, rng, smoothstep } from './util';

/** When the camera has pulled all the way back to the whole plaza, in seconds from the click. */
const WIDE = 4.35;
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
  wide: WIDE,
  cubes: 4.1,
  // The run sets off 2.5 s before the first footsteps in the recording; the talk starts after.
  crowd: SCORE.crowd - 2.5,
  // Your Mii greets you a moment after the camera has pulled all the way back; everyone else talks
  // once the crowd has run in.
  greet: WIDE + 1.5,
  talk: SCORE.crowd + 2.5,
};
/** How far the camera drifts back while it holds on the middle group after you land, as a fraction of its distance. */
const HOLD_DRIFT = 0.035;
/** Zoom runs from 0 (farthest, where it starts) through 1 (the whole plaza) to 3 (the middle group up close). */
const ZOOM = { min: 0, rest: 0, max: 3, close: 2.5 };
/**
 * A name tag's size in world units, so it is about a fifth of a Mii's height at every zoom. Far out,
 * where that would be too small to read, it holds at TAG_MIN pixels.
 */
const TAG_SIZE = 0.18;
const TAG_MIN = 11;
/** Seconds the camera takes to zoom into a block you pressed, and to pull back out of it when you come back. */
const DIVE = 0.7;
const STEP_BACK = 1.5;
/** Seconds between the feature blocks turning to a new pick. */
const FEATURE_EVERY = 6.9;
/** Seconds the "Now playing" bubble stays up when a new track starts. */
const NOW_PLAYING = 3;

export interface PlazaControl {
  /** Leaving the plaza for another page: no more frames until it wakes. */
  sleep(): void;
  /** Back from `from`, the page just left. */
  wake(from: string | null): void;
}

/** Starts the plaza. Its first frame is drawn once the page is shown. */
export async function start(root: HTMLElement, data: PlazaData): Promise<PlazaControl> {
  const need = <E extends Element>(el: E | null): E => {
    if (!el) throw new Error('Plaza markup is incomplete');
    return el;
  };
  const canvas = need(root.querySelector('canvas'));
  const bubbleLayer = need(root.querySelector<HTMLElement>('.plaza-bubbles'));
  const begin = need(root.querySelector<HTMLButtonElement>('.plaza-start'));
  const card = need(root.querySelector<HTMLElement>('.plaza-who'));
  // Frames a second, counted over each half second, shown while developing.
  const fps = import.meta.env.DEV ? root.querySelector<HTMLElement>('.plaza-fps') : null;
  if (fps) fps.hidden = false;
  const counted = { frames: 0, from: 0 };
  const djButton = need(root.querySelector<HTMLButtonElement>('.plaza-dj'));
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[data-cube]')];
  /** On the plaza now, rather than asleep behind another page. */
  let active = location.pathname === '/';

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = root.clientWidth;
  let h = root.clientHeight;
  const small = matchMedia('(pointer: coarse)').matches || Math.min(w, h) < 640;
  const device = navigator as Navigator & { deviceMemory?: number };
  const weak = (device.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency || 8) < 4;

  // The feature slots: a random post, project, page or app each, turning to another every
  // FEATURE_EVERY seconds (`turnFeatures`). Picks come off a shuffled deck, so everything comes
  // round before anything comes round twice, and never one another slot is showing.
  const featureSlots = data.cubes.flatMap((c, i) => (c.feature ? [i] : []));
  const deck: PlazaCube[] = [];
  function drawFeature(): PlazaCube | null {
    if (!deck.length) {
      deck.push(...data.featured);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    const shown = new Set(featureSlots.map((i) => data.cubes[i].href));
    const at = deck.findIndex((c) => !shown.has(c.href));
    return at < 0 ? null : deck.splice(at, 1)[0];
  }
  function showFeature(i: number, pick: PlazaCube) {
    data.cubes[i] = pick;
    const link = links[i];
    if (!link) return;
    link.href = pick.href;
    link.setAttribute('aria-label', pick.label);
    const tag = link.querySelector('span');
    if (tag) tag.textContent = pick.label;
  }
  for (const i of featureSlots) {
    const pick = drawFeature();
    if (pick) showFeature(i, pick);
  }

  // The sound loads alongside everything else. A slow one is not waited for: it joins in step.
  const music = soundtrack();
  const [kit, icons] = await Promise.all([
    loadMiiKit(),
    drawIcons(data.cubes, 512),
    // Being prerendered, the sound may not decode until the page is shown: it joins in step later.
    prerendering() ? null : Promise.race([music.ready(), new Promise((done) => setTimeout(done, 3000))]),
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

  // Day or night, after the site's light or dark (src/scripts/theme.ts). A change dims or raises
  // the lights over about half a second rather than cutting.
  const isNight = () => document.documentElement.dataset.theme === 'dark';
  let night = isNight() ? 1 : 0;
  let nightTo = night;
  floor.setNight(night);
  renderer.setClearColor(HAZE, 1);
  new MutationObserver(() => {
    nightTo = isNight() ? 1 : 0;
    resume();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const cubes = new Cubes(
    scene,
    glass,
    icons.map((icon) => {
      const tex = new THREE.CanvasTexture(icon);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }),
  );
  // The Music block shows what the radio is playing.
  const musicCube = data.cubes.findIndex((c) => c.href === '/apps/music/');
  const coverArt =
    musicCube >= 0
      ? new NowPlaying(cubes.items[musicCube].mesh.material.uniforms.uIcon, cubes.items[musicCube].mesh.material.uniforms.uIcon.value, renderer.capabilities.getMaxAnisotropy())
      : null;
  const random = rng(2012);
  const crowd = new Crowd(scene, {
    kit,
    renderer,
    hero: data.hero,
    pool: data.pool,
    count: small || weak ? data.crowd.mobile : data.crowd.desktop,
    cubes: data.cubes.length,
    djCube: musicCube,
    dj: data.dj,
    backup: data.backup,
    resolution: 128,
    random,
  });
  // The DJ under the Music block, with the boombox on their shoulder.
  const boombox = crowd.dj >= 0 ? new Boombox(scene, data.boombox, calm) : null;
  // Headsets and ponytails for whoever's look has them.
  const gear = crowd.gear.map(({ i, look }) => ({ i, worn: new HeadGear(scene, look) }));
  let heard = false;
  sizeBehind();
  // Heads small on screen are drawn as flat pictures, all in one draw call.
  const cards = new HeadCards(scene, renderer, crowd.crowdSet, small || weak ? 56 : 80);
  let carded = false;
  const bubbles = new Bubbles(
    bubbleLayer,
    data.posts,
    icons.map((icon) => thumb(icon, 128)),
    // A different greeting on every visit.
    data.welcome[Math.floor(Math.random() * data.welcome.length)] ?? null,
  );

  // The chat's latest messages join the bubbles, said under the Chat block (chatter.ts). It listens
  // while the plaza is open, and starts over on coming back, so what was read in the chat meanwhile
  // is no longer new.
  const chatCube = data.cubes.findIndex((c) => c.href === '/apps/chat/');
  let chatter: Chatter | null = null;
  let hearing = 0;
  function hearChat() {
    if (chatCube < 0 || chatter) return;
    const token = ++hearing;
    import('./chatter')
      .then(({ Chatter }) => {
        if (token === hearing && active) chatter = new Chatter(chatCube, data.cubes[chatCube].href, bubbles);
      })
      .catch((err: unknown) => console.warn('Chat bubbles failed', err));
  }
  function stopChat() {
    hearing++;
    chatter?.stop();
    chatter = null;
  }
  bubbles.onSay = (post) => chatter?.said(post);

  // Camera ---------------------------------------------------------------------------------------

  let layout: Layout = makeLayout(w / h, data.cubes.length);
  const now = blankView();
  const landing = blankView();
  /** The hold on the middle group after landing, where the pull back starts from. */
  const held = blankView();
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
  /**
   * Coming back from another page: the TV's plaza button opens /#0, and the plaza is simply there,
   * everyone in place, with no fall and nothing to click first. Going back in history to it counts
   * too. The mark is taken off the address (once the page is shown, if it is being prerendered), so
   * a refresh plays the opening as usual.
   */
  const traversed = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward';
  // Started by the router after another page of the site (the first visit began elsewhere), the
  // page before is the one the router came from; on a fresh load, the referrer.
  const routed = previousPath() !== location.pathname ? previousPath() : null;
  const cameFrom = routed ?? sameSite(document.referrer);
  const returning = location.hash === '#0' || (traversed && cameFrom !== null);
  if (location.hash === '#0') whenShown(() => history.replaceState(history.state, '', location.pathname + location.search));
  /** No opening and no waiting: reduced motion, or coming back. */
  const quiet = calm || returning;
  let opening = !quiet;
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
  let waiting = !quiet;
  /** When the opening began, on the scene's clock. Until the click, never. */
  let start = quiet ? -Infinity : Infinity;
  /** Seconds into the opening. */
  const since = () => time - start;
  /** Whether the scene is still following the recording through the opening. */
  let scored = !quiet;
  /**
   * Stepping back out of a block (`stepOut`): the close view it starts from, and when the pull back
   * begins, on the scene's clock. Infinity until the loading veil lifts.
   */
  const stepFrom = blankView();
  let stepping = false;
  let stepAt = Infinity;
  /** How much the blocks show, eased, so they fade rather than blink out up close. */
  let blocksShown = 1;
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
    if (withSound) {
      radio.prime();
      music.begin(() => (scored && since() < SCORE.settled ? since() : null));
    } else scored = false;
  }

  /**
   * The plaza's theme gives way to the radio: a random track fades in as the theme fades out, once
   * the crowd is in (or as soon as the opening is skipped). If the radio can't start (YouTube is
   * blocked, or the visitor stopped it this session), the theme plays on.
   */
  let handedOver = false;
  let handing = false;
  function handOver(seconds: number) {
    if (handedOver || waiting) return;
    handedOver = handing = true;
    void radio.takeOver(seconds).then((ok) => {
      handing = false;
      if (ok) music.release(seconds);
    });
  }
  // Whenever the radio is playing, the theme is not: started from the widget mid-opening, say, or
  // let out by a press after the browser held it back. M mutes both.
  let nowPlaying = -1;
  radio.subscribe((s) => {
    music.setMuted(s.muted);
    const on = s.playing && !s.loading && !s.blocked && s.index >= 0;
    coverArt?.set(s.playing && s.index >= 0 ? s.tracks[s.index].thumb : null, s.audible);
    heard = s.audible;
    crowd.setGroove(heard);
    if (on && !handing && !music.released) {
      handedOver = true;
      music.release(1.5);
    }
    // A new track while you are here: the DJ says what it is (your Mii, without a DJ), briefly.
    if (on && s.index !== nowPlaying) {
      nowPlaying = s.index;
      const t = s.tracks[s.index];
      const said = t && { text: `Now playing: ${t.title} by ${t.artist}`, href: '/apps/music/', thumb: t.thumb };
      const me = data.welcome[0];
      if (active && said && !waiting && !opening) {
        if (crowd.dj >= 0) bubbles.sayNext({ cube: musicCube, tag: data.cubes[musicCube].label, by: crowd.dj, ...said }, NOW_PLAYING);
        else if (me) bubbles.sayNext({ ...me, ...said }, NOW_PLAYING);
      }
    }
  });

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
      handOver(1.5);
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

  /** Where block `i` floats, for the camera to close in on. */
  const blockAt = (i: number) => {
    const at = layout.anchors[i];
    return new THREE.Vector3(at.x, CUBE.lift, at.z);
  };

  /** The view up close on `point`, from `from`: `near` is how much of the distance is left. */
  function closeOn(point: THREE.Vector3, from: typeof now, near: number, out: typeof now) {
    copyView(from, out);
    out.target.copy(point);
    out.dist = from.dist * near;
    // The haze is measured from the camera; moved in, it moves in with it.
    out.haze[0] -= from.dist * (1 - near);
    out.haze[1] -= from.dist * (1 - near);
    return out;
  }

  /**
   * Pressing a block: the camera zooms into it until it fills the screen, and the next page fades in
   * over that. Pressing a speech bubble does the same into whoever is saying it, the bubble growing
   * toward you as it goes (`keep`, Plaza.astro). `stepOut` is the move backwards.
   */
  const diveFrom = blankView();
  const diveTo = blankView();
  let diving = false;
  let diveAt = 0;
  function dive(point: THREE.Vector3, near: number, keep?: Element) {
    copyView(now, diveFrom);
    closeOn(point, zoomView(zoom, zoomed), near, diveTo);
    diveAt = time;
    diving = true;
    stepping = false;
    bubbles.dismiss(keep);
    hideCard();
    letLook();
    closeOver();
  }

  /**
   * Back from a page: the camera starts up close on the block you went in through (or the block of
   * the section that page is in) and pulls back from it to where it rests, so coming back reads as
   * stepping back out of the block. A page with no block of its own comes back to the plaza as it is.
   */
  function stepOut(path: string | null, hold = Infinity) {
    if (calm || !path || waiting || opening) return;
    let i = data.cubes.findIndex((c) => c.href === path);
    if (i < 0 && path !== '/') i = data.cubes.findIndex((c) => sectionOf(c.href) === sectionOf(path) && c.href.startsWith('/') && !c.href.includes('#'));
    if (i < 0) return;
    // Close enough that the block fills about half the screen.
    closeOn(blockAt(i), zoomView(zoom, zoomed), 0.3, stepFrom);
    copyView(stepFrom, now);
    stepping = true;
    stepAt = time + hold;
    blocksShown = 1;
    bubbles.dismiss();
  }

  function aim(dt: number) {
    const { views, sky } = layout;
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
      // Hold on the middle group, drifting back by a hair so the shot stays alive, then pull back
      // from exactly where the drift has got to, so the move out starts without a jump.
      mixViews(views[3], views[3], 0, held);
      held.dist *= 1 + (Math.min(1, (t - INTRO.landed) / (INTRO.pull - INTRO.landed)) * HOLD_DRIFT);
      if (t < INTRO.pull) return copyView(held, now);
      if (t < INTRO.wide) {
        const p = (t - INTRO.pull) / (INTRO.wide - INTRO.pull);
        return mixViews(held, zoomView(zoom, zoomed), easeInOut(p), now);
      }
      opening = false;
      markSeen();
    }
    zoom = calm ? zoomTo : damp(zoom, zoomTo, 7, dt);
    if (import.meta.env.DEV && closeUp) return closeOn(crowd.headTop(closeUp.mii, new THREE.Vector3()), zoomView(zoom, zoomed), closeUp.near, now);
    // Coming in close, the middle group gives a little show; the bubbles make way.
    if (zoom > ZOOM.close !== close) {
      close = !close;
      if (close) bubbles.dismiss();
      crowd.notice(close, time);
    }
    if (diving) {
      const p = Math.min(1, (time - diveAt) / DIVE);
      // Slow to start, as a camera would, and still speeding up as the next page takes over.
      return mixViews(diveFrom, diveTo, p * p * (3 - 2 * p) * 0.6 + p * p * 0.4, now);
    }
    if (stepping) {
      // Held on the block until the page change has shown it, then pulled back, slowing to rest.
      const p = (time - stepAt) / STEP_BACK;
      if (p < 1) return mixViews(stepFrom, zoomView(zoom, zoomed), p <= 0 ? 0 : 1 - (1 - p) ** 3, now);
      stepping = false;
    }
    return mixViews(now, zoomView(zoom, zoomed), calm ? 1 : 1 - Math.exp(-14 * dt), now);
  }

  /** In dev, `__plaza.look(i)` holds the camera up close on Mii `i`. */
  let closeUp: { mii: number; near: number } | null = null;

  /** The view actually shown: the aimed one, eased a little toward the pointer, as in a game. */
  function lean(v: typeof now, dt: number) {
    copyView(v, shown);
    if (calm) return shown;
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
    if (!active || e.metaKey || e.ctrlKey || e.altKey) return;
    // Keys pressed on the light switch, the music widget and the lobby's links are their own. M
    // mutes the music everywhere (src/scripts/music/engine.ts); the theme follows it.
    if (e.target instanceof Element && e.target.closest('[data-theme-toggle], [data-music-widget], [data-lobby]')) return;
    if (e.key === '+' || e.key === '=') zoomBy(0.5);
    else if (e.key === '-' || e.key === '_') zoomBy(-0.5);
    else if (waiting && (e.key === 'Enter' || e.key === ' ')) go();
    else if (e.key === 'Escape') skip();
  });
  // The Konami code: everyone dances, and you get your extra lives.
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konami = 0;
  addEventListener('keydown', (e) => {
    if (!active) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami < KONAMI.length) return;
    konami = 0;
    if (waiting) return;
    endOpening();
    crowd.party(time, camera.position);
    const me = data.welcome[0];
    if (me) bubbles.sayNext({ ...me, text: '30 extra lives! Spend them wisely.' });
  });

  /**
   * Leaving through a block or a bubble: the camera dives into `point` while the plaza fades into
   * its haze, and only then does the router change the page, so the camera gets all the way in
   * first; the next page then fades in. The radio takes over from the theme on the way out.
   */
  function leave(link: HTMLAnchorElement, point: THREE.Vector3, near: number, keep?: Element) {
    if (root.dataset.leaving) return;
    document.documentElement.removeAttribute('data-arrive');
    document.documentElement.style.setProperty('--dive', `${DIVE}s`);
    root.dataset.leaving = 'true';
    link.blur();
    endOpening();
    dive(point, near, keep);
    music.duck(true, DIVE);
    handOver(DIVE);
    setTimeout(() => travel(link.href), calm ? 0 : DIVE * 1000);
  }

  /** To another page of the site through the router, which keeps this document (and the music); anywhere else, a plain load. */
  function travel(href: string) {
    const to = new URL(href, location.href);
    if (to.origin !== location.origin) return location.assign(to.href);
    void navigate(to.pathname + to.search + to.hash);
  }

  // Pressing a speech bubble dives into whoever is saying it. The DJ's bubble opens the music
  // player over them in its place.
  bubbleLayer.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a.plaza-bubble') : null;
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const speaker = bubbles.speakerOf(link);
    if (speaker < 0) return;
    e.preventDefault();
    if (speaker === crowd.dj) {
      bubbles.dismiss();
      crowd.hush(speaker, time);
      showOver(djSpot);
      return;
    }
    link.classList.add('is-chosen');
    leave(link, crowd.headTop(speaker, new THREE.Vector3()), 0.12, link);
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
    const onBlock = !!(e.target as Element).closest('a, .plaza-dj') || press?.id === e.pointerId;
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
  const playful = () => !waiting && !opening;
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
    // A tap on the DJ is a press of their button: it opens the music player.
    else if (tap && press.mii === crowd.dj) djButton.click();
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
    if (e.pointerType === 'mouse') {
      mouse = { x, y };
      // A Mii behind a speech bubble, a block or a button is out of reach; so is its name.
      overUi = e.target instanceof Element && !!e.target.closest('.plaza-bubble, a[data-cube], button');
    }
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

  // On a desktop, resting the pointer on a named Mii for a moment shows its name over its head.
  const hovers = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let mouse: { x: number; y: number } | null = null;
  /** Whether the pointer is on something of its own (a bubble, a block) rather than the plaza. */
  let overUi = false;
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
      // The DJ's button covers them, so pointing at it is pointing at them.
      let over = djButton.matches(':hover') ? crowd.dj : mouse && !overUi && playful() && !press ? crowd.pick(camera, mouse.x, mouse.y, w, h, hovered) : -1;
      if (over < 0 && hovered >= 0 && mouse && !overUi && !press) {
        if (missedAt < 0) missedAt = now;
        if (now - missedAt < 350) over = hovered;
      } else missedAt = -1;
      if (over !== hovered) {
        hovered = over;
        hoverSince = now;
        hideCard();
      }
      root.dataset.over = String(hovered >= 0 && hovered !== crowd.dj);
    }
    const who = hovered >= 0 ? crowd.who(hovered) : null;
    if (who && shownCard !== hovered && now - hoverSince > 400) {
      shownCard = hovered;
      card.textContent = who.name;
      card.classList.add('is-in');
    }
    if (shownCard < 0) return;
    crowd.headTop(shownCard, _at);
    // The tag has a size in the world, as the Mii does, so it grows and shrinks with it at every
    // zoom: its letters are TAG_SIZE units tall, however far away that is on screen.
    const far = _at.distanceTo(camera.position);
    const perUnit = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * far);
    const px = Math.round(Math.max(TAG_MIN, TAG_SIZE * perUnit) * devicePixelRatio) / devicePixelRatio;
    if (card.style.fontSize !== `${px}px`) card.style.fontSize = `${px}px`;
    _at.project(camera);
    const x = (_at.x + 1) * 0.5 * w;
    const y = (1 - _at.y) * 0.5 * h;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    // Centered just over the head, at a gap in step with its size, and kept on screen.
    const top = Math.max(8, y - ch - px * 0.4);
    const left = clamp(x - cw / 2, 8, w - cw - 8);
    card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  links.forEach((link, i) => {
    // Drag a block to spin it; it springs back when let go. A drag is not a click.
    let grip: { id: number; x: number; y: number; moved: number } | null = null;
    let spun = false;
    link.draggable = false;
    link.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
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
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      leave(link, blockAt(i), 0.16);
    });
  });

  const sizes = links.map(() => 0);
  /** Where each section block is on screen, for bubbles to keep clear of. */
  const blocks: { x: number; y: number; w: number; h: number }[] = [];
  function placeLinks() {
    blocks.length = 0;
    const hidden = opening;
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

  // The DJ: a button over them, so a press (or Enter) opens the music player over their head, and
  // the player follows them while it is open.
  djButton.hidden = crowd.dj < 0;
  const djBox = { x: 0, top: 0, bottom: 0, on: false };
  /** Where the DJ is in the viewport, for the player to open over; null while they can't be seen. */
  const djSpot = (): Spot | null => {
    if (!active || !djBox.on) return null;
    const box = root.getBoundingClientRect();
    return { x: box.left + djBox.x, top: box.top + djBox.top, bottom: box.top + djBox.bottom };
  };
  djButton.addEventListener('click', (e) => {
    openOver(djSpot);
    // Already open in its corner: it moves over the DJ rather than closing.
    if (playerOpen() === 'corner') {
      e.preventDefault();
      followPlayer();
    }
  });
  function placeDj() {
    if (crowd.dj < 0) return;
    djBox.on = crowd.djShown() && playful() && !diving;
    if (djBox.on) {
      const feet = crowd.headTop(crowd.dj, _at).setY(crowd.miis[crowd.dj].lift).project(camera);
      const x = (feet.x + 1) * 0.5 * w;
      const bottom = (1 - feet.y) * 0.5 * h;
      crowd.headTop(crowd.dj, _at).project(camera);
      const top = (1 - _at.y) * 0.5 * h;
      djBox.on = _at.z < 1 && bottom > 0 && top < h && x > 0 && x < w;
      Object.assign(djBox, { x, top, bottom });
      // Tall enough for the Mii, wide enough for the boombox too, and never too small to press.
      const tall = Math.max(36, bottom - top + 8);
      const wide = Math.max(36, tall * 0.9);
      djButton.style.width = `${Math.round(wide)}px`;
      djButton.style.height = `${Math.round(tall)}px`;
      djButton.style.transform = `translate3d(${Math.round(x - wide / 2)}px, ${Math.round(bottom + 4 - tall)}px, 0)`;
    }
    djButton.classList.toggle('is-on', djBox.on);
    followPlayer();
  }

  // Loop -----------------------------------------------------------------------------------------

  function tick(dt: number) {
    time += dt;
    if (night !== nightTo) {
      night = calm || Math.abs(nightTo - night) < 0.002 ? nightTo : damp(night, nightTo, 4.5, dt);
      floor.setNight(night);
      renderer.setClearColor(HAZE, 1);
    }
    const v = lean(aim(dt), dt);
    applyView(camera, v);
    floor.setHaze(v.haze[0], v.haze[1]);
    cubes.setHaze(v.haze[0], v.haze[1]);
    // The camera drifts with the pointer, so the hand is placed again every step, not only when it moves.
    if (press?.holding) crowd.carry(press.mii, rayAt(press.x, press.y));
    // The stage keeps the beat of whatever the radio plays, wherever it is in the track.
    const playing = radio.snapshot();
    crowd.beat.update(dt, heard && playing.index >= 0 ? playing.tracks[playing.index].beats : null, radio.playhead());
    crowd.update(dt, time, camera.position, calm);
    for (const { i, worn } of gear) worn.place(crowd.headOf(i));
    if (boombox) {
      const { yaw, scale } = crowd.djFrame();
      boombox.update(crowd.djShown() ? crowd.djWrist : null, yaw, scale, crowd.djBeats, heard, time, dt, crowd.djDancing ? crowd.djSpot : null);
    }
    // Blocks belong to the wide views. Closer in than about two thirds of the standard view they fade.
    const open = (v.dist * Math.tan(THREE.MathUtils.degToRad(v.fov / 2))) / (layout.views[1].dist * Math.tan(THREE.MathUtils.degToRad(layout.views[1].fov / 2)));
    const showing = (opening && time < INTRO.wide) || stepping || diving ? 1 : smoothstep(0.55, 0.78, open);
    blocksShown = calm || dt === 0 ? showing : damp(blocksShown, showing, 4, dt);
    cubes.update(time, dt, calm, camera, v.dist, blocksShown);
    coverArt?.update();
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
    placeDj();
    if (press && !press.holding && performance.now() - press.at > 350) liftMii();
    hover();
    turnFeatures();
    const talk = bubbles.greeting ? INTRO.greet : INTRO.talk;
    bubbles.update(time, crowd, camera, w, h, !opening && !close && !stepping && !diving && (calm || since() > talk), blocks);
    if (waiting) pointAt();
  }

  /**
   * Every FEATURE_EVERY seconds once the plaza has settled, each feature block turns once round to
   * a new pick, unless it is pointed at or held. Its picture is drawn first and the block takes it
   * on as it passes edge on; its link and name change with it.
   */
  let featureAt = Infinity;
  function turnFeatures() {
    if (!featureSlots.length || waiting || opening || diving || stepping || root.dataset.leaving) return;
    if (featureAt === Infinity) featureAt = time + FEATURE_EVERY;
    if (time < featureAt) return;
    featureAt = time + FEATURE_EVERY;
    for (const i of featureSlots) {
      if (cubes.engaged(i) || cubes.flipping(i)) continue;
      const pick = drawFeature();
      if (!pick) continue;
      void drawIcons([pick], 512).then(
        ([icon]) => {
          const tex = new THREE.CanvasTexture(icon);
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          renderer.initTexture(tex);
          const turned = active && !root.dataset.leaving && cubes.flip(i, tex, time, (old) => {
            showFeature(i, pick);
            old.dispose();
          });
          if (!turned) tex.dispose();
        },
        () => undefined,
      );
    }
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

  /** Frames drawn so far. The loading veil lifts after the second, once the first frame's hitch is over. */
  let frames = 0;
  function frame(t: number) {
    if (!active) {
      raf = 0;
      return;
    }
    if (resized) applyResize();
    const real = Math.max(0, (t - last) / 1000);
    if (fps) {
      if (!counted.from) counted.from = t;
      counted.frames++;
      if (t - counted.from >= 500) {
        fps.textContent = String(Math.round((counted.frames * 1000) / (t - counted.from)));
        counted.frames = 0;
        counted.from = t;
      }
    }
    govern(real);
    last = t;
    // Crowd heads are made a few per frame, so the opening never stalls on them.
    if (!built) built = crowd.build(performance.now() + 5);
    if (!carded) carded = cards.bake(performance.now() + 3);
    draw(advance(real).target);
    // The crowd is in: the radio takes over from the theme. Coming back to a plaza already there,
    // it does so at once.
    if (!handedOver && !waiting && since() >= SCORE.settled) handOver(2.5);
    if (++frames === 2) {
      root.dataset.state = 'live';
      // Back from a page, the pull out of its block starts as the veil lifts.
      if (stepping && stepAt === Infinity) stepAt = time + 0.25;
      root.dataset.waiting = String(waiting);
      // With nothing to wait for, sound joins whenever the browser lets it.
      if (!waiting) music.begin(() => null);
      // The radio's player loads now the plaza is up, so it is ready by the time the theme hands over.
      setTimeout(radio.prepare, 1200);
    }
    raf = requestAnimationFrame(frame);
  }
  function resume() {
    if (raf || !active) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  /**
   * A tab that isn't showing gets no frames, but the plaza doesn't stop: the music plays on, and a
   * timer keeps the Miis and the opening moving (without drawing), so coming back finds them
   * wherever they have got to.
   */
  setInterval(() => {
    if (!active || document.visibilityState === 'visible' || prerendering()) return;
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
        /** Holds the camera up close on Mii `i` (`near` is how much of the distance is left), or lets it go with no `i`. */
        look(i?: number, near = 0.08) {
          closeUp = i === undefined ? null : { mii: i, near };
        },
        /** Where the camera is and how wide it sees, as drawn last (for checking camera moves frame by frame). */
        camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov }),
        /** The stage dances as if music were heard, or stops with `false`, without the radio. */
        groove: (on = true) => crowd.setGroove(on),
        /** Swaps the DJ's boombox: 'model' or 'drawn'. */
        boombox: (kind: BoomboxKind) => boombox?.show(kind),
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

  // Back from another page: up close on its block, pulling back (`stepOut`). A page change that
  // came back to this very plaza from the back/forward cache does the same, and lets the sound up.
  stepOut(returning ? cameFrom : null);
  addEventListener('pageshow', (e) => {
    if (!e.persisted || !active) return;
    diving = false;
    bubbles.clear();
    delete root.dataset.leaving;
    music.duck(false, 0.6);
    last = performance.now();
    const from = (navigation as unknown as { activation?: { from?: { url?: string } } } | undefined)?.activation?.from?.url;
    // The switch back to the plaza fades it in over about half a second (global.css): held till then.
    stepOut(sameSite(from ?? document.referrer), 0.4);
    resume();
  });

  // Prerendered, there are no frames to draw until the page is shown; then it starts at once.
  whenShown(() => {
    last = performance.now();
    raf = requestAnimationFrame(frame);
    // The chat a moment later, clear of the first frames.
    setTimeout(hearChat, 1500);
  });

  return {
    sleep() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      // The dive is over: nothing of it may linger on the page that comes next.
      diving = false;
      delete root.dataset.leaving;
      handOver(0.7);
      music.duck(true, 0.4);
      letGoMii(false);
      touches.clear();
      hideCard();
      closeOver();
      stopChat();
    },
    wake(from) {
      if (active) return;
      active = true;
      // The TV's plaza button opens /#0; the mark comes off so a refresh plays the opening.
      if (location.hash === '#0') history.replaceState(history.state, '', location.pathname + location.search);
      diving = false;
      bubbles.clear();
      delete root.dataset.leaving;
      music.duck(false, 0.6);
      last = performance.now();
      // The plaza fades in over about half a second (global.css): the pull back waits till then.
      stepOut(from, 0.4);
      resume();
      hearChat();
    },
  };
}

/** Whether the page is still being prerendered, out of sight (Base.astro asks for that). */
const prerendering = () => (document as Document & { prerendering?: boolean }).prerendering === true;

/** Runs `fn` now, or once the page is shown if it is still being prerendered. */
function whenShown(fn: () => void) {
  if (prerendering()) document.addEventListener('prerenderingchange', fn, { once: true });
  else fn();
}

/** The path of a URL on this site, or null for anywhere else. */
function sameSite(url: string | undefined | null) {
  if (!url) return null;
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin ? u.pathname : null;
  } catch {
    return null;
  }
}
