// Slash commands, as the old site's IRC chat had them and then some. Each turns what was typed into
// something to do: post a message, act, change your name, or show a note only you see. Everything
// is posted as plain text (art as a ``` block), so the stored rows stay what every client reads.
//
// One list (`COMMANDS`) drives parsing, /help and the picker that opens as you type a /.

import { FACES, SPARKLE } from './faces';
import { MAX_TEXT } from './net';

export type Command =
  | { do: 'post'; text: string; action?: boolean; name?: string }
  | { do: 'nick'; nick: string }
  | { do: 'clear' }
  | { do: 'note'; text: string };

export type Group = 'chat' | 'face' | 'art' | 'text' | 'chance' | 'act';

export interface Spec {
  name: string;
  group: Group;
  /** What goes after the name, when it takes something. */
  arg?: string;
  /** Shown beside the name in the picker. */
  peek?: string;
  run: (rest: string) => Command;
}

// Art --------------------------------------------------------------------------------------------

/** Pictures, posted as a ``` block so they keep their shape. `peek` stands in for them in the picker. */
const ART: Record<string, { peek: string; art: string }> = {
  cat: {
    peek: '( o.o )',
    art: String.raw`
 /\_/\
( o.o )
 > ^ <`,
  },
  bunny: {
    peek: '(\\_/)',
    art: String.raw`
(\_/)
( •_•)
/ >🍪`,
  },
  owl: {
    peek: '(O,O)',
    art: String.raw`
 ,_,
(O,O)
(   )
-"-"-`,
  },
  penguin: {
    peek: "('v')",
    art: String.raw`
   _
 ('v')
//-=-\\
(\_=_/)
 ^^ ^^`,
  },
  ghost: {
    peek: '(o o)',
    art: String.raw`
 .-.
(o o)
| O \
 \   \
  '~~~'`,
  },
  skull: {
    peek: '(x_x)',
    art: String.raw`
  _____
 /     \
| () () |
 \  ^  /
  |||||`,
  },
  coffee: {
    peek: 'c[_]',
    art: String.raw`
   ( (
    ) )
  .......
  |     |]
  \     /
   '---'`,
  },
  cake: {
    peek: 'i i i',
    art: String.raw`
   i i i
  _|_|_|_
 |~~~~~~~|
 |  ~ ~  |
 |_______|`,
  },
  rocket: {
    peek: '/\\',
    art: String.raw`
    /\
   /  \
   |()|
   |  |
  /|/\|\
    **
    *`,
  },
  heart: {
    peek: '<3',
    art: String.raw`
 .:::.   .:::.
:::::::.:::::::
:::::::::::::::
':::::::::::::'
  ':::::::::'
    ':::::'
      ':'`,
  },
};

