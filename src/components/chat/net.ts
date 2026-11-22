// The chat's side of the GUN relay at gun.ankush.one, which the old site's IRC chat also used, so
// the room and its history carried over. There is no server of our own: every client reads and
// writes the same graph, so everything read from it is checked here before the page sees it.
//
// Nodes (souls are the old site's, joined paths under ROOT):
//   apps/irc/<room>/messages   <time>-<rand> = Message
//   apps/irc/<room>/yeahs      <message key>~<uuid> = 1, or null once taken back
//   apps/irc/<room>            latest = when the room last had a message (ms)
//   apps/irc/profiles          <uuid> = { mii, time }: each person's Mii, kept apart from their
//                              messages so a new Mii shows on everything they have said
//   live/irc/<room>/presence   <uuid> = Presence, rewritten every few seconds while they are here
import Gun from 'gun/gun';

/** PUBLIC_CHAT_RELAY points a build at another relay, a local one for trying changes out. */
const RELAY: string = import.meta.env.PUBLIC_CHAT_RELAY || 'https://gun.ankush.one/gun';
const ROOT = 'ankush-one';

export const ROOM = 'general';
export const MAX_TEXT = 500;
export const MAX_NICK = 16;
/** How far ahead of ours a peer's clock may run. */
const SKEW = 5000;
/** A drawing is a small PNG as a data URL, Miiverse's 320 by 120. */
const MAX_DRAWING = 24000;
/** Klipy's media host: GIFs posted from the old site. */
const GIF_HOSTS = ['static.klipy.com'];

/** The few parts of a GUN chain the chat uses. */
export interface Chain {
  get(key: string): Chain;
  put(value: unknown): Chain;
  map(): Chain;
  on(cb: (data: unknown, key: string, msg: unknown, ev: { off(): void }) => void): Chain;
  once(cb: (data: unknown, key: string) => void): Chain;
  off(): Chain;
}

interface Root extends Chain {
  on(event: 'hi' | 'bye', cb: (this: Link, peer: unknown) => void): Chain;
  on(cb: (data: unknown, key: string, msg: unknown, ev: { off(): void }) => void): Chain;
  back(path: string): unknown;
}

/** A GUN event listener's `this`: the next link in its chain. */
type Link = { to?: { next?: (peer: unknown) => void } };

export type Kind = 'msg' | 'gif' | 'drawing' | 'system';

export interface Message {
  key: string;
  nick: string;
  uuid: string | null;
  text: string;
  time: number;
  /** /me and friends: said as something they do. */
  action: boolean;
  kind: Kind;
  /** 0 to 5, an index into FEELINGS. */
  feel: number;
  /** The GIF's address or the drawing's data URL. */
  media?: string;
  /** A GIF's size, when its sender said, so its space is kept before it loads. */
  dims?: [number, number];
  /** A GIF's MP4 copy, when its sender gave one: played instead of the GIF. */
  video?: string;
  deleted: boolean;
}

export interface Presence {
  uuid: string;
  nick: string;
  lastSeen: number;
  typingUntil: number;
}

let gun: Root | null = null;

function root(): Root {
  // Nothing needs to persist offline, and GUN's local adapter rewrites its whole copy of the graph
  // into one localStorage key after every write.
  gun ??= (Gun as unknown as (opts: object) => Root)({ peers: [RELAY], localStorage: false });
  return gun;
}

const node = (path: string) => root().get(`${ROOT}/${path}`);

