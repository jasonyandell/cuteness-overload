---
tags: [deploy, ci, cloudflare]
updated: 2026-07-07
source-files:
  - .github/workflows/deploy.yml
  - wrangler.toml
  - package.json
  - vite.config.ts
  - src/ui/automation.ts
---

# Deployment — GitHub Actions → Cloudflare Workers

The game ships as a static Vite build served by **Cloudflare Workers static
assets**, deployed automatically on push to `main`.

## Live URL

`https://cuteness-overload.jasonyandell.workers.dev/`

(The default target of [[ai-tester|`scripts/remote-play.ts`]].)

## Build

`package.json` scripts:

- `npm run dev` — Vite dev server (local play).
- `npm run build` — `tsc --noEmit && vite build` (typecheck gate, then bundle to
  `dist/`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run ai` / `npm run balance` — headless [[ai-tester]].

Vite config (`vite.config.ts`) is minimal: `build.target = 'es2022'`, default base
`/`. Output goes to `dist/`.

## Hosting (`wrangler.toml`)

```toml
name = "cuteness-overload"
compatibility_date = "2025-01-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

Static assets from `dist/`, SPA fallback (any unknown path serves `index.html`).

## CI pipeline (`.github/workflows/deploy.yml`)

Triggers: push to `main`, or manual `workflow_dispatch`. Steps:

1. checkout, setup Node 20 (npm cache)
2. `npm ci`
3. `npm run typecheck`  ← fails the build on any TS error
4. `npm run build`
5. `cloudflare/wrangler-action@v3` to deploy

### Secrets (GitHub repo → Actions secrets)

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Both are referenced in the wrangler-action step. Note the balance/typecheck run in
CI but the balance **sweep is not** a gate — only `typecheck` and `build` block the
deploy. (Consider adding `npm run balance` as a gate if balance regressions should
block ship; not currently wired.)

## How to redeploy

Push to `main` (or run the workflow manually via `workflow_dispatch`). No manual
`wrangler deploy` is needed for normal releases. To verify a release end-to-end,
run [[ai-tester|`scripts/remote-play.ts`]] against the live URL — it plays a full
game through `window.__game` and exits non-zero on loss or page error.

## Related

- The automation surface that makes remote verification possible: [[ui-flow]] and
  `src/ui/automation.ts`.
- What "identical in browser and headless" buys us: [[architecture]].
</content>
