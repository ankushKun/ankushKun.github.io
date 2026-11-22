// The radio's mix: a YouTube playlist's metadata, synced by `pnpm music` (scripts/music.mjs) into
// music.json beside this file, with square covers in public/music/covers/. No audio is stored here;
// every track plays through YouTube's own player (src/scripts/music/).
import catalog from './music.json';

export interface Track {
  /** Stable public id, a hash of the video id. */
  id: string;
  videoId: string;
  title: string;
  artist: string;
  durationSec: number;
  /** Square cover, a path under /music/covers/ (or YouTube's thumbnail when none could be made). */
  thumb: string;
  /** Added by hand in music-extra.json rather than from the playlist. */
  byHand?: boolean;
  /**
   * Its tempo in beats a minute, measured by `pnpm bpm` (the longest steady stretch's), or null
   * where it has no steady beat. Missing until measured.
   */
  bpm?: number | null;
  /**
   * Its beat through the track, as steady stretches: [seconds into it where a bar starts, beats a
   * minute from there]. One stretch for a track that keeps time throughout (`pnpm bpm`).
   */
  beats?: [number, number][] | null;
}

// JSON reads each stretch as a plain array; they are pairs as `pnpm bpm` writes them.
export const MUSIC = catalog as unknown as { title: string; updated: string; tracks: Track[] };

/** 3:05, or 1:02:09 past an hour. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
