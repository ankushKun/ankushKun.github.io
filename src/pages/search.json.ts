// /search.json: everything the quick search (src/components/ui/Search.astro) can open, built with
// the site and fetched the first time the search is opened. Each item is a page with its title,
// what kind of thing it is, a small picture, and the words it answers to beyond its title.
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { APPS } from '../data/apps';
import { GAMES } from '../data/games';
import { getAllEntries, getEntries, getPage, urlOf, type Section } from '../lib/content';
import { gameArt } from '../lib/games';
import type { SearchItem, SearchKind } from '../lib/search';
import { artPath, tileFor } from '../lib/tiles';

const KIND: Record<Section, SearchKind> = { blog: 'Blog', projects: 'Project', timeline: 'Timeline' };

const thumb = async (image: ImageMetadata) => (await getImage({ src: image, width: 80, height: 80, fit: 'cover', format: 'webp' })).src;
const tile = (href: string) => tileFor(href)?.src ?? '';

export async function GET() {
  const items: SearchItem[] = [];
  const seen = new Set<string>();
  const add = (item: SearchItem) => {
    if (seen.has(item.href)) return;
    seen.add(item.href);
    items.push(item);
  };

  for (const app of APPS) {
    if (!app.href || app.soon) continue;
    add({ title: app.label, href: app.href, kind: app.href.startsWith('/apps/') || app.href === '/mii/' ? 'App' : 'Page', icon: tile(app.href), words: app.description });
  }

  const projects = await getEntries('projects');
  for (const game of GAMES) {
    const entry = game.project ? projects.find((p) => p.id === game.project) : undefined;
    const image = entry?.data.cover ?? gameArt(game.id);
    add({
      title: game.label ?? entry?.data.title ?? game.id,
      href: `/games/${game.id}/`,
      kind: 'Game',
      icon: image ? await thumb(image) : entry ? artPath(entry) : tile('/games/'),
      words: [game.description ?? entry?.data.description ?? '', game.by ?? '', ...(entry?.data.tags ?? [])].join(' '),
    });
  }

  const pages: [string, string][] = [
    ['blog', '/blogs/'],
    ['projects', '/projects/'],
    ['timeline', '/timeline/'],
    ['apps', '/apps/'],
    ['games', '/games/'],
    ['about', '/about/'],
    ['resume', '/resume/'],
    ['contact', '/contact/'],
    ['newsletter', '/newsletter/'],
    ['credits', '/credits/'],
    ['privacy', '/privacy/'],
  ];
  for (const [id, href] of pages) {
    const page = await getPage(id);
    add({ title: page.data.title, href, kind: 'Page', icon: tile(href), words: page.data.description });
  }
  add({ title: 'Home', href: '/#0', kind: 'Page', icon: '/apple-touch-icon.png', words: 'plaza start' });

  for (const entry of await getAllEntries()) {
    add({
      title: entry.data.title,
      href: urlOf(entry),
      kind: KIND[entry.collection],
      icon: entry.data.cover ? await thumb(entry.data.cover) : artPath(entry),
      words: [entry.data.description, ...entry.data.tags].join(' '),
      date: entry.data.date.valueOf(),
    });
  }

  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
