---
title: "APM — AO Package Manager"
description: "The package manager and registry for the AO compute network, now loaded by default in every aos process."
date: 2024-07-01
cover: ./cover.webp
coverAlt: "APM CLI ASCII banner and interactive package manager prompt"
tags: ["arweave", "developer-tools"]
status: archived
stack: ["Lua", "TypeScript", "Arweave", "AO"]
links:
  - label: "APM"
    url: "https://apm_betteridea.arweave.net"
  - label: "GitHub: ao-package-manager"
    url: "https://github.com/betteridea-dev/ao-package-manager"
  - label: "GitHub: apm-cli"
    url: "https://github.com/ankushKun/apm-cli"
related: ["/projects/betteridea", "/projects/luax"]
---

**APM** is a package registry and installer for the AO compute network — similar in spirit to LuaRocks or npm, built specifically for permanent, message-based AO processes.

## What it does

- Hosts a permanent, versioned package registry on Arweave
- Lets developers install shared Lua modules straight into running AO processes via CLI or inside [BetterIDEa](/projects/betteridea/)
- Lets package authors publish reusable libraries once and share them across the ecosystem

APM was later adopted into core AO tooling and made to load by default in every `aos` process.
