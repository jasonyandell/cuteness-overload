---
tags: [ai, testing, automation, scripts]
updated: 2026-07-07
source-files:
  - scripts/ai-play.ts
  - scripts/balance.ts
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

### The saver (intended winner)

A **fixed shopping list** (`SAVER_LIST`) executed strictly in order; each step only
fires when affordable — never buys ahead, never substitutes. The list:

```
plinker, plinker, cannon, up(cannon,dmg), freeze, cannon, lightning,
up(cannon,dmg), plinker, up(cannon2,dmg), doom, up(doom,dmg)
```

That is the "saving discipline": the big towers (cannon → lightning → **doom**)
are earned in order, not replaced by cheap plinkers. Doom is the payoff purchase.
After the list, a **value-greedy tail** (`tailUpgrade`) spends pooled money on the
best DPS-per-dollar action — an upgrade on an existing tower or a new
cannon/lightning/doom in the best free spot (never more plinkers). `towerDps`
estimates throughput with crude AoE/chain multipliers so splash towers aren't
undervalued.

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

Runs saver + spender across all 3 maps × seeds 1–5 (30 games, <1s total), prints a
detailed table, a per-map summary (win rate / avg wave / avg & min lives), and a
**target check**. Targets: `saver wins all` PASS, `spender loses all` PASS.

> Caveat: the third assertion, `spender losses in wave 8-18 window`, currently
> prints **FAIL** because Meadow/Creek spenders die at wave 20 — which is the
> accepted behavior documented in [[balance]]. The assertion window contradicts the
> accepted reality; tracked in [[lint]].

```
npx tsx scripts/balance.ts     # or: npm run balance
npm run ai                     # ai-play with defaults
```

## `scripts/remote-play.ts` — driving the deployed site

Plays the **live site** in a real headless Chromium (Playwright) using the *same*
saver policy, but every decision is executed through the page's
[[ui-flow|`window.__game.actions`]] surface instead of a local sim. The policy
(coverage scoring, `SAVER_LIST`, skip heuristic) is a **faithful port** of
`ai-play.ts`; it runs in Node against state polled out of the browser each loop
(`JSON.parse(JSON.stringify(__game.state))`).

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
