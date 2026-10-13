+++
date = '2026-01-18'
lastmod = '2026-10-13'
draft = false
title = "Pokemon Card Scanner in the Browser: YOLO11 + CLIP Embeddings"
description = "Pokemon card scanner that runs offline in the browser: YOLO11 finds the card, MobileCLIP embeddings match it against 20K cards, fast on ONNX and WebGPU."
summary = "I wanted to scan my Pokemon cards instantly without uploading anything to a server. Here is the full pipeline: YOLO11 card detection, MobileCLIP image embeddings for recognition across 20K English and Japanese cards, quantised ONNX models, and WebGPU inference, all client side."
tags = ['machine-learning', 'web', 'pokemon', 'tcg', 'clip', 'yolo', 'onnx']
faq = [
  { q = "How does a Pokemon card scanner recognise a card?", a = "Two stages. A small object detector (here YOLO11n) finds the card in the camera frame and crops it. Then an image embedding model (here MobileCLIP-S2) turns the crop into a vector, and the scanner finds the nearest vector in a precomputed index of every card's artwork. Nearest neighbour wins. No text is read, so it works on Japanese, Korean and Thai cards as well as English." },
  { q = "Why use CLIP embeddings instead of training a classifier?", a = "A classifier with 20,000 output classes needs retraining every time a new set releases. With embeddings, adding a set means embedding its card images and appending them to the index, no training at all. Embeddings also handle foils, sleeves and bad lighting better because the match is on overall visual similarity, not exact pixels." },
  { q = "Which model is best for Pokemon card recognition: CLIP, SigLIP or MobileCLIP?", a = "In my tests MobileCLIP-S2 gave the best accuracy for its size and ran fastest in the browser. SigLIP was close and quantised to int8 cleanly, but MobileCLIP-S2 at FP16 recognised cards more reliably. OpenAI's original CLIP ViT-B/32 is accurate but too slow and large for a phone browser." },
  { q = "Can this run on a phone, or as a TFLite model on Android and iOS?", a = "It runs in a phone browser today through ONNX Runtime Web with the WebGPU backend, falling back to WebAssembly. The same YOLO11n and MobileCLIP-S2 models export to TFLite and Core ML for native apps; the embedding index is just a matrix of float16 vectors you ship with the app." },
  { q = "Is there a Pokemon card scanner API?", a = "For card data and prices there are public APIs: TCGdex, pokemontcg.io and the TCGplayer API. For recognition from a photo you generally have to host a model yourself. I ran mine as a REST endpoint first and moved it fully client side because a CPU-only server took several seconds per card and the browser does it in under 100 ms on a laptop." },
  { q = "How fast is the scanner?", a = "On a laptop, about 10 ms for YOLO11n detection and 50 to 80 ms for MobileCLIP-S2 embedding plus the nearest-neighbour search. On a recent phone, detection is similar and recognition is a few hundred milliseconds." },
]
author = 'Ankush'
related = ["/projects/2026.pokemon-scanner"]
+++

<figure class="doc-figure doc-figure--portrait">
  <video autoplay loop muted playsinline poster="/media/mypokemonscanner-poster.webp" width="332" height="670" aria-label="Scanner Demo">
    <source src="/media/mypokemonscanner.mp4" type="video/mp4">
  </video>
  <figcaption>It's fast. Really fast.</figcaption>
</figure>

I have always been a huge fan of Pokemon. I have played almost every game from GBC to HGSS, and recently played a few 3DS games when I got my hands on a 'new' 3DS in Thailand.

I also started collecting Pokemon cards last year and as of writing this, I have around 350-400 cards. I couldnt look at them just sitting tightly in a tin and a cardbox, so I bought a pack of penny sleeves and a good binder (without the O-rings) and put all the shiny sparkly holo cards with cool looking artwork at the front, following with reverse holows and other normal cards that I like, and yanked the rest of the bulk back into the tin :)

At this point I have a bunch of cool art cards, in English, Thai, Japanese, Korean and Chinese, which look soo cool and valuable. I then tried a bunch of apps that scan pokemon cards and tell you more about it, but they all had their limitations or were straightup paywalled, that too by a large margin (not even an amount that one just spends without thinking much), so I did what every engineer would do at that point

## How the scanner works

The whole pipeline runs in the browser and has four stages:

1. **Detect** the card in the camera frame with a YOLO11n model (about 5 MB, around 10 ms per frame on a laptop).
2. **Crop and embed** the card with MobileCLIP-S2, which turns the image into a vector.
3. **Search** a precomputed index of embeddings for roughly 20,000 English and Japanese cards and take the nearest neighbour.
4. **Look up** the matched card's name, set, number and TCGplayer price from a card database.

No image ever leaves the device. Everything below is how I got there, including the detours.

