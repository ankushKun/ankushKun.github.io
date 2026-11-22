// Build-time theme-agnostic OG / list thumbnail generator.
// Uses Satori + bundled WOFF fonts + Sharp, with a content-hash disk cache in node_modules/.cache.
// Edit OG_THEME below to adjust colors or typography globally for every generated thumbnail.

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
const TEMPLATE_VERSION = 'v2';

/** Single source of truth for generated thumbnail styling (neutral dark graphite editorial card). */
export const OG_THEME = {
  outerBg: '#0E0F12',
  surfaceBg: '#14161A',
  border: 'rgba(255, 255, 255, 0.10)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  pillBg: 'rgba(255, 255, 255, 0.06)',
  pillBorder: 'rgba(255, 255, 255, 0.14)',
  title: '#F4F4F6',
  subtitle: '#A1A6B0',
  eyebrow: '#D8DCE3',
  muted: '#7D838E',
  motifStroke: 'rgba(255, 255, 255, 0.075)',
  motifDot: 'rgba(255, 255, 255, 0.08)',
  brandMark: '#E4E4E7',
};

export interface OgSpec {
  seed: string;
  eyebrow: string;
  meta?: string;
  title: string;
  subtitle?: string;
  footerLeft?: string;
}

const require = createRequire(import.meta.url);
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'ankush-og');

let cachedFonts:
  | { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: 'normal' }[]
  | null = null;

