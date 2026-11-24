import type { PlazaPost } from '../components/plaza/types';
import { current, ended, phaseAt, says, type Launch, type Phase } from '../lib/launches';
import { track } from './analytics';
import { play } from './sfx';

// News about your launches (components/launch/Messages.astro): from a day before a launch to a day after, its card
// rises into the corner of every page with a chime and stays there; closing it lasts the browser session. Its words
// open the letter, with the launch and your earlier ones, and on the plaza your Mii's greeting is the launch. The
// visitor's clock decides, so a page left open moves on at each turn. The live vote count comes from
// construct.computer for a launch that has one there (`count`).

const COUNTS = 'https://construct.computer/_site/launch/';
/** The launch and phase whose card was closed, for the browser session (sessionStorage). */
const CLOSED = 'launch_closed';
/** How long after a page is first up the card rises. */
const RISE_MS = 1200;

type From = 'card' | 'plaza';

let all: Launch[] | null = null;
function launches(): Launch[] {
  if (all) return all;
  try {
    all = JSON.parse(document.querySelector('[data-launches]')?.textContent ?? '[]') as Launch[];
  } catch {
    all = [];
  }
  return all;
}

const closed = () => {
  try {
    return sessionStorage.getItem(CLOSED);
  } catch {
    return null;
  }
};

/** The launch being announced now, with its phase. */
export function launchNow(now = Date.now()): { launch: Launch; phase: Phase } | null {
  const launch = current(launches(), now);
  const phase = launch && phaseAt(launch, now);
  return launch && phase ? { launch, phase } : null;
}

const keyOf = ({ launch, phase }: { launch: Launch; phase: Phase }) => `${launch.id}:${phase}`;

/** The plaza's greeting while a launch is announced: your Mii says it, with its logo, and pressing it opens the letter. */
export function greeting(base: PlazaPost | undefined): PlazaPost | null {
  const now = launchNow();
  if (!now || !base) return null;
  return { ...base, text: says(now.launch, now.phase, Date.now()), href: '#launch', thumb: now.launch.logo };
}

/** Opens the letter about the launch being announced. */
export function openLetter(from: From) {
  const letter = document.querySelector<HTMLDialogElement>('[data-msg-letter]');
  const now = launchNow();
  if (!letter || !now || letter.open) return;
  place();
  letter.showModal();
  track('launch_letter_opened', { launch: now.launch.id, from });
  void count(now.launch);
}

const counted = new Map<string, number>();
async function count(launch: Launch) {
  if (!launch.count) return;
  if (Date.now() - (counted.get(launch.id) ?? 0) < 60_000) return;
  counted.set(launch.id, Date.now());
  try {
    const response = await fetch(COUNTS + encodeURIComponent(launch.count));
    if (!response.ok) return;
    const votes: unknown = Reflect.get(Object(await response.json()), 'votes');
    if (typeof votes !== 'number' || votes <= 0) return;
    for (const chip of document.querySelectorAll<HTMLElement>(`[data-msg-now="${CSS.escape(launch.id)}"] [data-msg-votes]`)) {
      const number = chip.querySelector('[data-msg-number]');
      if (number) number.textContent = String(votes);
      chip.hidden = false;
    }
  } catch {
    // No count leaves the launch without one until the next minute's ask.
  }
}

/** Shows what's true now: the card and its words, the letter's launch and title, and the earlier launches. */
function place() {
  const root = document.querySelector<HTMLElement>('[data-messages]');
  const card = root?.querySelector<HTMLElement>('[data-msg-card]');
  const letter = root?.querySelector<HTMLDialogElement>('[data-msg-letter]');
  if (!root || !card || !letter) return null;
  const time = Date.now();
  const now = launchNow(time);
  if (!now) {
    card.hidden = true;
    if (letter.open) letter.close();
    return null;
  }
  const words = says(now.launch, now.phase, time);
  const line = card.querySelector('[data-msg-says]');
  if (line) line.textContent = words;
  for (const go of card.querySelectorAll('[data-msg-go-words]'))
    go.textContent = now.phase === 'live' ? 'Support it on Product Hunt' : 'See it on Product Hunt';
  for (const shown of root.querySelectorAll<HTMLElement>('[data-msg-now]')) shown.hidden = shown.dataset.msgNow !== now.launch.id;
  const title = letter.querySelector<HTMLElement>(`#msg-title-${CSS.escape(now.launch.id)}`);
  if (title) title.textContent = words.replace(/!$/, '');
  letter.setAttribute('aria-labelledby', `msg-title-${now.launch.id}`);
  const before = new Set(ended(launches(), time).filter((one) => one.id !== now.launch.id).map((one) => one.id));
  for (const item of letter.querySelectorAll<HTMLElement>('[data-msg-ended]')) item.hidden = !before.has(item.dataset.msgEnded ?? '');
  const earlier = letter.querySelector<HTMLElement>('[data-msg-earlier]');
  if (earlier) earlier.hidden = before.size === 0;
  return now;
}

/** Brings the card up, once a phase and session, unless it was closed. */
function rise(card: HTMLElement) {
  const now = launchNow();
  if (!now || closed() === keyOf(now) || !card.hidden) return;
  card.classList.remove('is-out');
  card.hidden = false;
  play('letter');
  track('launch_notice_shown', { launch: now.launch.id, phase: now.phase });
}

function start() {
  const root = document.querySelector<HTMLElement>('[data-messages]');
  const card = root?.querySelector<HTMLElement>('[data-msg-card]');
  if (!root || !card || root.dataset.ready !== undefined) return;
  root.dataset.ready = '';
  const letter = root.querySelector<HTMLDialogElement>('[data-msg-letter]');

  root.querySelector('[data-msg-more]')?.addEventListener('click', () => openLetter('card'));
  root.querySelector('[data-msg-dismiss]')?.addEventListener('click', () => {
    const now = launchNow();
    if (now) {
      try {
        sessionStorage.setItem(CLOSED, keyOf(now));
      } catch {
        // Storage that won't take it closes the card for this page only.
      }
      track('launch_notice_closed', { launch: now.launch.id, phase: now.phase });
    }
    card.classList.add('is-out');
    window.setTimeout(() => {
      card.hidden = true;
      card.classList.remove('is-out');
    }, 280);
  });
  for (const go of root.querySelectorAll<HTMLElement>('[data-msg-go]'))
    go.addEventListener('click', () => {
      const now = launchNow();
      if (now) track('launch_supported', { launch: now.launch.id, phase: now.phase, from: 'card' });
    });
  root.querySelector('[data-msg-close]')?.addEventListener('click', () => letter?.close());
  // A press on the dimmed page around the letter closes it, and so does following one of its links.
  letter?.addEventListener('click', (event) => {
    if (event.target === letter) {
      const box = letter.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) letter.close();
      return;
    }
    if (event.target instanceof Element && event.target.closest('a[href]')) letter.close();
  });

  const tick = () => {
    const now = place();
    if (!now) return;
    if (closed() !== keyOf(now)) {
      if (card.hidden) window.setTimeout(() => rise(card), RISE_MS);
    } else card.hidden = true;
    if (document.visibilityState === 'visible') void count(now.launch);
  };
  tick();
  window.setInterval(tick, 60_000);
  // A page that stays open moves on at each turn of a launch. Timers only reach 24 days.
  for (const launch of launches())
    for (const at of [launch.start - 86_400_000, launch.start, launch.end, launch.end + 86_400_000]) {
      const wait = at - Date.now();
      if (wait > 0 && wait < 2 ** 31 - 1) window.setTimeout(tick, wait + 50);
    }
}

start();
