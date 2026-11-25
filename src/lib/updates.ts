// What's on the site, for "since your last visit" (src/scripts/updates/): every blog post, project,
// timeline event, game and built app by its path, per section, and a short hash of those paths. Each
// page carries the hash (Base.astro), so a browser that already knows this list never fetches it
// again (/updates.json).
import { APPS, appPath } from '../data/apps';
import { getEntries, urlOf, type Section } from './content';
import { getGames } from './games';

export type UpdateSection = Section | 'games' | 'apps';

export interface Updates {
  hash: string;
  sections: Record<UpdateSection, string[]>;
  /** A game's page and its project's page, which count as one thing. */
  twins: Record<string, string>;
}

function hashOf(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

let cached: Promise<Updates> | null = null;

export function getUpdates(): Promise<Updates> {
  cached ??= (async () => {
    const [blog, projects, timeline, games] = await Promise.all([getEntries('blog'), getEntries('projects'), getEntries('timeline'), getGames()]);
    const twins: Record<string, string> = {};
    for (const g of games) if (g.project) twins[g.href] = `/projects/${g.project}/`;
    const sections: Record<UpdateSection, string[]> = {
      blog: blog.map(urlOf),
      projects: projects.map(urlOf),
      timeline: timeline.map(urlOf),
      games: games.map((g) => g.href),
      apps: APPS.filter((a) => a.href && !a.soon).map(appPath),
    };
    const hash = hashOf(Object.values(sections).flat().sort().join('\n'));
    return { hash, sections, twins };
  })();
  return cached;
}
