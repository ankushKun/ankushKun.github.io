import { getEntries, urlOf } from './content';
import { DAY_MS, phMidnight, type Launch } from './launches';

const dayOf = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Los_Angeles',
});

/** Every launch on the timeline (entries with a `launch`), newest first, as the page carries them. */
export async function getLaunches(): Promise<Launch[]> {
  const entries = await getEntries('timeline');
  return entries.flatMap((entry) => {
    const launch = entry.data.launch;
    if (!launch) return [];
    const start = launch.start ? launch.start.getTime() : phMidnight(entry.data.date);
    return [
      {
        id: entry.id,
        name: launch.name,
        url: launch.url,
        start,
        end: start + DAY_MS,
        logo: launch.logo.src,
        ...(launch.try && { try: launch.try }),
        ...(launch.count && { count: launch.count }),
        ...(launch.result && { result: launch.result }),
        href: urlOf(entry),
        blurb: launch.pitch ?? entry.data.description,
        day: dayOf.format(start),
      },
    ];
  });
}
