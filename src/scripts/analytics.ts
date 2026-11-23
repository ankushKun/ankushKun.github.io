// Analytics: PostHog, reached through the first-party proxy in POSTHOG (src/site.ts). The site is one
// document for the whole visit (src/scripts/motion.ts), so this runs once and sends a pageview itself
// on every page change. Only the live site is counted; set PUBLIC_POSTHOG_DEV to try it locally.
// posthog-js loads once the browser is idle, so it never holds up the plaza, and whatever happens
// before then waits in a queue with the time it happened. This is the only file that imports
// posthog-js: everything else calls track() with an event from Events.
import type { PostHog, Properties } from 'posthog-js';
import { sectionOf } from '../lib/nav';
import { POSTHOG, SITE } from '../site';

/** Every named event and what it carries. Clicks, scrolling and errors are captured on their own. */
export interface Events {
  /** Past the plaza's opening screen. */
  plaza_started: undefined;
  /** Left the plaza through a block or a speech bubble. */
  plaza_block_pressed: { section: string; href: string; from: 'block' | 'bubble' };
  plaza_mii_poked: { who: 'dj' | 'crowd' };
  konami_code_entered: undefined;
  theme_changed: { theme: string };
  menu_opened: undefined;
  /** The radio moved to another song, by choice or (`auto`) because the last one ended. */
  music_track_changed: { title: string; auto: boolean };
  music_paused: undefined;
  music_resumed: undefined;
  music_muted: { muted: boolean };
  /** Came into a live app under a name, which also links this browser to that name. */
  live_joined: { app: 'chat' | 'paint' | 'guestbook' };
  chat_posted: { kind: 'text' | 'drawing' | 'gif' };
  /** Posted through a slash command, by its name (aliases resolved). */
  chat_command: { name: string };
  paint_stroke_drawn: { tool: string };
  paint_replayed: { day: string };
  paint_saved: { day: string };
  guestbook_signed: { edit: boolean; drawing: boolean; links: number };
  guestbook_removed: undefined;
  /** Linux came up in the Terminal, `seconds` after it was asked for. */
  terminal_booted: { seconds: number };
  /** A command in Linux reached out to the site (open, play, theme, music). */
  terminal_bridged: { command: string };
  terminal_powered_off: undefined;
  /** Linux couldn't start, so the Terminal fell back to its own shell. */
  terminal_fallback: undefined;
  game_played: { game: string };
  game_stopped: { game: string; seconds: number };
}

const on = Boolean(POSTHOG.key) && (location.hostname === new URL(SITE.url).hostname || Boolean(import.meta.env.PUBLIC_POSTHOG_DEV));

let posthog: PostHog | null = null;
const queue: ((p: PostHog) => void)[] = [];
let loaded: (p: PostHog | null) => void = () => {};
/** PostHog once it has loaded, or null where it never will. */
const ready = new Promise<PostHog | null>((done) => (loaded = done));

/** Runs `fn` with PostHog now, or once it loads. */
function withPostHog(fn: (p: PostHog) => void) {
  if (!on) return;
  if (posthog) fn(posthog);
  else queue.push(fn);
}

function send(event: string, props?: Properties) {
  if (posthog) return void posthog.capture(event, props);
  const timestamp = new Date();
  withPostHog((p) => p.capture(event, props, { timestamp }));
}

async function load() {
  const { default: p } = await import('posthog-js');
  const surface = document.documentElement.hasAttribute('data-embed') ? 'embed' : 'site';
  p.init(POSTHOG.key, {
    api_host: POSTHOG.host,
    ui_host: POSTHOG.ui,
    defaults: '2026-08-30',
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: true,
    enable_heatmaps: true,
    capture_dead_clicks: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true, network_timing: true },
    enable_recording_console_log: true,
    session_recording: {
      maskAllInputs: true,
      captureCanvas: { recordCanvas: true, canvasFps: 2, canvasQuality: '0.4' },
    },
    // The standalone sites under ankush.one (3dsDL, sh23ds, mixtunes) send to the same project and
    // tag their events with `site`. Tagged per event rather than with register(), which would save
    // it in the storage this origin shares and follow the visitor onto those sites. `surface` tells
    // the plaza framed on another site (the X player) apart from visits to the site itself.
    before_send: (event) => {
      if (event) event.properties = { ...event.properties, site: 'ankush.one', surface };
      return event;
    },
  });
  for (const fn of queue.splice(0)) fn(p);
  posthog = p;
  loaded(p);
}

if (on) {
  const start = () => void load().catch(() => loaded(null));
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 1500);
} else loaded(null);

// Pageviews: one per page, sent once the new page is in. The address is taken now, as the page may
// have changed again by the time PostHog loads. Leaving one page for another through the router is
// a page leave too, as a full load would have been.
let last: Properties | null = null;
document.addEventListener('astro:page-load', () => {
  const { origin, pathname, search } = location;
  last = { $current_url: origin + pathname + search, $pathname: pathname };
  send('$pageview', {
    ...last,
    title: document.title,
    section: sectionOf(pathname),
    not_found: Boolean(document.querySelector('[data-not-found]')),
  });
});
document.addEventListener('astro:before-preparation', () => last && send('$pageleave', last));

/** Records a named event. */
export function track<E extends keyof Events>(event: E, ...[props]: Events[E] extends undefined ? [] : [Events[E]]) {
  send(event, props as Properties | undefined);
}

/** Ties this browser's visits to a name taken in a live app, under the app's id for this browser. */
export function identify(uuid: string, nick: string) {
  withPostHog((p) => p.identify(uuid, { name: nick }));
}

/** Whether this browser has turned analytics off, or null where analytics doesn't run. */
export async function optedOut() {
  const p = await ready;
  return p ? p.has_opted_out_capturing() : null;
}

export async function optOut() {
  (await ready)?.opt_out_capturing();
}

export async function optIn() {
  (await ready)?.opt_in_capturing();
}
