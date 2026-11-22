# ankush.one

Personal site built with Astro and Tailwind. Static output. Client JavaScript is the page router (Astro's `ClientRouter`), the 3D plaza (the home page only), the music radio, your Mii on the About page, the Mii viewer at `/mii/`, the apps and the UI sounds. Every page works without it.

```sh
pnpm dev      # http://localhost:4321
pnpm check    # type check content and templates
pnpm build    # static site in dist/
pnpm favicons # save the icons of linked sites (after adding links)
```

## Adding content

Every entry is a folder with an `index.md` and its images. The folder name is the URL.

| Section | Folder | URL |
| --- | --- | --- |
| Blog | `src/content/blog/<slug>/` | `/blogs/<slug>/` |
| Projects | `src/content/projects/<slug>/` | `/projects/<slug>/` |
| Timeline | `src/content/timeline/<slug>/` | `/timeline/<slug>/` |

Copy an existing entry to start a new one. All entries share `title`, `description`, `date`, `updated`, `tags`, `cover`, `coverAlt`, `canonical`, `links`, `faq`, `related` and `draft`; each section adds a few fields of its own, defined in `src/content.config.ts`. The build fails if a required field is missing.

`cover` is optional: when set, it is used for the list thumbnail, detail hero image, and social preview. When omitted, a theme-agnostic 1200x630 card is generated at build time via `src/lib/og.ts` (`/og/<section>/<slug>.png`) for list thumbnails and social previews (configurable via `OG_THEME` in `src/lib/og.ts`). `description` is the meta description, social card text, RSS summary and `llms.txt` line, so keep it to one clear sentence. `draft: true` shows the entry in dev only.

Standalone pages (About, Privacy, Credits...) and the intro of every section index are Markdown files in `src/content/pages/`, named after the page. Resume data lives in `src/data/resume.ts` and also feeds the About page. Name, socials, nav, booking link and newsletter form target live in `src/site.ts`.

## Every other page

Every page but the plaza is shown on a TV (`src/components/ui/Frame.astro`): a white casing round a pale screen with a CRT's rounded corners, and one white column down the middle of the screen, as wide as two thirds of it, to read. The page scrolls under the casing's edge as under glass. Nothing else is on the screen:

- **Top left**, a round button back to the plaza. **Top right**, a round button that opens the menu of sections (`NAV` in `src/site.ts`): their glass tiles drop out of it one under another (`src/scripts/menu.ts`), each with its name on a dark tag to its left (the section you are in has a blue one), and fold back up into it when it closes. It stays open, without dimming the page, until the button or Escape closes it, and on a big screen it stays open as you go from page to page. Icons are frosted glass like the Wii U home menu's (`--aero-*` in `global.css`).
- **The footer** at the end of every page links the rest of the site (`FOOTER_NAV`): home, the sections, privacy, credits and the RSS feed.
- **On a phone** the casing is thinner, the column fills the screen under the two buttons, the buttons step aside while you read down a page and come back when you scroll up.
- **Lists**: the blog is rows of posts under their year (`Feed.astro`); projects are glossy channel tiles, more across as the column widens (`ChannelMenu.astro`); the timeline is memos dated by little calendar pages colored by kind (`Timeline.astro`); apps are the Wii's channel menu (`apps.astro` on `ChannelGrid.astro`): wide channels in glossy frames, art edge to edge with the name across the top (the app's own banner from `src/assets/channels/<slug>.webp`, painted 16:9 on white in the style of the block art with its scene kept below the name, which is then grey; else a wide crop of its block art; else a drawn banner, `/art/channel/<slug>.svg`), always whole pages of twelve with grey empty channels in the free slots, two, three or four across by the room the menu has; games (`games.astro`) are the same menu, every game in `src/data/games.ts`, each opening its own page (see Games).
- **Entries** (`layouts/Entry.astro`) read top to bottom: the B button back to the section, the title, a byline signed by your Mii, the picture, then the text. Standalone pages (`layouts/Page.astro`) are a title and their text; sections of a longer page are `Panel.astro`, a heading with what is under it.
- **Light and dark** follow the device until you pick one with the icon out in the casing's top right corner, or at the top beside the plaza button on a phone (`ThemeToggle.astro`, `src/scripts/theme.ts`); picking what the device already shows goes back to following it. The dark TV has a black casing and a charcoal column. Colors that change are `light-dark()` pairs on the tokens in `global.css`. On the TV the new lights spread in a circle from the icon; on the plaza it turns to night, the floor, haze and fog dimming over about half a second (`setNight` in `plaza/floor.ts`). The theme is set before the page draws, so it never flashes.
- **Icons** on the TV's buttons and the light switch are [Hugeicons](https://hugeicons.com) (`@hugeicons/core-free-icons`), drawn at build time as inline SVG by `HugeIcon.astro`.
- **Link buttons** (`MenuButton.astro`) are one design everywhere: the console's plain glossy surface, a badge, the label, and an end mark for what pressing it does (an arrow opens a new tab, a chevron stays on the site, a down arrow downloads). Color only lives in the badge, which `src/lib/links.ts` picks from the href: a platform's real mark from [Simple Icons](https://simpleicons.org) (`src/lib/platforms.ts`, one row per platform), else the site's own icon, else a section's tile for pages here, else a glyph. The label is always the one written, so give every `links:` entry a label that says what it opens ("3dsDL", not "Website"). Entries and the 404 go back with `BackButton.astro`, made the same way.
- **Site icons** for links to sites without a platform mark are saved by `pnpm favicons` (`scripts/favicons.mjs`) into `public/favicons/`, with `src/data/favicons.json` saying whether each fills its badge or sits on a white tile. Both are committed, so the build never goes online. Run it after adding links; a site with no usable icon gets a globe.
- **Links out of the site** open in a new tab with a small arrow after them: Markdown through a Sätteri plugin (`src/lib/external-links.ts`), short data strings through `inline()`, templates through `extAttrs()` (`src/lib/external.ts`). Astro caches rendered Markdown, so after changing the plugin delete `node_modules/.astro/data-store.json` before building.
- **Sounds** are made on the spot (`src/scripts/sfx.ts`): a tick when you point at something, a chime when you press it. `M` mutes them and the music. `B` goes back.
- **Music** plays across the whole site (see Music below). Its widget (`src/components/music/Widget.astro`) sits in the casing's top left corner, mirroring the light switch (beside it on a phone, left of it on the plaza, in the bar on an app's screen): a note that turns into dancing bars while music is heard, the track's name on a dark tag for a moment when it changes, and a small player (art, seek, previous, play, next, volume, Open Music) that drops out of it, as far from the side of the screen as from the top (centred on a phone).
- **Mii portraits** (`public/mii/`) are rendered from `ME`: neutral, happy, surprised, and a full-body one for the 404. Re-render them if `ME` changes.
- Entries without a `cover` get drawn art from `/art/<section>/<slug>.svg`, picked from their tags (`src/lib/tiles.ts`). Sections without a plaza block take their tile's glyph and colors from `TILES` in `src/data/sections.ts`.

