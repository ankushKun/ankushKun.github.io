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
  /** A slot that turns through random picks from `PlazaData.featured`, a new one every few seconds. */
  feature?: boolean;
  /** What kind of pick it is (a section, games, apps, paint): every kind gets an equal share of turns (rotation.ts). */
  kind?: string;
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
  /** Spoken by this Mii (its index in the crowd), wherever it stands: the DJ saying what plays. */
  by?: number;
  /** `thumb` is a Mii's portrait (a chat message's sender), drawn on a backdrop as the chat draws faces. */
  mii?: boolean;
  /** What kind of post it is (a section, chat, paint): every kind gets an equal share of turns (rotation.ts). */
  kind?: string;
  /**
   * A drawing shown large in place of `text`: a chat drawing's black ink on no paper of its own
   * (`ink`, Miiverse's 320 by 120), or a Paint day on its white paper (16:10, the canvas's shape).
   */
  drawing?: { src: string; ink: boolean };
}

/** What a stage dancer twirls in their right hand during the polka (plaza/leek.ts). */
export type StageProp = 'leek' | 'phone' | 'baguette';

/**
 * What a Mii code can't carry. `parts` change the Mii itself, by FFL's CharInfo names (hair type,
 * eye color, favoriteColor under personal...); the colors of hair, eyes, eyebrows, mouth, beard and
 * glasses are the Switch's hundred (0 to 99), which a QR code can't hold. `leftEye` gives the eye on
 * the left as you look an iris color of its own, everywhere the Mii is drawn. The rest are drawn on,
 * for the DJ and those around them and the middle group only (far-off crowd heads are flat
 * pictures): `headset` is a headset with a mic, its lights in that color, `ponytail` is a long
 * ponytail tied high on the left, in that color, and `prop` picks what they twirl in the polka.
 */
export interface MiiLook {
  parts?: Record<string, Record<string, number>>;
  /** The iris color of the eye on the left as you look, when it differs from the other (a CSS hex). */
  leftEye?: string;
  headset?: string;
  ponytail?: string;
  /** Leaves off any bun or puff on the back of the head, keeping the rest of the hairstyle. */
  noBun?: boolean;
  /** What this dancer twirls in the polka in place of a leek (leek.ts). */
  prop?: StageProp;
}

/** A Mii with a name: yours, or one from a QR image in src/data/miis/ (named after the file). */
export interface PlazaMii extends MiiLook {
  code: string;
  name: string;
}

export interface PlazaData {
  cubes: PlazaCube[];
  /** The slot each block takes on a wide screen (a phone puts block `i` in slot `i`). */
  wide: number[];
  posts: PlazaPost[];
  /** What your own Mii may open with; one is picked on each visit and said before anything else. */
  welcome: PlazaPost[];
  /** The group in the middle. You are first. */
  hero: PlazaMii[];
  /** Miis from QR images, walked by the crowd before random Miis fill the rest. */
  pool: PlazaMii[];
  /** Who stands under the Music block with the boombox; null for a random Mii. */
  dj: PlazaMii | null;
  /** Who dances either side of them, left then right. */
  backup: PlazaMii[];
  /** Video ids of the tracks the stage dances the polka to from start to end. */
  polka: string[];
  /** Video ids of the tracks the stage dances the Tetoris spin to, each with where in it the stage stops. */
  tetoris: Record<string, [number, number][]>;
  boombox: 'model' | 'drawn';
  crowd: { desktop: number; mobile: number };
  /** Entries with cover art, other people's games and apps that aren't blocks: what the feature slots turn through. */
  featured: PlazaCube[];
}