export const paths = {
  messages: (room = ROOM) => node(`apps/irc/${room}/messages`),
  yeahs: (room = ROOM) => node(`apps/irc/${room}/yeahs`),
  latest: (room = ROOM) => node(`apps/irc/${room}`).get('latest'),
  presence: (room = ROOM) => node(`live/irc/${room}/presence`),
  profile: (uuid: string) => node('apps/irc/profiles').get(uuid),
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function clampTime(t: unknown) {
  const now = Date.now();
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.min(n, now + SKEW) : now;
}

function parse(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

export function isGifUrl(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > MAX_TEXT) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && GIF_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export const isDrawing = (u: unknown): u is string =>
  typeof u === 'string' && u.length <= MAX_DRAWING && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(u);

/** A message row as a peer wrote it, or null for anything not shaped like one. */
export function readMessage(key: string, data: unknown): Message | null {
  const m = parse(data);
  if (!m) return null;
  const nick = str(m.nick, MAX_NICK);
  const text = str(m.text, MAX_TEXT);
  if (!nick || !text) return null;
  const type = m.type;
  const deleted = type === 'system' && / deleted @.+'s (message|post)$/.test(text);
  let kind: Kind = type === 'system' ? 'system' : 'msg';
  let media: string | undefined;
  let dims: [number, number] | undefined;
  let video: string | undefined;
  if (type === 'gif' && isGifUrl(m.text)) {
    kind = 'gif';
    media = m.text as string;
    const w = Number(m.w);
    const h = Number(m.h);
    if (w > 0 && h > 0 && w <= 4000 && h <= 4000) dims = [Math.round(w), Math.round(h)];
    if (isGifUrl(m.mp4)) video = m.mp4;
  } else if (type === 'drawing' && isDrawing(m.img)) {
    kind = 'drawing';
    media = m.img as string;
  }
  const feel = Number(m.feel);
  return {
    key,
    nick,
    text,
    uuid: str(m.uuid, 64) || null,
    time: clampTime(m.time),
    // A drawing says "posted a drawing" as an action, for the old site's clients; here it's a post.
    action: m.action === true && kind !== 'drawing',
    kind,
    feel: Number.isInteger(feel) && feel >= 0 && feel < 6 ? feel : 0,
    media,
    dims,
    video,
    deleted,
  };
}

export function readPresence(uuid: string, data: unknown): Presence | null {
  const p = parse(data);
  if (!p) return null;
  const nick = str(p.nick, MAX_NICK);
  if (!nick || !p.lastSeen) return null;
  return {
    uuid,
    nick,
    lastSeen: clampTime(p.lastSeen),
    typingUntil: Math.min(Number(p.typingUntil) || 0, Date.now() + 10000),
  };
}

export function readProfile(data: unknown): string | null {
  const p = parse(data);
  const mii = p ? str(p.mii, 512) : '';
  return mii && /^[A-Za-z0-9+/=]+$/.test(mii) ? mii : null;
}

/** A key that sorts by time, as the old site's were. */
export const messageKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** When a message was sent, from its key, without reading it. */
export const keyTime = (key: string) => Number(key.split('-')[0]) || 0;

/**
 * Whether the relay is reachable, as it changes. This GUN build forgets a relay once its socket
 * closes and retries it only once, so while nothing is connected the relay is offered again,
 * backing off to half a minute. Returns a function that stops watching.
 */
export function watchConnection(onChange: (connected: boolean) => void): () => void {
  const g = root();
  let connected = false;
  let stopped = false;
  let delay = 4000;
  let timer = 0;

  const set = (v: boolean) => {
    if (v === connected || stopped) return;
    connected = v;
    onChange(v);
  };
  const anyOpen = () => {
    const peers = (g.back('opt.peers') ?? {}) as Record<string, { wire?: WebSocket }>;
    return Object.values(peers).some((p) => p?.wire?.readyState === 1);
  };
  const revive = () => {
    timer = 0;
    if (stopped || connected) return;
    if (!document.hidden) {
      try {
        const peers = (g.back('opt.peers') ?? {}) as Record<string, unknown>;
        const mesh = g.back('opt.mesh') as { hi?: (peer: object) => void } | undefined;
        if (!peers[RELAY]) mesh?.hi?.({ url: RELAY, id: RELAY });
      } catch {
        // Tried again next round.
      }
      delay = Math.min(delay * 2, 30000);
    }
    timer = window.setTimeout(revive, delay);
  };

  // GUN's events run as a chain: each listener passes the event on, or later ones never hear it.
  g.on('hi', function (this: Link, peer) {
    delay = 4000;
    set(true);
    this.to?.next?.(peer);
  });
  g.on('bye', function (this: Link, peer) {
    this.to?.next?.(peer);
    if (anyOpen()) return;
    set(false);
    if (!timer) timer = window.setTimeout(revive, delay);
  });
  // Already connected from an earlier visit to the page.
  if (anyOpen()) set(true);
  else timer = window.setTimeout(revive, delay);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
