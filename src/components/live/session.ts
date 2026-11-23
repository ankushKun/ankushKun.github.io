// Who you are in a live app and who else is there, for the apps built after the chat (Paint, the
// Guestbook): your id, name and Mii from store.ts, the gate (gate.ts) that asks for them, presence
// on the app's own node, and everyone's Mii on their faces. The chat keeps its own copy of this, with
// feelings and typing on top.
import { CHAT_MODS } from '../../site';
import { identify, track } from '../../scripts/analytics';
import { play } from '../../scripts/sfx';
import { miiBytes } from '../mii/data';
import { portraits, randomMiiCode, releasePortraits, standIn } from '../chat/portraits';
import { mountGate } from './gate';
import { STORE, agreed, cleanNick, store } from './store';
import { clampTime, parse, profile, readProfile, str, type Chain } from './relay';
import { MAX_NICK } from './store';

/** Presence is rewritten this often, and someone silent for TIMEOUT has gone. */
const BEAT = 5000;
const TIMEOUT = 12000;

export interface Here {
  uuid: string;
  nick: string;
  lastSeen: number;
  /** Whatever else the app said about them (`extra` below), as they wrote it. */
  data: Record<string, unknown>;
}

/**
 * Each person's colour: a hue from their id, so it stays when they change their name. Lightness and
 * chroma come from each app's CSS.
 */
export function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export interface Session {
  readonly me: { uuid: string; nick: string; mii: string; joined: boolean };
  /** Everyone here now, you included once you're in. */
  readonly online: Map<string, Here>;
  /** In under a name in CHAT_MODS. The relay has no accounts, so this is moderation by courtesy. */
  isMod(): boolean;
  /** Resolves once you're in, opening the gate first if you aren't. */
  ensure(): Promise<void>;
  /** Puts the gate away without coming in, as when the sheet it stood in is closed. */
  closeGate(): void;
  leave(): void;
  /** A face showing someone's Mii, or a stand-in made from `seed` if they never chose one. */
  face(uuid: string | null, seed?: string | null, cls?: string): HTMLElement;
  /** Puts Miis on faces already on the page (`.face` with data-uuid or data-seed) inside `el`. */
  paintFaces(el: ParentNode): void;
  /** Says you're here now, with the app's extra fields. */
  announce(): void;
  destroy(): void;
}

