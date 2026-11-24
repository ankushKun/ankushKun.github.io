// Records the plaza for link previews, from the running dev server (`pnpm dev`):
//   src/assets/og/plaza.jpg        your Mii up close among friends, the backdrop every social card
//                                  is drawn on (src/lib/og.ts), at twice the card's size
//   src/assets/og/plaza.json       where the top of your Mii's head is on it, for the post's tail
//   public/media/plaza-preview.mp4 a seamless loop of the plaza, which iMessage plays in the bubble,
//                                  Discord over the picture and Telegram large (og:video)
//   public/media/plaza-preview.jpg its first frame, the X player's still
//
// Chrome runs headless on virtual time: the page's clock only moves when this script says, so the
// clip is smooth however slowly the frames draw. The chat and the radio are blocked, so nobody's
// messages and no "Now playing" end up in the pictures.
//
// Needs ffmpeg and Chrome: CHROME=/path/to/chrome, else Chrome for Testing from Playwright's cache,
// else Google Chrome. Run with `pnpm og:capture` (BASE=http://localhost:4321 by default).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const W = 1200;
const H = 630;
const FPS = 30;
/** Seconds of the clip, and the crossfade from its end into its start that makes it loop. */
const CLIP = 8;
const SEAM = 1;
/** How far the camera zooms in on the middle group for the backdrop, as the wheel does (0 to 3). */
const ZOOM = Number(process.env.ZOOM ?? 3);
/** And for the clip: a little in from the resting view, so Miis read at the size of a message bubble. */
const CLIP_ZOOM = Number(process.env.CLIP_ZOOM ?? 0.9);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const app = join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(app)) return app;
      const linux = join(cache, dir, 'chrome-linux/chrome');
      if (existsSync(linux)) return linux;
    }
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

/** Hides everything over the plaza that isn't the plaza: the corner buttons, the lobby, the prompts. */
const HIDE = `
  astro-dev-toolbar, .music, .theme-toggle, .lobby, .plaza-start, .plaza-who, .plaza-corner, .plaza-fps, .plaza-links span { display: none !important; }
  html[data-og-still] .plaza-bubbles { display: none !important; }
`;

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'og-capture-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--enable-unsafe-swiftshader',
      `--window-size=${W},${H}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) listeners.get(msg.method)?.forEach((fn) => fn(msg.params));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) =>
    new Promise((resolve) => {
      const fns = listeners.get(method) ?? [];
      const fn = (p) => {
        fns.splice(fns.indexOf(fn), 1);
        resolve(p);
      };
      fns.push(fn);
      listeners.set(method, fns);
    });
  const close = async () => {
    ws.close();
    const gone = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await gone;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  return { send, once, on, close };
}

/** Opens the plaza, settled, at `scale` times the card's size, its clock stopped. */
async function openPlaza(cdp, scale, still) {
  const { send } = cdp;
  await send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error') console.error('page:', e.args.map((a) => a.value ?? a.description).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (e) => console.error('page:', e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://gun.ankush.one/*', '*youtube.com/*', '*youtube-nocookie.com/*', '*ytimg.com/*', '*googlevideo.com/*', '*klipy.com/*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try { localStorage.setItem('theme', 'light'); } catch {}
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = ${JSON.stringify(HIDE)};
        document.head.append(s);
        ${still ? "document.documentElement.dataset.ogStill = '';" : ''}
      });
    `,
  });
  await send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  await send('Page.navigate', { url: `${BASE}/#0` });
  // Loading and building the plaza, a couple of seconds of its clock at a time until it is up.
  for (let i = 0; ; i++) {
    await advance(cdp, 2000, 'pauseIfNetworkFetchesPending');
    const ready = await send('Runtime.evaluate', { expression: "[typeof window.__plaza, document.querySelector('[data-plaza]')?.dataset.state]", returnByValue: true });
    const [api, state] = ready.result.value;
    if (api === 'object') break;
    if (i >= 20) throw new Error(`The plaza did not start at ${BASE} (state ${state}; is \`pnpm dev\` running?)`);
  }
  // And a few seconds more for the crowd to settle.
  await advance(cdp, 4000);
}

/** Lets the page's clock run `ms` milliseconds, then stops it again. */
async function advance({ send, once }, ms, policy = 'advance') {
  const done = once('Emulation.virtualTimeBudgetExpired');
  await send('Emulation.setVirtualTimePolicy', { policy, budget: ms });
  await done;
}

async function shot({ send }, quality) {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false });
  return Buffer.from(data, 'base64');
}

async function backdrop() {
  const cdp = await launch();
  try {
    await openPlaza(cdp, 2, true);
    await cdp.send('Runtime.evaluate', { expression: `__plaza.zoom(${ZOOM})` });
    await advance(cdp, 5000);
    const at = await cdp.send('Runtime.evaluate', { expression: '__plaza.mii(0)', returnByValue: true });
    mkdirSync('src/assets/og', { recursive: true });
    writeFileSync('src/assets/og/plaza.jpg', await shot(cdp, 90));
    const { top } = at.result.value;
    writeFileSync('src/assets/og/plaza.json', `${JSON.stringify({ width: W, height: H, head: top.map(Math.round) })}\n`);
    console.log('src/assets/og/plaza.jpg, head at', top.map(Math.round));
  } finally {
    await cdp.close();
  }
}

async function clip() {
  const cdp = await launch();
  const frames = mkdtempSync(join(tmpdir(), 'og-frames-'));
  try {
    await openPlaza(cdp, 1, false);
    await cdp.send('Runtime.evaluate', { expression: `__plaza.zoom(${CLIP_ZOOM})` });
    // Long enough for the crowd to start talking, and the first bubbles to be up.
    await advance(cdp, 40000);
    const said = await cdp.send('Runtime.evaluate', { expression: "document.querySelectorAll('.plaza-bubble').length", returnByValue: true });
    console.log('bubbles up:', said.result.value);
    const count = (CLIP + SEAM) * FPS;
    for (let i = 0; i < count; i++) {
      await advance(cdp, 1000 / FPS);
      writeFileSync(join(frames, `${String(i).padStart(4, '0')}.jpg`), await shot(cdp, 92));
      if (i % FPS === 0) process.stdout.write(`\rframes ${i}/${count}`);
    }
    process.stdout.write('\n');
    mkdirSync('public/media', { recursive: true });
    // The last SEAM seconds fade into the first, which the clip then starts after: it loops
    // without a cut.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-framerate', String(FPS), '-i', join(frames, '%04d.jpg'),
      '-filter_complex',
      `[0]split[a][b];[a]trim=${SEAM}:${CLIP + SEAM},setpts=PTS-STARTPTS[body];[b]trim=0:${SEAM},setpts=PTS-STARTPTS[head];[body][head]xfade=transition=fade:duration=${SEAM}:offset=${CLIP - SEAM},format=yuv420p[v]`,
      '-map', '[v]', '-an',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '24',
      '-movflags', '+faststart',
      'public/media/plaza-preview.mp4',
    ]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'public/media/plaza-preview.mp4', '-frames:v', '1', '-q:v', '3', 'public/media/plaza-preview.jpg']);
    console.log('public/media/plaza-preview.mp4 and .jpg');
  } finally {
    await cdp.close();
    rmSync(frames, { recursive: true, force: true });
  }
}

const only = process.argv[2];
if (!only || only === 'backdrop') await backdrop();
if (!only || only === 'clip') await clip();