/** Keeps someone's words from closing the ``` block their art sits in. */
const plain = (s: string) => s.replace(/`/g, "'").replace(/\s+/g, ' ').trim();

/** `text` broken into lines no wider than `width`, long words cut. */
function wrap(text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(' ')) {
    while (word.length > width) {
      if (line) lines.push(line);
      lines.push(word.slice(0, width));
      word = word.slice(width);
      line = '';
    }
    if (!word) continue;
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const fence = (art: string) => '```\n' + art.replace(/^\n/, '') + '```';

function cowsay(text: string) {
  const lines = wrap(plain(text), 28);
  const w = Math.max(...lines.map((l) => l.length));
  const pad = (l: string) => l.padEnd(w);
  const body =
    lines.length === 1
      ? [`< ${pad(lines[0])} >`]
      : lines.map((l, i) => {
          const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
          return `${a} ${pad(l)} ${b}`;
        });
  return [
    ` ${'_'.repeat(w + 2)}`,
    ...body,
    ` ${'-'.repeat(w + 2)}`,
    String.raw`        \   ^__^`,
    String.raw`         \  (oo)\_______`,
    '            (__)\\       )\\/\\',
    String.raw`                ||----w |`,
    String.raw`                ||     ||`,
  ].join('\n');
}

function box(text: string, width = 30) {
  const lines = wrap(plain(text), width);
  const w = Math.max(...lines.map((l) => l.length));
  const edge = `+${'-'.repeat(w + 2)}+`;
  return [edge, ...lines.map((l) => `| ${l.padEnd(w)} |`), edge].join('\n');
}

function sign(text: string) {
  return [box(text, 22), String.raw` (\_/) ||`, String.raw` (•.•) ||`, String.raw` / >  ||`].join('\n');
}

// Text -------------------------------------------------------------------------------------------

const FLIPPED: Record<string, string> = {
  a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ',
  n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
  '1': 'Ɩ', '2': 'ᄅ', '3': 'Ɛ', '4': 'ㄣ', '5': 'ϛ', '6': '9', '7': 'ㄥ', '8': '8', '9': '6', '0': '0',
  '.': '˙', ',': "'", "'": ',', '"': '„', '?': '¿', '!': '¡', '(': ')', ')': '(', '[': ']', ']': '[',
  '{': '}', '}': '{', '<': '>', '>': '<', '_': '‾', '&': '⅋',
};

const upside = (s: string) => [...s.toLowerCase()].reverse().map((c) => FLIPPED[c] ?? c).join('');

const wide = (s: string) =>
  [...s].map((c) => (c === ' ' ? '\u3000' : c >= '!' && c <= '~' ? String.fromCodePoint(c.codePointAt(0)! + 0xfee0) : c)).join('');

const bubble = (s: string) =>
  [...s]
    .map((c) => {
      const n = c.codePointAt(0)!;
      if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x24d0 + n - 97);
      if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x24b6 + n - 65);
      if (c >= '1' && c <= '9') return String.fromCodePoint(0x2460 + n - 49);
      return c === '0' ? '⓪' : c;
    })
    .join('');

const mock = (s: string) => {
  let up = false;
  return [...s].map((c) => (/[a-z]/i.test(c) ? ((up = !up) ? c.toLowerCase() : c.toUpperCase()) : c)).join('');
};

const owo = (s: string) =>
  s
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiou])/g, 'Ny$1')
    .replace(/ove\b/g, 'uv') + ` ${pick(['owo', 'uwu', '>w<', '^w^'])}`;

/** Ways to say something, from what follows the name. */
const TEXT: Record<string, { peek: string; say: (s: string) => string }> = {
  shout: { peek: 'LOUD', say: (s) => `**${s.toUpperCase()}**` },
  mock: { peek: 'mOcK', say: mock },
  wide: { peek: wide('wide'), say: wide },
  upside: { peek: upside('flip'), say: upside },
  bubble: { peek: bubble('pop'), say: bubble },
  owo: { peek: 'owo', say: owo },
  clap: { peek: '👏', say: (s) => `${s.split(/\s+/).join(' 👏 ')} 👏` },
  sparkle: { peek: '✧', say: (s) => `${SPARKLE[0]} ${s} ${SPARKLE[1]}` },
};

// Chance -----------------------------------------------------------------------------------------

function pick<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

const EIGHT_BALL = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.', 'Most likely.',
  'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', "Don't count on it.", 'My reply is no.',
  'My sources say no.', 'Outlook not so good.', 'Very doubtful.',
];

function roll(rest: string): Command {
  const m = /^(\d{0,2})d(\d{1,4})$/i.exec(rest || 'd6');
  const count = m ? Number(m[1] || 1) : 0;
  const sides = m ? Number(m[2]) : 0;
  if (!count || count > 20 || sides < 2 || sides > 1000) return usage('roll', '2d6');
  const dice = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = dice.reduce((a, b) => a + b, 0);
  const text = count === 1 ? `rolls a d${sides}: **${total}**` : `rolls ${count}d${sides}: **${total}** (${dice.join(', ')})`;
  return { do: 'post', text, action: true };
}

function choose(rest: string): Command {
  const options = rest.split(/\s*,\s*|\s+or\s+/i).filter(Boolean);
  if (options.length < 2) return usage('pick', 'pizza, tacos or ramen');
  return { do: 'post', text: `picks **${pick(options)}** from ${options.join(', ')}`, action: true };
}

// Actions ----------------------------------------------------------------------------------------

/** Things you do, alone or to someone. */
const ACTIONS: Record<string, [solo: string, target: string]> = {
  slap: ['slaps the air dramatically', 'slaps {t} around a bit with a large trout'],
  hug: ['hugs themselves', 'hugs {t} warmly'],
  poke: ['pokes the void', 'pokes {t}'],
  wave: ['waves at everyone', 'waves at {t}'],
  dance: ['busts out some sick dance moves', 'dances with {t}'],
  highfive: ['high-fives the air... awkward', 'high-fives {t}'],
  fistbump: ['fist-bumps the air', 'fist-bumps {t}'],
  pat: ['pats their own head', 'pats {t} on the head'],
  tickle: ['tickles themselves and giggles', 'tickles {t} mercilessly'],
  boop: ['boops their own nose', "boops {t}'s nose"],
  throw: ['throws something at the wall', 'throws something at {t}'],
  bonk: ['bonks themselves on the head', 'bonks {t} with a hammer'],
  kick: ['kicks the wall in frustration', 'kicks {t}!'],
  hit: ['swings at the air', 'hits {t}!'],
  cookie: ['eats a cookie 🍪', 'gives {t} a cookie 🍪'],
  cheer: ['cheers loudly', 'cheers {t} on'],
  stare: ['stares into the distance', 'stares at {t}'],
  facepalm: ['facepalms', 'facepalms at {t}'],
  yeet: ['yeets themselves into the void', 'yeets {t} into the sun'],
  salute: ['salutes', 'salutes {t}'],
};

// The list ---------------------------------------------------------------------------------------

const usage = (name: string, arg: string): Command => ({ do: 'note', text: `Usage: **/${name}** ${arg}` });
const post = (text: string, action = false): Command => ({ do: 'post', text, action });

const BUILT_IN: Spec[] = [
  { name: 'help', group: 'chat', run: () => ({ do: 'note', text: HELP }) },
  { name: 'me', group: 'chat', arg: 'does something', run: (r) => (r ? post(r, true) : usage('me', 'does something')) },
  { name: 'nick', group: 'chat', arg: 'newname', run: (r) => ({ do: 'nick', nick: r }) },
  { name: 'clear', group: 'chat', run: () => ({ do: 'clear' }) },
];

const CHANCE: Spec[] = [
  { name: 'roll', group: 'chance', arg: '2d6', peek: '🎲', run: roll },
  { name: 'coin', group: 'chance', peek: '🪙', run: () => post(`flips a coin: **${pick(['heads', 'tails'])}**`, true) },
  {
    name: '8ball',
    group: 'chance',
    arg: 'question',
    peek: '🎱',
    run: (r) => (r ? post(`asks the magic 8-ball "${r}" 🎱 **${pick(EIGHT_BALL)}**`, true) : usage('8ball', 'question')),
  },
  { name: 'pick', group: 'chance', arg: 'a, b or c', run: choose },
  { name: 'rps', group: 'chance', peek: '✊✋✌️', run: () => post(`throws ${pick(['**rock** ✊', '**paper** ✋', '**scissors** ✌️'])}`, true) },
];

export const COMMANDS: Spec[] = [
  ...BUILT_IN,
  ...Object.entries(ACTIONS).map(([name, [solo, target]]): Spec => ({
    name,
    group: 'act',
    arg: 'someone',
    run: (r) => post(r ? target.replace('{t}', r) : solo, true),
  })),
  ...Object.entries(FACES).map(([name, face]): Spec => ({ name, group: 'face', peek: face, run: (r) => post(r ? `${face} ${r}` : face) })),
  ...Object.entries(ART).map(([name, { peek, art }]): Spec => ({
    name,
    group: 'art',
    peek,
    run: (r) => post(fence(art) + r),
  })),
  { name: 'cowsay', group: 'art', arg: 'text', peek: '(oo)', run: (r) => (r ? post(fence(cowsay(r))) : usage('cowsay', 'text')) },
  { name: 'sign', group: 'art', arg: 'text', peek: '(\\_/)||', run: (r) => (r ? post(fence(sign(r))) : usage('sign', 'text')) },
  { name: 'box', group: 'art', arg: 'text', peek: '+--+', run: (r) => (r ? post(fence(box(r))) : usage('box', 'text')) },
  ...Object.entries(TEXT).map(([name, { peek, say }]): Spec => ({
    name,
    group: 'text',
    arg: 'text',
    peek,
    run: (r) => (r ? post(say(r)) : usage(name, 'text')),
  })),
  ...CHANCE,
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
/** The old chat's other names for the same thing. */
const ALIASES: Record<string, string> = { commands: 'help', flip: 'tableflip', dice: 'roll' };

const names = (group: Group) =>
  COMMANDS.filter((c) => c.group === group)
    .map((c) => `/${c.name}`)
    .join(' ');

export const HELP = [
  '**/me** does something, **/nick** newname, **/clear** empties your screen',
  `**Faces** ${names('face')}`,
  `**Art** ${names('art')}`,
  `**Say it differently** ${names('text')}`,
  `**Chance** ${names('chance')}`,
  `**To someone** ${names('act')}`,
].join('\n');

/** What a line typed into the box asks for. Anything that isn't a command is posted as it is. */
export function parse(line: string): Command {
  const m = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(line);
  if (!m) return { do: 'post', text: line };
  const typed = m[1].toLowerCase();
  const name = ALIASES[typed] ?? typed;
  const spec = BY_NAME.get(name);
  if (!spec) return { do: 'note', text: `There's no **/${typed}**. Try **/help**.` };
  const cmd = spec.run((m[2] ?? '').trim());
  if (cmd.do !== 'post') return cmd;
  if (cmd.text.length > MAX_TEXT) return { do: 'note', text: `That's too long for **/${name}**. Try fewer words.` };
  return { ...cmd, name };
}
