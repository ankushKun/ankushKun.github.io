// The chat's side of the GUN relay (live/relay.ts), which the old site's IRC chat also used, so the
// room and its history carried over. Everything read from it is checked here before the page sees it.
//
// Nodes (souls are the old site's, joined paths under the relay's root):
//   apps/irc/<room>/messages   <time>-<rand> = Message
//   apps/irc/<room>/yeahs      <message key>~<uuid> = 1, or null once taken back
//   apps/irc/<room>            latest = when the room last had a message (ms)
//   apps/irc/profiles          <uuid> = { mii, time } (relay.ts)
//   live/irc/<room>/presence   <uuid> = Presence, rewritten every few seconds while they are here
import { MAX_NICK } from '../live/store';
import { clampTime, isPng, node, parse, profile, str } from '../live/relay';

export { readProfile, watchConnection, type Chain } from '../live/relay';

export const ROOM = 'general';
export const MAX_TEXT = 500;
/** A drawing is a small PNG as a data URL, Miiverse's 320 by 120. */
const MAX_DRAWING = 24000;
/** Klipy's media host: GIFs posted from the old site. */
const GIF_HOSTS = ['static.klipy.com'];

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

export const paths = {
  messages: (room = ROOM) => node(`apps/irc/${room}/messages`),
  yeahs: (room = ROOM) => node(`apps/irc/${room}/yeahs`),
  latest: (room = ROOM) => node(`apps/irc/${room}`).get('latest'),
  presence: (room = ROOM) => node(`live/irc/${room}/presence`),
  profile,
};

export function isGifUrl(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > MAX_TEXT) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && GIF_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export const isDrawing = (u: unknown): u is string => isPng(u, MAX_DRAWING);

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

/** A key that sorts by time, as the old site's were. */
export const messageKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** When a message was sent, from its key, without reading it. */
export const keyTime = (key: string) => Number(key.split('-')[0]) || 0;
