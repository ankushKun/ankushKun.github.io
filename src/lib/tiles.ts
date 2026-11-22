// The tile that stands for a page: the section's painted art from public/plaza/icons/ when it has
// some (as a small copy, /art/icon/<slug>.webp, since tiles are at most about 100px), otherwise a
// drawn glyph served from /art/. Also the art for entries without a cover.
import { existsSync } from 'node:fs';
import { channelSvg, iconSvg } from '../components/plaza/glyphs';
import type { CubeStyle } from '../components/plaza/types';
import { CUBES, FEATURED } from '../data/plaza';
import { TILES } from '../data/sections';
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

/** Wide channel art painted for the Apps page, 16:9 on white, larger than it is shown. */
export const CHANNELS = 'src/assets/channels';

/**
 * The wide channel art for a page, for the Apps page's channels (/art/channel/<slug>.webp): its own
 * banner from CHANNELS when it has one (`banner`), else a wide crop of its painted block art, else a
 * drawn banner (/art/channel/<slug>.svg).
 */
export function channelFor(path: string) {
  const tile = tileFor(path);
  if (!tile) return undefined;
  const slug = slugOf(tile.href);
  const banner = existsSync(`${CHANNELS}/${slug}.webp`);
  const painted = banner || existsSync(`${ICONS}/${slug}.webp`);
  return { ...tile, banner, src: painted ? `/art/channel/${slug}.webp` : `/art/channel/${slug}.svg` };
}

/** Every drawn channel banner, for /art/channel/<slug>.svg. */
export function channelSvgs() {
  return Object.entries(STYLES).map(([href, s]) => ({ slug: slugOf(href), svg: channelSvg(s.icon, s.colors, s.index) }));
}

/** Every drawn tile, for /art/tile/<slug>.svg. */
export function tileSvgs() {
  return Object.entries(STYLES).map(([href, s]) => ({ slug: slugOf(href), svg: iconSvg(s.icon, s.colors, 256, s.index, true) }));
}

export const artPath = (entry: Entry) => `/art/${entry.collection}/${entry.id}.svg`;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur) lines.push(cur);
  // Clamp remaining words onto the last line with an ellipsis only if genuinely overflowed
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last).replace(/[.,;:!?-]+$/, '') + '...';
  }
  return lines.slice(0, maxLines);
}

interface CardTheme {
  label: string;
  bgTop: string;
  bgBot: string;
  accent: string;
  grid: string;
  ink: string;
  meta: string;
  muted: string;
  emblem: string;
}

