---
title: "MyPokemonScanner"
description: "A privacy-first, offline-capable Pokemon card scanner running 100% client-side in the browser with YOLO11n and MobileCLIP-S2."
date: 2026-01-19
cover: ./cover.webp
coverAlt: "MyPokemonScanner browser card scanner demo"
tags: ["machine-learning", "web"]
status: archived
stack: ["YOLO11", "MobileCLIP", "ONNX Runtime Web", "WebGPU", "React", "Vite"]
links:
  - label: "Archived MyPokemonScanner"
    url: "https://web.archive.org/web/20260227180613/https://mypokemonscanner.com/"
related: ["/blogs/pokemon-scanner"]
---
**MyPokemonScanner is a Privacy-first, offline-capable Pokemon card scanner that runs 100% in your browser using modern Web AI.**

It combines YOLO11 for object detection and MobileCLIP for image embedding to identify cards instantly, without uploading any images to a server.

<figure class="my-6">
  <video autoplay loop muted playsinline poster="/media/mypokemonscanner-poster.webp" width="332" height="670" aria-label="Scanner Demo">
    <source src="/media/mypokemonscanner.mp4" type="video/mp4">
  </video>
</figure>

## Features
- **Instant Detection:** Uses YOLO11n to detect cards in real-time (~10ms)
- **Client-Side Recognition:** identifies cards using MobileCLIP-S2 embeddings directly in the browser
- **Privacy First:** No images are ever uploaded to a server
- **Offline Capable:** Works fully offline after the initial load
- **Comprehensive Database:** Merged data from TCGdex and LimitlessTCG for English and Japanese cards
- **Price Checking:** Fetches real-time pricing from TCGplayer

## Tech Stack
- **YOLO11n** for object detection (via ONNX Runtime)
- **MobileCLIP-S2** for image embeddings
- **TensorFlow.js & ONNX Runtime Web** for inference
- **WebGPU & WebAssembly** for hardware acceleration
- **PocketBase** for backend data sync (prices)
- **Vite & React** for the frontend

[Read the full story on how I built this](/blogs/pokemon-scanner/)
