// Markdown twins (AEO Spec v1.0, dualmark.dev): every page that is something to read has a plain
// Markdown copy beside it for AI agents to read and cite, at its path with `.md` instead of the
// trailing slash (`/` is `/index.md`, `/blogs/x/` is `/blogs/x.md`). Built with the site by
// pages/[...twin].md.ts from the same content the pages are, and named on each page's <head>
// (Base.astro) so agents find them. The site is GitHub Pages only, which can't set response
// headers or answer by Accept, so the twins are plain files: the spec's header and negotiation
// checks are out of reach here by design.
import { APPS } from '../data/apps';
import { resume } from '../data/resume';
import { HEADLINE } from '../data/profile';
import { getGames } from './games';
import { SECTION_PATH, absUrl, getAllEntries, getEntries, getPage, isoDate, urlOf, type Entry, type Section } from './content';
import { AUTHOR, BOOKING_URL, SITE, SOCIALS } from '../site';

/** A page's twin: its path with `.md` for the trailing slash. */
export const twinOf = (path: string) => (path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`);

// Every picture beside the content, by its file, for the address it's built at.
const IMAGES = import.meta.glob<{ src: string }>('/src/content/**/*.{jpg,jpeg,png,webp,gif,avif}', { eager: true, import: 'default' });

/**
 * A page's own Markdown, made to stand alone: links into the site absolute, pictures beside it
 * pointed at where they're built, and anything only the site can draw (HTML, components) left out.
 */
function clean(body: string, file: string) {
  const dir = file.slice(0, file.lastIndexOf('/') + 1);
  return body
    .replace(/!\[([^\]]*)\]\(\.\/([^)\s]+)(\s+"[^"]*")?\)/g, (_all, alt: string, rel: string, title = '') => {
      // A chart's dark twin (<name>.dark.webp, swapped in by global.css) is the same picture again.
      if (rel.includes('.dark.')) return '';
      const img = IMAGES[`/${dir}${rel}`];
      return img ? `![${alt}](${absUrl(img.src)}${title})` : alt ? `*${alt}*` : '';
    })
    // A live embed (<figure data-embed>, src/scripts/embeds.ts) is its plain link.
    .replace(/<figure data-embed="[^"]*">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/figure>/g, (_all, href: string, label: string) => `[${label}](${href})`)
    .replace(/\]\((\/[^)\s]*)/g, (_all, path: string) => `](${absUrl(path)}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
const linkTo = (title: string, path: string, description?: string) => `[${title}](${absUrl(path)})${description ? `: ${description}` : ''}`;

function page(title: string, description: string, ...parts: (string | false | undefined)[]) {
  return `# ${title}\n\n> ${description}\n\n${parts.filter(Boolean).join('\n\n')}\n`;
}

function entryTwin(e: Entry) {
  const d = e.data;
  const facts = [
    `Published: ${isoDate(d.date)}`,
    d.updated && `Updated: ${isoDate(d.updated)}`,
    d.tags.length > 0 && `Tags: ${d.tags.join(', ')}`,
    e.collection === 'projects' && e.data.stack.length > 0 && `Stack: ${e.data.stack.join(', ')}`,
    e.collection === 'timeline' && `Kind: ${e.data.kind.join(', ')}`,
    `Author: ${AUTHOR.name}`,
    `Page: ${absUrl(urlOf(e))}`,
  ].filter((f): f is string => Boolean(f));
  const links = d.links.length > 0 && `## Links\n\n${list(d.links.map((l) => `[${l.label}](${absUrl(l.url)})`))}`;
  const faq = d.faq.length > 0 && `## FAQ\n\n${d.faq.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n')}`;
  return page(d.title, d.description, list(facts), clean(e.body ?? '', e.filePath ?? ''), links, faq);
}

async function sectionTwin(section: Section) {
  const p = await getPage(section);
  const entries: Entry[] = await getEntries(section);
  const rows = entries.map((e) => linkTo(e.data.title, urlOf(e), `${isoDate(e.data.date)}. ${e.data.description}`));
  return page(p.data.title, p.data.description, clean(p.body ?? '', p.filePath ?? ''), `## All ${rows.length}\n\n${list(rows)}`);
}

async function pageTwin(id: string, ...extra: (string | false)[]) {
  const p = await getPage(id);
  return page(p.data.title, p.data.description, clean(p.body ?? '', p.filePath ?? ''), ...extra);
}

const socials = () => `## Elsewhere\n\n${list([...SOCIALS.map((s) => `[${s.platform}](${s.url}): ${s.handle}`), `Email: ${AUTHOR.email}`])}`;

const fmtMonth = (ym?: string) => (ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'now');

function experience() {
  return `## Experience\n\n${resume.experience
    .map((x) => `### ${x.role}, [${x.org}](${x.url})\n\n${fmtMonth(x.start)} to ${fmtMonth(x.end)}${x.location ? `, ${x.location}` : ''}\n\n${list(x.highlights)}`)
    .join('\n\n')}`;
}

async function homeTwin() {
  const home = await getPage('home');
  const latest = async (s: Section, n: number) => list((await getEntries(s)).slice(0, n).map((e) => linkTo(e.data.title, urlOf(e), e.data.description)));
  return page(
    AUTHOR.name,
    home.data.description,
    `${AUTHOR.name} (also known as ${AUTHOR.alternateName.join(', ')}) is ${AUTHOR.jobTitle} at [${AUTHOR.worksFor.name}](${AUTHOR.worksFor.url}). This is ${SITE.title}, his personal site: a Wii U style plaza of Miis on the home page, with his writing, projects, a timeline of his work, and small apps and games.`,
    `## Sections\n\n${list([
      linkTo('About', '/about/', 'who he is and what he has worked on'),
      linkTo('Blog', '/blogs/', 'posts on AI agents, developer tools and Nintendo 3DS homebrew'),
      linkTo('Projects', '/projects/', 'things he has built'),
      linkTo('Timeline', '/timeline/', 'wins, launches and milestones by date'),
      linkTo('Resume', '/resume/', 'experience, education and skills'),
      linkTo('Apps', '/apps/', 'a live chat, Paint, a Guestbook, a Terminal with a real Linux, and more'),
      linkTo('Games', '/games/', 'his game jam entries and classics that play in the browser'),
      linkTo('Contact', '/contact/', 'how to reach him'),
    ])}`,
    `## Latest posts\n\n${await latest('blog', 5)}`,
    `## Latest projects\n\n${await latest('projects', 5)}`,
    socials(),
  );
}

