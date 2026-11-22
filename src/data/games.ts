// The games on /games/, in order. Each gets a page at /games/<id>/ that fills the TV's screen and
// plays it there. Your own games point at their project (cover, links and description come from
// it); anyone else's say who made them and take their art from src/assets/games/<id>.webp.
export interface Game {
  id: string;
  /** The channel's name. Defaults to the project's title. */
  label?: string;
  /** Defaults to the project's description. */
  description?: string;
  /** Your own game: its folder in src/content/projects/. */
  project?: string;
  /** Who made someone else's game. */
  by?: string;
  /** Where it comes from, as a link on its page. */
  source?: { label: string; url: string };
  /**
   * What fills the screen when it is played: a page under public/play/ (files self-hosted), named in
   * full (`/play/doom/index.html`, since the dev server serves no folder's index), or an embed URL. Without it, the game can't run in a browser and its page offers its links instead.
   */
  play?: string;
  /** Width over height of its picture: the TV's screen takes this shape, so there are no black bars. 4:3 if unset. */
  aspect?: number;
  /** `play` is a page that can't be framed (a build that needs cross-origin isolation): Play opens it in a new tab. */
  newTab?: boolean;
}

const itch = (upload: number) => `https://itch.io/embed-upload/${upload}?color=000000`;

export const GAMES: Game[] = [
  { id: 'sh23ds', label: 'sh23ds', project: 'sh23ds' },
  { id: 'last-cat-standing', project: 'last-cat-standing', play: itch(15250063), aspect: 16 / 9 },
  { id: 'pkmn-infinity-league', label: 'Infinity League', project: 'pkmn-infinity-league', play: itch(14519994), aspect: 16 / 9 },
  // A Godot build that needs SharedArrayBuffer, which only works framed in a cross-origin isolated page.
  { id: 'lucky-knight', project: 'lucky-knight', play: 'https://ankushkun.itch.io/lucky-knight', newTab: true },
  { id: 'gmtk22', label: 'Untitled Dice Game', project: 'gmtk22', play: itch(6155672), aspect: 16 / 9 },
  { id: 'cheap-saber', project: 'cheap-saber' },
  {
    id: 'doom',
    label: 'DOOM',
    description: 'Knee-Deep in the Dead, the 1993 shareware episode, on Chocolate Doom compiled to WebAssembly.',
    by: 'id Software',
    play: '/play/doom/index.html',
    aspect: 4 / 3,
  },
  {
    id: 'quake3',
    label: 'Quake III Arena',
    description: 'The Quake III Arena demo against bots, on ioquake3 compiled to WebAssembly by James Darpinian.',
    by: 'id Software',
    source: { label: 'The Longest Yard', url: 'https://thelongestyard.link/q3a-demo/' },
    play: '/play/quake3/index.html',
  },
  {
    id: 'portal',
    label: 'Portal',
    description: 'Still Alive, the song from the end of Portal, as a floppy disk demo booted on a PC emulated in your browser.',
    play: '/play/portal/index.html',
  },
  { id: 'crysis', label: 'Crysis', description: 'But can it run Crysis? Press play and find out.', by: 'Crytek', play: '/play/crysis/index.html' },
  {
    id: 'alien-hominid',
    label: 'Alien Hominid',
    description: 'The 2002 Flash game: a small yellow alien takes on the FBI. Played with Ruffle.',
    by: 'Tom Fulp and Dan Paladin',
    source: { label: 'Alien Hominid', url: 'https://www.alienhominid.com/' },
    play: '/play/flash/index.html?game=alien_hominid',
    aspect: 550 / 400,
  },
  {
    id: 'fly-guy',
    label: 'Fly Guy',
    description: 'A gentle Flash game from 2003: float a little man through a strange, quiet world. Played with Ruffle.',
    by: 'Trevor Van Meter',
    source: { label: 'Fly Guy', url: 'http://www.trevorvanmeter.com/flyguy/' },
    play: '/play/flash/index.html?game=flyguy',
    aspect: 500 / 300,
  },
  { id: 'marvin-spectrum', label: 'Marvin Spectrum', description: 'A Flash platformer, played with Ruffle.', play: '/play/flash/index.html?game=marvin_spectrum', aspect: 525 / 275 },
  { id: 'wasted-sky', label: 'Wasted Sky', description: "A Flash shoot 'em up, played with Ruffle.", play: '/play/flash/index.html?game=wasted_sky', aspect: 550 / 400 },
];
