// Saves the icon of every site the link buttons point at that has no platform mark of its own
// (src/lib/platforms.ts), so its button shows the site's own icon instead of a globe. Run it after
// adding links: `pnpm favicons`. It writes public/favicons/<host>.png (64px) and
// src/data/favicons.json, which says how each one sits in its badge. Both are committed, so the
// build never goes online.
//
// For each host it reads the home page's icon tags and tries them best first: a touch icon, the
// largest icon, then the usual file names, an .ico last. A file that is not an image (some sites answer every path
// with their HTML) or is under 32px is skipped. A square icon with no see-through corners fills its
// badge; any other sits on a white tile.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { platformFor } from '../src/lib/platforms.ts';
import { BOOKING_URL, SOCIALS } from '../src/site.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const CONTENT = join(ROOT, 'src/content');
const OUT = join(ROOT, 'public/favicons');
const MANIFEST = join(ROOT, 'src/data/favicons.json');
const SIZE = 64;
const UA = 'Mozilla/5.0 (compatible; site-favicons)';
const SELF = 'ankush.one';

/** Every host a link button points at: the socials, the booking link and each `links:` list. */
async function linkHosts() {
  const hosts = new Set();
  const add = (url) => {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host !== SELF && !platformFor(host)) hosts.add(host);
  };
  [BOOKING_URL, ...SOCIALS.map((s) => s.url)].forEach(add);
  for (const file of await readdir(CONTENT, { recursive: true })) {
    if (!file.endsWith('index.md')) continue;
    const text = await readFile(join(CONTENT, file), 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    for (const [, url] of front.matchAll(/^\s*url:\s*["']?(https?:\/\/[^"'\s]+)/gm)) add(url);
  }
  return [...hosts].sort();
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res;
}

/** Icon URLs from a page's <link> tags, best first. */
function iconLinks(html, base) {
  const found = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = tag.match(/\brel=["']?([^"'>]+)/i)?.[1]?.toLowerCase() ?? '';
    const href = tag.match(/\bhref=["']?([^"'\s>]+)/i)?.[1];
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const size = Number(tag.match(/\bsizes=["']?(\d+)/i)?.[1] ?? 0);
    const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(tag.match(/\btype=["']?([^"'>]+)/i)?.[1] ?? '');
    const ico = /\.ico(\?|$)/i.test(href);
    const score = (rel.includes('apple-touch-icon') ? 1000 : 0) + (svg ? 500 : 0) + size - (ico ? 2000 : 0);
    try {
      found.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, score });
    } catch {
      // A broken href is just skipped.
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.url);
}

/**
 * A 32-bit bitmap from an .ico as raw RGBA pixels for sharp: rows run bottom up in BGRA, and the
 * height counts the transparency mask under the picture too.
 */
function bitmap(dib) {
  const width = dib.readInt32LE(4);
  const height = dib.readInt32LE(8) / 2;
  if (dib.readUInt16LE(14) !== 32 || width <= 0 || height !== width) return undefined;
  const start = dib.readUInt32LE(0);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = start + ((height - 1 - y) * width + x) * 4;
      const to = (y * width + x) * 4;
      if (from + 4 > dib.length) return undefined;
      pixels[to] = dib[from + 2];
      pixels[to + 1] = dib[from + 1];
      pixels[to + 2] = dib[from];
      pixels[to + 3] = dib[from + 3];
    }
  }
  return { input: pixels, options: { raw: { width, height, channels: 4 } } };
}

/**
 * The largest picture in an .ico file, which sharp cannot read itself: a PNG inside it as it is, a
 * 32-bit bitmap as raw pixels. Anything that is not an .ico comes back unchanged.
 */
function fromIco(buf) {
  const plain = { input: buf, options: {} };
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return plain;
  let best;
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    if (at + 16 > buf.length) break;
    const size = buf[at] || 256;
    const bytes = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    const data = buf.subarray(offset, offset + bytes);
    if (data.length !== bytes || size <= (best?.size ?? 0)) continue;
    const image = data.readUInt32BE(0) === 0x89504e47 ? { input: data, options: {} } : bitmap(data);
    if (image) best = { size, image };
  }
  return best?.image ?? plain;
}

/** The icon as a 64px PNG, and whether it fills its badge, or undefined when it is unusable. */
async function render(buf) {
  const { input, options } = fromIco(buf);
  let meta;
  try {
    meta = await sharp(input, options).metadata();
  } catch {
    return undefined;
  }
  const vector = meta.format === 'svg';
  if (!vector && Math.min(meta.width ?? 0, meta.height ?? 0) < 32) return undefined;
  const png = await sharp(input, vector ? { density: 384 } : options)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const square = vector || Math.abs((meta.width ?? 0) - (meta.height ?? 0)) <= 1;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const last = SIZE - 1;
  const solidCorners = [alphaAt(1, 1), alphaAt(last - 1, 1), alphaAt(1, last - 1), alphaAt(last - 1, last - 1)].every((a) => a > 245);
  return { png, fill: square && solidCorners };
}

async function iconFor(host) {
  const page = await get(`https://${host}/`);
  const base = page.url;
  const html = await page.text();
  const tries = [...iconLinks(html, base), ...['/apple-touch-icon.png', '/favicon.png', '/favicon.svg', '/favicon.ico'].map((p) => new URL(p, base).href)];
  for (const url of new Set(tries)) {
    try {
      const icon = await render(Buffer.from(await (await get(url)).arrayBuffer()));
      if (icon) return icon;
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

const hosts = await linkHosts();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const manifest = {};
for (const host of hosts) {
  try {
    const icon = await iconFor(host);
    if (!icon) throw new Error('no usable icon');
    await writeFile(join(OUT, `${host}.png`), icon.png);
    manifest[host] = icon.fill ? 'fill' : 'inset';
    console.log(`${host}: ${manifest[host]}`);
  } catch (e) {
    console.log(`${host}: globe (${e.message})`);
  }
}
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
