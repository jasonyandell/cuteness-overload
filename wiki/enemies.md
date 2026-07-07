---
tags: [sim, enemies, mechanics, scaling]
updated: 2026-07-07
source-files:
  - src/sim/constants.ts
  - src/sim/engine.ts
  - src/sim/waves.ts
  - src/sim/types.ts
---

# Enemies — the 4 cuties

Base stats in `ENEMIES` (`src/sim/constants.ts`). Spawning + scaling in
`spawnEnemy` (`src/sim/engine.ts`). Which kinds appear when is in
[[waves-economy]].

## Stat table (base, wave 1, before scaling)

| Kind | Name | Shape | HP | Speed | Bounty | Shield | Lives on leak |
|---|---|---|---|---|---|---|---|
| `regular` | Bloop | cube | 26 | 0.95 | 4 | 0 | 1 |
| `fast` | Zippy | tetrahedron | 16 | 1.75 | 4 | 0 | 1 |
| `shield` | Shelly | octahedron | 34 | 0.80 | 7 | 30 | 1 |
| `boss` | Chonk | icosahedron | 420 | 0.55 | 60 | 0 | 5 |

Speed is world units/sec. A boss (`livesCost = 5`) is worth five leaks — leaking a
single boss on wave 20 is often the difference between a win and a loss.

## Per-wave scaling (in `spawnEnemy`)

HP and shield scale with wave number and the map's `hpMul`:

```
scale = map.hpMul * HP_GROWTH^(wave - 1)        // HP_GROWTH = 1.22
if wave > 20:  scale *= ENDLESS_HP_GROWTH^(wave - 20)   // 1.30 per extra wave
hp     = spec.hp     * scale
shield = spec.shield * scale
```

**`HP_GROWTH = 1.22` compounds hard.** By wave 20 it is `1.22^19 ≈ 43.7×` base.
Concrete boss HP at wave 20:

- Meadow (`hpMul 1.0`): `420 × 43.7 ≈ 18,400` per boss, **two of them**.
- Double (`hpMul 1.1`): `420 × 1.1 × 43.7 ≈ 20,200` per boss.

This compounding is why the late game outruns any affordable single-target line
and why the [[towers|Snuggle Nuke]]'s per-shot 90+splash (and its rate bump to
0.26) is the designated boss answer. See [[balance]].

## Bounty scaling

```
bounty = round(spec.bounty * map.incomeMul * BOUNTY_GROWTH^(wave - 1))   // 1.045
```

Bounty grows only `1.045×`/wave (≈ `2.3×` by wave 20) — far slower than HP's
`1.22×`. Deliberate: kill income can't keep pace with enemy HP, so wave-call
income and skip bonuses (see [[waves-economy]]) matter more and more, and you
can't simply farm your way to victory. Map `incomeMul` multiplies bounty (and
wave income), e.g. Double pays `1.8×`.

## Shield mechanic (Shelly)

Only `shield` enemies carry a shield pool (base 30, scaled like HP). In
`damageEnemy`, the shield absorbs damage first; overflow hits HP. If a Shelly goes
`SHIELD_REGEN_DELAY = 2.5`s without taking a hit, its shield refills at
`SHIELD_REGEN_RATE = 12` hp/s up to `maxShield`. Implications:

- **Sustained fire** keeps the shield suppressed so HP damage lands; **bursty or
  sparse fire** lets it heal, wasting your first hits each time.
- Shields punish single-target plinker fire and reward AoE that keeps everything
  in a pack under continuous pressure — one more reason the design favors the
  saver over the [[balance|spender]].
- The renderer shows a translucent shield bubble scaled by remaining shield; see
  [[rendering]].

## Slow (from freeze)

Freeze towers set `slowLeft`/`slowFactor` on enemies in radius. During the move
phase, an enemy with `slowLeft > 0` moves at `speed * slowFactor` and ticks the
timer down. Slows never stack — `applySlow` keeps the strongest factor and longest
duration. Bosses are slowed too (there is no immunity), which is how a single lane
buys enough shots-on-target to bring a Chonk down before it reaches home.

## Design intent

- **Bloop** — the baseline crowd; always present, sets the HP curve.
- **Zippy** — arrives wave 3; fast + low HP, comes in swarms (wave 7, 12, 17) that
  overwhelm slow single-target fire and reward lightning/freeze.
- **Shelly** — arrives wave 5; the shield tax on burst damage, spikes into
  double-shield waves (13, 16).
- **Chonk** — the wall. Boss waves 10 (one boss) and 20 (two), plus every 5th wave
  in endless. Slow but enormous HP and 5-life leaks; the reason you save for doom.
</content>
