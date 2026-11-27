---
title: "GUN Relay"
description: "A GUN peer on Cloudflare Workers with Durable Object storage, a stats dashboard and a graph explorer, running the live chat, Paint and Guestbook here."
date: 2026-01-01
updated: 2026-11-03
cover: ./cover.webp
coverAlt: "The relay's graph explorer: hundreds of stored nodes from the chat, Paint and Guestbook linked around the messages, strokes and profiles nodes"
tags: ["cloudflare", "developer-tools", "web"]
status: active
stack: ["JavaScript", "GUN", "Cloudflare Workers", "Durable Objects", "SQLite", "WebSockets"]
links:
  - label: "Relay dashboard"
    url: "https://gun.ankush.one/"
  - label: "Graph explorer"
    url: "https://gun.ankush.one/explorer.html"
  - label: "GitHub"
    url: "https://github.com/ankushKun/gun"
faq:
  - q: "Can I point my own GUN app at it?"
    a: "The code is on GitHub if you want to run your own on Cloudflare. Clients connect to the /gun endpoint like any other GUN peer."
  - q: "Why not use a public GUN relay?"
    a: "Every visitor connects to the relay directly, so a public one means a third party sees everyone's IP address. Running my own keeps that between visitors and me."
---
**My own relay for [GUN](https://gun.eco/), the realtime graph database, so the live parts of this site don't depend on anyone else's server.**

GUN apps sync through peers: every browser connects to a relay over a WebSocket, writes go to the relay, and the relay passes them on to everyone else. The [chat](/apps/chat/), [Paint](/apps/paint/), the [Guestbook](/apps/guestbook/) and the cursors you see from other visitors all run through this one, at `gun.ankush.one`.

## How it got here
I started it on New Year's Day 2026 as a small Node server on a VPS behind nginx, storing the graph on disk with GUN's own Radisk, with a dashboard showing connections and traffic as live graphs.

In May I moved it to Cloudflare. Workers have no disk for Radisk to write to, so the graph lives in a SQLite table inside a Durable Object, which also holds every WebSocket. Over the summer it picked up storage eviction, links to other peers in a mesh, scripts to seed and drain a peer, and a graph explorer for browsing what's stored. In July it stopped waking up every second and let idle sockets hibernate, so a quiet relay barely uses anything.

## The day it went down
On 13 October the relay stopped answering. The free plan allows a fixed number of SQLite row reads and writes per day across all Durable Objects, and once one of them runs out Cloudflare blocks every storage call, not just the expensive ones.

The fixes since then are mostly about spending fewer rows:

- **Presence stays in memory.** Cursors, heartbeats and reactions are gone within seconds anyway, so they're relayed to everyone but never written to SQLite.
- **A daily budget with stages.** The relay counts its own rows and backs off before the limit: at 50% the explorer pauses, at 80% stored writes stop, at 92% uncached reads stop, while live presence keeps flowing. Near the request limit it tells the site to slow its cursor stream down.
- **Fewer, bigger writes.** A burst of changes to one node (dragging a sticky note, a run of paint strokes) is merged in memory and written once, a second after it settles.
- **No repeated links.** GUN's chained puts resend every link on the path with each change, which rewrote the same nodes on every cursor move. The relay now drops links it already holds.

## Dashboard
The [dashboard](https://gun.ankush.one/) shows live connections, messages, storage use and how much of the day's row and request budget is gone. The [graph explorer](https://gun.ankush.one/explorer.html) draws stored nodes and the links between them, and can browse other peers too.
