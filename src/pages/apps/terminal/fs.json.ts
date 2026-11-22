// The Terminal's files: every page on the site as a file to ls, cat, grep and open, built with the
// site and fetched when the Terminal opens (src/components/terminal/fs.ts makes the tree).
import type { APIRoute } from 'astro';
import { APPS } from '../../../data/apps';
import { GAMES } from '../../../data/games';
import { SECTION_PATH, getEntries, getPage, isoDate, urlOf, type Section } from '../../../lib/content';
import { AUTHOR } from '../../../site';

export interface FsFile {
  /** Where it sits, from home: "blog/silent-hill-2-3ds-port.md". */
  path: string;
  title: string;
  url: string;
  description?: string;
  date?: string;
  tags?: string[];
  /** The page's own Markdown, for cat and grep. */
  body?: string;
  /** Run rather than read: an app or a game, which opens. */
  run?: boolean;
}

export interface Fs {
  files: FsFile[];
  me: { name: string; job: string; at: string };
}

/** Where each section's files go, by the folder name a visitor would guess. */
const DIRS: Record<Section, string> = { blog: 'blog', projects: 'projects', timeline: 'timeline' };

export const GET: APIRoute = async () => {
  const files: FsFile[] = [];
  for (const section of Object.keys(SECTION_PATH) as Section[]) {
    for (const e of await getEntries(section)) {
      files.push({
        path: `${DIRS[section]}/${e.id}.md`,
        title: e.data.title,
        url: urlOf(e),
        description: e.data.description,
        date: isoDate(e.data.date),
        tags: e.data.tags,
        body: e.body ?? '',
      });
    }
  }
  for (const [id, path] of [
    ['about', '/about/'],
    ['contact', '/contact/'],
    ['credits', '/credits/'],
    ['privacy', '/privacy/'],
  ]) {
    const p = await getPage(id);
    files.push({ path: `${id}.md`, title: p.data.title, url: path, description: p.data.description, body: p.body ?? '' });
  }
  files.push({ path: 'resume.pdf', title: 'Resume', url: '/resume.pdf', description: `${AUTHOR.name}'s resume, as a PDF.` });
  for (const a of APPS) {
    if (!a.href) continue;
    files.push({ path: `apps/${a.label.replace(/\s+/g, '')}.app`, title: a.label, url: a.href, description: a.description, run: true });
  }
  for (const g of GAMES) files.push({ path: `games/${g.id}`, title: g.label ?? g.id, url: `/games/${g.id}/`, run: true });

  const fs: Fs = { files, me: { name: AUTHOR.name, job: AUTHOR.jobTitle, at: AUTHOR.worksFor.name } };
  return new Response(JSON.stringify(fs), { headers: { 'Content-Type': 'application/json' } });
};
