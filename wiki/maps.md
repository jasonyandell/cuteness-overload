---
tags: [sim, maps, balance]
updated: 2026-07-07
source-files:
  - src/sim/maps.ts
  - scripts/validate-maps.ts
  - src/sim/hex.ts
  - src/sim/types.ts
---

# Maps — the 3 battlefields

Defined in `MAPS` (`src/sim/maps.ts`), built from a compact **direction-step**
DSL: `walk(start, dirs)` steps a hex path one flat-top neighbor at a time (dirs
`N/NE/SE/S/SW/NW`), guaranteeing every consecutive pair is `hexDist === 1`.
`makeMap` then assigns terrain (first hex `spawn`, last `home`, middle `path`) and
generates `build` cells within `maxBuildDist` of the path. Structural invariants
are asserted by `scripts/validate-maps.ts`.

## Stats (measured by validate-maps, 2026-07-07)

| Map | id | Paths | Path hexes | World length | Build cells | Blocked | Total cells | incomeMul | hpMul | maxBuildDist |
|---|---|---|---|---|---|---|---|---|---|---|
| Meadow Lane | `meadow` | 1 | 21 | 34.64 | 87 | 4 | 112 | 1.0 | 1.0 | 2 |
| Twisty Creek | `creek` | 1 | 27 | 45.03 | 49 | 0 | 76 | 1.0 | 1.15 | 1 |
| Double Trouble | `double` | 2 | 25 (14+11) | 39.84 (22.5 + 17.3) | 83 | 2 | 109 | 1.8 | 1.1 | 2 |

`incomeMul` and `hpMul` are the two difficulty knobs on `MapDef` (see
[[waves-economy]] and [[enemies]] for how they feed scaling).

## Map roles

**Meadow Lane** — the tutorial. One long (34.6u) snaking path with a fat 87-cell
build field (`maxBuildDist 2`) and baseline economy/HP. Great coverage, room to
recover from mistakes. The [[ai-tester|saver]] coasts to ~9 lives, only sweating
the wave-20 bosses. `incomeMul 1.0 / hpMul 1.0`.

**Twisty Creek** — a notch harder. The **longest** path (45.0u) but the tightest
build space (`maxBuildDist 1` → only 49 pocketed cells) and `hpMul 1.15`. Every
slot matters; you can't spam coverage. Saver lands ~8 lives. `incomeMul 1.0 /
hpMul 1.15`.

**Double Trouble** — the hardest. **Two lanes** (`doublePathA` 14 hexes/22.5u,
`doublePathB` 11 hexes/17.3u) converging on one shared `home` hex `{q:10, r:3}`.
Enemies alternate lanes (`i % nPaths` in `callWave`), so your fire is split two
ways. See the balance story below. `incomeMul 1.8 / hpMul 1.1`.

## The Double Trouble balance story

Double was **genuinely unwinnable** at its original constants, and the fix is a
good worked example of the [[ai-tester]] methodology finding a *structural* (not
just numeric) problem:

- **The short-lane problem.** Path B is only **17.3** world units (vs Meadow's
  34.6). A boss on the short lane reaches home in ~30s and the defense can't
  concentrate enough fire in time. Verified structural, not build quality: on a
  losing Double run and a winning Meadow run the saver fielded the *same* ~12
  towers with the same composition. Even dropping `hpMul` all the way to 1.0
  (Meadow's value) still lost at wave 19 — the short lane, not raw HP, was the
  wall.
- **Why not lower `HP_GROWTH` globally?** It makes Double winnable but also lets
  the plinker-spammer win Meadow/Creek — it erases the saver-vs-spender gap the
  whole game is built on. Rejected.
- **The surgical fix (now in code):** keep Double the tankiest-*reading* map but
  pay for the second front.
  - `hpMul: 1.2 → 1.1` (still the highest single-lane… i.e. still reads hardest).
  - `incomeMul: 1.1 → 1.8` — "two lanes of trouble, double the bounty." The extra
    money lets you afford defending both lanes. It does **not** rescue the
    spender: under 1.8× income it fields ~83 plinkers and still leaks out at wave
    17 — the point being that quantity of cheap towers can't do what a few premium
    splash/nuke towers do.

Result: Double now wins 5/5 (saver, min 6 lives) and is the tightest of the three.
Full table in [[balance]].

## Terrain & build-cell generation

`makeMap` marks path terrains first, then adds every non-path hex within
`maxBuildDist` (hexDist) of some path hex as `build`, minus explicit `blocked`
hexes (which host decorative trees/rocks in the [[rendering|renderer]]). A shared
`home` hex (Double's converging lanes) is emitted exactly once as `home`.
`validate-maps.ts` enforces: adjacency, one spawn per path, ≥8 build cells, every
path hex reachable by a min-range (2.6u) tower, ≥90% of build cells within
hexDist 2 of a path, and total cell count 70–140 (mobile budget).

## Adding a map

Add a `walk(...)` path (or paths) and a `makeMap(...)` entry to `MAPS`, then run
`npx tsx scripts/validate-maps.ts` to check invariants and
`npx tsx scripts/balance.ts` to confirm the saver-wins / spender-loses targets
still hold. Update this page and [[balance]], and follow the INGEST workflow in
[[SCHEMA]].
</content>
