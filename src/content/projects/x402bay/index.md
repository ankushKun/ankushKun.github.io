---
title: "x402bay"
description: "A digital goods marketplace where every download is paid directly in USDC over Coinbase's HTTP 402 (x402) payment protocol."
date: 2025-11-16
tags: ["web3"]
status: archived
stack: ["Next.js", "React", "Tailwind CSS", "Coinbase x402", "Wagmi", "MongoDB"]
links:
  - label: "GitHub"
    url: "https://github.com/ankushKun/x402bay"
---

**x402bay** is a small marketplace for digital goods built around Coinbase's `x402` protocol — a practical revival of the HTTP `402 Payment Required` status code.

When you request a file you haven't paid for, the server responds with HTTP `402` and a price; your wallet settles the payment in USDC and replays the request, returning the download with no separate checkout page in between. I built it over a couple of days in November 2025 on Base Sepolia testnet.

## Features

- Create, edit, and browse digital listings with descriptions, previews, and USDC pricing
- Direct pay-and-download flow through `x402-next` and `x402-fetch`
- Sign-In with Ethereum (SIWE) via RainbowKit, wagmi, viem, and NextAuth
- Search, categories, and likes backed by MongoDB Atlas

The hosted testnet instance is offline now, while the full source remains on GitHub.
