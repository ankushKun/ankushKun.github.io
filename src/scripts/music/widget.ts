// Runs the radio's widget (src/components/music/Widget.astro). It is one element for the whole
// visit, so it is wired once.
import { clock } from '../../data/music';
import * as music from './engine';

/** How long the playing track's name shows beside the button when a new one starts, as long as the plaza's "Now playing" bubble. */
const TELL_MS = 3000;

/** Something on screen the player can open over, in viewport pixels: its middle and its top and bottom edges. */
export interface Spot {
  x: number;
  top: number;
  bottom: number;
}

/**
 * The player opens out of the widget's button, or over something else that asks for it (the
 * plaza's DJ), following it while it moves and closing when it is gone. One player either way.
 */
let over: (() => Spot | null) | null = null;
let follow = () => undefined as void;
let close = () => undefined as void;
let show = () => undefined as void;

/** The next time the player opens, it opens over what `where` points at. Set it as the press that opens it lands. */
export function openOver(where: () => Spot | null) {
  over = where;
}

/** Whether the player is open, and where: over something, or in its corner. */
export function playerOpen(): 'over' | 'corner' | null {
  const pop = document.querySelector('.music-pop');
  if (!pop?.matches(':popover-open')) return null;
  return pop.hasAttribute('data-over') ? 'over' : 'corner';
}

/** Keeps the player over what it opened over. Call each frame while that can move. */
export function followPlayer() {
  follow();
}

/** Opens the player over what `where` points at now, or moves it there if it is open in its corner. */
export function showOver(where: () => Spot | null) {
  over = where;
  show();
}

/** Closes the player if it is open over something. */
export function closeOver() {
  close();
}

