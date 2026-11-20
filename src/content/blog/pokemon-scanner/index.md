---
title: "Pokemon Card Scanner in the Browser: YOLO11 + CLIP Embeddings"
description: "An offline Pokemon card scanner that runs entirely in the browser: YOLO11 detects the card and MobileCLIP matches it against 20K cards on ONNX and WebGPU."
date: 2026-01-18
updated: 2026-10-13
tags: ["machine-learning", "web", "pokemon", "tcg", "clip", "yolo", "onnx"]
related: ["/projects/pokemon-scanner"]
faq:
  - q: "How does a Pokemon card scanner recognise a card?"
    a: "Two stages. A small object detector (here YOLO11n) finds the card in the camera frame and crops it. Then an image embedding model (here MobileCLIP-S2) turns the crop into a vector, and the scanner finds the nearest vector in a precomputed index of every card's artwork. Nearest neighbour wins. No text is read, so it works on Japanese, Korean and Thai cards as well as English."
  - q: "Why use CLIP embeddings instead of training a classifier?"
    a: "A classifier with 20,000 output classes needs retraining every time a new set releases. With embeddings, adding a set means embedding its card images and appending them to the index, no training at all. Embeddings also handle foils, sleeves and bad lighting better because the match is on overall visual similarity, not exact pixels."
  - q: "Which model is best for Pokemon card recognition: CLIP, SigLIP or MobileCLIP?"
    a: "In my tests MobileCLIP-S2 gave the best accuracy for its size and ran fastest in the browser. SigLIP was close and quantised to int8 cleanly, but MobileCLIP-S2 at FP16 recognised cards more reliably. OpenAI's original CLIP ViT-B/32 is accurate but too slow and large for a phone browser."
  - q: "Can this run on a phone, or as a TFLite model on Android and iOS?"
    a: "It runs in a phone browser today through ONNX Runtime Web with the WebGPU backend, falling back to WebAssembly. The same YOLO11n and MobileCLIP-S2 models export to TFLite and Core ML for native apps; the embedding index is just a matrix of float16 vectors you ship with the app."
  - q: "Is there a Pokemon card scanner API?"
    a: "For card data and prices there are public APIs: TCGdex, pokemontcg.io and the TCGplayer API. For recognition from a photo you generally have to host a model yourself. I ran mine as a REST endpoint first and moved it fully client side because a CPU-only server took several seconds per card and the browser does it in under 100 ms on a laptop."
  - q: "How fast is the scanner?"
    a: "On a laptop, about 10 ms for YOLO11n detection and 50 to 80 ms for MobileCLIP-S2 embedding plus the nearest-neighbour search. On a recent phone, detection is similar and recognition is a few hundred milliseconds."
---

<figure class="my-6">
  <video autoplay loop muted playsinline poster="/media/mypokemonscanner-poster.webp" width="332" height="670" aria-label="Pokemon card scanner demo">
    <source src="/media/mypokemonscanner.mp4" type="video/mp4" />
  </video>
  <figcaption>It's fast. Really fast.</figcaption>
</figure>

I've always been a huge Pokémon fan. I've played almost every mainline game from Game Boy Color through HeartGold/SoulSilver, and recently got into the 3DS titles after picking up a New Nintendo 3DS in Thailand.

I also started collecting Pokémon cards last year, and by the time I wrote this I had around 350–400 cards. I couldn't stand leaving them jammed inside a tin and a cardboard box, so I bought penny sleeves and a ringless binder, put all the shiny full-art holos at the front followed by reverse holos and favorites, and dumped the bulk back into the tin.

I had a mix of English, Thai, Japanese, Korean, and Chinese cards. Naturally I tried a bunch of existing card-scanning apps to look them up, and every single one either choked on non-English cards or hid basic scanning behind a steep subscription paywall. So I did the sensible engineer thing and built my own.

## How the scanner works

The whole pipeline runs in the browser across four stages:

1. **Detect** the card in the camera frame with a YOLO11n model (about 5 MB, ~10 ms per frame on a laptop).
2. **Crop and embed** the card with MobileCLIP-S2, turning the artwork into a vector.
3. **Search** a precomputed index of embeddings for roughly 20,000 English and Japanese cards and pick the nearest neighbour.
4. **Look up** the matched card's name, set, number, and TCGplayer price from a card database.

No image ever leaves the device. Everything below is how I got there, detours included.

