// How the TV moves between pages. Astro's router swaps pages in place inside a view transition (the
// CSS is at the end of global.css):
// - On the TV a page change is a fade: the casing, its buttons and the menu are one element
//   throughout and stay put, and only the column fades out and the new one in. The old column stays
//   where it was scrolled to (--vt-dy).
// - An app is the screen going full size (html[data-nav] app-in and app-out): the casing slides off
//   past the screen's edges as the app grows in, and back as you leave. The page's column is named
//   col-page meanwhile, so it fades on its own. A link marked data-grow (a channel on /apps/) grows
//   into the app, and the app shrinks back into it on the way out (html[data-door]).
// - Those moves only ever animate transforms (`boxMove`), which the compositor plays at full speed
//   while the app is busy starting up underneath; sizes and insets would wait on the page.
// - The menu stays open across page changes on a big screen, its marker moving to the new
//   section; on a phone, where it covers the page, it folds away first. Escape closes it. B goes
//   back.
// - On a phone the two buttons step aside while you read down a page, and come back when you
//   scroll up.
// Going to and from the plaza is a real page load instead (see Base.astro); going there, the page
// fades out first (data-going-home).
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { sectionOf } from '../lib/nav';
import { closeMenu, isMenuOpen, resetMenu, showMenuStill } from './menu';
import { play } from './sfx';

type Nav = 'page' | 'app-in' | 'app-out';

let nav: Nav = 'page';
/** The channel the move goes through, if it opens into an app or closes back into one. */
let door: HTMLElement | null = null;
/** Whether the menu was open when the page began to change, to open it again on the new one. */
let menuWasOpen = false;
let from = location.pathname;
let oldTop = 0;

/** Elements given a transition name for one move, cleared once it is over. */
const named = new Set<HTMLElement>();
function name(el: HTMLElement, value: string) {
  el.style.viewTransitionName = value;
  named.add(el);
}
function clearNames() {
  for (const el of named) el.style.viewTransitionName = '';
  named.clear();
}

const narrow = matchMedia('(max-width: 879px)');
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isApp = (doc: Document) => !!doc.querySelector('.col-app');

/** The lengths of the moves, as global.css sets them, in milliseconds. */
function length(token: '--vt-out' | '--vt-in' | '--vt-big') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000 || 300;
}

type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
const rectOf = (el: Element): Rect => {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
};

/**
 * The transform that takes a box at `to` (where a picture ends up) back to `from` (where it starts),
 * with its origin at the top left, and the one that leaves it at `to`. A move between them is a
 * transform only, so it never waits on layout.
 */
function boxMove(from: Rect, to: Rect) {
  const sx = to.width ? from.width / to.width : 1;
  const sy = to.height ? from.height / to.height : 1;
  return { from: `translate(${from.left}px, ${from.top}px) scale(${sx}, ${sy})`, to: `translate(${to.left}px, ${to.top}px)` };
}

/** Where the casing's screen and the channel were before the page changed, while an app comes or goes. */
let casing: Rect | null = null;
let doorFrom: Rect | null = null;

document.addEventListener('astro:before-preparation', (event) => {
  const e = event as TransitionBeforePreparationEvent;
  nav = 'page';
  from = e.from.pathname;
  clearNames();
  door = null;
  casing = null;
  const source = e.sourceElement instanceof Element ? e.sourceElement.closest('a') : null;
  // On a phone the menu covers the page: it folds away first, while the next page loads, so the
  // page change starts on a clear screen. It costs no time when the page takes longer to load.
  menuWasOpen = isMenuOpen();
  let folded: Promise<void> = Promise.resolve();
  if (menuWasOpen && narrow.matches) {
    menuWasOpen = false;
    folded = closeMenu();
  }
  // Whether an app comes or goes is only known once the next page is in hand, and the old page's
  // names have to be set before the move starts, so it is settled here, as the page loads.
  const load = e.loader;
  e.loader = async () => {
    await Promise.all([load(), folded]);
    const toApp = isApp(e.newDocument);
    if (toApp === isApp(document)) return;
    nav = toApp ? 'app-in' : 'app-out';
    const glass = document.querySelector('.tv-glass');
    if (glass) casing = rectOf(glass);
    if (!toApp) return;
    const main = document.getElementById('main');
    if (main) name(main, 'col-page');
    if (source?.hasAttribute('data-grow') && new URL(source.href).pathname === e.to.pathname && !calm()) {
      door = source;
      doorFrom = rectOf(source);
      name(source, 'col');
    }
  };
});

