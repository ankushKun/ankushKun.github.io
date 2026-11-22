// Build-time data for the home page plaza: cubes from the site nav, speech bubbles from every entry.
import type { PlazaCube, PlazaData, PlazaMii, PlazaPost } from '../components/plaza/types';
import { getImage } from 'astro:assets';
import { CROWD, CUBES, FEATURED, HERO, ME, WELCOME } from '../data/plaza';
import { existsSync } from 'node:fs';
import { AUTHOR, FOOTER_NAV, NAV } from '../site';
import { SECTION_PATH, getEntries, isoDate, urlOf, type Section } from './content';
import { folderMiis, resolveMii } from './miis';
import { timelineKindMeta } from './timeline';

export async function getPlazaData(): Promise<PlazaData> {
  const links = [...NAV, ...FOOTER_NAV];
  const sections: PlazaCube[] = Object.entries(CUBES).flatMap(([href, style]) => {
    const label = style.label ?? links.find((l) => l.href === href)?.label;
    if (!label) return [];
    // Painted title art lives in public/plaza/icons/, named after the href.
    const slug = href.replace(/^\/|\/$/g, '').replace(/[/#]+/g, '-');
    const art = existsSync(`public/plaza/icons/${slug}.webp`) ? `/plaza/icons/${slug}.webp` : undefined;
    return [{ ...style, label, href, art }];
  });

  // Posts and projects with cover art, square-cropped, for the feature slots.
  const featured: PlazaCube[] = [];
  for (const section of ['blog', 'projects'] as const) {
    const style = CUBES[SECTION_PATH[section]] ?? CUBES['/blogs/'];
    for (const e of await getEntries(section)) {
      if (!e.data.cover) continue;
      const img = await getImage({ src: e.data.cover, width: 512, height: 512, fit: 'cover', format: 'webp', quality: 80 });
      featured.push({ label: e.data.title, href: urlOf(e), ...style, art: img.src, feature: true });
    }
  }
  // Without JavaScript the slots show the first few; the plaza swaps in a random pick on each visit.
  const cubes: PlazaCube[] = [...featured.slice(0, FEATURED), ...sections];
  const cubeOf = (href: string) => cubes.findIndex((c) => !c.feature && c.href === href);

  // Bubbles: every entry on the site (posts, projects, the timeline), each said by someone near its
  // section's block, in a new order on every visit (bubbles.ts).
  const entries = (await Promise.all((Object.keys(SECTION_PATH) as Section[]).map((s) => getEntries(s)))).flat();
  // A bubble's icon is about 45px, so a 144px square of the entry's cover stays sharp at 3x.
  const posts: PlazaPost[] = (
    await Promise.all(
      entries.map(async (e): Promise<PlazaPost[]> => {
        const cube = cubeOf(SECTION_PATH[e.collection]);
        if (cube < 0) return [];
        const { cover } = e.data;
        const thumb = cover && (await getImage({ src: cover, width: 144, height: 144, fit: 'cover', format: 'webp', quality: 80 })).src;
        // A timeline event is dated by a little calendar page, as on the timeline board.
        const date = e.collection === 'timeline' ? { iso: isoDate(e.data.date), color: timelineKindMeta(e.data.kind[0]).color } : undefined;
        return [{ cube, tag: cubes[cube].label, text: e.data.title, href: urlOf(e), ...(thumb && { thumb }), ...(date && { date }) }];
      }),
    )
  ).flat();

  // Your own Mii opens with a welcome, one of WELCOME picked on each visit, from the About block.
  const aboutCube = cubeOf('/about/');
  const me = AUTHOR.name.split(' ')[0];
  const welcome: PlazaPost[] = aboutCube < 0 ? [] : WELCOME.map((text) => ({ cube: aboutCube, tag: me, text, href: '/about/', me: true }));

  // A Mii from a QR image is named after its file: "Steve Jobs.png" is Steve Jobs.
  const files = await folderMiis();
  const named = (code: string, file: string | undefined, fallback: string): PlazaMii => ({ code, name: file ? file.replace(/\.[^.]+$/, '') : fallback });
  const fileOf = (code: string) => [...files].find(([, c]) => c === code)?.[0];
  const heroCodes = await Promise.all([ME, ...HERO].map((ref, i) => resolveMii(ref, i ? `HERO[${i - 1}]` : 'ME')));
  const hero = heroCodes.map((code, i) => named(code, fileOf(code), i ? '' : AUTHOR.name.split(' ')[0]));
  const pool = [...files].filter(([, code]) => !heroCodes.includes(code)).map(([file, code]) => named(code, file, ''));

  return { cubes, posts, welcome, hero, pool, crowd: CROWD, featured };
}
