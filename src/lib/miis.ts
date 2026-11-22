// Build-time Mii loading: every QR code image in src/data/miis/ becomes a Mii code.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { decodeMii, encodeMii, miiFromQr } from '../components/mii/data';

const DIR = path.resolve('src/data/miis');
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** Decodes a Mii QR code image (3DS, Wii U, Miitomo or Tomodachi Life) into a Mii code. */
export async function miiFromImage(file: string): Promise<string> {
  const { data, info } = await sharp(await readFile(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const qr = jsQR(pixels, info.width, info.height, { inversionAttempts: 'attemptBoth' });
  if (!qr) throw new Error(`No QR code found in ${file}`);
  return encodeMii(await miiFromQr(Uint8Array.from(qr.binaryData)));
}

/** Decoded images by file name, kept until the file changes, so the dev server sees Miis added or swapped. */
const decoded = new Map<string, { mtime: number; code: Promise<string> }>();

/** Every QR image in src/data/miis/, keyed by file name. */
export async function folderMiis() {
  const files = (await readdir(DIR).catch(() => [] as string[])).filter((f) => IMAGE.test(f)).sort();
  const out = new Map<string, string>();
  for (const f of files) {
    const file = path.join(DIR, f);
    const { mtimeMs } = await stat(file);
    let hit = decoded.get(f);
    if (hit?.mtime !== mtimeMs) decoded.set(f, (hit = { mtime: mtimeMs, code: miiFromImage(file) }));
    out.set(f, await hit.code);
  }
  for (const f of decoded.keys()) if (!out.has(f)) decoded.delete(f);
  return out;
}

/** Resolves a Mii reference: a file name in src/data/miis/ or a Mii code. */
export async function resolveMii(ref: string, where: string): Promise<string> {
  const fromFile = (await folderMiis()).get(ref);
  if (fromFile) return fromFile;
  if (decodeMii(ref)) return ref.trim();
  throw new Error(`${where} is neither a QR image in src/data/miis/ nor a valid Mii code`);
}
