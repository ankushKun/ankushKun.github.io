+++
date = '2025-12-24'
draft = false
title = "Building a DOOM-Style 3D Renderer from Scratch in JavaScript"
description = "A deep dive into building a 3D renderer from scratch using JavaScript and HTML5 Canvas, inspired by the classic DOOM engine."
summary = "Ever wondered how classic games like DOOM rendered their immersive 3D worlds? This post breaks down the math and logic behind a retro 3D engine."
tags = ["graphics", "javascript", "doom", "2.5d", "3d", "game-development", "canvas", "rendering-engine"]
og_image = "/media/doom-renderer-og.jpg"
author = 'Ankush'
+++

# How 3D Graphics Work: Building a DOOM-Style Renderer from Scratch

<div align="center">

<style>
  .demo-container {
    position: relative;
    display: inline-block;
    width: 100%;
    max-width: 760px;
  }
  .demo-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 1.5em;
    font-weight: bold;
    pointer-events: none;
    border-radius: 8px;
  }
  .demo-container:hover .demo-overlay,
  .demo-container:focus-within .demo-overlay {
    display: none;
  }
  #demo {
    width: 100%;
    max-width: 760px;
    height: auto;
    aspect-ratio: 760 / 500;
    border-radius: 8px;
    cursor: pointer;
  }
</style>

<div class="demo-container">
  <iframe id="demo" src="https://7jiiceni3iqjhaxe44sesz2qjd5q7m5l3kumbu2gzmoerv5ifi3a.arweave.tech/-lCBEajaIJOC5OckSWdQSPsPs6vaqMDTRsscSNeoKjY?"></iframe>
  <div class="demo-overlay">Click to play</div>
</div>
<p style="font-size: 0.9em; color: #888; margin-top: 8px;">Move with WASD</p>

</div>

<br/>

Recently I have been adding games to my portfolio and DOOM is one of them. But instead of just embedding the original game, I wanted to understand how it actually worked. So I went down the rabbit hole (a second time) and built a more whacky version of the doom renderer from scratch and in HTML canvas, no extra dependencies.

Turns out, classic games like **DOOM** didn't do real 3D at all. They used something called **2.5D rendering**,  basically faking 3D with clever 2D math. And it ran on hardware way worse (100x or more times worse) than what you are reading this on.

Today I'll break down how I built my own DOOM-style renderer. No fancy tools required, just a code editor and a web browser.

<center>

{{< button "https://gist.github.com/ankushKun/653b7eeaf6d4279ef97f1ab6f709110a" "Full Source Code" >}}

</center>


## Is 3D actually 3D?

At its core, 3D rendering is basically **"If we have a 3D world and a camera, what does the camera see?"**

This process generally involves defining the world (objects), placing the camera (viewer), projecting those 3D coordinates onto a flat 2D screen, and finally filling the screen with the correct colors (drawing pixels).

```text
   3D World          Camera          2D Screen
  ┌─────────┐                      ┌─────────┐
  │ ▓▓▓     │     ────────────►    │   ▓▓    │
  │    ▓▓▓  │     (projection)     │  ▓▓▓▓   │
  │  ▓▓     │                      │   ▓▓    │
  └─────────┘                      └─────────┘
```



## Representing Space with a top down 2D Map

The simplest way to define a world map is with a **grid map**. We can represent this as an array where each cell is either a wall (`1`) or empty space (`0`).

> Future Scope: we can implement an `enum` and use different types of walls or place objects with different number instead of just 0 and 1.

```javascript
const MAP_WIDTH = 11 // Number of rows
const MAP_HEIGHT = 17 // Number of columns
const TILE_SIZE = 25  // Size of each tile in world units, increasing this makes the map look more spread out
const WALL_HEIGHT = 40

const MAP = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1,
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  // ... more rows
]
```

This is effectively a **top-down view** of the world. 

```text
■■■■■■■■■■■
■         ■
■         ■
■   ■   ■ ■    ← Interior pillars
■         ■
■         ■
■■■■■■■■■■■
```

### Why 2D Maps for 3D?

