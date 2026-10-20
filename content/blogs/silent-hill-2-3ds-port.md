+++
date = '2026-10-20T18:00:00+05:30'
draft = false
title = "Porting Silent Hill 2 to the Nintendo 3DS: what the PC executable was hiding"
description = "How sh23ds rebuilds Silent Hill 2 from the 2002 PC Director's Cut executable as native code for the Nintendo 3DS: Ghidra, SecuROM, PS2 debug symbols, the game's lighting and fog formulas, and the bugs only a real console showed."
summary = "I took the 2002 PC executable of Silent Hill 2 apart in Ghidra and rebuilt the game in C for the 3DS. Along the way it turned out the lighting lives in the exe, James casts no shadow, the kick can't be pressed on a keyboard and the PC writes an Xbox save icon nobody reads. This is what I found, and what the console taught me after the emulator said everything was fine."
tags = ["hardware", "game-dev", "graphics"]
og_image = "/media/sh23ds-blog-og.jpg"
author = 'Ankush'
related = ["/projects/2026.sh23ds", "/blogs/nintendo-3ds-homebrew", "/projects/2026.3dsfm"]
links = [
  { label = "Install sh23ds", url = "https://ankush.one/sh23ds/install.html", icon = "web", primary = true },
  { label = "GitHub", url = "https://github.com/ankushKun/sh23ds", icon = "github" },
]

[[faq]]
q = "Is sh23ds an emulator?"
a = "No. sh23ds is a new engine written in C for the 3DS's ARM11 CPU and PICA200 GPU. The game's logic, camera, lighting, fog and events were read out of the PC Director's Cut executable in Ghidra and translated function by function, each with its original address in a comment. The game's data (maps, models, textures, sound, movies) is converted once on your computer by a packer, and the 3DS runs native code against it."

[[faq]]
q = "Do I need my own copy of Silent Hill 2?"
a = "Yes. sh23ds contains no game files, and the repository refuses commits that contain any. You need the PC release of *Silent Hill 2: Director's Cut*; the packer checks the retail `sh2pc.exe` (MD5 `f3f5360298b6d0f6f2e09cf24a0925d1`) and converts the `data` folder next to it, in your browser or with Docker. Nothing is uploaded."

[[faq]]
q = "Does it run on an original 3DS or 2DS?"
a = "It is built for the New 3DS (804 MHz, L2 cache, 124 MB of memory), and it detects an original 3DS, 3DS XL or 2DS and switches to a lighter profile: half the fog sprites, fewer streamed town tiles, no character shadows and a 30 fps cap, in the normal 64 MB memory mode. That profile runs every room in Azahar's Old 3DS model, but it has not been tried on a real original 3DS yet."

[[faq]]
q = "How do you get function names out of a game with no symbols?"
a = "Three sources. Silent Hill 2's PS2 beta shipped with debug information, so its function names, signatures and struct layouts are known; the PC code is matched to them through assert strings that name the source file and line, and then by order within each file. The Enhanced Edition's source code gives the addresses of about 70 globals in the PC executable. And the v1.0 PC build, which has no SecuROM, names the imports that SecuROM hides in the Director's Cut."

[[faq]]
q = "How long did the port take?"
a = "The research log starts on 16 October 2026, the first release (0.1.0, the whole game playable in the Azahar emulator) went out on 18 October, and 0.2.2 on 20 October. Claude Code agents working through REA, an MCP server for Ghidra, wrote the first drafts of whole modules from the decompile, and every ported function carries its PC address so it can be checked against the original."
+++

**Short version:** Silent Hill 2 now runs on a Nintendo 3DS as native code, rebuilt from the 2002 PC Director's Cut executable. Reading that executable in Ghidra turned up a lot I did not expect, from lighting formulas stored in the exe instead of the maps to a kick you physically cannot press on a keyboard. Then the real console disagreed with the emulator about how dark James should be.

