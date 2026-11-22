// Speech bubbles: now and then a Mii says an entry from anywhere on the site, and the bubble links to it.
// Your own Mii opens with a greeting, alone on screen; the rest only start once it has finished.
import * as THREE from 'three';
import type { Crowd } from './crowd';
import type { PlazaPost } from './types';
import { clamp } from './util';

const LIFE = 8.5;
const EVERY = 3.4;
const MARGIN = 12;
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
  private queue: PlazaPost[];
  private last = -Infinity;
  private unit = 0;
  private viewW = 0;
  private viewH = 0;
  /** Said before anything else, once: the greeting, or something asked for with `sayNext`. */
  private first: PlazaPost | null;
  /** While it is up, nobody else speaks. */
  private alone: Active | null = null;

  constructor(
    private layer: HTMLElement,
    posts: PlazaPost[],
    /** Icon image URL for each cube, for posts without a thumbnail of their own. */
    private thumbs: string[],
    greeting: PlazaPost | null = null,
  ) {
    this.first = greeting;
    // After the greeting, every entry in a new order on every visit, never two from one block running.
    this.queue = shuffled(posts);
  }

  /** Whether something is waiting to be said first (the greeting), which may come sooner than the rest. */
  get greeting() {
    return this.first !== null;
  }

  /** Says `post` next, alone, as soon as it can, clearing whatever is up. */
  sayNext(post: PlazaPost) {
    this.dismiss();
    this.first = post;
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
    const post = this.first ?? this.queue[0];
    if (this.active.some((a) => a.until === Infinity)) return;
    if (!open || !post || this.active.length >= (w < 720 ? 1 : 2) || time - this.last < EVERY) return;
    this.last = time;

    const { el, shadow } = this.build(post);
    this.layer.append(el);
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const candidates = post.me ? (crowd.free(0) ? [0] : []) : crowd.speakers(post.cube).slice(0, 16);
    // The speaker whose bubble covers least of the section blocks: ideally none, at most a corner.
    let best: { speaker: number; at: ReturnType<Bubbles['place']>; cover: number } | null = null;
    for (const speaker of candidates) {
      const at = this.place(crowd, speaker, camera, w, h, bw, bh);
      if (!at.fits || this.active.some((a) => overlap(a.box, at.box))) continue;
      const cover = avoid.reduce((s, b) => s + area(b, at.box), 0) / (bw * bh);
      if (cover > 0.18 || (best && cover >= best.cover)) continue;
      best = { speaker, at, cover };
      if (cover === 0) break;
    }
    if (best) {
      const { speaker, at } = best;
      const a: Active = { el, shadow, speaker, until: time + LIFE, box: at.box, shapeKey: '' };
      this.move(a, at);
      el.classList.add('is-in');
      crowd.say(speaker, time, LIFE);
      this.active.push(a);
      if (post === this.first) {
        // Alone until it ends; the others follow a beat after.
        this.first = null;
        this.alone = a;
        this.last = a.until - EVERY + 0.8;
      } else this.queue.push(this.queue.shift()!);
      return;
    }
    // Nobody suitable in view: try again soon, with the next post unless this one goes first.
    el.remove();
    if (post !== this.first) this.queue.push(this.queue.shift()!);
    this.last = time - EVERY * 0.75;
  }

  private close(a: Active) {
    a.el.classList.replace('is-in', 'is-out');
    setTimeout(() => a.el.remove(), 320);
  }

  private move(a: Active, at: { box: Box; tail: number }) {
    a.box = at.box;
    const tx = Math.round(at.tail);
    a.el.style.transform = `translate3d(${Math.round(at.box.x)}px, ${Math.round(at.box.y)}px, 0)`;
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
    const y = sy - bh - 20;
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
      icon.src = post.thumb ?? this.thumbs[post.cube] ?? '';
      icon.alt = '';
      icon.decoding = 'async';
    }
    const text = document.createElement('span');
    text.className = 'plaza-bubble-text';
    text.textContent = post.text;
    el.append(svg, tag, icon, text);
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
function shuffled(posts: PlazaPost[]) {
  const mix = <T>(list: T[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  const byCube = new Map<number, PlazaPost[]>();
  for (const p of posts) byCube.set(p.cube, [...(byCube.get(p.cube) ?? []), p]);
  const groups = mix([...byCube.values()].map(mix));
  const out: PlazaPost[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}

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
