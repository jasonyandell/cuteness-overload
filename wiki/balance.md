---
tags: [balance, ai, methodology]
updated: 2026-07-07
source-files:
  - BALANCE.md
  - scripts/ai-play.ts
  - scripts/balance.ts
  - src/sim/constants.ts
  - src/sim/maps.ts
  - src/sim/waves.ts
---

# Balance — methodology, results, caveats

Balance is verified by a **headless AI harness**, not by hand. Two scripted
strategies play every map × seeds 1–5 and a summary table decides pass/fail. The
implementation is [[ai-tester]]; this page is the *findings*. Source of the
narrative: [BALANCE.md](../BALANCE.md).

## The two strategies

- **saver** — the intended winner. Follows a fixed build **order** (a shopping
  list) and only buys the next item when affordable — never buys ahead, never
  substitutes cheap plinkers for the big towers it is saving toward. Places on the
  best-coverage cell, skips a wave only when the field is clear. After the scripted
  list, a value-greedy tail spends overflow on the best DPS-per-dollar
  cannon/lightning/doom or upgrade.
- **spender** — the impatient baseline that should lose. Buys a plinker on the
  best open spot the instant it can afford one; when out of spots, dumps money
  into plinker upgrades. Never saves, never skips.

Targets: **saver wins all**, **spender loses all**. Details of the strategy code
in [[ai-tester]].

## Current measured result (re-run 2026-07-07, current constants)

```
map      strat      wins  avgWave  avgLives  minLives
-----------------------------------------------------
meadow   saver       5/5     20.0       9.2         9
meadow   spender     0/5     20.0       0.0         0
creek    saver       5/5     20.0       8.6         8
creek    spender     0/5     20.0       0.0         0
double   saver       5/5     20.0       6.8         6
double   spender     0/5     17.0       0.0         0
```

- saver wins all 3 maps × 5 seeds → **PASS**
- spender loses all → **PASS**
- Difficulty is monotone and correct: Meadow (avg 9.2 lives) → Creek (8.6) →
  Double (6.8, tightest). Saver fields ~14 towers on Meadow/Creek, ~25–26 on
  Double (two lanes). Spender fields 59–62 (Meadow), 49 (Creek), 83 (Double)
  plinkers and still loses.

Run it yourself:

```
npx tsx scripts/balance.ts                 # the whole table + target check
npx tsx scripts/ai-play.ts double 3 saver  # one game, per-wave log
```

## What was changed and why

The [[ai-tester]] pass made **surgical** edits that help the premium-tower saver
and the hardest map without helping plinker-spam. All are now live in code:

1. **`TOWERS.doom.rate: 0.18 → 0.26`** (`src/sim/constants.ts`). The
   [[towers|Snuggle Nuke]] is the only tower whose per-hit damage (90 + splash)
   dents a wave-20 boss, but at 0.18/s it fired too rarely. 0.26/s (~1 shot per
   3.8s) gives real boss-killing margin. The spender owns **zero** dooms, so this
   only widens the gap. Lifted Meadow/Creek from a nervy min-2 to min-8/9.
2. **Double `hpMul: 1.2 → 1.1`, `incomeMul: 1.1 → 1.8`** (`src/sim/maps.ts`).
   Makes the two-lane map winnable by paying for the second front, without helping
   the spender. Full reasoning in [[maps]] ("Double Trouble balance story").

`HP_GROWTH` was deliberately **not** touched globally — lowering it makes the
spender win too, erasing the core gap.

## Known caveat: spender loses at wave 17–20, not the hoped-for 10–16

The spender loses **every** game, but late — wave 20 on Meadow/Creek, wave 17 on
Double — rather than collapsing mid-game. This is a real finding, not a harness
bug: a competently-placed, fully-upgraded plinker reaches **~266 DPS** (same as an
un-upgraded cannon at 3× the cost; see [[towers]]), which carries the spender to
the final boss wall where it finally fails (no splash, no nuke). The "saving is
required" lesson still lands — just at the finish line.

Forcing an earlier loss was rejected because the only levers are bad:
- Nerfing the plinker also guts the saver's early game (they share the tower) and
  drops the saver below a winning line (`plinker.damage 7→6` makes the saver lose
  Meadow/Creek).
- Making the spender place "naively" is pathological (towers stranded off-path,
  dies at wave 4), not a meaningful baseline.

The clean lever, if the 10–16 window ever matters, is on the **wave side**: lean
the mid-game waves (~11–16) harder into fast-swarms and shields, which punish
single-target plinker fire specifically. `src/sim/waves.ts` was left untouched
since the primary targets are met. See [[waves-economy]].

## ⚠ Doc-vs-code drift found at genesis (lint)

The harness's own target check in `scripts/balance.ts` asserts spender losses fall
in a **wave 8–18** window and prints `spender losses in wave 8-18 window: FAIL` on
the current constants (because Meadow/Creek spenders die at wave 20). The accepted
reality (this page) is losses up to wave 20, so the assertion contradicts the
documented, intentional behavior. Also, [BALANCE.md](../BALANCE.md)'s top table
("Result at the CURRENT constants (nothing changed)") is now **stale** — it shows
Double as 0/5 unwinnable, which was the *pre-change* state; the recommended edits
it describes are already applied. Both tracked in [[lint]].
</content>
