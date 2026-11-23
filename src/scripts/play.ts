// Playing a game on its page (pages/games/[game].astro). The TV's casing turns into a CRT's around
// the game and back: its hole, drawn as a path, morphs from the screen's rounded rectangle to a
// CRT's outline (sides bowed out, corners rounded) the shape of the game's picture, and the game
// fades in inside it. A power button takes the plaza button's place meanwhile; pressing it removes
// the game's frame, which ends it, and plays the morph in reverse. The TV's buttons stay where they
// always are; the screen fits under them. The radio waits while a game plays.
import { track } from './analytics';
import { hold, release } from './music/engine';

/** A CRT's outline on a 1000 unit square: a start point, then edge, corner, edge, corner... */
const CRT: number[][] = [
  [95, 14],
  [500, -14, 905, 14],
  [962, 17, 984, 39, 986, 95],
  [1014, 500, 986, 905],
  [984, 961, 962, 983, 905, 986],
  [500, 1014, 95, 986],
  [38, 983, 16, 961, 14, 905],
  [-14, 500, 14, 95],
  [16, 39, 38, 17, 95, 14],
];
const OPS = ['M', 'Q', 'C', 'Q', 'C', 'Q', 'C', 'Q', 'C'];

/** The same outline as an SVG, for the mask that cuts the screen to it. */
const MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'><path d='${CRT.map((p, i) => OPS[i] + p.join(' ')).join('')}Z'/></svg>`,
)}")`;

interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
}

const path = (pts: number[][]) => pts.map((p, i) => OPS[i] + p.map((n) => n.toFixed(1)).join(' ')).join('') + 'Z';

/** The CRT's outline stretched over a box. */
const crt = (b: Box) => path(CRT.map((p) => p.map((n, i) => (i % 2 ? b.t + (n * b.h) / 1000 : b.l + (n * b.w) / 1000))));

/** A rounded rectangle drawn with the same steps as the CRT, so one can turn into the other. */
function rounded(b: Box, rx: number, ry: number) {
  const k = 0.5523;
  const r = b.l + b.w;
  const d = b.t + b.h;
  const mx = b.l + b.w / 2;
  const my = b.t + b.h / 2;
  return path([
    [b.l + rx, b.t],
    [mx, b.t, r - rx, b.t],
    [r - rx + k * rx, b.t, r, b.t + ry - k * ry, r, b.t + ry],
    [r, my, r, d - ry],
    [r, d - ry + k * ry, r - rx + k * rx, d, r - rx, d],
    [mx, d, b.l + rx, d],
    [b.l + rx - k * rx, d, b.l, d - ry + k * ry, b.l, d - ry],
    [b.l, my, b.l, b.t + ry],
    [b.l, b.t + ry - k * ry, b.l + rx - k * rx, b.t, b.l + rx, b.t],
  ]);
}

/** The casing: the whole window less the hole. */
const casing = (hole: string) => `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z${hole}")`;

/** Where the TV's ordinary screen is and how round its corners are, measured off a probe. */
function tvScreen() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;inset:var(--bezel-top) var(--bezel) var(--bezel-bottom);border-radius:var(--crt);visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const r = probe.getBoundingClientRect();
  const [rx, ry = rx] = getComputedStyle(probe).borderTopLeftRadius.split(' ').map(parseFloat);
  probe.remove();
  return rounded({ l: r.left, t: r.top, w: r.width, h: r.height }, rx, ry);
}

/**
 * The game's screen: its picture's shape, as large as fits between the casing's sides and under the
 * TV's buttons, with a dark lip round it.
 */
