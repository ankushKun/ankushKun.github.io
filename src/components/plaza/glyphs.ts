// The art for a block or tile with no painted title art: a chunky white glyph on a field of color,
// in the manner of the Wii U's own system icons. Plain strings, so the build (tiles, entry art) and
// the plaza's canvas share them.
import type { IconName } from './types';

/** Glyph markup for one icon. `c` is the icon's deeper color, for details cut into the white. */
export const GLYPHS: Record<IconName, (c: string) => string> = {
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
  chip: (c) => `
    <rect x="29" y="19" width="42" height="42" rx="7"/>
    ${[0, 1, 2].map((i) => `<rect x="${38.5 + i * 9}" y="11" width="5" height="10" rx="2.5"/><rect x="${38.5 + i * 9}" y="59" width="5" height="10" rx="2.5"/><rect x="21" y="${28.5 + i * 9}" width="10" height="5" rx="2.5"/><rect x="69" y="${28.5 + i * 9}" width="10" height="5" rx="2.5"/>`).join('')}
    <rect x="39" y="29" width="22" height="22" rx="4" fill="${c}" opacity=".5"/>`,
  trophy: (c) => `
    <path d="M27 18h9v5h-5a7 7 0 0 0 7 7v5a12 12 0 0 1-11-12zM73 18h-9v5h5a7 7 0 0 1-7 7v5a12 12 0 0 0 11-12z"/>
    <path d="M34 13h32v17a16 16 0 0 1-32 0z"/>
    <rect x="45.500" y="44" width="9" height="11"/>
    <rect x="35" y="54" width="30" height="9" rx="3.500"/>
    <path d="M50 19.500l2.600 5.300 5.800.8-4.200 4.100 1 5.800-5.200-2.700-5.200 2.700 1-5.800-4.200-4.100 5.800-.8z" fill="${c}" opacity=".55"/>`,
  envelope: (c) => `
    <rect x="20" y="19" width="60" height="44" rx="7"/>
    <path d="M24.500 25.500L50 45.500l25.500-20" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`,
  terminal: (c) => `
    <rect x="19" y="16" width="62" height="48" rx="8"/>
    <rect x="25" y="23" width="50" height="34" rx="4" fill="${c}" opacity=".75"/>
    <path d="M33 34l9 6.5-9 6.5M47 47h13" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  globe: (c) => `
    <circle cx="50" cy="40" r="26"/>
    <g fill="none" stroke="${c}" stroke-width="3.2" opacity=".6">
      <ellipse cx="50" cy="40" rx="12" ry="25"/>
      <path d="M25 40h50M29 28h42M29 52h42"/>
    </g>`,
  camera: (c) => `
    <path d="M35 21l4-6h22l4 6h9a6 6 0 0 1 6 6v31a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V27a6 6 0 0 1 6-6z"/>
    <circle cx="50" cy="42" r="13" fill="${c}" opacity=".68"/>
    <circle cx="50" cy="42" r="7" fill="#fff"/>
    <circle cx="69" cy="30" r="3" fill="${c}" opacity=".6"/>`,
  blocks: (c) => `
    <path d="M50 13l24 12v26L50 63 26 51V25z"/>
    <path d="M50 13l24 12-24 12-24-12z" fill="#fff"/>
    <path d="M50 37l24-12v26L50 63z" fill="${c}" opacity=".28"/>
    <path d="M50 37L26 25v26l24 12z" fill="${c}" opacity=".14"/>`,
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

/**
 * The icon as an SVG document. `centered` drops the glyph to the middle and shrinks it a little,
 * for tiles that carry no name under it and for art that gets cropped to a wide frame.
 */
export function iconSvg(icon: IconName, colors: [string, string], size: number, index: number, centered = false) {
  const [light, deep] = colors;
  const glyph = GLYPHS[icon](deep);
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
    <g transform="${centered ? 'translate(50 50) scale(0.8)' : 'translate(50 40) scale(0.98)'} translate(-50 -40)">
      <g filter="url(#lift)"><g fill="url(#ink)">${glyph}</g></g>
      <rect x="0" y="0" width="100" height="100" fill="url(#shine)" mask="url(#cut)" transform="translate(0 6)"/>
    </g>
  </svg>`;
}

/**
 * A wide channel banner for the Apps page, in the same look as a tile: the gradient field and
 * backdrop pattern across the whole width, and the glossy white glyph low in the middle, leaving the
 * top for the channel's name. Scales to fill any wide box.
 */
export function channelSvg(icon: IconName, colors: [string, string], index: number) {
  const [light, deep] = colors;
  const w = 178;
  const glyph = GLYPHS[icon](deep);
  const backdrop = BACKDROPS[index % BACKDROPS.length]('#fff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 100" width="${w * 3}" height="300" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="field" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="${light}"/><stop offset=".62" stop-color="${mixColor(light, deep, 0.55)}"/><stop offset="1" stop-color="${deep}"/></radialGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#f3f6fa"/><stop offset="1" stop-color="#d5deea"/></linearGradient>
      <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <filter id="lift" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2.400" stdDeviation="3.200" flood-color="#00142b" flood-opacity=".28"/></filter>
      <pattern id="backdrop" width="100" height="100" patternUnits="userSpaceOnUse">${backdrop}</pattern>
      <mask id="cut"><g fill="#fff">${glyph}</g></mask>
    </defs>
    <rect width="${w}" height="100" fill="url(#field)"/>
    <rect width="${w}" height="100" fill="url(#backdrop)"/>
    <rect width="${w}" height="100" fill="url(#field)" opacity=".25"/>
    <g transform="translate(${w / 2} 62) scale(0.58) translate(-50 -40)">
      <g filter="url(#lift)"><g fill="url(#ink)">${glyph}</g></g>
      <rect x="0" y="0" width="100" height="100" fill="url(#shine)" mask="url(#cut)" transform="translate(0 6)"/>
    </g>
  </svg>`;
}

/** Blends two hex colors. */
export function mixColor(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

