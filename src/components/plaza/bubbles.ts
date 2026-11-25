// Speech bubbles: now and then a Mii says an entry from anywhere on the site, and the bubble links to it.
// Your own Mii opens with a greeting, alone on screen; the rest only start once it has finished.
// Recent chat messages and Paint's drawings join in later (`mix`), and new messages go ahead of the
// rest (`hurry`). Each kind (posts, projects, the timeline, chat, Paint) gets an equal share of turns
// however many it has (rotation.ts).
import * as THREE from 'three';
import type { Crowd } from './crowd';
import { Rotation } from './rotation';
import type { PlazaPost } from './types';
import { clamp } from './util';

const LIFE = 8.5;
const EVERY = 3.4;
/** Most bubbles up at once: one on a phone, six on a desktop, where they come quicker to fill them. */
const MOST = { phone: 1, desktop: 6 };
/** Narrower than this is a phone. */
const DESKTOP = 720;
const MARGIN = 12;
/** How far above the speaker's head a bubble's bottom edge sits, in pixels, its tail between. */
const ABOVE = 20;
/** Milliseconds a closing bubble is kept for: its shrink back into its speaker (`is-out` in Plaza.astro, 0.34 s) and a frame or two to start. */
const OUT = 420;
/** How many times a post going ahead of the rest looks for someone in view to say it, before it waits its turn. */
const HURRY_TRIES = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Cubic Bezier control-point ratio for a superellipse (n = 4, matching CSS corner-shape: squircle).
const SQUIRCLE_K = 0.091;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Active {
  post: PlazaPost;
  el: HTMLAnchorElement;
  shadow: SVGPathElement;
  speaker: number;
  until: number;
  box: Box;
  shapeKey: string;
}

const _v = new THREE.Vector3();

export class Bubbles {
  private active: Active[] = [];
  private queue: Rotation<PlazaPost>;
  /** Said ahead of the queue, in order, alongside whatever is up: new chat messages. */
  private soon: PlazaPost[] = [];
  private soonTries = 0;
  /** Told about each post as its bubble goes up. */
  onSay: ((post: PlazaPost) => void) | null = null;
  private last = -Infinity;
  private unit = 0;
  private viewW = 0;
  private viewH = 0;
  /** Said before anything else, once: the greeting, or something asked for with `sayNext`. */
  private first: PlazaPost | null;
  /** The greeting the plaza opened with, until it is said. */
  private welcome: PlazaPost | null;
  /** How many seconds `first` stays up. */
  private firstLife = LIFE;
  /** While it is up, nobody else speaks. */
  private alone: Active | null = null;

  constructor(
    private layer: HTMLElement,
    posts: PlazaPost[],
    /** Icon image URL for each cube, for posts without a thumbnail of their own. */
    private thumbs: string[],
    greeting: PlazaPost | null = null,
  ) {
    this.first = this.welcome = greeting;
    // After the greeting, a new order on every visit, never two of one kind running.
    this.queue = new Rotation(kindOf, posts);
  }

  /** Mixes in `more` as everything of `kind`, in place of any mixed in before, and says `first` ahead of them all, in order. */
  mix(kind: string, more: PlazaPost[], first: PlazaPost[] = []) {
    this.queue.set(kind, more);
    this.soon = [...this.soon.filter((p) => kindOf(p) !== kind), ...first];
    this.soonTries = 0;
  }

  /** A post just made: said ahead of the queue as soon as there is room, then taking its turn with the rest. */
  hurry(post: PlazaPost) {
    this.soon.push(post);
    this.queue.add(post);
  }

  /** Whether something is waiting to be said first (the greeting), which may come sooner than the rest. */
  get greeting() {
    return this.first !== null;
  }

  /** Puts `post` in place of the greeting, if it is still waiting to be said. */
  regreet(post: PlazaPost) {
    if (this.first && this.first === this.welcome) this.first = this.welcome = post;
  }

