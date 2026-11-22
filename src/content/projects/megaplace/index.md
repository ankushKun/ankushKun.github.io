---
title: "MegaPlace"
description: "A global on-chain pixel canvas on MegaETH testnet where every pixel placement is a real-time transaction with session keys."
date: 2025-12-03
cover: ./cover.webp
coverAlt: "MegaPlace collaborative world pixel map over Apple Park"
tags: ["web3"]
status: archived
stack: ["Solidity", "Hardhat", "MegaETH", "Bun", "Express", "React", "Leaflet"]
links:
  - label: "Demo"
    url: "https://ankush.one/megaplace/"
  - label: "GitHub"
    url: "https://github.com/ankushKun/megaplace"
  - label: "Demo on X"
    url: "https://x.com/ankushKun_/status/1996342708559073581"
related: ["/projects/pixels-earth"]
---

MegaPlace was a high-speed, on-chain take on Reddit's `r/place` mapped onto a globe in Web Mercator, built to stress-test **MegaETH's** sub-millisecond block times.

## Features

- Every pixel placed writes permanently on-chain
- **Session keys** eliminate wallet popups between individual pixel clicks
- **Premium mode** (`0.01 ETH`) unlocked two hours without rate limits

## Stack

- **Solidity** contracts (Hardhat + OpenZeppelin) on MegaETH testnet
- **Bun + Express + Viem** backend caching canvas state and pushing live updates over SSE
- **React + Wagmi + Leaflet** frontend rendering the canvas over a world map

> What if the Earth was a huge canvas and every pixel an onchain transaction — what would you create?
> — [Watch the demo on X](https://x.com/ankushKun_/status/1996342708559073581)