Moving between pages follows one model (`src/scripts/motion.ts`, the end of `global.css`, `plaza/main.ts`):

- **Plaza and pages.** The plaza is the room and the TV the screen in it. Press a block and the camera zooms into it until it fills the screen, the plaza fading away into its haze on the way, and then the page fades in. Come back (the plaza button, the footer's Home, or Back) and the page fades out as the plaza fades in close on the block of the section you were in and pulls back from it. These go through the router like every other move (`html[data-plaza-move]`), so the site is one document for the whole visit and the music never stops. Once the plaza has run it is kept: on other pages it sleeps out of sight (no frames, its clock stopped; every page holds a place for it with `transition:persist`, and `motion.ts` drops a place the plaza never filled), and coming back wakes the same plaza.
- **On the TV** every page change is a plain fade: the casing, buttons and menu are one element throughout and stay in front, and only the column fades out and the next one in.
- **Apps** are the screen going full size: the casing slides off past the edges as the app grows in, and back as you leave. Opened from its channel on `/apps/`, the channel itself grows into the app and the app shrinks back into it (`data-grow`).
- A page opened directly (its address, a refresh, another site) fades in on its own.
- Every move takes one of three lengths, `--vt-out`, `--vt-in` and `--vt-big` in `global.css`. The app moves animate transforms only (`boxMove` in `motion.ts`), so they stay smooth while the app starts up underneath. Reduced motion turns them into short fades. Without JavaScript every link is a normal page load.
- `pnpm transitions` films every move on desktop and phone against `pnpm preview` and writes a sheet of frames for each into `.transitions/` (`scripts/transitions.mjs`; it needs `pnpm add -D playwright-core`, and ffmpeg for the sheets).

## Apps

Apps live at `/apps/<name>/` and take the whole screen instead of the reading column (`app` on `Base.astro`, `.col-app` in `global.css`): the TV's casing slides off past the edges as you go in and back as you leave (a channel grows into its app, see Moving between pages), and the plaza button stays in the top left. An app with a rail of its own (the chat) lists the sections there instead of the TV's menu: Menu in the rail unfolds them under it and folds them away, the rail scrolls when the screen is short, the TV's menu button stays hidden (`data-app-nav`), the menu folds away if it was open as you came in, and the light switch moves into the app's bar. On a phone the rail goes and both buttons stay in the bar. The list on `/apps/` is `src/data/apps.ts`; an app with an `href` opens, one without shakes its head. An app's plaza block, tile and art are keyed by its `href` once it has one (`appPath`), so a live app's block opens the app itself (`/apps/chat/`, `/games/`) and one marked `soon` opens a placeholder at its href (`pages/apps/[app].astro`, `AppSoon.astro`): its art, what it will be, and the way back. Every game on `/games/` has a page of its own the same way (`pages/games/[game].astro`) with its play links, where it will run once it is embedded.

### Music (`/apps/music/`)

The site's radio, and an iTunes 11 style player for it (`src/components/music/`): a toolbar with previous, play, next and volume on the left, the LCD in the middle (art, title, artist, seek, shuffle and repeat), search on the right, Cover Flow under it, on a pale stage by day and a black one by night, each cover mirrored on the floor (arrows, the wheel or a swipe move along; pressing the middle cover plays it), the songs (press one to play it, the headers sort) and a status line. On a phone Cover Flow and search make way.

- **Playback** is YouTube's IFrame player, hidden (`src/scripts/music/youtube.ts`), as on the old site: no audio is stored here. It is mounted on `<html>` itself, outside the `<body>` the router swaps, so it is never moved or reloaded. `engine.ts` is the one radio the widget, the app and the plaza all show: queue, shuffle (on by default, never one of the last few heard), repeat, fades, Media Session (lock screen and media keys), and one tab playing at a time (`BroadcastChannel`).
- **The plaza starts it.** The opening plays the plaza's own theme; once the crowd is in (or as soon as the opening is skipped, or you leave the plaza) the theme fades out as a random track fades in (`takeOver` in `engine.ts`, `release` in `plaza/audio.ts`). The two never play together. If YouTube can't be reached, or you stopped the music earlier in the session, the theme plays on. Each new track, the DJ says what it is in a bubble that opens the music player over them, and while it plays the Music block shows its cover with bars dancing over it (`plaza/nowplaying.ts`; they keep time on their own, since YouTube's sound can't be read from the page).
- **The DJ** stands under the Music block with a boombox on their shoulder, in a clear space of their own, facing out. While music is heard they bob on the beat, the boombox thumps and notes float up out of it (`groove` and `TEMPO` in `plaza/motion.ts`, `plaza/boombox.ts`). Pressing them, or their button with the keyboard, opens the music player over their head, the same player the widget opens, and it follows them while it is open (`openOver` in `src/scripts/music/widget.ts`). They can't be picked up. Either side of them dance Akita Neru and Kasane Teto (`BACKUP` in `src/data/plaza.ts`, made there from Miku's face with their own hair, eyes and shirts): while music is heard they step and punch on the DJ's beat and throw an arm up every other bar, mirroring each other (`idol` in `plaza/motion.ts`); everyone on stage keeps the beat from when the music was first heard, so they stay together however they started. Tap one and they react as anyone would, then dance on. Who the DJ is (`DJ`, Hatsune Miku) and which boombox (`BOOMBOX`) live in `src/data/plaza.ts`: `model` is Supersiv11's low poly boom box (`public/plaza/boombox.glb`, CC BY, 596 triangles, 11 KB after `gltf-transform optimize --compress meshopt`), `drawn` is built in code in the plaza's own style. In `pnpm dev`, `__plaza.boombox('drawn')` swaps them on the spot.
- Every load starts quiet, at 25%. Nothing else about playback is kept across loads, except that you stopped it, which holds for the session.
- A game (`play.ts`) or a video on a page holds the music: it fades out and comes back when they end. If the browser blocks a start, the next press anywhere starts it; on iOS the press that starts the plaza also unlocks the player silently, so the handover can play later.
- The mix is `src/data/music.json` with square covers in `public/music/covers/`, synced from the YouTube playlist by `pnpm music` (`scripts/music.mjs`, needs `yt-dlp`): metadata and thumbnail stills only. Titles and artists already in the file win over YouTube's, so fix a name there by hand and it stays fixed. Songs that aren't on the playlist go in `src/data/music-extra.json` (`videoId`, `title`, `artist`) and follow the playlist's, marked `byHand`; `pnpm music --extra` adds them without reading the playlist again. The Vocaloid songs for the DJ and their dancers are there.
- In `pnpm dev`, `__music.state` in the console shows the radio and `__music.log` every player state change and page swap: a page change should never log a pause or buffering.

