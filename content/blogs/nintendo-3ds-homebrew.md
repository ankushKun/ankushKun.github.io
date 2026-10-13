+++
date = '2026-10-13T10:00:00+05:30'
draft = false
title = "What I learned writing two Nintendo 3DS apps in 2026"
description = "Building homebrew for the Nintendo 3DS today: the devkitPro toolchain, 3DSX vs CIA, the Azahar emulator, and the bugs that only show up on real hardware, from a music player and a downloader I wrote for my New 3DS."
summary = "I bought a New 3DS, got annoyed at pulling the SD card out, and ended up writing a downloader and a music player for it. This is what building for a 2011 handheld looks like now, and the five bugs that only a real console could show me."
tags = ["hardware", "game-dev"]
og_image = "/media/3ds-homebrew-og.jpg"
author = 'Ankush'
related = ["/projects/2026.3dsfm", "/projects/2026.3dsdl"]
links = [
  { label = "3dsFM", url = "https://ankush.one/3dsFM/", icon = "web", primary = true },
  { label = "3dsDL", url = "https://ankush.one/3dsDL/", icon = "web" },
]

[[faq]]
q = "What do I need to run homebrew on a Nintendo 3DS in 2026?"
a = "A console with custom firmware (Luma3DS, installed through the guide at 3ds.hacks.guide) and the Homebrew Launcher. From there you can run `.3dsx` files from the SD card, or install `.cia` files with FBI so they show up on the HOME Menu like a real game. Both of my apps ship as both."

[[faq]]
q = "What is the difference between a 3DSX and a CIA?"
a = "A `.3dsx` runs inside the Homebrew Launcher, which lends it the launcher's own permissions and memory setup. A `.cia` is installed as a title of its own, with its own icon, 3D banner and jingle on the HOME Menu, and it has to declare every service and memory region it needs in its `.rsf` file. That difference is where most of my hardware-only bugs came from."

[[faq]]
q = "Which toolchain do you use for 3DS homebrew?"
a = "devkitPro's devkitARM with libctru for the OS services, Citro2D and Citro3D for drawing, and NDSP for sound. I build in Docker with devkitPro's own image so the same commit produces the same binary on my Mac and in GitHub Actions, and I run day-to-day tests in the Azahar emulator."

[[faq]]
q = "Can you test 3DS homebrew without a console?"
a = "Mostly. Azahar runs the apps, plays audio and reads a virtual SD card, and I keep host-side unit tests for the portable parts. But the HOME Menu, the DSP's sleep handshake, the second CPU core and the real SD card all behave differently on hardware, and every serious bug I hit was one of those. A console and a log file on the SD card are not optional."
+++

**Short version:** the toolchain for the 3DS is in great shape, the emulator gets you ninety percent of the way, and the last ten percent is a list of things the real console does that nothing else will tell you about. This post is that list, plus how the two apps came to exist.

