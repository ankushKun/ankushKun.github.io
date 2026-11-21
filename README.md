# ankush.one

Personal site built with Astro and Tailwind. Static output. The only client JavaScript is the 3D plaza on the home page and the Mii viewer at `/mii/`.

```sh
pnpm dev      # http://localhost:4321
pnpm check    # type check content and templates
pnpm build    # static site in dist/
```

## Adding content

Every entry is a folder with an `index.md` and its images. The folder name is the URL.

| Section | Folder | URL |
| --- | --- | --- |
| Blog | `src/content/blog/<slug>/` | `/blogs/<slug>/` |
| Projects | `src/content/projects/<slug>/` | `/projects/<slug>/` |
| Timeline | `src/content/timeline/<slug>/` | `/timeline/<slug>/` |
| Talks | `src/content/talks/<slug>/` | `/talks/<slug>/` |
| Consoles | `src/content/consoles/<slug>/` | `/console-collection/<slug>/` |

Copy an existing entry to start a new one. All entries share `title`, `description`, `date`, `updated`, `tags`, `cover`, `coverAlt`, `canonical`, `links`, `faq`, `related` and `draft`; each section adds a few fields of its own, defined in `src/content.config.ts`. The build fails if a required field is missing.

`cover` is optional: when set, it is used for the list thumbnail, detail hero image, and social preview. When omitted, a theme-agnostic 1200x630 card is generated at build time via `src/lib/og.ts` (`/og/<section>/<slug>.png`) for list thumbnails and social previews (configurable via `OG_THEME` in `src/lib/og.ts`). `description` is the meta description, social card text, RSS summary and `llms.txt` line, so keep it to one clear sentence. `draft: true` shows the entry in dev only.

Standalone pages (About, Now, Privacy...) and the intro of every section index are Markdown files in `src/content/pages/`, named after the page. Resume data lives in `src/data/resume.ts` and also feeds the About page. Name, socials, nav, booking link and newsletter form target live in `src/site.ts`.

## Home page plaza

The home page is a Wii U style plaza rendered with three.js, timed off the console's own start up. It opens on your Mii floating in the haze with a tap prompt over it. The click (browsers only allow sound after one) starts the music and the opening: you fall under real gravity, the camera riding down with you, to your friends waiting below, land with a knee bend and wave hello while they clap, the camera pulls back as ten glass blocks tumble in one after another, then a crowd runs in with their hands up and gathers under the blocks. Now and then someone in the crowd says something real from the site in a speech bubble.

