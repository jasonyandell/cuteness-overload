---
tags: [lint, drift, findings]
updated: 2026-07-08
source-files:
  - DESIGN.md
  - BALANCE.md
  - src/sim/engine.ts
  - src/sim/constants.ts
  - src/sim/maps.ts
  - scripts/balance.ts
  - scripts/ai-play.ts
  - scripts/remote-play.ts
---

# Lint — findings

Doc-vs-code and doc-vs-doc drift found during the LINT workflow (see [[SCHEMA]]).
These are for **human judgment** — the wiki describes current code correctly; the
items below are inconsistencies in the *raw source docs* or code assertions that a
human may want to reconcile. Genesis pass: 2026-07-07. Most genesis findings were
reconciled the same day (see Resolved).

## Open

### L4 — Saver policy duplicated across two scripts  (maintenance hazard)

The saver strategy (`SAVER_LIST`, `coverageScore`, `bestCell`, `shouldSkip`,
`towerDps`, tail logic) is copy-pasted between `scripts/ai-play.ts` (local sim) and
`scripts/remote-play.ts` (drives `window.__game`). They must be kept in sync by
hand; a change to one silently diverges the other. Not a bug today (they match),
but a standing hazard. **Fix candidate:** extract the shared policy into a module
both import. See [[ai-tester]], [[decisions]] D11.

### L7 — remote-play.ts runs the pre-rebalance saver policy  (open)

The 2026-07-08 fairness rebalance upgraded `scripts/ai-play.ts`'s saver (boss
fund, boss-mode dump, per-map `SAVER_PROFILES`, second doom, `towerValue`), but
`scripts/remote-play.ts` still carries the old ported list/tail. Verified 2026-07-08:
the old policy **still wins** on current constants (headless equivalent: wins all
maps, 10–20 lives), so remote verification remains sound — it just won't
reproduce the ace results. This sharpens the L4 duplication hazard. **Fix
candidate:** extract the shared policy module (L4) or re-port. See [[ai-tester]].

### L8 — BALANCE.md and DESIGN.md predate the fairness rebalance  (open, owner: team-lead)

Both raw docs describe the old upgrade system (global +45%/+30% multipliers,
`UPGRADE_GROWTH 1.6`, plinker 5 upgrade levels, doom-rate story, shared boss HP
curve) and BALANCE.md's tables/narrative no longer match `scripts/balance.ts`
output. The wiki ([[towers]], [[balance]], [[enemies]]) is current; treat the raw
docs as historical until rewritten.

### L6 — DESIGN.md Theme paragraph still says "pastel"  (open, owner: team-lead)

The bold crayon-primary restyle landed in `src/render/theme.ts` and
`src/ui/style.css` (2026-07-07), but `DESIGN.md` line 41 still reads *"Pastel,
soft, adorable."* [[rendering]] and [[ui-flow]] now describe the true bold-primary
state; DESIGN.md is a raw source the wiki does not own. **Fix candidate:** update
DESIGN.md's Theme paragraph to the crayon-primary "toy box" direction. Owner:
team-lead.

---

## Resolved

### L1 — DESIGN.md "doom = slow AoE" contradicted code  (resolved 2026-07-07)

DESIGN.md line 27 said *"doom = huge slow AoE."* Fixed by team-lead to *"doom =
huge AoE, slow-firing (no slow effect — freeze owns slows),"* matching the code
(doom is damage splash, no slow). See [[decisions]] D9, [[towers]].

### L2 — BALANCE.md stale "current constants" table  (resolved 2026-07-07)

The top table is now labeled *"Result at the ORIGINAL constants (historical —
before the recommended changes were applied)"* with a note that the current result
comes from re-running `scripts/balance.ts`. No longer misleading. See [[balance]].

### L3 — balance.ts target window contradicted accepted behavior  (resolved 2026-07-07)

`scripts/balance.ts` widened its assertion to `wave >= 8 && wave <= 20` (with a
comment referencing BALANCE.md's accepted w17–20 boss-wall losses); the check now
prints `spender losses in wave 8-20 window` and PASSES on current constants. See
[[balance]], [[ai-tester]].

### L5 — Renderer/UI restyle in flight at genesis  (resolved 2026-07-07)

The bold crayon-primary restyle (renderer + UI) landed and was verified. [[rendering]]
and [[ui-flow]] were re-verified against the committed files and updated (palette,
bigger/bouncier shapes with hop/boing/recoil, zoomed pannable camera, chunky UI +
10px drag-vs-tap). The one remaining DESIGN.md discrepancy was split out as L6.
</content>
