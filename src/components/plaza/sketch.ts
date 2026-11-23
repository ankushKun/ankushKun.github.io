// Drawings from Paint for the plaza, in the feature block and the bubbles: random days someone drew
// on, each day's strokes on white paper, cropped round what was drawn so the drawing fills the
// picture (square for the block, the canvas's 16:10 for a bubble). Each links to its day in Paint. Loaded once the plaza is up, so the relay's library
// never holds up the opening.
import { dayOf, drawStroke, paths, promptFor, readStroke, utcDay, type Stroke } from '../paint/board';
import type { Chain } from '../live/relay';
import { shuffle } from './rotation';

const PAINT = '/apps/paint/';
/** A node's keys arrive as a burst: it is taken as complete once it pauses this long, or after LONGEST. */
const PAUSE = 700;
const LONGEST = 4000;
/** Days with fewer strokes than this are passed over. */
const LEAST = 3;
/** Room round the drawing, as a share of the picture, and the least height cut from the canvas. */
const MARGIN = 0.08;
const SMALLEST = 240;
/** The feature block's picture, and a bubble's (about 220px wide, sharp at 2x). */
const ART = 512;
const WIDE = { w: 448, h: 280 };

export interface Sketch {
  prompt: string;
  href: string;
  /** The drawing as image URLs: square for the block, wide for a bubble. */
  art: string;
  wide: string;
}

/** Up to `count` drawings from random days, handed to `each` as they are read. Resolves when done. */
export async function sketches(count: number, each: (s: Sketch) => void) {
  const days = shuffle(await gather(paths.boards(), (_data, key) => dayOf(key)));
  let found = 0;
  // Twice as many days as wanted at most, since some are empty or taken down.
  for (const day of days.slice(0, count * 2)) {
    if (found >= count) return;
    if (await takenDown(day)) continue;
    const strokes = await gather(paths.strokes(day), (data, key) => readStroke(key, data, day));
    if (strokes.filter((s) => !s.eraser).length < LEAST) continue;
    found++;
    each({
      prompt: promptFor(day),
      href: day === utcDay() ? PAINT : `${PAINT}#${day}`,
      art: draw(strokes, ART, ART),
      wide: draw(strokes, WIDE.w, WIDE.h),
    });
  }
}

/** Everything a node holds, read once, as `read` makes it (null is skipped). */
function gather<T>(chain: Chain, read: (data: unknown, key: string) => T | null): Promise<T[]> {
  return new Promise((done) => {
    const got = new Map<string, T>();
    let pause = 0;
    const finish = () => {
      clearTimeout(pause);
      clearTimeout(longest);
      chain.off();
      done([...got.values()]);
    };
    const longest = window.setTimeout(finish, LONGEST);
    chain.map().once((data, key) => {
      const v = read(data, key);
      if (v === null) got.delete(key);
      else got.set(key, v);
      clearTimeout(pause);
      pause = window.setTimeout(finish, PAUSE);
    });
  });
}

/** A day before today that a mod took down, as Paint itself hides them. */
function takenDown(day: string): Promise<boolean> {
  if (day === utcDay()) return Promise.resolve(false);
  return new Promise((done) => {
    const timer = window.setTimeout(() => done(false), PAUSE * 2);
    paths.meta(day).once((data) => {
      clearTimeout(timer);
      done(!!Number((data as Record<string, unknown> | null)?.deletedAt));
    });
  });
}

function draw(strokes: Stroke[], w: number, h: number) {
  // The box round what was drawn (the eraser's strokes only take away), in the picture's shape, with a margin.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    if (s.eraser) continue;
    const r = s.width / 2;
    for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i] - r);
      x1 = Math.max(x1, s.pts[i] + r);
      y0 = Math.min(y0, s.pts[i + 1] - r);
      y1 = Math.max(y1, s.pts[i + 1] + r);
    }
  }
  const aspect = w / h;
  const boxH = Math.max(y1 - y0, (x1 - x0) / aspect, SMALLEST) / (1 - MARGIN * 2);
  const boxW = boxH * aspect;
  const left = (x0 + x1) / 2 - boxW / 2;
  const top = (y0 + y1) / 2 - boxH / 2;

  // Strokes on a clear layer first, so the eraser shows the paper through rather than painting on it.
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const g = layer.getContext('2d')!;
  const k = h / boxH;
  g.setTransform(k, 0, 0, k, -left * k, -top * k);
  for (const s of [...strokes].sort((a, b) => a.ts - b.ts)) drawStroke(g, s);

  const paper = document.createElement('canvas');
  paper.width = w;
  paper.height = h;
  const p = paper.getContext('2d')!;
  p.fillStyle = '#fff';
  p.fillRect(0, 0, w, h);
  p.drawImage(layer, 0, 0);
  return paper.toDataURL('image/png');
}
