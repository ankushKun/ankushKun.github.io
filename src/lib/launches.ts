// Launches on Product Hunt, from timeline entries with a `launch` (content.config.ts). Pure, so the build
// (components/launch/Messages.astro) and the browser (scripts/launch.ts) share it: where a launch is on the visitor's
// clock and what it says there.

/** A launch as the page carries it. Times are milliseconds. */
export interface Launch {
  id: string;
  name: string;
  /** Its page on Product Hunt. */
  url: string;
  start: number;
  end: number;
  logo: string;
  /** Where to try what launched. */
  try?: string;
  /** Its id on construct.computer, for the live vote count. */
  count?: string;
  /** How it finished, like "#1 Product of the Day". */
  result?: string;
  /** Its timeline entry. */
  href: string;
  /** A line about it for its letter. */
  blurb: string;
  /** Its day, like "Nov 24, 2026", in San Francisco. */
  day: string;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How long before a launch it's announced, and how long after it still is. */
export const LEAD_MS = DAY_MS;
export const TRAIL_MS = DAY_MS;

/** Coming within LEAD_MS, live, ended within TRAIL_MS, or ended before that. */
export type Phase = 'soon' | 'live' | 'after' | 'past';

export function phaseAt(launch: Pick<Launch, 'start' | 'end'>, now: number): Phase | null {
  if (now < launch.start - LEAD_MS) return null;
  if (now < launch.start) return 'soon';
  if (now < launch.end) return 'live';
  if (now < launch.end + TRAIL_MS) return 'after';
  return 'past';
}

/** The launch being announced at `now`, the soonest first, or none. */
export function current(list: readonly Launch[], now: number): Launch | undefined {
  return [...list]
    .sort((a, b) => a.start - b.start)
    .find((launch) => {
      const phase = phaseAt(launch, now);
      return phase === 'soon' || phase === 'live' || phase === 'after';
    });
}

/** Launches whose day is over, newest first. */
export const ended = (list: readonly Launch[], now: number) =>
  list.filter((launch) => now >= launch.end).sort((a, b) => b.start - a.start);

/** How long until a launch starts: "in 5 hours", "in 40 minutes". */
export function untilWords(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** What your Mii says about a launch in a phase, and the letter's title. */
export function says(launch: Launch, phase: Phase, now: number): string {
  if (phase === 'soon') return `${launch.name} launches on Product Hunt ${untilWords(launch.start - now)}!`;
  if (phase === 'live') return `I launched ${launch.name} on Product Hunt today!`;
  return `Thanks for checking out ${launch.name} on Product Hunt!`;
}

/** Midnight in San Francisco on a day, the start of a Product Hunt day. */
export function phMidnight(day: Date): number {
  const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
  const noon = new Date(Date.UTC(y, m, d, 12));
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .formatToParts(noon)
    .find((part) => part.type === 'timeZoneName')?.value;
  const hours = Number(/GMT([+-]\d+)/.exec(offset ?? '')?.[1] ?? -8);
  return Date.UTC(y, m, d) - hours * 60 * 60 * 1000;
}