document.addEventListener('astro:before-swap', (event) => {
  const e = event as TransitionBeforeSwapEvent;
  oldTop = document.getElementById('main')?.getBoundingClientRect().top ?? 0;
  // Moving the menu to the new page closes it; it opens again after the swap if it was open.
  menuWasOpen ||= isMenuOpen() && !narrow.matches;

  // Out of an app, the page comes up behind it on its own, and the app shrinks back into the channel
  // it was opened from if the page has it.
  if (nav === 'app-out') {
    const main = e.newDocument.getElementById('main');
    if (main) name(main, 'col-page');
    const channel = e.newDocument.querySelector<HTMLElement>(`[data-grow][href="${CSS.escape(from)}"]`);
    if (channel && !calm()) {
      door = channel;
      const app = document.getElementById('main');
      if (app) doorFrom = rectOf(app);
      name(channel, 'col');
    }
  }

  e.viewTransition.finished.finally(clearNames);
});

document.addEventListener('astro:after-swap', () => {
  const html = document.documentElement;
  html.dataset.nav = nav;
  html.toggleAttribute('data-door', !!door);
  const main = document.getElementById('main');
  const app = nav !== 'page';
  if (main) html.style.setProperty('--vt-dy', app ? '0px' : `${oldTop - main.getBoundingClientRect().top}px`);
  // The casing and the channel move between where they were and where they are now (global.css).
  const glass = document.querySelector('.tv-glass');
  if (app && glass && casing) {
    const m = boxMove(casing, rectOf(glass));
    html.style.setProperty('--glass-from', m.from);
    html.style.setProperty('--glass-to', m.to);
  }
  const into = nav === 'app-in' ? main : door;
  if (door && doorFrom && into) {
    const m = boxMove(doorFrom, rectOf(into));
    html.style.setProperty('--door-from', m.from);
    html.style.setProperty('--door-to', m.to);
    // Shrinking into a channel, the app takes on the channel's rounded corners as it goes.
    html.style.setProperty('--door-radius', nav === 'app-out' ? getComputedStyle(door).borderTopLeftRadius : '0px');
  }
  casing = doorFrom = null;
  delete html.dataset.reading;
  lastY = scrollY;

  // The menu, open before the page changed, is open on the new one too: at once, not dropping in.
  // An app that lists the sections itself (data-app-nav) hides the menu's button on a big screen,
  // so the menu folds away there instead of staying with nothing to close it.
  const ownNav = !narrow.matches && document.querySelector('[data-app-nav]');
  if (menuWasOpen && !ownNav) showMenuStill();
  else {
    resetMenu();
    if (ownNav && isMenuOpen()) void closeMenu();
  }
  menuWasOpen = false;

  const here = sectionOf(location.pathname);
  document
    .getElementById('tv-menu')
    ?.querySelectorAll('a')
    .forEach((a) => {
      if (sectionOf(new URL(a.href).pathname) === here) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
});

// Going home to the plaza: the page fades out completely first, and only then does the plaza load
// and pull back out of its block (plaza/main.ts). Back from the back/forward cache, the page shows
// again.
document.addEventListener(
  'click',
  (e) => {
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const to = new URL(link.href);
    if (to.origin !== location.origin || to.pathname !== '/' || link.target) return;
    e.preventDefault();
    const html = document.documentElement;
    if (html.hasAttribute('data-going-home')) return;
    if (calm()) return location.assign(to.href);
    html.setAttribute('data-going-home', '');
    setTimeout(() => location.assign(to.href), length('--vt-in'));
  },
  true,
);
addEventListener('pageshow', () => document.documentElement.removeAttribute('data-going-home'));

// On a phone a link in the menu closes it as you go, even to the page you are on.
document.addEventListener('click', (e) => {
  const link = e.target instanceof Element ? e.target.closest('#tv-menu a') : null;
  if (link && narrow.matches && new URL((link as HTMLAnchorElement).href).pathname === location.pathname) void closeMenu();
});

// Escape closes the menu.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!isMenuOpen()) return;
  play('back');
  void closeMenu();
  document.querySelector<HTMLElement>('.tv-open')?.focus();
});

// B goes back, as on the console: the page's own back button if it has one, else history.
addEventListener('keydown', (e) => {
  if (e.key !== 'b' && e.key !== 'B') return;
  if (e.metaKey || e.ctrlKey || e.altKey || document.documentElement.hasAttribute('data-home')) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const back = document.querySelector<HTMLAnchorElement>('[data-back]');
  if (back) back.click();
  else {
    play('back');
    history.back();
  }
});

// On a phone the buttons step aside while you read down the page and come back as soon as you
// scroll up, or reach the top.
let lastY = scrollY;
let queued = false;
addEventListener(
  'scroll',
  () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const y = scrollY;
      const html = document.documentElement;
      if (!narrow.matches || y < 60) delete html.dataset.reading;
      else if (y > lastY + 6) html.dataset.reading = '';
      else if (y < lastY - 6) delete html.dataset.reading;
      if (Math.abs(y - lastY) > 6 || y < 60) lastY = y;
    });
  },
  { passive: true },
);
