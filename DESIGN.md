# Cuteness Overload — architecture contract

Hexagonal-grid 3D tower defense. Cute geometric enemies march set paths to destroy your home; you defend with 5 towers. 20 waves (boss on 10 & 20), optional endless. Title: **Cuteness Overload**.

## Layers & file ownership
- `src/sim/` — pure deterministic sim. NO DOM, no Math.random (use `rng.ts`), no Date. Fixed timestep `TICK=1/30`. Runs headless in Node (AI tester) and in browser.
  - `types.ts`, `constants.ts`, `hex.ts`, `rng.ts` — DONE, the contract. Read them fully.
  - `engine.ts` — createGame/step/placeTower/upgradeTower/sellTower/skipWave/canPlace/upgradeCost/startEndless (API doc at bottom of types.ts).
  - `waves.ts` — `waveComposition(wave: number): { kind: EnemyKind; count: number }[]` + spawn scheduling helpers. Typical distribution: regulars always; fast from wave 3; shield from wave 5; boss waves 10 & 20 (boss + escort). Endless: continue scaling past 20.
  - `maps.ts` — `MAPS: MapDef[]` (3 maps).
- `src/render/renderer.ts` — three.js. Class `GameRenderer`:
  - `constructor(canvas: HTMLCanvasElement)`
  - `setMap(map: MapDef): void` — builds hex terrain, path ribbon, home
  - `render(state: GameState, dt: number): void` — draw current state; consume `state.events` for effects (shots, chains, aoe rings, deaths, leaks)
  - `pickHex(clientX: number, clientY: number): {q,r} | null` — raycast to hex under pointer
  - `setHover(hex: {q,r}|null, valid: boolean): void` — placement highlight
  - `showRange(x: number, z: number, range: number): void` / `hideRange(): void`
  - `resize(): void`, `dispose(): void`
- `src/ui/` + `src/main.ts` + `index.html` — DOM UI, game loop (requestAnimationFrame, accumulate real dt, run `step()` 1 or 2× per tick budget based on speed toggle), menus, HUD, save/load.

## Game rules (already encoded in constants.ts — read it)
- Waves auto-call every 25s. **Skip button** calls the next wave immediately and pays a bonus proportional to time remaining; the previous wave need not be dead (waves overlap).
- Wave income ("wage") paid on each wave call. Kills pay bounty.
- Upgrades: damage & attack speed, 5 levels each, per tower. Sell refunds 70%.
- Lose life per leak (boss = 5). 0 lives = lost. Survive wave 20 (all dead, queue empty) = won → offer endless.
- Shield enemies: shield pool absorbs damage first, regenerates after 2.5s unhit.
- Freeze slows (splash pulse), cannon splashes, lightning chains (falloff), doom = huge AoE, slow-firing (no slow effect — freeze owns slows).
- Hits are **instant (hitscan)** in sim at fire time; renderer animates projectiles cosmetically from events.

## Determinism & save
- Whole `GameState` is plain JSON — save/resume = `JSON.stringify` to localStorage key `cuteness-overload-save-v1` (plus separate `cuteness-overload-meta-v1` for map unlocks/settings if needed). Rebuild derived data (path geoms) on load from `mapId`.
- 2× speed = run `step()` twice per accumulated TICK; never change TICK.

## Maps (3, balanced via AI)
Format: `MapDef` in types.ts. ~11×9 hexes. Map 1 "Meadow Lane": single snaking path, easiest (incomeMul 1.0, hpMul 1.0). Map 2 "Twisty Creek": longer path but tighter build space. Map 3 "Double Trouble": two paths sharing the home, hardest. Every path hex must be adjacent (hexDist 1) to its neighbors; first = spawn cell terrain 'spawn', last = 'home'. Build cells surround the path generously but not uniformly.

## AI tester (`scripts/ai-play.ts`)
Headless Node (tsx). Simple "saver" strategy: greedy but patient — maintains a shopping list (next tower or next upgrade by simple priority), only buys when affordable, skips waves when total enemy hp on field is low relative to estimated DPS. It should WIN by saving for big purchases; a naive "spend immediately on plinkers" baseline should LOSE around wave 10-14. `scripts/balance.ts` runs both strategies across all 3 maps × several seeds and prints a table.

## Theme
Kid-toy bold: crayon primary colors (Duplo/Toca Boca), big chunky shapes, squash-and-stretch bounce everywhere. Enemies are cute 3D primitives (cube=Bloop, tetrahedron=Zippy, octahedron=Shelly w/ shield bubble, big icosahedron=Chonk) with googly-eye texture/sprites if cheap. Home is a tiny house. Low-poly, bright, MeshLambert/Toon, one directional + ambient light, no shadows on mobile (or cheap blob shadows). Target 60fps on mid phones: instanced meshes for hexes & enemies, pooled effect sprites, pixelRatio capped at 2, antialias off on small screens.
