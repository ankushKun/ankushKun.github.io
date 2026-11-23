// Runs Paint (Paint.astro). Reads the day's strokes from the relay (board.ts) and draws them in the
// order they were made; your own strokes go up whole when you lift the pen, and while you draw,
// everyone else sees your pen and the line it is making through your cursor, which is rewritten a
// few times a second. Days before today are read only, replayed from their strokes; only days
// someone drew on are listed.
//
// The canvas zooms and pans as in any drawing app (view.ts). Strokes are kept on a raster at twice
// the canvas's size, which is what's shown while you move; once you stop, they're drawn again as
// lines at the zoom you're at, so they're sharp however close you are.
//
// Hands on: pinch, or Ctrl or Cmd with the wheel, zooms; scrolling, two fingers, the middle button,
// Space held or the Hand pans. Ctrl or Cmd with + - 0 1 zooms, fits and shows actual size. P pen,
// E eraser, H hand, [ and ] the size, Alt with a click picks a colour off the canvas, Ctrl or Cmd Z
// undoes and with Shift redoes. B stays the site's Back.
import { track } from '../../scripts/analytics';
import { play } from '../../scripts/sfx';
import { watchConnection, type Chain } from '../live/relay';
import { hueOf, mountSession } from '../live/session';
import {
  H,
  MAX_MINE,
  MAX_POINTS,
  MAX_STROKES,
  PALETTE,
  SIZES,
  W,
  dayLabel,
  dayOf,
  dayShort,
  drawStroke,
  isDay,
  packPoints,
  paths,
  promptFor,
  readCursor,
  readStroke,
  register,
  strokeKey,
  utcDay,
  writeStroke,
  type Cursor,
  type Stroke,
} from './board';
import { mountView } from './view';

/** Your cursor goes up at most this often. */
const CURSOR_EVERY = 90;
/** A cursor not heard from in this long has gone. */
const CURSOR_GONE = 12000;
/** Points closer than this, on screen, to the last are left out. */
const MIN_STEP = 1.5;
const THUMB = { w: 96, h: 60 };
/** A replay takes at most this long, however busy the day. */
const REPLAY_MAX = 20000;
/** The raster strokes are kept on, as a multiple of the canvas's size. */
const R = 2;
/** A second finger this soon after the first makes a pinch, and takes back the line it began. */
const PINCH_GRACE = 250;

type Line = Pick<Stroke, 'eraser' | 'color' | 'width' | 'pts'>;
type Tool = 'pen' | 'eraser' | 'hand';

