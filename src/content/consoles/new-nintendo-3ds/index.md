---
title: New Nintendo 3DS
description: My daily-carry New Nintendo 3DS picked up in Thailand in 2025, running Luma3DS custom firmware and my own native C/C++ homebrew apps.
date: 2025-05-20
maker: Nintendo
released: 2014
mods: [Luma3DS CFW, Homebrew Launcher, DSP1 firmware dump, FBI]
tags: [hardware, handheld, game-dev]
related: [/blogs/nintendo-3ds-homebrew, /blogs/silent-hill-2-3ds-port, /projects/3dsdl, /projects/3dsfm, /projects/sh23ds]
---

I picked up this New Nintendo 3DS in Thailand in 2025, originally just to catch up on the Pokémon games I'd missed. It quickly turned into my favourite piece of hardware — pocketable, clamshell screens that never get scratched in a bag, solid battery life, and an 804 MHz ARM11 CPU + PICA200 GPU that's surprisingly fun to program directly in C and C++.

## Software & Mods

- **Luma3DS custom firmware** (installed via `3ds.hacks.guide`) with Homebrew Launcher and FBI for installing `.cia` titles onto the HOME Menu.
- **DSP1 firmware dump** (`sdmc:/3ds/dspfirm.cdc`) so native homebrew can use NDSP hardware audio cleanly.

## What I've Built for It

Getting tired of powering off the console and unscrewing the backplate just to move files onto the SD card sent me down a deep `devkitARM` + `libctru` + `Citro2D/Citro3D` rabbit hole:

- **[3dsDL](/projects/3dsdl/):** Downloads files straight to the SD card over verified HTTPS from a typed URL or scanned QR code.
- **[3dsFM](/projects/3dsfm/):** A full offline music player with Cover Flow, a queue, a visualizer, and lid-closed playback like a hinged iPod.
- **[sh23ds](/projects/sh23ds/):** A native C port of *Silent Hill 2: Director's Cut* rebuilt from the 2002 PC executable in Ghidra.

I also wrote up the full hardware-only debugging journey in [What I learned writing two Nintendo 3DS apps in 2026](/blogs/nintendo-3ds-homebrew/) and [Porting Silent Hill 2 to the Nintendo 3DS](/blogs/silent-hill-2-3ds-port/).
