---
tags: [render, threejs, performance]
updated: 2026-07-08
source-files:
  - src/render/renderer.ts
  - src/render/effects.ts
  - src/render/textures.ts
  - src/render/theme.ts
  - DESIGN.md
---

# Rendering — three.js renderer

`src/render/` draws the [[sim-engine|sim state]] and animates cosmetic effects
from [[architecture|SimEvents]]. The renderer never mutates the sim; it is a pure
consumer. Public API (`GameRenderer`, `src/render/renderer.ts`): `setMap`,
`render(state, dt, events?)`, `pickHex`, `setHover`, `showRange/hideRange`,
`resize`, `dispose`.

> **Style: bold crayon-primary "toy box" look** (restyle landed 2026-07-07). The
> palette in `src/render/theme.ts` is now saturated crayon primaries (bright sky
> blue, saturated grass green build tiles, bold yellow paths, red spawn pads, blue
> home). Enemies are one strong primary each: Bloop bold blue, Zippy yellow,
> Shelly green, Chonk purple. Tower accents red/blue/orange/yellow/purple. Shapes
> are **big and chunky** (Duplo/Toca-Boca proportions) and **bouncy** (see hop &
> pop animations below), and the camera is **zoomed in past fit and pannable**.
> `DESIGN.md`'s Theme paragraph still says "pastel" — stale, tracked in [[lint]] L5.

## Instancing strategy (the perf core)

Target: 60fps on mid phones. Everything drawn in bulk is an `InstancedMesh`:

- **Terrain** — one `InstancedMesh` of a 6-sided cylinder ("hex prism", rotated
  30° so it reads flat-top), one instance per map cell. Per-instance color with a
  small jitter (`jitterColor`). Built once per map in `setMap`.
- **Enemies** — one `InstancedMesh` **per kind** (`ENEMY_CAP = 256` each): cube
  (regular, box 0.95), tetrahedron (fast, 0.75), octahedron (shield, 0.8),
  icosahedron (boss, 1.5) — **big chunky toy proportions** (~1.7× the original
  sizes; neighbor overlap is intentional). Each frame `updateEnemies` writes
  per-instance matrices (hop position, squash-and-stretch, spawn boing, HP-scaled
  size) and sets `mesh.count`. Animation details below.
- **Shield bubbles** — a shared instanced translucent sphere, one per live Shelly
  with shield, scaled by remaining shield fraction.
- **Health bars** — two `InstancedMesh` planes (dark backdrop + colored fill,
  `renderOrder` 998/999, `depthTest` off) shown over **every enemy below full
  hp** (added 2026-07-08). Billboarded by copying the camera quaternion into the
  instance matrix each frame. The fill plane's geometry is translated so its
  origin is the **left edge**; per instance it is positioned half a bar-width
  left along the billboard's local x and `scale.x = hpFrac × width`, so the bar
  drains rightward. Fill color lerps green→red via `setColorAt`
  (`setRGB(1 − f·0.7, 0.4 + f·0.5, 0.35)`). Bar width is `radius × 1.15`
  (boss: 1.9, raised higher). This replaced the old boss-only `THREE.Group`
  hp-bar pool.

Towers are **not** instanced — they're small `THREE.Group`s of primitives rebuilt
only when the tower set/levels change (guarded by `towerHashOf`, a hash of
`id:kind:dmgLevel:spdLevel`). Fat rounded Duplo-ish bases; each kind has a distinct
chunky silhouette (doom gets a spinning-glow orb + halo). Upgrade level shows as
chunky stacked rings around the base.

## Animation: hop, boing, recoil

All animation is derived from `state.time` and event timings — the sim stays
untouched. Driven in `updateEnemies` / `updateTowers`, with cosmetic timings
recorded by `consumeStyleEvents` from the same `SimEvent[]` the effects use.

- **Squash-and-stretch hop.** Each enemy kind has a `hopFreq` and `hopHeight`.
  `hop = |sin(time·hopFreq + id·1.7)|` (0 at ground, 1 at apex) lifts the body by
  `hopHeight·hop`; it **squashes low and stretches tall** (`stretch =
  (hop−0.45)·0.4`, applied as `scaleY = 1+stretch`, `scaleXZ = 1−0.55·stretch`).
  Per kind: regular 6.5/0.28, fast **10/0.36** (quickest, springiest), shield
  5.5/0.22, boss **3.2/0.3** (slow lumber). The face still gets a gentle yaw
  wobble so the googly eyes stay camera-facing.
- **Spawn boing.** On a `spawn` event, `consumeStyleEvents` records the sim time in
  `spawnAt`; for the next 0.5s the enemy scales in with an **easeOutBack**
  overshoot (~1.1 then settle) via `boingScale`. Cleared on `die`/`leak`.
