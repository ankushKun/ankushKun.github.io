// The home page plaza: which links become glass cubes, how they look, and who stands in the middle.
import type { CubeStyle } from '../components/plaza/types';

/**
 * The plaza's blocks, in slot order: back row (4), the two sides, then the front row (whose middle
 * two are the most prominent). The first FEATURED slots show random blog posts and projects, a new
 * pick on each visit; the rest are one block per link here, keyed by href. Labels come from NAV
 * and FOOTER_NAV in src/site.ts, or `label` for links that are not in either. Art for each lives
 * in public/plaza/icons/, named after the href (e.g. `/apps/#irc-chat` is `apps-irc-chat.webp`).
 */
export const FEATURED = 1;

export const CUBES: Record<string, CubeStyle> = {
  '/apps/#games': { label: 'Games', icon: 'gamepad', colors: ['#ff6464', '#cf2238'] },
  '/apps/#irc-chat': { label: 'IRC Chat', icon: 'chat', colors: ['#62c4ff', '#2380dc'] },
  '/apps/#music': { label: 'Music', icon: 'music', colors: ['#ff8fc4', '#dd3f85'] },
  '/timeline/': { icon: 'flag', colors: ['#5fd16f', '#1f9457'] },
  '/resume/': { icon: 'doc', colors: ['#9fb0c8', '#526984'] },
  '/about/': { icon: 'smile', colors: ['#ffd23f', '#f29a12'] },
  '/blogs/': { icon: 'pencil', colors: ['#ff9d52', '#ee4a4f'] },
  '/projects/': { icon: 'code', colors: ['#45d3c6', '#1c6fd0'] },
  '/apps/': { icon: 'apps', colors: ['#b184ff', '#6a3fd6'] },
};

/**
 * Miis are Wii U / 3DS Mii data. Drop Mii QR code images (from a 3DS, a Wii U, Miitomo or any site
 * that shares them) into src/data/miis/: each one joins the crowd. ME and HERO take either one of
 * those file names or a Mii code copied from /mii/.
 */

/** You, front and center. */
export const ME = 'AwEAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNAGUAAAAAAAAAAAAAAAAAAAAAAEgmAiBLABFrRBgBM0MOgRIPaA0AACkDUkhQAAAAAAAAAAAAAAAAAAAAAAAAAAAAACnk';

/** Up to nine friends who stand around you and applaud. With fewer than seven, the crowd fills in. */
export const HERO: string[] = [];

/** Crowd size, not counting the group in the middle. */
export const CROWD = { desktop: 110, mobile: 70 };
