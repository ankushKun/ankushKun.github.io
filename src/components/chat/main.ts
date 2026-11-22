// Runs the chat room (Chat.astro): reads the room from the relay (net.ts) whether or not you have
// joined, and once you have, posts, Yeah!s, says you are here and when you are typing. Everything
// it is given by other people goes through net.ts's readers first and is drawn as text.
import { CHAT_MODS } from '../../site';
import { play } from '../../scripts/sfx';
import { encodeMii, miiBytes } from '../mii/data';
import { miiFromQrImage } from '../mii/qr';
import { HELP, parse } from './commands';
import { mountPad, type Pad } from '../live/pad';
import { mountGifPicker } from './gifpicker';
import { mountMentions, type Person } from './mentions';
import { growFrom, placeAbove } from './sheets';
import { gifsOn } from './gifs';
import { dayLabel, inline, mentionsIn, stamp } from './format';
import {
  keyTime,
  messageKey,
  paths,
  readMessage,
  readPresence,
  readProfile,
  watchConnection,
  type Chain,
  type Message,
  type Presence,
} from './net';
import { FEELINGS, portraits, randomMiiCode, releasePortraits, standIn } from './portraits';
import { STORE, agreed, cleanNick, saw, store } from '../live/store';
import { mountGate } from '../live/gate';

/** Messages the room keeps; older ones are deleted by whoever is here. */
const KEEP = 110;
/** Presence is rewritten this often, and someone silent for TIMEOUT has gone. */
const BEAT = 5000;
const TIMEOUT = 12000;
const TYPING = 4000;
/** Posts closer together than this from one person run on under one name. */
const RUN = 5 * 60 * 1000;
const FLOOD = { window: 10000, max: 8 };
/**
 * Each person's colour: a hue from their id, so it stays when they change their name (people from
 * the old site without one are hashed by name). Lightness and chroma come from chat.css, per theme.
 */
function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return String(Math.abs(h) % 360);
}

const paintName = (el: HTMLElement, id: string) => {
  el.classList.add('nick');
  el.style.setProperty('--hue', hueOf(id));
};

const isJoinLeave = (m: Message) => m.kind === 'system' && (m.text === 'entered the room' || m.text === 'left the room');

interface Row {
  key: string;
  time: number;
  li: HTMLLIElement;
  msg?: Message;
  /** The day's divider above it, when it is the day's first. */
  day?: HTMLLIElement;
}

