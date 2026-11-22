---
title: "How Doom Rendering Works: A 2.5D Renderer in JavaScript"
description: "How Doom's 2.5D rendering works, rebuilt in plain JavaScript on an HTML canvas: grid map, wall projection, clipping, movement, and collision."
date: 2025-12-24
updated: 2026-10-13
cover: ./cover.webp
coverAlt: "Screenshot of the 2.5D Doom-style renderer running in JavaScript"
tags: ["graphics", "game-dev", "web", "tutorial", "javascript", "doom", "2.5d"]
links:
  - label: "Full Source Code"
    url: "https://gist.github.com/ankushKun/653b7eeaf6d4279ef97f1ab6f709110a"
faq:
  - q: "Is Doom really 3D?"
    a: "No. Doom (1993) is a 2.5D engine. The map is a flat 2D layout of walls and sectors; the engine projects those walls as vertical columns on screen and uses floor and ceiling heights to fake depth. That is why you cannot look up or down in the original game, and why there are no rooms stacked on top of rooms."
  - q: "What is 2.5D rendering?"
    a: "2.5D rendering draws a 3D-looking scene from 2D data. Each wall is a line segment on a top-down map. The renderer transforms the wall's endpoints relative to the player, projects them onto the screen with a perspective divide, and fills the vertical span between the projected top and bottom. Distance determines wall height on screen, which is what makes it read as 3D."
  - q: "How is Doom's renderer different from Wolfenstein 3D's raycasting?"
    a: "Wolfenstein 3D casts one ray per screen column through a grid of equal-height cubes. Doom instead sorts wall segments front to back using a BSP tree (binary space partition) and draws each wall as a projected polygon, which allows walls at any angle, sectors with different floor and ceiling heights, and varied lighting. The renderer in this post is closer to Doom's approach: it transforms and projects whole wall segments, sorted by distance, rather than casting rays."
  - q: "Why build a Doom-style renderer in JavaScript instead of Three.js or WebGL?"
    a: "Because the point is to understand the math. Three.js hides projection, clipping and depth sorting behind a scene graph. Doing it by hand on a 2D canvas, with no dependencies, means every step from map coordinates to pixels is yours, and the whole engine fits in a few hundred lines you can read in one sitting."
  - q: "How do I make a Doom-style game of my own?"
    a: "Start from the renderer here or from the source gist, then add in this order: textures (sample a texture column instead of a flat colour per wall), sectors with different floor and ceiling heights, sprites for enemies and items (billboarded quads sorted with the walls), and finally a game loop with enemies, pickups and doors. If you want a shipped game rather than an engine, GZDoom or a modern engine with a retro shader gets you there faster."
---

<figure class="my-6">
  <div class="aspect-video w-full overflow-hidden">
    <iframe
      src="https://7jiiceni3iqjhaxe44sesz2qjd5q7m5l3kumbu2gzmoerv5ifi3a.arweave.net/-lCBEajaIJOC5OckSWdQSPsPs6vaqMDTRsscSNeoKjY?"
      title="DOOM-style renderer demo"
      class="h-full w-full border-0"
    ></iframe>
  </div>
  <figcaption>Interactive demo — click inside and move with WASD (<a href="https://7jiiceni3iqjhaxe44sesz2qjd5q7m5l3kumbu2gzmoerv5ifi3a.arweave.net/-lCBEajaIJOC5OckSWdQSPsPs6vaqMDTRsscSNeoKjY">open fullscreen</a>).</figcaption>
</figure>

While putting classic games onto my previous site, DOOM was at the top of the list. Instead of just embedding the original binary and moving on, I wanted to understand how the rendering trick actually worked — so I went down the rabbit hole (for the second time) and built a quirky DOOM-style renderer from scratch in plain HTML canvas with zero dependencies.

Turns out, classic games like **DOOM** didn't do real 3D at all. They used **2.5D rendering** — faking 3D with clever 2D math on hardware orders of magnitude weaker than whatever you're reading this on.

Here's how I built my own DOOM-style renderer from scratch. All you need is a code editor and a browser.

## How Doom rendering works, in one paragraph

Doom stores its world as a flat, top-down 2D map of walls. Each frame, the engine moves and rotates that map so the player sits at the origin looking down one axis, projects every wall's endpoints onto the screen with a perspective divide (farther walls get shorter), then fills the vertical strip between each wall's projected top and bottom, drawing far walls first so near walls paint over them. There is no z-buffer, no polygon mesh, and no real 3D camera. The whole illusion is distance turning into wall height. The rest of this post builds exactly that, step by step, on an HTML canvas.

