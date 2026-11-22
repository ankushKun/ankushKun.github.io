// How the TV moves between pages. Astro's router swaps pages in place inside a view transition and
// this choreographs it; the casing, its buttons and the menu are one element throughout, so only
// the column moves (the CSS is at the end of global.css):
// - Every move gets a kind (see `classify`), set on <html> as data-nav: deeper and shallower into
//   an entry and back out, left and right between sections in the menu's order.
// - The old column is put back where it was scrolled to (--vt-dy).
// - An entry's picture flies between a list and its page (`hero`).
// - The menu stays open across page changes on a big screen, its marker moving to the new
//   section; on a phone, where it covers the page, it folds away first. Escape closes it. B goes
//   back.
// - On a phone the two buttons step aside while you read down a page, and come back when you
//   scroll up.
// Going to and from the plaza is a real page load instead (see Base.astro).
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { depthOf, dockIndex, sectionOf } from '../lib/nav';
import { closeMenu, isMenuOpen, resetMenu, showMenuStill } from './menu';
import { play } from './sfx';

type Nav = 'deeper' | 'shallower' | 'left' | 'right';

function classify(from: URL, to: URL, back: boolean): Nav {
  const a = from.pathname;
  const b = to.pathname;
  if (sectionOf(a) === sectionOf(b)) {
    const da = depthOf(a);
    const db = depthOf(b);
    if (db !== da) return db > da ? 'deeper' : 'shallower';
    return back ? 'shallower' : 'deeper';
  }
  const ia = dockIndex(a);
  const ib = dockIndex(b);
  if (ia >= 0 && ib >= 0) return ib > ia ? 'right' : 'left';
  if (depthOf(b) > depthOf(a)) return 'deeper';
  return back ? 'shallower' : 'deeper';
}

let nav: Nav = 'deeper';
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

document.addEventListener('astro:before-preparation', (event) => {
  const e = event as TransitionBeforePreparationEvent;
  nav = classify(e.from, e.to, e.direction === 'back');
  from = e.from.pathname;
  clearNames();
  // On a phone the menu covers the page: it folds away first, while the next page loads, so the
  // page change starts on a clear screen. It costs no time when the page takes longer to load.
  menuWasOpen = isMenuOpen();
  if (menuWasOpen && narrow.matches) {
    menuWasOpen = false;
    const folded = closeMenu();
    const load = e.loader;
    e.loader = () => Promise.all([load(), folded]).then(() => undefined);
  }
  // The picture of the entry you opened flies to its page. Any other named picture steps aside.
  const source = e.sourceElement instanceof Element ? e.sourceElement.closest('a') : null;
  const hero = source?.querySelector<HTMLElement>('[data-hero]');
  if (hero && hero.dataset.hero === e.to.pathname) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-hero-main]')) name(el, 'none');
    name(hero, 'hero');
  }
});

document.addEventListener('astro:before-swap', (event) => {
  const e = event as TransitionBeforeSwapEvent;
  oldTop = document.getElementById('main')?.getBoundingClientRect().top ?? 0;
  // Moving the menu to the new page closes it; it opens again after the swap if it was open.
  menuWasOpen ||= isMenuOpen() && !narrow.matches;

  // Going back to a list, the entry's picture flies back into its place there.
  if (!e.newDocument.querySelector('[data-hero-main]')) {
    const back = e.newDocument.querySelector<HTMLElement>(`[data-hero="${CSS.escape(from)}"]`);
    if (back) name(back, 'hero');
  }

  e.viewTransition.finished.finally(clearNames);
});

document.addEventListener('astro:after-swap', () => {
  const html = document.documentElement;
  html.dataset.nav = nav;
  const main = document.getElementById('main');
  if (main) html.style.setProperty('--vt-dy', `${oldTop - main.getBoundingClientRect().top}px`);
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