export function mount(root: HTMLElement): () => void {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const viewEl = $('[data-view]');
  const sheet = $('[data-sheet]');
  const artEl = $<HTMLCanvasElement>('[data-art]');
  const liveEl = $<HTMLCanvasElement>('[data-live]');
  const cursorLayer = $('[data-cursors]');
  const brush = $('[data-brush]');
  const note = $('[data-note]');
  const daysNav = $('[data-days]');
  const replayBtn = $<HTMLButtonElement>('[data-replay]');
  const wipeBtn = $<HTMLButtonElement>('[data-wipe]');
  const zoomLevel = $('[data-zoom-fit]');

  const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
  const art = artEl.getContext('2d')!;
  const live = liveEl.getContext('2d')!;
  // Every committed stroke, at twice the canvas's size: shown while the view moves, and saved.
  const raster = Object.assign(document.createElement('canvas'), { width: W * R, height: H * R });
  const ras = raster.getContext('2d', { willReadFrequently: true })!;
  ras.setTransform(R, 0, 0, R, 0, 0);

  const pen = { eraser: false, color: '#2a2f31', width: 4 };
  let tool: Tool = 'pen';
  let day = utcDay();
  const strokes = new Map<string, Stroke>();
  let lastDrawn = 0;
  const cursors = new Map<string, { c: Cursor; el: HTMLElement }>();
  const days = new Set<string>();
  const registered = new Set<string>();
  const dayChains: Chain[] = [];
  const chains: Chain[] = [];
  const timers: number[] = [];
  /** Your strokes undone, newest last, to redo. */
  const undone: Stroke[] = [];
  let current: Line | null = null;
  let currentAt = 0;
  let replaying = 0;
  let replayRaster: HTMLCanvasElement | null = null;
  let replayLine: { s: Stroke; upto: number } | null = null;
  let deleted = false;
  /** Looking at today, so midnight moves you on to the new day. */
  let following = true;

  const isToday = () => day === utcDay();
  const mineToday = () => [...strokes.values()].filter((s) => s.by === session.me.uuid);
  const sorted = () => [...strokes.values()].sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));

  const session = mountSession(root, {
    app: 'paint',
    presence: paths.presence(),
    gateFirst: true,
    behind: [$('[data-tray]'), $('[data-stage]')],
    extra: () => ({ day: utcDay() }),
    onChange: () => {
      drawPeople();
      wipeBtn.hidden = !session.isMod();
      for (const { c, el } of cursors.values()) tag(el, c.uuid);
    },
  });

  // The view ------------------------------------------------------------------------------------

  let sharp = false;
  let sharpTimer = 0;
  function onView() {
    sizeLayers();
    placeSheet();
    sharp = false;
    compose();
    drawLive();
    placeCursors();
    clearTimeout(sharpTimer);
    sharpTimer = window.setTimeout(sharpen, 140);
    const pct = `${Math.round(view.z * 100)}%`;
    zoomLevel.textContent = pct;
    zoomLevel.setAttribute('aria-label', view.fitted ? `Zoom ${pct}, fitted` : `Zoom ${pct}. Fit to the window`);
  }
  const view = mountView(viewEl, onView);

  function sizeLayers() {
    const w = Math.round(viewEl.clientWidth * dpr);
    const h = Math.round(viewEl.clientHeight * dpr);
    for (const c of [artEl, liveEl])
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
  }

  function placeSheet() {
    sheet.style.transform = `translate(${view.x}px, ${view.y}px)`;
    sheet.style.width = `${W * view.z}px`;
    sheet.style.height = `${H * view.z}px`;
  }

  /** Sets a layer to draw in canvas pixels at the view, clipped to the paper, wiped first or not. */
  function toView(g: CanvasRenderingContext2D, wipe = true) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (wipe) g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * view.x, dpr * view.y);
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
  }

  /** The strokes on screen: the raster, quickly, or every line again, sharp. */
  function compose() {
    art.save();
    toView(art);
    const source = replayRaster ?? raster;
    if (sharp && !replayRaster) for (const s of sorted()) drawStroke(art, s);
    else {
      art.imageSmoothingQuality = 'high';
      art.drawImage(source, 0, 0, W, H);
    }
    if (replayLine) drawStroke(art, replayLine.s, replayLine.upto);
    art.restore();
  }

  /** Lines again at this zoom, once the view has stopped, when the raster would look soft. */
  function sharpen() {
    if (replaying || view.z * dpr <= R) return;
    sharp = true;
    compose();
  }

  // The canvas -----------------------------------------------------------------------------------

  function rebuild() {
    ras.save();
    ras.setTransform(1, 0, 0, 1, 0, 0);
    ras.clearRect(0, 0, raster.width, raster.height);
    ras.restore();
    const all = sorted();
    for (const s of all) drawStroke(ras, s);
    lastDrawn = all.at(-1)?.ts ?? 0;
    compose();
    describe();
  }

  let rebuildQueued = 0;
  const queueRebuild = () => {
    if (!rebuildQueued) rebuildQueued = requestAnimationFrame(() => ((rebuildQueued = 0), replaying || rebuild()));
  };

  /** One more stroke on top of the rest. */
  function add(s: Stroke) {
    drawStroke(ras, s);
    lastDrawn = s.ts;
    if (sharp) {
      art.save();
      toView(art, false);
      drawStroke(art, s);
      art.restore();
    } else compose();
    describe();
  }

  function describe() {
    const people = new Set([...strokes.values()].map((s) => s.by || s.nick)).size;
    const n = strokes.size;
    artEl.setAttribute(
      'aria-label',
      `${isToday() ? "Today's" : `${dayLabel(day)}'s`} shared drawing, of ${promptFor(day).toLowerCase()}: ${n} ${n === 1 ? 'stroke' : 'strokes'} by ${people} ${people === 1 ? 'person' : 'people'}`,
    );
    queueThumb(day);
    state();
  }

  function onStroke(data: unknown, key: string, onDay: string) {
    if (onDay !== day) return;
    if (data === null) {
      if (strokes.delete(key)) queueRebuild();
      return;
    }
    if (strokes.has(key)) return;
    const s = readStroke(key, data, day);
    if (!s || strokes.size >= MAX_STROKES * 2) return;
    strokes.set(key, s);
    if (replaying) return;
    // In order: just draw it on top. Out of order (an old one arriving late): draw them all again.
    if (s.ts >= lastDrawn) add(s);
    else queueRebuild();
  }

  /** What the page says over the canvas, if anything: why you can't draw. */
  function state() {
    const full = strokes.size >= MAX_STROKES;
    const tired = mineToday().length >= MAX_MINE;
    let text = '';
    if (deleted) text = 'This day was taken down.';
    else if (isToday() && full) text = "Today's canvas is full. A new one starts at midnight UTC.";
    else if (isToday() && tired) text = "You've drawn plenty today. Come back tomorrow!";
    note.textContent = text;
    note.hidden = !text;
    root.toggleAttribute('data-past', !isToday());
    root.toggleAttribute('data-locked', !isToday() || full || tired || deleted || !!replaying);
  }

  // Days -------------------------------------------------------------------------------------------

  function openDay(d: string) {
    stopReplay();
    finish();
    for (const c of dayChains) c.off();
    dayChains.length = 0;
    strokes.clear();
    undone.length = 0;
    for (const { el } of cursors.values()) el.remove();
    cursors.clear();
    day = d;
    following = d === utcDay();
    deleted = false;
    rebuild();
    drawLive();
    $('[data-day-label]').textContent = dayLabel(d);
    $('[data-prompt]').textContent = promptFor(d);
    const url = new URL(location.href);
    url.hash = isToday() ? '' : d;
    history.replaceState(history.state, '', url);

    const strokeChain = paths.strokes(d);
    const meta = paths.meta(d);
    dayChains.push(strokeChain, meta);
    strokeChain.map().on((data, key) => onStroke(data, key, d));
    meta.on((data) => {
      const at = Number((data as Record<string, unknown> | null)?.deletedAt);
      if (d !== day || !at || isToday()) return;
      deleted = true;
      strokes.clear();
      rebuild();
      forgetDay(d);
    });
    if (isToday()) {
      const cursorChain = paths.cursors(d);
      dayChains.push(cursorChain);
      cursorChain.map().on((data, uuid) => onCursor(data, uuid));
    }
    drawDays();
  }

  function addDay(d: string) {
    if (days.has(d)) return;
    days.add(d);
    queueDays();
  }

  function forgetDay(d: string) {
    if (!days.delete(d)) return;
    queueDays();
  }

  let daysQueued = 0;
  const queueDays = () => {
    clearTimeout(daysQueued);
    daysQueued = window.setTimeout(drawDays, 150);
  };

  const thumbs = new Map<string, HTMLCanvasElement>();
  const seen = new IntersectionObserver(
    (list) => {
      for (const e of list) if (e.isIntersecting) loadThumb((e.target as HTMLElement).dataset.day!);
    },
    { root: daysNav, rootMargin: '0px 200px' },
  );

  function drawDays() {
    const list = [...new Set([...days, utcDay(), day])].filter(isDay).sort();
    const links = list.map((d) => {
      const a = document.createElement('a');
      a.href = d === utcDay() ? '#' : `#${d}`;
      a.className = 'pt-day';
      a.dataset.day = d;
      if (d === day) a.setAttribute('aria-current', 'page');
      let c = thumbs.get(d);
      if (!c) {
        c = document.createElement('canvas');
        c.width = THUMB.w * 2;
        c.height = THUMB.h * 2;
        c.setAttribute('aria-hidden', 'true');
        thumbs.set(d, c);
      }
      a.append(c, Object.assign(document.createElement('span'), { textContent: dayShort(d) }));
      return a;
    });
    daysNav.replaceChildren(...links);
    for (const a of links) seen.observe(a);
    daysNav.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const i = list.indexOf(day);
    $<HTMLButtonElement>('[data-day-prev]').disabled = i <= 0;
    $<HTMLButtonElement>('[data-day-next]').disabled = i < 0 || i >= list.length - 1;
  }

  const thumbLoaded = new Set<string>();

  /** A day's picture under the canvas: today's from what's on screen, others' read once. */
  function loadThumb(d: string) {
    if (d === day) return queueThumb(d);
    if (thumbLoaded.has(d)) return;
    thumbLoaded.add(d);
    const got = new Map<string, Stroke>();
    const chain = paths.strokes(d);
    chains.push(chain);
    let quiet = 0;
    const done = () => {
      chain.off();
      // Every stroke undone: an empty canvas isn't a day worth listing.
      if (!got.size) return d !== utcDay() && d !== day && forgetDay(d);
      paintThumb(d, [...got.values()]);
    };
    chain.map().once((data, key) => {
      const s = readStroke(key, data, d);
      if (s) got.set(key, s);
      clearTimeout(quiet);
      quiet = window.setTimeout(done, 700);
    });
    quiet = window.setTimeout(done, 2500);
  }

  function paintThumb(d: string, list: Stroke[]) {
    const c = thumbs.get(d);
    if (!c) return;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    for (const s of list.sort((a, b) => a.ts - b.ts)) drawStroke(g, s);
  }

  let thumbQueued = 0;
  function queueThumb(d: string) {
    if (d !== day) return;
    clearTimeout(thumbQueued);
    thumbQueued = window.setTimeout(() => paintThumb(d, [...strokes.values()]), 600);
  }

  daysNav.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('[data-day]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.day !== day) {
      play('select');
      openDay(a.dataset.day!);
    }
  });

  function step(n: number) {
    const list = [...new Set([...days, utcDay(), day])].filter(isDay).sort();
    const next = list[list.indexOf(day) + n];
    if (next) openDay(next);
  }
  $('[data-day-prev]').addEventListener('click', () => step(-1));
  $('[data-day-next]').addEventListener('click', () => step(1));

  // Drawing ----------------------------------------------------------------------------------------

  const at = (e: PointerEvent) => view.toCanvas(e.clientX, e.clientY);

  function drawLive() {
    live.save();
    toView(live);
    // The eraser shows as paper going over the lines, until it's put down and really takes them off.
    for (const { c } of cursors.values()) if (c.live.length >= 2) drawStroke(live, { ...c, pts: c.live }, c.live.length, '#fff');
    if (current) drawStroke(live, current, current.pts.length, '#fff');
    live.restore();
  }

  let liveQueued = 0;
  const queueLive = () => {
    if (!liveQueued) liveQueued = requestAnimationFrame(() => ((liveQueued = 0), drawLive()));
  };

  const canDraw = () => !root.hasAttribute('data-locked') && session.me.joined;

  /** Fingers on the screen, by pointer id, for pinching. */
  const touches = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'draw' | 'pan' | 'pinch' = 'idle';
  let panFrom = { x: 0, y: 0 };
  let pinch = { dist: 1, z: 1, mid: { x: 0, y: 0 } };
  let spaceHeld = false;

  const pinchNow = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  function down(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // A second finger: a pinch. A line the first one only just began is taken back.
        if (mode === 'draw' && current && Date.now() - currentAt < PINCH_GRACE * 2) {
          current = null;
          queueLive();
        } else if (mode === 'draw') finish();
        const p = pinchNow();
        pinch = { dist: p.dist, z: view.z, mid: p.mid };
        mode = 'pinch';
        return;
      }
      if (touches.size > 2) return;
    }
    viewEl.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && (spaceHeld || tool === 'hand'))) {
      e.preventDefault();
      mode = 'pan';
      panFrom = { x: e.clientX, y: e.clientY };
      root.setAttribute('data-panning', '');
      return;
    }
    if (e.button !== 0 || current) return;
    if (e.altKey) return pick(at(e));
    if (!canDraw()) {
      if (isToday()) play('nope');
      return;
    }
    e.preventDefault();
    const p = at(e);
    current = { ...pen, pts: [p.x, p.y] };
    currentAt = Date.now();
    mode = 'draw';
    undone.length = 0;
    queueLive();
    sendCursor(p, true);
  }

  function move(e: PointerEvent) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch') {
      if (touches.size < 2) return;
      const p = pinchNow();
      view.zoomAt(pinch.z * (p.dist / pinch.dist), p.mid.x, p.mid.y);
      view.panBy(p.mid.x - pinch.mid.x, p.mid.y - pinch.mid.y);
      pinch.mid = p.mid;
      return;
    }
    if (mode === 'pan') {
      view.panBy(e.clientX - panFrom.x, e.clientY - panFrom.y);
      panFrom = { x: e.clientX, y: e.clientY };
      return;
    }
    const p = at(e);
    showBrush(e);
    if (!current) return sendCursor(p);
    const minStep = MIN_STEP / view.z;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const q = at(ev);
      const n = current.pts.length;
      if (Math.hypot(q.x - current.pts[n - 2], q.y - current.pts[n - 1]) < minStep) continue;
      current.pts.push(q.x, q.y);
      // A very long line goes up in pieces, each starting where the last one ended.
      if (current.pts.length >= MAX_POINTS * 2) {
        const last = current.pts.slice(-2);
        finish();
        current = { ...pen, pts: last };
      }
    }
    queueLive();
    sendCursor(p);
  }

  /** Puts down the line being drawn, if there is one. */
  function finish() {
    const line = current;
    current = null;
    if (!line) return;
    if (line.pts.length === 2) line.pts.push(line.pts[0] + 0.1, line.pts[1]);
    const key = strokeKey(session.me.uuid);
    const s: Stroke = { key, ...line, ts: Math.max(Date.now(), lastDrawn), by: session.me.uuid, nick: session.me.nick };
    strokes.set(key, s);
    add(s);
    paths.strokes(day).get(key).put(writeStroke(s));
    if (!registered.has(day)) {
      registered.add(day);
      register(day);
      addDay(day);
    }
    queueLive();
  }

  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (mode === 'pinch') {
      // Lifting one finger of two doesn't start a line with the other.
      if (!touches.size) mode = 'idle';
      return;
    }
    if (mode === 'pan') root.removeAttribute('data-panning');
    if (mode === 'draw') {
      finish();
      sendCursor(at(e), true);
      track('paint_stroke_drawn', { tool: pen.eraser ? 'eraser' : 'pen' });
    }
    mode = 'idle';
  }

  viewEl.addEventListener('pointerdown', down);
  viewEl.addEventListener('pointermove', move);
  viewEl.addEventListener('pointerup', up);
  viewEl.addEventListener('pointercancel', up);
  viewEl.addEventListener('pointerleave', (e) => {
    brush.hidden = true;
    if (!current && e.pointerType !== 'touch') leaveCursor();
  });
  // The middle button pans; it shouldn't also start the browser's autoscroll.
  viewEl.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
  viewEl.addEventListener('contextmenu', (e) => mode !== 'idle' && e.preventDefault());

  /** The pen's size as a ring under the pointer, at the zoom you're at. */
  function showBrush(e: PointerEvent) {
    const show = e.pointerType === 'mouse' && tool !== 'hand' && !spaceHeld && canDraw();
    brush.hidden = !show;
    if (!show) return;
    const r = viewEl.getBoundingClientRect();
    const d = Math.max(4, pen.width * view.z);
    brush.style.width = brush.style.height = `${d}px`;
    brush.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
  }

  /** Alt and a click: the colour under the pointer, as the nearest in the palette. */
  function pick(p: { x: number; y: number }) {
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
    const [r, g, b, a] = ras.getImageData(Math.floor(p.x * R), Math.floor(p.y * R), 1, 1).data;
    const rgb = a < 40 ? [255, 255, 255] : [r, g, b];
    const near = PALETTE.map((c) => {
      const n = parseInt(c.color.slice(1), 16);
      return { c, d: (rgb[0] - (n >> 16)) ** 2 + (rgb[1] - ((n >> 8) & 255)) ** 2 + (rgb[2] - (n & 255)) ** 2 };
    }).sort((x, y) => x.d - y.d)[0].c;
    $<HTMLButtonElement>(`[data-color="${near.color}"]`).click();
    play('tick');
  }

  function undo() {
    if (!isToday() || replaying) return;
    const last = mineToday().sort((a, b) => b.ts - a.ts)[0];
    if (!last) return play('nope');
    strokes.delete(last.key);
    undone.push(last);
    paths.strokes(day).get(last.key).put(null);
    rebuild();
    play('back');
  }

  function redo() {
    if (!isToday() || replaying) return;
    const s = undone.pop();
    if (!s) return play('nope');
    const again = { ...s, key: strokeKey(session.me.uuid), ts: Math.max(Date.now(), lastDrawn) };
    strokes.set(again.key, again);
    paths.strokes(day).get(again.key).put(writeStroke(again));
    add(again);
    play('tick');
  }
  $('[data-undo]').addEventListener('click', undo);
  $('[data-redo]').addEventListener('click', redo);

  // The tools.
  function setTool(t: Tool) {
    tool = t;
    if (t !== 'hand') pen.eraser = t === 'eraser';
    root.dataset.tool = t;
    for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  }
  function setSize(w: number) {
    pen.width = w;
    for (const b of $$('[data-size]')) b.setAttribute('aria-checked', String(Number(b.dataset.size) === w));
  }
  for (const b of $$<HTMLButtonElement>('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
  for (const b of $$<HTMLButtonElement>('[data-size]')) b.addEventListener('click', () => setSize(Number(b.dataset.size)));
  for (const b of $$<HTMLButtonElement>('[data-color]'))
    b.addEventListener('click', () => {
      pen.color = b.dataset.color!;
      for (const t of $$('[data-color]')) t.setAttribute('aria-checked', String(t === b));
      if (tool !== 'pen') setTool('pen');
    });
  setTool('pen');

  $('[data-zoom-in]').addEventListener('click', () => view.zoomStep(1));
  $('[data-zoom-out]').addEventListener('click', () => view.zoomStep(-1));
  zoomLevel.addEventListener('click', () => (view.fitted ? view.actual() : view.fit()));
  // A double click with the hand fits, as in Photoshop.
  viewEl.addEventListener('dblclick', () => tool === 'hand' && view.fit());

  const typing = (e: Event) => e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable]');
  const gateUp = () => root.querySelector('[data-gate]:not([hidden])') !== null;

  const onKey = (e: KeyboardEvent) => {
    if (typing(e) || gateUp()) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && k === 'y') {
      e.preventDefault();
      return redo();
    }
    if (mod && (k === '=' || k === '+')) {
      e.preventDefault();
      return view.zoomStep(1);
    }
    if (mod && (k === '-' || k === '_')) {
      e.preventDefault();
      return view.zoomStep(-1);
    }
    if (mod && k === '0') {
      e.preventDefault();
      return view.fit();
    }
    if (mod && k === '1') {
      e.preventDefault();
      return view.actual();
    }
    if (mod || e.altKey) return;
    if (k === ' ' && !e.repeat) {
      e.preventDefault();
      spaceHeld = true;
      root.setAttribute('data-space', '');
      brush.hidden = true;
      return;
    }
    if (k === 'p') setTool('pen');
    else if (k === 'e') setTool('eraser');
    else if (k === 'h') setTool('hand');
    else if (k === '[' || k === ']') {
      const i = SIZES.indexOf(pen.width);
      setSize(SIZES[Math.max(0, Math.min(SIZES.length - 1, i + (k === ']' ? 1 : -1)))]);
    } else return;
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== ' ') return;
    spaceHeld = false;
    root.removeAttribute('data-space');
  };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);

  // A mod can wipe today, or take a day before it down. The relay has no accounts: moderation by
  // courtesy, as in the chat.
  wipeBtn.addEventListener('click', () => {
    if (!session.isMod() || !confirm(isToday() ? 'Wipe everything drawn today?' : `Take ${dayLabel(day)} down?`)) return;
    if (isToday()) {
      for (const key of strokes.keys()) paths.strokes(day).get(key).put(null);
      strokes.clear();
      rebuild();
    } else paths.meta(day).put({ deletedAt: Date.now(), deletedBy: session.me.nick });
    play('back');
  });

  // Cursors ----------------------------------------------------------------------------------------

  let lastSent = 0;
  let sendQueued = 0;
  let pending: { x: number; y: number } | null = null;

  function sendCursor(p: { x: number; y: number }, now = false) {
    if (!session.me.joined || !isToday()) return;
    pending = p;
    const wait = CURSOR_EVERY - (Date.now() - lastSent);
    if (now || wait <= 0) return flushCursor();
    if (!sendQueued) sendQueued = window.setTimeout(flushCursor, wait);
  }

  function flushCursor() {
    clearTimeout(sendQueued);
    sendQueued = 0;
    if (!pending || !session.me.joined) return;
    lastSent = Date.now();
    paths
      .cursors(day)
      .get(session.me.uuid)
      .put({
        x: Math.round(pending.x),
        y: Math.round(pending.y),
        t: lastSent,
        c: pen.color,
        w: pen.width,
        e: pen.eraser,
        live: current ? packPoints(current.pts) : '',
      });
  }

  function leaveCursor() {
    pending = null;
    clearTimeout(sendQueued);
    sendQueued = 0;
    if (session.me.joined && isToday()) paths.cursors(day).get(session.me.uuid).put({ x: -1, y: -1, t: Date.now(), live: '' });
  }

  /** The name and face on someone's cursor, once their presence says who they are. */
  function tag(el: HTMLElement, uuid: string) {
    const who = session.online.get(uuid);
    const label = el.querySelector<HTMLElement>('.pt-cursor-tag')!;
    if (!who) return void (label.hidden = true);
    label.hidden = false;
    if (label.dataset.nick === who.nick) return;
    label.dataset.nick = who.nick;
    label.replaceChildren(session.face(uuid, uuid, 'face'), Object.assign(document.createElement('span'), { textContent: who.nick }));
  }

  function placeCursor(k: { c: Cursor; el: HTMLElement }) {
    const sx = view.x + k.c.x * view.z;
    const sy = view.y + k.c.y * view.z;
    k.el.style.transform = `translate(${sx}px, ${sy}px)`;
    k.el.classList.toggle('is-right', sx > viewEl.clientWidth * 0.62);
    k.el.hidden = sx < -40 || sy < -40 || sx > viewEl.clientWidth + 40 || sy > viewEl.clientHeight + 40;
  }

  function placeCursors() {
    for (const k of cursors.values()) placeCursor(k);
  }

  function onCursor(data: unknown, uuid: string) {
    if (uuid === session.me.uuid) return;
    const c = readCursor(uuid, data);
    let known = cursors.get(uuid);
    if (!c || c.x < 0 || Date.now() - c.time > CURSOR_GONE) {
      if (known) {
        known.el.remove();
        cursors.delete(uuid);
        queueLive();
      }
      return;
    }
    if (!known) {
      if (cursors.size > 40) return;
      const el = document.createElement('div');
      el.className = 'pt-cursor';
      el.style.setProperty('--hue', String(hueOf(uuid)));
      el.append(Object.assign(document.createElement('span'), { className: 'pt-cursor-dot' }), Object.assign(document.createElement('span'), { className: 'pt-cursor-tag' }));
      cursorLayer.append(el);
      known = { c, el };
      cursors.set(uuid, known);
      tag(el, uuid);
    }
    known.c = c;
    placeCursor(known);
    known.el.querySelector<HTMLElement>('.pt-cursor-dot')!.style.background = c.eraser ? '#fff' : c.color;
    queueLive();
  }

  // People -----------------------------------------------------------------------------------------

  function drawPeople() {
    const today = utcDay();
    const here = [...session.online.values()].filter((p) => p.data.day === today);
    const others = here.filter((p) => p.uuid !== session.me.uuid);
    const btn = $<HTMLButtonElement>('[data-people]');
    btn.hidden = here.length === 0;
    $('[data-count]').textContent = String(here.length);
    btn.setAttribute('aria-label', others.length ? `Drawing now: ${here.map((p) => p.nick).join(', ')}` : 'Only you are drawing');
    btn.title = here.map((p) => p.nick).join(', ');
    $('[data-stack]').replaceChildren(...here.slice(0, 4).map((p) => session.face(p.uuid, p.uuid)));
  }

  // Replay and save ----------------------------------------------------------------------------------

  function stopReplay() {
    if (!replaying) return;
    cancelAnimationFrame(replaying);
    replaying = 0;
    replayRaster = null;
    replayLine = null;
    root.removeAttribute('data-replaying');
    replayBtn.querySelector('span')!.textContent = 'Replay';
    state();
    compose();
    sharpen();
  }

  function replay() {
    if (replaying) return stopReplay();
    const list = sorted();
    if (!list.length) return play('nope');
    track('paint_replayed', { day });
    finish();
    const total = list.reduce((n, s) => n + s.pts.length / 2, 0);
    const duration = Math.min(REPLAY_MAX, Math.max(3000, list.length * 150));
    const done = Object.assign(document.createElement('canvas'), { width: W * R, height: H * R });
    const dg = done.getContext('2d')!;
    dg.setTransform(R, 0, 0, R, 0, 0);
    replayRaster = done;
    let i = 0;
    let drawnPts = 0;
    const start = performance.now();
    root.setAttribute('data-replaying', '');
    replayBtn.querySelector('span')!.textContent = 'Stop';
    const frame = (t: number) => {
      const want = Math.min(total, ((t - start) / duration) * total);
      while (i < list.length && drawnPts + list[i].pts.length / 2 <= want) {
        drawStroke(dg, list[i]);
        drawnPts += list[i].pts.length / 2;
        i++;
      }
      if (i >= list.length) return stopReplay();
      replayLine = { s: list[i], upto: Math.max(2, Math.floor((want - drawnPts) * 2)) };
      compose();
      replaying = requestAnimationFrame(frame);
    };
    replaying = requestAnimationFrame(frame);
    state();
  }
  replayBtn.addEventListener('click', replay);

  $('[data-save]').addEventListener('click', () => {
    track('paint_saved', { day });
    const out = Object.assign(document.createElement('canvas'), { width: raster.width, height: raster.height });
    const g = out.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(raster, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ankush-one-paint-${day}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });

  // Start ------------------------------------------------------------------------------------------

  const boards = paths.boards();
  chains.push(boards);
  boards.map().on((_data, key) => {
    const d = dayOf(key);
    if (d) addDay(d);
  });

  const stopWatch = watchConnection((on) => ($('[data-status]').hidden = on));

  timers.push(
    // Midnight, UTC: today's canvas is done, and a new one starts.
    window.setInterval(() => {
      if (following && day !== utcDay() && !current && !replaying) openDay(utcDay());
    }, 20000),
    window.setInterval(() => {
      const now = Date.now();
      for (const [uuid, k] of cursors)
        if (now - k.c.time > CURSOR_GONE) {
          k.el.remove();
          cursors.delete(uuid);
          queueLive();
        }
    }, 3000),
  );

  onView();
  const asked = decodeURIComponent(location.hash.slice(1));
  openDay(isDay(asked) ? asked : utcDay());

  return () => {
    finish();
    leaveCursor();
    stopReplay();
    stopWatch();
    seen.disconnect();
    view.destroy();
    for (const c of [...chains, ...dayChains]) c.off();
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    clearTimeout(daysQueued);
    clearTimeout(thumbQueued);
    clearTimeout(sendQueued);
    clearTimeout(sharpTimer);
    cancelAnimationFrame(rebuildQueued);
    cancelAnimationFrame(liveQueued);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKeyUp);
    session.destroy();
  };
}
