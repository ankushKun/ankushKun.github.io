// Build-time Wii U / Miiverse-inspired OG card generator.
// Uses Satori + bundled M PLUS 1p & JetBrains Mono fonts + Sharp, cached in node_modules/.cache.
// Edit OG_THEME below to adjust colors or typography globally for every generated social card.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { AUTHOR, SITE } from '../site';
import { formatDate, type Entry } from './content';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Bump when layout/visual design changes to invalidate the disk cache. */
const TEMPLATE_VERSION = 'v3-wiiu';

/** Wii U TV screen aesthetic: bright pale bezel, glossy white card, sky-blue accent, Mii portrait. */
export const OG_THEME = {
  outerBg: '#E6EEF2',
  surfaceBg: '#FFFFFF',
  border: 'rgba(42, 70, 88, 0.14)',
  hairline: 'rgba(42, 70, 88, 0.10)',
  title: '#232A2E',
  subtitle: '#5A666E',
  muted: '#6E7C84',
  brandBg: '#2FB2E6',
  brandInk: '#232A2E',
};

const SECTION_ACCENTS: Record<string, [string, string]> = {
  BLOG: ['#FF9D52', '#EE4A4F'],
  PROJECT: ['#45D3C6', '#1C6FD0'],
  TIMELINE: ['#5FD16F', '#1F9457'],
  PAGE: ['#62C4FF', '#2380DC'],
};

export interface OgSpec {
  seed: string;
  eyebrow: string;
  meta?: string;
  title: string;
  subtitle?: string;
  footerLeft?: string;
  accent?: [string, string];
}

const require = createRequire(import.meta.url);
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'ankush-og');

let cachedFonts:
  | { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: 'normal' }[]
  | null = null;
let cachedMiiDataUrl: string | null = null;