## Is 3D actually 3D?

At its core, 3D rendering answers one question: **"If we have a 3D world and a camera, what does the camera see?"**

The pipeline boils down to defining the world (objects), placing the camera (viewer), projecting those 3D coordinates onto a flat 2D screen, and filling the screen with the resulting polygons.

```text
   3D World          Camera          2D Screen
  ┌─────────┐                      ┌─────────┐
  │ ▓▓▓     │     ────────────►    │   ▓▓    │
  │    ▓▓▓  │     (projection)     │  ▓▓▓▓   │
  │  ▓▓     │                      │   ▓▓    │
  └─────────┘                      └─────────┘
```

## Representing space with a top-down 2D map

The simplest way to define a world map is a **grid map** — a flat array where each cell is either a wall (`1`) or empty space (`0`).

> **Tip — Future scope:** You can replace `0` and `1` with an enum to support different wall textures, doors, or object types.

```javascript
const MAP_WIDTH = 11 // Number of rows
const MAP_HEIGHT = 17 // Number of columns
const TILE_SIZE = 25  // Size of each tile in world units
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

Viewed from above, it's just a flat floor plan:

```text
■■■■■■■■■■■
■         ■
■         ■
■   ■   ■ ■    ← Interior pillars
■         ■
■         ■
■■■■■■■■■■■
```

### Why 2D maps for 3D?

The world is fundamentally **2D with height**. X and Y define horizontal position, while height is a property of the wall rather than an arbitrary 3D mesh coordinate.

## Player state

The player (camera) is defined by three numbers: `x` and `y` in world space, plus `angle` for the direction they face.

```javascript
const Player = {
  x: 50,    // World X position
  y: 50,    // World Y position
  angle: 0, // Direction facing (0-359 degrees)
}
```

### Coordinate system

Angle `0°` looks toward positive Y (down on the map) and `90°` looks toward positive X (right on the map):

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

Precomputing a degree-to-radian table avoids repeating the conversion inside the render loop:

```javascript
const RAD = Math.PI / 180
const DEG_TO_RAD = Array.from({ length: 360 }, (_, i) => i * RAD)

// Instead of Math.sin(angle * Math.PI / 180):
// Math.sin(DEG_TO_RAD[angle])
```

## Transforming world to screen

The 3D illusion comes from two coordinate transforms.

### Step 1: Translate (move the world relative to the player)

First, shift everything so the player sits at `(0, 0)` by subtracting the player's position from each wall endpoint. Instead of moving the camera, we move the entire world around the camera.

```javascript
const relX = wallX - Player.x
const relY = wallY - Player.y
```

### Step 2: Rotate (align the world with the player's view)

Next, rotate those relative coordinates by the player's viewing angle:

```javascript
const ps = Math.sin(DEG_TO_RAD[Player.angle])
const pc = Math.cos(DEG_TO_RAD[Player.angle])

const tx = relX * pc + relY * ps   // Left/right offset from center of view
const ty = relY * pc - relX * ps   // Forward depth (distance in front of player)
```

`tx` tells you how far left or right a point sits from the center of the view; `ty` is its **depth** in front of you.

## Projecting 3D data onto a 2D screen

Farther objects should look smaller. Mathematically, that's a perspective divide by depth (`ty`):

```javascript
const fov = 90 // Field of view scalar

// Horizontal screen coordinate, shifted so 0 sits at center
const screenX = (tx * fov / ty) + (screen.width / 2)

// Projected wall height on screen
const screenHeight = (WALL_HEIGHT * fov / ty)
```

## Projecting walls

Each wall segment needs four projected screen corners: top-left, top-right, bottom-left, and bottom-right.

```javascript
function project(x, y, z) {
  // z is vertical height (0 for floor, WALL_HEIGHT for ceiling)
  // ... translation and rotation ...

  const screenX = (tx * fov / ty) + (screen.width / 2)
  const screenY = (z * fov / ty) + (screen.height / 2)

  return { x: screenX, y: screenY }
}
```

Project both endpoints at floor and ceiling height, then draw the filled quad with `ctx.beginPath()` and `ctx.fill()`.

## Sorting and drawing walls

Drawing walls in arbitrary order lets distant walls paint over near ones. We sort walls far-to-near before drawing — **the Painter's Algorithm**:

```javascript
function draw3D() {
  const wallsWithDistance = walls.map(wall => {
    const dist1 = dx1 * dx1 + dy1 * dy1
    const dist2 = dx2 * dx2 + dy2 * dy2

    // Weighted distance across endpoints and midpoint
    return { wall, distance: weightedDist }
  })

  wallsWithDistance.sort((a, b) => b.distance - a.distance)
  wallsWithDistance.forEach(item => drawWall(item.wall))
}
```

### Why weighted distance?

Sorting purely by closest endpoint breaks on angled walls. Weighting the closest endpoint, midpoint, and farthest endpoint resolves most occlusion edge cases cleanly on a grid map.

## Clipping: handling walls behind the camera

### The problem

If one endpoint of a wall sits behind the camera (`ty <= 0`), dividing by `ty` flips signs or divides by zero, tearing the polygon across the screen.

### Near-plane clipping

Clamp any endpoint behind the **near plane** onto the plane by linear interpolation along the wall segment:

```javascript
const NEAR_PLANE = 1

