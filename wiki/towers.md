---
tags: [sim, towers, economy, balance, fairness]
updated: 2026-07-08
source-files:
  - src/sim/constants.ts
  - src/sim/engine.ts
  - src/sim/types.ts
  - scripts/fairness.ts
---

# Towers — the 5 defenders

All stats live in `TOWERS` (`src/sim/constants.ts`); firing behavior is in
`fire()` (`src/sim/engine.ts`, see [[sim-engine]]). Range is in world units
(hex size = 1, adjacent hex centers are ~1.732 apart). Rate is base shots/sec.

## Stat table (base)

| Kind | Name | Cost | Range | Damage | Rate | Special | Profile |
|---|---|---|---|---|---|---|---|
| `plinker` | Pebble Pal | 20 | 2.9 | 6.5 | 1.6 | single target | Fast & cheap, **hard ceiling** |
| `freeze` | Brr-Buddy | 35 | 2.6 | 3 | 0.9 | splash 1.6, slow ×0.55 for 2.0s | Utility: slow zone |
| `cannon` | Boop Cannon | 60 | 3.2 | 16 | 0.7 | splash 1.3 (full dmg) | Even damage on the field |
| `lightning` | Zappy Tickler | 90 | 3.4 | 14 | 1.0 | chains 4, falloff 0.72 | Damage down a chain |
| `doom` | Big Hug | 240 | 3.8 | 90 | 0.26 | splash 2.4 (full dmg) | A ton of field damage — if you can afford it |

Display names/descriptions are "evil-cute" flavor text (passive-aggressively
sweet — the doom tower is a "Big Hug" that nobody walks away from); the sim keys
everything on the `TowerKind` string
(`plinker | freeze | cannon | lightning | doom`), which never changes, so
save/automation/AI compatibility is preserved.

### Firing details (from `fire()`)

- **cannon & doom** apply **full** damage to every enemy in the splash radius —
  no distance falloff. Doom does **not** slow (its "slow" is its firing rate); see
  the caveat in [[decisions]] and [[lint]].
- **lightning** jumps to the nearest unhit enemy within a **hardcoded 2.2
  world-unit** chain radius, up to `chains` (4) total targets, each hop
  multiplying damage by the effective falloff (0.72 base, improvable to
  `FALLOFF_CAP = 0.9` via upgrades).
- **freeze** damages *and* slows all enemies in radius; slow never stacks (keeps
  strongest factor + longest duration via `applySlow`).

### Damage accounting (`Tower.dmgDealt`)

Every tower carries `dmgDealt` (in `src/sim/types.ts`, init 0 in `placeTower`):
the lifetime hp+shield it has **actually removed**. `damageEnemy()` returns the
removed amount, capped at what the enemy had left (`min(amount, shield +
max(0, hp))`), so overkill from splash/chain hitting an already-dying enemy never
inflates the stat — a 6.5-dmg shot on a 2-hp enemy logs 2. Freeze's token damage
counts too. It is pure accounting: firing behavior and outcomes are unchanged
(the balance target-checks still pass). The UI shows total damage and
damage-per-coin (`dmgDealt / spent`) in the tower panel. Old saves lacking the
field are normalized to 0 on load (`readSave` in `src/ui/save.ts`).

## Upgrade system: per-tower tracks + the fairness contract

Each tower has two upgrade tracks stored on `Tower.dmgLevel`/`Tower.spdLevel`,
but **what a track grows is per tower** — declared in `TowerSpec.tracks`
(`UpgradeTrack` in `src/sim/types.ts`: `dmgMul`, `rateMul`, `rangeMul`,
`splashMul`, `falloffAdd`, `max`, plus UI `label`/`blurb`). Effective stats come
from `towerStats(tower)` in `constants.ts` — the single helper used by the
engine, the UI, and the AI.

