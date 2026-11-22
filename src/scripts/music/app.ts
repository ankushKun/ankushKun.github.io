// Runs the Music app (src/components/music/Music.astro): a view of the radio (engine.ts), wired each
// time the page is shown and let go when it is left, so the music itself carries on.
import { clock } from '../../data/music';
import * as music from './engine';
import { paintRange } from './widget';

/** Cover Flow's geometry, in covers: how far the side covers sit and how many show each way. */
const SIDE = 6;

function mount(root: HTMLElement) {
  const ac = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts: AddEventListenerOptions = {}) =>
    el.addEventListener(type, fn as EventListener, { ...opts, signal: ac.signal });
  const $ = <E extends Element>(sel: string) => root.querySelector<E>(sel)!;

  music.prepare();

  const playBtn = $<HTMLButtonElement>('[data-play]');
  const volume = $<HTMLInputElement>('[data-volume]');
  const seek = $<HTMLInputElement>('[data-seek]');
  const at = $<HTMLElement>('[data-at]');
  const left = $<HTMLElement>('[data-left]');
  const art = $<HTMLImageElement>('.mu-lcd-art img');
  const title = $<HTMLElement>('.mu-lcd-title');
  const artist = $<HTMLElement>('.mu-lcd-artist');
  const shuffle = $<HTMLButtonElement>('[data-shuffle]');
  const repeat = $<HTMLButtonElement>('[data-repeat]');
  const filter = $<HTMLInputElement>('[data-filter]');
  const status = $<HTMLElement>('[data-status]');
  const flow = $<HTMLElement>('[data-flow]');
  const covers = [...root.querySelectorAll<HTMLButtonElement>('.mu-cover')];
  const flowTitle = $<HTMLElement>('.mu-flow-title');
  const flowArtist = $<HTMLElement>('.mu-flow-artist');
  const tbody = $<HTMLTableSectionElement>('tbody');
  const rows = [...tbody.querySelectorAll<HTMLTableRowElement>('tr')];

  on(playBtn, 'click', music.toggle);
  on($('[data-prev]'), 'click', music.prev);
  on($('[data-next]'), 'click', music.next);
  on(shuffle, 'click', () => music.setShuffle(!music.snapshot().shuffle));
  on(repeat, 'click', music.cycleRepeat);
  on(volume, 'input', () => {
    music.setVolume(+volume.value);
    paintRange(volume);
  });
  let seeking = false;
  on(seek, 'input', () => {
    seeking = true;
    paintRange(seek);
    at.textContent = clock(+seek.value);
  });
  on(seek, 'change', () => {
    seeking = false;
    music.seek(+seek.value);
  });

  // The songs: a press plays one. Headers sort; search narrows the list.
  on(tbody, 'click', (e) => {
    const row = (e.target as Element).closest<HTMLTableRowElement>('tr[data-i]');
    if (row) play(+row.dataset.i!);
  });
  on(root, 'click', (e) => {
    const th = (e.target as Element).closest<HTMLButtonElement>('[data-sort]');
    if (th) sortBy(th);
  });
  on(filter, 'input', () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = !q || `${row.dataset.title} ${row.dataset.artist}`.toLowerCase().includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    }
    status.textContent = q ? `${shown} of ${rows.length} songs` : (status.dataset.total ?? '');
  });

  function sortBy(button: HTMLButtonElement) {
    const key = button.dataset.sort!;
    const th = button.closest('th')!;
    const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
    for (const other of root.querySelectorAll('th')) other.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    const value = (r: HTMLTableRowElement) =>
      key === 'index' ? +r.dataset.i! : key === 'time' ? +r.dataset.time! : (r.dataset[key] ?? '').toLowerCase();
    const sorted = [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    tbody.append(...sorted);
  }

  function play(i: number) {
    const s = music.snapshot();
    if (s.index === i && s.playing && !s.blocked) return;
    if (s.index === i) music.play();
    else music.choose(i);
    center = i;
    placeCovers();
  }

  // Cover Flow: the cover in the middle faces you, the rest turn away to either side. Pressing a side
  // cover brings it to the middle; pressing the middle one plays it. Arrows, the wheel and a swipe move
  // along. It follows the radio unless you have just been browsing.
  let center = Math.max(0, music.snapshot().index);
  let browsedAt = 0;
  function placeCovers() {
    const w = covers[0]?.offsetWidth || 200;
    covers.forEach((c, i) => {
      const d = i - center;
      const far = Math.abs(d) > SIDE;
      c.hidden = far;
      if (far) return;
      const side = Math.sign(d);
      const x = d === 0 ? 0 : side * (w * 0.78 + (Math.abs(d) - 1) * w * 0.32);
      c.style.transform = d === 0 ? 'translateZ(60px)' : `translateX(${x}px) rotateY(${-side * 58}deg)`;
      c.style.zIndex = String(SIDE + 1 - Math.abs(d));
      c.style.filter = d === 0 ? '' : `brightness(${1 - Math.min(0.55, Math.abs(d) * 0.1)})`;
      c.toggleAttribute('aria-current', d === 0);
    });
    const t = music.snapshot().tracks[center];
    if (t) {
      flowTitle.textContent = t.title;
      flowArtist.textContent = t.artist;
    }
  }
  function browse(to: number) {
    const n = Math.max(0, Math.min(covers.length - 1, to));
    if (n === center) return;
    center = n;
    browsedAt = performance.now();
    placeCovers();
  }
  on(flow, 'click', (e) => {
    const cover = (e.target as Element).closest<HTMLButtonElement>('.mu-cover');
    if (!cover) return;
    const i = +cover.dataset.i!;
    if (i === center) play(i);
    else browse(i);
  });
  on(flow, 'keydown', (e) => {
    if (e.key === 'ArrowLeft') browse(center - 1);
    else if (e.key === 'ArrowRight') browse(center + 1);
    else if (e.key === 'Enter' || e.key === ' ') play(center);
    else return;
    e.preventDefault();
  });
  let wheel = 0;
  on(
    flow,
    'wheel',
    (e) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheel += delta;
      e.preventDefault();
      if (Math.abs(wheel) < 60) return;
      browse(center + Math.sign(wheel));
      wheel = 0;
    },
    { passive: false },
  );
  let swipe: { x: number; at: number } | null = null;
  on(flow, 'pointerdown', (e) => {
    if (e.pointerType !== 'mouse') swipe = { x: e.clientX, at: center };
  });
  on(flow, 'pointermove', (e) => {
    if (swipe) browse(swipe.at - Math.round((e.clientX - swipe.x) / 50));
  });
  on(flow, 'pointerup', () => (swipe = null));
  on(window, 'resize', placeCovers);

  let shownArt = '';
  let lastIndex = -2;
  const stop = music.subscribe((s) => {
    const t = s.tracks[s.index];
    root.toggleAttribute('data-audible', s.audible);
    playBtn.setAttribute('aria-pressed', String(s.playing && !s.blocked));
    playBtn.setAttribute('aria-label', s.playing && !s.blocked ? 'Pause' : 'Play');
    shuffle.setAttribute('aria-pressed', String(s.shuffle));
    repeat.setAttribute('aria-pressed', String(s.repeat !== 'off'));
    repeat.dataset.mode = s.repeat;
    repeat.setAttribute('aria-label', s.repeat === 'one' ? 'Repeat one' : s.repeat === 'all' ? 'Repeat all' : 'Repeat off');
    if (document.activeElement !== volume) {
      volume.value = String(s.muted ? 0 : s.volume);
      paintRange(volume);
    }
    if (t) {
      title.textContent = t.title;
      artist.textContent = s.error ?? (s.blocked ? 'Press play to listen' : t.artist);
      if (shownArt !== t.thumb) {
        shownArt = t.thumb;
        art.src = t.thumb;
        art.hidden = false;
      }
    } else if (s.error) artist.textContent = s.error;
    if (!seeking) {
      seek.disabled = !t;
      seek.max = String(Math.max(1, Math.round(s.duration)));
      seek.value = String(Math.round(s.position));
      paintRange(seek);
      at.textContent = clock(s.position);
    }
    left.textContent = `-${clock(Math.max(0, s.duration - (seeking ? +seek.value : s.position)))}`;

    if (s.index !== lastIndex) {
      lastIndex = s.index;
      for (const row of rows) row.toggleAttribute('aria-current', +row.dataset.i! === s.index);
      // The flow comes back to what is playing, unless you were just looking through it.
      if (s.index >= 0 && performance.now() - browsedAt > 4000) {
        center = s.index;
        placeCovers();
      }
    }
  });
  placeCovers();

  return () => {
    stop();
    ac.abort();
  };
}

let unmount: (() => void) | null = null;
function attach() {
  unmount?.();
  unmount = null;
  const root = document.querySelector<HTMLElement>('[data-music-app]');
  if (root) unmount = mount(root);
}
document.addEventListener('astro:page-load', attach);
document.addEventListener('astro:before-swap', () => {
  unmount?.();
  unmount = null;
});
