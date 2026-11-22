// YouTube's IFrame player, loaded once and kept out of sight. It is mounted on <html> itself, beside
// the <body> that Astro's router swaps on every page change, so it is never moved or reloaded and
// the music never stops between pages.

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
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.dataset.music = '';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none';
  const mount = document.createElement('div');
  host.append(mount);
  document.documentElement.append(host);
  return new Promise<Player>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('YouTube player timed out')), 15000);
    const player = new YT.Player(mount, {
      width: '200',
      height: '200',
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
