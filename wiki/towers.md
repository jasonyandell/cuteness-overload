---
tags: [sim, towers, economy, balance]
updated: 2026-07-07
source-files:
  - src/sim/constants.ts
  - src/sim/engine.ts
  - src/sim/types.ts
---

# Towers — the 5 defenders

All stats live in `TOWERS` (`src/sim/constants.ts`); firing behavior is in
`fire()` (`src/sim/engine.ts`, see [[sim-engine]]). Range is in world units
(hex size = 1, adjacent hex centers are ~1.732 apart). Rate is base shots/sec.

## Stat table

| Kind | Name | Cost | Range | Damage | Rate | Special | Intent |
|---|---|---|---|---|---|---|---|
| `plinker` | Pebble Plinker | 20 | 2.9 | 7 | 1.6 | single target | Cheap early coverage |
| `freeze` | Brr Blaster | 35 | 2.6 | 3 | 0.9 | splash 1.6, slow ×0.55 for 2.0s | Crowd control for swarms/shields |
| `cannon` | Boop Cannon | 60 | 3.2 | 16 | 0.7 | splash 1.3 (full dmg) | First real AoE / anti-group |
| `lightning` | Zap Zapper | 90 | 3.4 | 14 | 1.0 | chains 4, falloff 0.72 | Swarm clear via ricochet |
| `doom` | Snuggle Nuke | 240 | 3.8 | 90 | 0.26 | splash 2.4 (full dmg) | Boss-killer; the big save |

Display names/descriptions are the "cute" flavor text; the sim keys everything on
the `TowerKind` string (`plinker | freeze | cannon | lightning | doom`).

### Firing details (from `fire()`)

- **cannon & doom** apply **full** damage to every enemy in the splash radius —
  no distance falloff. Doom does **not** slow (its "slow" is its firing rate); see
  the caveat in [[decisions]] and [[lint]].
- **lightning** jumps to the nearest unhit enemy within a **hardcoded 2.2
  world-unit** chain radius, up to `chains` (4) total targets, each hop ×0.72.
- **freeze** damages *and* slows all enemies in radius; slow never stacks (keeps
  strongest factor + longest duration via `applySlow`).

## Upgrade math

Each tower has two independent upgrade tracks, `dmg` and `spd`, each 0..`MAX_UPGRADE`
(= 5). Constants in `src/sim/constants.ts`:

- **Damage:** `damage = base * DMG_MUL^dmgLevel`, `DMG_MUL = 1.45` (+45%/level).
  Max = `1.45^5 ≈ 6.41×` base damage.
- **Speed:** `rate = base * SPD_MUL^spdLevel`, `SPD_MUL = 1.30` (+30%/level).
  Max = `1.30^5 ≈ 3.71×` base rate.
- **Combined** a fully-upgraded tower does `6.41 × 3.71 ≈ 23.8×` its base DPS.

### Upgrade cost formula

`upgradeCost(tower, which)` in `engine.ts`:

```
cost(level) = round(TOWERS[kind].cost * UPGRADE_BASE * UPGRADE_GROWTH^level)
```

with `UPGRADE_BASE = 0.75`, `UPGRADE_GROWTH = 1.6`, and `level` = the tower's
**current** level on that track (0-based). Returns `null` when the track is maxed
(level 5). Worked example — plinker (base cost 20), damage track:

| Next level | Cost |
|---|---|
| 1 | 15 |
| 2 | 24 |
| 3 | 38 |
| 4 | 61 |
| 5 | 98 |

Maxing one track on a plinker costs **236**; both tracks **472** (vs 20 to place).
A fully-upgraded plinker reaches **~266 DPS** (7×6.41 dmg × 1.6×3.71 rate) — a key
[[balance]] number: it's the same DPS as an un-upgraded Boop Cannon at more than
3× the cost, which is why plinker-spam stays viable longer than intended.

## Economy: placement, sell, spent

- **Place** (`placeTower`): only on a `build` cell that is empty and affordable
  (`canPlace`). Costs `TOWERS[kind].cost`; the tower records `spent = cost`.
- **Upgrade** (`upgradeTower`): adds the upgrade cost to `spent`.
- **Sell** (`sellTower`): refunds `floor(SELL_REFUND * spent)`, `SELL_REFUND =
  0.7` (70% of everything invested, including upgrades). Removes the tower.

## Design intent per tower

- **Plinker** — the workhorse you open with; two of them are the saver's first
  two buys. Cheap, decent single-target, but no splash — it caps out and can't
  carry the late game alone.
- **Freeze** — bought early to blunt the wave-3 fast swarms and wave-5 shields;
  the slow buys your other towers extra shots-on-target.
- **Cannon** — first genuine area weapon; two cannons cover both lanes on
  [[maps|Double Trouble]].
- **Lightning** — the swarm answer; ricochets clear tight fast/regular packs the
  cannon would waste single-hits on.
- **Doom** — the payoff of "saving." At 240 cost and 0.26/s it is deliberately
  rare and slow, but its 90 (+full-splash) hit is the only affordable per-shot
  damage that dents a wave-20 boss. Its rate was raised `0.18 → 0.26` in the
  [[balance]] pass specifically to make wave 20 survivable. See [[waves-economy]].

The whole tower economy is tuned around one thesis: **premium AoE/nuke towers,
earned by saving, beat a pile of cheap plinkers.** The [[ai-tester]] enforces it.
</content>
