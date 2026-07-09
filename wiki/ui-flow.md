---
tags: [ui, gameloop, save, automation]
updated: 2026-07-07
source-files:
  - src/main.ts
  - src/ui/save.ts
  - src/ui/automation.ts
  - src/ui/dom.ts
  - src/ui/style.css
  - index.html
---

# UI Flow — screens, loop, save, automation

The UI is a single `App` class in `src/main.ts` driving a DOM overlay
(`#ui-root`) on top of the WebGL `#game-canvas` (see `index.html`). No framework —
tiny declarative helpers in `src/ui/dom.ts` (`el`, `clear`, `show`). Styling in
`src/ui/style.css`.

> **Style: chunky crayon-primary kid UI** (restyle landed 2026-07-07). `style.css`
> is now a bold Toca-Boca / Duplo look: crayon primaries
> (red/blue/yellow/green/purple CSS vars), **fat 4px dark-ink outlines**
> (`--border`), **hard offset "sticker" shadows** with no blur (`--pop`/`--pop-lg`),
> squishy press animations, and big rounded corners (`--radius: 26px`). The canvas
> now supports **drag-to-pan** (below). The *structure* — screens, loop, save,
> automation — is unchanged. See [[rendering]] for the matching 3D restyle.

## Screens

- **Menu** (`buildMenu`/`showMenu`) — title, map-select cards (from `MAPS`), and
  New Game / Continue. Continue appears only if a save exists (`hasSave`).
  New Game confirms before overwriting an existing save.
- **HUD** (`buildHud`) — top bar (lives 💖, money 🪙, skip button with live bonus
  preview, speed toggle, pause), a wave banner + countdown, a wave toast, and the
  bottom **build bar** of the 5 towers with affordability state.
- **Tower panel** — tapping a placed tower opens an upgrade panel (damage/speed
  pips + costs, sell for 70% refund). Replaces the build bar while open.
- **Overlays** (one at a time) — pause, win (confetti + stats + Endless button),
  lose (retry/menu), and a generic confirm dialog.

## The game loop (`App.loop`)

`requestAnimationFrame` driven, **fixed-timestep accumulator** (the browser half of
[[architecture|Rule 2]]):

1. Compute real elapsed `realDt` (capped at 2s so a backgrounded tab never
   fast-forwards wildly).
2. If playing and not paused: `acc += realDt * speed`; run `step(state, map)` while
   `acc >= TICK`, **capped at 8 steps/frame** (drop backlog past that to avoid a
   spiral of death). **2× speed = two steps per accumulated tick** — TICK is never
   changed.
3. Concatenate each step's `state.events` into `frameEvents`; react to `wave`
   events (toasts, boss callout) and `won`/`lost` transitions (show overlay, clear
   save).
4. Autosave every `SAVE_INTERVAL = 5`s of sim time.
5. `renderer.render(state, realDt, frameEvents)` — the combined events drive
   [[rendering|effects]].

Win/lose is detected by watching `state.status` change across frames
(`prevStatus`), since `step()` may flip it mid-frame.

## Save / resume design

`src/ui/save.ts`, localStorage. Two keys:

- **`cuteness-overload-save-v1`** — a `SaveBlob { mapId, state, savedAt }`. Because
  `GameState` is plain JSON ([[architecture|Rule 4]]), save = `JSON.stringify`,
  resume = parse + `renderer.setMap` (derived path geoms rebuild lazily in the
  engine). Written on autosave, on `visibilitychange`→hidden, and on `pagehide`.
  Cleared on win (non-endless) / loss / New Game overwrite. `readSave` also
  **forward-normalizes** old saves — any tower missing `dmgDealt` (added with
  per-tower damage tracking, see [[towers]]) is set to 0 so pre-existing saves
  never crash.
- **`cuteness-overload-meta-v1`** — a `Meta { speed }` (persisted speed toggle),
  separate from the save so settings survive across games.

All storage access is wrapped in try/catch — a full or disabled localStorage never
breaks play, it just skips persistence.

## Input & placement

Pointer events on the canvas (`wireCanvas`). A pointerdown starts tracking; once
the cumulative movement exceeds **`PAN_THRESHOLD = 10`px** the gesture becomes a
**camera pan** — each pointermove feeds the per-move delta to
[[rendering|`renderer.panBy(dx, dy)`]], and the pointerup neither places nor
selects (`wasPanning` short-circuits `onPointerUp`). Under the threshold it's a
**tap**: when a tower is **armed** (build-bar tap), pointer-move previews placement
via `renderer.pickHex` + `setHover` + `showRange`. On pointerup a tap on a cell
that **already holds a tower always selects that tower** (clearing the build
arming, opening its upgrade panel) — an existing tower wins over placement, even
mid-arming; otherwise, if armed, it places (`placeTower`). A tap on empty ground
with nothing armed closes the panel. `pointercancel` resets the gesture. The
selected tower's panel shows its lifetime damage and damage-per-coin (see
[[towers]]). `resetPan` is called on every new game
(`enterGame`). Right-click / Escape disarms. Keyboard: Escape backs out (disarm →
close panel → pause), Space toggles pause.

## Automation surface (`window.__game`)

`src/ui/automation.ts` types a `GameApi { state, actions }`; `main.ts` installs it
via `installAutomation` in the `App` constructor, and also exposes `window.__app`
for debugging. `actions` = `newGame, place, upgrade, sell, skip, setSpeed, pause,
resume, endless`. This is the exact surface [[ai-tester|remote-play]] drives to
play the deployed site headlessly, and the reason the same [[balance]] policy runs
locally and against production. `state` is the live `GameState` (null on the menu),
polled by remote automation as `JSON.parse(JSON.stringify(state))`.
</content>
