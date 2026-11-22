// Small copies of the plaza's painted block art (public/plaza/icons/), for section tiles: the
// menu, the chat's rail, /apps/. Tiles show at most about 100px, so 192px covers a 2x screen at a
// fraction of the 512px original's weight. The plaza itself keeps the originals.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { ICONS } from '../../../lib/tiles';

const SIZE = 192;

export const getStaticPaths: GetStaticPaths = async () => {
  const files = (await readdir(ICONS)).filter((f) => f.endsWith('.webp'));
  return files.map((f) => ({ params: { slug: f.replace(/\.webp$/, '') }, props: { file: path.join(ICONS, f) } }));
};

export const GET: APIRoute = async ({ props }) => {
  const webp = await sharp((props as { file: string }).file).resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  return new Response(new Uint8Array(webp), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
