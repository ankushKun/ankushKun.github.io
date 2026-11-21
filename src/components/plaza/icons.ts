// The picture inside each glass block: a chunky white glyph on a field of color with the section's
// name under it, in the manner of the Wii U's own system icons. Glyphs are vector art on a 100
// unit square; the name is set with the page's font so it matches the bubbles.
import type { IconName, PlazaCube } from './types';

/** Glyph markup for one icon. `c` is the icon's deeper color, for details cut into the white. */
const GLYPHS: Record<IconName, (c: string) => string> = {
  pencil: (c) => `
    <rect x="25" y="15" width="37" height="49" rx="5"/>
    <g fill="${c}" opacity=".5">
      <rect x="31" y="24.500" width="25" height="3.800" rx="1.900"/>
      <rect x="31" y="33.500" width="18" height="3.800" rx="1.900"/>
      <rect x="31" y="42.500" width="12" height="3.800" rx="1.900"/>
    </g>
    <g transform="translate(60.500 43) rotate(38)">
      <path d="M-6.800-25.500h13.600v36.500L0 24-6.800 11z" fill="#fff"/>
      <rect x="-4.800" y="-17.500" width="9.600" height="28" fill="#ffcf3a"/>
      <rect x="-4.800" y="-23.500" width="9.600" height="6" rx="1.500" fill="#ff7d9c"/>
      <rect x="-4.800" y="-18.500" width="9.600" height="2.800" fill="#cfd8e3"/>
      <path d="M-4.800 10.500h9.600L0 20.500z" fill="#f4d7a6"/>
      <path d="M-1.900 16.500h3.800L0 20.500z" fill="#3d4654"/>
    </g>`,
  code: (c) => `
    <rect x="21" y="17" width="58" height="46" rx="7"/>
    <path d="M21 24a7 7 0 0 1 7-7h44a7 7 0 0 1 7 7v5.500H21z" fill="#d9e1eb"/>
    <g fill="${c}" opacity=".65"><circle cx="28.500" cy="23.300" r="1.900"/><circle cx="34.500" cy="23.300" r="1.900"/><circle cx="40.500" cy="23.300" r="1.900"/></g>
    <g fill="none" stroke="${c}" stroke-width="4.400" stroke-linecap="round" stroke-linejoin="round">
      <path d="M41 38.500l-7.500 7.500 7.500 7.500"/><path d="M59 38.500l7.500 7.500-7.500 7.500"/><path d="M53.500 36.500l-7 19"/>
    </g>`,
  flag: () => `
    <ellipse cx="35.500" cy="64.500" rx="13" ry="3.600" opacity=".85"/>
    <rect x="33" y="13" width="5" height="52" rx="2.500"/>
    <path d="M38 17.500c9-4.500 13.500 3 22.500 1.300 4-.8 7.500-2.500 9.500-3.800v25c-2 1.300-5.500 3-9.500 3.800-9 1.700-13.500-5.800-22.500-1.300z"/>`,
  mic: (c) => `
    <rect x="39.500" y="12" width="21" height="35" rx="10.500"/>
    <g fill="${c}" opacity=".4">
      <rect x="44" y="21" width="12" height="2.600" rx="1.300"/><rect x="44" y="27" width="12" height="2.600" rx="1.300"/><rect x="44" y="33" width="12" height="2.600" rx="1.300"/>
    </g>
    <path d="M31.500 36v3a18.500 18.500 0 0 0 37 0v-3" fill="none" stroke="#fff" stroke-width="4.800" stroke-linecap="round"/>
    <rect x="47.600" y="56" width="4.800" height="8"/>
    <rect x="37.500" y="61.500" width="25" height="4.800" rx="2.400"/>`,
  smile: (c) => `
    <circle cx="50" cy="40.500" r="24.500"/>
    <g fill="${c}"><ellipse cx="41.500" cy="36.500" rx="3" ry="4"/><ellipse cx="58.500" cy="36.500" rx="3" ry="4"/></g>
    <path d="M39 46.500q11 10.500 22 0" fill="none" stroke="${c}" stroke-width="3.800" stroke-linecap="round"/>`,
  clock: (c) => `
    <circle cx="50" cy="40.500" r="25"/>
    <g fill="${c}" opacity=".4"><circle cx="50" cy="21.500" r="1.900"/><circle cx="50" cy="59.500" r="1.900"/><circle cx="31" cy="40.500" r="1.900"/><circle cx="69" cy="40.500" r="1.900"/></g>
    <path d="M50 26.500v14l10 6.500" fill="none" stroke="${c}" stroke-width="4.600" stroke-linecap="round" stroke-linejoin="round"/>`,
  doc: (c) => `
    <path d="M29 20a6 6 0 0 1 6-6h22.500L71 27.500V60a6 6 0 0 1-6 6H35a6 6 0 0 1-6-6z"/>
    <path d="M57.500 14v8.500a5 5 0 0 0 5 5H71z" fill="#cdd7e3"/>
    <g fill="${c}" opacity=".55">
      <circle cx="40.500" cy="34.500" r="5.500"/>
      <rect x="50" y="32.600" width="13" height="3.800" rx="1.900"/>
      <rect x="35" y="45.500" width="30" height="3.800" rx="1.900"/>
      <rect x="35" y="54" width="21" height="3.800" rx="1.900"/>
    </g>`,
  gamepad: (c) => `
    <rect x="25" y="12.500" width="50" height="26" rx="5.500"/>
    <rect x="25" y="40.500" width="50" height="26" rx="5.500"/>
    <rect x="31" y="17" width="38" height="17" rx="2.500" fill="${c}" opacity=".7"/>
    <rect x="40.500" y="45" width="19" height="14.500" rx="2" fill="${c}" opacity=".7"/>
    <g fill="${c}" opacity=".6">
      <path d="M31.200 47.500h2.600v2.900h2.900v2.600h-2.900v2.900h-2.600v-2.900h-2.900v-2.600h2.900z"/>
      <circle cx="65" cy="49" r="1.900"/><circle cx="69.500" cy="53.500" r="1.900"/>
    </g>`,
  plane: () => `
    <path d="M21 39.500L79 15 65 67 49.500 52.500 39.500 63l1.500-16z"/>
    <path d="M41 47L79 15 49.500 52.500z" fill="#d3dde8"/>
    <path d="M41 47l8.500 5.500-10 10.500z" fill="#b9c6d4"/>`,
  apps: (c) => `
    <rect x="23" y="15" width="24" height="24" rx="7"/>
    <rect x="53" y="15" width="24" height="24" rx="7"/>
    <rect x="23" y="45" width="24" height="24" rx="7"/>
    <rect x="53" y="45" width="24" height="24" rx="7" fill="${c}" opacity=".35"/>`,
  chat: (c) => `
    <path d="M20 22a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H38l-12 10v-10h-2a4 4 0 0 1-4-4z"/>
    <g fill="${c}" opacity=".6"><circle cx="33" cy="32" r="3.200"/><circle cx="44" cy="32" r="3.200"/><circle cx="55" cy="32" r="3.200"/></g>`,
  music: () => `
    <path d="M44 14l28-6v42a9 9 0 1 1-6-8.500V22l-16 3.500V56a9 9 0 1 1-6-8.500z"/>`,
  envelope: (c) => `
    <rect x="20" y="19" width="60" height="44" rx="7"/>
    <path d="M24.500 25.500L50 45.500l25.500-20" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`,
};

