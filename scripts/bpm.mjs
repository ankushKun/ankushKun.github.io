// pnpm bpm [videoId ...] [--all]
//
// Measures each radio track's beat, so the plaza's dancers keep time with whatever plays
// (plaza/beat.ts). For every track in src/data/music.json without a `bpm` yet (or the ones named,
// or all with --all), the audio is streamed from YouTube through ffmpeg into memory, analysed
// (scripts/tempo.mjs), and dropped: nothing is written to disk but the numbers. Each track gets
//
//   bpm    its tempo in beats a minute (the longest steady stretch's), or null where there is no
//          steady beat to dance to
//   beats  its steady stretches, each [seconds into the video where a bar starts, beats a minute
//          from there], one for a song that keeps time throughout
//
// A value fixed by hand stays unless the track is named or --all is given. Needs yt-dlp and ffmpeg
// on PATH; YTDLP_COOKIES_FROM_BROWSER works as it does for `pnpm music`.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE, measure } from './tempo.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'src/data/music.json');

/** The track's audio as mono samples, streamed through ffmpeg and never saved. */
function audio(videoId) {
  return new Promise((resolve, reject) => {
    // Requested in chunks, which YouTube throttles less often than one long stream.
    const ytArgs = ['-f', 'bestaudio', '-o', '-', '--quiet', '--no-playlist', '--http-chunk-size', '10M'];
    if (process.env.YTDLP_COOKIES_FROM_BROWSER) ytArgs.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
    const yt = spawn('yt-dlp', [...ytArgs, `https://www.youtube.com/watch?v=${videoId}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    const ff = spawn('ffmpeg', ['-v', 'quiet', '-i', 'pipe:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    yt.stdout.pipe(ff.stdin);
    ff.stdin.on('error', () => {});
    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed on ${videoId}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
    yt.on('error', reject);
    ff.on('error', reject);
  });
}

/** The audio, asked for again a couple of times if YouTube turns a request away. */
async function fetchAudio(videoId) {
  for (let tries = 1; ; tries++) {
    try {
      const samples = await audio(videoId);
      if (samples.length > RATE * 5) return samples;
      throw new Error('too little audio came back');
    } catch (err) {
      if (tries >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * tries));
    }
  }
}

/** music.json as `pnpm music` writes it, with each stretch of a beat map kept on one line. */
const format = (catalog) => `${JSON.stringify(catalog, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')}\n`;

const args = process.argv.slice(2);
const all = args.includes('--all');
const named = new Set(args.filter((a) => !a.startsWith('-')));
const catalog = JSON.parse(readFileSync(OUT, 'utf8'));
const todo = catalog.tracks.filter((t) => all || named.has(t.videoId) || (!named.size && !('bpm' in t)));
if (!todo.length) console.error('Every track already has a tempo. Name one, or pass --all, to measure again.');
for (const track of todo) {
  try {
    const { bpm, beats, clarity } = measure(await fetchAudio(track.videoId));
    track.bpm = bpm;
    track.beats = beats;
    const parts = beats ? (beats.length === 1 ? 'steady' : `${beats.length} steady stretches`) : '';
    console.error(`  ${bpm === null ? 'no steady beat' : `${bpm} bpm, ${parts}`}  (clarity ${clarity.toFixed(1)})  ${track.title} by ${track.artist}`);
    // Written after every track, so a run cut short keeps what it measured.
    writeFileSync(OUT, format(catalog));
  } catch (err) {
    console.error(`  failed: ${track.title} (${err.message})`);
  }
}
