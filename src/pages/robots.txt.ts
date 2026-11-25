import { absUrl } from '../lib/content';

// Crawlers only read robots.txt at the root, so the sitemaps of projects served under ankush.one from their own repos'
// GitHub Pages are listed here too.
const PROJECT_SITEMAPS = ['/newtab-mii-plaza/sitemap.xml'];

export const GET = () =>
  new Response(
    `User-agent: *
Allow: /

Sitemap: ${absUrl('/sitemap.xml')}
${PROJECT_SITEMAPS.map((path) => `Sitemap: ${absUrl(path)}`).join('\n')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