### Chat (`/apps/chat/`)

A live chat room drawn as Miiverse was on the Wii U (`src/components/chat/`): a white rail down the left with your Mii, the people here, Menu (the site's sections, folding out under it) and Back (B), a green title bar with the faces of who is here, posts with each person's Mii beside a white card, and the Post button in the screen's bottom right corner. On a phone the rail goes and the bar holds the plaza and menu buttons.

- **No server of our own.** It talks to the GUN relay at `gun.ankush.one`, on the same nodes the old site's IRC chat used, so the room and its history carried over and old clients still interoperate. `net.ts` lists every node and checks everything read from them before the page sees it; text is only ever drawn as DOM text (`format.ts`).
- **Everyone is their Mii.** Joining gives you a random Mii from the Mii Maker's own generator; the Me sheet rolls another or loads one from a Mii QR code. Your Mii is stored once per person (`apps/irc/profiles/<uuid>`), so changing it updates everything you have said. Anyone without one (everyone from the old site) gets a stand-in made from their id or name (`seededMii` in `mii/rig.ts`), the same on every screen. A Mii code is either the 96 bytes of a QR code Mii or, for Miis made on the spot, an FFL CharInfo (`miiBytes` in `mii/data.ts`). `portraits.ts` photographs a Mii once in Miiverse's six feelings on one small offscreen canvas, newest asked for first so the posts on screen get theirs first, and caches the pictures; without WebGL a silhouette stands in.
- **Posts**: pick a feeling for your next post from the Me sheet (your Mii's face changes with it), write with a little Markdown, links and @mentions (an @ lists people to pick from, those here first, and a name that belongs to someone shows in their colour as you type: `mentions.ts`, a coloured mirror behind the text box), or draw: the pen button opens a sheet over the input bar with Miiverse's 320 by 120 black and white paper, a pen, a marker, an eraser, undo (also Cmd or Ctrl + Z) and clear, and its own Post. A drawing stays on the paper if you close the sheet, until you post or clear it. The GIF and drawing sheets open in the same place (`sheets.ts`). Everyone's name shows in a colour of their own, a hue hashed from their id rather than their name, so it stays when they rename (`hueOf` in `main.ts`). Cards are as wide as what they say, the time sits by the name, and each day starts under a divider. Yeah! and Delete sit in a slot beside each card, so pointing at a post never moves the feed. Delete is yours to use on your own posts; names in `CHAT_MODS` (`src/site.ts`) can delete anyone's. The relay has no accounts, so that is moderation by courtesy: anyone could take a mod's name or write to the relay directly. Slash commands from the old chat still work (`/help`).
- **GIFs**: the GIF button opens a sheet over the composer: trending GIFs, a search as you type, more as you scroll, and a tap posts one (`gifpicker.ts`). Searches go to Klipy through the old site's Cloudflare Worker (`GIF_PROXY` in `src/site.ts`), which keeps the Klipy key and only answers `https://ankush.one`; in dev, Vite forwards `/__gif` to it as ankush.one (`astro.config.mjs`). A GIF post carries its size, so its space is kept before it loads, and only Klipy's media host is ever shown. Empty `GIF_PROXY` turns the button off.
- **Scrolling**: the history is laid out unseen behind the Wii U wait and shown at once, already at its latest post. The feed stays pinned there as posts arrive and as pictures load, until you scroll up; new posts rise into place and the feed glides to them.
- The room keeps the last 110 posts; whoever is in it deletes older ones. Presence is rewritten every 5 seconds and shows who is typing.
- To try changes without touching the real room, run a GUN relay locally and build with `PUBLIC_CHAT_RELAY=http://localhost:8765/gun`.

## Games

Every game on `/games/` (`src/data/games.ts`) has a page at `/games/<id>/` (`pages/games/[game].astro`), a page on the TV like any other: a title screen (`AppCover.astro`) with the back button entries have (B presses it), the art, who made it, a green Play button and its links. Play morphs the TV into a CRT round the game (`src/scripts/play.ts`): the casing's hole, drawn as a path with the same steps either way, goes from the screen's rounded rectangle to a CRT's outline, sides bowed out and corners rounded, shaped to the game's own picture (`aspect`, 4:3 by default) and as large as fits under the TV's buttons, which stay where they always are, so there are no black bars. A dark lip runs round it like the tube's surround, the glass has a soft light and shaded edges, and the game fades in. A power button takes the plaza button's place while it plays and stops it: the game's frame is removed, which ends it and its sound, and the morph plays back to the ordinary TV. Leaving the page while playing puts the TV back at once. The game runs in a frame of its own, named by its full `index.html` path (the dev server serves no folder's index), so its keys, pointer lock and sound stay inside it and the site's B and M keep working outside it.

- **Your games** point at their project (`project`), which gives the cover, description and links. Those built for the web on itch.io play through itch's embed, letterboxed to their shape (`aspect`). Lucky Knight's build needs cross-origin isolation, which no framed page gets, so its Play opens itch.io in a new tab (`newTab`).
- **Everyone else's** run from files served by this site, under `public/play/`, so nothing breaks if another site goes: DOOM (Chocolate Doom in WebAssembly with the shareware WAD), Quake III Arena (James Darpinian's ioquake3 WebAssembly build, GPLv2, with the demo's `pak0.pk3` split into three parts under 25 MiB that the page joins; only multiplayer still uses his peer server), Portal (the Still Alive floppy demo on v86), the Flash games (Ruffle, `public/play/flash/?game=<name>`) and Crysis (a joke: it never loads). Their art is `src/assets/games/<id>.webp`: the game's real icon centered on a blurred copy of itself, opaque square icons cut to a squircle.
- `public/play/` is excluded from `astro check` (`tsconfig.json`), since it is other people's built code.

## Home page plaza

The home page is a Wii U style plaza rendered with three.js, timed off the console's own start up. It opens on your Mii floating in the haze with a tap prompt over it. The click (browsers only allow sound after one) starts the music and the opening: you fall under real gravity, the camera riding down with you, to your friends waiting below, land with a knee bend and wave hello while they clap, the camera pulls back as ten glass blocks tumble in one after another, then a crowd runs in with their hands up and gathers under the blocks. Now and then someone in the crowd says something real from the site in a speech bubble.

- **The lobby** (`plaza/Lobby.astro`) is for visitors who would rather not play: your name and the site's sections (`LOBBY_NAV` in `src/site.ts`, which is `NAV` plus links marked `wide` that show on big screens only) as quiet text beside your floating Mii, a column on the left on a big screen and a row across the top on a phone, level with the switches. They are plain links: the lobby sits outside the plaza, so pressing one never starts the opening or the sound. It shows while the plaza loads and waits for its click and fades as the opening begins; a plaza that comes up settled (`/#0`, reduced motion) never shows it for long. It is also the page's visible `h1` and menu for crawlers.
- Each block shows title art from `public/plaza/icons/<section>.webp` (512px, named after the section's path, e.g. `blogs.webp`), drawn like the Wii U's own system icons so the set reads as one family: one bold object specific to the section, in flat solid color with a chunky darker side face for depth, lit from the top left, on pearly white, with no text, gloss, glow, drawn tile or floating decoration (the glass block is the frame). The block's name shows on a tag when it is hovered or focused. A section without a file falls back to a drawn glyph with its name.
- The back row shows `FEATURED` random blog posts and projects that have a cover, a new pick on each visit, with the cover as the block's art.
- Which links become blocks, their glyph and colors, your Mii (`ME`), your friends (`HERO`) and the crowd size live in `src/data/plaza.ts`. Block names come from `NAV` and `FOOTER_NAV`.
- Your Mii speaks first on every visit, a moment after the camera has pulled back, a greeting picked at random from `WELCOME` in `src/data/plaza.ts` (plain, punny, unhinged, and game references), alone until it ends. One of them is true: the Konami code on the plaza sets the whole crowd dancing.
- Bubbles are every entry on the site (blog posts, projects, the timeline), built at build time in `src/lib/plaza.ts` and shown in a new random order on every visit, each said by someone near its section's block. Pages that only explain the site (Contact, Privacy and the like) are left out.
- The runtime is in `src/components/plaza/`:
  - `layout.ts` holds the camera and where everything stands. The numbers were measured off captures of the console and are stored as screen positions, so wide and tall windows both work.
  - `floor.ts` draws the tiled floor, its glare and the mirrored Miis. `cubes.ts` draws the glass blocks: thin squircle slabs that refract a copy of the scene behind them, made each frame in `main.ts`. `icons.ts` draws the picture inside each one.
  - `heads.ts` draws distant heads as flat pictures, all in one draw call, photographed from twelve angles once each head is built; heads near the camera stay real 3D.
  - `crowd.ts` decides where every Mii goes and what it does. `motion.ts` is the library of moves: walk, run, clap, wave and so on.
  - `main.ts` plays the opening and handles zoom, links and sound.
- Zoom is smooth and continuous: mouse wheel, trackpad or touch pinch, or the `+` and `-` keys. It starts at the farthest view. The camera drifts a little toward the mouse, every block turns a little to face it, and a hovered block leans in further. Drag a block to spin it, as far round as you like; let go and it springs back to rest. A drag never counts as a click. Touch does the same: tap to open, drag a block to spin it, drag on open floor to look around, pinch to zoom.
- Miis can be played with once the opening is over. Tap one and it turns to you and does something (a wave, a dance, a faint...); keep tapping and it loses its temper. Press and drag to pick it up by the shirt: it dangles from the pointer, swinging as you move. Let go to set it down, or flick to throw it. Wherever it lands it freezes for a second, looks round in shock and runs off (your friends run back to their places). A held finger also lifts a Mii on touch screens. On a desktop, resting the pointer on a named Mii shows its name over its head on a square see-through tag in a pixel font, as name tags are in Minecraft. The tag has a size in the world (`TAG_SIZE` in `main.ts`), so it grows and shrinks with the Mii at every zoom, holding at a readable minimum far out. The font is Monocraft (SIL Open Font License, `public/fonts/`), cut down to Latin letters. Crowd Miis only get their full set of faces (`MiiSet.liven`) once someone plays with them, which keeps memory down.
- The sound is one recording, `public/media/warawara-plaza.mp3`, cut so the chime lands on your drop, the footsteps on the crowd's run in, and the theme loops from then on. `SCORE` in `audio.ts` holds those moments, and while the recording runs through them it is the scene's clock, so the two cannot drift.
- Sound plays from the click that starts the opening; Enter or Space works too. Once the crowd is in, the theme hands over to the radio (see Music). `M` mutes and unmutes.
- The opening plays on every load. The first time in a browser session it can't be skipped; after that, Escape or another click skips it. The TV's plaza button opens `/#0`, which skips it altogether: the plaza starts settled, everyone already there, and takes the `#0` off the address so a refresh plays the opening as usual. Going back to it in history does the same. Reduced motion skips the wait and the opening and stills the crowd.
- Without WebGL or JavaScript, or with Save-Data on, the plaza is only its haze and the lobby is the page, with your portrait in the middle.
- If frames run slow, the plaza lowers its resolution a step at a time, and raises it again when there is room. Its heaviest files start downloading with the page.
- In `pnpm dev`, `__plaza.seek(4.2)` in the browser console jumps to a moment of the opening and holds it, `__plaza.zoom(2.5)` sets the zoom (0 to 3), `__plaza.point(x, y)` places the pointer, `__plaza.mii(i)` says where Mii `i` is on screen, `__plaza.look(i)` holds the camera up close on it (`__plaza.look()` lets go) and `__plaza.play()` resumes.

## Miis

Miis are real Wii U Miis, drawn by Nintendo's face library (FFL, compiled to WebAssembly through [FFL.js](https://github.com/ariankordi/FFL.js)) on the Wii U body models. The code in `src/components/mii/` comes from the [Mii Creator](https://github.com/ankushKun/mii-creator) fork.

- To add Miis, drop Mii QR code images into `src/data/miis/`. QR codes from a 3DS, a Wii U, Miitomo or Tomodachi Life all work, and so do the ones shared online. The build decodes them (`src/lib/miis.ts`) and every one joins the crowd, shuffled on each visit so different faces stand next to you. A Mii is named after its file (`Steve Jobs.png` is Steve Jobs). Random Miis from the Mii Maker's own generator fill the rest.
- `ME` and `HERO` take a file name from that folder or a Mii code (base64 of the 96 Mii bytes).
- What a QR code can't carry goes in `LOOKS` in `src/data/plaza.ts`, by file name (`MiiLook` in `plaza/types.ts`). `parts` change the Mii by FFL's CharInfo names (`hair: { type: 29, color: 31 }`); colors of hair, eyes, eyebrows, mouth, beard and glasses are the Switch's hundred (0 to 99; a QR code only holds a few), which FFL draws when the Mii is turned into a CharInfo on the spot (`withParts` in `mii/rig.ts`), on the plaza and in the `/mii/` shuffle. `headset` (its lights' color) and `ponytail` (its color) are drawn on (`plaza/headgear.ts`), for the DJ, their dancers and the middle group only, since far-off crowd heads are flat pictures. Miku's teal and Gumi's green are set there, and `BACKUP` makes new Miis the same way from one to start from.
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
  components/           ChannelMenu, Feed, Timeline, Friends, ui/ (the TV frame, panel, buttons, tiles), plaza/ (the 3D plaza), mii/ (Wii U Miis), chat/ (the chat app), music/ (the music widget and app)
  data/sections.ts      tiles for sections without a plaza block, colors for drawn art
  data/apps.ts          the apps on /apps/
  data/games.ts         the games on /games/ and how each one plays
  assets/games/         channel art for games that aren't yours
  assets/channels/      banners for the apps' channels on /apps/
  scripts/motion.ts     page transitions, the menu, B to go back
  scripts/sfx.ts        UI sounds
  scripts/music/        the radio: YouTube player, engine, widget, app
  data/music.json       the radio's mix (pnpm music)
  lib/
    content.ts          queries, URLs, dates
    plaza.ts            plaza blocks and bubbles from the nav and entries
    tiles.ts            section tiles and drawn art for entries without a cover
    nav.ts              which section a path is in, and its place in the menu
    miis.ts             Mii QR images to Mii codes, at build time
    schema.ts           schema.org builders
  pages/                routes, plus sitemap.xml, robots.txt, llms.txt, blogs/index.xml
public/                 favicon, resume.pdf, ffl/ (Mii runtime and models), play/ (the games' self-hosted files)
scripts/transitions.mjs films every route change (pnpm transitions)
scripts/music.mjs       syncs the radio's mix from YouTube (pnpm music)
```

## SEO, AEO and GEO

Every page gets a canonical URL, a meta description, Open Graph and Twitter tags with a 1200x630 image, and a JSON-LD graph that ties it to the `WebSite` and `Person` nodes: `BlogPosting` for posts, `CreativeWork` for projects, `Article` for timeline entries, `ProfilePage` for About, `ContactPage` for Contact, `CollectionPage` for indexes, and breadcrumbs everywhere. The sitemap picks up new pages automatically.
