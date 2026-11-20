// Static endpoint emitting 1200x630 PNG thumbnails & OG cards for every standalone page
// and every entry that does not define a custom `cover` image.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { getAllEntries } from '../../lib/content';
import { renderOgPng, specForEntry, specForPage, type OgSpec } from '../../lib/og';

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
  const png = await renderOgPng((props as { spec: OgSpec }).spec);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