function loadFont(pkgPath: string): ArrayBuffer {
  const buf = readFileSync(require.resolve(pkgPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function getFonts() {
  if (!cachedFonts) {
    cachedFonts = [
      { name: 'Inter', data: loadFont('@fontsource/inter/files/inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'Inter', data: loadFont('@fontsource/inter/files/inter-latin-600-normal.woff'), weight: 600, style: 'normal' },
      { name: 'Inter', data: loadFont('@fontsource/inter/files/inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
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

/** Deterministic 32-bit FNV-1a hash for quiet geometric variation per slug. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Strip pictographs/emoji so bundled latin fonts never emit missing-glyph boxes. */
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
  if (len <= 24) return 72;
  if (len <= 42) return 60;
  if (len <= 64) return 52;
  return 44;
}

/** Build a quiet architectural background SVG (subtle dot matrix + deterministic geometric motif). */
function buildBackdropSvg(seed: string) {
  const h = hashSeed(seed);
  const variant = h % 4;
  const shiftX = ((h >>> 4) % 5) * 18;
  const shiftY = ((h >>> 8) % 4) * 14;

  // Sparse architectural dot grid on right half so text side stays ultra clean
  const dots: { cx: number; cy: number }[] = [];
  for (let x = 640; x <= 1110; x += 38) {
    for (let y = 44; y <= 530; y += 38) {
      dots.push({ cx: x, cy: y });
    }
  }

  const shapes: Record<string, unknown>[] = dots.map((d) => ({
    type: 'circle',
    props: { cx: d.cx, cy: d.cy, r: 1.25, fill: OG_THEME.motifDot },
  }));

  if (variant === 0) {
    // Concentric subtle arcs anchored bottom-right
    const cx = 1040 + shiftX * 0.4;
    const cy = 470 + shiftY * 0.4;
    for (const r of [140, 220, 300, 380]) {
      shapes.push({
        type: 'circle',
        props: { cx, cy, r, fill: 'none', stroke: OG_THEME.motifStroke, strokeWidth: 1.25 },
      });
    }
    shapes.push({
      type: 'line',
      props: { x1: cx - 420, y1: cy, x2: cx + 100, y2: cy, stroke: OG_THEME.motifStroke, strokeWidth: 1 },
    });
    shapes.push({
      type: 'line',
      props: { x1: cx, y1: cy - 420, x2: cx, y2: cy + 100, stroke: OG_THEME.motifStroke, strokeWidth: 1 },
    });
  } else if (variant === 1) {
    // Nested architectural rectangles on the right
    const bx = 790 + shiftX * 0.5;
    const by = 80 + shiftY * 0.5;
    const rects = [
      { x: bx, y: by, w: 300, h: 300, rx: 12 },
      { x: bx + 54, y: by + 54, w: 240, h: 240, rx: 10 },
      { x: bx + 110, y: by + 110, w: 180, h: 180, rx: 8 },
    ];
    for (const r of rects) {
      shapes.push({
        type: 'rect',
        props: {
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          rx: r.rx,
          fill: 'none',
          stroke: OG_THEME.motifStroke,
          strokeWidth: 1.25,
        },
      });
    }
  } else if (variant === 2) {
    // Precision diagonal coordinate grid lines
    const base = 760 + shiftX;
    for (let i = -2; i <= 4; i++) {
      const offset = i * 64;
      shapes.push({
        type: 'line',
        props: {
          x1: base + offset,
          y1: 0,
          x2: base + offset + 280,
          y2: 574,
          stroke: OG_THEME.motifStroke,
          strokeWidth: 1.1,
        },
      });
    }
    shapes.push({
      type: 'circle',
      props: {
        cx: 960 + shiftX * 0.3,
        cy: 220 + shiftY,
        r: 92,
        fill: 'none',
        stroke: OG_THEME.motifStroke,
        strokeWidth: 1.25,
      },
    });
  } else {
    // Stepped minimal editorial vertical cadence bars
    const bx = 830 + shiftX * 0.4;
    for (let i = 0; i < 6; i++) {
      const barH = 120 + (((h >>> (i * 3)) % 5) * 44);
      shapes.push({
        type: 'rect',
        props: {
          x: bx + i * 44,
          y: 520 - barH,
          width: 26,
          height: barH,
          rx: 4,
          fill: 'none',
          stroke: OG_THEME.motifStroke,
          strokeWidth: 1.25,
        },
      });
    }
  }

  return {
    type: 'svg',
    props: {
      width: 1144,
      height: 574,
      viewBox: '0 0 1144 574',
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
      },
      children: shapes,
    },
  };
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

  switch (entry.collection) {
    case 'blog':
      eyebrow = 'BLOG';
      meta = dateLabel;
      break;
    case 'projects':
      eyebrow = 'PROJECT';
      meta = entry.data.status === 'archived' ? `${year} · ARCHIVED` : year;
      if (entry.data.stack.length > 0) {
        footerItems = entry.data.stack.slice(0, 4);
      }
      break;
    case 'timeline':
      eyebrow = `TIMELINE · ${entry.data.kind.toUpperCase()}`;
      meta = dateLabel;
      break;
  }

  return {
    seed: `${entry.collection}/${entry.id}`,
    eyebrow,
    meta,
    title: entry.data.title,
    subtitle: entry.data.description,
    footerLeft: footerItems.join('  ·  ') || AUTHOR.name,
  };
}

export function specForPage(id: string, title: string, description: string): OgSpec {
  const isHome = id === 'home';
  return {
    seed: `pages/${id}`,
    eyebrow: isHome ? AUTHOR.jobTitle.toUpperCase() : 'PAGE',
    meta: isHome ? AUTHOR.worksFor.name.toUpperCase() : SITE.title.toUpperCase(),
    title: isHome ? SITE.title : title,
    subtitle: description,
    footerLeft: isHome ? 'AI Agents  ·  Developer Tools  ·  3DS Homebrew' : `${AUTHOR.name}  ·  ${AUTHOR.worksFor.name}`,
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
  const footerLeft = spec.footerLeft ? clampText(spec.footerLeft, 58) : AUTHOR.name;
  const host = SITE.url.replace(/^https?:\/\/|\/$/g, '');

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
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              position: 'relative',
              width: '1144px',
              height: '574px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              backgroundColor: OG_THEME.surfaceBg,
              border: `1px solid ${OG_THEME.border}`,
              borderRadius: '18px',
              padding: '48px 56px 40px 56px',
              overflow: 'hidden',
            },
            children: [
              buildBackdropSvg(spec.seed),
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
                          fontFamily: 'JetBrains Mono',
                          fontWeight: 500,
                          fontSize: '18px',
                          letterSpacing: '0.1em',
                          color: OG_THEME.eyebrow,
                          backgroundColor: OG_THEME.pillBg,
                          border: `1px solid ${OG_THEME.pillBorder}`,
                          borderRadius: '8px',
                          padding: '8px 16px',
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
                              fontWeight: 400,
                              fontSize: '18px',
                              letterSpacing: '0.06em',
                              color: OG_THEME.muted,
                            },
                            children: meta,
                          },
                        }
                      : { type: 'div', props: { style: { display: 'flex' } } },
                  ],
                },
              },
              // Center editorial title + description
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '18px',
                    maxWidth: '940px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontSize: `${titleFontSize(title.length)}px`,
                          fontWeight: 700,
                          lineHeight: 1.12,
                          letterSpacing: '-0.035em',
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
                              fontSize: '23px',
                              fontWeight: 400,
                              lineHeight: 1.45,
                              color: OG_THEME.subtitle,
                              maxWidth: '840px',
                            },
                            children: subtitle,
                          },
                        }
                      : null,
                  ].filter(Boolean),
                },
              },
              // Footer bar
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    borderTop: `1px solid ${OG_THEME.hairline}`,
                    paddingTop: '20px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'JetBrains Mono',
                          fontWeight: 400,
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
                          gap: '10px',
                          fontFamily: 'JetBrains Mono',
                          fontWeight: 500,
                          fontSize: '19px',
                          color: OG_THEME.brandMark,
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                width: '8px',
                                height: '8px',
                                borderRadius: '2px',
                                backgroundColor: OG_THEME.brandMark,
                              },
                            },
                          },
                          host,
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
