+++
date = '2026-01-18'
draft = false
title = "How I built a Pokemon TCG scanner that runs 100% in your browser"
description = "A story about building a lightning fast, offline-capable Pokemon card scanner using YOLO11, MobileCLIP, and WebAssembly."
summary = "I wanted a way to scan my Pokemon cards instantly without waiting for server uploads. Here is how I built a fully client-side scanner using modern web AI tools."
tags = ['tensorflow', 'CLIP', 'tfjs', 'onnx', 'siglip', 'embedding', 'pokemon', 'tcg', 'scanner', 'web-assembly']
author = 'Ankush'
+++

<div align="center">
  <img src="/media/mypokemonscanner.webp" alt="Scanner Demo" style="border-radius: 8px; max-width: 100%;" />
  <p style="font-size: 0.9em; color: #888; margin-top: 8px;">It's fast. Really fast.</p>
</div>

<br/>

I have always been a huge fan of Pokemon. I have played almost every game from GBC to HGSS, and recently played a few 3DS games when I got my hands on a 'new' 3DS in Thailand.

I also started collecting Pokemon cards last year and as of writing this, I have around 350-400 cards. I couldnt look at them just sitting tightly in a tin and a cardbox, so I bought a pack of penny sleeves and a good binder (without the O-rings) and put all the shiny sparkly holo cards with cool looking artwork at the front, following with reverse holows and other normal cards that I like, and yanked the rest of the bulk back into the tin :)

At this point I have a bunch of cool art cards, in English, Thai, Japanese, Korean and Chinese, which look soo cool and valuable. I then tried a bunch of apps that scan pokemon cards and tell you more about it, but they all had their limitations or were straightup paywalled, that too by a large margin (not even an amount that one just spends without thinking much), so I did what every engineer would do at that point

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

## Package and ship

Setup a cron on my VPS to update my card data every 3 days, cleaned up the codebase, wrote QOL scripts, built a nice little frontend hosted it on [mypokemonscanner.com](https://mypokemonscanner.com) and we're done building our card scanner (•̀ᴗ•́ )و 

<center>

{{< github "ankushKun/mypokemonscanner" >}}
<br/>
{{< button "https://mypokemonscanner.com" "mypokemonscanner.com" >}}

</center>