function loadFont(pkgPath: string): ArrayBuffer {
  const buf = readFileSync(require.resolve(pkgPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function getFonts() {
  if (!cachedFonts) {
    cachedFonts = [
      { name: 'M PLUS 1p', data: loadFont('@fontsource/m-plus-1p/files/m-plus-1p-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'M PLUS 1p', data: loadFont('@fontsource/m-plus-1p/files/m-plus-1p-latin-500-normal.woff'), weight: 500, style: 'normal' },
      { name: 'M PLUS 1p', data: loadFont('@fontsource/m-plus-1p/files/m-plus-1p-latin-700-normal.woff'), weight: 700, style: 'normal' },
      { name: 'M PLUS 1p', data: loadFont('@fontsource/m-plus-1p/files/m-plus-1p-latin-800-normal.woff'), weight: 800, style: 'normal' },
      {
        name: 'JetBrains Mono',
        data: loadFont('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'JetBrains Mono',
        data: loadFont('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'),
        weight: 500,
        style: 'normal',
      },
    ];
  }
  return cachedFonts;
}

async function getMiiAvatar(): Promise<string> {
  if (!cachedMiiDataUrl) {
    const png = await sharp(join(process.cwd(), 'public', 'mii', 'me-happy.webp'))
      .resize(96, 96, { fit: 'cover' })
      .png()
      .toBuffer();
    cachedMiiDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  }
  return cachedMiiDataUrl;
}

function cleanText(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
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

function titleFontSize(len: number): number {
  if (len <= 24) return 68;
  if (len <= 42) return 56;
  if (len <= 64) return 48;
  return 42;
}

export function ogPathForEntry(entry: Entry): string {
  return `/og/${entry.collection}/${entry.id}.png`;
}

export function ogPathForPage(id: string): string {
  return `/og/pages/${id}.png`;
}

export function specForEntry(entry: Entry): OgSpec {
  const year = String(entry.data.date.getUTCFullYear());
  const dateLabel = formatDate(entry.data.date, 'short').toUpperCase();

  let eyebrow: string = entry.collection.toUpperCase();
  let meta = dateLabel;
  let footerItems: string[] = entry.data.tags.slice(0, 3).map((t) => `#${t}`);
  let accent: [string, string] = SECTION_ACCENTS.PAGE;

  switch (entry.collection) {
    case 'blog':
      eyebrow = 'BLOG';
      meta = dateLabel;
      accent = SECTION_ACCENTS.BLOG;
      break;
    case 'projects':
      eyebrow = 'PROJECT';
      meta = entry.data.status === 'archived' ? `${year} · ARCHIVED` : year;
      accent = SECTION_ACCENTS.PROJECT;
      if (entry.data.stack.length > 0) {
        footerItems = entry.data.stack.slice(0, 4);
      }
      break;
    case 'timeline':
      eyebrow = `TIMELINE · ${entry.data.kind.map((k) => k.toUpperCase()).join(' · ')}`;
      meta = dateLabel;
      accent = SECTION_ACCENTS.TIMELINE;
      break;
  }

  return {
    seed: `${entry.collection}/${entry.id}`,
    eyebrow,
    meta,
    title: entry.data.title,
    subtitle: entry.data.description,
    footerLeft: footerItems.join('  ·  ') || AUTHOR.name,
    accent,
  };
}

export function specForPage(id: string, title: string, description: string): OgSpec {
  const isHome = id === 'home';
  const pageAccents: Record<string, [string, string]> = {
    blog: SECTION_ACCENTS.BLOG,
    projects: SECTION_ACCENTS.PROJECT,
    timeline: SECTION_ACCENTS.TIMELINE,
    apps: ['#B184FF', '#6A3FD6'],
    chat: ['#5CBF2A', '#3A9617'],
    about: ['#FFD23F', '#F29A12'],
    mii: ['#FFD23F', '#F29A12'],
    resume: ['#9FB0C8', '#526984'],
  };
  return {
    seed: `pages/${id}`,
    eyebrow: isHome ? 'WARAWARA PLAZA' : title.toUpperCase(),
    meta: isHome ? AUTHOR.worksFor.name.toUpperCase() : SITE.title.toUpperCase(),
    title: isHome ? SITE.title : title,
    subtitle: description,
    footerLeft: isHome ? 'AI Agents  ·  Developer Tools  ·  3DS Homebrew' : `${AUTHOR.name}  ·  ${AUTHOR.worksFor.name}`,
    accent: pageAccents[id] ?? SECTION_ACCENTS.PAGE,
  };
}

export async function renderOgPng(spec: OgSpec): Promise<Buffer> {
  const hash = createHash('sha256')
    .update(JSON.stringify({ v: TEMPLATE_VERSION, theme: OG_THEME, spec }))
    .digest('hex')
    .slice(0, 24);
  const cachePath = join(CACHE_DIR, `${hash}.png`);

  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }

  const title = clampText(spec.title, 96);
  const subtitle = spec.subtitle ? clampText(spec.subtitle, 132) : '';
  const eyebrow = clampText(spec.eyebrow, 32);
  const meta = spec.meta ? clampText(spec.meta, 38) : '';
  const footerLeft = spec.footerLeft ? clampText(spec.footerLeft, 54) : AUTHOR.name;
  const host = SITE.url.replace(/^https?:\/\/|\/$/g, '');
  const [c1, c2] = spec.accent ?? SECTION_ACCENTS.PAGE;
  const miiSrc = await getMiiAvatar();

  const tree = {
    type: 'div',
    props: {
      style: {
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: OG_THEME.outerBg,
        backgroundImage: `radial-gradient(circle at 12% 14%, ${c1}33 0%, transparent 45%), radial-gradient(circle at 88% 88%, ${c2}28 0%, transparent 48%)`,
        fontFamily: 'M PLUS 1p',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              width: '1128px',
              height: '558px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              backgroundColor: OG_THEME.surfaceBg,
              border: `2px solid ${OG_THEME.border}`,
              borderRadius: '34px',
              padding: '44px 54px 36px 54px',
              boxShadow: '0 22px 44px rgba(30, 56, 72, 0.14)',
              overflow: 'hidden',
            },
            children: [
              // Top Nintendo accent bar
              {
                type: 'div',
                props: {
                  style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '12px',
                    backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})`,
                  },
                },
              },
              // Top metadata bar
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          fontFamily: 'M PLUS 1p',
                          fontWeight: 800,
                          fontSize: '18px',
                          letterSpacing: '0.08em',
                          color: '#FFFFFF',
                          backgroundImage: `linear-gradient(180deg, ${c1}, ${c2})`,
                          borderRadius: '999px',
                          padding: '8px 20px',
                        },
                        children: eyebrow,
                      },
                    },
                    meta
                      ? {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              fontFamily: 'JetBrains Mono',
                              fontWeight: 500,
                              fontSize: '18px',
                              letterSpacing: '0.05em',
                              color: OG_THEME.muted,
                            },
                            children: meta,
                          },
                        }
                      : { type: 'div', props: { style: { display: 'flex' } } },
                  ],
                },
              },
              // Center title + description
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '18px',
                    maxWidth: '960px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontSize: `${titleFontSize(title.length)}px`,
                          fontWeight: 800,
                          lineHeight: 1.14,
                          letterSpacing: '-0.025em',
                          color: OG_THEME.title,
                        },
                        children: title,
                      },
                    },
                    subtitle
                      ? {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              fontSize: '24px',
                              fontWeight: 400,
                              lineHeight: 1.45,
                              color: OG_THEME.subtitle,
                              maxWidth: '880px',
                            },
                            children: subtitle,
                          },
                        }
                      : null,
                  ].filter(Boolean),
                },
              },
              // Footer bar with Ankush's Mii
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    borderTop: `2px solid ${OG_THEME.hairline}`,
                    paddingTop: '18px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'JetBrains Mono',
                          fontWeight: 500,
                          fontSize: '18px',
                          color: OG_THEME.muted,
                        },
                        children: footerLeft,
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        },
                        children: [
                          {
                            type: 'img',
                            props: {
                              src: miiSrc,
                              width: 46,
                              height: 46,
                              style: {
                                borderRadius: '999px',
                                backgroundColor: '#E3F1F6',
                                border: `2px solid ${c1}`,
                              },
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: {
                                display: 'flex',
                                fontFamily: 'M PLUS 1p',
                                fontWeight: 800,
                                fontSize: '22px',
                                color: OG_THEME.brandInk,
                              },
                              children: host,
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: getFonts(),
  });

  const png = await sharp(Buffer.from(svg))
    .png({ palette: true, quality: 88, compressionLevel: 9 })
    .toBuffer();

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, png);
  return png;
}