/** Backdrops, in the manner of Wii U software icons: one per section, picked by its place. */
const BACKDROPS = [
  // Sunburst
  (light: string) => Array.from({ length: 16 }, (_, i) => `<path d="M50 40L${50 + 120 * Math.cos((i * Math.PI) / 8)} ${40 + 120 * Math.sin((i * Math.PI) / 8)}L${50 + 120 * Math.cos(((i + 0.5) * Math.PI) / 8)} ${40 + 120 * Math.sin(((i + 0.5) * Math.PI) / 8)}z" fill="${light}" opacity=".22"/>`).join(''),
  // Diagonal stripes
  (light: string) => Array.from({ length: 12 }, (_, i) => `<path d="M${-40 + i * 16} 100L${-10 + i * 16} 0h8L${-32 + i * 16} 100z" fill="${light}" opacity=".2"/>`).join(''),
  // Soft bubbles
  (light: string) => [[18, 20, 14], [80, 16, 10], [88, 70, 18], [12, 78, 11], [60, 92, 8], [40, 8, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${light}" opacity=".28"/>`).join(''),
  // Waves
  (light: string) => [20, 46, 72, 98].map((y) => `<path d="M-5 ${y}q15-10 30 0t30 0 30 0 30 0V${y + 10}q-15 10-30 0t-30 0-30 0-30 0z" fill="${light}" opacity=".2"/>`).join(''),
];

function svg(cube: PlazaCube, size: number, index: number) {
  const [light, deep] = cube.colors;
  const glyph = GLYPHS[cube.icon](deep);
  const backdrop = BACKDROPS[index % BACKDROPS.length]('#fff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs>
      <radialGradient id="field" cx=".5" cy=".35" r=".85"><stop offset="0" stop-color="${light}"/><stop offset=".62" stop-color="${mixColor(light, deep, 0.55)}"/><stop offset="1" stop-color="${deep}"/></radialGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#f3f6fa"/><stop offset="1" stop-color="#d5deea"/></linearGradient>
      <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <filter id="lift" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2.400" stdDeviation="3.200" flood-color="#00142b" flood-opacity=".28"/></filter>
      <mask id="cut"><g fill="#fff">${glyph}</g></mask>
    </defs>
    <rect width="100" height="100" fill="url(#field)"/>
    ${backdrop}
    <rect width="100" height="100" fill="url(#field)" opacity=".25"/>
    <g transform="translate(50 40) scale(0.98) translate(-50 -40)">
      <g filter="url(#lift)"><g fill="url(#ink)">${glyph}</g></g>
      <rect x="0" y="0" width="100" height="100" fill="url(#shine)" mask="url(#cut)" transform="translate(0 6)"/>
    </g>
  </svg>`;
}

/** Blends two hex colors. */
function mixColor(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

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
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(cube, size, index))}`;
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
