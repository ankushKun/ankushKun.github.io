// The site's radio: one player for the whole visit, shared by the widget, the Music app and the
// plaza. The site is one document from the first page to the last (Astro's router, even to and
// from the plaza), so this module, and the hidden YouTube player it drives (youtube.ts), live as
// long as the tab does and the music runs straight through every page change.
//
// - The plaza starts it: its opening plays the plaza's own theme, which fades into a random track
//   once the crowd is in, or as soon as the opening is skipped (`takeOver`). The two never play at once.
// - Every load starts quiet, at 25%. Nothing about playback is kept across loads except that the
//   visitor stopped it, which holds for the rest of the session.
// - A game or a video on the page holds it (`hold`): it fades out and waits, then comes back.
// - One tab plays at a time. M mutes it, along with the UI sounds (sfx.ts).
import { MUSIC, type Track } from '../../data/music';
import { STATE, createPlayer, type Player } from './youtube';

export type Repeat = 'off' | 'all' | 'one';

export interface MusicState {
  readonly tracks: readonly Track[];
  /** The track in the player, or -1 before the first. */
  index: number;
  /** Meant to be playing: pressed play, or started by the plaza. */
  playing: boolean;
  /** Sound is coming out: playing, not held, not muted. */
  audible: boolean;
  loading: boolean;
  position: number;
  duration: number;
  /** 0 to 100. */
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  /** The browser wouldn't let it start on its own; the next press anywhere starts it. */
  blocked: boolean;
  error: string | null;
}

const VOLUME = 25;
const STOPPED = 'music-stopped';
const tracks = MUSIC.tracks;

const state: MusicState = {
  tracks,
  index: -1,
  playing: false,
  audible: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: VOLUME,
  muted: false,
  shuffle: true,
  repeat: 'all',
  blocked: false,
  error: null,
};

let player: Player | null = null;
let making: Promise<Player | null> | null = null;
let yt: number = STATE.UNSTARTED;
/** The video in the player, which may differ from the track shown while one loads. */
let loaded = '';
/** Volume multiplier for fades, 0 to 1. */
let gain = 1;
let fading = 0;
/** Seconds to fade in over once the track just asked for starts. */
let fadeIn = 0;
const holds = new Set<string>();
/** Tracks played before this one, latest last, for Previous and to keep shuffle from repeating. */
const history: number[] = [];
let failures = 0;

// Telling everyone -----------------------------------------------------------------------------

type Listener = (s: Readonly<MusicState>) => void;
const listeners = new Set<Listener>();
let queued = false;
function emit() {
  state.audible = yt === STATE.PLAYING && state.playing && !holds.size && !state.muted && state.volume > 0;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn(state);
  });
}

/** Calls `fn` now and on every change, position included (a few times a second while playing). */
export function subscribe(fn: Listener) {
  listeners.add(fn);
  fn(state);
  return () => void listeners.delete(fn);
}

export const snapshot = (): Readonly<MusicState> => state;

// The player -----------------------------------------------------------------------------------

function ensure(): Promise<Player | null> {
  return (making ??= createPlayer({ state: onState, error: onError }).then(
    (p) => {
      player = p;
      apply();
      return p;
    },
    (err: unknown) => {
      console.warn(err);
      making = null;
      state.loading = false;
      state.error = 'Could not reach YouTube';
      emit();
      return null;
    },
  ));
}

/** Loads YouTube ahead of need, so the first track starts at once. */
export function prepare() {
  void ensure();
}

function apply() {
  player?.setVolume(Math.round(state.muted ? 0 : state.volume * gain));
}

/** Eases the fade multiplier to `to`; `then` runs once it gets there. */
function fade(to: number, seconds: number, then?: () => void) {
  clearInterval(fading);
  fading = 0;
  if (seconds <= 0 || gain === to) {
    gain = to;
    apply();
    then?.();
    return;
  }
  const from = gain;
  const t0 = performance.now();
  fading = window.setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    gain = from + (to - from) * p * p * (3 - 2 * p);
    apply();
    if (p < 1) return;
    clearInterval(fading);
    fading = 0;
    then?.();
  }, 40);
}

let ticking = 0;
function tick() {
  if (!player) return;
  const at = player.getCurrentTime() || 0;
  const length = player.getDuration() || state.duration;
  if (Math.abs(at - state.position) < 0.2 && length === state.duration) return;
  state.position = at;
  state.duration = length;
  emit();
}

function onState(s: number) {
  yt = s;
  clearInterval(ticking);
  if (s === STATE.PLAYING) {
    ticking = window.setInterval(tick, 250);
    failures = 0;
    state.loading = false;
    state.blocked = false;
    state.error = null;
    if (primed) {
      // The silent start that unlocks playback on iOS: back to the top, quiet, waiting.
      primed = false;
      player?.pauseVideo();
      player?.seekTo(0, true);
      player?.unMute();
      return emit();
    }
    if (!state.playing || holds.size) {
      player?.pauseVideo();
      return emit();
    }
    if (fadeIn) {
      const seconds = fadeIn;
      fadeIn = 0;
      gain = 0;
      apply();
      fade(1, seconds);
    } else if (gain < 1) fade(1, 0.3);
    channel?.postMessage('playing');
    tick();
  } else if (s === STATE.ENDED) {
    ended();
  } else if (s === STATE.BUFFERING) {
    state.loading = true;
  } else if (s === STATE.PAUSED) {
    state.loading = false;
    // Paused by something other than this page (a headset button, the system's controls) while it
    // was simply playing: that is the visitor stopping it.
    if (state.playing && !holds.size && !fading && !starting) {
      state.playing = false;
      remember(true);
    }
  }
  emit();
}

