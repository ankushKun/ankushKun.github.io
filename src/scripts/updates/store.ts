// Since your last visit: what this browser hasn't seen yet. The site's pages by section come from
// /updates.json (src/lib/updates.ts), fetched only when the page's hash (Base.astro) differs from the
// last one read. The first visit takes everything as seen, so only what's added later is ever new.
// A page counts as seen once it's opened, and a whole section once its index is. What was new as the
// visit began stays marked "New" in its list until the tab closes, even once read (sessionStorage).
// The live apps keep their own marks: the chat's (live/store.ts), and here when Paint and the
// Guestbook were last open. Their numbers come from the relay (live.ts).
import { STORE } from '../../components/live/store';
import type { UpdateSection, Updates } from '../../lib/updates';

const KEY = 'site_updates';
const FRESH = 'site_updates_fresh';
const SEEN = { paint: 'paint_seen', guestbook: 'guestbook_seen' } as const;

export type LiveApp = keyof typeof SEEN;

interface State {
  hash: string;
  /** Every page in the list last read, seen or not. */
  known: string[];
  unseen: Record<UpdateSection, string[]>;
  twins: Record<string, string>;
  /** When this browser first came, so nothing from before counts as new. */
  since: number;
}

export const INDEX: Record<UpdateSection, string> = {
  blog: '/blogs/',
  projects: '/projects/',
  timeline: '/timeline/',
  games: '/games/',
  apps: '/apps/',
};

/** What the relay says (live.ts): the chat's messages, the days drawn on in Paint, the Guestbook's newest note. */
export const live = {
  chat: [] as { time: number; uuid: string | null }[],
  paintDays: [] as string[],
  guestbook: 0,
};

let state: State | null = null;
let fresh = new Set<string>();
/** Whether this tab is where the visit began, so its news is reported once. */
export let began = false;
const listeners = new Set<() => void>();

export const onChange = (fn: () => void) => listeners.add(fn);
export const changed = () => listeners.forEach((fn) => fn());

function read<T>(storage: Storage, key: string): T | null {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: unknown) {
  try {
    storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // Storage that won't take it starts over next time, as a first visit.
  }
}

function usable() {
  try {
    localStorage.setItem('site_updates_probe', '1');
    localStorage.removeItem('site_updates_probe');
    return true;
  } catch {
    return false;
  }
}

const save = () => state && write(localStorage, KEY, state);

/** Folds the site's list into what was known: anything not known before is new, and gone pages drop out. */
function merge(list: Updates, before: State | null): State {
  const all = Object.values(list.sections).flat();
  if (!before) {
    const none = Object.fromEntries(Object.keys(list.sections).map((s) => [s, []])) as unknown as State['unseen'];
    return { hash: list.hash, known: all, unseen: none, twins: list.twins, since: Date.now() };
  }
  const known = new Set(before.known);
  const unseen = Object.fromEntries(
    Object.entries(list.sections).map(([s, keys]) => {
      const was = new Set(before.unseen[s as UpdateSection] ?? []);
      return [s, keys.filter((k) => !known.has(k) || was.has(k))];
    }),
  ) as State['unseen'];
  return { hash: list.hash, known: all, unseen, twins: list.twins, since: before.since };
}

/** Settles once this browser's state matches the page's list. Null where it can't be kept. */
export const ready: Promise<State | null> = (async () => {
  const hash = document.documentElement.dataset.updates;
  if (!hash || !usable()) return null;
  const before = read<State>(localStorage, KEY);
  if (before?.hash === hash && before.unseen) state = before;
  else {
    try {
      const res = await fetch('/updates.json');
      if (!res.ok) return null;
      state = merge((await res.json()) as Updates, before?.unseen ? before : null);
    } catch {
      return null;
    }
    save();
  }
  const kept = read<string[]>(sessionStorage, FRESH);
  if (kept) fresh = new Set(kept);
  else {
    fresh = new Set(Object.values(state.unseen).flat());
    write(sessionStorage, FRESH, [...fresh]);
    began = true;
  }
  return state;
})();

/** Unseen pages per section, the same thing counted once when it's both a game and a project. */
export function unseen(): Record<UpdateSection, string[]> | null {
  if (!state) return null;
  const projects = new Set(state.unseen.projects);
  return { ...state.unseen, games: state.unseen.games.filter((g) => !projects.has(state!.twins[g])) };
}

export const isFresh = (href: string) => fresh.has(href);

const mark = (key: string) => Number(localStorage.getItem(key)) || 0;
const since = () => state?.since ?? Date.now();

/** When the visitor last looked, by app. Never before they first came. */
export function seenAt(app: LiveApp | 'chat') {
  try {
    return Math.max(mark(app === 'chat' ? STORE.seen : SEEN[app]), since());
  } catch {
    return Date.now();
  }
}

export function sawApp(app: LiveApp) {
  write(localStorage, SEEN[app], String(Date.now()));
  changed();
}

/** Opening `path` marks it seen: a page and its twin, or a whole section from its index. */
export function visit(path: string) {
  if (!state) return;
  let touched = false;
  const twin = state.twins[path] ?? Object.keys(state.twins).find((g) => state!.twins[g] === path);
  for (const [s, keys] of Object.entries(state.unseen) as [UpdateSection, string[]][]) {
    const left = INDEX[s] === path ? [] : keys.filter((k) => k !== path && k !== twin);
    if (left.length !== keys.length) {
      state.unseen[s] = left;
      touched = true;
    }
  }
  if (touched) {
    save();
    changed();
  }
}

/** How many unread chat messages, from someone else. */
export function chatUnread() {
  const seen = seenAt('chat');
  let me: string | null = null;
  try {
    me = localStorage.getItem(STORE.uuid);
  } catch {
    // Without storage every message is someone else's.
  }
  return live.chat.filter((m) => m.time > seen && (!me || m.uuid !== me)).length;
}

export function paintNew() {
  const day = new Date(seenAt('paint')).toISOString().slice(0, 10);
  return live.paintDays.some((d) => d > day);
}

export const guestbookNew = () => live.guestbook > seenAt('guestbook');
