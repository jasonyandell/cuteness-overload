---
tags: [ai, testing, automation, scripts]
updated: 2026-07-08
source-files:
  - scripts/ai-play.ts
  - scripts/balance.ts
  - scripts/fairness.ts
  - scripts/remote-play.ts
  - src/sim/engine.ts
---

# AI Tester — headless & remote play

Three scripts exercise the game with no human: a headless AI player, a balance
sweep over it, and a remote driver that plays the deployed site. All share one
policy. The *results* live in [[balance]]; this page is *how it works*.

## `scripts/ai-play.ts` — the headless player

Runs the pure [[sim-engine|sim]] with a scripted strategy and prints a per-wave
log. CLI:

```
npx tsx scripts/ai-play.ts [mapId] [seed] [strategy]
#   mapId    meadow | creek | double   (default meadow)
#   seed     integer                    (default 1)
#   strategy saver | spender            (default saver)
```

`playGame(mapId, seed, strategy)` is the reusable core (also imported by
`balance.ts`). Each game sims in ~15–25ms.

### Coverage precompute

`precompute(map)` lays down **dense sample points** (every 0.25u) along every path
and lists all build cells with world positions. `coverageScore(cell, range)` =
weighted count of path samples within a tower's range (center-of-path samples
count a little extra). `bestCell(kind)` picks the free build cell with the highest
coverage for that tower's range. This is how the AI "aims" — it places where a
tower covers the most path.

### The saver (intended winner — it ACES)

A **fixed opening list** (`SAVER_OPENING`) executed strictly in order; each step
only fires when affordable — never buys ahead, never substitutes:

```
plinker, plinker, cannon, up(cannon,dmg), freeze, cannon, lightning,
up(cannon,dmg), plinker, up(cannon2,dmg), doom, up(doom,dmg), up(doom,spd)
```

On multi-lane maps a `SECOND_DOOM` extension appends `doom, up(dmg), up(spd)` —
one doom per lane's wave-20 boss. After the list, a **value-greedy tail**
(`tailUpgrade`) spends pooled money on the best marginal
**delivered-damage-per-dollar** action (`towerValue` = `towerStats` damage ×
rate × expected targets × range — the same fairness metric as
`scripts/fairness.ts`) — an upgrade or a new cannon/lightning/doom in the best
free spot (never more plinkers).

**The boss fund (the ace-maker).** From `cfg.bankStart` the saver banks its
overflow instead of spending; at `cfg.dumpWave` it dumps the whole fund into
instant upgrades scored in **boss mode** (`bossTargetsPerShot`: does the splash
span the two Chonks walking ~1.7u apart? do chains reach the second boss?),
falling back to general value so money never rots. Banking is optionally
**threat-aware** (`cfg.margin`): keep spending while `teamDps×18 <
margin × next wave's hp` (`waveThreat`), bank only when comfortably ahead.

**Per-map game plan** (`SAVER_PROFILES`, applied by `playGame`):

| map | bankStart | dumpWave | margin | secondDoom |
|---|---|---|---|---|
| meadow | 14 | 18 | 0 (pure bank) | no |
| creek | 12 | 17 | 0 | no |
| double | 12 | 17 | 1.6 (threat-aware) | yes |

These settings **ace (20 lives) every map × seeds 1–5** at current constants —
the proof that acing needs a smart plan, not superhuman play. The knobs are
exported (`SAVER_CFG`, `opts.cfg`) so sweeps can re-tune after any rebalance.
The per-wave log also prints `!! boss leaked at wN with X hp` lines and a final
per-tower `LOADOUT` for post-mortems.

### The spender (baseline that loses)

`spenderAct`: buys a plinker on the best open spot the instant it can afford one;
when out of spots, dumps money into the cheapest plinker upgrade (dmg first).
Never saves, never skips. The intended *loser* — see [[balance]] for why it still
survives to wave 17–20.

### Skip heuristic (saver only)

`shouldSkip`: never skip the final wave or while enemies are still spawning; skip
if the field is clear, or if `totalEnemyHp < 0.6 * teamDps * secondsLeft` (i.e. the
current wave can be chewed through with margin before the next auto-call). Skipping
banks the [[waves-economy|skip bonus]] and compresses dead time. On a skip the AI
immediately re-spends the bonus.

## `scripts/balance.ts` — the sweep

Runs saver + spender across all 3 maps × seeds 1–5 (30 games), prints a detailed
table, a per-map summary (win rate / avg wave / avg & min lives), and a **target
check**: saver wins all, saver **ACES** all (20 lives kept), spender loses all,
spender losses inside waves 8–20. All four PASS at current constants
([[balance]]).

```
npx tsx scripts/balance.ts     # or: npm run balance
npm run ai                     # ai-play with defaults
```

## `scripts/fairness.ts` — the upgrade fairness report

Prints, per tower and per upgrade track, the **marginal and cumulative
delivered-damage per coin** for every level, normalized so the base tower =
1.00. Delivered damage = damage × rate × expected targets × time-in-range for an
average mob stream crossing the tower's range in a straight line (density
0.8/unit, tower ~1.7u off the path). This is the executable form of the fairness
contract in [[towers]] — after any constants change, re-run it and check the
marginal column stays roughly flat (~0.67–0.9; freeze's range track is exempt,
its value is the slow).

## `scripts/remote-play.ts` — driving the deployed site

Plays the **live site** in a real headless Chromium (Playwright), every decision
executed through the page's [[ui-flow|`window.__game.actions`]] surface instead
of a local sim, against state polled out of the browser each loop
(`JSON.parse(JSON.stringify(__game.state))`).

> ⚠ Its policy is a port of the **pre-rebalance** saver (old list, no boss
> fund/profiles). It still wins on current constants but won't reproduce the
> ace results; tracked in [[lint]] L7.

```
npx tsx scripts/remote-play.ts [url] [mapId] [seed]
#   url default https://cuteness-overload.jasonyandell.workers.dev/
```

It `newGame`s at 2× speed, plays to completion, screenshots the end frame and dumps
final state to the scratchpad, and exits non-zero on a loss or any page/console
error. This is the end-to-end proof that the shipped build behaves identically to
the sim the balance was tuned against — commit `90f4a48` drove the saver policy to
a 20-wave win on the deployed site. See [[deployment]].

## Why one policy, three hosts

Because the [[architecture|sim is pure and JSON-serializable]], the identical
strategy code answers three questions: *is the game balanced* (`balance.ts`), *how
does one game unfold* (`ai-play.ts`), and *does production match the sim*
(`remote-play.ts`). Any change to `SAVER_LIST`, `coverageScore`, or the skip
heuristic should be kept in sync between `ai-play.ts` and `remote-play.ts` (they
duplicate the policy) — a known [[lint|maintenance hazard]].
</content>
