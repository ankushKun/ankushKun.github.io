// YouTube's IFrame player, loaded once and kept out of sight. It is mounted on <html> itself, beside
// the <body> that Astro's router swaps on every page change, so it is never moved or reloaded and
// the music never stops between pages. The plaza shows its video in the Music block by laying it
// just behind the page (`stage`), where the block's glass leaves a window onto it.

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface Player {
  loadVideoById(id: string, start?: number): void;
  cueVideoById(id: string, start?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
}

interface Api {
  Player: new (
    el: HTMLElement,
    options: {
      width: string;
      height: string;
      host: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onError: (e: { data: number }) => void;
      };
    },
  ) => Player;
}

type Win = Window & { YT?: Api & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };

let api: Promise<Api> | null = null;

/**
 * The player's size on the page: 16:9 at 480 device pixels tall, which is what YouTube streams to
 * a player that size, however small it is drawn.
 */
const ratio = Math.max(1, Math.min(devicePixelRatio || 1, 3));
export const FRAME = { width: Math.round((854 / ratio) * 100) / 100, height: Math.round((480 / ratio) * 100) / 100 };
const OUT_OF_SIGHT = `position:fixed;left:-9999px;top:0;width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden;opacity:0.01;pointer-events:none`;
let host: HTMLElement | null = null;

/**
 * Lays the player just behind the page, placed by `transform` (a CSS matrix from its own pixels to
 * the screen's), or puts it back out of sight with null. Nothing in the page covers it there except
 * what is drawn over it, so whatever shows it must leave a window open (plaza/film.ts).
 */
export function stage(transform: string | null) {
  if (!host) return false;
  host.style.cssText = transform
    ? `position:fixed;left:0;top:0;z-index:-1;width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden;pointer-events:none;transform-origin:0 0;will-change:transform;transform:${transform}`
    : OUT_OF_SIGHT;
  return true;
}

function loadApi(): Promise<Api> {
  return (api ??= new Promise<Api>((resolve, reject) => {
    const w = window as Win;
    if (w.YT?.Player) return resolve(w.YT);
    const before = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      before?.();
      if (w.YT) resolve(w.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      api = null;
      script.remove();
      reject(new Error('YouTube did not load'));
    };
    // Outside <head> too, which the router rewrites on every page change.
    document.documentElement.append(script);
  }));
}

export interface Handlers {
  state(state: number): void;
  error(code: number): void;
}

/** Makes the one hidden player. Rejects if YouTube can't be reached (blocked, offline). */
export async function createPlayer(handlers: Handlers): Promise<Player> {
  const YT = await loadApi();
  const frame = document.createElement('div');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.music = '';
  frame.style.cssText = OUT_OF_SIGHT;
  const mount = document.createElement('div');
  frame.append(mount);
  document.documentElement.append(frame);
  host = frame;
  return new Promise<Player>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('YouTube player timed out')), 15000);
    const player = new YT.Player(mount, {
      width: String(FRAME.width),
      height: String(FRAME.height),
      host: 'https://www.youtube-nocookie.com',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => {
          clearTimeout(timeout);
          resolve(player);
        },
        onStateChange: (e) => handlers.state(e.data),
        onError: (e) => handlers.error(e.data),
      },
    });
  });
}
