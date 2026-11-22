// Recent chat on the plaza: a random few of the room's latest messages, each said by someone under
// the Chat block, with the sender's Mii and name on the bubble, which opens the chat. Messages the
// visitor hasn't seen (newer than their last look at the room, in the chat or here) go ahead of
// everything else, newest first, and so does anything said while they are on the plaza.
// Loaded once the plaza is up, so the relay's library never holds up the opening.
import { inline } from '../chat/format';
import { paths, readMessage, readProfile, type Message } from '../chat/net';
import { portraits, releasePortraits, standIn } from '../chat/portraits';
import { STORE, saw, store } from '../live/store';
import { miiBytes } from '../mii/data';
import type { PlazaPost } from './types';

/** The latest messages a visit picks from, and how many it picks. */
const RECENT = 30;
const PICK = 8;
/** At most this many unseen messages go first. */
const FIRST = 3;
/** For someone who has never looked at the room, anything from the last day is new. */
const DAY = 24 * 60 * 60 * 1000;
/** The room's history arrives as a burst: it is taken as complete once it pauses this long, or after LONGEST. */
const PAUSE = 700;
const LONGEST = 6000;
/** How long to wait for someone's Mii before drawing them a stand-in. */
const PROFILE_WAIT = 2500;

/** Where the posts go: the plaza's bubbles. */
interface Sink {
  mix(posts: PlazaPost[], first: PlazaPost[]): void;
  hurry(post: PlazaPost): void;
}

export class Chatter {
  private readonly chain = paths.messages();
  private readonly messages = new Map<string, Message>();
  /** When each post's message was sent, to note it as seen once it is said. */
  private readonly sent = new Map<PlazaPost, number>();
  private readonly openedAt = Date.now();
  private readonly me = store.get(STORE.uuid);
  private readonly seen: number;
  private settled = false;
  private stopped = false;
  private pause = 0;
  private longest = 0;

  constructor(
    private readonly cube: number,
    private readonly href: string,
    private readonly sink: Sink,
  ) {
    this.seen = Number(store.get(STORE.seen)) || Date.now() - DAY;
    this.chain.map().on((data, key) => this.hear(data, key));
    this.longest = window.setTimeout(() => void this.settle(), LONGEST);
  }

  /** A bubble went up: if it was a message, the visitor has seen it. */
  said(post: PlazaPost) {
    const time = this.sent.get(post);
    if (time) saw(time);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.pause);
    clearTimeout(this.longest);
    this.chain.off();
  }

  private hear(data: unknown, key: string) {
    if (this.stopped) return;
    const m = data ? readMessage(key, data) : null;
    if (!m || m.kind !== 'msg' || m.deleted || !plain(m)) {
      this.messages.delete(key);
      return;
    }
    const known = this.messages.has(key);
    this.messages.set(key, m);
    if (!this.settled) {
      clearTimeout(this.pause);
      this.pause = window.setTimeout(() => void this.settle(), PAUSE);
      return;
    }
    // Said just now, while the plaza is open: new to everyone but whoever said it.
    if (known || m.time < this.openedAt || m.uuid === this.me) return;
    void this.post(m).then((post) => {
      if (this.stopped) return;
      this.sink.hurry(post);
      this.tidy();
    });
  }

  private async settle() {
    if (this.settled || this.stopped) return;
    this.settled = true;
    clearTimeout(this.pause);
    clearTimeout(this.longest);
    const recent = [...this.messages.values()].sort((a, b) => b.time - a.time).slice(0, RECENT);
    const fresh = recent.filter((m) => m.time > this.seen && m.uuid !== this.me).slice(0, FIRST);
    const rest = shuffle(recent.filter((m) => !fresh.includes(m))).slice(0, Math.max(0, PICK - fresh.length));
    if (!fresh.length && !rest.length) return;
    const [first, more] = await Promise.all([Promise.all(fresh.map((m) => this.post(m))), Promise.all(rest.map((m) => this.post(m)))]);
    if (this.stopped) return;
    this.sink.mix([...first, ...more], first);
    this.tidy();
  }

  /** A message as a bubble: the sender's name on its tag and their Mii, with the face they posted it with. */
  private async post(m: Message): Promise<PlazaPost> {
    const mine = m.uuid && m.uuid === this.me ? store.get(STORE.mii) : null;
    const code = (mine && miiBytes(mine) ? mine : m.uuid ? await profile(m.uuid) : null) ?? (await standIn(m.uuid ?? m.nick));
    const shots = code ? await portraits(code) : null;
    const post: PlazaPost = { cube: this.cube, tag: m.nick, text: plain(m), href: this.href };
    if (shots) {
      post.thumb = shots[m.feel] ?? shots[0];
      post.mii = true;
    }
    this.sent.set(post, m.time);
    return post;
  }

  /** The portraits are drawn: their GPU side goes, unless the chat has opened meanwhile and is drawing its own. */
  private tidy() {
    if (location.pathname === '/') releasePortraits();
  }
}

/** Each person's chosen Mii, read once a visit. Null if they have none, or the relay is slow to say. */
const profiles = new Map<string, Promise<string | null>>();
function profile(uuid: string) {
  let code = profiles.get(uuid);
  if (!code) {
    code = new Promise<string | null>((done) => {
      const timer = window.setTimeout(() => done(null), PROFILE_WAIT);
      paths.profile(uuid).once((data) => {
        clearTimeout(timer);
        const c = readProfile(data);
        done(c && miiBytes(c) ? c : null);
      });
    });
    profiles.set(uuid, code);
    // Asked again next time, in case the relay was only slow.
    void code.then((c) => c ?? profiles.delete(uuid));
  }
  return code;
}

/** What a message says, as plain text: its Markdown as the chat shows it, without the marks. */
function plain(m: Message) {
  const el = document.createElement('span');
  inline(el, m.text, () => null);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text && m.action ? `${m.nick} ${text}` : text;
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
