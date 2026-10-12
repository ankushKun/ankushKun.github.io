# ankush.one

Source for [ankush.one](https://ankush.one), Ankush Singh's personal site. It is a
static [Hugo](https://gohugo.io) site dressed up as an OS X Mavericks desktop:
projects, blog posts and the timeline open in draggable windows, next to a
handful of toys (Terminal, IRC Chat, Guestbook, Paint, Music, games).

- Hosting: GitHub Pages behind Cloudflare, built by `.github/workflows/hugo.yml`.
- Realtime features (cursors, sticky note, Guestbook, Paint, IRC) sync over
  [GUN](https://gun.eco) relays. There is no backend to run.
- Every page also works as a plain standalone URL (`/projects/`, `/blogs/...`),
  which is what crawlers and no-JS visitors get.

## Run it locally

Requires Hugo **extended**, the version pinned as `HUGO_VERSION` in
`.github/workflows/hugo.yml`.

```sh
hugo server          # http://localhost:1313, live reload
hugo --gc --minify   # production build into ./public
```

Analytics is skipped on localhost and on non-production builds.

## Layout

| Path | What lives there |
| --- | --- |
| `content/projects/`, `content/blogs/`, `content/timeline/` | Markdown pages. File names are `YYYY.slug.md` for projects and timeline entries |
| `content/<section>/_index.md` | Section pages (`about`, `schedule`, `privacy`, `credits`, `resume`) |
| `data/apps.yaml` | Registry of every desktop app and game |
| `data/contact.yaml`, `data/wins.yaml` | Socials and contact links (About, Activity Monitor, structured data); hackathon awards (Person structured data) |
| `layouts/partials/apps/<app>/` | Markup for each app window |
| `layouts/partials/os/` | Desktop shell: windows, icons, menu bar |
| `assets/js/`, `assets/css/` | Shell and app code. New stylesheets go in `assets/css/apps/` and are bundled automatically |
| `static/` | Files served as-is (media, games, emulator images) |
| `workers/site-worker/` | Optional Cloudflare Worker (link proxy, GIF search). See its README |
| `docs/cloudflare.md` | Cloudflare and deploy settings that live outside the repo |
| `scripts/sync-music-meta.sh` | Regenerates `static/music/music.json` and the cover stills |

## Adding an app

1. Add an entry to `data/apps.yaml`:

   ```yaml
   - id: my-app            # window id, also used by /?open=my-app
     label: My App         # icon label
     title: My App         # window title
     type: app             # or "game" (+ group: games) to list it in the Games folder
     description: Shown in Spotlight
     desktop: false        # an icon on the desktop (none have one: the Dock is the launcher)
     dock: false           # in the Dock (the content apps and All Apps live there)
     searchable: true      # show in Spotlight search
     contentPermalink: /my-app/   # optional, see step 2
     defaultSize: { width: 900, height: 650 }
     icon:
       type: image         # or "partial" with partial: icons/desktop/<name>.html
       src: /icons/my-app.png
   ```

2. Give the window a body, one of two ways:
   - **A page.** Set `contentPermalink` to a page on the site. The shell fetches
     that page and lifts its `.window-content` into the window. A section with
     only an `_index.md` (like `content/privacy/`) needs no template.
   - **Inline markup.** Add a `<div id="content-my-app">` block (usually a
     partial under `layouts/partials/apps/`) to `#window-contents` in
     `layouts/index.html`.

## Writing content

Front matter is TOML (`+++`). Beyond `title`, `date`, `summary` and
`description`, these keys are understood:

| Key | Where | Meaning |
| --- | --- | --- |
| `tags` | all | Lowercase, from the small shared set already in use (see `/tags/`) |
| `github` | projects | `owner/repo`, rendered as the GitHub button |
| `website` | projects | Live URL, rendered as the Website button. Leave it out when the site is dead |
| `demo` | all | Live demo URL, shown in the links bar (the main button when there is no `website`) |
| `npm` | all | npm package name or URL, shown in the links bar |
| `video` | all | Video URL, shown as "Watch video" unless the same YouTube video is embedded in the body |
| `links` | all | Any other links for the links bar: `[{ label = "...", url = "...", icon = "github", primary = true }]`. `icon` is optional (guessed from the host); `primary` marks the main button when there is no `website` or `demo`. A `web.archive.org` URL is shown muted and labelled as an archived snapshot |
| `image` | all | Cover picture shown under the links bar (blog posts fall back to `og_image`) |
| `cover = false` | all | Hide the cover, e.g. when the post opens with its own hero |
| `faq` | all | `[{ q = "...", a = "..." }]`, rendered as an FAQ section (answers are markdown) and as FAQPage JSON-LD |
| `status = "archived"` | projects | Project is no longer maintained or online |
| `featured = true` | projects | Flagship project |
| `related` | all | Paths of related pages, e.g. `["/blogs/pokemon-scanner"]` |
| `canonical` | blogs | Original URL for cross-posted articles |
| `og_image` | all | Social card image under `static/` (1200x630) |
| `date_precision = "year"` | timeline | The month and day are placeholders, only the year is known |
| `slug`, `aliases` | all | Change a URL without renaming the file. Always add the old URL to `aliases` |

Shortcodes: `{{< button "url" "Label" >}}`, `{{< github "owner/repo" >}}`,
`{{< npm "package" >}}`, `{{< youtube ID >}}`, `{{< emoji "/emojis/x.jpg" >}}`,
`{{< gallery >}}...{{< /gallery >}}` (youtube shortcodes or images shown side by side),
`{{< demo src="url" title="..." caption="..." >}}` (an embedded playable page) and
`{{< aside >}}...{{< /aside >}}` (a quiet side remark).
A `button` pointing at `web.archive.org` is styled as an archived snapshot.
GitHub-style callouts work in the body: a blockquote starting with `[!NOTE]`,
`[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`.

When a project's live site dies: set `status = "archived"`, remove `website`, and
if the Wayback Machine has a snapshot
(`https://archive.org/wayback/available?url=<url>`), add it to `links`, e.g.
`{ label = "Website", url = "https://web.archive.org/web/..." }`. The links bar
adds the "snapshot" note and the archive icon itself, so keep that word out of
the label.

## Licence

**Not decided yet.** There is no `LICENSE` file, so by default all rights are
reserved even though the source is public. Proposal for the owner to confirm:

- **Code** (`layouts/`, `assets/`, `workers/`, `scripts/`): MIT.
- **Writing and personal media** (`content/`, `static/media/`, `static/pfp*`,
  `static/resume.pdf`): CC BY 4.0, or all rights reserved.
- **Third-party material** (emulators, games, ROMs, cover art, icons, wallpaper):
  not covered by either. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Until a `LICENSE` file is added, treat the proposal above as intent, not a grant.

## Known gaps

- `static/resume.pdf` predates Construct Computer and has to be replaced by hand
  with an updated export. It cannot be regenerated from this repo.
- Several entries in `THIRD_PARTY_NOTICES.md` are marked unconfirmed.
