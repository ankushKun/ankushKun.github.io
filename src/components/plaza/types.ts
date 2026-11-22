// Shapes shared by the build-time data (src/lib/plaza.ts) and the browser runtime.
export type IconName =
  | 'pencil'
  | 'code'
  | 'flag'
  | 'mic'
  | 'smile'
  | 'clock'
  | 'doc'
  | 'gamepad'
  | 'plane'
  | 'envelope'
  | 'apps'
  | 'chat'
  | 'music'
  | 'chip'
  | 'trophy'
  | 'terminal'
  | 'globe'
  | 'camera'
  | 'blocks';

export interface CubeStyle {
  icon: IconName;
  colors: [string, string];
  /** The block's name, for blocks whose link is not in the site's nav. */
  label?: string;
}

export interface PlazaCube extends CubeStyle {
  label: string;
  href: string;
  /** Painted title art for the block, if public/plaza/icons/ has one for this section. */
  art?: string;
  /** A slot that shows a random post or project from `PlazaData.featured` on each visit. */
  feature?: boolean;
}

export interface PlazaPost {
  /** Index of the cube the post belongs to. Its crowd speaks it. */
  cube: number;
  /** Name on the bubble's tag. */
  tag: string;
  text: string;
  href: string;
  /** The entry's cover, square-cropped and small; without one the bubble shows its block's icon. */
  thumb?: string;
  /** A timeline event's day (YYYY-MM-DD) and the color of its kind, shown as a calendar page in place of the icon. */
  date?: { iso: string; color: string };
  /** Spoken by your own Mii in the middle instead of someone in the crowd (the welcome). */
  me?: boolean;
}

/** A Mii with a name: yours, or one from a QR image in src/data/miis/ (named after the file). */
export interface PlazaMii {
  code: string;
  name: string;
}

export interface PlazaData {
  cubes: PlazaCube[];
  posts: PlazaPost[];
  /** What your own Mii may open with; one is picked on each visit and said before anything else. */
  welcome: PlazaPost[];
  /** The group in the middle. You are first. */
  hero: PlazaMii[];
  /** Miis from QR images, walked by the crowd before random Miis fill the rest. */
  pool: PlazaMii[];
  crowd: { desktop: number; mobile: number };
  /** Posts and projects with cover art; each visit fills the feature slots with a random few. */
  featured: PlazaCube[];
}
