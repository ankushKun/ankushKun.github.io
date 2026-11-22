// The Markdown twin of every page that is something to read (src/lib/twins.ts): /index.md for the
// home page, /blogs/<slug>.md for a post, and so on, plus /sitemap.md listing them all.
import type { APIRoute, GetStaticPaths } from 'astro';
import { sitemapTwin, twinOf, twins } from '../lib/twins';

export const getStaticPaths = (async () => {
  const map = await twins();
  return [
    ...[...map].map(([path, write]) => ({ params: { twin: twinOf(path).slice(1, -3) }, props: { write } })),
    { params: { twin: 'sitemap' }, props: { write: sitemapTwin } },
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(await (props as { write: () => Promise<string> }).write(), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
