# Third-party notices

This repository bundles or embeds work that belongs to other people. Nothing in
this file is covered by the licence of the site's own code. Entries marked
**unconfirmed** need the site owner to check the source and terms; they are
listed so the gap is visible, not hidden.

If you own something here and want it credited differently or removed, open an
issue or email ankush4singh@gmail.com.

## Open-source software shipped in the repo

| Path | Component | Author / project | Source | Licence |
| --- | --- | --- | --- | --- |
| `static/v86/libv86.js`, `static/v86/v86.wasm` | v86 x86 emulator | Fabian Hemmer and contributors | https://github.com/copy/v86 | BSD-2-Clause |
| `static/v86/seabios.bin` | SeaBIOS | SeaBIOS project | https://www.seabios.org/ | LGPL-3.0 |
| `static/v86/vgabios.bin` | VGABIOS | Bochs / VGABIOS project | https://www.nongnu.org/vgabios/ | LGPL (v2 or later) |
| `static/v86/bzimage/buildroot.bin` | Linux kernel + Buildroot userland image | Linux and Buildroot contributors | https://buildroot.org/ | GPL-2.0 (kernel); userland packages carry their own licences. Exact build config **unconfirmed** |
| `static/ruffle/ruffle.js`, `static/ruffle/core.ruffle.*.js`, `static/ruffle/*.wasm` | Ruffle Flash emulator | Ruffle contributors | https://ruffle.rs/ | MIT OR Apache-2.0 |
| `static/xterm/xterm.js`, `static/xterm/xterm.css` | xterm.js 5.3.0 | xterm.js authors | https://github.com/xtermjs/xterm.js | MIT |
| `static/xterm/addon.js` | xterm-addon-fit 0.8.0 | xterm.js authors | https://github.com/xtermjs/xterm.js | MIT |
| `assets/js/vendor/gun.js` | GUN 0.2020.1241 | Mark Nadal and contributors | https://github.com/amark/gun | Zlib OR MIT OR Apache-2.0 |
| `static/models/nsfwjs/*` | NSFWJS model weights | Infinite Red | https://github.com/infinitered/nsfwjs | MIT |
| `static/doom/websockets-doom.js`, `static/doom/websockets-doom.wasm` | Chocolate Doom, WebAssembly build | Chocolate Doom contributors (WebAssembly port believed to be `cloudflare/doom-wasm`, **unconfirmed**) | https://www.chocolate-doom.org/ | GPL-2.0 |
| `static/doom/vt323.woff2` | VT323 font | The VT323 Project Authors (Peter Hull) | https://fonts.google.com/specimen/VT323 | SIL Open Font License 1.1 (text in `static/doom/vt323-OFL.txt`) |

The BSD, MIT, Apache and GPL licences above require their copyright and
permission notices to travel with the files. The minified builds in this repo do
not all carry them, so the upstream licence texts should be added next to each
component (for example `static/v86/LICENSE`) or reproduced here.

## Loaded at runtime from a CDN (not stored in the repo)

| Component | Where | Licence |
| --- | --- | --- |
| TensorFlow.js 4.22.0 | jsDelivr, IRC Chat image check | Apache-2.0 |
| nsfwjs 4.0.0 | jsDelivr, IRC Chat image check | MIT |
| omggif 1.0.10 | jsDelivr, IRC Chat GIF decoding | MIT |
| nipplejs 0.9.0 | cdnjs, DOOM touch joystick | MIT |
| PostHog JS | `p1.ankush.one` proxy, analytics | see https://github.com/PostHog/posthog-js |
| YouTube IFrame Player API | Music app and video embeds | YouTube API Terms of Service |
| X (Twitter) widgets.js | Embedded posts | X Developer terms |

## Games and ROMs

