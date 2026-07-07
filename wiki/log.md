# Wiki Log — Cuteness Overload

Append-only chronological record. Newest entries at the bottom. Entry format
(grep-able): `## [YYYY-MM-DD] <op> | <summary>` where `<op>` is one of
`genesis | ingest | query | lint | refactor`. See [[SCHEMA]].

---

## [2026-07-07] genesis | Initial wiki build from full repo read

Created the LLM-maintained wiki (Karpathy "LLM Wiki" pattern) over the Cuteness
Overload repo. Read the entire codebase: `DESIGN.md`, `BALANCE.md`, `README.md`,
all of `src/sim/`, `src/render/`, `src/ui/`, `src/main.ts`, `scripts/`, config
(`package.json`, `wrangler.toml`, `.github/workflows/deploy.yml`, `vite.config.ts`,
`tsconfig.json`, `index.html`), and git log.

**Pages created (17):**

- `SCHEMA.md` — conventions + INGEST/QUERY/LINT workflows.
- `index.md` — content catalog.
- `log.md` — this file.
- `lint.md` — open drift findings.
- `overview.md` — pitch, features, where-things-live map.
- `architecture.md` — layering, determinism, fixed timestep, RNG, events.
- `sim-engine.md` — `step()` order, targeting, damage/shield, serialization.
- `towers.md` — 5 towers, stats, upgrade math, cost formula, intent.
- `enemies.md` — 4 kinds, stats, HP/bounty scaling, shield regen, slow.
- `waves-economy.md` — cadence, composition table, income, skip bonus, endless.
- `maps.md` — 3 maps, measured stats, Double Trouble balance story.
- `balance.md` — saver/spender methodology, current table, changes, caveats.
- `rendering.md` — instancing, effects pooling, camera, black-enemy postmortem.
- `ui-flow.md` — screens, game loop, save/resume, `window.__game`.
- `ai-tester.md` — ai-play / balance / remote-play scripts and how to run them.
- `deployment.md` — Actions → Cloudflare Workers, secrets, live URL.
- `decisions.md` — 11 ADR-style decisions with rationale.

**Verification:** re-ran `npx tsx scripts/validate-maps.ts` and
`npx tsx scripts/balance.ts` to capture real current numbers rather than trusting
possibly-stale docs. Map stats and the balance table in the wiki are measured, not
copied. Balance target check reproduced `spender losses in wave 8-18 window: FAIL`
(see lint L3).

**Restyle-in-progress note:** at genesis, other agents were actively restyling
`src/render/` and `src/ui/` from the original pastel look toward a **bold primary,
kid-friendly palette** with bigger/bouncier shapes and a zoomed, pannable camera.
`src/render/theme.ts` and `src/ui/style.css` still read pastel on disk at genesis.
[[rendering]] and [[ui-flow]] describe the stable *strategy* and flag palette/camera
specifics as in-flux; lint L5 schedules a re-verify once the restyle lands.

**Lint findings filed (see [[lint]]):** L1 DESIGN.md "doom = slow AoE" vs code
(doom is damage, not slow); L2 BALANCE.md top table stale (shows pre-change Double
as unwinnable); L3 balance.ts 8–18 window assertion contradicts accepted wave-20
spender losses; L4 saver policy duplicated across ai-play/remote-play; L5
renderer/UI restyle re-verify pending.

Also created root `CLAUDE.md` pointing future sessions at this wiki.

## [2026-07-07] ingest | Renderer + UI restyle (bold crayon-primary "toy box")

Both restyle tasks landed and were verified. Re-read `src/render/theme.ts`,
`renderer.ts`, `textures.ts`, `effects.ts`, `src/ui/style.css`, `src/main.ts`.

Updated **[[rendering]]** and **[[ui-flow]]**:
- Palette → saturated crayon primaries (theme.ts + style.css). Enemies one strong
  primary each (Bloop blue, Zippy yellow, Shelly green, Chonk purple).
- Enemies ~1.7× bigger (box 0.95 / tetra 0.75 / octa 0.8 / boss icosa 1.5), chunky
  toy proportions.
- New animation section: squash-and-stretch **hop** (per-kind hopFreq/hopHeight,
  `hop=|sin|`), spawn **boing** (easeOutBack overshoot, 0.5s), tower **recoil pop**
  (0.22s squat-and-spring on shot/aoe). Driven by `consumeStyleEvents` +
  `updateTowers` (renamed from `updateDoomPulse`).
- Camera: zoomed in past fit (`zoomIn 0.6` → ~1.67× closer), new public API
  `panBy(dxPx,dyPx)` / `resetPan()`, clamped drag-the-map pan; `resetPan` on new
  game.
- Effects: confetti cap 96→200, death burst 6→16 chunkier bits.
- UI: chunky Toca-Boca/Duplo style — 4px ink outlines, hard offset sticker shadows,
  radius 26px. Canvas **drag-vs-tap** via `PAN_THRESHOLD = 10`px → `renderer.panBy`;
  a pan never places/selects.

Lint reconciliation: **L1, L2, L3 marked resolved** (team-lead fixed DESIGN.md doom
wording, relabeled BALANCE.md's historical table, widened balance.ts window to
8–20 — all verified in source). **L5 resolved** (restyle landed + pages
re-verified). New open **L6**: DESIGN.md line 41 Theme paragraph still says
"Pastel, soft, adorable" (owner: team-lead; DESIGN.md is a raw source the wiki
doesn't own). L4 (saver policy duplicated across ai-play/remote-play) remains open.
Updated [[index]] one-liners for rendering/ui-flow/lint.
</content>