function themeFor(entry: Entry): CardTheme {
  if (entry.collection === 'projects') {
    return {
      label: 'PROJECT',
      bgTop: '#131c24',
      bgBot: '#0c1218',
      accent: '#38bcf5',
      grid: '#9ec5e8',
      ink: '#f2f7fa',
      meta: '#c4dfed',
      muted: '#7d96a8',
      // Isometric cube emblem
      emblem: `<g transform="translate(580, 128)" stroke="#38bcf5" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linejoin="round">
        <polygon points="82,6 158,50 158,136 82,180 6,136 6,50"/>
        <polyline points="6,50 82,94 158,50"/>
        <line x1="82" y1="94" x2="82" y2="180"/>
      </g>`,
    };
  }

  if (entry.collection === 'blog') {
    return {
      label: 'BLOG',
      bgTop: '#1e1613',
      bgBot: '#120f0e',
      accent: '#ff8a4c',
      grid: '#f5c4a3',
      ink: '#faf4f0',
      meta: '#edd0be',
      muted: '#9e8577',
      // Editorial page emblem
      emblem: `<g transform="translate(582, 120)" stroke="#ff8a4c" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="14" y="6" width="136" height="168" rx="16"/>
        <line x1="42" y1="48" x2="122" y2="48"/>
        <line x1="42" y1="78" x2="122" y2="78"/>
        <line x1="42" y1="108" x2="96" y2="108"/>
        <line x1="42" y1="138" x2="112" y2="138"/>
      </g>`,
    };
  }

  const kind = entry.data.kind[0] ?? 'milestone';
  switch (kind) {
    case 'win':
      return {
        label: 'WIN',
        bgTop: '#191815',
        bgBot: '#101216',
        accent: '#f5b82e',
        grid: '#f5d280',
        ink: '#f7f5f0',
        meta: '#eadbb8',
        muted: '#9a8f7a',
        // Minimal trophy wireframe
        emblem: `<g transform="translate(578, 114)" stroke="#f5b82e" stroke-opacity="0.17" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M40 16 H132 V72 C132 104 112 124 86 124 C60 124 40 104 40 72 Z"/>
          <path d="M40 32 H16 C16 64 26 80 44 82"/>
          <path d="M132 32 H156 C156 64 146 80 128 82"/>
          <line x1="86" y1="124" x2="86" y2="154"/>
          <path d="M52 154 H120"/>
          <path d="M44 166 H128"/>
        </g>`,
      };
    case 'work':
      return {
        label: 'WORK',
        bgTop: '#141b24',
        bgBot: '#0d1218',
        accent: '#48a8ff',
        grid: '#9ec5e8',
        ink: '#f2f6fa',
        meta: '#c7d8e8',
        muted: '#8296a8',
        // Terminal window wireframe
        emblem: `<g transform="translate(565, 122)" stroke="#48a8ff" stroke-opacity="0.16" stroke-width="2.5" fill="none">
          <rect x="0" y="0" width="180" height="144" rx="18"/>
          <line x1="0" y1="36" x2="180" y2="36"/>
          <circle cx="24" cy="18" r="4" fill="#48a8ff" fill-opacity="0.24" stroke="none"/>
          <circle cx="42" cy="18" r="4" fill="#48a8ff" fill-opacity="0.24" stroke="none"/>
          <circle cx="60" cy="18" r="4" fill="#48a8ff" fill-opacity="0.24" stroke="none"/>
          <path d="M36 74 L64 94 L36 114" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="80" y1="114" x2="132" y2="114" stroke-linecap="round"/>
        </g>`,
      };
    case 'launch':
      return {
        label: 'LAUNCH',
        bgTop: '#1e1518',
        bgBot: '#120e12',
        accent: '#ff6368',
        grid: '#f5a3a6',
        ink: '#faf2f3',
        meta: '#f0c2c4',
        muted: '#9e7f81',
        // Orbital launch emblem
        emblem: `<g transform="translate(578, 122)" stroke="#ff6368" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="84" cy="84" r="68" stroke-dasharray="10 8"/>
          <circle cx="84" cy="84" r="38"/>
          <path d="M84 46 L118 20 M118 20 L108 54 M118 20 L84 26"/>
        </g>`,
      };
    case 'hackathon':
      return {
        label: 'HACKATHON',
        bgTop: '#181522',
        bgBot: '#100e16',
        accent: '#a57cff',
        grid: '#cbb5fa',
        ink: '#f5f2fa',
        meta: '#d5c7f2',
        muted: '#8d81a8',
        // Code brackets + bolt emblem
        emblem: `<g transform="translate(566, 126)" stroke="#a57cff" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M52 28 L10 74 L52 120"/>
          <path d="M128 28 L170 74 L128 120"/>
          <path d="M98 18 L72 78 H100 L82 132"/>
        </g>`,
      };
    case 'hardware':
      return {
        label: 'HARDWARE',
        bgTop: '#121d1a',
        bgBot: '#0c1312',
        accent: '#34d399',
        grid: '#8de3c4',
        ink: '#f1faf6',
        meta: '#bfe8d9',
        muted: '#77998d',
        // PCB microchip wireframe
        emblem: `<g transform="translate(576, 124)" stroke="#34d399" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linecap="round">
          <rect x="34" y="34" width="104" height="104" rx="14"/>
          <rect x="58" y="58" width="56" height="56" rx="6"/>
          <path d="M58 10 V34 M86 10 V34 M114 10 V34 M58 138 V162 M86 138 V162 M114 138 V162"/>
          <path d="M10 58 H34 M10 86 H34 M10 114 H34 M138 58 H162 M138 86 H162 M138 114 H162"/>
        </g>`,
      };
    default:
      return {
        label: 'MILESTONE',
        bgTop: '#121c1d',
        bgBot: '#0c1214',
        accent: '#36c7b9',
        grid: '#8ce0d8',
        ink: '#f1f9f9',
        meta: '#bee5e1',
        muted: '#789996',
        // Compass star emblem
        emblem: `<g transform="translate(578, 120)" stroke="#36c7b9" stroke-opacity="0.18" stroke-width="2.5" fill="none" stroke-linejoin="round">
          <circle cx="84" cy="84" r="66"/>
          <polygon points="84,26 98,70 142,84 98,98 84,142 70,98 26,84 70,70"/>
          <circle cx="84" cy="84" r="8"/>
        </g>`,
      };
  }
}