| Stage | Model | Format | Size | Time (laptop) |
|---|---|---|---|---|
| Card detection | YOLO11n, fine-tuned on a Pokemon card dataset | ONNX | ~5 MB | ~10 ms |
| Recognition | MobileCLIP-S2 image encoder | ONNX, FP16 | tens of MB | 50 to 80 ms incl. search |
| Index | 20K card embeddings | float16 matrix | ~20 MB | in-memory nearest neighbour |

## I hacked my own Pokemon card scanner _&lt;insert maniacal laughter&gt;_

TLDR; scraped ~20K card data and images from [TCGdex](https://tcgdex.dev), generated embeddings using [OpenAI CLIP](https://openai.com/index/clip/) model, and used [OpenCV](https://opencv.org/) to very crudely find a rectangle like region in the image, and crop it out to search in the embeddings.

While the initial setup worked flawlessly on my mac, it was just a hacky taped together REST API that took an image and returned the card name, card id, image url, and had a bunch of issues I would have to deal with if I wanted to launch this as an app.

The image embeddings took around 7 minutes using [MPS](https://developer.apple.com/metal/pytorch/) on my Mac, which is fine, because inference is usually much quicker (~800ms at that time on mac), when I uploaded the embeddings to my VPS without a GPU and served the API, it took multiple seconds to identify the card from an image, which was disastrous. Continuing to use the VPS for reverse image search was the worst thing I could have done.

I decided I will move everything client side and run everything in the browser- card detection, cropping, recognition, data fetching, everything, and started reading more about different CLIP embedding models- SigLIP, OpenCLIP, MobileCLIP, ViTs, etc etc... and tried every single one of them. I also learnt about Model Quantization, where you reduce floating point accuracy to reduce the size of model (with some loss in accuracy) and make it run faster with less memory and power. Int8 quantization worked good enough for SigLIP.

I had already setup a workflow in the process, to generate embeddings and run it on the web using TF.js + onnx web runtime. I used SigLIP for a day or two, deployed a PWA and started messing around with it on my phone, and ended up switching it with MobileClip-S2, which had better results and accuracy recognising pokemon cards. There was some hurdles with quantization, Int8 always broke the exported onnx somehow, but FP16 quntization was fine and I ended up using that (whatever works well right?)

I also realised that all this time I had been using WebGL/wasm for inference on the web, and added WebGPU backend for Tfjs, which immedieately made inference much much faster.

> **Sidequest: YOLO model to specifically detect pokemon cards**
> 
> While opencv rectangle countour thingie to crop out cards works okay for still images, it failed drastically for video streams, which I was trying to use, so I ended up training a YOLO11n model on a pokemon cards dataset I found online, and it worked pretty well and really fast, while also being around 5mb for the entire model

By now the inference time on desktop averaged around 10ms for detection using yolo11n and 50-80ms for recognition using MobileClip-S2 and searching the embeddings, with similar times on mobile for yolo and usually a few hundred ms for recognition, but never more than a second if you have a good phone (not guaranteeing anything though)

### Cool, now I have a working scanner which is fast runs client side

What next? Data. TCGplayer has an extensive database on English cards, but Japanese and other languages? next to none {{< emoji "/emojis/harold.jpg" >}} So I had to look for other sources with both card data and images and ended up scraping [limitlesstcg](https://limitlesstcg.com) for both English and Japanese. I also ended up using the [TCGplayer](https://www.tcgplayer.com/) apis to fetch pricing info for all cards and sets, including variations like card condition- near mint, lightly played, damaged, card type- normal, holo, reverse holo.

Now I have a codebase which can:
- download english card data from tcgdex
- download japanese card data from limitlesstcg
- merge both to fill in missing cards and their info
- fetch whatever price info it can find for our merged cards db
- has apis to search & query our data

## Picking an embedding model

Since the model choice is the question I get asked most, here is how the candidates compared for this job.

| Model | Accuracy on cards | Browser speed | Quantisation | Verdict |
|---|---|---|---|---|
| OpenAI CLIP ViT-B/32 | Good | Slow, large | Fine | Great server-side, too heavy for phones |
| SigLIP (base) | Good | OK | Int8 worked | Solid runner-up |
| OpenCLIP variants | Mixed | Varies | Fine | Depends heavily on checkpoint |
| MobileCLIP-S2 | Best in my tests | Fast | FP16 only (Int8 export broke) | Shipped |

The pattern: models trained for mobile (MobileCLIP) kept accuracy on card artwork while cutting latency, and the FP16 export was good enough that Int8 was not worth fighting for.

## Package and ship

Setup a cron on my VPS to update my card data every 3 days, cleaned up the codebase, wrote QOL scripts, built a nice little frontend hosted it on mypokemonscanner.com and we're done building our card scanner (•̀ᴗ•́ )و 

*Update: mypokemonscanner.com is no longer online, but the Wayback Machine has an [archived snapshot](https://web.archive.org/web/20260227180613/https://mypokemonscanner.com/). The [project page]({{< ref "/projects/2026.pokemon-scanner.md" >}}) has the demo and the tech stack.*