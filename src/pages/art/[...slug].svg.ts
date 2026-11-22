// Drawn art: section tiles without painted art (/art/tile/<slug>.svg) and art for entries without
// a cover (/art/<collection>/<slug>.svg), used in lists and on detail pages.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getAllEntries } from '../../lib/content';
import { entrySvg, tileSvgs } from '../../lib/tiles';

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = (await getAllEntries()).filter((e) => !e.data.cover);
  return [
    ...tileSvgs().map(({ slug, svg }) => ({ params: { slug: `tile/${slug}` }, props: { svg } })),
    ...entries.map((e) => ({ params: { slug: `${e.collection}/${e.id}` }, props: { svg: entrySvg(e) } })),
  ];
};

export const GET: APIRoute = ({ props }) =>
  new Response((props as { svg: string }).svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
