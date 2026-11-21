// Build-time data for the home page plaza: cubes from the site nav, speech bubbles from real entries.
import type { PlazaCube, PlazaData, PlazaMii, PlazaPost } from '../components/plaza/types';
import { getImage } from 'astro:assets';
import { CROWD, CUBES, FEATURED, HERO, ME } from '../data/plaza';
import { existsSync } from 'node:fs';
import { AUTHOR, FOOTER_NAV, NAV } from '../site';
import { SECTION_PATH, getEntries, getPage, urlOf, type Entry, type Section } from './content';
import { folderMiis, resolveMii } from './miis';

/** The QR images behind the crowd, for the hover card. */
const QR_IMAGES = import.meta.glob<ImageMetadata>('/src/data/miis/*.{png,jpg,jpeg,webp,gif}', { eager: true, import: 'default' });

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

  const fromSection = async (section: Section, limit: number, keep: (e: Entry) => boolean = () => true) => {
    const cube = cubeOf(SECTION_PATH[section]);
    if (cube < 0) return [];
    const entries = (await getEntries(section)).filter(keep).slice(0, limit);
    return entries.map((e): PlazaPost => ({ cube, tag: cubes[cube].label, text: e.data.title, href: urlOf(e) }));
  };

  const groups = await Promise.all([
    fromSection('blog', 8),
    fromSection('projects', 8, (e) => e.collection === 'projects' && e.data.featured),
    fromSection('timeline', 8),
  ]);

  // What you are up to now is said by your own Mii, under your name, from the About block.
  const aboutCube = cubeOf('/about/');
  if (aboutCube >= 0) {
    const now = await getPage('now');
    groups.push([{ cube: aboutCube, tag: AUTHOR.name.split(' ')[0], text: now.data.description, href: '/now/', me: true }]);
  }

  // Interleave so consecutive bubbles come from different cubes.
  const posts: PlazaPost[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) {
    for (const g of groups) if (g[i]) posts.push(g[i]);
  }

  // A Mii from a QR image is named after its file: "Steve Jobs.png" is Steve Jobs.
  const files = await folderMiis();
  const named = async (code: string, file: string | undefined, fallback: string): Promise<PlazaMii> => {
    const meta = file ? QR_IMAGES[`/src/data/miis/${file}`] : undefined;
    const qr = meta ? (await getImage({ src: meta, width: 188, format: 'png' })).src : undefined;
    return { code, name: file ? file.replace(/\.[^.]+$/, '') : fallback, qr };
  };
  const fileOf = (code: string) => [...files].find(([, c]) => c === code)?.[0];
  const heroCodes = await Promise.all([ME, ...HERO].map((ref, i) => resolveMii(ref, i ? `HERO[${i - 1}]` : 'ME')));
  const hero = await Promise.all(heroCodes.map((code, i) => named(code, fileOf(code), i ? '' : AUTHOR.name.split(' ')[0])));
  const pool = await Promise.all([...files].filter(([, code]) => !heroCodes.includes(code)).map(([file, code]) => named(code, file, '')));

  return { cubes, posts, hero, pool, crowd: CROWD, featured };
}
