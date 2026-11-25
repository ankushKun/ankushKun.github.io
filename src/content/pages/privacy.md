---
title: Privacy
description: "What ankush.one collects when you visit: PostHog analytics and session recordings, what stays in your browser, the live apps, and third-party embeds."
updated: 2026-11-24
---

This is a static personal website built with Astro. There are no user accounts and no ads. It does have analytics, described at the end of this page along with a button to turn them off. Questions about any of it go to [ankush4singh@gmail.com](mailto:ankush4singh@gmail.com).

## What stays in your browser

A few small things are kept in your browser's own storage and never sent anywhere:

- In `localStorage`: your theme (`light` or `dark`) once you pick one, the Terminal's command history and last login, which announcements you've already seen, so each shows only once, and which pages you've seen and when you last opened Paint and the Guestbook, so the site can point out what's new since your last visit.
- In `sessionStorage`, which clears when you close the tab: whether you've seen the plaza's opening, whether you stopped the music, whether you closed the card about a launch, and what was new when your visit began, so it stays marked while you look around.

## Live apps (`/apps/`)

Chat, Paint and the Guestbook connect directly to a GUN relay (`gun.ankush.one`) so messages, drawings, notes and Mii avatars sync in real time without accounts. Everything you post in them is public: chat messages, your strokes on the day's Paint canvas along with your nickname, and Guestbook notes with whatever you write on them, links included. When you open the chat's GIF picker, searches go through a Cloudflare Worker to Klipy so no API key is exposed in the browser.

Before you join, the apps ask for a nickname and for you to agree that what visitors post isn't checked first. Your nickname, Mii, a random id for this browser, that agreement and the time of the newest chat message you've seen stay in your browser's `localStorage`, shared by the live apps so you only answer once. The home page shows a few recent chat messages in the plaza and puts ones you haven't seen first.

## Server & hosting logs

Like any static website, the hosting provider and CDN see standard request metadata (IP address, requested URL, referrer, and browser user agent) to serve pages and protect against abuse.

## Third-party embeds & links

A small number of individual project and blog pages embed external content:

- **YouTube (`youtube-nocookie.com`):** video embeds on older hardware and project write-ups use YouTube's privacy-enhanced domain.
- **Music:** the site's radio and the Music app play tracks through a hidden YouTube player on the same privacy-enhanced domain. It loads once the plaza is up or when you reach for the music controls, and YouTube sees those requests under its own privacy policy.
- **itch.io:** game jam pages embed playable widgets hosted on `itch.io`.
- **Arweave gateway:** the interactive DOOM-style renderer post embeds a standalone canvas demo hosted on Arweave.
- **External links:** clicking links to GitHub, X, Product Hunt, Cal.com, or Construct Computer takes you to those services under their own privacy policies.

## Standalone project pages

Standalone web apps and project microsites hosted separately under `ankush.one` (such as `/3dsDL/`, `/3dsFM/`, `/sh23ds/`, `/mixtunes/`, and `/animedoro-timer/`) are built and maintained in their own repositories and may have their own storage or analytics settings.

## Analytics

The site uses [PostHog](https://posthog.com) to learn how people find their way around it. Everything goes through the site's own address, `p1.ankush.one`, to PostHog's servers in the EU, where it's kept. PostHog sees:

- the pages you open, how far you scroll and how long you stay, your browser, device and screen size, the page that sent you here, and a rough location worked out from your IP address
- what you click, and moments a click doesn't show on its own, like starting the plaza, changing the song or the lights, joining a live app, drawing in Paint or playing a game
- how quickly pages load, and messages and errors from the browser's console
- a recording of your visit: what was on screen, the plaza and drawings included, and where you moved and clicked. What you type is masked before it leaves your browser, Guestbook email addresses are left out, and network requests are kept only as their address and timing.

PostHog remembers your browser with a random id, kept in a first-party cookie and in `localStorage` under names starting with `ph_`. If you join a live app, your nickname is attached to your visits so they show up under that name.

To stop analytics, use the button below. Your choice is kept in `localStorage`, so it lasts until you clear this site's data.