  /** Says `post` next, alone, as soon as it can, clearing whatever is up, for `life` seconds. */
  sayNext(post: PlazaPost, life = LIFE) {
    this.dismiss();
    this.first = post;
    this.firstLife = life;
    this.last = -Infinity;
  }

  /** Removes every bubble at once. */
  clear() {
    for (const a of this.active) a.el.remove();
    this.active = [];
  }

  /** Lets every bubble fade away, but `keep` if given, which stays up for good (it was pressed). */
  dismiss(keep?: Element) {
    for (const a of this.active) {
      if (a.el === keep) a.until = Infinity;
      else this.close(a);
    }
    this.active = this.active.filter((a) => a.el === keep);
  }

  /** Who is saying the bubble `el`, or -1. */
  speakerOf(el: Element) {
    return this.active.find((a) => a.el === el)?.speaker ?? -1;
  }

  /** `avoid` lists screen boxes a new bubble must not cover: the section blocks. */
  update(time: number, crowd: Crowd, camera: THREE.Camera, w: number, h: number, open: boolean, avoid: Box[] = []) {
    if (w !== this.viewW || h !== this.viewH) {
      this.viewW = w;
      this.viewH = h;
      this.unit = parseFloat(getComputedStyle(this.layer).getPropertyValue('--b')) || clamp(Math.min(h * 0.0072, w * 0.004), 3.8, 5.4);
      for (const a of this.active) {
        a.box.w = a.el.offsetWidth;
        a.box.h = a.el.offsetHeight;
      }
    }
    this.active = this.active.filter((a) => {
      if (time < a.until) return true;
      this.close(a);
      return false;
    });
    for (const a of this.active) this.move(a, this.place(crowd, a.speaker, camera, w, h, a.box.w, a.box.h));
    // Speakers shift a little as they talk; if two bubbles drift into each other, the newer goes.
    for (let i = 1; i < this.active.length; i++) {
      if (this.active.slice(0, i).some((o) => touches(o.box, this.active[i].box))) {
        this.close(this.active[i]);
        this.active.splice(i--, 1);
      }
    }

    if (this.alone && this.active.includes(this.alone)) return;
    const most = w < DESKTOP ? MOST.phone : MOST.desktop;
    const every = Math.min(EVERY, LIFE / most);
    const queued = !this.first && !this.soon.length;
    const post = this.first ?? this.soon[0] ?? this.queue.peek();
    if (this.active.some((a) => a.until === Infinity)) return;
    if (!open || !post || this.active.length >= most || time - this.last < every) return;
    // Already up (a new message, hurried, coming round in the queue too): the next one instead.
    if (this.active.some((a) => a.post === post)) {
      if (queued) this.queue.skip();
      return;
    }
    this.last = time;

    const { el, shadow } = this.build(post);
    this.layer.append(el);
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const own = post.by ?? (post.me ? 0 : -1);
    const candidates = own >= 0 ? (crowd.free(own) ? [own] : []) : crowd.speakers(post.cube).slice(0, 16);
    // The speaker whose bubble covers least of the section blocks: ideally none, at most a corner.
    let best: { speaker: number; at: ReturnType<Bubbles['place']>; cover: number } | null = null;
    for (const speaker of candidates) {
      const at = this.place(crowd, speaker, camera, w, h, bw, bh);
      if (!at.fits || this.active.some((a) => overlap(a.box, at.box))) continue;
      const cover = avoid.reduce((s, b) => s + area(b, at.box), 0) / (bw * bh);
      // The DJ stands under the Music block, so what they say goes over it.
      if ((post.by === undefined && cover > 0.18) || (best && cover >= best.cover)) continue;
      best = { speaker, at, cover };
      if (cover === 0) break;
    }
    if (best) {
      const { speaker, at } = best;
      const life = post === this.first ? this.firstLife : LIFE;
      const a: Active = { post, el, shadow, speaker, until: time + life, box: at.box, shapeKey: '' };
      this.move(a, at);
      el.classList.add('is-in');
      crowd.say(speaker, time, life, post.text);
      this.active.push(a);
      if (post === this.first) {
        // Alone until it ends; the others follow a beat after.
        this.first = null;
        this.firstLife = LIFE;
        this.alone = a;
        this.last = a.until - every + 0.8;
      } else if (post === this.soon[0]) {
        this.soon.shift();
        this.soonTries = 0;
      } else this.queue.skip();
      this.onSay?.(post);
      return;
    }
    // Nobody suitable in view: try again soon, with the next post unless this one goes first. One
    // going ahead of the rest gets a few tries, then takes its turn in the queue.
    el.remove();
    if (post === this.soon[0]) {
      if (++this.soonTries >= HURRY_TRIES) {
        this.soon.shift();
        this.soonTries = 0;
      }
    } else if (queued) this.queue.skip();
    this.last = time - every * 0.75;
  }

