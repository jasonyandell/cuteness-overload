---
tags: [balance, ai, methodology, fairness]
updated: 2026-07-08
source-files:
  - BALANCE.md
  - scripts/ai-play.ts
  - scripts/balance.ts
  - scripts/fairness.ts
  - src/sim/constants.ts
  - src/sim/maps.ts
  - src/sim/waves.ts
---

# Balance — methodology, results, caveats

Balance is verified by a **headless AI harness**, not by hand. Two scripted
strategies play every map × seeds 1–5 and a summary table decides pass/fail. The
implementation is [[ai-tester]]; this page is the *findings*.
[BALANCE.md](../BALANCE.md) is the **original human doc and is now historical** —
the 2026-07-08 fairness rebalance replaced its upgrade system entirely (see
[[lint]]).

## The two strategies

- **saver** — the intended winner. Fixed build order (a shopping list), then a
  value-greedy tail, plus an endgame **boss fund**: from a per-map bank wave it
  saves its overflow and dumps the fund into instant upgrades right before the
  wave-20 boss wall ("will I be able to save in time?", played straight). Uses a
  per-map game plan (`SAVER_PROFILES`); details in [[ai-tester]].
- **spender** — the impatient baseline that must lose. Buys a plinker the
  instant it can afford one; when out of spots, dumps money into plinker
  upgrades. Never saves, never skips.

Targets (asserted by `scripts/balance.ts`): **saver ACES all** (wins with all
20 lives), **spender loses all**, spender losses inside waves 8–20.

## Current measured result (2026-07-08, current constants)

```
map      strat      wins  avgWave  avgLives  minLives
-----------------------------------------------------
meadow   saver       5/5     20.0      20.0        20
meadow   spender     0/5     20.0       0.0         0
creek    saver       5/5     20.0      20.0        20
creek    spender     0/5     20.0       0.0         0
double   saver       5/5     20.0      20.0        20
double   spender     0/5     19.0       0.0         0
```

All four target checks PASS. Run it yourself:

```
npx tsx scripts/balance.ts                 # the whole table + target check
npx tsx scripts/ai-play.ts double 3 saver  # one game, per-wave log + loadout
npx tsx scripts/fairness.ts                # upgrade value-per-coin report
```

## The 2026-07-08 fairness rebalance — what changed and why

Design goal (from the project owner): **whenever the game charges you more, it
must be worth it.** "More" = delivered damage — total damage dealt to an average
stream of mobs crossing the tower's range (`scripts/fairness.ts` computes it).
The old exponential upgrades (+45% dmg vs 1.6× compounding cost, 5 levels on
every tower) decayed to ~0.35 marginal value per coin — spending more bought
less. Changes, all in `src/sim/constants.ts` unless noted:

1. **Per-tower upgrade tracks** replace the global `DMG_MUL`/`SPD_MUL`
   (`TowerSpec.tracks`, effective stats via `towerStats()`): each tower's two
   tracks grow different stats with per-level multipliers tuned so value ≈ the
   1.5× cost growth. Full table in [[towers]].
2. **Cheaper, flatter upgrade costs**: `UPGRADE_BASE 0.75 → 0.55`,
   `UPGRADE_GROWTH 1.6 → 1.5`. Marginal value per coin now holds at ~0.67–0.9 of
   a fresh tower across all levels (mild taper is deliberate).
3. **Plinker gets a hard ceiling**: max 2 levels per track (+35% each), damage
   7 → 6.5 (same shots-to-kill on early waves; ~7% less late throughput). This
   is what makes plinker-spam collapse *despite* fair pricing — the fairness
   pass initially flipped the spender to winning until the cap+trim landed.
4. **Bosses ride their own curve and ignore map `hpMul`**:
   `BOSS_HP_GROWTH = 1.16` vs trash `HP_GROWTH = 1.22` (`spawnEnemy`,
   `src/sim/engine.ts`). On the old shared curve the wave-20 double-Chonk wall
   (~37k hp on Meadow, more on hpMul maps) demanded more delivered damage than
   an entire game's economy could buy — unaceable even with perfect saving.
   Now ~14.2k total, constant across maps; map difficulty lives in trash.
5. **Saver AI upgraded to prove aceability** (`scripts/ai-play.ts`): boss fund
   (bank → dump), boss-mode value scoring at the wall, per-map profiles,
   second doom on multi-lane maps. See [[ai-tester]].

`HP_GROWTH` and all base prices were deliberately **not** touched.

## Difficulty reading

The saver's *margin* is thin everywhere — the aces land with ~0–200 spare coins
and rely on disciplined saving, sane placement, and the endgame fund. The
spender (60–83 towers of capped plinkers) still reaches wave 19–20 before
collapsing at the boss wall on Meadow/Creek and dies at 19 on Double: the
"moderately high" target — beatable and even aceable with a smart plan, fatal
without one.

## Known caveats

- The wave 8–20 spender-loss window is wide by design; well-placed capped
  plinker spam legitimately survives to the boss wall before failing.
- `scripts/remote-play.ts` still runs the **pre-rebalance saver policy** (no
  boss fund / profiles); it exercises the deployed site but won't reproduce the
  ace results. Tracked in [[lint]] L7.
- The fairness metric ignores overkill and assumes an average mob density;
  it's directional, not exact — by design.
