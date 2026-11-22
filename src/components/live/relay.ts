// The GUN relay at gun.ankush.one that every live app talks to (the chat, Paint, the Guestbook),
// over one connection for the whole visit. There is no server of our own: every client reads and
// writes the same graph, so each app checks what it reads before the page sees it, with the
// helpers here. Souls are the old site's: a path under ROOT, read directly rather than chained.
//
// Shared nodes:
//   apps/irc/profiles   <uuid> = { mii, time }: each person's Mii, used by every live app
import Gun from 'gun/gun';

/** PUBLIC_CHAT_RELAY points a build at another relay, a local one for trying changes out. */
export const RELAY: string = import.meta.env.PUBLIC_CHAT_RELAY || 'https://gun.ankush.one/gun';
const ROOT = 'ankush-one';

/** How far ahead of ours a peer's clock may run. */
export const SKEW = 5000;

/** The few parts of a GUN chain the live apps use. */
export interface Chain {
  get(key: string): Chain;
  put(value: unknown, ack?: (ack: { err?: string; ok?: unknown }) => void): Chain;
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

let gun: Root | null = null;

function root(): Root {
  // Nothing needs to persist offline, and GUN's local adapter rewrites its whole copy of the graph
  // into one localStorage key after every write.
  gun ??= (Gun as unknown as (opts: object) => Root)({ peers: [RELAY], localStorage: false });
  return gun;
}

/** The node at `path` under the site's root. */
export const node = (path: string) => root().get(`${ROOT}/${path}`);

/** Someone's Mii, kept apart from what they post so a new Mii shows on everything they did. */
export const profile = (uuid: string) => node('apps/irc/profiles').get(uuid);

/** A string field cut to `max`, or '' for anything else. */
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A time a peer gave, no later than a little past now; now if it gave none. */
export function clampTime(t: unknown) {
  const now = Date.now();
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.min(n, now + SKEW) : now;
}

/** A node's fields, whether GUN gave them as an object or the old site wrote them as JSON. */
export function parse(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      const v = JSON.parse(data) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** A Mii code from a profile node, or null. */
export function readProfile(data: unknown): string | null {
  const p = parse(data);
  const mii = p ? str(p.mii, 512) : '';
  return mii && /^[A-Za-z0-9+/=]+$/.test(mii) ? mii : null;
}

export const isPng = (u: unknown, max: number): u is string =>
  typeof u === 'string' && u.length <= max && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(u);

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