This is one of the techniques games like DOOM used to achieve their 3D effect. The world is fundamentally **2D with height**. The X and Y coordinates define horizontal position, while height is just a property of the walls rather than a full 3D coordinate.



## Player State

The player (our camera) is defined by three simple values: an `x` and `y` position in the world, and an `angle` representing the direction they are facing.

```javascript
const Player = {
  x: 50,    // World X position
  y: 50,     // World Y position  
  angle: 0,    // Direction facing
}
```

### Coordinate System

We use a standard coordinate system where angle 0° looks toward positive Y (down on the map) and 90° looks toward positive X (right on the map). All angles are in degrees (0-359).

```text
         180°                (0,0) ────────► X
          ▲                   │
          │                   │
          │                   │
270° ◄────┼────► 90°          │
          │                   ▼
          ▼                   Y
          0°
```

For performance, we pre-calculate degree-to-radian conversions so we don't have to constantly do the math during the render loop.

```javascript
const RAD = Math.PI / 180
const DEG_TO_RAD = Array.from({ length: 360 }, (_, i) => i * RAD)

// Usage: instead of calculating Math.sin(angle * Math.PI / 180)
// We just do: Math.sin(DEG_TO_RAD[angle])
```

## Transforming World to Screen

This is where the 3D illusion happens! We need to transform world coordinates to screen coordinates in two steps.

### Step 1: Translate (Move world relative to player)

First, we move everything so the player is at the origin `(0, 0)`. We simply subtract the player's position from the wall's position.

So instead of actually moving the player, we are moving the world relative to the player. From the players perspective, it seems they are moving.

```javascript
const relX = wallX - Player.x
const relY = wallY - Player.y
```

### Step 2: Rotate (Align world objects with viewing angle)

We rotate the worlds objects relative to the player's viewing angle.

```javascript
const ps = Math.sin(DEG_TO_RAD[Player.angle])  // sin of player angle
const pc = Math.cos(DEG_TO_RAD[Player.angle])  // cos of player angle

// Rotation matrix application
const tx = relX * pc + relY * ps   // transformed X (left/right)
const ty = relY * pc - relX * ps   // transformed Y (depth/distance)
```

**What this means:** `tx` is how far left or right the point is from center of view, and `ty` is how far forward the point is (the **depth**).


## Projecting 3D data onto 2D screen

The furthest the image is, the smaller it should look. Mathematically, this just means dividing by depth (`ty`).

```javascript
const fov = 90  // Field of view scalar

// Screen X (horizontal position)
// Add screen.width/2 to center it
const screenX = (tx * fov / ty) + (screen.width / 2)

// Screen Y (height)
// Taller walls or closer walls appear larger
const screenHeight = (WALL_HEIGHT * fov / ty)
```

## Translate walls 

To draw a wall, we need four points on the screen: Top-Left, Top-Right, Bottom-Left, and Bottom-Right.

```javascript
function project(x, y, z) {
  // z is height (0 for floor, WALL_HEIGHT for ceiling)
  // ... translation logic ...
  // ... rotation logic ...
  
  // Projection
  const screenX = (tx * fov / ty) + (screen.width / 2)
  const screenY = (z * fov / ty) + (screen.height / 2)
  
  return { x: screenX, y: screenY }
}
```

We project the two ends of a wall segment to get their screen coordinates, then fill the polygon between them using `ctx.beginPath()` and `ctx.fill()`.

## Sort the walls and finally draw them on canvas

If we just draw walls in any order, distant walls might be drawn *on top* of close walls. That would look weird, so we first sort the walls based on their distance from the player.

**The Painter's Algorithm:** Draw background objects first, then foreground objects over them.

```javascript
function draw3D() {
  const wallsWithDistance = walls.map(wall => {
    // Calculate distance to player
    const dist1 = dx1*dx1 + dy1*dy1
    const dist2 = dx2*dx2 + dy2*dy2
    
    // ... calculate weighted distance ...
    return { wall, distance: weightedDist }
  })
  
  // Sort far to near
  wallsWithDistance.sort((a, b) => b.distance - a.distance)
  
  // Draw
  wallsWithDistance.forEach(item => drawWall(item.wall))
}
```