function crtScreen(aspect: number) {
  const phone = innerWidth < 880;
  const bx = phone ? 14 : 72;
  const by = phone ? 76 : 100;
  const rim = Math.min(16, Math.max(10, Math.min(innerWidth, innerHeight) * 0.016));
  const w = Math.min(innerWidth - 2 * bx, (innerHeight - 2 * by) * aspect);
  const h = w / aspect;
  const lip = { l: (innerWidth - w) / 2 - rim, t: (innerHeight - h) / 2 - rim, w: w + 2 * rim, h: h + 2 * rim };
  return { lip, rim };
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MORPH = { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };

export function wirePlay() {
  const playBtn = document.querySelector<HTMLButtonElement>('[data-game-play]');
  const screen = document.querySelector<HTMLElement>('[data-player]');
  const stopBtn = document.querySelector<HTMLButtonElement>('[data-game-stop]');
  const cover = document.querySelector<HTMLElement>('[data-cover]');
  const glass = document.querySelector<HTMLElement>('.tv-glass');
  const tube = screen?.querySelector<HTMLElement>('.tube');
  if (!playBtn || !screen || !tube || !glass || playBtn.dataset.wired) return;
  playBtn.dataset.wired = '1';
  const html = document.documentElement;
  const aspect = Number(screen.dataset.aspect) || 4 / 3;
  const game = screen.dataset.player ?? '';
  let playing = false;
  let since = 0;

  /** Places the screen and returns the casing's hole round it. */
  const place = () => {
    const { lip, rim } = crtScreen(aspect);
    Object.assign(screen.style, {
      left: `${lip.l - 2}px`,
      top: `${lip.t - 2}px`,
      width: `${lip.w + 4}px`,
      height: `${lip.h + 4}px`,
      padding: `${rim + 2}px`,
    });
    return crt(lip);
  };
  const onResize = () => {
    if (playing) glass.style.clipPath = casing(place());
  };

  playBtn.addEventListener('click', () => {
    if (playing) return;
    playing = true;
    since = performance.now();
    track('game_played', { game });
    const from = casing(tvScreen());
    html.dataset.playing = '';
    screen.style.setProperty('--crt-mask', MASK);
    const to = casing(place());

    // The casing becomes a panel with a hole in it, the hole still the TV's screen, then morphs.
    Object.assign(glass.style, { inset: '0', border: '0', borderRadius: '0', boxShadow: 'none', background: 'var(--color-casing)', transition: 'none', clipPath: to });
    // The plaza button fades out now (html[data-playing]); power only once the CRT has formed, as on
    // the way out it goes first and the plaza button only comes back once the TV has.
    const morph = calm() ? undefined : glass.animate([{ clipPath: from }, { clipPath: to }], MORPH);
    morph?.finished.then(() => playing && stopBtn?.showPopover(), () => {});

    // A game has sound of its own: the radio fades out and waits until it ends.
    hold('game');
    const frame = document.createElement('iframe');
    frame.src = screen.dataset.src ?? '';
    frame.title = screen.dataset.title ?? 'Game';
    frame.allow = 'autoplay; fullscreen; gamepad';
    // Someone else's server sees only that the game was opened from here.
    if (screen.hasAttribute('data-external')) frame.referrerPolicy = 'strict-origin-when-cross-origin';
    tube.prepend(frame);
    screen.hidden = false;
    if (!calm()) screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 300, easing: 'ease-out', fill: 'backwards' });
    if (!morph) stopBtn?.showPopover();
    cover?.setAttribute('inert', '');
    addEventListener('resize', onResize);
    frame.addEventListener('load', () => frame.focus(), { once: true });
    frame.focus();
  });

  /** Back to the ordinary TV, with the morph in reverse unless the page is going anyway. */
  const end = async (animate: boolean) => {
    if (!playing) return;
    playing = false;
    track('game_stopped', { game, seconds: Math.round((performance.now() - since) / 1000) });
    removeEventListener('resize', onResize);
    tube.querySelector('iframe')?.remove();
    release('game');
    stopBtn?.hidePopover();
    if (animate && !calm()) {
      await screen.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in' }).finished;
      screen.hidden = true;
      await glass.animate([{ clipPath: glass.style.clipPath }, { clipPath: casing(tvScreen()) }], { ...MORPH, duration: 520 }).finished;
    }
    screen.hidden = true;
    glass.style.cssText = '';
    delete html.dataset.playing;
    cover?.removeAttribute('inert');
    if (animate) playBtn.focus();
  };

  stopBtn?.addEventListener('click', () => end(true));
  document.addEventListener('astro:before-swap', () => end(false), { once: true });
}
