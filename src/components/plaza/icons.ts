// The picture inside each glass block: a chunky white glyph on a field of color with the section's
// name under it, in the manner of the Wii U's own system icons. Glyphs are vector art on a 100
// unit square; the name is set with the page's font so it matches the bubbles.
import { iconSvg } from './glyphs';
import type { PlazaCube } from './types';

const FONT = '"M PLUS 1p", ui-rounded, system-ui, sans-serif';

/** Draws every cube's icon. Resolves once the art has rasterized and the caption font is in. */
export async function drawIcons(cubes: PlazaCube[], size: number): Promise<HTMLCanvasElement[]> {
  await document.fonts.load(`700 ${Math.round(size * 0.13)}px ${FONT}`).catch(() => undefined);
  return Promise.all(
    cubes.map(async (cube, index) => {
      // Painted art when the section has some; like a Wii U menu icon it carries no name (the name
      // shows on a tag when the block is pointed at). The drawn fallback glyph keeps its name.
      let img = new Image();
      let painted = false;
      if (cube.art) {
        img.src = cube.art;
        painted = await img.decode().then(() => true, () => false);
      }
      if (!painted) {
        img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(cube.icon, cube.colors, size, index))}`;
        await img.decode();
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('2D canvas is unavailable');
      g.drawImage(img, 0, 0, size, size);
      if (painted) return canvas;
      // The name: heavy white letters lifted off the art by a soft shadow. Shrunk only if it would
      // crowd the edges.
      let px = size * 0.15;
      g.font = `800 ${px}px ${FONT}`;
      const wide = g.measureText(cube.label).width;
      if (wide > size * 0.7) px *= (size * 0.7) / wide;
      g.font = `800 ${px}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.lineJoin = 'round';
      const x = size / 2;
      const y = size * 0.835;
      g.shadowColor = 'rgba(0, 20, 43, 0.38)';
      g.shadowBlur = size * 0.03;
      g.shadowOffsetY = size * 0.012;
      const fill = g.createLinearGradient(0, y - px * 0.8, 0, y);
      fill.addColorStop(0, '#fff');
      fill.addColorStop(1, '#dfe8f2');
      g.fillStyle = fill;
      g.fillText(cube.label, x, y);
      return canvas;
    }),
  );
}

/** A small copy of an icon as an image URL, for the bubbles. */
export function thumb(icon: HTMLCanvasElement, size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')?.drawImage(icon, 0, 0, size, size);
  return canvas.toDataURL();
}
