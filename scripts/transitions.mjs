// Films every kind of route change so a change to the motion can be checked frame by frame
// (README, "Moving between pages"). Run it against a production build:
//
//   pnpm build && pnpm preview            # in one terminal
//   pnpm transitions                      # every move, desktop and phone
//   pnpm transitions plazaToPage appIn    # only these
//
// Each move is recorded to .transitions/<move>-<width>.webm. With ffmpeg installed, a sheet of
// frames from the moment of the click is written beside it as a .png, 25 frames a second, read
// left to right. BASE sets the server (default http://localhost:4321), CHROME a browser of your own
// instead of Playwright's. The chat's relay is stubbed out, so nothing reaches the real room.
//
// Needs Playwright: pnpm add -D playwright-core && pnpm exec playwright-core install chromium
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const OUT = '.transitions';
/** Long enough for the plaza to finish building before the move is made. */
const PLAZA_READY = 8000;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('Needs Playwright: pnpm add -D playwright-core && pnpm exec playwright-core install chromium');
  process.exit(1);
}

const tidy = (page) => page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove()).catch(() => {});

/** Each move: get the page ready, then return the action that makes the move. */
const MOVES = {
  /** Pressing a block: the camera zooms into it and the page fades in. */
  async plazaToPage(page) {
    await page.goto(`${BASE}/#0`);
    await page.waitForTimeout(PLAZA_READY);
    return () => page.click('a[data-cube][href="/about/"]', { force: true });
  },
  /** The TV's plaza button: the page fades away and the plaza pulls back out of the About block. */
  async pageToPlaza(page) {
    await page.goto(`${BASE}/about/`);
    await page.waitForTimeout(2500);
    return () => page.click('.tv-home');
  },
  /** Back in history to the plaza, from the back/forward cache. */
  async backToPlaza(page) {
    await page.goto(`${BASE}/#0`);
    await page.waitForTimeout(PLAZA_READY);
    await page.click('a[data-cube][href="/about/"]', { force: true });
    await page.waitForTimeout(3000);
    return () => page.goBack({ waitUntil: 'commit' });
  },
  /** Between sections, in the menu's order. */
  async section(page, phone) {
    await page.goto(`${BASE}/about/`);
    await page.waitForTimeout(2500);
    await page.click('.tv-open');
    await page.waitForTimeout(900);
    return () => page.click('#tv-menu a[href="/blogs/"]', { force: phone });
  },
  /** Into an entry: its picture flies to its page. */
  async entry(page) {
    await page.goto(`${BASE}/projects/`);
    await page.waitForTimeout(2500);
    return () => page.click('main a.channel >> nth=2');
  },
  /** A channel on /apps/ grows into its app. */
  async appIn(page) {
    await page.goto(`${BASE}/apps/`);
    await page.waitForTimeout(2500);
    return () => page.click('main a[data-grow]');
  },
  /** Back out of the app (its B button): it shrinks back into its channel. */
  async appBack(page) {
    await page.goto(`${BASE}/apps/chat/`);
    await page.waitForTimeout(4000);
    // On a phone the app's rail, and the back button in it, is folded away; it is pressed all the same.
    return () => page.$eval('[data-back]', (back) => back.click());
  },
  /** From the app's own menu to a section: the app gives way and the casing slides back in. */
  async appOut(page, phone) {
    await page.goto(`${BASE}/apps/chat/`);
    await page.waitForTimeout(4000);
    if (phone) {
      await page.click('.tv-open');
      await page.waitForTimeout(900);
      return () => page.click('#tv-menu a[href="/projects/"]', { force: true });
    }
    await page.click('[data-sections-toggle]');
    await page.waitForTimeout(900);
    return () => page.click('[data-app-nav] a[href="/projects/"]');
  },
};

const SCREENS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, phone: true },
];

const wanted = process.argv.slice(2);
const moves = wanted.length ? wanted : Object.keys(MOVES);
const unknown = moves.filter((m) => !MOVES[m]);
if (unknown.length) {
  console.error(`No such move: ${unknown.join(', ')}. Moves: ${Object.keys(MOVES).join(', ')}`);
  process.exit(1);
}

mkdirSync(`${OUT}/raw`, { recursive: true });
let ffmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpeg = false;
  console.log('ffmpeg not found: videos only, no frame sheets.');
}

// Playwright turns the back/forward cache off by default; the plaza relies on it coming back.
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, ignoreDefaultArgs: ['--disable-back-forward-cache'], args: ['--enable-gpu'] });
for (const name of moves) {
  for (const screen of SCREENS) {
    const size = { width: screen.width, height: screen.height };
    const context = await browser.newContext({ viewport: size, hasTouch: !!screen.phone, recordVideo: { dir: `${OUT}/raw`, size } });
    await context.routeWebSocket(/gun\.ankush\.one/, () => {});
    const page = await context.newPage();
    const start = Date.now();
    const move = await MOVES[name](page, !!screen.phone);
    await tidy(page);
    const at = (Date.now() - start) / 1000;
    await move();
    await page.waitForTimeout(3000);
    const video = page.video();
    await context.close();
    const file = `${OUT}/${name}-${screen.width}`;
    renameSync(await video.path(), `${file}.webm`);
    if (ffmpeg) {
      const scale = screen.phone ? 200 : 480;
      const tile = screen.phone ? '8x3' : '4x6';
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(Math.max(0, at - 0.05)), '-t', '1.2', '-i', `${file}.webm`, '-vf', `fps=25,scale=${scale}:-1,tile=${tile}:padding=4:color=red`, '-frames:v', '1', `${file}.png`]);
    }
    console.log(`${name} ${screen.width}: ${file}.webm`);
  }
}
await browser.close();
