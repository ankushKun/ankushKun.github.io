// /announcement.json: the newest live announcement (src/lib/announcement-entries.ts), or null, for New Tab Mii
// Plaza, which shows it once as a bubble from your Mii. Built with the site, so it changes with each deploy.
// Its links and icon are absolute here, since the extension reads it from elsewhere: on https://ankush.one in a
// build, and on the dev server's own address in `pnpm dev`, so a local extension build can try it end to end.
import { getAnnouncement } from '../lib/announcement-entries';
import { ANNOUNCEMENT_VERSION, type AnnouncementFeed } from '../lib/announcement';

export async function GET({ url }: { url: URL }) {
  const abs = (path: string) => new URL(path, url).href;
  const announcement = await getAnnouncement();
  const feed: AnnouncementFeed = {
    v: ANNOUNCEMENT_VERSION,
    announcement: announcement && {
      ...announcement,
      url: abs(announcement.url),
      ...(announcement.icon && { icon: abs(announcement.icon) }),
    },
  };
  return new Response(JSON.stringify(feed), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
