// Reads a Mii from a picture of its QR code, in the browser. The /mii/ viewer and the chat share it.
import { miiFromQr } from './data';

/** The 96 Mii bytes in a QR code image (3DS, Wii U, Miitomo or Tomodachi Life). */
export async function miiFromQrImage(image: Blob): Promise<Uint8Array> {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read the image');
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const qr = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (!qr) throw new Error('No QR code found in that image');
  return miiFromQr(Uint8Array.from(qr.binaryData));
}
