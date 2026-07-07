# Cuteness Overload — repo orientation

A cute hex-grid 3D tower defense (TypeScript + three.js + Vite), deployed to
Cloudflare Workers. The design's core idea: **one pure deterministic simulation**
(`src/sim/`, fixed 1/30s timestep, seeded RNG, plain-JSON state) that runs
identically in the browser, in a headless Node balance AI, and under remote
browser automation.

## Layout

- `src/sim/` — pure deterministic sim. **No DOM, no `Date`, no `Math.random`**
  (seeded RNG only). The contract; code here is ground truth.
- `src/render/` — three.js renderer (reads state, draws it, animates events).
- `src/ui/` + `src/main.ts` — DOM HUD, menus, game loop, save/load, and the
  `window.__game` automation surface.
- `scripts/` — headless AI player (`ai-play.ts`), balance sweep (`balance.ts`),
  map validator (`validate-maps.ts`), and remote site driver (`remote-play.ts`).
- `.github/workflows/deploy.yml`, `wrangler.toml` — CI + hosting.
- `DESIGN.md`, `BALANCE.md` — original design/balance docs (see wiki note below).

## Common commands

```
npm run dev        # play locally (Vite)
npm run build      # tsc --noEmit && vite build
npm run balance    # AI saver vs spender across all maps × seeds
npm run ai         # one headless AI game with a per-wave log
npx tsx scripts/validate-maps.ts   # map invariant checks
```

## 📚 This repo has an LLM-maintained wiki at `wiki/`

Detailed, interlinked design docs live in `wiki/`. **Read `wiki/SCHEMA.md` first**
for conventions and workflows, then `wiki/index.md` (the catalog of every page).

- `wiki/index.md` — content catalog; start here after SCHEMA.
- `wiki/log.md` — append-only history of wiki changes.
- `wiki/lint.md` — known doc-vs-code drift (e.g. DESIGN.md/BALANCE.md staleness).

**After any code change, run the INGEST workflow** (in `wiki/SCHEMA.md`): update
the wiki pages whose `source-files` frontmatter lists the changed file, refresh
`wiki/index.md` if pages changed, and append a `wiki/log.md` entry. The wiki
answers most mechanics/balance questions without re-reading code — but code is
always the ground truth; if they disagree, the wiki is stale (fix it).

Note: `DESIGN.md` and `BALANCE.md` are the original human docs and have some known
drift from current code — see `wiki/lint.md` before trusting their exact numbers.
</content>
