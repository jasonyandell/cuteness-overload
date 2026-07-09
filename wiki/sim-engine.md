---
tags: [sim, engine, mechanics]
updated: 2026-07-08
source-files:
  - src/sim/engine.ts
  - src/sim/types.ts
  - src/sim/constants.ts
  - src/sim/hex.ts
  - src/sim/rng.ts
---

# Sim Engine — `step()` internals

The heart of the game is `step(state, map)` in `src/sim/engine.ts`: it advances
**exactly one [[architecture|TICK]] (1/30 s)** and mutates `state` in place. This
page documents the step order, targeting, damage/shield model, and the
serialization design. For the layering rules see [[architecture]].

## Step order (per tick)

`step()` clears `state.events` and, if `status === 'playing'`, runs six phases in
this fixed order:

1. **Auto-call wave** — if `time >= nextWaveAt` and `wave < waveLimit`, call the
   next wave (`callWave`). See [[waves-economy]].
2. **Process spawn queue** — any `SpawnItem` whose `at <= time` becomes a live
   `Enemy` (`spawnEnemy`). Waves overlap, so the queue can hold items from
   several waves at once.
3. **Move enemies** — tick each enemy's slow, advance `dist += speed * factor *
   TICK`, recompute world `(x,z)` from the path polyline, and regen shields.
4. **Towers acquire & fire** — each off-cooldown tower picks a target and fires;
   damage is applied instantly (hitscan).
5. **Reap** — enemies with `hp <= 0` pay bounty (`die` event); enemies past the
   end of their path leak (`leak` event, lose `livesCost`). Survivors kept.
6. **Win/lose** — `lives <= 0` → `lost`; else if not endless and `wave >=
   TOTAL_WAVES` and no enemies and empty queue → `won`.

Finally `time += TICK; tick++`.

Order matters: enemies move **before** towers fire (so towers shoot at this
tick's positions), and reaping happens **after** firing (so a lethal shot's
bounty lands the same tick).

## Targeting

Each tower scans all enemies within its **effective range** (squared-distance
test against `hexToWorld(tower.q, tower.r)`; range can grow with upgrades) and
picks the one **furthest along its path** (`e.dist > best`). This is a "first /
leading" targeting policy — towers commit fire to whatever is closest to your
house, concentrating damage on the biggest threat. There is no manual targeting.

All effective stats (damage, rate, range, splash, chain falloff) come from one
helper, `towerStats(tower)` in `src/sim/constants.ts`, which applies both
per-tower upgrade tracks (see [[towers]]). Cooldown after firing:
`cooldown = 1 / stats.rate`.

## Damage & shield model

`damageEnemy(state, e, amount): number` (in `engine.ts`):

- Records `e.lastHitAt = time` (resets the shield-regen timer).
- **Shield absorbs first.** If the enemy has `shield > 0`, damage is subtracted
  from the shield pool; overflow spills into `hp`.
- Only `shield` (Shelly) enemies have a shield pool. See [[enemies]].
- **Returns the hp+shield actually removed**, capped at `min(amount, shield +
  max(0, hp))`, so overkill isn't counted. `fire()` adds this to the firing
  tower's `Tower.dmgDealt` (all paths: direct hit, splash loop, chain hops, and
  freeze's token damage). Pure accounting — no effect on outcomes. See
  [[towers]] for the stat's UI surfacing and save normalization.

**Shield regen:** in the move phase, if an enemy has `maxShield > 0`, is below
full shield, and has gone `SHIELD_REGEN_DELAY = 2.5`s without being hit, its
shield refills at `SHIELD_REGEN_RATE = 12` hp/s (clamped to `maxShield`). Sustained
fire keeps a Shelly's shield suppressed; sporadic fire lets it heal back.

### Per-tower fire behavior (`fire()`)

- **plinker** — single-target damage to the acquired enemy.
- **cannon / doom** — full damage to the target, then **full** (no falloff)
  splash damage to every enemy within `splash` world units. Emits an `aoe` event.
- **lightning** — hits the target, then chains to up to `chains` total enemies.
  Each jump finds the nearest unhit enemy within **2.2 world units** (hardcoded
  chain radius in `engine.ts`) and multiplies damage by the effective falloff
  (base 0.72; `dmg` upgrades add +0.03/level up to `FALLOFF_CAP = 0.9`) per hop.
  Emits `chain` events.
- **freeze** — no single target; damages *and* slows every enemy within `splash`.
  `applySlow` never stacks: it keeps the **strongest** factor (lowest multiplier)
  and the **longest** remaining duration. Emits an `aoe` event.

> Note: `doom` deals **damage** splash, not slow. See the caveat in [[decisions]]
> — `DESIGN.md` describes doom as a "slow AoE," which the code does not implement;
> "slow" refers to its slow *firing rate*. Tracked in [[lint]].

Damage, splash radius, and falloff in `fire()` are all the `towerStats(tower)`
effective values — what each upgrade track grows is per tower (e.g. the freeze
tower's `dmg` track grows range/area, not damage). See [[towers]].

## Enemy motion & path geometry

`src/sim/hex.ts` builds a `PathGeom` per path: the world points of each hex center
(`hexToWorld`, flat-top axial → `x = 1.5q`, `z = √3·(r + q/2)`), cumulative
segment distances, and total `length`. `pointAt(geom, d)` linearly interpolates
the world position at distance `d` along the polyline (clamped at both ends).

An enemy stores `dist` (distance travelled) and its `x,z` are re-derived each
tick. It **leaks** when `dist >= geom.length`. These geoms are cached in
`geomCache` keyed by `map.id` and rebuilt on demand after a resume.

## RNG usage

The sim only touches randomness in `callWave`, where each spawn's `at` time gets a
small jitter: `(rngNext(state) - 0.5) * gap * 0.3`. Everything else is
deterministic. Because `rngState` is part of `GameState`, replaying from a saved
state reproduces the identical spawn timings. See [[architecture]] rule 3.

## Serialization / resume

`GameState` is plain JSON (`src/sim/types.ts`). Save = `JSON.stringify`; resume =
`JSON.parse` + rebuild derived caches from `mapId`. Two JSON-safety details worth
knowing:

- **`NEVER = -1e9`** is used as `lastHitAt` for "never hit yet" instead of
  `-Infinity` (which is not JSON-serializable).
- Non-serialized caches (`geomCache`, `cellCache`) live at module scope in
  `engine.ts`, keyed by `map.id`, and are lazily rebuilt — never stored on state.

## Public API (implemented in `engine.ts`)

`createGame(map, seed, endless?)`, `step(state, map)`, `canPlace`, `placeTower`,
`upgradeCost`, `upgradeTower`, `sellTower`, `skipWave`, `startEndless`, plus the
AI helper `totalEnemyHp(state)`. Economy details (costs, refunds, skip bonus) are
in [[towers]] and [[waves-economy]].
</content>
