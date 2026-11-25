// Since your last visit, on the page (store.ts keeps the state): a badge on whatever leads to
// something new (`data-badge`, the path it opens), a count for unread chat and a dot for the rest, and
// a "New" tag on what was new as the visit began (`data-new`, the entry's path). Your Mii says what's
// new as the plaza's greeting (plaza/main.ts).
import type { PlazaPost } from '../../components/plaza/types';
import type { UpdateSection } from '../../lib/updates';
import { track } from '../analytics';
import { INDEX, began, chatUnread, guestbookNew, isFresh, onChange, paintNew, ready, sawApp, unseen, visit, type LiveApp } from './store';

const APP_PAGES: Record<string, LiveApp> = { '/apps/paint/': 'paint', '/apps/guestbook/': 'guestbook' };
/** Pages whose badges need the relay. */
const LIVE_PAGES = ['/', '/apps/'];

const sectionAt = (href: string) => (Object.entries(INDEX) as [UpdateSection, string][]).find(([, p]) => p === href)?.[0];

/** What a badge for `href` shows: a count, a dot (true), or nothing. */
function value(href: string): number | boolean {
  const u = unseen();
  if (!u) return false;
  if (href === '/apps/chat/') return chatUnread();
  if (href === '/apps/paint/') return paintNew();
  if (href === '/apps/guestbook/') return guestbookNew();
  if (href === '/apps/') return u.apps.length > 0 || paintNew() || guestbookNew();
  const section = sectionAt(href);
  if (section) return u[section].length > 0;
  // A channel on /apps/ or /games/ keeps its dot for the visit, as a list keeps its New tag.
  return isFresh(href) || Object.values(u).some((keys) => keys.includes(href));
}

function draw() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-new]')) el.hidden = !isFresh(el.dataset.new ?? '');
  for (const el of document.querySelectorAll<HTMLElement>('[data-badge]')) {
    const v = value(el.dataset.badge ?? '');
    const count = typeof v === 'number' ? v : 0;
    el.hidden = !v;
    el.textContent = count ? (count > 99 ? '99+' : String(count)) : '';
    el.classList.toggle('is-dot', !count);
    // The link says it too, for screen readers.
    const link = el.closest<HTMLElement>('a');
    if (!link) continue;
    link.dataset.label ??= link.getAttribute('aria-label') ?? '';
    if (!link.dataset.label) continue;
    const note = count ? `, ${count} unread` : v ? ', new' : '';
    link.setAttribute('aria-label', link.dataset.label + note);
  }
}

let leaving: LiveApp | null = null;

function arrive() {
  const path = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
  // Leaving Paint or the Guestbook: what was added while it was open has been seen too.
  if (leaving) sawApp(leaving);
  leaving = APP_PAGES[path] ?? null;
  if (leaving) sawApp(leaving);
  visit(path);
  draw();
  if (LIVE_PAGES.includes(path)) {
    import('./live').then(({ start }) => start()).catch((err: unknown) => console.warn('Live badges failed', err));
  }
}

void ready.then((state) => {
  if (!state) return;
  onChange(draw);
  addEventListener('chat-seen', draw);
  addEventListener('pagehide', () => leaving && sawApp(leaving));
  document.addEventListener('astro:page-load', arrive);
  // Counted before this page marks anything seen.
  const u = unseen();
  if (began && u && Object.values(u).some((keys) => keys.length)) {
    track('updates_found', Object.fromEntries(Object.entries(u).map(([s, keys]) => [s, keys.length])) as Record<UpdateSection, number>);
  }
  arrive();
});

const NOUNS: Record<UpdateSection, [string, string]> = {
  blog: ['a new post', 'new posts'],
  projects: ['a new project', 'new projects'],
  timeline: ['something to my timeline', 'things to my timeline'],
  games: ['a new game', 'new games'],
  apps: ['a new app', 'new apps'],
};

/**
 * Your Mii's greeting for a returning visitor with something new to see, built on `base` (the usual
 * welcome). Pressing it goes to the one new thing, or the section with the most.
 */
export async function greeting(base: PlazaPost | undefined): Promise<PlazaPost | null> {
  if (!base || !(await ready)) return null;
  const u = unseen();
  if (!u) return null;
  const news = (Object.entries(u) as [UpdateSection, string[]][]).filter(([, keys]) => keys.length);
  if (!news.length) return null;
  const parts = news.map(([s, keys]) => (keys.length === 1 ? NOUNS[s][0] : `${keys.length} ${NOUNS[s][1]}`));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const [top, keys] = news.reduce((a, b) => (b[1].length > a[1].length ? b : a));
  const href = news.length === 1 && keys.length === 1 ? keys[0] : INDEX[top];
  return { ...base, text: `Welcome back! I've added ${list} since you were last here.`, href };
}