| Path | Work | Rights holder | Terms |
| --- | --- | --- | --- |
| `static/doom/doom1.wad` | DOOM shareware episode (v1.9, md5 `f0cefca49926d00903cf57551d901abe`) | id Software | Shareware: free to distribute unmodified, not open source |
| (embedded from `thelongestyard.link`, not in the repo) | Quake III Arena demo | id Software | Hosted by a third party |
| `static/ruffle/games/alien_hominid.swf` | Alien Hominid (Flash, 2002), https://www.alienhominid.com/ | Tom Fulp and Dan Paladin / The Behemoth | No licence granted. All rights reserved by the authors |
| `static/ruffle/games/flyguy.swf` | Fly Guy (Flash), http://www.trevorvanmeter.com/flyguy/ | Trevor Van Meter | No licence granted. All rights reserved by the author |
| `static/ruffle/games/marvin_spectrum.swf` | Marvin Spectrum (Flash) | **unconfirmed** | No licence granted |
| `static/ruffle/games/wasted_sky.swf` | Wasted Sky (Flash) | **unconfirmed** | No licence granted |
| `static/v86/floppy/stillalive.img` | "Still Alive" boot-floppy demo | Demo author **unconfirmed**. Song from Portal (Valve), written by Jonathan Coulton | No licence granted |

The Flash games are redistributed without an explicit licence. Be ready to swap
them for embeds of the authors' own pages, or remove them, on request.

## Images, music and artwork

| Path | What it is | Rights holder | Status |
| --- | --- | --- | --- |
| `static/music/covers/*.jpg` (28 files) | YouTube thumbnail stills used as cover art for the tracks in `static/music/music.json` | The respective artists and labels | No licence granted. The audio itself is streamed by the YouTube player and is not in the repo |
| `static/wallpapers/wallpaper.webp` | Desktop wallpaper ("Aurora", the default) | **unconfirmed** (may be Apple's OS X Mavericks wallpaper) | Confirm the source or replace with an original |
| `static/wallpapers/{aqua,wave,dusk,lagoon,graphite}.webp`, `static/wallpapers/thumbs/*.webp` | The other desktop pictures in System Preferences | Site owner | Original artwork, drawn by `scripts/wallpapers/wallpapers.html` with the canvas API (see its README) |
| `static/icons/{activity,book-a-call,credits,daily-puzzle,passport,preferences,privacy,software-update}.webp` | App icons | Site owner | Drawn for this site; the SVG sources are in `assets/icons-src/` |
| `static/games/*.png`, `static/games/portal.webp`, `static/games/doom.svg` | Game icons | The respective game publishers | Source **unconfirmed** |
| `static/icons/gamecube.png`, `static/icons/messages.png`, `static/icons/resume.png`, `static/icons/instagram.png` | App and brand icons | The respective owners | Source **unconfirmed** |
| `static/icons/*.svg` | Brand glyphs (GitHub, X, Discord, LinkedIn, Reddit, Telegram, YouTube, itch.io) | The respective brands | Used to link to those services. Source **unconfirmed** |
| `static/icons/medium.svg` | Medium logomark | Medium | Path from Simple Icons (simpleicons.org, CC0 1.0); the mark itself is Medium's trademark, used to link to the owner's Medium profile |
| `static/emojis/harold.jpg` | Reaction image used in one blog post | **unconfirmed** | Source **unconfirmed** |
| `static/media/*-og.jpg` | Blog and project cover images | Site owner | Owner to confirm |
| `static/media/construct/*.jpg`, `static/media/construct/<post>/*` | Social cards and figures of the posts cross-posted from construct.computer | Construct Computer (the site owner's company) | Republished with the posts; each post's `canonical` points at the original |
| `layouts/partials/apps/doc/glyph.html` (github, npm, x) | Small brand marks in the article links bar | GitHub, npm and X | Trademarks of their owners, used only to label links to those services |
| `static/media/projects/*-cover.jpg` (12 files) | Project share images: thumbnails of the project demo videos on the site owner's own YouTube channel (`@AnkushKun`) | Site owner | Owner's own videos |

The desktop interface imitates Apple's OS X Mavericks as a tribute. Apple, OS X
and Mavericks are trademarks of Apple Inc. This project is not affiliated with
or endorsed by Apple.
