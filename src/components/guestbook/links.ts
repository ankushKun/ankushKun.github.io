// How a Guestbook link shows: the platform's own mark on its colour (lib/platforms.ts), an envelope
// for an email, a globe for any other site. Shared by the page as built and the page as it runs, so
// a note looks the same either way.
import { platformFor } from '../../lib/platforms';
import { HANDLES } from './entry';

export interface LinkBadge {
  href: string;
  /** What the link is, for its label: the platform, Email, or the site's host. */
  label: string;
  /** What it says as text in the sheet's list: the address without its scheme. */
  short: string;
  bg: string;
  ink: string;
  /** A filled 24 by 24 path (a brand mark), or a stroked glyph. */
  path: string;
  stroke: boolean;
  /** An email address, which is kept out of analytics (`ph-no-capture`) wherever it shows. */
  email?: boolean;
}

const MAIL = 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM4 7l8 6 8-6';
const GLOBE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z';

export function badgeFor(href: string): LinkBadge {
  if (href.startsWith('mailto:')) {
    const short = href.slice(7);
    return { href, label: 'Email', short, bg: '#5c6468', ink: '#fff', path: MAIL, stroke: true, email: true };
  }
  let host = '';
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    // Every stored link parses; this is for safety only.
  }
  const short = href.replace(/^https?:\/\/(www\.)?/, '');
  const p = platformFor(host);
  if (p) return { href, label: p.name, short, bg: p.bg, ink: p.ink ?? '#fff', path: p.path, stroke: false };
  return { href, label: host || 'Link', short, bg: '#2f8fe0', ink: '#fff', path: GLOBE, stroke: true };
}

/** The handle platforms in the picker, with their marks. */
export const HANDLE_BADGES = Object.entries(HANDLES).map(([id, h]) => ({ id, ...badgeFor(h.url('a')), label: h.label }));

/** A badge as an element, for the page as it runs. */
export function badgeEl(b: Pick<LinkBadge, 'bg' | 'ink' | 'path' | 'stroke'>, size = 13): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'gb-badge';
  span.style.setProperty('--badge-bg', b.bg);
  span.style.color = b.ink;
  span.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', b.path);
  if (b.stroke) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
  } else path.setAttribute('fill', 'currentColor');
  svg.append(path);
  span.append(svg);
  return span;
}
