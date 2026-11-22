// /sitemap.xml: every static page plus every published entry. Static pages are found
// from src/pages, so adding a page adds it here without touching this file.
import { absUrl, getAllEntries, isoDate, urlOf } from '../lib/content';

// The X player is the plaza again, for X to frame, and /x/ only sends you on to it; the home page is
// the one to index.
const EXCLUDE = new Set(['/404/', '/player/', '/x/']);

const staticPaths = Object.keys(import.meta.glob('./**/*.astro'))
  .filter((file) => !file.includes('['))
  .map((file) => file.replace(/^\./, '').replace(/(index)?\.astro$/, '').replace(/\/?$/, '/'))
  .filter((path) => !EXCLUDE.has(path))
  .sort();

export async function GET() {
  const entries = await getAllEntries();
  const urls: { loc: string; lastmod?: string }[] = [
    ...staticPaths.map((path) => ({ loc: absUrl(path) })),
    ...entries.map((e) => ({ loc: absUrl(urlOf(e)), lastmod: isoDate(e.data.updated ?? e.data.date) })),
  ];
  const body = urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
