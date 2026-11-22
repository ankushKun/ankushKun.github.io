// The games on /games/ with everything their channel and page need, from src/data/games.ts and the
// projects they point at.
import { getImage } from 'astro:assets';
import { GAMES, type Game } from '../data/games';
import { getEntries, urlOf } from './content';
import { artPath } from './tiles';

/** Art for games that aren't yours, named after the game: src/assets/games/<id>.webp. */
const ART = import.meta.glob<{ default: ImageMetadata }>('../assets/games/*.webp', { eager: true });

export interface ResolvedGame extends Game {
  label: string;
  description: string;
  href: string;
  /** The channel's art (560 by 315) and the title screen's (1120 by 630). */
  art: string;
  hero: string;
  links: { label: string; url: string }[];
}

export async function getGames(): Promise<ResolvedGame[]> {
  const projects = await getEntries('projects');
  return Promise.all(
    GAMES.map(async (game) => {
      const entry = game.project ? projects.find((p) => p.id === game.project) : undefined;
      if (game.project && !entry) throw new Error(`Game "${game.id}" names project "${game.project}", which does not exist`);
      const label = game.label ?? entry?.data.title ?? game.id;
      const image = entry?.data.cover ?? ART[`../assets/games/${game.id}.webp`]?.default;
      const size = async (width: number, height: number) =>
        image ? (await getImage({ src: image, width, height, fit: 'cover', format: 'webp' })).src : entry ? artPath(entry) : '';
      const links = entry ? [...entry.data.links, { label: `Read about ${label}`, url: urlOf(entry) }] : game.source ? [game.source] : [];
      return {
        ...game,
        label,
        description: game.description ?? entry?.data.description ?? '',
        href: `/games/${game.id}/`,
        art: await size(560, 315),
        hero: await size(1120, 630),
        links,
      };
    }),
  );
}
