+++
date = '2025-12-24'
lastmod = '2026-10-13'
draft = false
title = "How Doom Rendering Works: A 2.5D Renderer in JavaScript"
description = "How Doom's 2.5D rendering works, rebuilt in plain JavaScript on an HTML canvas: a grid map, wall projection, clipping, movement and collision. Live demo and full source."
summary = "Ever wondered how DOOM drew a 3D world on a 1993 PC? It didn't do 3D at all. This post rebuilds the trick, 2.5D rendering, from scratch in JavaScript on a canvas, with a playable demo and the full source."
tags = ["graphics", "game-dev", "web", "tutorial", "javascript", "doom", "2.5d"]
faq = [
  { q = "Is Doom really 3D?", a = "No. Doom (1993) is a 2.5D engine. The map is a flat 2D layout of walls and sectors; the engine projects those walls as vertical columns on screen and uses floor and ceiling heights to fake depth. That is why you cannot look up or down in the original game, and why there are no rooms stacked on top of rooms." },
  { q = "What is 2.5D rendering?", a = "2.5D rendering draws a 3D-looking scene from 2D data. Each wall is a line segment on a top-down map. The renderer transforms the wall's endpoints relative to the player, projects them onto the screen with a perspective divide, and fills the vertical span between the projected top and bottom. Distance determines wall height on screen, which is what makes it read as 3D." },
  { q = "How is Doom's renderer different from Wolfenstein 3D's raycasting?", a = "Wolfenstein 3D casts one ray per screen column through a grid of equal-height cubes. Doom instead sorts wall segments front to back using a BSP tree (binary space partition) and draws each wall as a projected polygon, which allows walls at any angle, sectors with different floor and ceiling heights, and varied lighting. The renderer in this post is closer to Doom's approach: it transforms and projects whole wall segments, sorted by distance, rather than casting rays." },
  { q = "Why build a Doom-style renderer in JavaScript instead of Three.js or WebGL?", a = "Because the point is to understand the math. Three.js hides projection, clipping and depth sorting behind a scene graph. Doing it by hand on a 2D canvas, with no dependencies, means every step from map coordinates to pixels is yours, and the whole engine fits in a few hundred lines you can read in one sitting." },
  { q = "How do I make a Doom-style game of my own?", a = "Start from the renderer here or from the source gist, then add in this order: textures (sample a texture column instead of a flat colour per wall), sectors with different floor and ceiling heights, sprites for enemies and items (billboarded quads sorted with the walls), and finally a game loop with enemies, pickups and doors. If you want a shipped game rather than an engine, GZDoom or a modern engine with a retro shader gets you there faster." },
]
og_image = "/media/doom-renderer-og.jpg"
# The playable demo opens the post, so the social card is not repeated above it
cover = false
author = 'Ankush'
links = [
  { label = "Full Source Code", url = "https://gist.github.com/ankushKun/653b7eeaf6d4279ef97f1ab6f709110a", icon = "code" },
]
+++

{{< demo src="https://7jiiceni3iqjhaxe44sesz2qjd5q7m5l3kumbu2gzmoerv5ifi3a.arweave.net/-lCBEajaIJOC5OckSWdQSPsPs6vaqMDTRsscSNeoKjY?" title="DOOM-style renderer demo" caption="Move with WASD" >}}

Recently I have been adding games to my portfolio and DOOM is one of them. But instead of just embedding the original game, I wanted to understand how it actually worked. So I went down the rabbit hole (a second time) and built a more whacky version of the doom renderer from scratch and in HTML canvas, no extra dependencies.

Turns out, classic games like **DOOM** didn't do real 3D at all. They used something called **2.5D rendering**,  basically faking 3D with clever 2D math. And it ran on hardware way worse (100x or more times worse) than what you are reading this on.

Today I'll break down how I built my own DOOM-style renderer. No fancy tools required, just a code editor and a web browser.

## How Doom rendering works, in one paragraph

Doom stores its world as a flat, top-down 2D map of walls. Each frame, the engine moves and rotates that map so the player sits at the origin looking down one axis, projects every wall's endpoints onto the screen with a perspective divide (farther walls get shorter), then fills the vertical strip between each wall's projected top and bottom, drawing far walls first so near walls paint over them. There is no z-buffer, no polygon mesh and no real 3D camera. The whole illusion is distance turning into wall height. The rest of this post builds exactly that, step by step, on an HTML canvas.


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

> [!TIP] Future Scope
> we can implement an `enum` and use different types of walls or place objects with different number instead of just 0 and 1.

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

## Doom vs Wolfenstein 3D vs this renderer

People keep asking how this compares to the raycasters most tutorials teach, so here is the short version.

| | Wolfenstein 3D (1992) | Doom (1993) | This post |
|---|---|---|---|
| Map | Grid of equal cubes | Sectors and linedefs, any angle | Grid of cubes |
| Visibility | One ray per screen column | BSP tree, walls sorted front to back | Walls sorted by weighted distance, far to near |
| Floor and ceiling heights | Fixed | Per sector | Fixed |
| Drawing unit | Vertical column per ray | Vertical column per wall segment | Filled polygon per wall face |
| Look up and down | No | No (y-shearing in ports) | No |

The approach here is wall-projection rather than raycasting: each wall face is transformed, clipped and drawn as a quad, which is closer to how Doom thinks about walls, with Wolfenstein's simple grid map so the code stays short.


## References

- [DOOM Wiki: Rendering Engine](https://doomwiki.org/wiki/Rendering_engine)
- [Let's program DOOM by 3DSage](https://www.youtube.com/watch?v=huMO4VQEwPc)