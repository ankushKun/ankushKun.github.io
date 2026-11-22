// The little things that make each note its own on the board, worked out from its id so the page as
// built and the page as it runs agree: how far it leans, the colour of its pin, and its date.
import { PAPERS, type Entry } from './entry';

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const PINS = ['red', 'blue', 'yellow'] as const;

export function lookOf(e: Pick<Entry, 'id' | 'paper'>) {
  const h = hash(e.id);
  return {
    /** Between -1.5 and 1.5 degrees, never quite straight. */
    tilt: `${(((h % 31) - 15) / 10 || 0.4).toFixed(1)}deg`,
    pin: PINS[h % PINS.length],
    paper: PAPERS[e.paper] ?? PAPERS[0],
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "11 Oct", or "11 Oct 2025" from another year. */
export function dateOf(ts: number, now = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}
