---
tags: [sim, waves, economy, balance]
updated: 2026-07-08
source-files:
  - src/sim/waves.ts
  - src/sim/constants.ts
  - src/sim/engine.ts
---

# Waves & Economy

Wave composition + scheduling live in `src/sim/waves.ts`; the money side (wave
income, skip bonus) is in `callWave`/`skipWave` (`src/sim/engine.ts`) and the
constants file. This is where the **"save up to win"** economy thesis is encoded.

## Cadence

- Waves auto-call every `WAVE_INTERVAL = 25`s. First wave after
  `FIRST_WAVE_DELAY = 12`s of build time.
- `TOTAL_WAVES = 20`. Boss waves are **10** and **20**.
- **Waves overlap.** Calling a wave only pushes its enemies onto the spawn queue;
  the previous wave need not be dead. The skip button (below) intentionally
  stacks waves for tempo/bonus.

## Wave composition (`waveComposition(wave)`)

Regulars always; **fast from wave 3**; **shield from wave 5**; boss waves 10 & 20.
Hand-authored 1–20 in `WAVES_1_20`; totals grow ~6 → ~19 with deliberate spikes.

| Wave | Composition | Note |
|---|---|---|
| 1 | 6 regular | |
| 2 | 8 regular | |
| 3 | 5 regular, 3 fast | fast introduced |
| 4 | 6 regular, 3 fast | |
| 5 | 5 regular, 3 shield | shield introduced |
| 6 | 6 regular, 3 fast, 2 shield | |
| 7 | 4 regular, 7 fast | **fast swarm** |
| 8 | 7 regular, 4 shield | |
| 9 | 6 regular, 4 fast, 3 shield | |
| 10 | **1 boss**, 8 regular | boss + escort |
| 11 | 7 regular, 4 fast, 3 shield | |
| 12 | 4 regular, 10 fast | **fast swarm** |
| 13 | 8 regular, 6 shield | **double shield** |
| 14 | 7 regular, 5 fast, 3 shield | |
| 15 | 8 regular, 5 fast, 4 shield | |
| 16 | 6 regular, 8 shield | **double shield** |
| 17 | 5 regular, 12 fast | **fast swarm** |
| 18 | 9 regular, 5 fast, 4 shield | |
| 19 | 8 regular, 6 fast, 5 shield | |
| 20 | **2 boss**, 8 regular, 4 fast | double boss + escort |

**Endless (wave > 20):** thickening mix `regular 8+over`, `fast 5+over/2`,
`shield 4+over/2` (`over = wave - 20`), with a boss every 5th wave (count grows by
1 per 10 extra waves). Enemy HP additionally scales `ENDLESS_HP_GROWTH^(wave-20)`
(= 1.30/wave) on top of the base curve — see [[enemies]].

## Spawn scheduling

`callWave` flattens the composition into an ordered list (`flattenWave`, a
weighted round-robin so kinds arrive **interleaved**, not in solid blocks), then
schedules each spawn at increasing `at` times. Per-kind cadence (`spawnGap`):
boss 3.0s, shield 1.3s, fast 0.6s, regular 1.0s. Each spawn's time gets ±30%
jitter from the seeded [[architecture|RNG]]. On multi-lane maps the spawn index
alternates paths round-robin (`i % nPaths`), splitting the wave across lanes — the
core difficulty of [[maps|Double Trouble]].

## Money in

Two income sources, both scaled by the map's `incomeMul`:

**1. Wave income ("wage")** — paid on every wave call, in `callWave`:

```
income = floor((WAVE_INCOME_BASE + wave * WAVE_INCOME_SCALE) * map.incomeMul)
       = floor((12 + wave*2) * incomeMul)
```

Meadow (`incomeMul 1.0`): wave 1 → 14, wave 20 → 52. Double (`1.8`): wave 20 → 93.

**2. Kill bounty** — paid when an enemy dies, scaled by `incomeMul` and
`BOUNTY_GROWTH = 1.045`/wave. See [[enemies]]. Bounty grows far slower than HP, so
you cannot farm your way through — income increasingly comes from waves/skips.

## The skip button

`skipWave(state, map)` calls the next wave immediately and pays a bonus
proportional to time left on the timer:

```
bonus = floor(remaining * SKIP_RATE * (1 + wave * SKIP_WAVE_SCALE))
      = floor(remaining * 0.55 * (1 + wave*0.06))
```

with `remaining = max(0, nextWaveAt - time)`. Skipping early (big `remaining`)
banks the most money and compresses dead time; the bonus grows 6%/wave. The
[[ai-tester|saver]] skips only when the field is clear and nothing is still
spawning (so it doesn't pull a wave onto un-spawned enemies). You cannot skip the
final wave (`wave >= waveLimit`).

## The "save up to win" thesis

The numbers are tuned so **patience pays**:

- Trash HP compounds at 1.22×/wave (bosses 1.16×, see [[enemies]]); bounty only
  1.045×/wave. Kills alone never keep up.
- Wave income + generous skip bonuses reward banking money and calling waves on
  your schedule rather than reacting.
- The banked money is meant to buy **premium AoE/nuke towers** ([[towers|cannon,
  lightning, doom]]), which out-scale a pile of cheap plinkers against the late
  swarms and bosses.

This is exactly what the [[balance]] harness verifies: a saver **aces** all maps
(20 lives kept); an impatient spender loses everywhere. The mid-game spikes
(fast swarms at 7/12/17, double shields at 13/16) plus the plinker's hard
upgrade ceiling ([[towers]]) are what punish single-target plinker-spam
specifically.
</content>
