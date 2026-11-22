// Channel art for the Apps page (/art/channel/<slug>.webp) at 2x a channel's width: the app's own
// banner from src/assets/channels/ when it has one, otherwise a wide crop of its painted block art
// (public/plaza/icons/), cropped where the picture's interest is.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { CHANNELS, ICONS } from '../../../lib/tiles';

const webps = async (dir: string) => (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.webp'));

export const getStaticPaths: GetStaticPaths = async () => {
  const files = new Map<string, { file: string; banner: boolean }>();
  for (const f of await webps(ICONS)) files.set(f, { file: path.join(ICONS, f), banner: false });
  for (const f of await webps(CHANNELS)) files.set(f, { file: path.join(CHANNELS, f), banner: true });
  return [...files].map(([f, props]) => ({ params: { slug: f.replace(/\.webp$/, '') }, props }));
};

export const GET: APIRoute = async ({ props }) => {
  const { file, banner } = props as { file: string; banner: boolean };
  const webp = await sharp(file)
    .resize(560, 315, { fit: 'cover', position: banner ? 'centre' : sharp.strategy.attention })
    .webp({ quality: banner ? 82 : 72 })
    .toBuffer();
  return new Response(new Uint8Array(webp), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
