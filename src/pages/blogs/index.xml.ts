import rss from '@astrojs/rss';
import { AUTHOR, SITE } from '../../site';
import { absUrl, getEntries, getPage, urlOf } from '../../lib/content';

export async function GET() {
  const page = await getPage('blog');
  const posts = await getEntries('blog');
  return rss({
    title: `${page.data.title} | ${SITE.title}`,
    description: page.data.description,
    site: absUrl('/blogs/'),
    trailingSlash: true,
    customData: `<language>${SITE.lang}</language>`,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      link: urlOf(p),
      pubDate: p.data.date,
      categories: p.data.tags,
      author: `${AUTHOR.email} (${AUTHOR.name})`,
    })),
  });
}