if (cy1 < NEAR_PLANE) {
  const t = (NEAR_PLANE - cy1) / (cy2 - cy1)
  cx1 = cx1 + t * (cx2 - cx1)
  cy1 = NEAR_PLANE
}
```

### Screen-space clipping

Clipping segments that extend past the left or right viewport edges prevents wasted overdraw:

```javascript
if (sx1 < 0) {
  const t = (0 - sx1) / (sx2 - sx1)
  wallTop1 = wallTop1 + t * (wallTop2 - wallTop1)
  wallBot1 = wallBot1 + t * (wallBot2 - wallBot1)
  sx1 = 0
}
```

## Movement & controls

### WASD movement

Movement vectors follow the player's facing angle and get normalized so diagonal strafing isn't faster:

```javascript
function movePlayer() {
  const dx = -Math.sin(DEG_TO_RAD[Player.angle]) * MOVE_SPEED
  const dy = Math.cos(DEG_TO_RAD[Player.angle]) * MOVE_SPEED

  // ... accumulate moveX, moveY from keys ...

  const magnitude = Math.sqrt(moveX ** 2 + moveY ** 2)
  if (magnitude > 0) {
    moveX = (moveX / magnitude) * MOVE_SPEED
    moveY = (moveY / magnitude) * MOVE_SPEED
  }
}
```

### Mouse look with Pointer Lock

The browser **Pointer Lock API** hides the cursor and feeds raw `movementX` deltas for FPS turning:

```javascript
document.addEventListener("mousemove", (event) => {
  if (!isMouseLocked) return

  const degreeChange = (event.movementX / screen.width) * 360
  Player.angle -= degreeChange
})
```

## Wall collision detection

Because the world is a grid, collision is a tile lookup with a small player radius and axis-separated sliding so you glide smoothly along walls instead of sticking:

```javascript
function isWall(worldX, worldY) {
  const tileX = Math.floor(worldX / TILE_SIZE)
  const tileY = Math.floor(worldY / TILE_SIZE)
  return getMapTile(tileX, tileY) === 1
}
```

## Putting it all together

Each tick clears the frame, updates movement, sorts and draws the visible walls, and optionally draws the 2D debug minimap:

```javascript
function loop() {
  clearScreen()
  movePlayer()
  draw3D()
  debug()
}

setInterval(loop, 1000 / 30)
```

## What next?

This covers the projection core; classic DOOM layers on texture mapping, billboard sprites, variable-height sectors, lighting, enemies, and weapons. Feel free to grab the [full source gist](https://gist.github.com/ankushKun/653b7eeaf6d4279ef97f1ab6f709110a) and extend it.

## Doom vs Wolfenstein 3D vs this renderer

People often ask how this compares to the raycasters most tutorials build:

| | Wolfenstein 3D (1992) | Doom (1993) | This post |
| --- | --- | --- | --- |
| Map | Grid of equal cubes | Sectors and linedefs, any angle | Grid of cubes |
| Visibility | One ray per screen column | BSP tree, walls sorted front to back | Walls sorted by weighted distance, far to near |
| Floor and ceiling heights | Fixed | Per sector | Fixed |
| Drawing unit | Vertical column per ray | Vertical column per wall segment | Filled polygon per wall face |
| Look up and down | No | No (y-shearing in ports) | No |

Wall-projection transforms, clips, and fills whole wall quads rather than casting per-column rays — closer to how Doom thinks about geometry, paired with Wolfenstein's grid map to keep the code compact.

## References

- [DOOM Wiki: Rendering Engine](https://doomwiki.org/wiki/Rendering_engine)
- [Let's program DOOM by 3DSage](https://www.youtube.com/watch?v=huMO4VQEwPc)