/**
 * Dark technical blueprint 16:9 fallback thumbnail for entries without a real cover image.
 * Uses semantic category accents, a masked dot/hairline grid, subtle geometric wireframe emblem,
 * top safe zones (keeping corner badges clear), and full-title scaling without awkward truncation.
 */
export function entrySvg(entry: Entry) {
  const year = String(entry.data.date.getUTCFullYear());
  const t = themeFor(entry);
  const title = entry.data.title;

  // Dynamic line sizing kept within the left ~68% so titles never collide with the right emblem.
  const isLong = title.length > 34;
  const isMed = title.length > 18;
  const maxChars = isLong ? 22 : isMed ? 19 : 16;
  const lines = wrapLines(title, maxChars, 3);
  const fontSize = lines.length >= 3 ? 42 : lines.length === 2 ? (isLong ? 44 : 48) : title.length > 12 ? 54 : 62;
  const lineHeight = Math.round(fontSize * 1.2);
  const blockHeight = (lines.length - 1) * lineHeight + fontSize;
  const centerY = 224;
  const topY = Math.round(centerY - blockHeight / 2);
  const firstBaselineY = topY + Math.round(fontSize * 0.84);
  const barY = topY + 6;
  const barH = Math.max(48, blockHeight - 6);

  const metaItems =
    entry.collection === 'projects' && entry.data.stack.length > 0
      ? entry.data.stack.slice(0, 3)
      : entry.data.tags.slice(0, 3);
  const footer = metaItems.join('  ·  ');

  // Keep top-right completely clear on projects (where the Archived badge sits).
  const topYearMarkup =
    entry.collection === 'projects'
      ? ''
      : `<text x="748" y="86" text-anchor="end" fill="${t.grid}" fill-opacity="0.25" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="25" font-weight="700" letter-spacing="0.06em">${esc(year)}</text>`;

  const bottomLeft =
    entry.collection === 'projects'
      ? year
      : entry.collection === 'timeline'
        ? entry.data.kind.map((k) => k.toUpperCase()).join(' · ')
        : t.label;

  const titleMarkup = lines
    .map(
      (line, i) =>
        `<text x="72" y="${firstBaselineY + i * lineHeight}" fill="${t.ink}" font-family="'M PLUS 1p', ui-rounded, system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="-0.02em">${esc(line)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${t.bgTop}"/>
      <stop offset="100%" stop-color="${t.bgBot}"/>
    </linearGradient>
    <radialGradient id="glow" cx="84%" cy="18%" r="65%">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.26"/>
      <stop offset="55%" stop-color="${t.accent}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="${t.grid}" stroke-opacity="0.075" stroke-width="1"/>
      <circle cx="0" cy="0" r="1.4" fill="${t.grid}" fill-opacity="0.18"/>
    </pattern>
    <radialGradient id="maskg" cx="68%" cy="32%" r="68%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.12"/>
    </radialGradient>
    <mask id="gmask"><rect width="800" height="450" fill="url(#maskg)"/></mask>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.9"/>
      <stop offset="60%" stop-color="${t.accent}" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#bg)"/>
  <rect width="800" height="450" fill="url(#glow)"/>
  <rect width="800" height="450" fill="url(#grid)" mask="url(#gmask)"/>
  ${t.emblem}
  ${topYearMarkup}
  <rect x="48" y="${barY}" width="5" height="${barH}" rx="2.5" fill="${t.accent}"/>
  ${titleMarkup}
  <line x1="48" y1="366" x2="752" y2="366" stroke="url(#rule)" stroke-width="1.5"/>
  <circle cx="58" cy="404" r="6" fill="${t.accent}"/>
  <text x="76" y="411" fill="${t.meta}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="21" font-weight="700" letter-spacing="0.07em">${esc(bottomLeft)}</text>
  ${footer ? `<text x="752" y="411" text-anchor="end" fill="${t.muted}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="20" font-weight="500">${esc(footer)}</text>` : ''}
</svg>`;
}