| Stage | Model | Format | Size | Time (laptop) |
| --- | --- | --- | --- | --- |
| Card detection | YOLO11n, fine-tuned on a Pokemon card dataset | ONNX | ~5 MB | ~10 ms |
| Recognition | MobileCLIP-S2 image encoder | ONNX, FP16 | tens of MB | 50 to 80 ms incl. search |
| Index | 20K card embeddings | float16 matrix | ~20 MB | in-memory nearest neighbour |

## Hacking together v1

The first prototype was taped together quickly: I scraped ~20K card images and metadata from [TCGdex](https://tcgdex.dev), generated embeddings using [OpenAI CLIP](https://openai.com/index/clip/), and used [OpenCV](https://opencv.org/) to crudely locate a rectangle in the frame, crop it, and search the index.

It worked great on my Mac — embedding the full dataset took about 7 minutes with [MPS](https://developer.apple.com/metal/pytorch/) and single-card inference ran in ~800 ms. The problem showed up the moment I deployed that REST API to a CPU-only VPS: identifying a single card suddenly took several seconds, which killed the experience. Running reverse image search on a cheap server was the wrong architecture.

## Moving everything to the browser

So I moved the entire pipeline client-side — detection, cropping, embeddings, and lookup. Along the way I tested every candidate vision encoder I could get running in the browser: OpenAI CLIP, SigLIP, OpenCLIP checkpoints, and MobileCLIP.

I also spent time on model quantization — dropping weight precision from float32 to FP16 or int8 to shrink downloads and speed up inference. Int8 quantization worked well for SigLIP, and I actually shipped a SigLIP PWA to my phone for a couple of days before switching to **MobileCLIP-S2**, which gave noticeably better recognition accuracy on holographic artwork. Int8 export broke the ONNX graph for MobileCLIP-S2, while FP16 exported cleanly and ran fast enough that fighting int8 wasn't worth it.

Halfway through I realized TensorFlow.js was still falling back to WebGL/Wasm on my devices. Switching on the WebGPU backend cut inference latency dramatically.

> **Sidequest: training a dedicated YOLO11n detector**
>
> OpenCV contour detection worked fine on flat still photos, but fell apart on handheld video streams with glare and cluttered desks. I fine-tuned a small YOLO11n model on a public Pokémon card dataset (~5 MB exported to ONNX), and detection immediately became rock solid and fast.

On a laptop, detection averaged ~10 ms with YOLO11n and recognition + search took 50–80 ms with MobileCLIP-S2. On a modern phone, detection stayed close to that and recognition landed in a few hundred milliseconds.

## Solving the card database

With a fast client-side scanner working, the next bottleneck was data. TCGplayer had solid English coverage, while Japanese and other languages were sparse. I scraped [LimitlessTCG](https://limitlesstcg.com) for English and Japanese sets and pulled pricing across conditions (near mint, lightly played, damaged) and finishes (normal, holo, reverse holo) via the [TCGplayer](https://www.tcgplayer.com/) APIs.

The resulting sync pipeline:

- Pulls English card data from TCGdex
- Pulls Japanese and missing sets from LimitlessTCG
- Merges both sources to fill metadata gaps
- Fetches current pricing per variant
- Serves search and sync endpoints for the PWA

## Picking an embedding model

Since model choice is the question I get asked most, here is how the candidates compared:

| Model | Accuracy on cards | Browser speed | Quantisation | Verdict |
| --- | --- | --- | --- | --- |
| OpenAI CLIP ViT-B/32 | Good | Slow, large | Fine | Great server-side, too heavy for phones |
| SigLIP (base) | Good | OK | Int8 worked | Solid runner-up |
| OpenCLIP variants | Mixed | Varies | Fine | Depends heavily on checkpoint |
| MobileCLIP-S2 | Best in my tests | Fast | FP16 only (Int8 export broke) | Shipped |

Models built for mobile (MobileCLIP) held onto visual accuracy across foils and sleeves while cutting latency, and FP16 was compact enough to ship straight to the browser.

## Shipping it

I set up a cron job on my VPS to refresh card prices every three days, wrapped the scanner in a clean Vite + React PWA, and hosted it at `mypokemonscanner.com`.

*Update: `mypokemonscanner.com` is no longer online, though the Wayback Machine keeps an [archived snapshot](https://web.archive.org/web/20260227180613/https://mypokemonscanner.com/). See the [project page](/projects/pokemon-scanner/) for the demo and tech stack.*
