// Tiles for pages that have no block on the plaza. Every page shows its section's tile at the top,
// and the dock shows one per NAV link. Pages with a block use its style from CUBES in plaza.ts.
import type { CubeStyle } from '../components/plaza/types';

export const TILES: Record<string, CubeStyle> = {
  '/contact/': { icon: 'envelope', colors: ['#62c4ff', '#2380dc'] },
  '/newsletter/': { icon: 'envelope', colors: ['#ffb35c', '#ea6a2a'] },
  '/privacy/': { icon: 'doc', colors: ['#9fb0c8', '#526984'] },
  '/credits/': { icon: 'smile', colors: ['#5fd16f', '#1f9457'] },
  '/mii/': { icon: 'smile', colors: ['#ffd23f', '#f29a12'] },
  '/apps/paint/': { icon: 'pencil', colors: ['#ffb35c', '#ea6a2a'] },
  '/apps/guestbook/': { icon: 'envelope', colors: ['#5fd16f', '#1f9457'] },
  '/apps/terminal/': { icon: 'code', colors: ['#9fb0c8', '#526984'] },
};

/** Colors for art made for entries without a cover, picked per entry so a grid of them varies. */
export const PALETTE: [string, string][] = [
  ['#ff9d52', '#ee4a4f'],
  ['#45d3c6', '#1c6fd0'],
  ['#5fd16f', '#1f9457'],
  ['#ffd23f', '#f29a12'],
  ['#b184ff', '#6a3fd6'],
  ['#62c4ff', '#2380dc'],
  ['#ff8fc4', '#dd3f85'],
  ['#ff6464', '#cf2238'],
  ['#7fd8ff', '#2f8fe0'],
];
