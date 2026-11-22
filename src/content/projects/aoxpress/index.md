---
title: "aoxpress"
description: "An Express.js-inspired routing framework for AO processes, complete with middleware and HTTP-style inter-process requests."
date: 2025-05-01
cover: ./cover.webp
coverAlt: "aoxpress AO backend framework demo"
tags: ["arweave", "developer-tools"]
status: archived
stack: ["Lua", "JavaScript", "Node.js", "AO"]
links:
  - label: "GitHub"
    url: "https://github.com/ankushKun/aoxpress"
related: ["/projects/luax", "/projects/apm"]
---

`aoxpress` brings familiar Express.js ergonomics to the AO compute network so web developers can define process handlers without fighting raw message-tag boilerplate.

## Features

- **Express-like routing:** Write `app.get()`, `app.post()`, and middleware handlers instead of manual tag-matching blocks
- **`ao-fetch`:** Lightweight helper for HTTP-style request/response calls between AO processes
- Designed to stay small enough to load comfortably inside AO processes

<figure class="my-6">
  <div class="aspect-video w-full overflow-hidden">
    <iframe src="https://www.youtube-nocookie.com/embed/biCIDfhGky0" title="aoxpress walkthrough" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="h-full w-full border-0"></iframe>
  </div>
</figure>
