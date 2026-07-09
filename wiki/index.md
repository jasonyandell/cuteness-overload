---
tags: [meta, index, catalog]
updated: 2026-07-08
source-files: []
---

# Wiki Index — Cuteness Overload

The content catalog for the [[SCHEMA|LLM-maintained wiki]]. Every page listed once,
by category, with a one-line summary. **Update this on every page add / rename /
delete.** Start here.

New to the wiki? Read [[SCHEMA]] (conventions + INGEST/QUERY/LINT workflows) first,
then [[overview]].

## Meta

- [[SCHEMA]] — conventions, frontmatter, wikilinks, and the ingest/query/lint workflows. Read first.
- [[index]] — this catalog.
- [[log]] — append-only chronological record of every wiki change.
- [[lint]] — doc-vs-code / doc-vs-doc drift findings (open + resolved) for human review.

## Orientation

- [[overview]] — elevator pitch, feature list, and a map of where everything lives.
- [[architecture]] — the pure-sim / renderer / UI / automation layering; determinism, fixed timestep, seeded RNG, event system, why headless + remote play work.
- [[decisions]] — ADR-style list of the load-bearing design decisions with rationale.

## Simulation (`src/sim/`)

- [[sim-engine]] — `step()` internals: step order, targeting, damage/shield model, serialization/resume.
- [[towers]] — the 5 towers: stats, evil-cute display names, per-tower upgrade tracks, the delivered-damage fairness contract, per-tower `dmgDealt` accounting, cost formula, sell refund, design intent.
- [[enemies]] — the 4 enemy kinds: stats, HP/bounty scaling (trash 1.22× vs boss 1.16×, hpMul exemption), shield regen, slow.
- [[waves-economy]] — 25s cadence, wave composition table, spawn scheduling, wave income, skip-bonus formula, endless scaling, the "save up to win" thesis.
- [[maps]] — the 3 maps: measured stats, difficulty knobs, the Double Trouble balance story.

## Presentation

- [[rendering]] — three.js renderer: bold crayon-primary style, instancing (incl. per-enemy health bars), hop/boing/recoil animation, effects pooling (incl. evil-cute heart death poof), path-hex range highlight, zoomed pannable camera, black-enemy postmortem.
- [[ui-flow]] — screens, fixed-timestep game loop, save/resume (with dmgDealt normalization), tower-select-wins-over-placement, damage stat panel, chunky primary UI + drag-to-pan, the `window.__game` automation API.

## Testing, balance & ops

- [[balance]] — AI-tester methodology (saver vs spender), the 2026-07-08 fairness rebalance, current measured table (saver ACES all maps), known caveats.
- [[ai-tester]] — how the headless player (boss fund + per-map profiles), balance sweep, fairness report, and remote driver work; how to run them.
- [[deployment]] — GitHub Actions → Cloudflare Workers, secrets, live URL, redeploy + verify.

---

**Page count:** 17 (incl. this index, [[log]], [[SCHEMA]], [[lint]]).
**Raw sources** (immutable, outside `wiki/`): the repo code plus
[DESIGN.md](../DESIGN.md) and [BALANCE.md](../BALANCE.md).
</content>
