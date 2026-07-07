---
tags: [overview, pitch]
updated: 2026-07-07
source-files:
  - DESIGN.md
  - README.md
  - src/sim/constants.ts
---

# Overview — Cuteness Overload

**Elevator pitch:** a cute, hex-grid 3D tower defense. Adorable geometric enemies
march set paths to your little house; you defend with 5 towers across 20 waves
(bosses on 10 & 20), then optional endless. Title tagline: *"they're adorable.
they're coming for your home."*

## Core loop

Place towers on build cells near the path → enemies spawn each wave and walk the
path → towers auto-fire → kills pay bounty, leaks cost lives → survive wave 20
(field clear, queue empty) to win → optionally continue into [[waves-economy|endless]].

## The design thesis: save, don't spam

The economy is built so that **saving for premium splash/nuke towers beats
spamming cheap single-target plinkers**. A patient "saver" wins all maps; an
impatient "spender" loses. This is verified continuously by a headless
[[ai-tester]] and documented in [[balance]].

## Feature list

- **5 towers** — Pebble Plinker, Brr Blaster (freeze), Boop Cannon, Zap Zapper
  (lightning), Snuggle Nuke (doom). Each has damage + attack-speed upgrades
  (5 levels each). See [[towers]].
- **4 enemy kinds** — Bloop (regular), Zippy (fast), Shelly (shielded), Chonk
  (boss). See [[enemies]].
- **3 maps** — Meadow Lane, Twisty Creek, Double Trouble, of increasing
  difficulty. See [[maps]].
- **20 waves + endless**, 25s auto-cadence with a paying **skip** button. See
  [[waves-economy]].
- **Pure deterministic sim** (fixed 1/30s timestep, seeded RNG, plain-JSON state)
  that runs identically in the browser, in the headless balance AI, and under
  remote browser automation. See [[architecture]] and [[sim-engine]].
- **three.js renderer** tuned for 60fps on mid phones — instanced meshes, pooled
  effects. See [[rendering]].
- **Save/resume** to localStorage, mobile-first DOM UI. See [[ui-flow]].
- **Automated balance + remote play** via `window.__game`. See [[ai-tester]].
- **Deployed to Cloudflare Workers** via GitHub Actions. See [[deployment]].

## Where things live

| Layer | Path | Page |
|---|---|---|
| Deterministic sim | `src/sim/` | [[sim-engine]], [[towers]], [[enemies]], [[waves-economy]], [[maps]] |
| Renderer | `src/render/` | [[rendering]] |
| UI + game loop | `src/ui/`, `src/main.ts` | [[ui-flow]] |
| Headless / remote AI | `scripts/` | [[ai-tester]], [[balance]] |
| Deploy | `.github/`, `wrangler.toml` | [[deployment]] |
| Key decisions | — | [[decisions]] |

Starting resources: `START_MONEY = 80`, `START_LIVES = 20`, first wave after
`FIRST_WAVE_DELAY = 12`s (all in `src/sim/constants.ts`).
</content>
