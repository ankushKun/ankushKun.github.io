---
title: "Human Following Robot"
description: "An autonomous Arduino rover steered in real time over Bluetooth by a phone running Python, OpenCV, and YOLO person detection."
date: 2020-04-01
tags: ["hardware", "machine-learning"]
status: archived
stack: ["Python", "OpenCV", "YOLO", "Arduino", "Bluetooth Serial"]
related: ["/projects/tinkerfest"]
---

An autonomous Arduino rover that detects a person in its camera feed and follows them around the room.

A phone mounted on the chassis runs **Python + OpenCV + YOLO** on the live video feed and streams steering commands over Bluetooth serial to an Arduino driving the motors. Built right after [Tinkerfest](/projects/tinkerfest/) to redeem our previous computer-vision failure — and this one worked on the first real run.

<figure class="my-6">
  <div class="aspect-video w-full overflow-hidden">
    <iframe src="https://www.youtube-nocookie.com/embed/DqkEf7dYk4U" title="Human Following Robot demo" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="h-full w-full border-0"></iframe>
  </div>
</figure>