- Each block shows title art from `public/plaza/icons/<section>.webp` (512px, named after the section's path, e.g. `blogs.webp`), made like Wii U menu icons: one character with an attitude, cropped boldly, in its own medium (yarn, clay, cut paper, pixel art, cel animation...), with no text. The block's name shows on a tag when it is hovered or focused. A section without a file falls back to a drawn glyph with its name.
- The back row shows `FEATURED` random blog posts and projects that have a cover, a new pick on each visit, with the cover as the block's art.
- Which links become blocks, their glyph and colors, your Mii (`ME`), your friends (`HERO`) and the crowd size live in `src/data/plaza.ts`. Block names come from `NAV` and `FOOTER_NAV`.
- Bubbles are built at build time in `src/lib/plaza.ts` from the latest entries. Your own Mii speaks the Now page.
- The runtime is in `src/components/plaza/`:
  - `layout.ts` holds the camera and where everything stands. The numbers were measured off captures of the console and are stored as screen positions, so wide and tall windows both work.
  - `floor.ts` draws the tiled floor, its glare and the mirrored Miis. `cubes.ts` draws the glass blocks: thin squircle slabs that refract a copy of the scene behind them, made each frame in `main.ts`. `icons.ts` draws the picture inside each one.
  - `heads.ts` draws distant heads as flat pictures, all in one draw call, photographed from twelve angles once each head is built; heads near the camera stay real 3D.
  - `crowd.ts` decides where every Mii goes and what it does. `motion.ts` is the library of moves: walk, run, clap, wave and so on.
  - `main.ts` plays the opening and handles zoom, links and sound.
- Zoom is smooth and continuous: mouse wheel, trackpad or touch pinch, or the `+` and `-` keys. It starts at the farthest view. The camera drifts a little toward the mouse, every block turns a little to face it, and a hovered block leans in further. Drag a block to spin it, as far round as you like; let go and it springs back to rest. A drag never counts as a click. Touch does the same: tap to open, drag a block to spin it, drag on open floor to look around, pinch to zoom.
- Miis can be played with once the opening is over. Tap one and it turns to you and does something (a wave, a dance, a faint...); keep tapping and it loses its temper. Press and drag to pick it up by the shirt: it dangles from the pointer, swinging as you move. Let go to set it down, or flick to throw it. Wherever it lands it freezes for a second, looks round in shock and runs off (your friends run back to their places). A held finger also lifts a Mii on touch screens. On a desktop, resting the pointer on a named Mii shows its name and QR code. Crowd Miis only get their full set of faces (`MiiSet.liven`) once someone plays with them, which keeps memory down.
- The sound is one recording, `public/media/warawara-plaza.mp3`, cut so the chime lands on your drop, the footsteps on the crowd's run in, and the theme loops from then on. `SCORE` in `audio.ts` holds those moments, and while the recording runs through them it is the scene's clock, so the two cannot drift.
- Sound plays from the click that starts the opening; Enter or Space works too. `M` mutes.
- The opening plays on every load. The first time in a browser session it can't be skipped; after that, Escape or another click skips it. Reduced motion skips the wait and the opening and stills the crowd.
- Without WebGL or JavaScript, or with Save-Data on, the blocks render as a plain grid of links.
- If frames run slow, the plaza lowers its resolution a step at a time, and raises it again when there is room. Its heaviest files start downloading with the page.
- In `pnpm dev`, `__plaza.seek(4.2)` in the browser console jumps to a moment of the opening and holds it, `__plaza.zoom(2.5)` sets the zoom (0 to 3), `__plaza.point(x, y)` places the pointer, `__plaza.mii(i)` says where Mii `i` is on screen and `__plaza.play()` resumes.

## Miis

Miis are real Wii U Miis, drawn by Nintendo's face library (FFL, compiled to WebAssembly through [FFL.js](https://github.com/ariankordi/FFL.js)) on the Wii U body models. The code in `src/components/mii/` comes from the [Mii Creator](https://github.com/ankushKun/mii-creator) fork.

- To add Miis, drop Mii QR code images into `src/data/miis/`. QR codes from a 3DS, a Wii U, Miitomo or Tomodachi Life all work, and so do the ones shared online. The build decodes them (`src/lib/miis.ts`) and every one joins the crowd, shuffled on each visit so different faces stand next to you. A Mii is named after its file (`Steve Jobs.png` is Steve Jobs), and the image itself is the QR code on its hover card, so crop it to the code. Random Miis from the Mii Maker's own generator fill the rest.
- `ME` and `HERO` take a file name from that folder or a Mii code (base64 of the 96 Mii bytes).
- `/mii/` loads a QR code image (open, paste or drop) or a code, shows the Mii in 3D and gives you its code.
- `data.ts` reads and writes Mii data and decrypts QR codes. It has no DOM or three.js, so the build and the browser share it.
- `rig.ts` draws a group of Miis: one FFL head per Mii, and every body of one gender in a single skinned draw call. A pose is a plain object of joint angles. The crowd and `/mii/` both use it.
- `public/ffl/` holds the FFL WebAssembly build, its resource file and the Wii U bodies, about 5.6 MB that the plaza loads on first visit.

## Structure

```
src/
  site.ts               site identity, socials, nav, newsletter
  content.config.ts     content schemas
  content/              all writing and images
  data/resume.ts        experience, education, skills
  data/plaza.ts         plaza blocks, your Mii, your friends, crowd size
  data/miis/            Mii QR code images for the crowd
  layouts/
    Base.astro          html shell, meta tags, Open Graph, JSON-LD
    Page.astro          page driven by src/content/pages/<id>.md
    Entry.astro         detail page for any entry
  components/           EntryList (thumbnail list), YearGroups, plaza/ (home page 3D scene), mii/ (Wii U Miis)
  lib/
    content.ts          queries, URLs, dates
    plaza.ts            plaza blocks and bubbles from the nav and entries
    miis.ts             Mii QR images to Mii codes, at build time
    schema.ts           schema.org builders
  pages/                routes, plus sitemap.xml, robots.txt, llms.txt, blogs/index.xml
public/                 favicon, resume.pdf, ffl/ (Mii runtime and models)
```

## SEO, AEO and GEO

Every page gets a canonical URL, a meta description, Open Graph and Twitter tags with a 1200x630 image, and a JSON-LD graph that ties it to the `WebSite` and `Person` nodes: `BlogPosting` for posts, `CreativeWork` for projects, `Article` for timeline entries, `Event` for talks, `ProfilePage` for About, `ContactPage` for Contact, `CollectionPage` for indexes, and breadcrumbs everywhere. The sitemap picks up new pages automatically.
