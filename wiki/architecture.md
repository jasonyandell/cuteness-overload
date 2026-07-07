---
tags: [architecture, layering, determinism]
updated: 2026-07-07
source-files:
  - DESIGN.md
  - src/sim/types.ts
  - src/sim/engine.ts
  - src/sim/rng.ts
  - src/main.ts
  - src/ui/automation.ts
---

# Architecture — layering & determinism

The whole project hinges on **one pure deterministic simulation** that runs in
three hosts unchanged: the browser (play), Node/tsx (headless [[ai-tester|balance]]),
and a real headless browser (remote play). Everything else is a thin skin.

## The layers

```
 src/sim/     PURE deterministic sim. No DOM, no Date, no Math.random.
   |          Plain data + pure functions. THE contract.
   v
 src/render/  three.js renderer. Reads GameState, draws it, consumes events.
 src/ui/      DOM HUD, menus, save/load, window.__game automation surface.
 src/main.ts  Game loop: accumulate real dt, run step() N times, render.
   |
 scripts/     Headless drivers that import src/sim directly (ai-play, balance)
              or drive the deployed site through window.__game (remote-play).
```

Ownership boundaries are spelled out in [DESIGN.md](../DESIGN.md). The sim's
public API is documented at the bottom of `src/sim/types.ts`.

## Rule 1: `src/sim/` is pure

`src/sim/` must contain **no DOM, no `Date`, no `Math.random`**. Time only
advances through `step()`; randomness only comes from the seeded RNG in
`src/sim/rng.ts`. This purity is what lets the exact same code produce the exact
same game in Node and in the browser. See [[sim-engine]] for step internals.

## Rule 2: fixed timestep

`TICK = 1/30` s (`src/sim/constants.ts`). `step(state, map)` always advances
**exactly one tick** and mutates `state` in place. It is never given a variable
dt. Speed control is "run `step()` more times per frame," never "change TICK":

- `src/main.ts` accumulates real elapsed time × speed multiplier into `this.acc`,
  then runs `step()` while `acc >= TICK` (capped at 8 steps/frame to avoid a
  spiral of death; leftover backlog is dropped).
- **2× speed = two `step()` calls per accumulated tick.** Nothing else changes.

## Rule 3: seeded, serializable RNG

`src/sim/rng.ts` is **mulberry32** — a one-uint32-state PRNG. The state lives on
`GameState.rngState` (seeded from `seed | 0` in `createGame`). Because the entire
RNG state is a single serializable integer, saving and resuming a game is exact:
the RNG picks up precisely where it left off. `rngNext(state)` advances the state
and returns a float in `[0,1)`. See [[decisions]] for why mulberry32.

## Rule 4: whole state is plain JSON

`GameState` (`src/sim/types.ts`) is a plain object of primitives and arrays —
no class instances, no functions, no `Map`/`Set` stored on it. So:

- **Save/resume = `JSON.stringify`/`parse`** to localStorage. See [[ui-flow]].
- Remote automation polls state with `JSON.parse(JSON.stringify(__game.state))`.
- Derived, non-serialized caches (path polyline geometry, terrain lookup maps)
  are rebuilt lazily from `mapId` inside `engine.ts` (`geomCache`, `cellCache`,
  keyed by `map.id`), so a resumed game reconstructs them on first `step()`.

## Rule 5: hitscan sim, cosmetic projectiles

Damage is applied **instantly at fire time** (hitscan) inside `step()`. There are
no projectile entities in the sim. The renderer animates tracers/bolts/rings
**cosmetically** from the `SimEvent[]` the sim emits. This keeps the sim cheap and
fully deterministic regardless of frame rate. See [[sim-engine]] and [[rendering]].

## The event system

Each `step()` overwrites `state.events` with the `SimEvent`s produced that tick
(`shot`, `chain`, `aoe`, `die`, `leak`, `spawn`, `wave`, `won`, `lost` — full
union in `src/sim/types.ts`). Events are the **one-way channel from sim to
skins**: the renderer consumes them for effects, the UI reads `wave`/`won`/`lost`
for toasts and overlays. Because `main.ts` may run several steps per frame, it
concatenates each step's events and passes the combined array to
`renderer.render(state, dt, events)`.

## Why this enables headless balance + remote play

Because the sim is pure, deterministic, and JSON-serializable:

- **Headless balance** (`scripts/ai-play.ts`, `scripts/balance.ts`) imports
  `src/sim` directly and runs thousands of ticks in milliseconds with no browser.
- **Remote play** (`scripts/remote-play.ts`) drives the *deployed* site through
  the `window.__game` surface (`src/ui/automation.ts`), polling JSON state and
  issuing place/upgrade/skip actions — the same policy as the headless AI, just
  executed against the live page. See [[ai-tester]].

The automation surface is installed in `src/main.ts` and typed in
`src/ui/automation.ts`: `window.__game = { state, actions }`.
</content>
