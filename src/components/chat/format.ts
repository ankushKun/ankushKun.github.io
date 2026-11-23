// What people type, drawn safely: a little Markdown (bold, italic, strike, code), @mentions and
// links, always built as DOM nodes so nothing anyone writes is ever read as HTML.

import { LITERALS } from './faces';

type Rule = { re: RegExp; make: (m: RegExpExecArray, mention: Mentioner) => Node };
export type Mentioner = (nick: string) => HTMLElement | null;

const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const wrap = (tag: string) => (m: RegExpExecArray, mention: Mentioner) => {
  const e = el(tag);
  inline(e, m[1], mention);
  return e;
};

/** Faces from the slash commands (or typed by hand), longest first so none is cut short. */
const FACE = new RegExp(
  [...LITERALS]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
);

// First match wins, earliest in the text first; at the same place, the rule higher up.
const RULES: Rule[] = [
  { re: FACE, make: (m) => document.createTextNode(m[0]) },
  { re: /```([\s\S]+?)```/, make: (m) => el('pre', undefined, m[1].replace(/^\n/, '')) },
  { re: /`([^`\n]+)`/, make: (m) => el('code', undefined, m[1]) },
  {
    re: /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/,
    make: (m) => {
      const a = el('a', undefined, m[0]) as HTMLAnchorElement;
      a.href = m[0];
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow ugc';
      return a;
    },
  },
  { re: /\*\*([^*\n]+)\*\*/, make: wrap('strong') },
  { re: /__([^_\n]+)__/, make: wrap('strong') },
  { re: /~~([^~\n]+)~~/, make: wrap('s') },
  { re: /\*([^*\n]+)\*/, make: wrap('em') },
  { re: /(?<![\w@])_([^_\n]+)_(?!\w)/, make: wrap('em') },
  {
    re: /(?<![\w@])@([\w.-]{1,16})/,
    make: (m, mention) => mention(m[1]) ?? document.createTextNode(m[0]),
  },
];

/** Appends `text` to `into`, formatted. */
export function inline(into: Node, text: string, mention: Mentioner) {
  let rest = text;
  while (rest) {
    let best: { rule: Rule; m: RegExpExecArray } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) {
      into.appendChild(document.createTextNode(rest));
      return;
    }
    if (best.m.index) into.appendChild(document.createTextNode(rest.slice(0, best.m.index)));
    into.appendChild(best.rule.make(best.m, mention));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
}

/** Every @name in a message, for knowing who it calls. */
export const mentionsIn = (text: string) => [...text.matchAll(/(?<![\w@])@([\w.-]{1,16})/g)].map((m) => m[1].toLowerCase());

/** When, beside a name: "Just now", "5 min ago", then the time of day (the day has its divider). */
export function stamp(time: number, now = Date.now()) {
  const s = Math.max(0, (now - time) / 1000);
  if (s < 45) return 'Just now';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A day's name for its divider: Today, Yesterday, or the date. */
export function dayLabel(time: number, now = Date.now()) {
  const d = new Date(time);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
