---
title: "pixels.earth"
description: "A decentralized pixel canvas layered over a real-world map where every pixel is an on-chain Solana transaction powered by MagicBlock."
date: 2025-12-15
cover: ./cover.webp
coverAlt: "pixels.earth decentralized world pixel canvas"
tags: ["solana", "web3"]
status: archived
stack: ["Solana", "Rust", "Anchor", "MagicBlock", "TypeScript", "PWA"]
links:
  - label: "pixels.earth"
    url: "https://pixels.earth"
  - label: "GitHub"
    url: "https://github.com/ankushKun/pixels.earth"
related: ["/projects/megaplace", "/projects/create-magicblock"]
---

**pixels.earth** overlays a global collaborative pixel canvas onto a map of Earth, where every pixel you place is an on-chain transaction on Solana.

<figure class="my-6">
  <div class="aspect-video w-full overflow-hidden">
    <iframe src="https://www.youtube-nocookie.com/embed/4JhPDh8kBtM" title="pixels.earth demo" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="h-full w-full border-0"></iframe>
  </div>
</figure>

## How it works

The map is split into **shards** — geographic regions that users can unlock and own. Painting on a shard commits pixel state to Solana via **MagicBlock's** ephemeral rollups for sub-second updates, while shard owners earn a cut from drawing activity on their territory.

## Stack

- **Solana + Anchor** (Rust) for on-chain shard ownership and canvas state
- **MagicBlock** ephemeral rollups for real-time multiplayer latency
- **Progressive Web App** running across desktop and mobile browsers
