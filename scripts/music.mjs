// pnpm music [playlist URL] [--limit N] [--extra]
//
// Syncs the radio's mix (src/data/music.json) from a YouTube playlist: titles, artists, lengths and
// a square cover for each track (public/music/covers/<videoId>.jpg). Tracks added by hand in
// src/data/music-extra.json ({ videoId, title, artist }) follow the playlist's, whatever its length.
// Songs listed in src/data/music-skip.json are left out even though they're on the playlist.
// --extra only brings those up to date, keeping the playlist's tracks as they are in music.json
// (hand-added tracks are marked `byHand` there, so one taken out of the file goes too). Metadata and thumbnail stills
// only: no audio is ever downloaded, and the run fails if any turns up. Every track plays through
// YouTube's own player (src/scripts/music/). Each track's beat (`bpm`, `beats`) is measured by
// `pnpm bpm` and kept here from run to run.
//
// Needs yt-dlp on PATH. A private playlist can be read with YTDLP_COOKIES_FROM_BROWSER=chrome (or
// safari, firefox). Titles and artists already in music.json win over the playlist's, so names fixed
// by hand stay fixed (YouTube's auto-generated "Artist - Topic" channels are often wrong).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'src/data/music.json');
const EXTRA = join(ROOT, 'src/data/music-extra.json');
const SKIP = join(ROOT, 'src/data/music-skip.json');
const COVERS = join(ROOT, 'public/music/covers');
const DEFAULT_URL = 'https://www.youtube.com/playlist?list=PLGYjQsvvGQYQ';
const MAX = 30;

let url = DEFAULT_URL;
let limit = MAX;
let extraOnly = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') limit = Math.min(MAX, Number(args[++i]) || MAX);
  else if (args[i] === '--extra') extraOnly = true;
  else if (args[i].startsWith('-')) throw new Error(`Unknown flag: ${args[i]}`);
  else url = args[i];
}

const clean = (s, n) =>
  String(s ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

const ytArgs = ['--skip-download', '-J'];
if (process.env.YTDLP_COOKIES_FROM_BROWSER) ytArgs.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
const yt = (...more) => JSON.parse(execFileSync('yt-dlp', [...ytArgs, ...more], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { tracks: [] };
const known = new Map();
for (const t of current.tracks ?? []) known.set(t.videoId, t);
const extras = existsSync(EXTRA) ? JSON.parse(readFileSync(EXTRA, 'utf8')) : [];

let playlist = { title: current.title, entries: [] };
if (!extraOnly) {
  console.error(`Reading ${url} (metadata only)`);
  playlist = yt('--flat-playlist', '--playlist-end', String(limit), url);
}

/** The biggest real still YouTube has (a missing size comes back as a 120x90 placeholder). */
async function still(id) {
  for (const name of ['maxresdefault.jpg', 'hq720.jpg', 'sddefault.jpg', 'hqdefault.jpg']) {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}`).catch(() => null);
    if (!res?.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const { width = 0, height = 0 } = await sharp(buf).metadata();
    if (width > 120 && height > 90) return buf;
  }
  return null;
}

/** A square cover: the still with its black bars trimmed, cropped to the middle, 640px. */
async function cover(id) {
  const buf = await still(id);
  if (!buf) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const trimmed = await sharp(buf).trim({ background: '#000', threshold: 30 }).toBuffer().catch(() => buf);
  const { width = 0, height = 0 } = await sharp(trimmed).metadata();
  const side = Math.min(width, height);
  await sharp(trimmed)
    .extract({ left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side })
    .resize(640, 640)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(COVERS, `${id}.jpg`));
  return `/music/covers/${id}.jpg`;
}

/** A track's measured beat, carried over as it was (`pnpm bpm`). */
const beatOf = (before) => (before && 'bpm' in before ? { bpm: before.bpm, beats: before.beats } : {});

mkdirSync(COVERS, { recursive: true });
const tracks = [];
// With --extra, the playlist's tracks stay exactly as they are.
const extraIds = new Set(extras.map((x) => x.videoId));
if (extraOnly) tracks.push(...(current.tracks ?? []).filter((t) => !t.byHand && !extraIds.has(t.videoId)));
// Songs on the playlist that are left out of the mix anyway.
const skip = new Set(existsSync(SKIP) ? JSON.parse(readFileSync(SKIP, 'utf8')).videoIds ?? [] : []);
for (const entry of playlist.entries ?? []) {
  if (!entry || tracks.length >= limit) continue;
  const id = String(entry.id ?? '').match(/^[\w-]{11}$/)?.[0];
  if (!id || skip.has(id)) continue;
  let title = clean(entry.title ?? entry.track ?? 'Unknown', 80);
  let artist = clean(entry.artist ?? entry.uploader ?? entry.channel ?? entry.creator, 60).replace(/\s+-\s+Topic$/, '');
  if (!artist && title.includes(' - ')) [artist, title] = title.split(' - ', 2).map((s) => clean(s, 80));
  const before = known.get(id);
  tracks.push({
    id: createHash('sha256').update(id).digest('hex').slice(0, 12),
    videoId: id,
    title: before?.title ?? title,
    artist: before?.artist ?? artist,
    durationSec: Math.max(0, Math.round(Number(entry.duration) || before?.durationSec || 0)),
    thumb: await cover(id),
    ...beatOf(before),
  });
  console.error(`  ${tracks.at(-1).title} by ${tracks.at(-1).artist}`);
}

// Then the tracks added by hand, named as written there.
for (const extra of extras) {
  const id = String(extra.videoId ?? '').match(/^[\w-]{11}$/)?.[0];
  if (!id || tracks.some((t) => t.videoId === id)) continue;
  const before = known.get(id);
  const duration = before?.durationSec || Math.round(Number(yt(`https://www.youtube.com/watch?v=${id}`).duration) || 0);
  tracks.push({
    id: createHash('sha256').update(id).digest('hex').slice(0, 12),
    videoId: id,
    title: clean(extra.title, 80) || before?.title || 'Unknown',
    artist: clean(extra.artist, 60) || before?.artist || '',
    durationSec: duration,
    thumb: await cover(id),
    byHand: true,
    ...beatOf(before),
  });
  console.error(`  ${tracks.at(-1).title} by ${tracks.at(-1).artist} (added by hand)`);
}

// Covers of tracks no longer in the mix go.
const keep = new Set(tracks.map((t) => t.videoId));
for (const file of readdirSync(COVERS)) if (!keep.has(file.replace(/\.jpg$/, ''))) unlinkSync(join(COVERS, file));

const json = {
  version: 1,
  title: clean(playlist.title, 80) || current.title || 'Top Picks',
  updated: new Date().toISOString().slice(0, 10),
  manifestHash: createHash('sha256').update(tracks.map((t) => t.id).join(',')).digest('hex').slice(0, 16),
  tracks,
};
// Each stretch of a beat map stays on one line, as `pnpm bpm` writes them.
const text = `${JSON.stringify(json, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')}\n`;

// Nothing but metadata and stills: no media files, no links to media.
if (readdirSync(COVERS).some((f) => !f.endsWith('.jpg'))) throw new Error('Something other than a cover is in public/music/covers');
if (/googlevideo|\.(mp3|m4a|webm|opus|mp4)\b|youtube\.com\/watch|youtu\.be\//i.test(text)) throw new Error('music.json links to media');

writeFileSync(OUT, text);
console.error(`Wrote ${tracks.length} tracks to src/data/music.json`);
const unmeasured = tracks.filter((t) => !('bpm' in t)).length;
if (unmeasured) console.error(`${unmeasured} without a measured beat yet: run pnpm bpm`);
