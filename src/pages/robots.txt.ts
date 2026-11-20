import { absUrl } from '../lib/content';

export const GET = () =>
  new Response(
    `User-agent: *
Allow: /

Sitemap: ${absUrl('/sitemap.xml')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
