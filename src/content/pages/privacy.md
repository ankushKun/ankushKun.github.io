---
title: Privacy
description: "What ankush.one collects when you visit: static pages, zero cookies, no client-side tracking, and third-party embeds."
updated: 2026-11-23
---

This is a static personal website built with Astro. There are no user accounts, no ads, no cookies, and no client-side tracking scripts or analytics on these pages. Your theme preference (`light` or `dark`) and mute setting stay strictly in your own browser's `localStorage`.

## Live Chat (`/apps/chat/`)

The Miiverse-style chat room connects directly to a GUN relay (`gun.ankush.one`) so messages, drawings, and Mii avatars sync in real time without user accounts. When you open the GIF picker, search queries are proxied through a Cloudflare Worker to Klipy so no API key is exposed in the browser. Everything posted in `#general` is public.

Before you join, the chat asks for a nickname and for you to agree that what visitors post isn't checked first. Your nickname, Mii, that agreement and the time of the newest message you've seen stay in your browser's `localStorage`, shared by the site's live apps so you only answer once. The home page shows a few recent chat messages in the plaza and puts ones you haven't seen first.

## Server & hosting logs

Like any static website, the hosting provider and CDN see standard request metadata (IP address, requested URL, referrer, and browser user agent) to serve pages and protect against abuse.

## Third-party embeds & links

A small number of individual project and blog pages embed external content:

- **YouTube (`youtube-nocookie.com`):** video embeds on older hardware and project write-ups use YouTube's privacy-enhanced domain.
- **Music:** the site's radio and the Music app play tracks through a hidden YouTube player on the same privacy-enhanced domain. It loads once the plaza is up or when you reach for the music controls, and YouTube sees those requests under its own privacy policy. The site only keeps, for the length of your browser session, whether you stopped the music.
- **itch.io:** game jam pages embed playable widgets hosted on `itch.io`.
- **Arweave gateway:** the interactive DOOM-style renderer post embeds a standalone canvas demo hosted on Arweave.
- **External links:** clicking links to GitHub, X, Product Hunt, Cal.com, or Construct Computer takes you to those services under their own privacy policies.

## Standalone project pages

Standalone web apps and project microsites hosted separately under `ankush.one` (such as `/3dsDL/`, `/3dsFM/`, `/sh23ds/`, `/mixtunes/`, and `/animedoro-timer/`) are built and maintained in their own repositories and may have their own storage or analytics settings.

## Contact

Questions about privacy? Email [ankush4singh@gmail.com](mailto:ankush4singh@gmail.com).
