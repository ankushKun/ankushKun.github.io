// GIF search for the chat, from Klipy through the site worker (GIF_PROXY in src/site.ts), which
// holds the Klipy key so it never reaches the page. In dev, Vite forwards /__gif to the worker as
// ankush.one (astro.config.mjs), the only site the worker answers.
import { GIF_PROXY } from '../../site';
import { isGifUrl } from './net';

export interface Gif {
  id: string;
  title: string;
  /** A small copy for the picker. */
  preview: string;
  /** The copy that is posted, for clients that only show GIFs. */
  url: string;
  /** The same animation as an MP4, a fraction of the GIF's weight: what this chat plays. */
  video?: string;
  w: number;
  h: number;
}

interface KlipyFormat {
  url: string;
  dims?: [number, number];
}

interface KlipyResult {
  id: string;
  title?: string;
  content_description?: string;
  media_formats?: Record<string, KlipyFormat | undefined>;
}

const base = () => (import.meta.env.DEV ? '/__gif' : GIF_PROXY ? `${GIF_PROXY}/gif` : '');

/** Whether this build can search for GIFs at all. */
export const gifsOn = () => base() !== '';

/** Trending GIFs for an empty query, else a search. `pos` continues an earlier page. */
export async function findGifs(query: string, pos: string | undefined, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: '30' });
  if (query) params.set('q', query);
  if (pos) params.set('pos', pos);
  const res = await fetch(`${base()}/${query ? 'search' : 'trending'}?${params}`, { signal });
  if (!res.ok) throw new Error(`GIF search answered ${res.status}`);
  const data = (await res.json()) as { results?: KlipyResult[]; next?: string };
  const gifs: Gif[] = [];
  for (const r of data.results ?? []) {
    const f = r.media_formats ?? {};
    const small = f.tinygif ?? f.nanogif;
    // mediumgif is the full size at a third of the weight of gif.
    const big = f.mediumgif ?? f.gif;
    if (!small || !big || !isGifUrl(small.url) || !isGifUrl(big.url)) continue;
    const [w, h] = big.dims ?? small.dims ?? [1, 1];
    const mp4 = f.mp4 ?? f.loopedmp4;
    const video = mp4 && isGifUrl(mp4.url) ? mp4.url : undefined;
    gifs.push({ id: r.id, title: r.content_description || r.title || 'GIF', preview: small.url, url: big.url, video, w, h });
  }
  const next = data.next && data.next !== '0' ? data.next : undefined;
  return { gifs, next };
}
