// The home page plaza: which links become glass cubes, how they look, and who stands in the middle.
import type { CubeStyle, MiiLook } from '../components/plaza/types';

/**
 * The plaza's blocks, in slot order: back row (4), the two sides, then the front row (whose middle
 * two are the most prominent). The first FEATURED slots show random blog posts and projects, a new
 * pick on each visit; the rest are one block per link here, keyed by href. Labels come from NAV
 * and FOOTER_NAV in src/site.ts, or `label` for links that are not in either. Art for each lives
 * in public/plaza/icons/, named after the href (e.g. `/apps/chat/` is `apps-chat.webp`). An app's block
 * links to the app itself, or to its placeholder until it is built.
 */
export const FEATURED = 1;

export const CUBES: Record<string, CubeStyle> = {
  '/games/': { label: 'Games', icon: 'gamepad', colors: ['#ff6464', '#cf2238'] },
  '/apps/chat/': { label: 'IRC Chat', icon: 'chat', colors: ['#62c4ff', '#2380dc'] },
  '/apps/music/': { label: 'Music', icon: 'music', colors: ['#ff8fc4', '#dd3f85'] },
  '/timeline/': { icon: 'flag', colors: ['#5fd16f', '#1f9457'] },
  '/blogs/': { icon: 'pencil', colors: ['#ff9d52', '#ee4a4f'] },
  '/about/': { icon: 'smile', colors: ['#ffd23f', '#f29a12'] },
  '/resume/': { label: 'Resume', icon: 'doc', colors: ['#9fb0c8', '#526984'] },
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

/**
 * The DJ: stands under the Music block with a boombox on their shoulder, bobbing while music
 * plays, says each new track, and opens the player when pressed. A file name or a Mii code, as
 * above; empty for a random Mii.
 */
export const DJ = 'Hatsune Miku.png';

/**
 * What a QR code can't carry, by file name in src/data/miis/: Switch colors, a headset, a ponytail,
 * a hairstyle without its bun (MiiLook in plaza/types.ts).
 */
export const LOOKS: Record<string, MiiLook> = {
  'Hatsune Miku.png': { parts: { hair: { color: 61 }, eyebrow: { color: 61 } }, headset: '#39c5bb' },
  'Gumi.png': { parts: { hair: { color: 69 }, eyebrow: { color: 69 } } },
};

/**
 * Who dances either side of the DJ while music plays, left then right as you look at them. Each
 * is made here: a Mii to start from (a file name or a code) with the parts that change.
 */
export const BACKUP: (MiiLook & { name: string; from: string })[] = [
  {
    name: 'Akita Neru',
    from: 'Hatsune Miku.png',
    parts: {
      hair: { type: 103, color: 85 },
      eyebrow: { color: 85 },
      eye: { color: 90 },
      personal: { favoriteColor: 10 },
    },
    ponytail: '#fff27e',
    noBun: true,
  },
  {
    name: 'Kasane Teto',
    from: 'Hatsune Miku.png',
    parts: {
      hair: { type: 29, color: 31 },
      eyebrow: { color: 31 },
      eye: { color: 20 },
      personal: { favoriteColor: 11 },
    },
    headset: '#ff4a5c',
    noBun: true,
  },
];

/**
 * The DJ's boombox: 'model' is Supersiv11's low poly boom box (public/plaza/boombox.glb, CC BY),
 * 'drawn' is built in code in the plaza's own style (plaza/boombox.ts).
 */
export const BOOMBOX: 'model' | 'drawn' = 'model';

/** Crowd size, not counting the group in the middle. */
export const CROWD = { desktop: 110, mobile: 70 };

/**
 * What your Mii says first on every visit, one picked at random, before anyone else in the plaza
 * speaks. Keep each to about 70 characters: a bubble shows three lines. The Konami code one is
 * true: typing it on the plaza starts a party (plaza/main.ts).
 */
export const WELCOME: string[] = [
  // Plain hellos.
  'Hi, welcome to my plaza! Tap a block to look around.',
  'Hey, thanks for stopping by. Make yourself at home.',
  'Oh, a visitor! Pick a block, any block.',
  'Welcome in. Everyone here is a real Mii, a few of them famous.',
  // Puns and nonsense.
  'Welcome! Mii casa es su casa.',
  'You look nice today. Yes, you, behind the screen.',
  "I'd shake your hand, but Miis don't really have fingers.",
  'Fun fact: I am mostly head.',
  'This plaza runs on three.js, WebAssembly and vibes.',
  'No ads here. Just Miis. So many Miis.',
  'Please keep your Miis inside the plaza at all times.',
  'Go ahead, pick someone up. They love it. They told me.',
  // Unhinged.
  'I have been standing here since the page loaded. Please send snacks.',
  "The crowd is friendly. Mostly. Don't look at the one in the back.",
  'Throw someone across the plaza. They respawn. Probably.',
  'Every Mii here knows what you did. Welcome anyway!',
  'I fell out of the sky for you. The least you can do is click something.',
  // Easter eggs and references.
  'Up, up, down, down, left, right, left, right, B, A. Go on, try it.',
  'The cake is a lie. The projects are real, though.',
  'Rise and shine, visitor. Rise and... shine.',
  'In my restless dreams, I see this plaza.',
  "It's dangerous to go alone! Take a block.",
  'Kept you waiting, huh?',
  'A wild visitor appeared!',
  'Thank you, visitor! But your project is in another block.',
  'Hey! Listen!',
  'Would you kindly tap a block?',
  'Stay a while and listen.',
  'Praise the sun! Then come check out the blog.',
  'You feel like you are going to have a good time.',
  'All your base are belong to us. Welcome!',
  "It's-a me, Ankush!",
  'StreetPass! You met a new Mii: me.',
  'Achievement unlocked: found the website.',
  'This is a safe room. The typewriter is broken, sorry.',
  'The Mii Channel music is playing in your head now. You are welcome.',
];
