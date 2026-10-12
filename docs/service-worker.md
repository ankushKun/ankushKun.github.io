# Service worker (offline desktop and instant repeat visits)

The site ships a service worker at `/sw.js`. After a visitor's first visit it
makes later visits load straight from the browser, keeps the desktop working
offline, and makes the site installable as an app (it reuses
`static/site.webmanifest`). There is nothing to run or configure for a deploy:
every build gets a fresh worker.

## What a visitor gets

- **First visit**: the page loads normally. Once it has finished loading and
  the browser is idle, the worker installs and saves a small shell: the home
  page, the stylesheet and script bundles (including the per-app stylesheets
  and scripts that load only when an app is opened), the Software Update changelog and the Music catalog, the
  default wallpaper, the icons and the offline page. Apps that need the
  network anyway (the realtime ones, Music playback, emulators not opened
  before) still need it; Music covers not seen before show their letter tile. That is about 1.6 MB of saved files
  (roughly 100 KB more to download than the page itself fetched).
- **Later visits**: pages are still fetched from the network first, so new
  posts show up straight away. If the network is slower than 3 seconds, the
  saved copy is shown. Stylesheets, scripts, icons and wallpapers come from the
  saved copy.
- **Offline**: the desktop opens from the saved copy, as do any pages and
  windows the visitor has opened before. Anything else shows a small "You're
  not connected to the Internet" window that lists what is available offline
  and reloads by itself when the connection comes back.
- **After a deploy**: an open tab keeps running the version it loaded. When the
  browser picks up the new worker, the visitor sees a "Website Update"
  notification; clicking it switches to the new version and reloads. If the
  only open tab already shows the new version, the switch happens silently.
  A page never runs on one deploy's HTML with another deploy's CSS or JS: a
  saved page is kept together with every bundle it can load, and once the
  browser knows a new deploy exists, pages wait for the network (up to 12
  seconds instead of 3) rather than show the old saved copy. The very first
  page load after a deploy can still be the old saved copy if the network is
  slow; it is complete and consistent, and the notification offers the new one.
- **Icons and other files without a hash in their name** (`/icons/`,
  `/wallpapers/`) are still subject to the browser's ordinary HTTP cache, worker
  or not, so replacing one in place can show the old picture for as long as the
  host's cache headers allow. Give a changed icon a new file name if it must
  show up at once.

## What is saved, and what never is

| Kind | How |
| --- | --- |
| Pages (navigations and windows opening a page) | Network first, 3 s timeout (12 s once a newer deploy is known), saved copy as fallback. One copy per path (query strings such as `?fbclid=` or `?open=` are ignored), at most 50 pages besides the desktop |
| `/css/` and `/js/` bundles (fingerprinted) | Saved copy first |
| Icons, wallpapers, images | Saved copy first, except for a page of a newer deploy, which gets them from the network |
| `/index.json`, feeds, `llms.txt`, other data files | Saved copy at once, refreshed in the background |
| Emulators and games (`/v86/`, `/ruffle/`, `/doom/`, `/models/`, `/xterm/`) | Only once the visitor opens that app, then saved copy first |

Never saved: anything on another domain (the Gun relays, PostHog, the link
proxy, YouTube, GitHub, fonts), video and audio files, range requests, POSTs,
error pages, redirects and the alias pages that redirect old URLs (`/wins/`,
`/contact/`, renamed posts). Every save is tagged with the build, and each new
deploy deletes the previous build's copies.

## Switching it off

Two kill switches. Either one makes every visitor's browser remove the worker
and delete everything it saved, on their next visit.

1. **Fast, no rebuild**: add a file `static/sw-disabled.txt` (any content) and
   deploy, or upload `sw-disabled.txt` to the site root by any other means.
   The worker checks for it on every page load it serves, and pages check too
   (a "not there" answer is remembered for a minute per tab), so it acts on the
   visitor's next page load, even if a broken worker stops the page's own
   scripts. Delete the file to allow the worker again.
2. **In the config**: set `enabled = false` under `[params.serviceWorker]` in
   `hugo.toml` (or set `HUGO_PARAMS_SERVICEWORKER_ENABLED=false` on the build).
   `/sw.js` then becomes a tiny worker that deletes the caches and unregisters
   itself, and no page registers a worker.

`hugo server` never registers the worker (it is a production-only feature), and
opening a dev build removes any worker left behind on that address.

**Never delete `sw.js` itself** (for example by removing the `sw` output format
from `hugo.toml`) to switch the worker off: use `sw-disabled.txt` or
`enabled = false`. A deleted worker is a safety net only: an installed worker
removes itself and its caches once it sees a page of a newer deploy and finds
`/sw.js` gone, but until then it keeps serving the old version.

## Things to know

- The check for `sw-disabled.txt` is a tiny HEAD request that normally
  answers 404, which can show up as a red "Failed to load resource" line in the
  browser console. That is expected.
- If a Content-Security-Policy header is ever enforced, it must allow the
  worker (`worker-src 'self'`, or a `default-src 'self'` that covers it).
- In Chrome DevTools, **Application > Service workers** shows the running build
  (the number in the cache names, `ankush-sw-<build>-pages` and so on, is the
  build time, followed by the deploy commit).

## Files

- `layouts/index.sw.js`: the worker (home output format `sw` in `hugo.toml`)
- `layouts/index.offline.html`: the offline page, `/offline.html`
- `layouts/partials/sw/register.html` and `assets/js/sw-register.js`:
  registration, kill switch and update notification, included from
  `layouts/_default/baseof.html`
- `layouts/partials/sw/build.html`: the build id shared by all of the above
- `layouts/partials/sw/enabled.html`: the production / `enabled` switch
