// Drawn channel banners for the Apps page (/art/channel/<slug>.svg): wide versions of the tiles.
import type { APIRoute, GetStaticPaths } from 'astro';
import { channelSvgs } from '../../../lib/tiles';

export const getStaticPaths: GetStaticPaths = () => channelSvgs().map(({ slug, svg }) => ({ params: { slug }, props: { svg } }));

export const GET: APIRoute = ({ props }) =>
  new Response((props as { svg: string }).svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