function onError(code: number) {
  // 100, 101 and 150: removed, private, or not allowed to be embedded. Skip it, but not forever.
  console.warn(`YouTube could not play ${tracks[state.index]?.videoId} (${code})`);
  if (++failures >= tracks.length) {
    failures = 0;
    state.playing = false;
    state.loading = false;
    state.error = 'None of these tracks would play';
    return emit();
  }
  select(following(true), 0);
}

/** Watches a start: if nothing plays within a few seconds, the browser has blocked it. */
let starting = 0;
function watchStart() {
  clearTimeout(starting);
  starting = window.setTimeout(() => {
    starting = 0;
    if (!state.playing || holds.size || yt === STATE.PLAYING || yt === STATE.BUFFERING) return;
    state.blocked = true;
    state.loading = false;
    emit();
  }, 4000);
}

function load(i: number) {
  const id = tracks[i].videoId;
  if (!player) return;
  if (loaded === id) player.playVideo();
  else {
    loaded = id;
    player.loadVideoById(id);
  }
  watchStart();
}

// The queue ------------------------------------------------------------------------------------

/** A track picked at random, never one of the last few heard. */
function random() {
  const recent = new Set([state.index, ...history.slice(-Math.min(8, tracks.length - 2))]);
  const pool = tracks.map((_, i) => i).filter((i) => !recent.has(i));
  const from = pool.length ? pool : tracks.map((_, i) => i);
  return from[Math.floor(Math.random() * from.length)];
}

/** The track after this one, or -1 at the end of the mix with repeat off. */
function following(force = false) {
  if (state.shuffle) return random();
  const n = state.index + 1;
  if (n < tracks.length) return n;
  return state.repeat === 'all' || force ? 0 : -1;
}

function ended() {
  if (state.repeat === 'one') {
    player?.seekTo(0, true);
    player?.playVideo();
    return;
  }
  const n = following();
  if (n < 0) {
    state.playing = false;
    state.position = 0;
    return;
  }
  select(n, 0);
}

function select(i: number, fadeSeconds: number, remembered = true) {
  if (!tracks[i]) return;
  if (remembered && state.index >= 0 && state.index !== i) {
    history.push(state.index);
    if (history.length > 50) history.shift();
  }
  state.index = i;
  state.position = 0;
  state.duration = tracks[i].durationSec;
  state.playing = true;
  state.loading = true;
  state.blocked = false;
  state.error = null;
  fadeIn = fadeSeconds;
  describe();
  emit();
  void ensure().then((p) => {
    if (!p || state.index !== i || !state.playing) return;
    if (holds.size) {
      loaded = tracks[i].videoId;
      p.cueVideoById(loaded);
      return;
    }
    if (fadeSeconds) {
      gain = 0;
      apply();
    }
    load(i);
  });
}

// Controls -------------------------------------------------------------------------------------

function stoppedThisSession() {
  try {
    return sessionStorage.getItem(STOPPED) === '1';
  } catch {
    return false;
  }
}

function remember(stopped: boolean) {
  try {
    if (stopped) sessionStorage.setItem(STOPPED, '1');
    else sessionStorage.removeItem(STOPPED);
  } catch {
    // Not remembered; it only matters after a reload.
  }
}

export function play() {
  remember(false);
  if (state.index < 0) return select(random(), 0.6);
  if (state.playing && yt === STATE.PLAYING) return;
  state.playing = true;
  state.blocked = false;
  emit();
  void ensure().then((p) => {
    if (!p || !state.playing || holds.size) return;
    if (yt === STATE.PLAYING) fade(1, 0.3);
    else load(state.index);
  });
}

export function pause() {
  if (!state.playing) return;
  state.playing = false;
  state.blocked = false;
  remember(true);
  emit();
  fade(0, 0.3, () => {
    if (!state.playing) player?.pauseVideo();
  });
}

export function toggle() {
  if (state.playing && !state.blocked) pause();
  else play();
}

/** Plays track `i` from the top, as the visitor asked. */
export function choose(i: number) {
  remember(false);
  select(i, 0);
}

export function next() {
  remember(false);
  select(following(true), 0);
}

/** Back to the top of this track, or to the one before if it has only just begun. */
export function prev() {
  remember(false);
  if (state.position > 3 && state.index >= 0) return seek(0);
  const before = history.pop();
  if (before !== undefined) return select(before, 0, false);
  select(state.index > 0 ? state.index - 1 : tracks.length - 1, 0, false);
}