  private close(a: Active) {
    a.el.classList.replace('is-in', 'is-out');
    setTimeout(() => a.el.remove(), OUT);
  }

  private move(a: Active, at: { box: Box; tail: number }) {
    a.box = at.box;
    const tx = Math.round(at.tail);
    // Placed with `translate`, which the grow and shrink (`scale`) leave alone; inside `transform`
    // the scale would shrink the placement too and fly the bubble in from the corner.
    a.el.style.translate = `${Math.round(at.box.x)}px ${Math.round(at.box.y)}px`;
    const key = `${at.box.w}|${at.box.h}|${tx}|${this.unit.toFixed(2)}`;
    if (key !== a.shapeKey) {
      a.shapeKey = key;
      const { d, tailH } = bubbleShape(at.box.w, at.box.h, tx, this.unit);
      a.el.style.setProperty('--tail', `${tx}px`);
      a.el.style.setProperty('--tail-h', `${tailH.toFixed(2)}px`);
      a.el.style.setProperty('--bubble-path', `path("${d}")`);
      a.shadow.setAttribute('d', d);
    }
  }

  /** Where a bubble of this size sits for this speaker: above the head, tail pointing down at it. */
  private place(crowd: Crowd, speaker: number, camera: THREE.Camera, w: number, h: number, bw: number, bh: number) {
    crowd.headTop(speaker, _v).project(camera);
    const sx = (_v.x + 1) * 0.5 * w;
    const sy = (1 - _v.y) * 0.5 * h;
    const x = clamp(sx - bw * 0.42, MARGIN, Math.max(MARGIN, w - bw - MARGIN));
    // Room under the bubble for its tail, which ends just over the head.
    const y = sy - bh - ABOVE;
    const pad = Math.min(tailInset(bw, bh, this.unit), bw / 2);
    return {
      box: { x, y, w: bw, h: bh },
      tail: clamp(sx - x, pad, bw - pad),
      fits: _v.z < 1 && sx > 40 && sx < w - 40 && y > MARGIN + 14 && sy < h - 24,
    };
  }

  private build(post: PlazaPost) {
    const el = document.createElement('a');
    el.className = 'plaza-bubble';
    // It grows out of the head, this far below it.
    el.style.setProperty('--to-head', `${ABOVE}px`);
    el.href = post.href;
    el.tabIndex = -1;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'plaza-bubble-shadow');
    svg.setAttribute('aria-hidden', 'true');
    const shadow = document.createElementNS(SVG_NS, 'path');
    svg.append(shadow);
    const tag = document.createElement('span');
    tag.className = 'plaza-bubble-tag';
    tag.textContent = post.tag;
    const icon = post.date ? calendar(post.date) : document.createElement('img');
    if (icon instanceof HTMLImageElement) {
      if (post.mii && post.thumb) icon.className = 'is-mii';
      icon.src = post.thumb ?? this.thumbs[post.cube] ?? '';
      icon.alt = '';
      icon.decoding = 'async';
    }
    let body: HTMLElement;
    if (post.drawing) {
      // Sized by the page's styles before it loads, so the bubble is measured at its full size.
      const img = document.createElement('img');
      img.className = `plaza-bubble-drawing${post.drawing.ink ? ' is-ink' : ''}`;
      img.src = post.drawing.src;
      img.alt = post.text;
      img.decoding = 'async';
      el.classList.add('has-drawing');
      body = img;
    } else {
      body = document.createElement('span');
      body.className = 'plaza-bubble-text';
      body.textContent = post.text;
    }
    el.append(svg, tag, icon, body);
    return { el, shadow };
  }
}