After writing [3dsDL](https://ankush.one/3dsDL/) and [3dsFM](https://ankush.one/3dsFM/) for my New 3DS, I knew the toolchain and I knew where the console likes to surprise you. Both of those are small apps. I wanted to see whether the same console could hold a whole game from 2001, and Silent Hill 2 is the one I picked: the fog, the flashlight, the radio static, all on a 400 by 240 screen you can fold shut.

The result is [sh23ds](https://ankush.one/sh23ds/). It is not an emulator and it is not the 2024 remake. It is a new engine in C, built on libctru and citro3d, that plays the PC game's own data after a packer converts it on your computer. The whole game is in: 17 areas, all 128 in-engine cutscenes, every puzzle and boss, the six endings, New Game+ and Born From a Wish.

![James walking past a fire hydrant at the lake overlook, with the misty lake and pine trees behind a low wall, on the 3DS's top screen](/media/sh23ds/lake-overlook.jpg "The lake overlook near the start of the game, on the 3DS's 400 by 240 top screen.")

## How you port a game you don't have the source for

Konami never released the source code of Silent Hill 2. What exists is the Director's Cut executable, `sh2pc.exe`, compiled on 5 November 2002 with MSVC 7.0 and wrapped in SecuROM. The port treats that file as the specification. Every behaviour a player can see should come from its code, read through Ghidra, and every ported function cites the PC address it came from, in a form like `0x4a96c0 enDyingExec`. Where the port does something else, the code says so and a status page lists it.

That rule exists because there is too much code to hold in your head. Ghidra's auto-analysis found 4,599 functions; after a pass that turns orphaned code into functions, there are 6,620. Most of them were called `FUN_0049a7e0` and similar for a long time, so the first job was finding names.

```text
source                        what it gives
----------------------------  ---------------------------------------
PS2 beta debug info (DWARF)   names, signatures, locals, 28,104 types
asserts in the PC exe         file and line, to pin PS2 names on PC
Enhanced Edition source       ~70 globals: chapter, camera, fog, light
PC v1.0 (no SecuROM)          the imports SecuROM hides in the DC
```

Silent Hill 2's PS2 beta shipped with its debug information, which the community has turned back into C headers. That gives the real names of functions and the layouts of their structs, but for the PS2 build. To pin a PS2 name on PC code you need an anchor, and the PC exe has them: assert messages that print the source file and line number. Thirty functions are named that way, and the rest of each file is lined up by order between those anchors. The [Silent Hill 2: Enhanced Edition](https://github.com/elishacloud/Silent-Hill-2-Enhancements) project, which fixes the PC port on modern Windows, contributes the addresses of about 70 globals, things like the current chapter, James' position, the fog and the flashlight. Resolved against the Director's Cut, those plus the Windows layer's own functions and globals made 82 labels to start from.

I did not write all of this by hand. The research plan I started with estimated the decompilation at 12 to 24 months part-time. What changed that was [REA](https://github.com/morluto/rea), an MCP server that drives Ghidra, and Claude Code agents using it: the work log is full of lines like "subagent port of the PC vc_main module (100 functions, registers checked against objdump)". The address in every comment is what makes those drafts checkable. You can decompile the cited function and compare it branch by branch, which is also how several of Ghidra's own labels turned out to be wrong. The research log starts on 16 October. Version 0.1.0, playable from the restroom mirror to every ending in the Azahar emulator, went out on the 18th.

## What the executable was hiding

Some of this is archaeology and some of it explains why Silent Hill 2 looks and plays the way it does. All of it came out of reading the exe, and the docs in the repo have the addresses.

### 1. The source tree leaked, typo included

Asserts print the path of the file they live in, so the exe contains 22 paths under `\CVSWork\sh2pc\src\`. The folders are `Collision`, `Effect`, `Enemy`, `Event`, `sound`, `view` and `Chacter`, spelled exactly like that. The v1.0 build has the same files under `\projects\sh2pc\src\`. The Ghidra project tags every function it can place with those paths, typo and all, so `0x5369e0` reads as part of `game/Chacter/m3_sc.c`, and since MSVC links each source file as one contiguous run, a few known files are enough to map whole stretches of the exe.

### 2. SecuROM hides every import, and v1.0 gives them back

SecuROM points the PE header at its own import table, and the game code reaches Windows through a single slot in SecuROM's section: 730 call sites all `call [0x24dc3f0]`, a dispatcher that works out which API you meant from the return address. Ghidra sees 730 calls to one function. Another 628 calls go into two tables of stubs that stay encrypted until SecuROM runs.

The way out was the v1.0 PC build, which has no SecuROM and calls the same APIs through a normal import table. 3,535 functions match one to one between the two builds, so a call site in the Director's Cut can borrow the name from the same spot in v1.0. That named 605 of the 730 dispatcher calls, and where more than one method could name a site, all 534 agreed. The globals line up too: almost all of them sit exactly +0x2C00 further along in the Director's Cut, so labels carry over in both directions.

SecuROM also encrypts 56 functions inside the game code, mostly the C runtime, and the code for stages 57 and 58. Those two stages are Born From a Wish, the Director's Cut's extra scenario with Maria. Four of their stage programs could not be read at all, so they were rebuilt from the stages' events and messages instead.

![Maria standing by a window with half-closed blinds in a dim room, from the Born From a Wish scenario](/media/sh23ds/born-from-a-wish.jpg "Maria in Born From a Wish. The code for its two stages is encrypted in the exe.")

### 3. The "SIMD block" was Microsoft's maths library

There is a block of about 95 SSE and 3DNow! routines in the exe, and my first guess was that it was the game's own vertex transform, tuned for the processors of 2002. It is D3DX8. `D3DX_InitPSGP` reads a registry value, tests the CPU for 3DNow!, SSE2 and SSE, and fills a 57-entry function table from one of three sets. The first function of the stretch I had marked as game code turned out to be libjpeg's `select_ncolors`. The game statically links D3DX8, libjpeg 6a from 1996, libpng 1.0.5, zlib 1.1.3 and CRI's audio and video middleware, about 181 KB of code the port replaces instead of translating.

### 4. The lighting lives in the exe, and the vertex colours are added

I expected the room lighting to be in the map files. It isn't. Each map has a 496-byte record compiled into the exe, which the PS2 debug info calls `DrawEnvData`: 129 of them, behind 17 pointers at `0x8063c8`, one array per stage world. The record is picked when James arrives in a room and holds the light directions and colours, the fog, the clear colour and a flag that marks a "dark" room.

The PC draws maps with Direct3D 8 vertex shaders, and their bytecode is in the exe too, so the formulas can be read exactly. For the common map geometry the colour is:

```text
oD0 = 2 * (c20 * (sum of N.L * light colour + c21) + c22 * vertex colour)
```

The vertex colour baked into the map is added on top of the lighting, like an emissive term, and never multiplies it. In the apartment corridor `ap38`, 98% of the vertex colours are zero, the room's lights add about 0.03 and the ambient term 0.013, so with the flashlight off a wall comes out at about 4% of its texture. That is how dark the PC game really is. The flashlight is a per-pixel projected texture drawn on top, and it is the only reason those rooms are readable. On the 3DS the same formulas run in a vertex shader, and the flashlight is a fragment spotlight.

![James in the dim restroom where the game begins, beside the urinals and a stained tiled wall](/media/sh23ds/restroom.jpg "The restroom where the game starts, lit by its record from the exe: three directional lights per vertex, plus the colours baked into the map.")

### 5. The fog is a straight line, if you look at it the right way

The PC fog factor is `clamp(A + B / w, 0, 1)`, where w is the view depth and A and B come from the fog start and end. It is linear in 1/w rather than in distance, and that was a lucky break. The 3DS GPU does fog through a 128-entry lookup table indexed by the depth buffer value, and perspective depth is also linear in 1/w, so the PC's curve is a clamped straight line in the 3DS's table. The port fills the table from each room's fog record and gets the PC's fog exactly. Lit rooms keep 8% fog at 3000 units and reach 92% at 5500; dark rooms go from clear at 3000 to black at 7500.

The drifting fog you see outdoors is a separate system, ported from the game's fog module: up to 500 particles on the PC that drift with 18 kinds of wind, collide with walls, get pushed out of crowded cells and get shoved aside by James, who counts as a cylinder with a radius of 110 at waist height. The three rooms of the Eddie fight have tables of vents that puff fog which sinks, because the code treats it as cold air. The 3DS simulates 144 particles and gives the missing ones' opacity to the ones it draws, so the fog is as thick with fewer sprites.

![A back alley of the town under thick fog, with a bloodstain on the ground, on the 3DS's top screen](/media/sh23ds/town-fog.jpg "A back alley in the town, a few steps into the fog.")

### 6. James casts no shadow

Every model in the game has a shadow model next to it, a `.kg1` file of closed triangle strips per bone that the shadow code extrudes away from the light. James' and Maria's gameplay `.kg1` files are empty. On the PC they cast none of the stencil shadows, and the soft drop shadows you see in the town all belong to enemies. The cutscene versions of both characters do have full shadow models.

The shadows themselves are a CPU version of the PS2's vector unit programs. They count stencil volumes on depth pass, which goes wrong whenever the camera is inside a volume, and Silent Hill 2's fixed cameras love to look back at James past a monster. The port counts on depth fail with capped volumes instead, and looks the same everywhere else.

### 7. The kick needs a pressure-sensitive button

When an enemy is down, the PC chooses between a kick and a stomp from how hard you press the button: it requests action `6 + (pressure > 0xc0)`. That made sense on the PS2's pressure-sensitive face buttons. A keyboard or a modern pad reads every press as full pressure, so the PC as shipped can only ever stomp. The same test makes every first swing of the plank the heavy one. The Enhanced Edition fixes both by letting a tap and a hold choose, and the port follows it: with R held, tap A to kick and hold it for 0.2 seconds to stomp.

### 8. The camera never looks at the walls

The PC camera makes no collision or line-of-sight queries at all. Every constraint comes from "roads" in each room's `.cam` file, volumes that say where the camera may sit and what it looks at. The camera module is 100 functions; 86 are translated to C, and a test harness ran all 375 `.cam` files for 240 frames each without a NaN.

The port also keeps eight of the camera's oddities, because they are what the PC does. One function that looks for the nearest item writes what it finds into the enemy fields, so the "nearest item" stays empty forever. And several functions in this module had the wrong names in Ghidra: each carried the name of its neighbour, probably because the names came from assert line ranges and the PC source has more lines than the PS2 beta. They were identified by behaviour and signature instead, and the porting notes list every correction.

### 9. The ending counts time near Maria before you meet her

The ending you get is decided at the hotel's last door from a set of counters: time spent at low health, healing items used, time near Maria and time far from her, how often James runs into her, how much damage she took. The distance to Maria is only written while she is around, but the game reads it every frame. Before she first joins you it is zero, so the "near Maria" time grows through the whole first part of the game, and after she leaves it keeps her last distance. Looking at Angela's knife in the item list sets a flag that counts toward the In Water ending.

### 10. A few small ones

- Saving picks an icon by action level and a counter, then writes it next to the save as `SaveImage.pcv`, the Xbox dashboard's icon format. Nothing on the PC reads it back.
- The game's 16-bit floats use the IEEE half layout without the special cases, so there is no zero: `0x0000` decodes to 2^-15.
- Blood is drawn by subtracting from the picture, in the inverse colour (red blood is sprayed as `(40, 255, 230)`). Subtracted blood only shows where there is light to take away, so in the dark it is invisible, on the PC and on the 3DS.
- Lying Figures see 5000 units in lit places, 4000 in the dark with your flashlight on and only 750 with it off, and their acid reaches less far in the dark too, so switching the light off really does help you sneak past them.
- CRI's ADX audio stores each frame's scale minus one: the original `voice.afs` has about 150,000 frames with a stored scale of 0 but non-zero samples, which only makes sense that way. ffmpeg uses the stored scale as is, so voices the packer encodes with ffmpeg from the Enhanced Edition's WAVs came out at 15 to 23 dB of signal-to-noise. Storing every scale one lower brought them to 36 to 43 dB.

![James in a narrow, dark corridor with a monster coming toward him from the far end](/media/sh23ds/corridor.jpg "A dark corridor. In rooms flagged as dark, the flashlight is the only real light, drawn per pixel over the per-vertex lighting.")

## Fitting it on a 3DS

The PC's `data` folder is 2.4 GB, with 3,581 textures taking about 608 MB. DXT1 is 4 bits per pixel and so is the 3DS's ETC1; DXT3 and DXT5 are 8 bits, like ETC1A4. A straight transcode keeps the size, and capping textures at 256 pixels for a 400 by 240 screen does the rest. The packed game is about 1.3 GB on the SD card. The PS2 ran all of this in 32 MB of memory, and a New 3DS title gets 124 MB.

Most of the engineering went into not hitching. Some of the things that moved:

```text
what                    before                     after (Azahar)
----------------------  -------------------------  ------------------
AIX music, 5 layers     main loop, 25 to 32 ms     own thread, core 2
                        every 6 or 7 frames
town tiles              main loop, 240 to 440 ms   reader thread
worst town frame        ~500 ms                    ~19 ms
room load, ap06         3,156 ms                   91 ms, behind fade
slowest of 229 rooms    -                          18.9 ms (New 3DS)
```

Memory needed one surprise fixed. libctru splits the New 3DS's 124 MB mode into 32 MB of linear memory and about 91 MB for `malloc`, which is the wrong way round for a game: every texture, vertex buffer and sound buffer has to live in linear memory so the GPU and DSP can reach it, and `malloc` never held more than 3.7 MB in any measurement. sh23ds replaces libctru's heap setup and gives `malloc` 32 MB, which leaves about 90 MB of linear memory.

Movies were a small project of their own. Bink has no 3DS decoder, so the packer re-encodes the story movies to MPEG-1 (the E3 and TGS trailers are skipped unless you ask for them) and the port plays them with [pl_mpeg](https://github.com/phoboslab/pl_mpeg) on the New 3DS's spare core, converting frames with the hardware's Y2R unit. The ARM11 has no NEON, so motion compensation averages four pixels per 32-bit word with plain integer tricks, which took the opening movie from 12.5 to 9.3 ms per frame. The opening movie is one file with two audio tracks, narrated and not, and the four ending credit rolls are one file with a song per track.

## What the console said that the emulator didn't

Everything above was tested in [Azahar](https://azahar-emu.org), headless, through a small libretro frontend that presses buttons on a schedule and saves screenshots. A playthrough suite walks James from the first room to each ending, and a warp test loads all 570 door destinations. The emulator was very good. It was also wrong about several things, and I only found out when the game ran on a real New 3DS.

### Characters came out almost black

The first console report said every character was too dark. The 3DS GPU keeps 8 bits per light colour, and the game's character lights go up to about 1.4 times the brightness setting. On the console those values wrapped round past the top and came out close to black. Azahar keeps more bits, so it drew them as intended and gave no hint. The fix sends character lights to the GPU at half strength and has the texture combiner double them back, which keeps every value in range on hardware and gives the same picture in the emulator.

### Cutscene audio stuttered

The audio thread only refilled its buffers when the main loop asked, once a frame, so a frame spent loading a scene, which takes seconds on a console's SD card, left the voices with nothing to play. On top of that the console reads the SD card one request at a time, so one big read made the music's small reads wait. The audio thread now wakes on its own every 20 ms and keeps several seconds read ahead, and big files are read in 64 KB pieces so the audio gets its turn. A `sdthrottle` switch now makes the emulator sleep like a slow card, which is how the fix was checked.

### Left and right were swapped

On the console, turning, strafing, the quick turn, aiming without a target, looking around and rowing the boat all went the wrong way, and so did positional sound. The flashlight button also clicked and switched an invisible light before James had found the flashlight; it now does nothing until he has it.

### The HOME Menu froze, twice, in two different ways

Pressing HOME and then Close hung the console, because the game kept waiting for GPU frames that never come once an app is closing. And the animated 3D banner on the HOME Menu, which Azahar does not draw at all, crashed the menu in one build and froze it in the next. I had been through this with [3dsFM's banner](/blogs/nintendo-3ds-homebrew/), so this time the banner builder refuses anything my two working banners don't do: nothing spins, nothing scales below 0.3, every animated bone has translation, rotation and scale tracks, and the packed banner stays under 330,000 bytes. The build that followed those rules worked first time. It shows the nine rusted squares from the game's last wall, pulsing on a heartbeat, with a jingle of radio static.

## The packer runs in your browser

The port can't ship any game data, so everyone has to convert their own copy. The converters are Python, and there is a Docker image that runs them, but Docker is a lot to ask of someone who wants to play a game. So the same converters also run in the browser: [Pyodide](https://pyodide.org) for Python, ffmpeg compiled to WebAssembly for the movies and audio, and tex3ds' texture encoders built to WebAssembly. You pick your game folder, the page runs one to four workers with their own Python each, and you save a zip. Nothing is uploaded.

With three workers in Chrome the whole game packs in about 407 seconds, against 1,281 with one, and the two zips hold the same 5,750 files with the same checksums. Comparing the browser's textures with the native pipeline's turned up one thing the browser does better. ImageMagick, which the native pipeline used for mipmaps, resizes in floating point, and its Lanczos filter overshoots past white along bright edges; when that becomes 8 bits again it wraps round to black. The browser's mipmaps don't have the thin black outlines.

## Where it stands

The whole game plays in the emulator, on both console models, and the New 3DS has run it and produced the fixes above. Some of those fixes are still waiting for a retest on hardware, and nothing has run on an original 3DS yet. The port lacks some of the PC renderer: water, specular highlights, blur and rain. A list of PC behaviours that are approximated rather than ported sits in the repo's status page, ordered by how much they matter.

If you have a hacked 3DS and the PC Director's Cut, the [install guide](https://ankush.one/sh23ds/install.html) takes under an hour, most of it waiting for the packer. The [project page](/projects/2026.sh23ds/) has the steps and the controls, and the code is on [GitHub](https://github.com/ankushKun/sh23ds). If you are thinking about porting a game of your own: pin one exact build of the executable and check its hash before you trust any address, put that address in a comment next to every function you port, and get the build onto the console early, because it knows things the emulator doesn't.
