// Content helpers shared by pages, feeds, the sitemap and llms.txt.
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { SITE } from '../site';

export type Section = 'blog' | 'projects' | 'timeline' | 'talks' | 'consoles';
export type Entry = CollectionEntry<Section>;

/** Public URL of each section. Change a route here and in src/pages together. */
export const SECTION_PATH: Record<Section, string> = {
  blog: '/blogs/',
  projects: '/projects/',
  timeline: '/timeline/',
  talks: '/talks/',
  consoles: '/console-collection/',
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

export async function getPage(id: string) {
  const page = await getEntry('pages', id);
  if (!page) throw new Error(`Missing src/content/pages/${id}.md`);
  return page;
}

export const urlOf = (entry: Entry) => `${SECTION_PATH[entry.collection]}${entry.id}/`;
export const absUrl = (path: string) => new URL(path, SITE.url).href;

export function byYear<T extends Entry>(entries: T[]): [number, T[]][] {
  const groups = new Map<number, T[]>();
  for (const e of entries) {
    const year = e.data.date.getUTCFullYear();
    groups.set(year, [...(groups.get(year) ?? []), e]);
  }
  return [...groups];
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const formatDate = (d: Date, month: 'short' | 'long' = 'short') =>
  d.toLocaleDateString('en-US', { year: 'numeric', month, day: 'numeric', timeZone: 'UTC' });

/** Formats a "YYYY-MM" string, or "Present" when empty. */
export const formatMonth = (ym?: string) =>
  ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }) : 'Present';
