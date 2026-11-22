// The 1200 by 630 social cards (src/lib/og.ts) for every standalone page and every entry without a
// `cover` of its own, also used as their thumbnails in lists.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { getAllEntries } from '../../lib/content';
import { renderOg, specForEntry, specForPage, type OgSpec } from '../../lib/og';

export const getStaticPaths: GetStaticPaths = async () => {
  const [entries, pages] = await Promise.all([getAllEntries(), getCollection('pages')]);

  const entryPaths = entries
    .filter((entry) => !entry.data.cover)
    .map((entry) => ({
      params: { slug: `${entry.collection}/${entry.id}` },
      props: { spec: specForEntry(entry) },
    }));

  const pagePaths = pages
    .filter((page) => !page.data.cover)
    .map((page) => ({
      params: { slug: `pages/${page.id}` },
      props: { spec: specForPage(page.id, page.data.title, page.data.description) },
    }));

  return [...entryPaths, ...pagePaths];
};

export const GET: APIRoute = async ({ props }) => {
  const jpg = await renderOg((props as { spec: OgSpec }).spec);
  return new Response(new Uint8Array(jpg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
