// What a link button shows for any href: its badge (a platform's mark, a site's own icon, a section's
// tile or a glyph) and what pressing it does. The label is always the one written for the link (a
// `links:` entry's `label`), so it says what the link is for, never just a domain.
import { APPS, appPath } from '../data/apps';
import FAVICONS from '../data/favicons.json';
import { SITE } from '../site';
import { isExternal } from './external';
import { platformFor } from './platforms';
import { tileFor } from './tiles';

export type Glyph = 'mail' | 'rss' | 'globe' | 'download' | 'file' | 'print' | 'chart';

export type Badge =
  | { type: 'brand'; path: string; bg: string; ink?: string; bleed?: boolean }
  | { type: 'favicon'; src: string; fill: boolean }
  | { type: 'tile'; src: string }
  | { type: 'glyph'; glyph: Glyph; bg: string };

/** What pressing it does, shown at the button's end: a new tab, a page here, a download, or nothing. */
export type LinkKind = 'external' | 'internal' | 'download' | 'action';

export interface ResolvedLink {
  kind: LinkKind;
  label: string;
  badge: Badge;
}

const SLATE = '#56636b';
const GLYPH_BG: Record<Glyph, string> = {
  mail: '#2fb2e6',
  rss: '#ee802f',
  globe: SLATE,
  download: SLATE,
  file: SLATE,
  print: SLATE,
  chart: SLATE,
};

const glyph = (g: Glyph): Badge => ({ type: 'glyph', glyph: g, bg: GLYPH_BG[g] });
const SELF = new URL(SITE.url).hostname;
const icons: Record<string, string> = FAVICONS;

/** A page's section tile; an app's own tile for an app's page (the chat has its own). */
function tileOf(path: string) {
  const app = APPS.find((a) => a.href === path);
  return tileFor(app ? appPath(app) : path)?.src;
}

function badgeFor(host: string, href: string): Badge {
  const platform = platformFor(host);
  if (platform) return { type: 'brand', path: platform.path, bg: platform.bg, ink: platform.ink, bleed: platform.bleed };
  if (host === SELF) return { type: 'favicon', src: '/apple-touch-icon.png', fill: true };
  if (icons[host]) return { type: 'favicon', src: `/favicons/${host}.png`, fill: icons[host] === 'fill' };
  return glyph(/\.pdf($|[?#])/i.test(href) ? 'file' : 'globe');
}

export function resolveLink(
  href: string | undefined,
  label: string,
  opts: { download?: string; glyph?: Glyph; tile?: string } = {},
): ResolvedLink {
  const tile = opts.tile ? tileOf(opts.tile) : undefined;
  const given = (fallback: Badge): Badge => (tile ? { type: 'tile', src: tile } : opts.glyph ? glyph(opts.glyph) : fallback);

  if (!href) return { kind: 'action', label, badge: given(glyph('globe')) };
  if (opts.download) return { kind: 'download', label, badge: given(glyph('download')) };
  if (href.startsWith('mailto:')) return { kind: 'internal', label, badge: given(glyph('mail')) };

  if (isExternal(href)) {
    const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    return { kind: 'external', label, badge: given(badgeFor(host, href)) };
  }

  if (/\.xml($|[?#])/i.test(href)) return { kind: 'internal', label, badge: given(glyph('rss')) };
  const art = tileOf(href);
  return { kind: 'internal', label, badge: given(art ? { type: 'tile', src: art } : glyph('globe')) };
}
