// Small copies of the home page lobby's icons (Lobby.astro): the plaza's painted block art
// (public/plaza/icons/) and the icons of things you've built (public/lobby/). The lobby shows them
// at most 26px, so 80px covers a 3x screen at a fraction of the originals' weight.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { ICONS } from '../../../lib/tiles';

const SIZE = 80;
const BUILT = 'public/lobby';

export const getStaticPaths: GetStaticPaths = async () => {
  const from = async (dir: string) =>
    (await readdir(dir)).filter((f) => /\.(webp|png)$/.test(f)).map((f) => ({ params: { slug: f.replace(/\.\w+$/, '') }, props: { file: path.join(dir, f) } }));
  return [...(await from(ICONS)), ...(await from(BUILT))];
};

export const GET: APIRoute = async ({ props }) => {
  const webp = await sharp((props as { file: string }).file).resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  return new Response(new Uint8Array(webp), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