/** A calendar page for a timeline event: its month on a strip in the color of its kind, the day, the year. */
function calendar({ iso, color }: { iso: string; color: string }) {
  const d = new Date(`${iso}T00:00:00Z`);
  const el = document.createElement('time');
  el.className = 'plaza-bubble-cal';
  el.dateTime = iso;
  el.style.setProperty('--k', color);
  const month = document.createElement('span');
  month.textContent = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = document.createElement('b');
  day.textContent = String(d.getUTCDate());
  const year = document.createElement('small');
  year.textContent = String(d.getUTCFullYear());
  el.append(month, day, year);
  return el;
}

/** Minimum horizontal inset for the tail center so its base stays clear of the squircle corners. */
function tailInset(w: number, h: number, b: number) {
  const r = Math.min(b * 5.2, w / 2, h / 2);
  return r + b * 2.7 + b * 0.75;
}

/**
 * One continuous SVG path for the whole bubble (squircle body + smoothly joined rounded-tip tail),
 * so the frosted glass blurs the plaza in a single pass and the outer shadow wraps the tip too.
 */
function bubbleShape(w: number, h: number, tail: number, b: number) {
  const r = Math.min(b * 5.2, w / 2, h / 2);
  const c = r * SQUIRCLE_K;
  const tw = b * 2.7;
  const th = b * 2.8;
  const join = b * 0.75;
  const tip = b * 0.9;
  const pad = Math.min(r + tw + join, w / 2);
  const tx = clamp(tail, pad, w - pad);

  const len = Math.hypot(tw, th);
  const ux = tw / len;
  const uy = th / len;
  const f = (n: number) => n.toFixed(2);

  const d = [
    `M 0 ${f(r)}`,
    `C 0 ${f(c)} ${f(c)} 0 ${f(r)} 0`,
    `L ${f(w - r)} 0`,
    `C ${f(w - c)} 0 ${f(w)} ${f(c)} ${f(w)} ${f(r)}`,
    `L ${f(w)} ${f(h - r)}`,
    `C ${f(w)} ${f(h - c)} ${f(w - c)} ${f(h)} ${f(w - r)} ${f(h)}`,
    `L ${f(tx + tw + join)} ${f(h)}`,
    `Q ${f(tx + tw)} ${f(h)} ${f(tx + tw - join * ux)} ${f(h + join * uy)}`,
    `L ${f(tx + tip * ux)} ${f(h + th - tip * uy)}`,
    `Q ${f(tx)} ${f(h + th)} ${f(tx - tip * ux)} ${f(h + th - tip * uy)}`,
    `L ${f(tx - tw + join * ux)} ${f(h + join * uy)}`,
    `Q ${f(tx - tw)} ${f(h)} ${f(tx - tw - join)} ${f(h)}`,
    `L ${f(r)} ${f(h)}`,
    `C ${f(c)} ${f(h)} 0 ${f(h - c)} 0 ${f(h - r)}`,
    'Z',
  ].join(' ');

  return { d, tailH: th };
}

/** Posts in a random order, taking turns between blocks so the same block never speaks twice running. */
/** A post's kind for its share of turns: what it says it is, or else its block. */
const kindOf = (p: PlazaPost) => p.kind ?? `cube-${p.cube}`;

/** How much of two boxes overlaps, in square pixels. */
function area(a: Box, b: Box) {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return x > 0 && y > 0 ? x * y : 0;
}

/** Whether two boxes overlap at all. */
function touches(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlap(a: Box, b: Box) {
  const gap = 16;
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap + 20 && b.y < a.y + a.h + gap + 20;
}