export function mount(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const scroller = $('[data-scroll]');
  const feed = $<HTMLOListElement>('[data-feed]');
  const typingList = $<HTMLOListElement>('[data-typing]');
  const wait = $('[data-wait]');
  const newPosts = $<HTMLButtonElement>('[data-new]');
  const peopleList = $<HTMLUListElement>('[data-people-list]');
  const form = $<HTMLFormElement>('[data-composer]');
  const input = $<HTMLTextAreaElement>('[data-input]');
  const drawSheet = $('[data-draw-sheet]');
  const drawPost = $<HTMLButtonElement>('[data-draw-post]');
  const sheet = $('[data-me]');
  const renameInput = $<HTMLInputElement>('[data-rename]');
  const status = $('[data-status]');

  // Who you are. uuid and nick are the old site's, so a returning visitor keeps both.
  const me = {
    uuid: store.get(STORE.uuid) ?? crypto.randomUUID(),
    nick: '',
    mii: store.get(STORE.mii) ?? '',
    feel: 0,
    joined: false,
    typingUntil: 0,
  };
  store.set(STORE.uuid, me.uuid);

  const rows = new Map<string, Row>();
  /** Rows in time order. */
  const order: Row[] = [];
  const yeahs = new Map<string, Set<string>>();
  const online = new Map<string, Presence>();
  /** Everyone noted as having joined this visit, so a sleepy tab coming back isn't news. */
  const arrived = new Set<string>();
  const profiles = new Map<string, string | null>();
  const nickOf = new Map<string, string>();
  const chains: Chain[] = [];
  const timers: number[] = [];
  const sent: number[] = [];
  const heard = new Map<string, number[]>();
  const openedAt = Date.now();
  let settled = false;
  let unread = 0;
  let lastSound = 0;
  let pad: Pad | null = null;
  let stopWatch = () => {};
  const baseTitle = document.title;

  // Faces ----------------------------------------------------------------------------------------

  /** Makes a button mention `nick` at the caret when pressed (the click handler below). */
  function makeMention(b: HTMLButtonElement, nick: string) {
    b.type = 'button';
    b.dataset.mention = nick;
    b.setAttribute('aria-label', `Mention ${nick}`);
  }

  const codeFor = (uuid: string | null) => (uuid === me.uuid ? me.mii || null : uuid ? (profiles.get(uuid) ?? null) : null);

  /** Puts a Mii on a face: theirs, or a stand-in made from their id or name (data-seed). */
  function paint(face: HTMLElement, uuid: string | null, feel = 0) {
    const img = face.querySelector('img');
    if (!img) return;
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
        img.src = shots[feel] ?? shots[0];
      });
    };
    if (code) show(code);
    else if (seed) void standIn(seed).then((c) => face.dataset.code === token && show(c));
    else img.removeAttribute('src');
  }

  function paintMine() {
    for (const face of $$('[data-face="me"]')) paint(face, me.uuid, face.dataset.feel ? Number(face.dataset.feel) : me.feel);
    for (const face of $$(`[data-uuid="${CSS.escape(me.uuid)}"]`)) paint(face, me.uuid, Number(face.dataset.feel) || 0);
  }

  function face(uuid: string | null, feel: number, cls = 'face', seed = uuid, mentions?: string) {
    const span = document.createElement(mentions ? 'button' : 'span');
    span.className = cls;
    if (mentions) makeMention(span as HTMLButtonElement, mentions);
    if (uuid) span.dataset.uuid = uuid;
    if (seed) span.dataset.seed = seed;
    span.dataset.feel = String(feel);
    span.appendChild(document.createElement('img')).alt = '';
    paint(span, uuid, feel);
    return span;
  }

  function follow(uuid: string | null) {
    if (!uuid || uuid === me.uuid || profiles.has(uuid)) return;
    profiles.set(uuid, null);
    const chain = paths.profile(uuid);
    chains.push(chain);
    chain.on((data) => {
      const code = readProfile(data);
      if (code === profiles.get(uuid) || (code && !miiBytes(code))) return;
      profiles.set(uuid, code);
      for (const f of $$(`[data-uuid="${CSS.escape(uuid)}"]`)) paint(f, uuid, Number(f.dataset.feel) || 0);
    });
  }

  // The feed -------------------------------------------------------------------------------------

  // The feed opens on its latest post and stays there as posts arrive and as anything in it grows
  // (pictures, Miis, fonts), until you scroll up yourself; scrolling back down pins it again.
  const pinned = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  let stick = true;
  let queued = false;
  let lastTop = 0;
  function toBottom() {
    if (revealed) scroller.scrollTo({ top: scroller.scrollHeight, behavior: calm ? 'auto' : 'smooth' });
    else scroller.scrollTop = scroller.scrollHeight;
    lastTop = scroller.scrollTop;
  }

  // The history comes in as a burst of rows. It's laid out unseen behind the wait, and shown in
  // one go, already at its latest post, once rows stop arriving.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let revealed = false;
  let revealTimer = 0;
  function reveal() {
    if (revealed) return;
    clearTimeout(revealTimer);
    scroller.scrollTop = scroller.scrollHeight;
    lastTop = scroller.scrollTop;
    revealed = true;
    root.removeAttribute('data-loading');
    wait.hidden = true;
    feed.removeAttribute('aria-busy');
  }
  function settle() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (stick) toBottom();
      newPosts.hidden = stick || !unreadBelow;
    });
  }
  const grown = new ResizeObserver(() => {
    if (stick) toBottom();
  });
  grown.observe(feed);
  grown.observe(typingList);
  let unreadBelow = false;
  scroller.addEventListener(
    'scroll',
    () => {
      const top = scroller.scrollTop;
      // Only you scrolling up lets go; the feed growing or shrinking under you doesn't.
      if (top < lastTop - 4) stick = pinned();
      else if (pinned()) stick = true;
      lastTop = top;
      if (stick) {
        unreadBelow = false;
        newPosts.hidden = true;
      }
    },
    { passive: true },
  );
  newPosts.addEventListener('click', () => {
    stick = true;
    unreadBelow = false;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    newPosts.hidden = true;
  });

  const mention = (nick: string) => {
    const lower = nick.toLowerCase();
    const known = lower === me.nick.toLowerCase() || [...nickOf.values()].some((n) => n.toLowerCase() === lower);
    if (!known) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mention';
    b.dataset.mention = nick;
    b.textContent = `@${nick}`;
    // The colour of whoever is meant, found by the name they go by now.
    const uuid = lower === me.nick.toLowerCase() ? me.uuid : [...nickOf].find(([, n]) => n.toLowerCase() === lower)?.[0];
    paintName(b, uuid ?? nick);
    return b;
  };

  /**
   * Yeah! and Delete, in a slot kept beside every card so showing them never moves the feed: the
   * count stays once a post has any, the rest comes in while you point at the post.
   */
  function actions(key: string, mine: boolean) {
    const acts = document.createElement('div');
    acts.className = 'card-acts';
    // Your own posts can't be given a Yeah!, only show how many they have.
    const yeah = document.createElement(mine ? 'span' : 'button');
    yeah.className = 'act yeah';
    if (yeah instanceof HTMLButtonElement) {
      yeah.type = 'button';
      yeah.dataset.yeah = key;
      yeah.setAttribute('aria-pressed', 'false');
    }
    yeah.innerHTML = YEAH_ICON;
    const label = yeah.appendChild(document.createElement('span'));
    label.className = 'yeah-label';
    label.textContent = 'Yeah!';
    yeah.appendChild(document.createElement('span')).className = 'yeah-n';
    acts.append(yeah);
    // Shown on your own posts, and on everyone's for a mod (chat.css, .chat[data-mod]).
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'act delete';
    del.dataset.delete = key;
    del.setAttribute('aria-label', 'Delete');
    del.title = 'Delete';
    del.innerHTML = TRASH_ICON;
    acts.append(del);
    return acts;
  }

  function paintYeahs(row: Row) {
    const set = yeahs.get(row.key);
    const n = set?.size ?? 0;
    const li = row.li;
    li.classList.toggle('has-yeahs', n > 0);
    const count = li.querySelector('.yeah-n');
    if (count) count.textContent = n ? String(n) : '';
    const btn = li.querySelector('.yeah');
    const mine = !!set?.has(me.uuid);
    btn?.setAttribute('aria-pressed', String(mine));
    btn?.setAttribute('aria-label', mine ? `Take back your Yeah! (${n})` : `Yeah! (${n})`);
  }

  function build(m: Message): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.key = m.key;
    const mine = !!m.uuid && m.uuid === me.uuid;
    if (m.deleted || (m.kind === 'system' && !m.action)) {
      li.className = 'post is-gone';
      const card = li.appendChild(document.createElement('div'));
      card.className = 'gone';
      card.textContent = m.deleted ? 'This post has been deleted.' : m.text;
      return li;
    }
    if (m.action) {
      li.className = 'post is-action';
      li.append(face(m.uuid, m.feel, 'face small', m.uuid ?? m.nick, m.nick));
      const p = li.appendChild(document.createElement('p'));
      const who = p.appendChild(document.createElement('button'));
      who.className = 'who';
      who.textContent = m.nick;
      makeMention(who, m.nick);
      paintName(who, m.uuid ?? m.nick);
      p.append(' ');
      inline(p, m.text, mention);
      return li;
    }
    li.className = 'post';
    if (mine) li.classList.add('is-me');
    if (!mine && me.nick && mentionsIn(m.text).includes(me.nick.toLowerCase())) li.classList.add('is-mention');
    li.append(face(m.uuid, m.feel, 'face', m.uuid ?? m.nick, m.nick));
    const main = li.appendChild(document.createElement('div'));
    main.className = 'post-main';
    const head = main.appendChild(document.createElement('div'));
    head.className = 'post-head';
    const name = head.appendChild(document.createElement('button'));
    makeMention(name, m.nick);
    name.className = 'pill';
    name.textContent = m.nick;
    paintName(name, m.uuid ?? m.nick);
    const when = head.appendChild(document.createElement('time'));
    when.dateTime = new Date(m.time).toISOString();
    when.title = new Date(m.time).toLocaleString();
    when.dataset.time = String(m.time);
    when.textContent = stamp(m.time);
    // The card, with Yeah! in a slot beside it, level with its last line.
    const row = main.appendChild(document.createElement('div'));
    row.className = 'post-row';
    const card = row.appendChild(document.createElement('div'));
    card.className = 'card';
    const body = card.appendChild(document.createElement('div'));
    body.className = 'card-body';
    if (m.kind === 'drawing' && m.media) {
      card.classList.add('is-media');
      const img = body.appendChild(document.createElement('img'));
      img.className = 'drawing';
      img.src = m.media;
      img.width = 320;
      img.height = 120;
      img.alt = `A drawing by ${m.nick}`;
      img.addEventListener('load', settle, { once: true });
    } else if (m.kind === 'gif' && m.media) {
      // Its space is kept from its size, when the sender gave it, so the feed doesn't jump. Posted
      // from here it plays as an MP4 (muted, looping, still for reduced motion, a tap pauses it);
      // GIFs from the old site come as the GIF.
      card.classList.add('is-media');
      if (m.video) {
        const v = body.appendChild(document.createElement('video'));
        v.className = 'gif';
        v.src = m.video;
        // A GIF has no sound; the attribute says so to assistive tech as well as the browser.
        v.muted = true;
        v.setAttribute('muted', '');
        v.loop = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.autoplay = !calm;
        v.setAttribute('aria-label', 'GIF');
        if (m.dims) {
          v.width = m.dims[0];
          v.height = m.dims[1];
        }
        v.addEventListener('loadeddata', settle, { once: true });
        v.addEventListener('click', () => void (v.paused ? v.play() : v.pause()));
      } else {
        const img = body.appendChild(document.createElement('img'));
        img.className = 'gif';
        img.src = m.media;
        img.alt = 'GIF';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        if (m.dims) {
          img.width = m.dims[0];
          img.height = m.dims[1];
        }
        img.addEventListener('load', settle, { once: true });
      }
    } else {
      inline(body, m.text, mention);
    }
    row.append(actions(m.key, mine));
    return li;
  }

  /** Whether `row` carries on from the post before it: same person, soon after. */
  function runs(row: Row, prev: Row | undefined) {
    const a = row.msg;
    const b = prev?.msg;
    return !!a && !!b && !a.action && !b.action && a.kind !== 'system' && b.kind !== 'system' && !b.deleted && !a.deleted &&
      a.uuid === b.uuid && a.nick === b.nick && a.time - b.time < RUN && sameDay(a.time, b.time);
  }

  const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

  function regroup(i: number) {
    for (const j of [i, i + 1]) {
      const row = order[j];
      if (!row) continue;
      const prev = order[j - 1];
      row.li.classList.toggle('is-run', runs(row, prev));
      // The first post of each day sits under that day's name.
      const first = !prev || !sameDay(prev.time, row.time);
      if (first && !row.day) {
        row.day = document.createElement('li');
        row.day.className = 'day';
        row.day.dataset.time = String(row.time);
        row.day.textContent = dayLabel(row.time);
        row.li.before(row.day);
      } else if (!first && row.day) {
        row.day.remove();
        row.day = undefined;
      }
    }
  }

  function place(row: Row) {
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const o = order[mid];
      if (o.time < row.time || (o.time === row.time && o.key < row.key)) lo = mid + 1;
      else hi = mid;
    }
    order.splice(lo, 0, row);
    const next = order[lo + 1];
    feed.insertBefore(row.li, next ? (next.day ?? next.li) : null);
    regroup(lo);
    feed.classList.remove('is-empty');
    if (!revealed) {
      clearTimeout(revealTimer);
      revealTimer = window.setTimeout(reveal, 350);
    } else row.li.classList.add('is-new');
    settle();
  }

  function remove(key: string) {
    const row = rows.get(key);
    if (!row) return;
    const i = order.indexOf(row);
    order.splice(i, 1);
    row.li.remove();
    row.day?.remove();
    rows.delete(key);
    regroup(i - 1);
  }

  let notes = 0;
  /** A line only you see: a join, a leave, a slip of the keyboard, help. */
  function note(text: string, help = false) {
    const li = document.createElement('li');
    li.className = help ? 'note is-help' : 'note';
    inline(li, text, mention);
    const key = `~${notes++}`;
    const row: Row = { key, time: Date.now(), li };
    rows.set(key, row);
    stick ||= help;
    place(row);
  }

  function onMessage(data: unknown, key: string) {
    if (!data) return remove(key);
    const m = readMessage(key, data);
    if (!m) return;
    if (isJoinLeave(m)) {
      legacy.add(key);
      return;
    }
    // A deleted post just goes; a row of "deleted" notices says nothing.
    if (m.deleted) return remove(key);
    if (m.uuid) {
      nickOf.set(m.uuid, m.nick);
      follow(m.uuid);
    }
    const old = rows.get(key);
    if (old) {
      if (old.msg && old.msg.text === m.text && old.msg.kind === m.kind && old.msg.deleted === m.deleted) return;
      const li = build(m);
      li.className = `${li.className} ${old.li.classList.contains('is-run') ? 'is-run' : ''}`.trim();
      old.li.replaceWith(li);
      old.li = li;
      old.msg = m;
      paintYeahs(old);
      return;
    }
    const live = m.time >= openedAt && m.uuid !== me.uuid;
    // Someone flooding the room, by the times they say they sent things. Courtesy, not security.
    if (live && flooding(heard, m.uuid ?? m.nick, m.time)) return;
    const row: Row = { key, time: m.time, li: build(m), msg: m };
    rows.set(key, row);
    saw(m.time);
    paintYeahs(row);
    const wasPinned = stick;
    place(row);
    if (live) {
      if (!wasPinned) {
        unreadBelow = true;
        newPosts.hidden = false;
      }
      const mentioned = row.li.classList.contains('is-mention');
      const now = performance.now();
      if (now - lastSound > 900) {
        lastSound = now;
        play(mentioned ? 'select' : 'tick');
      }
      if (document.hidden) {
        unread++;
        document.title = `(${unread}) ${baseTitle}`;
      }
    }
  }

  function flooding(book: Map<string, number[]>, who: string, at: number) {
    const times = book.get(who) ?? [];
    book.set(who, times);
    times.push(at);
    if (times.length > 50) times.shift();
    return times.filter((t) => t <= at && at - t < FLOOD.window).length > FLOOD.max + 2;
  }

  function onYeah(data: unknown, k: string) {
    const [key, uuid] = k.split('~');
    if (!key || !uuid) return;
    let set = yeahs.get(key);
    if (data) {
      if (!set) yeahs.set(key, (set = new Set()));
      set.add(uuid);
    } else set?.delete(uuid);
    const row = rows.get(key);
    if (row) paintYeahs(row);
  }

  // Old messages go once there are more than KEEP, with their Yeah!s, as do the join and leave
  // lines older versions wrote. Whoever is in the room does it.
  const legacy = new Set<string>();
  function tidy() {
    if (!me.joined) return;
    const msgs = paths.messages();
    for (const key of legacy) {
      if (Date.now() - keyTime(key) > 5 * 60 * 1000) {
        msgs.get(key).put(null);
        legacy.delete(key);
      }
    }
    const real = order.filter((r) => r.msg);
    const yeahChain = paths.yeahs();
    for (const row of real.slice(0, Math.max(0, real.length - KEEP))) {
      msgs.get(row.key).put(null);
      for (const uuid of yeahs.get(row.key) ?? []) yeahChain.get(`${row.key}~${uuid}`).put(null);
      yeahs.delete(row.key);
    }
  }

  // People ---------------------------------------------------------------------------------------

  let rosterQueued = 0;
  function roster() {
    if (rosterQueued) return;
    rosterQueued = window.setTimeout(() => {
      rosterQueued = 0;
      drawPeople();
      drawTyping();
    }, 120);
  }

  function here(): Presence[] {
    const now = Date.now();
    const list = [...online.values()].filter((p) => now - p.lastSeen < TIMEOUT && p.uuid !== me.uuid);
    if (me.joined) list.push({ uuid: me.uuid, nick: me.nick, lastSeen: now, typingUntil: 0 });
    return list.sort((a, b) => (a.uuid === me.uuid ? -1 : b.uuid === me.uuid ? 1 : a.nick.localeCompare(b.nick)));
  }

  function drawPeople() {
    mentions.render();
    const list = here();
    for (const c of $$('[data-count]')) c.textContent = String(list.length);
    $('[data-stack]').replaceChildren(...list.slice(0, 5).map((p) => face(p.uuid, 0, 'face small')));
    const now = Date.now();
    peopleList.replaceChildren(
      ...list.map((p) => {
        const li = document.createElement('li');
        const b = li.appendChild(document.createElement('button'));
        b.type = 'button';
        b.className = 'person';
        if (p.uuid === me.uuid) b.classList.add('is-me');
        b.dataset.mention = p.nick;
        b.append(face(p.uuid, 0, 'face small'));
        const name = b.appendChild(document.createElement('span'));
        name.className = 'person-name';
        name.textContent = p.nick;
        paintName(name, p.uuid);
        if (p.typingUntil > now) b.append(dots());
        return li;
      }),
    );
  }

  const dots = () => {
    const d = document.createElement('span');
    d.className = 'dots';
    d.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    return d;
  };

  function drawTyping() {
    const now = Date.now();
    const typing = [...online.values()].filter((p) => p.uuid !== me.uuid && p.typingUntil > now && now - p.lastSeen < TIMEOUT).slice(0, 3);
    const keep = new Set(typing.map((p) => p.uuid));
    for (const li of [...typingList.children] as HTMLElement[]) if (!keep.has(li.dataset.uuid ?? '')) li.remove();
    for (const p of typing) {
      if (typingList.querySelector(`[data-uuid="${CSS.escape(p.uuid)}"]`)) continue;
      const li = document.createElement('li');
      li.className = 'post is-typing';
      li.dataset.uuid = p.uuid;
      li.append(face(p.uuid, 0));
      const card = li.appendChild(document.createElement('div'));
      card.className = 'card';
      card.append(dots());
      typingList.append(li);
      settle();
    }
  }

  function onPresence(data: unknown, uuid: string) {
    if (uuid === me.uuid) return;
    if (!data) {
      const p = online.get(uuid);
      if (p) {
        online.delete(uuid);
        arrived.delete(uuid);
        if (settled) note(`**${p.nick}** left`);
        roster();
      }
      return;
    }
    const p = readPresence(uuid, data);
    if (!p || Date.now() - p.lastSeen > TIMEOUT) return;
    if (online.size > 300 && !online.has(uuid)) return;
    const before = online.get(uuid);
    online.set(uuid, p);
    nickOf.set(uuid, p.nick);
    follow(uuid);
    if (!arrived.has(uuid)) {
      arrived.add(uuid);
      if (settled) note(`**${p.nick}** joined`);
    } else if (before && before.nick !== p.nick && settled) note(`**${before.nick}** is now **${p.nick}**`);
    roster();
  }

  function announce() {
    if (!me.joined) return;
    paths.presence().get(me.uuid).put({
      nick: me.nick,
      uuid: me.uuid,
      status: 'online',
      lastSeen: Date.now(),
      typingUntil: me.typingUntil > Date.now() ? me.typingUntil : 0,
    });
  }

  function goodbye() {
    if (me.joined) paths.presence().get(me.uuid).put(null);
  }

  const taken = (nick: string) => {
    const now = Date.now();
    return [...online.values()].some((p) => p.uuid !== me.uuid && p.nick.toLowerCase() === nick.toLowerCase() && now - p.lastSeen < TIMEOUT);
  };

  // Joining and leaving --------------------------------------------------------------------------

  /** Whether you can delete anyone's post: you are in under a name in CHAT_MODS. */
  const isMod = () => me.joined && CHAT_MODS.some((n) => n.toLowerCase() === me.nick.toLowerCase());

  // The way in: your Mii, a name and the live apps' agreement, over the posts until you have joined.
  const gate = mountGate($('[data-gate]'), {
    enter: join,
    shuffle: () => void newMii(),
    behind: [$('.chat-feed'), form],
  });
  const nickInput = gate.input;

  function setState() {
    root.dataset.state = me.joined ? 'in' : 'out';
    root.toggleAttribute('data-mod', isMod());
    if (me.joined) gate.close();
    else gate.open();
    $('[data-my-name]').textContent = me.joined ? me.nick : 'Me';
    $('[data-mii-button]').setAttribute('aria-label', me.joined ? 'Feeling' : 'New Mii');
    renameInput.value = me.nick;
    if (me.joined) feed.setAttribute('aria-label', `#general, as ${me.nick}`);
  }

  /** Joins as `nick`, or says why not (for the gate to show). */
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
    saveProfile();
    arrived.add(me.uuid);
    announce();
    setState();
    drawPeople();
    for (const row of order) if (row.msg && !row.msg.action) row.li.classList.toggle('is-mention', row.msg.uuid !== me.uuid && mentionsIn(row.msg.text).includes(nick.toLowerCase()));
    stick = true;
    settle();
    input.focus();
    return null;
  }

  function leave() {
    goodbye();
    me.joined = false;
    store.set(STORE.nick, null);
    sheet.hidePopover();
    drawSheet.hidePopover();
    nickInput.value = '';
    setState();
    drawPeople();
  }

  function saveProfile() {
    if (me.joined && me.mii) paths.profile(me.uuid).put({ mii: me.mii, time: Date.now() });
  }

  function setMii(code: string) {
    me.mii = code;
    store.set(STORE.mii, code);
    saveProfile();
    paintMine();
  }

  async function newMii() {
    const code = await randomMiiCode();
    if (code) setMii(code);
  }

  function setFeel(i: number) {
    me.feel = i;
    for (const b of $$('[data-feel][role="radio"]')) b.setAttribute('aria-checked', String(Number(b.dataset.feel) === i));
    const f = $('.composer-mii .face');
    f.dataset.feel = String(i);
    paint(f, me.uuid, i);
    root.dataset.feeling = FEELINGS[i].name.toLowerCase();
  }

  // Posting ----------------------------------------------------------------------------------------

  function send(fields: Record<string, unknown>) {
    const now = Date.now();
    while (sent.length && now - sent[0] > FLOOD.window) sent.shift();
    if (sent.length >= FLOOD.max) {
      play('nope');
      note('Slow down a little.');
      return false;
    }
    sent.push(now);
    const key = messageKey();
    const row = { nick: me.nick, uuid: me.uuid, time: now, action: false, type: 'msg', feel: me.feel, ...fields };
    paths.messages().get(key).put(row);
    // GUN doesn't hand a page back its own new rows until the relay has them; show it now.
    onMessage(row, key);
    paths.latest().put(now);
    play('select');
    stick = true;
    setFeel(0);
    return true;
  }

  function submit() {
    if (!me.joined) return;
    const line = input.value.trim();
    if (!line) return;
    const cmd = parse(line);
    if (cmd.do === 'post') {
      if (!send({ text: cmd.text, action: !!cmd.action })) return;
    } else if (cmd.do === 'nick') {
      const nick = cleanNick(cmd.nick);
      if (!nick) note('Usage: **/nick** newname');
      else if (taken(nick)) note(`Someone here is already called **${nick}**.`);
      else changeNick(nick);
    } else if (cmd.do === 'clear') {
      for (const row of [...order]) {
        row.li.remove();
        row.day?.remove();
      }
      order.length = 0;
    } else note(cmd.text, cmd.text === HELP);
    input.value = '';
    grow();
    me.typingUntil = 0;
    announce();
  }

  function changeNick(nick: string) {
    if (nick === me.nick) return;
    me.nick = nick;
    store.set(STORE.nick, nick);
    announce();
    setState();
    drawPeople();
  }

  /** Puts `@nick ` where the caret is (over any selection), with a space before it if it needs one. */
  function mentionAtCaret(nick: string) {
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    const before = input.value.slice(0, from);
    const after = input.value.slice(to);
    const insert = `${before && !/\s$/.test(before) ? ' ' : ''}@${nick}${/^\s/.test(after) ? '' : ' '}`;
    input.value = before + insert + after;
    const at = before.length + insert.length + (/^\s/.test(after) ? 1 : 0);
    input.focus();
    input.setSelectionRange(at, at);
    grow();
    typing();
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    mentions.render();
  }

  let lastTypingSent = 0;
  function typing() {
    grow();
    if (!me.joined) return;
    const now = Date.now();
    me.typingUntil = input.value.trim() && !input.value.startsWith('/') ? now + TYPING : 0;
    if (now - lastTypingSent > 1500 || !me.typingUntil) {
      lastTypingSent = now;
      announce();
    }
  }

  // Drawing: its own sheet over the input bar. What you draw stays if you close it, until you post
  // it or clear it. Post wakes up once there's something on the paper.
  const padChanged = () => {
    drawPost.disabled = !pad?.dirty;
  };
  function postDrawing() {
    if (!pad?.dirty) return play('nope');
    // Old clients read this as "<nick> posted a drawing".
    if (!send({ type: 'drawing', text: 'posted a drawing', action: true, img: pad.png() })) return;
    pad.clear();
    drawSheet.hidePopover();
    input.focus();
  }
  drawSheet.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'open') return;
    placeAbove(drawSheet, $('.composer-field'), 720, $('.composer-draw'));
    pad ??= mountPad($<HTMLCanvasElement>('[data-pad-canvas]'), padChanged);
    padChanged();
  });
  drawPost.addEventListener('click', postDrawing);
  // Cmd or Ctrl + Z takes back the last stroke while the sheet is open (focus stays on the page
  // while you draw, so this listens on the whole page).
  const onUndoKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || !drawSheet.matches(':popover-open')) return;
    e.preventDefault();
    pad?.undo();
  };
  addEventListener('keydown', onUndoKey);

  // Events -----------------------------------------------------------------------------------------

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  // @mentions: coloured as you type, and a list of people to pick from after an @.
  /** Everyone who could be meant: those here first, then anyone who has posted; you aside. */
  const mentionable = (): Person[] => {
    const all = new Map<string, Person>();
    for (const p of online.values()) if (p.uuid !== me.uuid) all.set(p.nick.toLowerCase(), { uuid: p.uuid, nick: p.nick, here: true });
    for (const [uuid, nick] of nickOf) {
      if (uuid !== me.uuid && !all.has(nick.toLowerCase())) all.set(nick.toLowerCase(), { uuid, nick, here: false });
    }
    return [...all.values()];
  };
  const mentions = mountMentions({
    input,
    mirror: $('[data-mirror]'),
    list: $('[data-mentions]'),
    people: mentionable,
    whose: (lower) =>
      lower === me.nick.toLowerCase() ? me.uuid : (mentionable().find((p) => p.nick.toLowerCase() === lower)?.uuid ?? null),
    paint: paintName,
    face: (uuid) => face(uuid, 0, 'face small'),
    changed: () => {
      grow();
      typing();
    },
  });

  input.addEventListener('keydown', (e) => {
    if (mentions.key(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  input.addEventListener('input', () => {
    typing();
    mentions.update();
  });

  for (const b of $$('[data-tool]')) {
    b.addEventListener('click', () => {
      for (const o of $$('[data-tool]')) o.setAttribute('aria-pressed', String(o === b));
      pad?.setTool(b.dataset.tool as 'pen' | 'thick' | 'eraser');
    });
  }
  // GIFs: picking one posts it at once, with its size so its space is kept before it loads.
  const gifSheet = $('[data-gifs]');
  root.toggleAttribute('data-gifs-on', gifsOn());
  const stopGifs = mountGifPicker(gifSheet, $('.composer-field'), (gif) => {
    if (!me.joined) return;
    send({ type: 'gif', text: gif.url, w: gif.w, h: gif.h, ...(gif.video ? { mp4: gif.video } : {}) });
  });

  $('[data-pad-undo]').addEventListener('click', () => pad?.undo());
  $('[data-pad-clear]').addEventListener('click', () => pad?.clear());

  // Your Mii: before you join it rolls a new one; after, it opens your sheet, and closes it again.
  // Pressing outside an open sheet closes it before the click lands, so whether it was open is
  // read on the press, or the click would open it straight back.
  let openAtPress = false;
  const toggleSheet = (from: HTMLElement) => {
    const wasOpen = openAtPress || sheet.matches(':popover-open');
    openAtPress = false;
    if (wasOpen) sheet.hidePopover();
    else openSheet(from);
  };
  for (const opener of $$('[data-mii-button], [data-me-open]')) {
    opener.addEventListener('pointerdown', () => {
      openAtPress = sheet.matches(':popover-open');
    });
  }
  $('[data-mii-button]').addEventListener('click', (e) => {
    if (!me.joined) return void newMii();
    toggleSheet(e.currentTarget as HTMLElement);
  });
  $('[data-me-open]').addEventListener('click', (e) => {
    if (!me.joined) return nickInput.focus();
    toggleSheet(e.currentTarget as HTMLElement);
  });

  function openSheet(from: HTMLElement) {
    const box = from.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    sheet.style.left = `${Math.max(rootBox.left + 12, Math.min(box.left, rootBox.right - 380))}px`;
    sheet.style.bottom = `${innerHeight - box.top + 12}px`;
    if (box.top < innerHeight / 2) {
      sheet.style.bottom = '';
      sheet.style.top = `${box.top}px`;
      sheet.style.left = `${box.right + 14}px`;
    } else sheet.style.top = '';
    growFrom(sheet, from);
    sheet.showPopover();
  }

  for (const b of $$('[data-feel][role="radio"]')) {
    b.addEventListener('click', () => {
      setFeel(Number(b.dataset.feel));
      sheet.hidePopover();
      input.focus();
    });
  }
  renameInput.addEventListener('change', () => {
    const nick = cleanNick(renameInput.value);
    if (!nick || taken(nick)) {
      play('nope');
      renameInput.value = me.nick;
      return;
    }
    changeNick(nick);
  });
  $('[data-new-mii]').addEventListener('click', () => void newMii());
  $<HTMLInputElement>('[data-qr]').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      setMii(encodeMii(await miiFromQrImage(file)));
    } catch (err) {
      play('nope');
      note(err instanceof Error ? err.message : 'That picture has no Mii in it.');
    }
    (e.target as HTMLInputElement).value = '';
  });
  $('[data-leave]').addEventListener('click', leave);

  // Menu in the rail unfolds the site's sections under it, and folds them away again.
  const sectionsFold = $('[data-sections]');
  const sectionsToggle = $('[data-sections-toggle]');
  sectionsToggle.addEventListener('click', () => {
    const open = !root.hasAttribute('data-sections-open');
    root.toggleAttribute('data-sections-open', open);
    sectionsToggle.setAttribute('aria-expanded', String(open));
    sectionsFold.inert = !open;
    // On a short screen the rail scrolls so Menu sits at its top, the sections right under it.
    const rail = $('.rail-scroll');
    if (open) window.setTimeout(() => rail.scrollTo({ top: Math.max(0, sectionsToggle.offsetTop - 8), behavior: 'smooth' }), 120);
  });

  // Who is here opens under the bar's faces, or beside the rail's People.
  const people = $('[data-people]');
  for (const b of $$('[data-people-open]')) {
    b.addEventListener('click', () => {
      const box = b.getBoundingClientRect();
      const inRail = !!b.closest('.chat-rail');
      Object.assign(
        people.style,
        inRail
          ? { top: `${box.top}px`, left: `${box.right + 14}px`, right: '' }
          : { top: `${box.bottom + 12}px`, right: `${innerWidth - box.right}px`, left: '' },
      );
      growFrom(people, b);
    });
  }

  // Clicks inside the feed and the people list: mentions, Yeah!, delete, covered GIFs.
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const m = t.closest<HTMLElement>('[data-mention]');
    if (m) {
      if (!me.joined) {
        play('nope');
        return nickInput.focus();
      }
      mentionAtCaret(m.dataset.mention!);
      if (m.closest('[data-people]')) people.hidePopover();
      return;
    }
    const y = t.closest<HTMLButtonElement>('[data-yeah]');
    if (y) {
      if (!me.joined) {
        play('nope');
        return nickInput.focus();
      }
      const key = y.dataset.yeah!;
      const mine = yeahs.get(key)?.has(me.uuid);
      paths.yeahs().get(`${key}~${me.uuid}`).put(mine ? null : 1);
      play(mine ? 'back' : 'select');
      if (!mine) y.animate([{ scale: 1 }, { scale: 1.18 }, { scale: 1 }], { duration: 320, easing: 'cubic-bezier(0.3, 1.45, 0.5, 1)' });
      return;
    }
    const d = t.closest<HTMLElement>('[data-delete]');
    const target = d ? rows.get(d.dataset.delete!)?.msg : undefined;
    if (d && target && me.joined && (target.uuid === me.uuid || isMod())) {
      const key = d.dataset.delete!;
      const gone = { nick: 'system', uuid: null, text: `@${me.nick} deleted @${target.nick}'s message`, time: keyTime(key) || Date.now(), action: false, type: 'system' };
      paths.messages().get(key).put(gone);
      onMessage(gone, key);
      play('back');
      return;
    }
    // A tap on a post shows its Yeah! button on touch screens, where there is no hover.
    const post = t.closest<HTMLElement>('.post');
    if (post && !t.closest('a, button')) {
      for (const o of feed.querySelectorAll('.is-picked')) if (o !== post) o.classList.remove('is-picked');
      post.classList.toggle('is-picked');
    }
  });

  const onVisible = () => {
    if (document.hidden) return;
    unread = 0;
    document.title = baseTitle;
    announce();
  };
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('pagehide', goodbye);

  // Start ------------------------------------------------------------------------------------------

  const messages = paths.messages();
  const yeahChain = paths.yeahs();
  const presence = paths.presence();
  chains.push(messages, yeahChain, presence);
  messages.map().on((data, key) => onMessage(data, key));
  yeahChain.map().on((data, key) => onYeah(data, key));
  presence.map().on((data, uuid) => onPresence(data, uuid));

  stopWatch = watchConnection((on) => {
    status.hidden = on;
    if (on) announce();
  });

  timers.push(
    window.setTimeout(() => {
      settled = true;
      reveal();
      if (!order.length) feed.classList.add('is-empty');
    }, 3000),
    window.setInterval(announce, BEAT),
    window.setInterval(() => {
      const now = Date.now();
      for (const [uuid, p] of online) if (now - p.lastSeen > TIMEOUT) online.delete(uuid);
      roster();
      for (const t of feed.querySelectorAll<HTMLElement>('time[data-time]')) t.textContent = stamp(Number(t.dataset.time), now);
      for (const d of feed.querySelectorAll<HTMLElement>('.day')) d.textContent = dayLabel(Number(d.dataset.time), now);
    }, 5000),
    window.setInterval(drawTyping, 1000),
    window.setInterval(tidy, 30000),
  );

  // Your Mii: the one you had, or a new one once FFL is here.
  if (me.mii && miiBytes(me.mii)) paintMine();
  else void newMii();

  setFeel(0);
  // Back with a name and the agreement: straight in, after the first burst of presence so a name
  // someone else has taken isn't taken twice. Anyone else stops at the gate.
  const saved = store.get(STORE.nick);
  if (saved && agreed()) {
    timers.push(
      window.setTimeout(() => {
        const why = join(saved);
        if (why) gate.open(why);
      }, 900),
    );
  } else setState();

  return () => {
    goodbye();
    stopWatch();
    grown.disconnect();
    stopGifs();
    mentions.destroy();
    gifSheet.hidePopover?.();
    for (const c of chains) c.off();
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    clearTimeout(rosterQueued);
    clearTimeout(revealTimer);
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('pagehide', goodbye);
    document.title = baseTitle;
    pad?.destroy();
    removeEventListener('keydown', onUndoKey);
    drawSheet.hidePopover?.();
    sheet.hidePopover?.();
    releasePortraits();
  };
}

/** Miiverse's Yeah!: a smiling face with a hand up. */
const YEAH_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10" cy="12" r="7.2" fill="currentColor"/><circle cx="7.6" cy="10.6" r="1.1" fill="var(--yeah-ink, #fff)"/><circle cx="12.4" cy="10.6" r="1.1" fill="var(--yeah-ink, #fff)"/><path d="M7 13.6c.8 1.5 1.8 2.2 3 2.2s2.2-.7 3-2.2" fill="none" stroke="var(--yeah-ink, #fff)" stroke-width="1.5" stroke-linecap="round"/><path d="M19.5 4v6M16.5 7h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