export function mountSession(
  root: HTMLElement,
  opts: {
    app: 'paint' | 'guestbook';
    /** Where presence lives, or none for an app that doesn't show who is there. */
    presence?: Chain;
    /** The gate stands over the app until you're in (Paint), rather than only when asked (the Guestbook). */
    gateFirst: boolean;
    /** What the gate keeps out of reach while it is up. */
    behind: HTMLElement[];
    /** More fields for your presence. */
    extra?: () => Record<string, unknown>;
    /** You came in or went, or someone did. */
    onChange?: () => void;
  },
): Session {
  const me = {
    uuid: store.get(STORE.uuid) ?? crypto.randomUUID(),
    nick: '',
    mii: store.get(STORE.mii) ?? '',
    joined: false,
  };
  store.set(STORE.uuid, me.uuid);

  const online = new Map<string, Here>();
  const profiles = new Map<string, string | null>();
  const chains: Chain[] = [];
  const timers: number[] = [];
  let waiting: (() => void)[] = [];
  let stopped = false;

  // Faces ----------------------------------------------------------------------------------------

  const codeFor = (uuid: string | null) => (uuid === me.uuid ? me.mii || null : uuid ? (profiles.get(uuid) ?? null) : null);

  function paint(face: HTMLElement) {
    const img = face.querySelector('img');
    if (!img) return;
    const uuid = face.dataset.uuid ?? null;
    const code = codeFor(uuid);
    const seed = face.dataset.seed;
    const token = code ?? `seed:${seed ?? ''}`;
    face.dataset.code = token;
    const show = (c: string | null) => {
      if (!c) return img.removeAttribute('src');
      void portraits(c).then((shots) => {
        if (face.dataset.code !== token) return;
        if (!shots) return img.removeAttribute('src');
        img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
        img.src = shots[0];
      });
    };
    if (code) show(code);
    else if (seed) void standIn(seed).then((c) => face.dataset.code === token && show(c));
    else img.removeAttribute('src');
  }

  const repaint = (uuid: string) => {
    for (const f of root.querySelectorAll<HTMLElement>(`[data-uuid="${CSS.escape(uuid)}"]`)) paint(f);
  };

  function follow(uuid: string | null) {
    if (!uuid || uuid === me.uuid || profiles.has(uuid) || stopped) return;
    profiles.set(uuid, null);
    const chain = profile(uuid);
    chains.push(chain);
    chain.on((data) => {
      const code = readProfile(data);
      if (code === profiles.get(uuid) || (code && !miiBytes(code))) return;
      profiles.set(uuid, code);
      repaint(uuid);
    });
  }

  function face(uuid: string | null, seed: string | null = uuid, cls = 'face') {
    const span = document.createElement('span');
    span.className = cls;
    if (uuid) span.dataset.uuid = uuid;
    if (seed) span.dataset.seed = seed;
    span.appendChild(document.createElement('img')).alt = '';
    follow(uuid);
    paint(span);
    return span;
  }

  function paintMine() {
    for (const f of root.querySelectorAll<HTMLElement>('[data-face="me"]')) {
      f.dataset.uuid = me.uuid;
      paint(f);
    }
    repaint(me.uuid);
  }

  function saveProfile() {
    if (me.joined && me.mii) profile(me.uuid).put({ mii: me.mii, time: Date.now() });
  }

  async function newMii() {
    const code = await randomMiiCode();
    if (!code || stopped) return;
    me.mii = code;
    store.set(STORE.mii, code);
    saveProfile();
    paintMine();
  }

  // Presence -------------------------------------------------------------------------------------

  function announce() {
    if (!me.joined || !opts.presence) return;
    opts.presence.get(me.uuid).put({ ...opts.extra?.(), nick: me.nick, uuid: me.uuid, lastSeen: Date.now() });
  }

  function goodbye() {
    if (me.joined) opts.presence?.get(me.uuid).put(null);
  }

  function onPresence(data: unknown, uuid: string) {
    const p = parse(data);
    const nick = p ? str(p.nick, MAX_NICK) : '';
    if (!p || !nick || !p.lastSeen || uuid.length > 64) {
      if (online.delete(uuid)) opts.onChange?.();
      return;
    }
    const lastSeen = clampTime(p.lastSeen);
    if (Date.now() - lastSeen > TIMEOUT || (online.size > 300 && !online.has(uuid))) return;
    online.set(uuid, { uuid, nick, lastSeen, data: p });
    follow(uuid);
    opts.onChange?.();
  }

  const taken = (nick: string) => {
    const now = Date.now();
    return [...online.values()].some((p) => p.uuid !== me.uuid && p.nick.toLowerCase() === nick.toLowerCase() && now - p.lastSeen < TIMEOUT);
  };

  // Coming in and going --------------------------------------------------------------------------

  const gate = mountGate(root.querySelector<HTMLElement>('[data-gate]')!, {
    enter: join,
    shuffle: () => void newMii(),
    behind: opts.behind,
  });

  function join(raw: string): string | null {
    const nick = cleanNick(raw);
    if (!nick) {
      play('nope');
      return 'Pick a name first.';
    }
    if (taken(nick)) {
      play('nope');
      return `Someone here is already called ${nick}.`;
    }
    me.nick = nick;
    me.joined = true;
    store.set(STORE.nick, nick);
    identify(me.uuid, nick);
    track('live_joined', { app: opts.app });
    saveProfile();
    announce();
    gate.close();
    root.dataset.state = 'in';
    const go = waiting;
    waiting = [];
    for (const done of go) done();
    opts.onChange?.();
    return null;
  }

  function leave() {
    goodbye();
    online.delete(me.uuid);
    me.joined = false;
    store.set(STORE.nick, null);
    root.dataset.state = 'out';
    if (opts.gateFirst) gate.open();
    opts.onChange?.();
  }

  // Start ------------------------------------------------------------------------------------------

  root.dataset.state = 'out';
  if (opts.presence) {
    chains.push(opts.presence);
    opts.presence.map().on((data, uuid) => onPresence(data, uuid));
    timers.push(
      window.setInterval(announce, BEAT),
      window.setInterval(() => {
        const now = Date.now();
        let gone = false;
        for (const [uuid, p] of online) if (now - p.lastSeen > TIMEOUT && uuid !== me.uuid) gone = online.delete(uuid) || gone;
        if (gone) opts.onChange?.();
      }, BEAT),
    );
  }
  const onVisible = () => document.hidden || announce();
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('pagehide', goodbye);

  if (me.mii && miiBytes(me.mii)) paintMine();
  else void newMii();

  // Back with a name and the agreement: straight in, after the first burst of presence so a name
  // someone else has taken isn't taken twice.
  const saved = store.get(STORE.nick);
  if (saved && agreed()) {
    timers.push(
      window.setTimeout(() => {
        const why = join(saved);
        if (why && opts.gateFirst) gate.open(why);
      }, opts.presence ? 900 : 0),
    );
  } else if (opts.gateFirst) gate.open();

  return {
    me,
    online,
    isMod: () => me.joined && CHAT_MODS.some((n) => n.toLowerCase() === me.nick.toLowerCase()),
    ensure() {
      if (me.joined) return Promise.resolve();
      gate.open();
      return new Promise((done) => waiting.push(done));
    },
    closeGate() {
      waiting = [];
      if (!me.joined) gate.close();
    },
    leave,
    face,
    paintFaces(el) {
      for (const f of el.querySelectorAll<HTMLElement>('.face[data-seed], .face[data-uuid]')) {
        follow(f.dataset.uuid ?? null);
        paint(f);
      }
    },
    announce,
    destroy() {
      stopped = true;
      goodbye();
      for (const c of chains) c.off();
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t);
      }
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('pagehide', goodbye);
      releasePortraits();
    },
  };
}
