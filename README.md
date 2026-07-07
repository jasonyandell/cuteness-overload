# Cuteness Overload 💖

They're adorable. They're coming for your home.

A cute pastel hex-grid 3D tower defense game. 20 waves, 3 maps, 5 towers, optional endless mode.

- `npm run dev` — play locally
- `npm run build` — production build (typechecks first)
- `npm run ai` — headless AI plays a game (balance testing)
- `npm run balance` — run AI strategies across all maps × seeds, print results

Built with TypeScript, three.js, Vite. Deployed to Cloudflare via GitHub Actions.

## Architecture
See [DESIGN.md](DESIGN.md). Core idea: a pure deterministic sim (`src/sim/`, fixed 1/30s timestep, seeded RNG, plain-JSON state) that runs identically in the browser, in the headless balance AI, and under remote automation.
