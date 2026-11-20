---
title: "Mixtunes"
description: "A free browser extension that gives YouTube Music a classic iTunes interface with Cover Flow, a sidebar library, and sortable tracks."
date: 2026-08-24
tags: ["web", "graphics"]
featured: true
status: active
stack: ["TypeScript", "Chrome Extension", "Firefox Add-on", "CSS"]
links:
  - label: "Website"
    url: "https://ankush.one/mixtunes/"
  - label: "GitHub"
    url: "https://github.com/ankushKun/mixtunes"
  - label: "Chrome Web Store"
    url: "https://chromewebstore.google.com/detail/kaeebfmnanocpkfedmfgbkgjlihenjpm"
  - label: "Firefox Add-ons"
    url: "https://addons.mozilla.org/firefox/addon/mixtunes/"
---
**Mixtunes puts classic iTunes on top of YouTube Music.**

After building Cover Flow for the Music app on my previous website, I wanted the same thing for the music I actually listen to, so it turned into a browser extension.

Mixtunes draws an old-school iTunes window over the streaming site: Cover Flow with reflections, a sidebar with Music, Liked Songs, Albums, Artists and your playlists, and a sortable track list with Plays and Last Played columns. YouTube Music still handles playback underneath.

## Features
- Cover Flow with reflections, plus virtualized lists for long libraries
- A sidebar library and a sortable track list
- Metal, Graphite and system themes
- No Mixtunes account, and the extension doesn't phone home
- Works in Chrome and Firefox

## What's next
Only YouTube Music works today. Version 0.2.0 split the extension into one adapter per music service, so Spotify, Apple Music and SoundCloud can follow.

It's free and open source under GPL-3.0.