**The fairness contract** (comment above `UPGRADE_BASE`): whenever the game
charges you more, it gives you more. "More" is measured as **delivered damage**
— `damage × rate × expected targets × time-in-range` against an average stream
of mobs crossing the tower's range (see `scripts/fairness.ts`, which prints
marginal and cumulative value-per-coin per level; run
`npx tsx scripts/fairness.ts`). Each track's per-level value multiplier is tuned
to ≈ `UPGRADE_GROWTH`, so marginal value per coin stays roughly flat (~0.67–0.9
of a fresh tower's, a mild deliberate taper — one strong tower also enjoys
positional advantage and costs no build cell). The old system (flat +45% damage
vs 1.6× compounding cost) decayed ~0.91×/level and was scrapped.

### Cost formula

`upgradeCost(tower, which)` in `engine.ts`:

```
cost(level) = round(TOWERS[kind].cost * UPGRADE_BASE * UPGRADE_GROWTH^level)
```

with `UPGRADE_BASE = 0.55`, `UPGRADE_GROWTH = 1.5`, `level` = the tower's
**current** level on that track (0-based). Returns `null` at that track's
`max`. Example — cannon (cost 60): 33, 50, 74, 111, 167.

### Track table (per level, compounding)

| Tower | `dmg` track | `spd` track | Max (dmg/spd) |
|---|---|---|---|
| plinker | +35% dmg | +35% rate | **2 / 2** |
| freeze | **+12% range, +10% area** (no damage) | +45% rate | 5 / 5 |
| cannon | +33% dmg, +7% splash, +3% range | +45% rate | 5 / 5 |
| lightning | +38% dmg, falloff +0.03 (cap 0.9), +3% range | +45% rate | 5 / 5 |
| doom | +35% dmg, +6% splash, +3% range | +45% rate | 5 / 5 |

Notes:

- **Plinker's ceiling is the point.** Two levels per track → max ~46 DPS
  (6.5×1.35² dmg × 1.6×1.35² rate) for ~76 total coins per cell. Great value,
  but it *stops*: plinker-spam collapses at the late waves ([[balance]]).
- **Freeze's "dmg" track is a RANGE track** (UI label 📡 Range) — the tower's
  value is its ×0.55 slow, so its upgrades grow the slow zone (range and splash
  area) and its uptime (rate), never its token 3 damage.
- **Lightning's falloff upgrades** make the *chain* hit harder: at +5 levels
  falloff is capped at 0.87→0.9, raising expected chain targets from ~2.57 to
  ~3.3 per shot.
- Range/splash growth counts toward delivered damage (longer time-in-range,
  more targets per shot) — that's why damage percentages look smaller than the
  1.5× cost growth.

## Economy: placement, sell, spent

- **Place** (`placeTower`): only on a `build` cell that is empty and affordable
  (`canPlace`). Costs `TOWERS[kind].cost`; the tower records `spent = cost`.
- **Upgrade** (`upgradeTower`): adds the upgrade cost to `spent`.
- **Sell** (`sellTower`): refunds `floor(SELL_REFUND * spent)`, `SELL_REFUND =
  0.7` (70% of everything invested, including upgrades). Removes the tower.

## Design intent per tower

- **Plinker** — the workhorse you open with; two of them are the saver's first
  two buys. Cheap, decent single-target, capped hard — it cannot carry the
  late game no matter how many you field.
- **Freeze** — bought early to blunt the wave-3 fast swarms and wave-5 shields;
  the slow multiplies every other tower's shots-on-target, especially against
  the [[enemies|boss wall]].
- **Cannon** — first genuine area weapon; upgrades deepen *and widen* the boop.
- **Lightning** — the swarm answer; ricochets clear tight fast/regular packs,
  and upgraded chains keep hitting hard at the tail.
- **Doom** — the payoff of "saving." Its 90 (+full-splash 2.4) hit is the only
  affordable per-shot damage that dents a wave-20 boss; the [[ai-tester|saver]]
  banks a "boss fund" and dumps it into doom depth right before the wall.

The whole tower economy is tuned around one thesis: **premium AoE/nuke towers,
earned by saving, beat a pile of cheap plinkers** — and now also around the
fairness contract above. The [[ai-tester]] enforces both.
