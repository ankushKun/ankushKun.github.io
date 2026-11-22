// Wide crops of the plaza's painted block art (public/plaza/icons/) for the Apps page's channels
// (/art/channel/<slug>.webp), cropped where the picture's interest is, at 2x a channel's width.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { ICONS } from '../../../lib/tiles';

export const getStaticPaths: GetStaticPaths = async () => {
  const files = (await readdir(ICONS)).filter((f) => f.endsWith('.webp'));
  return files.map((f) => ({ params: { slug: f.replace(/\.webp$/, '') }, props: { file: path.join(ICONS, f) } }));
};

export const GET: APIRoute = async ({ props }) => {
  const webp = await sharp((props as { file: string }).file)
    .resize(560, 315, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 72 })
    .toBuffer();
  return new Response(new Uint8Array(webp), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