I picked up a New 3DS in Thailand last year, mostly to play the Pokemon games I had missed. It turned into my favourite gadget. It is small, the battery lasts, the clamshell means the screen never gets scratched in a bag, and a hacked one runs whatever you put on it. The one thing I kept bumping into was the SD card. Every guide, every tool, every "just copy this file over" starts with powering off, popping the card out and finding a reader. So I wrote [3dsDL](https://ankush.one/3dsDL/), which scans a QR code with the console's camera and downloads the file onto the card over HTTPS while the console stays on.

Then I noticed I was carrying the thing everywhere anyway and wanted my music on it. The built-in sound app is from 2011 and acts like it. So the downloader's toolchain, website and build pipeline became [3dsFM](https://ankush.one/3dsFM/), a music player with cover flow, a queue and a visualizer that keeps playing with the lid shut. Both are open source, both ship as a `.cia` you can install by scanning a QR code off the website, and both taught me something about the console that I could not have learned from documentation.

## What homebrew looks like now

If you last looked at 3DS homebrew around 2016, the landscape has settled. Luma3DS is the custom firmware everyone uses, [3ds.hacks.guide](https://3ds.hacks.guide) gets you there in an afternoon, and the Homebrew Launcher is the thing that runs `.3dsx` files off the card. For anything you want to live on the HOME Menu with its own icon, you build a `.cia` and install it with FBI.

The toolchain is [devkitPro](https://devkitpro.org): devkitARM for the compiler, [libctru](https://github.com/devkitPro/libctru) for the operating system services, Citro2D and Citro3D for drawing, and NDSP for sound. Ports of libcurl, mbedTLS, mpg123, libopus and most of what you would want exist in their package manager. I never installed any of it on my Mac. Both repos build in Docker from devkitPro's own image, pinned by digest, so a commit produces the same binary on my laptop and in GitHub Actions, and the release workflow publishes the `.cia`, the `.3dsx` and checksums every time I push a tag.

```text
  source/core/   portable logic, host tests under ASan       (tags, library, queue)
  source/app/    everything that touches libctru              (UI, audio, SD card)
  resources/     icon, 3D banner, jingle, the .rsf for the CIA
  scripts/       Docker build, banner rendering, test music
```

Splitting the code that way was the single best decision. The tag reader, the library scanner and the play queue have thirty-odd tests that run on the Mac in a second, under AddressSanitizer, against fixture files the tests write themselves. When something is wrong with how an album is grouped, I fix it on the host and never touch the console.

For day-to-day running there is [Azahar](https://azahar-emu.org), the current Citra fork. It plays audio, reads a virtual SD card, and it saved me hundreds of card swaps. I even script it: a `smoke.txt` on the virtual card is a list of button names the app presses one every twenty frames, logging the view it lands in, so I can drive the whole interface from a shell command and read the result. That is how most of the UI got tested.

And then there is the console, which is the only thing that tells the truth.

## The five things only the console told me

Every one of these worked in the emulator. Every one of these came from a frozen console in my hands or the log file I pulled off the SD card afterwards, because there is no debugger attached to a handheld in your bedroom. The app writes a `log.txt` on the card, keeps it across launches, and that file is the entire debugging story.

### 1. The CIA crashed on launch while the 3DSX was fine

The first 3dsFM build ran perfectly from the Homebrew Launcher and crashed the moment it started as an installed title. The emulator finally gave it away, with a line in its log about an unmapped write to address `0x1FF7xxxx`. That is DSP shared memory. NDSP writes to two windows of it, and a CIA has to map them itself in its `.rsf`:

```yaml
MemoryMapping:
  - 1ff50000-1ff57fff
  - 1ff70000-1ff77fff
  - 1f000000-1f5fffff:r
```

The 3DSX never needed this because the Homebrew Launcher's host title already maps them, and your app inherits that. This is the general shape of CIA bugs: the launcher was quietly lending you permissions, and now you have to ask for every one of them.

### 2. The 3D banner froze the HOME Menu

Installed titles get an animated 3D banner, the little model that bobs on the top screen when you select the icon. There is no official tool, so I generated a glTF scene in Python and converted it with [pycgfx](https://github.com/skyfloogle/pycgfx), which works. My first banner had a spinning vinyl record with a tonearm, music notes on their own bones, and a lighting setup. The console locked up the moment the HOME Menu tried to draw it. Hard power-off, every time.

The fix was a bisection by hand: install a build, select the icon, watch whether the console freezes, shrink the model, repeat. Swapping the jingle in and out proved it was the model. The version that works has eight bones, five meshes and 786 triangles, with the record's sway, bob and squash on one bone. There is a README in the repo with the table of what froze and what did not, because nobody should have to redo that.

### 3. Pressing HOME froze the console, and the DSP was why

This one took four releases. Press the HOME button while 3dsFM was playing and the whole console stopped. The app logs each stage of the hand-over to the HOME Menu, and the log always ended at the same line: my code had finished, and the freeze was somewhere inside libctru's own sequence, between saving VRAM and jumping to the menu.

The piece in the middle is the DSP going to sleep. libctru writes a suspend command to the sound processor and waits, forever if it has to, for an acknowledgement. With a channel still active and a decoder thread feeding it on the second core, that acknowledgement never came. Stopping playback inside the suspend hook made the HOME button work. The second half of the story was that after the menu round trip the DSP never played again: libctru's resume path left it in a state where buffers were queued and nothing consumed them. The fix that stuck was to shut NDSP down completely before the hand-over and bring it up fresh on the first frame back. The song resumes from the saved position and nobody notices.

> [!NOTE] A detail that cost me a day
> The system resets your app's share of the second CPU core to zero while it is suspended. If your audio thread lives there, it comes back from the HOME Menu with no CPU at all and the music simply stops. You have to ask for the share again on the way back in.

### 4. Audio was choppy, then played out of order

Once it played, it played badly whenever the library scan or the cover loader was busy on the SD card. mpg123 was reading the file a few hundred bytes at a time through its own reader, and the Ogg and Opus decoders used unbuffered stdio, so every busy moment on the card became a gap in the sound. Every decoder now reads through a 64 KB buffered stream, and the player keeps about a second of decoded audio queued ahead of the DSP.

My first attempt at that second of lead used six wave buffers, and that produced the strangest bug of the project: the song played in the right order for a while, then jumped back, then forward, in half-second chunks. The emulator played it perfectly. It turns out NDSP hands the DSP one playing buffer plus a ring of four queued slots, and a fifth queued buffer is written into a slot the DSP may still be reading. Nothing documents the limit. Four buffers, each three times longer, and it was fine.

### 5. The SD card is slower than you think, in ways you can measure

The scan of 600 songs took minutes, and the first fix was obvious: the tag reader was pulling every file's full embedded cover through a 1 KB stdio buffer, which is hundreds of round trips to the file system service per song. Reading frame by frame, sampling 64 KB of the picture for a hash, and a 32 KB buffer made it several times faster. Then I saved the result to an index on the card so the second launch reads no music files at all, and later made that index load before the scan even starts, so the library is there the moment the app opens.

Two more surprises came from the console. macOS leaves a `._name` file next to every file you copy, so my 590 songs had 324 shadows, and deleting them all in one burst at scan start made the whole console crawl, buttons included, because the file system service was saturated. The deletes now run one at a time after the scan. And a flat folder of 600 files gets slower to open the deeper in you go, because FAT walks the directory from the start for every open. The app cannot fix that one, but the log now times every batch of a hundred files so I can at least see it.

## Threads, priorities and the one number that matters

The 3DS kernel schedules strictly by priority and does not time-slice between equal priorities. Your main thread runs at 0x30, and lower numbers win. libctru's own APT handler thread, the one that delivers the HOME button and sleep messages, runs at 0x31. My scan thread and my cover loader were also at 0x31, which meant a cover decode could sit between the HOME button and the code that handles it. They live at 0x32 now. The audio decoder runs at 0x2F, above the UI, so sound gets the CPU first and the screens absorb any hitching, which is the right trade on an Old 3DS with one usable core.

```text
  0x18  NDSP's own thread            (libctru)
  0x2F  audio decoder                 (above the UI on purpose)
  0x30  main thread: input, drawing
  0x31  APT handler: HOME button, sleep   (libctru, do not sit here)
  0x32  library scan, cover loader, watchdog
```

Speaking of the watchdog: a thread that sleeps most of the time and, while a hand-over to the HOME Menu is in progress, writes a line to the log every two seconds. When the console froze with that thread still writing, I knew the process was alive and the main thread was stuck in the DSP handshake. When it froze with no lines, the whole system had stopped. That one distinction found bug number three.

## The parts that were just fun

The interface follows the HOME Menu: the bottom screen is the controller, the top screen shows what is happening, and one selection blue runs through everything. The font is M PLUS Rounded, bundled in the ROM so it looks the same on a console and in the emulator. 3dsFM's songs view is an iTunes-style cover flow with flick physics, which on a 400 by 240 screen is more charming than it has any right to be. Both apps have 3D banners and jingles, and both websites are a Wii Menu and 3DS HOME Menu homage with the install QR codes front and centre, because the whole point of 3dsDL is that you scan them from the console.

If you have a hacked 3DS, [3dsFM](https://ankush.one/3dsFM/) and [3dsDL](https://ankush.one/3dsDL/) are a QR scan away, and the code for both is on GitHub. If you are thinking of writing something for the console yourself: keep the portable parts portable and test them on your computer, build in Docker, script the emulator, and put a log file on the SD card before you need one. The console will still surprise you, but at least it will leave a note.
