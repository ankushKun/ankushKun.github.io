---
title: "Subspace"
description: "A permanent, censorship-resistant Discord-style chat platform running entirely on the Arweave and AO compute network."
date: 2025-06-10
tags: ["arweave", "web3"]
status: archived
stack: ["TypeScript", "React", "Arweave", "AO", "HyperBEAM"]
cover: ./cover.jpg
coverAlt: "Subspace logo and tagline: Group chat with your friends"
links:
  - label: "Website"
    url: "https://subspace.arweave.net"
  - label: "GitHub"
    url: "https://github.com/subspace-dev/app"
  - label: "Demo Video"
    url: "https://x.com/use_subspace/status/1982168682064212271"
related: ["/projects/wauth"]
---

**Subspace** was a fully decentralized chat and community app modeled on Discord — servers, channels, direct messages, and permanent message history backed by Arweave and the AO compute network rather than centralized servers.

<figure class="my-6">
  <div class="aspect-video w-full overflow-hidden">
    <iframe src="https://www.youtube-nocookie.com/embed/8TsBYd6FcQc" title="Subspace demo" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="h-full w-full border-0"></iframe>
  </div>
</figure>

## What it did

- Communities and channels modeled after Discord, with messages stored permanently on Arweave
- Message-passing backend running directly on AO processes
- Social sign-in via [WAuth](/projects/wauth/) so users didn't need a browser wallet to join a server

## Status

Between September and November 2025 I rewrote Subspace from scratch on HyperBEAM, adding a waitlist, direct messages, temporary conversations, and guest accounts. The app and SDK repositories are now archived; while `subspace.arweave.net` still loads the static bundle, the HyperBEAM node it spoke to is offline.