- **Tower recoil pop.** On a `shot` event (or an `aoe` event, whose tower id is
  resolved to the **nearest same-kind tower** in range, since `aoe` carries no
  `towerId`), `fireAt` records the time; for 0.22s the tower group does a
  **squat-and-spring** (`scaleXZ` +0.16, `scaleY` −0.2, decaying as `k²`). A steady
  idle pulse (`±0.08` at 2.2Hz) glows tower orbs/crystals regardless of firing.

## Effects pooling (`src/render/effects.ts`)

The sim is **hitscan**; all projectiles are pure eye-candy driven by events. The
`Effects` class pre-allocates fixed pools and recycles them — **zero per-frame
allocation** on the hot path. Pools:

- **sparks** (48) — short tracer dots for `shot` events.
- **bolts** (24) — stretched boxes for lightning `chain` events.
- **rings** (28) — flat expanding rings for `aoe` events, deaths, and `leak`
  flashes at the home.
- **confetti** (200) — a big celebratory sprite burst on `die` (16 chunky bits,
  scale 0.30–0.52, with gravity/bounce), in the crayon-primary `CONFETTI` palette.

`consume(events, towerPos, enemyPos, homePos)` turns one tick's events into
effects; ids are resolved to positions at consume time and **missing ids are
skipped gracefully** (a target may have died the same tick). Because `main.ts` may
run 1–2 sim steps per frame, it passes the **concatenated** events of all steps to
`render()`, which forwards them to `effects.consume`.

## Camera & picking

- **Fixed viewing angle, auto-fit then zoom in.** `frameCamera` sets a fixed
  elevation (~52°) and **binary-searches the camera distance** that keeps the map's
  AABB corners inside the NDC viewport (0.94 margin) — a numeric corner-fit that
  frames long/diagonal maps far better than a bounding-sphere estimate. It then
  **zooms in past that fit**: `camDist = fit · zoomIn` with `zoomIn = 0.6`, i.e.
  the camera sits ~1.67× closer than the exact fit so hexes are big and tappable.
  The map may overflow the viewport — the player **pans** to reach the edges. Fog
  near/far are derived from `camDist`.
- **Panning (public API `panBy` / `resetPan`).** The camera target is
  `baseTarget` (map center) `+ panOffset`. `panBy(dxPx, dyPx)` converts a
  screen-pixel drag to world units (`worldPerPx` from fov × `camDist`; the
  screen-y term is foreshortened by `/sin(elevation)`), moves the target
  **opposite** the finger (drag-the-map feel), and **clamps** `panOffset` so the
  target never leaves the map footprint (±half-extent per axis) — the map can't be
  lost off-screen. `applyCamera` repositions from target+pan. `resetPan` zeroes the
  offset; `setMap` and `main.ts`'s `enterGame` reset it on every new game. Wiring
  (drag-vs-tap threshold) is in [[ui-flow]].
- **Picking** (`pickHex`) raycasts the pointer against the ground plane (`y=0`),
  inverts `hexToWorld` (`q = x/1.5`, `r = z/√3 − q/2`), and `axialRound`s to the
  nearest hex; returns it only if that cell exists on the map.
- **Hover/range** (`setHover`, `showRange`) recolor the hovered terrain instance
  (green valid / red invalid) and show a translucent range disc. Wired from the UI
  during placement; see [[ui-flow]].

## Lighting & materials

`MeshLambertMaterial` throughout, one `AmbientLight` (0.85) + one
`DirectionalLight` (1.15), **no shadows** (mobile budget). `pixelRatio` capped at
2; antialias enabled only when `devicePixelRatio <= 1.5` (i.e. off on high-DPI
phones, on for desktop) — matching the DESIGN.md mobile targets.

## The black-enemy bug postmortem

Enemies once rendered as **dark/black silhouettes** at unlucky lighting angles
(the cute baked face invisible). Root cause: a plain Lambert body only reflects
what the single directional light gives it, so facets angled away from the sun
went nearly black. **Fix (in `buildEnemyMesh`):** give each enemy material an
`emissiveMap` set to the *same* baked face texture, with `emissive: 0xffffff` and
`emissiveIntensity: 0.55`. The body now self-lights — it reads as a bright primary
with a visible face regardless of lighting angle, and can never go black. The face
texture itself (`src/render/textures.ts`, `makeFaceTexture`) is a canvas-baked
googly-eyed smile; mipmaps are disabled with linear filtering to keep it crisp at
small on-screen sizes. This fix shipped in commit `43d942e` ("self-lit enemy
faces"). See [[decisions]].

## Decoration & teardown

`blocked` cells host low-poly trees/rocks; `home` cells get a tiny house
(box + cone roof + door). `dispose`/`clearTerrain`/`clearTowers` walk groups and
dispose geometries/materials/textures — important because `setMap` rebuilds
terrain on every new game.
</content>