export function seek(seconds: number) {
  state.position = Math.max(0, Math.min(seconds, state.duration || seconds));
  player?.seekTo(state.position, true);
  emit();
}

export function setVolume(volume: number) {
  state.volume = Math.max(0, Math.min(100, Math.round(volume)));
  if (state.volume > 0) state.muted = false;
  apply();
  emit();
}

export function setMuted(on: boolean) {
  state.muted = on;
  apply();
  emit();
}

export function setShuffle(on: boolean) {
  state.shuffle = on;
  emit();
}

export function cycleRepeat() {
  state.repeat = state.repeat === 'all' ? 'one' : state.repeat === 'one' ? 'off' : 'all';
  emit();
}

// For the plaza --------------------------------------------------------------------------------

/**
 * The plaza hands its sound over: a random track fades in over `seconds`, unless the radio is
 * already on, or the visitor stopped it this session. Resolves whether the radio is now playing;
 * until it is, the plaza keeps its own theme going.
 */
export function takeOver(seconds: number): Promise<boolean> {
  if (stoppedThisSession() && !state.playing) return Promise.resolve(false);
  if (!state.playing) select(primedIndex >= 0 ? primedIndex : random(), seconds);
  primedIndex = -1;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => stop());
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 15000);
    const stop = subscribe((s) => {
      if (yt === STATE.PLAYING && s.playing) finish(true);
      else if (s.error || s.blocked || !s.playing) finish(false);
    });
  });
}

let primed = false;
let primedIndex = -1;
const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Called inside the press that starts the plaza. iOS only lets a player start from a press, and the
 * radio starts later, so on iOS this starts a track silently now and stops it at once, which is
 * enough to let it play later on its own.
 */
export function prime() {
  if (!ios || !player || state.playing || primed || primedIndex >= 0) return;
  primedIndex = random();
  primed = true;
  loaded = tracks[primedIndex].videoId;
  player.mute();
  player.loadVideoById(loaded);
}

/** Something else needs the speakers (a game, a video): the radio fades out and waits. */
export function hold(reason: string) {
  if (holds.has(reason)) return;
  holds.add(reason);
  emit();
  if (yt === STATE.PLAYING) {
    fade(0, 0.5, () => {
      if (holds.size) player?.pauseVideo();
    });
  }
}

export function release(reason: string) {
  if (!holds.delete(reason)) return;
  emit();
  if (!holds.size && state.playing && player && state.index >= 0) load(state.index);
}

// The rest of the browser ----------------------------------------------------------------------

/** What the system shows on the lock screen and in its media controls. */
function describe() {
  const t = tracks[state.index];
  if (!t || !('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: MUSIC.title,
    artwork: [{ src: new URL(t.thumb, location.href).href, sizes: '640x640', type: 'image/jpeg' }],
  });
}

if ('mediaSession' in navigator) {
  const session = navigator.mediaSession;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', play],
    ['pause', pause],
    ['nexttrack', next],
    ['previoustrack', prev],
    ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
  ];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Not supported here.
    }
  }
}

// One tab plays at a time: starting it here stops it everywhere else.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('ankush-music') : null;
channel?.addEventListener('message', (e) => {
  if (e.data !== 'playing' || !state.playing) return;
  state.playing = false;
  emit();
  fade(0, 0.3, () => player?.pauseVideo());
});

// A start the browser blocked goes ahead on the next press anywhere.
for (const type of ['pointerdown', 'keydown'] as const) {
  addEventListener(
    type,
    () => {
      if (!state.blocked || !state.playing || !player) return;
      state.blocked = false;
      emit();
      player.playVideo();
      watchStart();
    },
    { capture: true, passive: true },
  );
}

// M mutes the music (sfx.ts mutes the UI sounds on the same key).
addEventListener('keydown', (e) => {
  if (e.key !== 'm' && e.key !== 'M') return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
  setMuted(!state.muted);
});

// A video or sound on the page holds the radio while it plays.
const media = new Set<HTMLMediaElement>();
function settleMedia() {
  for (const m of media) if (!m.isConnected || m.paused || m.muted) media.delete(m);
  if (media.size) hold('media');
  else release('media');
}
document.addEventListener(
  'play',
  (e) => {
    if (!(e.target instanceof HTMLMediaElement) || e.target.muted) return;
    media.add(e.target);
    settleMedia();
  },
  true,
);
for (const type of ['pause', 'ended', 'emptied', 'volumechange']) document.addEventListener(type, settleMedia, true);
document.addEventListener('astro:after-swap', settleMedia);

if (import.meta.env.DEV) {
  // In the console: __music.state, __music.log (every player state change and page swap, to check
  // that a page change never pauses or buffers the music).
  const log: string[] = [];
  const t0 = performance.now();
  const note = (what: string) => log.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${what}`);
  const names: Record<number, string> = { [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
  let last = yt;
  subscribe(() => {
    if (yt !== last) note(`yt ${names[yt] ?? yt}`);
    last = yt;
  });
  document.addEventListener('astro:after-swap', () => note(`swap ${location.pathname}`));
  Object.assign(window, { __music: { state, log, play, pause, next, prev, seek, hold, release, takeOver } });
}