function wire(root: HTMLElement) {
  if (root.dataset.wired) return;
  root.dataset.wired = '1';
  root.hidden = false;

  const $ = <E extends Element>(sel: string) => root.querySelector<E>(sel)!;
  const button = $<HTMLButtonElement>('.music-btn');
  const pop = $<HTMLElement>('.music-pop');
  const now = $<HTMLElement>('.music-now');
  const nowText = $<HTMLElement>('.music-now span');
  const art = $<HTMLImageElement>('.music-art img');
  const title = $<HTMLElement>('.music-title');
  const artist = $<HTMLElement>('.music-artist');
  const at = $<HTMLElement>('[data-at]');
  const left = $<HTMLElement>('[data-left]');
  const seek = $<HTMLInputElement>('[data-seek]');
  const volume = $<HTMLInputElement>('[data-volume]');
  const playBtn = $<HTMLButtonElement>('[data-play]');
  const mute = $<HTMLButtonElement>('[data-mute]');

  // YouTube starts loading as soon as the widget is reached for, so a press plays at once.
  for (const type of ['pointerenter', 'focusin', 'touchstart'] as const) root.addEventListener(type, music.prepare, { once: true, passive: true });

  playBtn.addEventListener('click', music.toggle);
  $('[data-prev]').addEventListener('click', music.prev);
  $('[data-next]').addEventListener('click', music.next);
  mute.addEventListener('click', () => music.setMuted(!music.snapshot().muted));
  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    paintRange(seek);
    at.textContent = clock(+seek.value);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    music.seek(+seek.value);
  });
  volume.addEventListener('input', () => {
    music.setVolume(+volume.value);
    paintRange(volume);
  });
  // Opening the app closes the player on the way.
  $('.music-open').addEventListener('click', () => pop.hidePopover());

  // The player drops out of the button into the corner it sits in, its corner just past the note's,
  // as far from the side of the screen as from the top, so it sits square in that corner. On a
  // phone, where the buttons run along the top, it sits in the middle under them.
  /** Where it was last put over something, so following it only writes when it moves. */
  let placed = '';
  pop.addEventListener('beforetoggle', (e) => {
    // Every open places it afresh. (The toggle event that follows can merge a close and an open
    // into one, so this is the place to reset.)
    placed = '';
    if ((e as ToggleEvent).newState !== 'open') {
      over = null;
      return;
    }
    if (over) {
      placeOver(over);
      return;
    }
    delete pop.dataset.over;
    // The note, or the bars while music is heard: whichever is showing.
    const glyph = [...button.querySelectorAll('.music-note, .music-bars')].map((el) => el.getBoundingClientRect()).find((r) => r.width) ?? button.getBoundingClientRect();
    const right = glyph.left + glyph.width / 2 > innerWidth / 2;
    const below = glyph.top + glyph.height / 2 < innerHeight / 2;
    const gap = 8;
    const fromTop = below ? glyph.bottom + gap : innerHeight - glyph.top + gap;
    const fromSide = right ? innerWidth - glyph.left + gap : glyph.right + gap;
    const inset = Math.max(fromTop, fromSide);
    // Not laid out yet while closed: its width is the one in Widget.astro.
    const width = Math.min(280, innerWidth - 24);
    const side = innerWidth < 880 ? (innerWidth - width) / 2 : Math.max(12, Math.min(inset, innerWidth - width - 12));
    const top = innerWidth < 880 ? fromTop : inset;
    Object.assign(pop.style, {
      left: right ? 'auto' : `${side}px`,
      right: right ? `${side}px` : 'auto',
      top: below ? `${top}px` : 'auto',
      bottom: below ? 'auto' : `${top}px`,
      transformOrigin: `${right ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`,
    });
  });

  // Over something, the player sits centred just above it, growing out of it and shrinking back
  // into it, or just below if there is no room above; kept on screen either way.
  function placeOver(where: () => Spot | null) {
    const s = where();
    if (!s) {
      if (pop.matches(':popover-open')) pop.hidePopover();
      return;
    }
    pop.dataset.over = '';
    const width = Math.min(280, innerWidth - 24);
    // Not laid out yet while closed: about the height in Widget.astro.
    const height = pop.offsetHeight || 190;
    const gap = 12;
    const left = Math.round(Math.min(Math.max(12, s.x - width / 2), innerWidth - width - 12));
    const above = s.top - gap - height >= 12;
    const edge = Math.round(above ? innerHeight - s.top + gap : s.bottom + gap);
    const key = `${left}|${edge}|${above}`;
    if (key === placed) return;
    placed = key;
    Object.assign(pop.style, {
      left: `${left}px`,
      right: 'auto',
      top: above ? 'auto' : `${edge}px`,
      bottom: above ? `${edge}px` : 'auto',
      // Out of what it is over: just above its top, or just below its bottom.
      transformOrigin: `${Math.round(s.x - left)}px ${above ? `calc(100% + ${gap}px)` : `-${gap}px`}`,
    });
  }
  follow = () => {
    if (over && pop.matches(':popover-open')) placeOver(over);
  };
  close = () => {
    if (pop.hasAttribute('data-over') && pop.matches(':popover-open')) pop.hidePopover();
  };
  show = () => {
    if (pop.matches(':popover-open')) follow();
    else pop.showPopover();
  };

  // A new track: its name shows beside the button for a moment.
  let told = -1;
  let tellTimer = 0;
  function tell(text: string) {
    nowText.textContent = text;
    root.dataset.telling = '';
    requestAnimationFrame(() => {
      const over = nowText.scrollWidth - (now.clientWidth - 22);
      now.toggleAttribute('data-long', over > 0);
      now.style.setProperty('--shift', `${-Math.max(0, over)}px`);
    });
    clearTimeout(tellTimer);
    tellTimer = window.setTimeout(() => delete root.dataset.telling, TELL_MS);
  }
  root.addEventListener('pointerenter', () => {
    const s = music.snapshot();
    const t = s.tracks[s.index];
    if (t && s.playing && !pop.matches(':popover-open')) tell(`${t.title} by ${t.artist}`);
  });
  button.addEventListener('click', () => {
    delete root.dataset.telling;
    over = null;
  });

  let shownArt = '';
  music.subscribe((s) => {
    const t = s.tracks[s.index];
    root.toggleAttribute('data-audible', s.audible);
    playBtn.setAttribute('aria-pressed', String(s.playing && !s.blocked));
    playBtn.setAttribute('aria-label', s.playing && !s.blocked ? 'Pause' : 'Play');
    mute.setAttribute('aria-pressed', String(s.muted || s.volume === 0));
    mute.setAttribute('aria-label', s.muted ? 'Unmute' : 'Mute');
    if (document.activeElement !== volume) {
      volume.value = String(s.muted ? 0 : s.volume);
      paintRange(volume);
    }
    button.setAttribute('aria-label', t && s.playing ? `Music: ${t.title} by ${t.artist}` : 'Music');

    if (t) {
      title.textContent = t.title;
      artist.textContent = s.error ?? t.artist;
      if (shownArt !== t.thumb) {
        shownArt = t.thumb;
        art.src = t.thumb;
        art.hidden = false;
      }
      if (s.index !== told && s.playing) {
        told = s.index;
        if (!pop.matches(':popover-open')) tell(`${t.title} by ${t.artist}`);
      }
    } else if (s.error) artist.textContent = s.error;

    if (!seeking) {
      seek.max = String(Math.max(1, Math.round(s.duration)));
      seek.value = String(Math.round(s.position));
      seek.disabled = !t;
      paintRange(seek);
      at.textContent = clock(s.position);
    }
    left.textContent = `-${clock(Math.max(0, s.duration - (seeking ? +seek.value : s.position)))}`;
  });
}

/** The filled part of a slider, as a share of its length. */
export function paintRange(input: HTMLInputElement) {
  const max = +input.max || 1;
  input.style.setProperty('--fill', `${(+input.value / max) * 100}%`);
}

const find = () => document.querySelector<HTMLElement>('[data-music-widget]');
const root = find();
if (root) wire(root);
document.addEventListener('astro:page-load', () => {
  const el = find();
  if (el) wire(el);
});
