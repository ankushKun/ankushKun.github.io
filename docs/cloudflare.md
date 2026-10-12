# Cloudflare and deploy setup

The site is static Hugo on GitHub Pages with Cloudflare in front. GitHub Pages
cannot set response headers, so everything below lives in the Cloudflare
dashboard or in GitHub repository secrets. Nothing here is required for the site
to build or deploy: each item switches on one extra.

## 1. Security headers (Response Header Transform Rule)

Dashboard: **Rules > Transform Rules > Modify Response Header > Create rule**,
matching *All incoming requests* for `ankush.one`. Add these with *Set static*:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Content-Security-Policy` | see below |

The page still uses inline scripts and inline `onclick` handlers, so
`'unsafe-inline'` is needed for now; the v86 terminal, Ruffle and Doom need
`'wasm-unsafe-eval'`. This is the policy in use, on one line in the rule:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://p1.ankush.one https://www.youtube.com https://s.ytimg.com https://platform.twitter.com https://cdn.jsdelivr.net;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
media-src 'self' blob: https:;
font-src 'self' data:;
connect-src 'self' https://gun.ankush.one wss://gun.ankush.one https://p1.ankush.one https://api.klipy.com https://api.github.com https://cdn.jsdelivr.net https://ankush-site-worker.ankushkun.workers.dev;
frame-src 'self' https:;
worker-src 'self' blob:;
frame-ancestors 'self';
base-uri 'self';
form-action 'self'
```

It was checked by serving a local build with the header enforced and opening
every app, a post, a project, Doom, a Flash game, the itch.io embed, the
cal.com window and a proxied external link: no violations. Analytics is
skipped locally, but all of it goes through `p1.ankush.one`, which is listed.

- `frame-src 'self' https:` because the link proxy (section 3) answers
  frameable sites with a 302 to the real address, and `frame-src` is checked
  against that final address too; the Worker's allowlist is what limits which
  sites load. If the link proxy is ever switched off, a host list would do.
- The Worker origin is in `connect-src` for IRC GIF search (`<proxy>/gif/...`).
  `api.klipy.com` stays for the direct fallback IRC uses if the Worker
  answers 503.
- `cdn.jsdelivr.net` is only used by IRC's optional image filter (omggif,
  tfjs, nsfwjs). Gun.js is self-hosted in `assets/js/vendor/gun.js`.
- VT323 for the Doom page is self-hosted at `/doom/vt323.woff2`, so no Google
  Fonts host is needed in `font-src`.
- Adding a new embed or API host? Add it here and to the rule, or it is
  blocked. To test a change first, rename the header to
  `Content-Security-Policy-Report-Only` and watch the browser console.
- `includeSubDomains` is left off HSTS on purpose: add it only once every
  subdomain of ankush.one serves HTTPS.

## 2. Cache rules

Dashboard: **Caching > Cache Rules**.

- `/css/*` and `/js/*` are fingerprinted (the file name changes with the
  content): *Edge TTL* and *Browser TTL* one year.
- HTML, `/index.json`, `/sitemap.xml`, feeds: keep the short default so a deploy
  shows up quickly. The workflow can also purge on deploy (section 4).
- `/v86/*`, `/ruffle/*`, `/doom/*`, `/models/*`, `/music/*`: one week or longer.

## 3. External-link proxy Worker

Code and its own README live in `workers/site-worker/`.

1. `cd workers/site-worker && npx wrangler deploy` and note the printed origin.
2. `npx wrangler secret put KLIPY_API_KEY` (then rotate the key that used to be
   committed in `assets/js/irc-chat.js`).
3. Set `linkProxy = "<that origin>"` under `[params]` in `hugo.toml`. Empty
   means the feature is off and external links open in a new tab as before.
4. Add the origin to `connect-src`, and switch `frame-src` to `'self' https:`
   as described in section 1.

## 4. GitHub repository secrets (all optional)

**Settings > Secrets and variables > Actions.** Every step that uses one of
these is skipped when it is missing and can never fail a deploy.

| Secret | Used for |
| --- | --- |
| `CLOUDFLARE_ZONE_ID` | Zone id of `ankush.one` (dashboard overview page) |
| `CLOUDFLARE_API_TOKEN` | API token with only *Zone > Cache Purge > Purge* on that zone; purges the cache after each deploy |
| `INDEXNOW_KEY` | Any 8-128 characters of letters, digits and dashes (IndexNow format; anything else is skipped with a warning). The build publishes it at `/<key>.txt` and each deploy you start (a push or a manual run, not the guestbook backup's automatic redeploys) submits the sitemap URLs to IndexNow (Bing, Yandex and others) |

## 5. What the deploy workflow checks

`.github/workflows/hugo.yml` builds on every push to `main` and on pull requests
(pull requests are never deployed).

- Blocking: the Hugo build itself, every JSON-LD / JSON block parses, and
  `index.json` stays under 150 KB.
- Advisory (warnings only): internal link check, `llms.txt` covering every blog
  post, oversized icons.
- Weekly (Mondays) and on manual runs: external link check, which keeps one
  open "Broken external links" issue up to date with the current list.

The Hugo version is pinned in the workflow (`HUGO_VERSION`) and guarded by
`[module.hugoVersion]` in `hugo.toml`; bump both together with the local Hugo.

## 6. Search engines (one-time, owner only)

- Verify `ankush.one` in Google Search Console and Bing Webmaster Tools with a
  DNS TXT record on Cloudflare (no template change needed), then submit
  `https://ankush.one/sitemap.xml` in both.
- Set the `INDEXNOW_KEY` secret (section 4) so new posts are pushed to Bing
  instead of waiting for a crawl.

`robots.txt`, `llms.txt`, `llms-full.txt`, `feed.json` and
`external-hosts.json` are generated by the build (`layouts/robots.txt`,
`layouts/index.*`); there is nothing to keep in sync by hand.
