// The apps on /apps/, in order. Each has a tile from CUBES in plaza.ts or TILES in sections.ts, keyed
// by appPath(): its `href`, else its anchor on /apps/ (`/apps/#<id>`). An app marked `soon` gets a
// placeholder screen at its href (pages/apps/[app].astro) until it is built; drop `soon` and give it
// a page of its own when it is.
export interface App {
  id: string;
  label: string;
  description: string;
  href?: string;
  /** Not built yet: its href shows a placeholder and its channel says Soon. */
  soon?: boolean;
}

/** The path an app's tile, block and art are keyed by. */
export const appPath = (app: App) => app.href ?? `/apps/#${app.id}`;

export const APPS: App[] = [
  {
    id: 'irc-chat',
    label: 'Chat',
    description: 'Live Miiverse-style chat room with Mii feelings, 1-bit pixel doodles, and GIFs.',
    href: '/apps/chat/',
  },
  {
    id: 'mii',
    label: 'Mii Studio',
    description: 'Inspect any Wii U / 3DS Mii in 3D, decode QR codes, or shuffle the plaza crowd.',
    href: '/mii/',
  },
  { id: 'games', label: 'Games', description: 'My game jam entries and classics like DOOM and Quake III Arena, playing right on the TV.', href: '/games/' },
  { id: 'music', label: 'Music', description: 'An iTunes-style player for the game soundtracks and songs I work to, playing on across the site.', href: '/apps/music/' },
  { id: 'paint', label: 'Paint', description: 'One shared canvas a day that everyone draws on at once, with a prompt and a replay.', href: '/apps/paint/' },
  { id: 'guestbook', label: 'Guestbook', description: 'Pin a Swapnote-style note for the next visitor, drawn or written and signed with your Mii.', href: '/apps/guestbook/' },
  { id: 'terminal', label: 'Terminal', description: 'A command line over the whole site, with a real Linux to boot and things hidden in it.', href: '/apps/terminal/' },
];
