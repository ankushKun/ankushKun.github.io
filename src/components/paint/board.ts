// Paint's days and strokes, as they are kept on the relay. There is one canvas per UTC day, so
// everyone is on the same one wherever they are and each stops growing at midnight; only today's
// can be drawn on. The canvas has a fixed size (960 by 600) and every stroke is a polyline in it,
// so everyone agrees where each point is however big their screen. Everything here is the old
// site's format, so every day drawn there still opens.
//
// Nodes (souls under the relay's root, live/relay.ts):
//   apps/paint                      d-<day> = { strokes: link }, written with a day's first stroke,
//                                   so only days someone drew on are ever listed
//   apps/paint/d-<day>/strokes      <ms>-<uuid>-<rand> = Stroke, or null once undone
//   apps/paint/d-<day>/meta         { deletedAt, deletedBy } once a mod took the day down
//   live/paint/presence             <uuid> = who is here, and on which day (session.ts)
//   live/paint/d-<day>/cursors      <uuid> = Cursor, rewritten as they move
import { clampTime, node, parse, str } from '../live/relay';
import { MAX_NICK } from '../live/store';
import { PROMPTS } from './prompts';

export const W = 960;
export const H = 600;
/** Per day: keeps the graph, and a day's replay, bounded. Past it, the day is full. */
export const MAX_STROKES = 600;
/** Per person per day, so one person can't fill the day alone. */
export const MAX_MINE = 200;
export const MAX_POINTS = 400;
/** The pen's widths, in the canvas's own pixels. */
export const SIZES = [2, 4, 9, 18];
/** How far ahead of ours a peer's clock may run, for strokes (they wait out a day's edge). */
const SKEW = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
/** Daily canvases began here; keys dated earlier are junk, not days. */
export const FIRST_DAY = '2026-10-11';

export const PALETTE = [
  { name: 'Black', color: '#2a2f31' },
  { name: 'Grey', color: '#9aa3a8' },
  { name: 'Red', color: '#e0483a' },
  { name: 'Orange', color: '#f5902f' },
  { name: 'Yellow', color: '#f7c62f' },
  { name: 'Green', color: '#5cbf2a' },
  { name: 'Teal', color: '#22b3a6' },
  { name: 'Blue', color: '#2f8fe0' },
  { name: 'Purple', color: '#8a5cd8' },
  { name: 'Pink', color: '#f06fa8' },
  { name: 'Brown', color: '#9a6638' },
  { name: 'White', color: '#ffffff' },
];

export interface Stroke {
  key: string;
  eraser: boolean;
  color: string;
  width: number;
  /** x, y, x, y... in the canvas's pixels. */
  pts: number[];
  ts: number;
  by: string;
  nick: string;
}

export interface Cursor {
  uuid: string;
  x: number;
  y: number;
  time: number;
  color: string;
  width: number;
  eraser: boolean;
  /** The stroke they're drawing right now, not yet put down. */
  live: number[];
}

// Days -------------------------------------------------------------------------------------------

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const shiftDay = (day: string, n: number) => utcDay(dayStart(day) + n * DAY);

export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s)) return false;
  const t = dayStart(s);
  return !Number.isNaN(t) && utcDay(t) === s && s >= FIRST_DAY && s <= utcDay(Date.now() + DAY);
}

export const boardOf = (day: string) => `d-${day}`;
export const dayOf = (board: string) => (board.startsWith('d-') && isDay(board.slice(2)) ? board.slice(2) : null);

