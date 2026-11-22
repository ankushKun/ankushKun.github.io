// Social cards (og:image), made at build time for every page and entry without a cover of its own.
// Each one is a moment in the plaza: your Mii up close among friends (a real frame of the plaza,
// src/assets/og/plaza.jpg, from `pnpm og:capture`), with the name tag the plaza shows over a Mii,
// saying the page in a Miiverse post beside them: the section's block art, a name tag pill, the
// title and the description. Satori lays it out, Sharp draws it; finished cards are cached in
// node_modules/.cache.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { AUTHOR, SITE } from '../site';
import { formatDate, readingMinutes, type Entry } from './content';
import frame from '../assets/og/plaza.json';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Bump when the design changes, to throw away cached cards. */
const TEMPLATE_VERSION = 'v5-plaza-post';

/**
 * How the plaza frame sits on the card: scaled up and moved so your Mii stands right of center,
 * the room on the left for the post. `head` is where the top of its head lands (from plaza.json).
 */
const SCALE = 1.45;
const CROP = { left: 0, top: 57 };
const HEAD = { x: Math.round(frame.head[0] * SCALE - CROP.left), y: Math.round(frame.head[1] * SCALE - CROP.top) };
const POST = { left: 48, width: 712 };

const INK = '#2c3134';
const SOFT = '#5f6b72';
const MUTED = '#8a959b';

export interface OgSpec {
  seed: string;
  /** The name on the post's pill: the section, or who is talking. */
  tag: string;
  title: string;
  subtitle?: string;
  /** A short line at the post's foot: a date, a year, a read time. */
  meta?: string;
  /** Block art from public/plaza/icons/, by file name without `.webp`. */
  art: string;
}

const require = createRequire(import.meta.url);
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'ankush-og');

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: 'normal' };
let fonts: Font[] | null = null;
let backdrop: Promise<string> | null = null;
const arts = new Map<string, Promise<string>>();

const bytes = (buf: Buffer) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const dataUrl = (buf: Buffer, type: string) => `data:${type};base64,${buf.toString('base64')}`;

function getFonts(): Font[] {
  fonts ??= [
    ...([400, 500, 700, 800] as const).map((weight) => ({
      name: 'M PLUS 1p',
      data: bytes(readFileSync(require.resolve(`@fontsource/m-plus-1p/files/m-plus-1p-latin-${weight}-normal.woff`))),
      weight,
      style: 'normal' as const,
    })),
    // The plaza's name tags.
    { name: 'Monocraft', data: bytes(readFileSync(join(process.cwd(), 'public/fonts/monocraft-latin.otf'))), weight: 400, style: 'normal' },
  ];
  return fonts;
}

/**
 * The plaza frame cropped to the card, with a pale haze over its left side so the crowd stays
 * behind the post rather than in its way.
 */