### Why the Weighted Distance?

Simple closest-point distance can fail for angled walls. The weighted average considers the closest point (most important for occlusion), the midpoint, and the farthest point to handle edge cases gracefully.


## Clipping: Dealing with Edge Cases

### The Problem: Behind the Camera

When a wall is partially behind the player, the math breaks! Computing `screenX = tx * fov / ty` when `ty` is negative or zero creates division by zero or negative numbers, resulting in visual glitches.

### Near-Plane Clipping

We define a **near plane** -- a minimum distance. Anything closer gets clipped.

```javascript
const NEAR_PLANE = 1

// If endpoint is behind us, move it to the near plane
if (cy1 < NEAR_PLANE) {
  const t = (NEAR_PLANE - cy1) / (cy2 - cy1)  // Interpolation factor
  cx1 = cx1 + t * (cx2 - cx1)  // New X at near plane
  cy1 = NEAR_PLANE             // Clamp to near plane
}
```

### Screen-Space Clipping

Walls extending off-screen are also clipped to prevent wasted drawing.

```javascript
// Clip to left edge (x = 0)
if (sx1 < 0) {
  const t = (0 - sx1) / (sx2 - sx1)
  wallTop1 = wallTop1 + t * (wallTop2 - wallTop1)
  wallBot1 = wallBot1 + t * (wallBot2 - wallBot1)
  sx1 = 0
}
```

## Movement & Controls

### WASD Movement

Movement is relative to where the player is looking.

```javascript
function movePlayer() {
  // Forward direction based on angle
  const dx = -Math.sin(DEG_TO_RAD[Player.angle]) * MOVE_SPEED
  const dy = Math.cos(DEG_TO_RAD[Player.angle]) * MOVE_SPEED
  
  // ... apply movement based on keys ...
  
  // Normalize diagonal movement for consistent speed
  const magnitude = Math.sqrt(moveX**2 + moveY**2)
  if (magnitude > 0) {
    moveX = (moveX / magnitude) * MOVE_SPEED
    moveY = (moveY / magnitude) * MOVE_SPEED
  }
}
```

### Mouse Look with Pointer Lock

For immersive FPS-style controls, we lock the mouse cursor. **Pointer lock** hides the cursor and provides raw mouse movement data.

```javascript
document.addEventListener("mousemove", (event) => {
  if (!isMouseLocked) return
  
  const mouseMove = event.movementX
  const degreeChange = mouseMove / screen.width * 360
  
  Player.angle -= degreeChange
})
```

## Wall Collision Detection

### Grid-Based Collision

Since our world is grid-based, collision is simple. Just check if the players future calculated position is a wall and conditionally allow movement.

```javascript
function isWall(worldX, worldY) {
  const tileX = Math.floor(worldX / TILE_SIZE)
  const tileY = Math.floor(worldY / TILE_SIZE)
  return getMapTile(tileX, tileY) === 1 // 1 is a wall in our implementation
}
```

We also give the player a **radius** and check all corners to ensure the player doesn't clip into walls. If directly blocked, we try sliding along the wall. This creates smooth movement even when running into walls at angles.


## Putting It All Together

Every frame, we simply clear the screen, handle input, render the walls, and debug if needed.

```javascript
function loop() {
  clearScreen()   // Draw floor and ceiling
  movePlayer()    // Handle input
  draw3D()        // Render walls
  debug()         // Show debug info
}

// Run at 30 FPS
setInterval(loop, 1000 / 30)
```


## What Next?

The engine we built covers the fundamentals, but classic DOOM had much more: texture mapping, sprites, variable height sectors for different floor/ceiling heights, lighting, enemy AI, sound, guns, an actual game!

Feel free to extend this engine to add more features! &lt;3

<center>

{{< button "https://gist.github.com/ankushKun/653b7eeaf6d4279ef97f1ab6f709110a" "Full Source Code" >}}

</center>


## References

- [DOOM Wiki: Rendering Engine](https://doomwiki.org/wiki/Rendering_engine)
- [Let's program DOOM by 3DSage](https://www.youtube.com/watch?v=huMO4VQEwPc)