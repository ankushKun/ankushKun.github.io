+++
title = "Privacy"
description = "What ankush.one collects when you visit: cookieless usage analytics, the shared realtime apps, third-party embeds, and what stays in your browser."
+++

This is a personal website. There are no accounts, no ads and no cookies set by this site. This page lists everything that leaves your browser when you use it.

*Last reviewed: October 2026.*

## Analytics

Usage data is sent to [PostHog](https://posthog.com) (EU region) through a first-party proxy at `p1.ankush.one`. That covers:

- **Pageviews and JavaScript errors**, with the usual request details (page address, referrer, browser and screen size, IP address).
- **Clicks:** PostHog's automatic capture records which element you clicked, including the label of the button or link, and when you leave a page. It does not record what you type.
- **What you use on the desktop:** which windows you open (and from where: an icon, the Dock, a menu, Spotlight or a link) and how long they stay open, fullscreen toggles, which Spotlight result you pick, or that a search found nothing, and how long the query was (not the text), opening Get Info on an icon (which item it was), the hostname of external links you open, shares of a page, starting a song in Music, sending your first IRC message (not its content) and signing the Guestbook (not the entry).
- **Using the apps:** the name of each Terminal command you run (never its arguments) and switching the Terminal to Linux, reactions you leave under a post or project, Paint and Daily Puzzle actions (drawing, saving, starting and solving a puzzle, posting a time, copying your result, with the day they belong to), opening the Guestbook's "On This Day" (with how many entries it showed), refreshing Activity Monitor, the Preferences pane you open and the setting you change, Software Update views, the welcome tour's steps, rearranging desktop icons, creating or deleting a private sticky note (the count only, never the text), turning on music sharing and tuning in, and clicking a suggestion on the "page not found" screen.

How it runs:

- It runs cookieless: the visitor id is random, kept in memory only, and gone when you close the tab. Nothing is written to your device for analytics.
- Session recording is turned off.
- Analytics is not loaded at all when your browser sends **Global Privacy Control** or **Do Not Track**.

## Shared, realtime apps

The live cursors, sticky note, Guestbook, Paint, IRC Chat, the reactions under posts and projects, the Daily Puzzle leaderboard and Music's "listening now" are shared between everyone on the site. They sync through public [Gun](https://gun.eco) relays: `gun.ankush.one`, and `relay.peer.ooo`, a public relay run by someone else. Every page on this site, not only the desktop, connects to both relays when it loads, so both see your IP address. Anything you put into them is **public** and can be read by anyone, including people who are not using this site.

- **Cursors and presence:** while any page of the site is open, your pointer position and reactions are shared under a random id, and you are counted in the online badge.
- **Sticky note and Paint:** the text you type and the strokes you draw. Paint starts a fresh canvas every day (UTC); earlier days stay readable in its gallery for as long as the relays keep them.
- **Reactions and "reading now":** the reactions you leave under a post or project, stored under your random id. While a post is open in a window, a heartbeat under the same id lets other readers see how many people are reading it.
- **Daily Puzzle:** nothing is shared until you press **Post Time**. Then your chosen name, your time, the number of mines you hit and when you finished are added to that day's public leaderboard.
- **Music:** only if you tick **Share what I'm playing**, the track you are playing, its position, whether it is playing and whom you are listening along with are shared under your random id while the Music app is open. It is off by default.
- **IRC Chat:** while the IRC window is open, your nickname, a random IRC id, that you are online, when you were last seen and whether you are typing are shared so others can see who is in the room. Every message you send carries your nickname, that random id and the time, and the time of the latest message is stored for the unread dot on the IRC icon. Searching for a GIF sends your search text to [Klipy](https://klipy.com), and GIFs are loaded from their servers.
- **Guestbook:** your name, where you are from and your message. Email, X and Instagram handles are optional, and are shown publicly next to your entry if you fill them in. Once a day the entries (without email addresses) are also copied into this site's [public GitHub repository](https://github.com/ankushKun/ankushKun.github.io) and built into the site. An entry can be hidden from the site on request, but it stays in the repository's history.
- **Read-only lookups:** Passport and the Daily Puzzle read your own Guestbook entry back (by your random id) to show your name, and the Guestbook's "On This Day" reads the book. None of them write anything.

Do not post anything you would not want to be public. Data on a public relay cannot be reliably deleted.

## Third-party content

Some content is loaded from other services, which then see your IP address and apply their own privacy policies:

- **YouTube:** the preview image of each video in a post is loaded from YouTube's image server (`i.ytimg.com`) when the page loads. The player itself (`youtube-nocookie.com`) loads only after you click play. The Music app and the background music on the desktop use the YouTube player.
- **X (Twitter):** a few project and timeline pages embed posts.
- **itch.io:** some project and game windows embed an itch.io widget or game.
- **Cal.com:** the Schedule Call window embeds a booking page.
- **thelongestyard.link:** the Quake 3 Arena game is loaded from that server when you start it.
- **GitHub:** when you open Activity Monitor, your browser asks GitHub's public API (`api.github.com`) for Ankush's recent public activity, at most every ten minutes while the window stays open, or when you press Refresh. No account or token is involved. The WebAnimate project page also loads its demo video from `github.com` when the page opens. Other GitHub links open only when you click them.
- **Flash games:** the games are run by Ruffle from this site's own copies, but some of them still try to contact their original ad or score servers (for example `ngads.com`) while you play.
- **Medium and Arweave:** three blog posts load their images from Medium's image server (`miro.medium.com`), and the playable demo in the DOOM renderer post is loaded from an `arweave.net` gateway when it scrolls into view.
- **jsDelivr:** IRC Chat loads its image-safety libraries from this CDN. The check itself runs in your browser.
- **cdnjs:** on touch devices, the DOOM game loads its on-screen joystick script from `cdnjs.cloudflare.com`.
- **External links:** opening an external website inside a desktop window loads that website directly. If the site's link proxy is enabled, such pages are fetched through a Cloudflare Worker run by this site, which sees the address of the page you open.

## Stored in your browser

Everything below stays on your device. None of it is used for tracking, and none of it is sent anywhere except where the realtime section above says so (the random id). Open windows and their positions are not remembered between visits. Clearing site data for ankush.one removes all of it.

**Local storage**

| Key | What it holds |
| --- | --- |
| `site-prefs-v1` | Your System Preferences: appearance, highlight colour, desktop picture, menu bar style, reduced motion and contrast |
| `multiplayer-cursor-id` | The random id the shared apps use for you |
| `booted` | That you have seen the boot screen once |
| `site-welcome-v1` | Whether the welcome tour was finished or skipped |
| `site-sound` | Whether interface sounds are muted |
| `desktop-icons-v1` | Where you dragged the desktop icons, if you moved them |
| `desktop-stickies-v1` | Your private sticky notes (text, colour, position). They never leave your browser |
| `sticky_cache`, `sticky_minimized` | The last copy of the shared sticky note you saw (so it appears at once on your next visit), and whether you collapsed it |
| `cursors-hidden` | Whether you hid other people's cursors |
| `site-visit-v1` | When you last visited, so new posts and projects can be marked as new |
| `site-passport-v1` | Your Passport: stamps collected, visit days and streaks, and which apps, games, posts and projects you have opened |
| `software-update-v1` | The newest site update you have seen |
| `daily-puzzle-v1` | Your Daily Puzzle name, streak, best time and today's game |
| `music-player-v1` | Music's volume, track, position and whether you share what you play |
| `guestbook-signed` | That you signed the Guestbook (your random id) |
| `irc_nick`, `irc_uuid`, `irc_tos_accepted`, `irc_notify`, `irc_blur_gifs`, `irc_last_read` | Your IRC nickname and id, that you accepted the chat rules, notification and GIF-blur settings, and when you last read the channel |
| `terminal-shell-v1` | Your last 100 Terminal commands and the time of your last login |
| `v86-autosave`, `v86-save-on-close` | The Terminal's Linux save settings |

The Terminal's Linux machine can also save its state to your browser's IndexedDB (`v86_state_db`), but only when you turn saving on.

**Session storage** (cleared when you close the tab): `guestbook-nudge-dismissed` (you closed the "sign the guestbook" reminder), `activity-monitor-gh-v1` (Activity Monitor's last answer from GitHub) and `sw-kill-check` (when the site last checked whether offline copies should be switched off).

**Offline copies:** on the live site a service worker keeps copies of the site's scripts, styles and icons (about 1.6 MB) and of the pages you open in your browser's Cache Storage, under names starting with `ankush-sw-`. That is what lets the desktop and pages you have read open without a connection. The large emulator and game files are only kept after you have opened the Terminal or a game. Each new version of the site replaces the old copies.

## Contact

Questions about any of this? Email [ankush4singh@gmail.com](mailto:ankush4singh@gmail.com).
