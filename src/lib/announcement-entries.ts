import { getCollection } from 'astro:content';
import { getImage } from 'astro:assets';
import { DAY_MS } from './launches';
import { DEFAULT_DAYS, isLive, type Announcement } from './announcement';

/**
 * The newest announcement live when the site is built, or null. Drafts show in dev and are left out of builds, as
 * with every other entry. One that starts later goes up with the first build after its `date`: the daily guestbook
 * snapshot redeploys the site, so that is within a day.
 */
export async function getAnnouncement(now = Date.now()): Promise<Announcement | null> {
  const entries = await getCollection('announcements', ({ data }) => import.meta.env.DEV || !data.draft);
  const live = entries
    .map((entry) => ({ entry, until: entry.data.until ?? new Date(entry.data.date.getTime() + DEFAULT_DAYS * DAY_MS) }))
    .filter(({ entry, until }) => isLive({ date: entry.data.date.toISOString(), until: until.toISOString() }, now))
    .sort((a, b) => b.entry.data.date.valueOf() - a.entry.data.date.valueOf() || a.entry.id.localeCompare(b.entry.id));
  const newest = live[0];
  if (!newest) return null;
  const { entry, until } = newest;
  const icon = entry.data.icon && (await getImage({ src: entry.data.icon, width: 128, height: 128, fit: 'cover', format: 'png' })).src;
  return {
    id: entry.id,
    text: entry.data.text,
    url: entry.data.url,
    ...(icon && { icon }),
    date: entry.data.date.toISOString(),
    until: until.toISOString(),
  };
}
