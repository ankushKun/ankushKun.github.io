// /llms.txt (https://llmstxt.org): a generated index of the site for language models.
import { AUTHOR, SITE, SOCIALS } from '../site';
import { SECTION_PATH, absUrl, getEntries, getPage, urlOf, type Entry, type Section } from '../lib/content';

const line = (title: string, url: string, description: string) => `- [${title}](${url}): ${description}`;

export async function GET() {
  const pages = await Promise.all(
    [
      ['about', '/about/'],
      ['resume', '/resume/'],
      ['contact', '/contact/'],
      ['newsletter', '/newsletter/'],
    ].map(async ([id, path]) => {
      const p = await getPage(id);
      return line(p.data.title, absUrl(path), p.data.description);
    }),
  );

  const sections = await Promise.all(
    (Object.keys(SECTION_PATH) as Section[]).map(async (s) => {
      const page = await getPage(s);
      const entries: Entry[] = await getEntries(s);
      if (!entries.length) return '';
      return `## ${page.data.title}\n\n${entries.map((e) => line(e.data.title, absUrl(urlOf(e)), e.data.description)).join('\n')}`;
    }),
  );

  const text = [
    `# ${AUTHOR.name}`,
    `> ${SITE.description}`,
    `${AUTHOR.name} (also known as ${AUTHOR.alternateName.join(', ')}) is ${AUTHOR.jobTitle} at [${AUTHOR.worksFor.name}](${AUTHOR.worksFor.url}).`,
    `## Pages\n\n${pages.join('\n')}`,
    ...sections.filter(Boolean),
    `## Elsewhere\n\n${SOCIALS.map((s) => `- [${s.platform}](${s.url})`).join('\n')}\n- Email: ${AUTHOR.email}`,
  ].join('\n\n');

  return new Response(text + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
