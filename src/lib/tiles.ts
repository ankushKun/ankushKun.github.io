// The tile that stands for a page: the section's painted art from public/plaza/icons/ when it has
// some (as a small copy, /art/icon/<slug>.webp, since tiles are at most about 100px), otherwise a
// drawn glyph served from /art/. Also the art for entries without a cover.
import { existsSync } from 'node:fs';
import { channelSvg, iconSvg } from '../components/plaza/glyphs';
import type { CubeStyle, IconName } from '../components/plaza/types';
import { CUBES, FEATURED } from '../data/plaza';
import { PALETTE, TILES } from '../data/sections';
import { FOOTER_NAV, NAV } from '../site';
import type { Entry } from './content';
import { sectionOf } from './nav';

export interface Tile {
  href: string;
  label: string;
  colors: [string, string];
  src: string;
}

/** The plaza's painted block art, 512px, which tiles show small copies of. */
export const ICONS = 'public/plaza/icons';

const slugOf = (href: string) => href.replace(/^\/|\/$/g, '').replace(/[/#]+/g, '-');

/** Styles for every section with a tile, keyed by its path. */
const STYLES: Record<string, CubeStyle & { index: number }> = Object.fromEntries([
  // On the plaza a drawn block's backdrop pattern follows its slot, so tiles use the same one.
  ...Object.entries(CUBES).map(([href, s], i) => [href, { ...s, index: FEATURED + i }]),
  ...Object.entries(TILES).map(([href, s], i) => [href, { ...s, index: i }]),
]);

/** The tile for any path on the site, by its section. */
export function tileFor(path: string): Tile | undefined {
  // An exact match first (an app on /apps/ has its own block), then the section.
  const href = STYLES[path] ? path : sectionOf(path);
  const style = STYLES[href];
  if (!style) return undefined;
  const label = style.label ?? [...NAV, ...FOOTER_NAV].find((l) => l.href === href)?.label ?? slugOf(href);
  const slug = slugOf(href);
  const art = existsSync(`${ICONS}/${slug}.webp`) ? `/art/icon/${slug}.webp` : `/art/tile/${slug}.svg`;
  return { href, label, colors: style.colors, src: art };
}

/**
 * The wide channel art for a page, for the Apps page's channels: a wide crop of its painted art
 * (/art/channel/<slug>.webp) when it has some, otherwise a drawn banner (/art/channel/<slug>.svg).
 */
export function channelFor(path: string) {
  const tile = tileFor(path);
  if (!tile) return undefined;
  const slug = slugOf(tile.href);
  const painted = existsSync(`${ICONS}/${slug}.webp`);
  return { ...tile, src: painted ? `/art/channel/${slug}.webp` : `/art/channel/${slug}.svg` };
}

/** Every drawn channel banner, for /art/channel/<slug>.svg. */
export function channelSvgs() {
  return Object.entries(STYLES).map(([href, s]) => ({ slug: slugOf(href), svg: channelSvg(s.icon, s.colors, s.index) }));
}

/** Every drawn tile, for /art/tile/<slug>.svg. */
export function tileSvgs() {
  return Object.entries(STYLES).map(([href, s]) => ({ slug: slugOf(href), svg: iconSvg(s.icon, s.colors, 256, s.index, true) }));
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A glyph that suits an entry, from its tags, falling back to its section's. */
function glyphFor(entry: Entry): IconName {
  const tags = new Set(entry.data.tags);
  const has = (...t: string[]) => t.some((x) => tags.has(x));
  if (entry.collection === 'talks') return 'mic';
  if (entry.collection === 'consoles' || has('game-dev', 'handheld', 'pokemon', 'doom', 'tcg')) return 'gamepad';
  if (has('hardware')) return 'chip';
  if (has('ai-agents', 'machine-learning')) return 'chat';
  if (has('travel')) return 'plane';
  if (has('developer-tools', 'web', 'web3', 'cloudflare')) return entry.collection === 'blog' ? 'pencil' : 'code';
  if (entry.collection === 'timeline') return 'trophy';
  return entry.collection === 'blog' ? 'pencil' : 'code';
}

export const artPath = (entry: Entry) => `/art/${entry.collection}/${entry.id}.svg`;

/** Art for an entry without a cover: a field of color with a glyph, different for each entry. */
export function entrySvg(entry: Entry) {
  const h = hash(`${entry.collection}/${entry.id}`);
  return iconSvg(glyphFor(entry), PALETTE[h % PALETTE.length], 512, (h >>> 8) % 4, true);
}
