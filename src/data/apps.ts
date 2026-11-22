// The apps on /apps/, in order. Each has an anchor (#id) the plaza's blocks link to, and a tile
// from CUBES in plaza.ts or TILES in sections.ts keyed by `/apps/#<id>`. Set `href` once an app
// is live.
export interface App {
  id: string;
  label: string;
  description: string;
  href?: string;
}

export const APPS: App[] = [
  { id: 'games', label: 'Games', description: 'A folder of small games.' },
  { id: 'irc-chat', label: 'Chat', description: 'A chat room where everyone posts as their Mii, as on Miiverse.', href: '/apps/chat/' },
  { id: 'music', label: 'Music', description: 'A player for the mixes I listen to.' },
  { id: 'paint', label: 'Paint', description: 'A shared canvas to draw on together in real time.' },
  { id: 'guestbook', label: 'Guestbook', description: 'Sign it and see who has passed through.' },
  { id: 'terminal', label: 'Terminal', description: 'A command line for the site.' },
];
