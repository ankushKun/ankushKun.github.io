// Mii data in the 3DS / Wii U format (FFLStoreData, 96 bytes): the bytes inside every Mii QR code.
// No DOM and no three.js, so the build and the browser share it.

/** Size of one Mii (FFLStoreData / Ver3StoreData). */
export const MII_SIZE = 96;

/** Fields read straight from the Mii bytes. */
export interface MiiInfo {
  name: string;
  creator: string;
  /** 0 male, 1 female. */
  gender: 0 | 1;
  /** Index into the 12 favorite colors. */
  favoriteColor: number;
  /** 0..127, 64 is the Mii Maker default. */
  height: number;
  /** 0..127, 64 is the Mii Maker default. */
  build: number;
}

// AES-CCM key Nintendo uses for Mii QR codes on 3DS, Wii U and Miitomo.
const QR_KEY = new Uint8Array([0x59, 0xfc, 0x81, 0x7e, 0x64, 0x46, 0xea, 0x61, 0x90, 0x34, 0x7b, 0x20, 0xe9, 0xbd, 0xce, 0x52]);
const QR_NONCE = 8;
const QR_CIPHER = 0x58;
const QR_TAG = 16;

/**
 * Decrypts the raw bytes of a Mii QR code into 96 bytes of Mii data. QR codes from Tomodachi Life
 * and other games carry extra data after the Mii; it is ignored.
 */
export async function miiFromQr(payload: Uint8Array): Promise<Uint8Array> {
  if (payload.length < QR_NONCE + QR_CIPHER + QR_TAG) throw new Error(`Not a Mii QR code (${payload.length} bytes)`);
  const nonce = payload.slice(0, QR_NONCE);
  // CCM payload blocks use counter A1 = [L-1 = 2][nonce + 4 zero bytes][counter = 1].
  const counter = new Uint8Array(16);
  counter[0] = 2;
  counter.set(nonce, 1);
  counter[15] = 1;
  const key = await crypto.subtle.importKey('raw', QR_KEY, 'AES-CTR', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 24 }, key, payload.slice(QR_NONCE, QR_NONCE + QR_CIPHER)),
  );
  const mii = new Uint8Array(MII_SIZE);
  mii.set(plain.subarray(0, 12), 0);
  mii.set(nonce, 12);
  mii.set(plain.subarray(12), 20);
  if (!checksumOk(mii)) throw new Error('Not a Mii QR code (checksum mismatch)');
  return mii;
}

/** CRC-16/XMODEM over the first 94 bytes, stored big endian in the last two. */
function crc16(data: Uint8Array) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function checksumOk(mii: Uint8Array) {
  return mii.length === MII_SIZE && crc16(mii.subarray(0, MII_SIZE - 2)) === ((mii[94] << 8) | mii[95]);
}

const utf16 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};

export function miiInfo(mii: Uint8Array): MiiInfo {
  const flags = mii[0x18] | (mii[0x19] << 8);
  return {
    name: utf16(mii.subarray(0x1a, 0x2e)),
    creator: utf16(mii.subarray(0x48, 0x5c)),
    gender: (flags & 1) as 0 | 1,
    favoriteColor: Math.min(11, (flags >> 10) & 0xf),
    height: mii[0x2e] & 0x7f,
    build: mii[0x2f] & 0x7f,
  };
}

/** A Mii code is the 96 Mii bytes in base64. It is what `src/data/plaza.ts` stores. */
export function encodeMii(mii: Uint8Array) {
  let s = '';
  for (const b of mii) s += String.fromCharCode(b);
  return btoa(s);
}

/** Reads a Mii code (base64 or hex of the 96 bytes). Returns null when it is not a valid Mii. */
export function decodeMii(code: string): Uint8Array | null {
  const t = code.trim().replace(/\s+/g, '');
  let bytes: Uint8Array;
  if (/^[0-9a-f]+$/i.test(t) && t.length === MII_SIZE * 2) {
    bytes = Uint8Array.from(t.match(/../g) ?? [], (h) => parseInt(h, 16));
  } else {
    try {
      bytes = Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return checksumOk(bytes) ? bytes : null;
}

/** Size of an FFLiCharInfo: how FFL describes a Mii it made itself (random Miis, the chat's). */
export const CHARINFO_SIZE = 288;

/**
 * A Mii code's bytes: the 96 bytes of a QR code Mii, or a CharInfo for Miis made on the spot,
 * which FFL draws as they are. Null for anything else.
 */
export function miiBytes(code: string): Uint8Array | null {
  const mii = decodeMii(code);
  if (mii) return mii;
  try {
    const bytes = Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0));
    return bytes.length === CHARINFO_SIZE ? bytes : null;
  } catch {
    return null;
  }
}

/** Wii U favorite colors, used for shirts. Raw sRGB, as FFL shades them. */
export const FAVORITE_COLORS = [
  0xd21e14, 0xff6e19, 0xffd820, 0x78d220, 0x007830, 0x0a48bc, 0x3caade, 0xf55a7d, 0x7328ad, 0x483818, 0xe0e0e0, 0x181814,
];

/** Wii U pants: gray for everyone, blue for your own Mii. */
export const PANTS = { gray: 0x40474e, blue: 0x28407a, red: 0x702015, gold: 0xc0a030 };