function getBackdrop() {
  backdrop ??= (async () => {
    const src = join(process.cwd(), 'src/assets/og/plaza.jpg');
    const wide = Math.round(OG_WIDTH * SCALE);
    const haze = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
        <defs><linearGradient id="h" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#eef5f7" stop-opacity="0.82"/>
          <stop offset="0.5" stop-color="#eef5f7" stop-opacity="0.55"/>
          <stop offset="0.7" stop-color="#eef5f7" stop-opacity="0"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#h)"/>
      </svg>`,
    );
    const jpg = await sharp(src)
      .resize({ width: wide })
      .extract({ left: CROP.left, top: CROP.top, width: OG_WIDTH, height: OG_HEIGHT })
      .composite([{ input: haze }])
      .jpeg({ quality: 88 })
      .toBuffer();
    return dataUrl(jpg, 'image/jpeg');
  })();
  return backdrop;
}

function getArt(name: string) {
  let art = arts.get(name);
  if (!art) {
    const file = join(process.cwd(), 'public/plaza/icons', `${name}.webp`);
    art = sharp(existsSync(file) ? file : join(process.cwd(), 'public/plaza/icons/about.webp'))
      .resize(176, 176)
      .png()
      .toBuffer()
      .then((b) => dataUrl(b, 'image/png'));
    arts.set(name, art);
  }
  return art;
}

function cleanText(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/️/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(raw: string, maxChars: number): string {
  const clean = cleanText(raw);
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?-]+$/, '')}...`;
}

function titleSize(len: number): number {
  if (len <= 22) return 52;
  if (len <= 40) return 44;
  if (len <= 64) return 38;
  return 34;
}

export function ogPathForEntry(entry: Entry): string {
  return `/og/${entry.collection}/${entry.id}.jpg`;
}

export function ogPathForPage(id: string): string {
  return `/og/pages/${id}.jpg`;
}

/** What a generated card shows, for og:image:alt. */
export function ogAlt(title: string): string {
  return `${AUTHOR.name}'s Mii in a Wii U style plaza, beside a post that reads "${cleanText(title)}"`;
}

const ENTRY_LOOK = {
  blog: { tag: 'Blog', art: 'blogs' },
  projects: { tag: 'Project', art: 'projects' },
  timeline: { tag: 'Timeline', art: 'timeline' },
} as const;

export function specForEntry(entry: Entry): OgSpec {
  const { tag, art } = ENTRY_LOOK[entry.collection];
  let meta = formatDate(entry.data.date, 'long');
  if (entry.collection === 'blog') meta = `${meta}  ·  ${readingMinutes(entry)} min read`;
  if (entry.collection === 'projects') meta = `${entry.data.date.getUTCFullYear()}${entry.data.status === 'archived' ? '  ·  Archived' : ''}`;
  return { seed: `${entry.collection}/${entry.id}`, tag, title: entry.data.title, subtitle: entry.data.description, meta, art };
}

/** Block art for pages whose name isn't their art's: the apps' are named after their paths. */
const PAGE_ART: Record<string, string> = { home: 'about', blog: 'blogs', chat: 'apps-chat', music: 'apps-music' };

export function specForPage(id: string, title: string, description: string): OgSpec {
  if (id === 'home') return { seed: 'pages/home', tag: AUTHOR.name, title: SITE.title, subtitle: description, meta: AUTHOR.worksFor.name, art: PAGE_ART.home };
  return { seed: `pages/${id}`, tag: title, title, subtitle: description, art: PAGE_ART[id] ?? id };
}

const div = (style: Record<string, unknown>, children?: unknown) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

export async function renderOg(spec: OgSpec): Promise<Buffer> {
  const plaza = readFileSync(join(process.cwd(), 'src/assets/og/plaza.jpg'));
  const hash = createHash('sha256')
    .update(JSON.stringify({ v: TEMPLATE_VERSION, spec, frame }))
    .update(plaza)
    .digest('hex')
    .slice(0, 24);
  const cachePath = join(CACHE_DIR, `${hash}.jpg`);
  if (existsSync(cachePath)) return readFileSync(cachePath);

  const title = clampText(spec.title, 90);
  const subtitle = spec.subtitle ? clampText(spec.subtitle, 150) : '';
  const tag = clampText(spec.tag, 28);
  const host = SITE.url.replace(/^https?:\/\/|\/$/g, '');
  const [bg, art] = await Promise.all([getBackdrop(), getArt(spec.art)]);
  const firstName = AUTHOR.name.split(' ')[0];

  // Where the post's tail points: your Mii's face.
  const faceY = HEAD.y + 40;

  const tree = div(
    { position: 'relative', width: OG_WIDTH, height: OG_HEIGHT, fontFamily: 'M PLUS 1p', color: INK, backgroundColor: '#e4f0f2' },
    [
      { type: 'img', props: { src: bg, width: OG_WIDTH, height: OG_HEIGHT, style: { position: 'absolute', top: 0, left: 0 } } },
      // The name tag over your Mii, square and see-through in a pixel font, as in the plaza.
      div(
        {
          position: 'absolute',
          left: HEAD.x - 70,
          top: HEAD.y - 150,
          width: 140,
          justifyContent: 'center',
        },
        div({ padding: '2px 12px 6px', backgroundColor: 'rgba(0, 0, 0, 0.42)', color: '#fff', fontFamily: 'Monocraft', fontSize: 30 }, firstName),
      ),
      // The post: a white card with the plaza's soft shadow, its tail pointing at your Mii.
      div(
        {
          position: 'absolute',
          left: POST.left,
          top: 0,
          bottom: 0,
          width: POST.width + 40,
          alignItems: 'center',
        },
        [
          div(
            {
              position: 'relative',
              flexDirection: 'column',
              width: POST.width,
              padding: '44px 44px 34px',
              backgroundColor: '#fbfcfc',
              borderRadius: 40,
              boxShadow: '0 18px 44px rgba(42, 74, 88, 0.26), 0 2px 6px rgba(42, 74, 88, 0.12)',
            },
            [
              // The name on a dark pill over the post's corner, as the plaza's bubbles carry it.
              div(
                {
                  position: 'absolute',
                  top: -22,
                  left: -10,
                  padding: '4px 22px 6px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(66, 70, 72, 0.94)',
                  color: '#fff',
                  fontSize: 24,
                  fontWeight: 500,
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)',
                },
                tag,
              ),
              div({ gap: 30, alignItems: 'flex-start' }, [
                {
                  type: 'img',
                  props: {
                    src: art,
                    width: 132,
                    height: 132,
                    style: { borderRadius: 30, boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.05), 0 6px 14px rgba(42, 74, 88, 0.18)' },
                  },
                },
                div({ flexDirection: 'column', flex: 1, gap: 12 }, [
                  div({ fontSize: titleSize(title.length), fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.02em' }, title),
                  subtitle ? div({ fontSize: 23, lineHeight: 1.42, color: SOFT }, subtitle) : null,
                ].filter(Boolean)),
              ]),
              div({ marginTop: 26, paddingTop: 18, borderTop: '2px solid rgba(42, 74, 88, 0.08)', justifyContent: 'space-between', fontSize: 21, color: MUTED }, [
                div({}, spec.meta ?? ''),
                div({ fontWeight: 800, color: INK }, host),
              ]),
            ],
          ),
          // The tail: a rounded square turned on its corner, half tucked under the post's edge.
          div({
            width: 50,
            height: 50,
            marginLeft: -28,
            marginTop: (faceY - OG_HEIGHT / 2) * 2,
            borderRadius: 9,
            backgroundColor: '#fbfcfc',
            transform: 'rotate(45deg)',
            boxShadow: '5px -5px 10px rgba(42, 74, 88, 0.16)',
          }),
        ],
      ),
    ],
  );

  const svg = await satori(tree as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts: getFonts() });
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, jpg);
  return jpg;
}
