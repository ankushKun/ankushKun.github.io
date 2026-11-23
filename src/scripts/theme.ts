// Light and dark. The device decides unless you pick one with the icon in the bottom left corner;
// picking what the device already shows forgets your choice, so the site follows the device again.
// Base.astro sets the theme before the page draws, so it never flashes. On the TV, switching is
// drawn as the new lights spreading in a circle from the icon (the CSS is at the end of
// global.css), or a short fade with reduced motion. The plaza dims its own lights instead
// (src/components/plaza/main.ts watches data-theme).
import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { track } from './analytics';

type Theme = 'light' | 'dark';

const KEY = 'theme';
const html = document.documentElement;
const device = matchMedia('(prefers-color-scheme: dark)');

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function remember(theme: Theme) {
  try {
    if (theme === (device.matches ? 'dark' : 'light')) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private windows may refuse storage; the switch still holds for this visit.
  }
}

const current = (): Theme => (html.dataset.theme === 'dark' ? 'dark' : 'light');

/** Puts a document in a theme: its root, the browser's bar color and the button's state. */
function paint(theme: Theme, doc: Document = document) {
  const root = doc.documentElement;
  root.dataset.theme = theme;
  const meta = doc.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', meta.getAttribute(`data-${theme}`) ?? '');
  doc.querySelector('[data-theme-toggle]')?.setAttribute('aria-pressed', String(theme === 'dark'));
}

function switchTo(theme: Theme, from?: Element | null) {
  if (theme === current()) return;
  if (!document.startViewTransition || document.visibilityState !== 'visible' || html.hasAttribute('data-home')) return paint(theme);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const box = from?.getBoundingClientRect();
  const x = box ? box.left + box.width / 2 : innerWidth / 2;
  const y = box ? box.top + box.height / 2 : innerHeight / 2;
  html.style.setProperty('--tx', `${x}px`);
  html.style.setProperty('--ty', `${y}px`);
  html.style.setProperty('--tr', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  html.dataset.theming = calm ? 'fade' : 'reveal';
  const t = document.startViewTransition(() => paint(theme));
  t.finished.finally(() => delete html.dataset.theming);
}

document.addEventListener('click', (e) => {
  const button = e.target instanceof Element ? e.target.closest('[data-theme-toggle]') : null;
  if (!button) return;
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  remember(next);
  switchTo(next, button);
  track('theme_changed', { theme: next });
});

// The device changing its mind is followed, unless you have picked one yourself.
device.addEventListener('change', () => {
  if (!stored()) switchTo(device.matches ? 'dark' : 'light', document.querySelector('[data-theme-toggle]'));
});

// The router replaces <html>'s attributes with the next page's: the theme goes with you.
document.addEventListener('astro:before-swap', (event) => {
  paint(current(), (event as TransitionBeforeSwapEvent).newDocument);
});

paint(stored() ?? (device.matches ? 'dark' : 'light'));

// A prerendered page is put in the theme of the moment it is shown (Base.astro does its root).
document.addEventListener('prerenderingchange', () => paint(stored() ?? (device.matches ? 'dark' : 'light')), { once: true });
