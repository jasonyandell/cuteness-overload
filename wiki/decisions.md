---
tags: [decisions, adr, rationale]
updated: 2026-07-08
source-files:
  - src/sim/engine.ts
  - src/sim/rng.ts
  - src/sim/types.ts
  - src/sim/hex.ts
  - src/sim/constants.ts
  - src/render/renderer.ts
  - DESIGN.md
---

# Decisions (ADR-style)

The load-bearing design decisions, with rationale. Each is cross-linked to the
page that documents its mechanics.

## D1 — Hitscan sim, cosmetic projectiles

**Decision:** damage is applied instantly at fire time inside `step()`; no
projectile entities exist in the sim. The [[rendering|renderer]] animates
tracers/bolts cosmetically from `SimEvent`s.
**Why:** keeps the sim cheap and fully deterministic regardless of frame rate — no
in-flight projectiles to advance, no travel-time to desync headless vs browser. It
also decouples visual polish from correctness. Trade-off: no dodging/interception
mechanics, and effects must resolve ids to positions defensively (a target may die
the same tick). See [[sim-engine]], [[architecture]] Rule 5.

## D2 — Mutable state + plain-JSON saves

**Decision:** `step(state, map)` mutates `GameState` in place; `GameState` is plain
JSON (no classes/functions/Maps stored on it). Save = `JSON.stringify`.
**Why:** trivial exact save/resume, trivial state polling for
[[ai-tester|automation]], and no serialization layer to maintain. Derived caches
(path geoms, cell lookup) are rebuilt lazily from `mapId` and never stored on
state. Trade-off: mutation means no free undo/time-travel; callers must not alias
state. JSON-safety forced small choices like `NEVER = -1e9` instead of `-Infinity`.
See [[architecture]] Rule 4, [[sim-engine]].

## D3 — mulberry32 seeded RNG

**Decision:** randomness is a single-uint32-state PRNG (`src/sim/rng.ts`), with the
state living on `GameState.rngState`.
**Why:** the entire RNG state is one serializable integer, so resume is exact and
replays are reproducible. Fast, tiny, dependency-free, good enough distribution for
spawn jitter. Trade-off: not cryptographic (irrelevant here). See [[architecture]]
Rule 3.

## D4 — Fixed timestep, speed = more steps

**Decision:** `TICK = 1/30`s, never varied. `step()` always advances exactly one
tick. Speed toggle runs `step()` more times per frame (2× = twice/tick).
**Why:** deterministic and identical across hosts; the browser can never produce a
different game than the headless sim due to frame-rate. Trade-off: a step cap
(8/frame in `main.ts`) and dropped backlog to avoid a spiral of death on slow
frames. See [[architecture]] Rule 2, [[ui-flow]].

## D5 — Flat-top axial hexes, direction-step map DSL

**Decision:** hexes are flat-top axial `{q, r}`; maps are authored as
`walk(start, dirs)` direction steps (`src/sim/maps.ts`).
**Why:** the DSL makes every consecutive path pair adjacent **by construction**
(`hexDist === 1`), so hand-authored paths can't have gaps. `hexToWorld` is a clean
`x = 1.5q, z = √3(r+q/2)`. Validated by `scripts/validate-maps.ts`. See [[maps]].

## D6 — Event-driven effects (one-way sim→skin channel)

**Decision:** each `step()` overwrites `state.events` with that tick's `SimEvent`s;
skins consume them (renderer for effects, UI for toasts/overlays).
**Why:** clean separation — the sim broadcasts *what happened*, skins decide *how to
show it*. Because `main.ts` may run several steps per frame, it concatenates events
across steps and passes the combined array to `render()`. See [[architecture]],
[[rendering]], [[ui-flow]].

## D7 — "Save up to win" economy

**Decision:** HP compounds fast (`HP_GROWTH 1.22`/wave) while bounty grows slowly
(`1.045`/wave); wave income + skip bonuses reward banking money for premium AoE/nuke
towers rather than spamming cheap plinkers.
**Why:** creates a real strategic thesis and a measurable balance target (saver
wins, spender loses) that the [[ai-tester]] enforces continuously. See
[[waves-economy]], [[balance]].

## D8 — Leading-edge targeting

**Decision:** towers fire at the enemy **furthest along its path** within range.
**Why:** concentrates fire on the biggest immediate threat to the home; simple,
predictable, no manual targeting UI. Trade-off: can "chase" a leader past a fresh
pack. See [[sim-engine]].

## D9 — Doom is "slow-*firing*," not a slow field  ⚠

**Decision:** the Snuggle Nuke (`doom`) is implemented as a huge **damage** splash
with a very low fire rate (0.26/s) — it does **not** slow enemies.
**Why:** it's the boss-killer; its "extremely slow" flavor refers to firing
cadence, not crowd control (that's the freeze tower's job). **Caveat:**
[DESIGN.md](../DESIGN.md) line 27 still describes "doom = huge slow AoE," which the
code does not implement — a genuine doc-vs-code contradiction. Tracked in [[lint]].
See [[towers]], [[sim-engine]].

## D10 — Self-lit enemy faces (emissiveMap)

**Decision:** enemy materials use the baked face texture as both `map` and
`emissiveMap` (emissive white, intensity 0.55).
**Why:** a plain Lambert body went near-black on facets angled away from the single
directional light — the "black silhouette" bug. Self-lighting guarantees bright
pastels with a visible face at any angle. Shipped in commit `43d942e`. See the
[[rendering|postmortem]].

## D11 — One AI policy, three hosts (duplicated, deliberately)

**Decision:** the saver/spender policy runs headless (`ai-play.ts`), in a sweep
(`balance.ts`), and against the live site (`remote-play.ts`).
**Why:** the same code verifies balance, traces one game, and proves production
matches the sim. The policy is **duplicated** between `ai-play.ts` and
`remote-play.ts` (local sim vs `window.__game`) — a conscious copy that must be
kept in sync. See [[ai-tester]].
</content>

## D12 — Upgrade fairness contract (per-tower tracks)

**Decision:** upgrades are priced so marginal **delivered damage per coin** stays
roughly flat (`UPGRADE_BASE 0.55`, `UPGRADE_GROWTH 1.5`, per-tower value
multipliers ≈ the cost growth; `TowerSpec.tracks` + `towerStats()` replace the
global `DMG_MUL`/`SPD_MUL`). Each tower keeps a unique profile: plinker is capped
at 2 levels/track, the freeze "dmg" track grows range/area instead of damage,
cannon/doom widen their splash, lightning improves chain falloff.
**Why (owner directive, 2026-07-08):** "if the game is charging you more, you can
trust it's worth it." The old flat-%-vs-1.6×-cost exponential decayed to ~0.35
marginal value per coin. A mild taper (~0.67–0.9) is deliberate — one strong tower
also enjoys positional advantage. Enforced by `scripts/fairness.ts`. See
[[towers]], [[balance]].

## D13 — Bosses scale on their own curve, exempt from map hpMul

**Decision:** `BOSS_HP_GROWTH = 1.16` (trash keeps `HP_GROWTH = 1.22`) and bosses
ignore `map.hpMul` (`spawnEnemy`).
**Why:** the wave-20 double-Chonk wall on the shared curve cost more delivered
damage than a full game's economy could buy — unaceable even with perfect saving —
and map hpMul made harder maps' climaxes disproportionately worse. Map difficulty
lives in the trash waves; the boss wall is the same save-up climax everywhere,
aceable by the [[ai-tester|saver]]'s boss-fund plan while plinker-spam still
collapses. See [[enemies]], [[balance]].