export function promptFor(day: string) {
  const n = Math.round(dayStart(day) / DAY);
  const p = PROMPTS[(((n * 37 + 11) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];
  return p.charAt(0).toUpperCase() + p.slice(1);
}

const LABEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const SHORT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/** "Mon 23 Nov", and "Today, Mon 23 Nov" for today. */
export const dayLabel = (day: string) => `${day === utcDay() ? 'Today, ' : ''}${LABEL.format(dayStart(day)).replace(',', '')}`;
/** "23 Nov", or "Today", for a day's thumbnail. */
export const dayShort = (day: string) => (day === utcDay() ? 'Today' : SHORT.format(dayStart(day)));

// The relay --------------------------------------------------------------------------------------

export const paths = {
  boards: () => node('apps/paint'),
  strokes: (day: string) => node(`apps/paint/${boardOf(day)}/strokes`),
  meta: (day: string) => node(`apps/paint/${boardOf(day)}/meta`),
  presence: () => node('live/paint/presence'),
  cursors: (day: string) => node(`live/paint/${boardOf(day)}/cursors`),
};

/** Links a day into the list of days, with its first stroke. The relay ignores a link it holds. */
export function register(day: string) {
  paths.boards().get(boardOf(day)).put({ strokes: { '#': `ankush-one/apps/paint/${boardOf(day)}/strokes` } });
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** Points packed as GUN keeps them, a string, since it can't keep arrays. */
export const packPoints = (pts: number[]) => pts.map((n) => Math.round(n * 10) / 10).join(',');

function unpack(v: unknown, max: number): number[] | null {
  if (typeof v !== 'string' || v.length > max * 2 * 8) return null;
  const pts = v.split(',').map(Number);
  if (pts.length < 2 || pts.length % 2 || pts.some((n) => !Number.isFinite(n) || n < -50 || n > W + 50)) return null;
  return pts.slice(0, max * 2);
}

/** A stroke from what a peer wrote on `day`, or null. */
export function readStroke(key: string, data: unknown, day: string): Stroke | null {
  const d = parse(data);
  if (!d || key.length > 96) return null;
  const pts = unpack(d.pts, MAX_POINTS);
  if (!pts || pts.length < 4) return null;
  const ts = Number(d.ts) || 0;
  // A day only shows strokes dated on it, so nobody adds to a day that's over.
  const start = dayStart(day);
  if (ts > Date.now() + SKEW || ts < start - SKEW || ts >= start + DAY + SKEW) return null;
  return {
    key,
    eraser: d.t === 'eraser',
    color: typeof d.c === 'string' && COLOR.test(d.c) ? d.c : '#2a2f31',
    width: Math.max(1, Math.min(40, Number(d.w) || 4)),
    pts,
    ts,
    by: str(d.by, 64),
    nick: str(d.nm, MAX_NICK),
  };
}

export const writeStroke = (s: Omit<Stroke, 'key'>) => ({
  t: s.eraser ? 'eraser' : 'pencil',
  c: s.color,
  w: s.width,
  pts: packPoints(s.pts),
  by: s.by,
  nm: s.nick,
  ts: s.ts,
});

export const strokeKey = (uuid: string) => `${Date.now()}-${uuid}-${Math.random().toString(36).slice(2, 6)}`;

export function readCursor(uuid: string, data: unknown): Cursor | null {
  const d = parse(data);
  if (!d || uuid.length > 64) return null;
  const x = Number(d.x);
  const y = Number(d.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    uuid,
    x,
    y,
    time: clampTime(d.t),
    color: typeof d.c === 'string' && COLOR.test(d.c) ? d.c : '#2a2f31',
    width: Math.max(1, Math.min(40, Number(d.w) || 4)),
    eraser: d.e === true || d.e === 1,
    live: unpack(d.live, MAX_POINTS) ?? [],
  };
}

// Drawing ----------------------------------------------------------------------------------------

/**
 * Draws a stroke on a canvas sized in the canvas's pixels (any scale already set). The eraser takes
 * strokes off rather than painting white over them, so the paper shows through.
 */
export function drawStroke(g: CanvasRenderingContext2D, s: Pick<Stroke, 'eraser' | 'color' | 'width' | 'pts'>, upto = s.pts.length, eraserInk?: string) {
  const p = s.pts;
  if (p.length < 2) return;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = s.width;
  if (s.eraser && !eraserInk) g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = s.eraser ? (eraserInk ?? '#000') : s.color;
  g.beginPath();
  g.moveTo(p[0], p[1]);
  const n = Math.min(upto, p.length);
  if (n <= 2) g.lineTo(p[0] + 0.01, p[1]);
  // Through the midpoints, so a quick line is a curve and not a run of corners.
  for (let i = 2; i < n - 2; i += 2) g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  if (n > 2) g.lineTo(p[n - 2], p[n - 1]);
  g.stroke();
  g.restore();
}