async function resumeTwin() {
  const p = await getPage('resume');
  const projects = `## Projects\n\n${resume.projects.map((x) => `### [${x.name}](${absUrl(x.url)})\n\n${x.tech.join(', ')}\n\n${list(x.highlights)}`).join('\n\n')}`;
  const education = `## Education\n\n${list(resume.education.map((e) => `${e.degree} in ${e.field}, ${e.school}${e.start ? ` (${e.start.slice(0, 4)} to ${e.end?.slice(0, 4) ?? 'now'})` : ''}`))}`;
  const skills = `## Skills\n\n${list(resume.skills.map((s) => `${s.label}: ${s.items.join(', ')}`))}`;
  return page(p.data.title, p.data.description, resume.summary, experience(), projects, education, skills, `The resume as a PDF: ${absUrl(resume.pdf)}`);
}

async function appsTwin() {
  return pageTwin('apps', `## Apps\n\n${list(APPS.filter((a) => a.href && !a.soon).map((a) => linkTo(a.label, a.href!, a.description)))}`);
}

async function gamesTwin() {
  const games = await getGames();
  return pageTwin('games', `## Games\n\n${list(games.map((g) => linkTo(g.label ?? g.id, `/games/${g.id}/`, g.description)))}`);
}

/** Every twin, by the path of the page it's a twin of, as a function that writes it. */
export async function twins(): Promise<Map<string, () => Promise<string>>> {
  const map = new Map<string, () => Promise<string>>([
    ['/', homeTwin],
    [
      '/about/',
      () =>
        pageTwin(
          'about',
          HEADLINE,
          experience(),
          `## Skills\n\n${list(resume.skills.map((g) => `${g.label}: ${g.items.join(', ')}`))}`,
          socials(),
        ),
    ],
    ['/contact/', () => pageTwin('contact', `Book a call: ${BOOKING_URL}`, socials())],
    ['/resume/', resumeTwin],
    ['/privacy/', () => pageTwin('privacy')],
    ['/credits/', () => pageTwin('credits')],
    ['/newsletter/', () => pageTwin('newsletter')],
    ['/apps/', appsTwin],
    ['/games/', gamesTwin],
  ]);
  for (const s of Object.keys(SECTION_PATH) as Section[]) map.set(SECTION_PATH[s], () => sectionTwin(s));
  for (const e of await getAllEntries()) map.set(urlOf(e), async () => entryTwin(e));
  return map;
}

let known: Promise<Set<string>> | null = null;

/** Whether the page at `path` has a twin, for its <head> to name it. */
export async function hasTwin(path: string) {
  known ??= twins().then((m) => new Set(m.keys()));
  return (await known).has(path);
}

/** Every twin as a list, for agents that want them all at once (/sitemap.md). */
export async function sitemapTwin() {
  const map = await twins();
  return page(`${SITE.title}: every page as Markdown`, `The Markdown twin of every page on ${SITE.url}, for AI agents.`, list([...map.keys()].map((p) => `[${absUrl(twinOf(p))}](${absUrl(twinOf(p))}) for ${absUrl(p)}`)));
}

