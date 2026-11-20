---
title: "CardRepeater"
description: "ESP-IDF firmware turning an M5Stack Cardputer into a pocket WiFi repeater with a retro CRT terminal UI and phone setup page."
date: 2025-10-24
tags: ["hardware"]
status: active
stack: ["C++", "ESP-IDF", "PlatformIO", "ESP32-S3"]
links:
  - label: "Download firmware"
    url: "https://github.com/ankushKun/cardputer-wifi-repeater/releases/tag/0.1.0"
  - label: "GitHub"
    url: "https://github.com/ankushKun/cardputer-wifi-repeater"
related: ["/timeline/fwd-layoff"]
---

**CardRepeater** turns an M5Stack Cardputer into a WiFi repeater that fits in your pocket.

The Cardputer connects to your upstream WiFi while broadcasting its own access point simultaneously, routing traffic between the two with NAPT and DNS forwarding. The tiny screen displays a CRT-green status terminal showing uplink signal strength (RSSI), connected client count, and an actual ping-based internet check (since being associated with an access point doesn't guarantee connectivity).

Configuration happens from your phone: join the open `CardRepeater` network, open `192.168.4.1`, and enter the upstream credentials plus your repeater SSID and password. I went with a web setup page because I couldn't get the Cardputer's built-in keyboard matrix cooperating.

## Features

- Simultaneous STA + AP mode with NAPT and DNS forwarding
- Live connectivity check with green, yellow, and red status indicators
- Real-time uplink RSSI and connected client counter on the display
- Local captive setup page at `192.168.4.1`
- Prebuilt firmware binaries on GitHub Releases

## Built with

- M5Stack Cardputer (ESP32-S3)
- PlatformIO, ESP-IDF, and C++
