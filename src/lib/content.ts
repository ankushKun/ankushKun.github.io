// Content helpers shared by pages, feeds, the sitemap and llms.txt.
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { SITE } from '../site';

export type Section = 'blog' | 'projects' | 'timeline';
export type Entry = CollectionEntry<Section>;

/** Public URL of each section. Change a route here and in src/pages together. */
export const SECTION_PATH: Record<Section, string> = {
  blog: '/blogs/',
  projects: '/projects/',
  timeline: '/timeline/',
};

/** Entries of a section, newest first. Drafts show in dev and are left out of builds. */
export async function getEntries<S extends Section>(section: S): Promise<CollectionEntry<S>[]> {
  const entries = await getCollection(section, ({ data }) => import.meta.env.DEV || !data.draft);
  return entries.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getAllEntries(): Promise<Entry[]> {
  const sections = Object.keys(SECTION_PATH) as Section[];
  return (await Promise.all(sections.map((s) => getEntries(s)))).flat();
}

export type TimelineItem = CollectionEntry<'timeline'> | CollectionEntry<'projects'>;

/**
 * What the timeline page and its twin list: its own events and every project on the day it started, newest first.
 * Anything that wants the timeline's events alone (the plaza's bubbles, launches) uses `getEntries('timeline')`.
 */
export async function getTimeline(): Promise<TimelineItem[]> {
  const [events, projects] = await Promise.all([getEntries('timeline'), getEntries('projects')]);
  return [...events, ...projects].sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getPage(id: string) {
  const page = await getEntry('pages', id);
  if (!page) throw new Error(`Missing src/content/pages/${id}.md`);
  return page;
}

export const urlOf = (entry: Entry) => `${SECTION_PATH[entry.collection]}${entry.id}/`;
export const absUrl = (path: string) => new URL(path, SITE.url).href;

/**
 * A page's path in its one canonical form, with the trailing slash, however it was asked for
 * (pages answer with or without it). Files such as /blogs/index.xml keep theirs as they are.
 */
export const pagePath = (url: URL) => {
  const p = url.pathname;
  return p.endsWith('/') || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`;
};

export function byYear<T extends Entry>(entries: T[]): [number, T[]][] {
  const groups = new Map<number, T[]>();
  for (const e of entries) {
    const year = e.data.date.getUTCFullYear();
    groups.set(year, [...(groups.get(year) ?? []), e]);
  }
  return [...groups];
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Minutes to read an entry, at about 230 words a minute. */
export const readingMinutes = (entry: Entry) => Math.max(1, Math.round((entry.body ?? '').split(/\s+/).length / 230));

export const formatDate = (d: Date, month: 'short' | 'long' = 'short') =>
  d.toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' });

/** Formats a "YYYY-MM" string, or "Present" when empty. */
export const formatMonth = (ym?: string) =>
  ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }) : 'Present';

function seedHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks entries for the "Read more" shelf at the bottom of a blog post, project, or timeline entry:
 * 1) explicit `related` links first,
 * 2) relevant entries ranked by shared tags (with a nudge for same section and real cover art),
 * 3) deterministic pseudo-random picks across the site so every page gets a balanced, varied set.
 */
export async function getReadMore(entry: Entry, minCount = 4): Promise<Entry[]> {
  const all = await getAllEntries();
  const selfKey = `${entry.collection}/${entry.id}`;
  const byUrl = new Map(all.map((e) => [urlOf(e).replace(/\/$/, ''), e]));

  const picked: Entry[] = [];
  const seen = new Set<string>([selfKey]);
  const add = (candidate: Entry) => {
    const key = `${candidate.collection}/${candidate.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    picked.push(candidate);
    return true;
  };

  for (const relPath of entry.data.related) {
    const found = byUrl.get(relPath.replace(/\/$/, ''));
    if (found) add(found);
  }

  if (picked.length >= minCount) return picked;

  const entryTags = new Set(entry.data.tags);
  const scored = all
    .filter((e) => !seen.has(`${e.collection}/${e.id}`))
    .map((e) => {
      let sharedTags = 0;
      for (const t of e.data.tags) if (entryTags.has(t)) sharedTags++;
      const sameSection = e.collection === entry.collection ? 1 : 0;
      const hasCover = e.data.cover ? 1 : 0;
      // Deterministic jitter per (current page, candidate) so pages without tag overlap vary nicely.
      const jitter = (seedHash(`${selfKey}=>${e.collection}/${e.id}`) % 1000) / 1000;
      const score = sharedTags * 4 + (sharedTags > 0 ? sameSection * 1.5 : 0) + hasCover * 1.2 + jitter;
      return { entry: e, sharedTags, hasCover, score };
    })
    .sort((a, b) => b.score - a.score);

  // Fill with top relevant matches first, then varied picks (preferring entries with covers).
  for (const item of scored) {
    if (picked.length >= minCount) break;
    add(item.entry);
  }

  return picked;
}
