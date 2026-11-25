// A Guestbook note as it is stored on the relay (apps/guestbook/entries/<id>). Everything in that
// node was written by a stranger's browser, so nothing is shown unless it survives readEntry, and
// anything that doesn't is dropped whole.
//
// Fields, new and the old site's (which it still reads):
//   name, from         who and where, as typed
//   blurb              what they wrote on the note's lines
//   doodle             a PNG data URL of what they drew, strokes only on transparency
//   paper              which paper the note is on (PAPERS)
//   links              their links, one per line: https URLs and mailto: addresses
//   x, ig, email       the old site's links, turned into `links` when read
//   uuid               their id in the live apps, for their Mii
//   ts, updatedTs      first signed, and last changed (ms)

export const MAX_NAME = 24;
export const MAX_FROM = 24;
export const MAX_BLURB = 140;
export const MAX_LINKS = 5;
/** Swapnote's lower screen. */
export const NOTE_W = 320;
export const NOTE_H = 240;
const MAX_DOODLE = 60000;
const MAX_LINK = 200;
const MAX_ID = 64;
/** How far ahead of ours a peer's clock may run. */
const SKEW = 5 * 60 * 1000;

/** The papers a note can be on, in the order the picker shows them. */
export const PAPERS = ['white', 'yellow', 'grid', 'dots', 'mint'] as const;

/** The inks a doodle can be drawn in, Swapnote's three. */
export const INKS = [
  { name: 'Black', color: '#2a2f31' },
  { name: 'Red', color: '#e0483a' },
  { name: 'Blue', color: '#2f8fe0' },
] as const;

export interface Entry {
  id: string;
  name: string;
  from: string;
  blurb: string;
  doodle: string;
  paper: number;
  links: string[];
  uuid: string;
  ts: number;
  updatedTs: number;
}

/** One line of text: no control characters, runs of space as one, cut to `max`. */
export const text = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** A note's own text keeps its line breaks, at most three in a row. */
const lines = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

/**
 * Whatever someone typed as a link (an address, a site, an email), as the href it is stored as, or
 * null. A bare handle (`@name`) needs a platform first (handleLink).
 */
export function normLink(raw: unknown): string | null {
  const s = text(raw, MAX_LINK);
  if (!s) return null;
  const mail = s.replace(/^mailto:/i, '');
  if (EMAIL.test(mail)) return `mailto:${mail}`;
  const withScheme = /^https?:\/\//i.test(s) ? s : DOMAIN.test(s) ? `https://${s}` : '';
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname.includes('.')) return null;
    const href = url.href.replace(/\/$/, '');
    return href.length <= MAX_LINK ? href : null;
  } catch {
    return null;
  }
}

/** Where a handle lives on each platform that has them, for `@name` typed on its own. */
export const HANDLES: Record<string, { label: string; url: (h: string) => string; ok: RegExp }> = {
  x: { label: 'X', url: (h) => `https://x.com/${h}`, ok: /^[A-Za-z0-9_]{1,15}$/ },
  instagram: { label: 'Instagram', url: (h) => `https://instagram.com/${h}`, ok: /^[A-Za-z0-9._]{1,30}$/ },
  github: { label: 'GitHub', url: (h) => `https://github.com/${h}`, ok: /^[A-Za-z0-9-]{1,39}$/ },
  youtube: { label: 'YouTube', url: (h) => `https://youtube.com/@${h}`, ok: /^[A-Za-z0-9._-]{3,30}$/ },
  telegram: { label: 'Telegram', url: (h) => `https://t.me/${h}`, ok: /^[A-Za-z0-9_]{5,32}$/ },
};

/** A bare handle, without its @, or null if what was typed isn't one. */
export const asHandle = (raw: string) => {
  const m = /^@?([A-Za-z0-9._-]{1,39})$/.exec(raw.trim());
  return m && !m[1].includes('..') && (raw.trim().startsWith('@') || !m[1].includes('.')) ? m[1] : null;
};

export function handleLink(platform: string, handle: string): string | null {
  const p = HANDLES[platform];
  return p && p.ok.test(handle) ? p.url(handle) : null;
}

const stamp = (v: unknown, now: number) => {
  const n = Number(v) || 0;
  return n > 0 && n <= now + SKEW ? n : 0;
};

/** A note from what a peer (or the snapshot) holds under `id`, or null. */
export function readEntry(id: string, data: unknown, now = Date.now()): Entry | null {
  if (!data || typeof data !== 'object' || typeof id !== 'string' || !id || id.length > MAX_ID) return null;
  const d = data as Record<string, unknown>;
  const name = text(d.name, MAX_NAME);
  if (!name) return null;
  const doodle = typeof d.doodle === 'string' && d.doodle.length <= MAX_DOODLE && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(d.doodle) ? d.doodle : '';
  const blurb = lines(d.blurb, MAX_BLURB);
  const links: string[] = [];
  const add = (href: string | null) => {
    if (href && !links.includes(href) && links.length < MAX_LINKS) links.push(href);
  };
  if (typeof d.links === 'string') for (const l of d.links.split('\n')) add(normLink(l));
  if (typeof d.x === 'string' && d.x) add(handleLink('x', d.x.replace(/^@/, '')));
  if (typeof d.ig === 'string' && d.ig) add(handleLink('instagram', d.ig.replace(/^@/, '')));
  if (typeof d.email === 'string' && d.email) add(normLink(d.email));
  const paper = Math.floor(Number(d.paper));
  const ts = stamp(d.ts, now);
  return {
    id,
    name,
    from: text(d.from, MAX_FROM),
    blurb,
    doodle,
    paper: paper >= 0 && paper < PAPERS.length ? paper : 0,
    links,
    uuid: typeof d.uuid === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(d.uuid) ? d.uuid : '',
    ts,
    updatedTs: stamp(d.updatedTs, now) || ts,
  };
}

/** A note as it is written to the relay and the snapshot. */
export function writeEntry(e: Omit<Entry, 'id'>): Record<string, unknown> {
  return {
    name: e.name,
    from: e.from,
    blurb: e.blurb,
    doodle: e.doodle,
    paper: e.paper,
    links: e.links.join('\n'),
    uuid: e.uuid,
    ts: e.ts,
    updatedTs: e.updatedTs,
    // Written over, so a note signed on the old site doesn't keep links its signer has removed.
    x: '',
    ig: '',
    email: '',
  };
}

/** Newest first, by when each was first signed. */
export const byNewest = (a: Entry, b: Entry) => b.ts - a.ts || a.id.localeCompare(b.id);
