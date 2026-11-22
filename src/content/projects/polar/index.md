---
title: "Polar"
description: "Vercel-style Git deployments for Walrus Sites on Sui — connect a GitHub repo and publish without touching a wallet or buying WAL."
date: 2026-05-10
cover: ./cover.webp
coverAlt: "Polar glacial canyon backdrop and logo for Walrus Sites deployments on Sui"
tags: ["web3", "developer-tools", "cloudflare"]
status: archived
stack: ["React", "Hono", "Cloudflare Workers", "Cloudflare Containers", "D1", "Sui", "Walrus"]
links:
  - label: "GitHub"
    url: "https://github.com/ankushKun/polar"
  - label: "walrus-deploy CLI"
    url: "https://github.com/ankushKun/walrus-deploy"
related: ["/projects/dumdumdeploy"]
---
**Polar is basically [DumDumDeploy](/projects/dumdumdeploy/) for Sui.** You sign in with GitHub, pick a repo, and Polar builds it and publishes it as a Walrus Site, without you ever touching a Sui wallet or buying WAL.

## How it worked
- Detected the framework (Next.js, Vite, Astro, Nuxt, SvelteKit, Remix, Angular and more, monorepos included) and built the repo in a throwaway Cloudflare Container
- Checked that the output was a safe static site and worked out the exact WAL and SUI cost before publishing
- Published from a platform wallet, so users never needed one
- Redeployed on every push to main through GitHub webhooks, with commit-pinned deploys, encrypted project secrets and live build logs
- Came with a hosted MCP server and API keys, so agents could deploy too

The deploy step itself is a small public CLI, [walrus-deploy](https://github.com/ankushKun/walrus-deploy), that wraps Mysten's site-builder and takes care of SPA routing, MIME types and cache headers.

## Tech Stack
- React 19, Vite and Tailwind
- Hono on Cloudflare Workers with D1
- Cloudflare Containers for builds
- Walrus and Sui

The hosted version isn't running anymore, so the code is the place to look.
