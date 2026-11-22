// Where a path sits in the site, shared by the build and the browser (page transitions, the dock).
import { NAV } from '../site';

/** The section a path belongs to: its first segment, e.g. `/blogs/a-post/` is `/blogs/`. */
export function sectionOf(path: string) {
  const first = path.split(/[/?#]/).filter(Boolean)[0];
  return first ? `/${first}/` : '/';
}

/** How deep a path is: 0 for the home page, 1 for a section, 2 for an entry in it. */
export const depthOf = (path: string) => path.split(/[?#]/)[0].split('/').filter(Boolean).length;

/** A section's place in the dock, or -1 for pages the dock doesn't show. */
export const dockIndex = (path: string) => NAV.findIndex((l) => sectionOf(l.href) === sectionOf(path));
