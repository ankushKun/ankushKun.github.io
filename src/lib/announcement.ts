// One-time announcements (content.config.ts, `announcements`). Pure, so the build (announcement-entries.ts, the
// /announcement.json route) and the browser (scripts/announcement.ts) agree on what is live. The extension
// New Tab Mii Plaza reads the same shape from /announcement.json, so change it only with a new `v`.

/** Version of /announcement.json. Bump it only for a change old readers can't take. */
export const ANNOUNCEMENT_VERSION = 1;

/** How long an announcement stays up when its `until` is left out. */
export const DEFAULT_DAYS = 30;

/** An announcement as pages and /announcement.json carry it. Dates are ISO 8601 times. */
export interface Announcement {
  /** Its folder name. A visitor who has seen this id never sees it again. */
  id: string;
  text: string;
  /** Where pressing it goes: a path on this site in pages, always absolute in /announcement.json. */
  url: string;
  /** A small square picture, 128 px. */
  icon?: string;
  /** From when it shows. */
  date: string;
  /** Until when it shows, not including that moment. */
  until: string;
}

/** What /announcement.json answers: the newest live announcement, or none. */
export interface AnnouncementFeed {
  v: typeof ANNOUNCEMENT_VERSION;
  announcement: Announcement | null;
}

/** Whether it shows at `now` (milliseconds). */
export const isLive = (a: Pick<Announcement, 'date' | 'until'>, now: number) => Date.parse(a.date) <= now && now < Date.parse(a.until);

/** Whether `url` leaves this site. */
export const isExternal = (url: string) => /^https?:\/\//.test(url);
