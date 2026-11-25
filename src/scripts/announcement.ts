import { navigate } from 'astro:transitions/client';
import type { PlazaPost } from '../components/plaza/types';
import { isExternal, isLive, type Announcement } from '../lib/announcement';
import { track } from './analytics';
import { launchNow } from './launch';
import { play } from './sfx';

// Your one-time announcement (components/launch/Messages.astro, lib/announcement.ts): each visitor sees the newest one
// once. On the home page your Mii says it as the plaza's greeting; anywhere else, or when the plaza can't run, a card
// rises into the corner like a launch's. Either way it is remembered in localStorage the moment it shows, so no page
// shows it again. A launch being announced goes first, and the announcement waits until its days are over.

/** Ids of the announcements this browser has seen, newest last (localStorage). */
const SEEN = 'announcement_seen';
/** How many seen ids are kept: enough that taking a newer one down never brings an older one back. */
const KEEP = 20;
/** How long after a page is up the card rises. */
const RISE_MS = 1200;

type From = 'card' | 'plaza';

let data: Announcement | null | undefined;
function announcement(): Announcement | null {
  if (data !== undefined) return data;
  try {
    data = JSON.parse(document.querySelector('[data-announcement]')?.textContent ?? 'null') as Announcement | null;
  } catch {
    data = null;
  }
  return data;
}

/** The ids seen here, or null when storage can't be read: then nothing shows, rather than on every page. */
function seen(): string[] | null {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SEEN) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

function remember(id: string) {
  const list = seen();
  if (!list || list.includes(id)) return;
  try {
    localStorage.setItem(SEEN, JSON.stringify([...list, id].slice(-KEEP)));
  } catch {
    // Storage that won't take it may show it once more.
  }
}

/** The announcement to show now: live, not seen here, and no launch being announced. */
function due(now = Date.now()): Announcement | null {
  const one = announcement();
  if (!one || !isLive(one, now) || launchNow(now)) return null;
  return seen()?.includes(one.id) === false ? one : null;
}

/** Whether the plaza on this page is running or starting, so it says the announcement rather than the card. */
function plazaSays() {
  const state = document.querySelector<HTMLElement>('[data-plaza]')?.dataset.state;
  return location.pathname === '/' && (state === 'loading' || state === 'live');
}

/** The plaza's greeting while an announcement is due: your Mii says it, with its icon. Pressing it opens it. */
export function greeting(base: PlazaPost | undefined): PlazaPost | null {
  const one = due();
  if (!one || !base) return null;
  return { ...base, text: one.text, href: '#announcement', ...(one.icon && { thumb: one.icon }) };
}

/** Your Mii said it on the plaza: it counts as seen, and the card stays down. */
export function said(post: PlazaPost) {
  const one = announcement();
  if (post.href !== '#announcement' || !one) return;
  remember(one.id);
  track('announcement_shown', { id: one.id, from: 'plaza' });
}

/** Goes where the announcement points: a new tab for another site, through the router for a page here. */
export function openAnnouncement(from: From) {
  const one = announcement();
  if (!one) return;
  track('announcement_opened', { id: one.id, from });
  if (isExternal(one.url)) window.open(one.url, '_blank', 'noopener');
  else void navigate(one.url);
}

function start() {
  const card = document.querySelector<HTMLElement>('[data-ann-card]');
  if (!card || card.dataset.ready !== undefined) return;
  card.dataset.ready = '';

  const sink = () => {
    card.classList.add('is-out');
    window.setTimeout(() => {
      card.hidden = true;
      card.classList.remove('is-out');
    }, 280);
  };
  card.querySelector('[data-ann-dismiss]')?.addEventListener('click', () => {
    const one = announcement();
    if (one) track('announcement_closed', { id: one.id });
    sink();
  });
  card.querySelector('[data-ann-go]')?.addEventListener('click', () => {
    const one = announcement();
    if (one) track('announcement_opened', { id: one.id, from: 'card' });
    sink();
  });

  let timer = 0;
  const check = () => {
    window.clearTimeout(timer);
    if (!due() || !card.hidden || plazaSays()) return;
    timer = window.setTimeout(() => {
      const one = due();
      if (!one || !card.hidden || plazaSays()) return;
      remember(one.id);
      card.classList.remove('is-out');
      card.hidden = false;
      play('letter');
      track('announcement_shown', { id: one.id, from: 'card' });
    }, RISE_MS);
  };
  check();
  // Moving to another page, or the plaza giving up (no WebGL, a failed load), lets the card rise.
  document.addEventListener('astro:page-load', check);
  new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
  // A launch ending, or the announcement's own `date`, while the page stays open.
  window.setInterval(check, 60_000);
}

start();
