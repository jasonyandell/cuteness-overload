// Cuteness Overload — remote player.
// Drives the DEPLOYED site in a real chromium browser and plays a full 20-wave
// game with the same "saver" policy as scripts/ai-play.ts, but every decision is
// executed through the page's window.__game.actions surface (place/upgrade/skip)
// instead of mutating a local sim. The policy (coverage scoring, shopping list,
// skip heuristic) is a faithful port of ai-play.ts and runs in Node against the
// state polled out of the browser each loop.
//
//   npx tsx scripts/remote-play.ts [url] [mapId] [seed]
//   url   : default https://cuteness-overload.jasonyandell.workers.dev/
//   mapId : meadow | creek | double   (default meadow)
//   seed  : integer                   (default 7)
import { chromium } from 'playwright';
import { MAPS } from '../src/sim/maps';
import { upgradeCost, totalEnemyHp } from '../src/sim/engine';
import { TOWERS, TOTAL_WAVES, DMG_MUL, SPD_MUL } from '../src/sim/constants';
import { hexToWorld, buildPathGeom } from '../src/sim/hex';
import type { GameState, MapDef, TowerKind, Tower } from '../src/sim/types';

declare const process: {
  argv: string[];
  exit(code: number): never;
  env: Record<string, string | undefined>;
};

const OUT_DIR = '/private/tmp/claude-501/-Users-jason-code-td/6adba84e-c768-41f2-b7cb-68211f30cff2/scratchpad';

// ---------------------------------------------------------------------------
// Coverage precompute (ported from ai-play.ts)
// ---------------------------------------------------------------------------
interface Coverage {
  samples: { x: number; z: number; mid: number }[];
  buildCells: { q: number; r: number; x: number; z: number }[];
}

function precompute(map: MapDef): Coverage {
  const samples: { x: number; z: number; mid: number }[] = [];
  const SAMPLE_STEP = 0.25;
  for (const path of map.paths) {
    const geom = buildPathGeom(path);
    const n = Math.max(2, Math.ceil(geom.length / SAMPLE_STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const d = t * geom.length;
      let seg = 1;
      while (seg < geom.cum.length && geom.cum[seg] < d) seg++;
      if (seg >= geom.pts.length) seg = geom.pts.length - 1;
      const a = geom.pts[seg - 1];
      const b = geom.pts[seg];
      const segLen = geom.cum[seg] - geom.cum[seg - 1] || 1;
      const lt = (d - geom.cum[seg - 1]) / segLen;
      const mid = 1 - Math.abs(t - 0.5) * 2;
      samples.push({ x: a.x + (b.x - a.x) * lt, z: a.z + (b.z - a.z) * lt, mid });
    }
  }
  const buildCells = map.cells
    .filter((c) => c.t === 'build')
    .map((c) => {
      const w = hexToWorld(c.q, c.r);
      return { q: c.q, r: c.r, x: w.x, z: w.z };
    });
  return { samples, buildCells };
}

function coverageScore(cov: Coverage, cx: number, cz: number, range: number): number {
  const r2 = range * range;
  let score = 0;
  for (const s of cov.samples) {
    const dx = s.x - cx;
    const dz = s.z - cz;
    if (dx * dx + dz * dz <= r2) score += 1 + s.mid * 0.5;
  }
  return score;
}

function bestCell(
  towers: Tower[],
  cov: Coverage,
  kind: TowerKind,
): { q: number; r: number } | null {
  const range = TOWERS[kind].range;
  const occupied = new Set(towers.map((t) => t.q + ',' + t.r));
  let best: { q: number; r: number } | null = null;
  let bestScore = -1;
  for (const c of cov.buildCells) {
    if (occupied.has(c.q + ',' + c.r)) continue;
    const s = coverageScore(cov, c.x, c.z, range);
    if (s > bestScore) {
      bestScore = s;
      best = { q: c.q, r: c.r };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// DPS estimate (ported)
// ---------------------------------------------------------------------------
function towerDps(t: Tower): number {
  const spec = TOWERS[t.kind];
  const dmg = spec.damage * Math.pow(DMG_MUL, t.dmgLevel);
  const rate = spec.rate * Math.pow(SPD_MUL, t.spdLevel);
  let mult = 1;
  if (t.kind === 'cannon' || t.kind === 'doom') mult = 2.2;
  else if (t.kind === 'lightning') mult = (spec.chains ?? 1) * 0.7;
  else if (t.kind === 'freeze') mult = 1.5;
  return dmg * rate * mult;
}

function teamDps(towers: Tower[]): number {
  let sum = 0;
  for (const t of towers) sum += towerDps(t);
  return sum;
}

// ---------------------------------------------------------------------------
// Saver shopping list (ported)
// ---------------------------------------------------------------------------
type Step =
  | { type: 'buy'; kind: TowerKind }
  | { type: 'up'; tower: number; which: 'dmg' | 'spd' };

const SAVER_LIST: Step[] = [
  { type: 'buy', kind: 'plinker' }, // 0
  { type: 'buy', kind: 'plinker' }, // 1
  { type: 'buy', kind: 'cannon' }, // 2
  { type: 'up', tower: 2, which: 'dmg' },
  { type: 'buy', kind: 'freeze' }, // 3
  { type: 'buy', kind: 'cannon' }, // 4
  { type: 'buy', kind: 'lightning' }, // 5
  { type: 'up', tower: 2, which: 'dmg' },
  { type: 'buy', kind: 'plinker' }, // 6
  { type: 'up', tower: 4, which: 'dmg' },
  { type: 'buy', kind: 'doom' }, // 7
  { type: 'up', tower: 7, which: 'dmg' },
];

const TAIL_BUYS: TowerKind[] = ['cannon', 'lightning', 'doom'];

interface PlayCtx {
  listIdx: number;
  placed: number[]; // tower id placed at each SAVER_LIST buy index
}

// A single policy decision computed from the current polled state. The driver
// executes it against the browser, then re-polls and asks again.
type Decision =
  | { type: 'buy'; kind: TowerKind; q: number; r: number; listIdx?: number }
  | { type: 'up'; towerId: number; which: 'dmg' | 'spd'; listIdx?: number }
  | { type: 'advance'; listIdx: number } // skip a dead list step (no browser action)
  | null;

/** Decide the next saver action from state. Mirrors saverAct's per-item logic,
 *  but returns one action at a time so the driver can apply it via the page. */
function nextSaverDecision(state: GameState, cov: Coverage, ctx: PlayCtx): Decision {
  if (ctx.listIdx < SAVER_LIST.length) {
    const stepDef = SAVER_LIST[ctx.listIdx];
    if (stepDef.type === 'buy') {
      if (state.money >= TOWERS[stepDef.kind].cost) {
        const cell = bestCell(state.towers, cov, stepDef.kind);
        if (cell) {
          return { type: 'buy', kind: stepDef.kind, q: cell.q, r: cell.r, listIdx: ctx.listIdx };
        }
        // no free cell — skip the step so we don't deadlock
        return { type: 'advance', listIdx: ctx.listIdx };
      }
      return null; // can't afford yet — wait
    } else {
      const id = ctx.placed[stepDef.tower];
      const tw = id != null ? state.towers.find((t) => t.id === id) : undefined;
      if (!tw) return { type: 'advance', listIdx: ctx.listIdx };
      const c = upgradeCost(tw, stepDef.which);
      if (c == null) return { type: 'advance', listIdx: ctx.listIdx };
      if (state.money >= c) {
        return { type: 'up', towerId: tw.id, which: stepDef.which, listIdx: ctx.listIdx };
      }
      return null; // save for it
    }
  }
  return tailDecision(state, cov);
}

/** Tail: best DPS-per-dollar upgrade or new cannon/lightning/doom. (ported) */
function tailDecision(state: GameState, cov: Coverage): Decision {
  let bestVal = 0;
  let bestCost = Infinity;
  let best: Decision = null;

  for (const t of state.towers) {
    const cur = towerDps(t);
    for (const which of ['dmg', 'spd'] as const) {
      const c = upgradeCost(t, which);
      if (c == null || state.money < c) continue;
      const gain = which === 'dmg' ? cur * (DMG_MUL - 1) : cur * (SPD_MUL - 1);
      const val = gain / c;
      if (val > bestVal) {
        bestVal = val;
        bestCost = c;
        best = { type: 'up', towerId: t.id, which };
      }
    }
  }

  for (const kind of TAIL_BUYS) {
    const cost = TOWERS[kind].cost;
    if (state.money < cost) continue;
    const cell = bestCell(state.towers, cov, kind);
    if (!cell) continue;
    const cw = hexToWorld(cell.q, cell.r);
    const covScore = coverageScore(cov, cw.x, cw.z, TOWERS[kind].range);
    if (covScore <= 0) continue;
    const fresh: Tower = {
      id: -1, kind, q: cell.q, r: cell.r, dmgLevel: 0, spdLevel: 0, cooldown: 0, spent: cost,
    };
    const gain = towerDps(fresh) * Math.min(1, covScore / 20);
    const val = gain / cost;
    if (val > bestVal) {
      bestVal = val;
      bestCost = cost;
      best = { type: 'buy', kind, q: cell.q, r: cell.r };
    }
  }

  if (best && state.money >= bestCost) return best;
  return null;
}

// ---------------------------------------------------------------------------
// Skip heuristic (ported)
// ---------------------------------------------------------------------------
function shouldSkip(state: GameState): boolean {
  if (state.wave >= TOTAL_WAVES) return false;
  if (state.spawnQueue.length > 0) return false;
  const secondsLeft = Math.max(0, state.nextWaveAt - state.time);
  if (secondsLeft <= 0.5) return false;
  const hp = totalEnemyHp(state);
  if (hp <= 0) return true;
  const dps = teamDps(state.towers);
  return hp < 0.6 * dps * secondsLeft;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const url = process.argv[2] ?? 'https://cuteness-overload.jasonyandell.workers.dev/';
  const mapId = process.argv[3] ?? 'meadow';
  const seed = Number(process.argv[4] ?? '7');

  const map = MAPS.find((m) => m.id === mapId);
  if (!map) throw new Error('unknown map ' + mapId);
  const cov = precompute(map);

  console.log(`\n=== remote-play ${url} map=${mapId} seed=${seed} ===`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, {
    timeout: 20000,
  });

  // Start a fresh game and run at 2x.
  await page.evaluate(
    ([m, s]) => {
      const g = (window as unknown as { __game: { actions: { newGame(a: string, b?: number): void } } }).__game;
      g.actions.newGame(m as string, s as number);
    },
    [mapId, seed],
  );
  await page.waitForFunction(
    () => (window as unknown as { __game: { state: unknown } }).__game.state !== null,
    { timeout: 8000 },
  );
  await page.evaluate(() =>
    (window as unknown as { __game: { actions: { setSpeed(x: 1 | 2): void } } }).__game.actions.setSpeed(2),
  );

  const poll = (): Promise<GameState> =>
    page.evaluate(
      () => JSON.parse(JSON.stringify((window as unknown as { __game: { state: GameState } }).__game.state)) as GameState,
    );
  const doPlace = (kind: TowerKind, q: number, r: number): Promise<boolean> =>
    page.evaluate(
      ([k, qq, rr]) =>
        (window as unknown as { __game: { actions: { place(k: string, q: number, r: number): boolean } } }).__game.actions.place(
          k as string,
          qq as number,
          rr as number,
        ),
      [kind, q, r],
    );
  const doUpgrade = (id: number, which: 'dmg' | 'spd'): Promise<boolean> =>
    page.evaluate(
      ([i, w]) =>
        (window as unknown as { __game: { actions: { upgrade(id: number, w: string): boolean } } }).__game.actions.upgrade(
          i as number,
          w as string,
        ),
      [id, which],
    );
  const doSkip = (): Promise<number> =>
    page.evaluate(() =>
      (window as unknown as { __game: { actions: { skip(): number } } }).__game.actions.skip(),
    );

  const ctx: PlayCtx = { listIdx: 0, placed: [] };

  // Spend as much as the policy dictates from the CURRENT state. Re-polls after
  // each executed action (money/towers change), like saverAct's inner loop.
  async function spendFully(): Promise<void> {
    for (let guard = 0; guard < 60; guard++) {
      const state = await poll();
      if (state.status !== 'playing') return;
      const d = nextSaverDecision(state, cov, ctx);
      if (d == null) return;
      if (d.type === 'advance') {
        ctx.listIdx = d.listIdx + 1;
        continue;
      }
      if (d.type === 'buy') {
        const ok = await doPlace(d.kind, d.q, d.r);
        if (!ok) return; // unexpected: unaffordable/invalid — bail this pass
        if (d.listIdx != null) {
          // record the placed tower's id for later upgrade references
          const after = await poll();
          const tw = after.towers.find((t) => t.q === d.q && t.r === d.r);
          if (tw) ctx.placed[d.listIdx] = tw.id;
          ctx.listIdx = d.listIdx + 1;
        }
      } else {
        const ok = await doUpgrade(d.towerId, d.which);
        if (!ok) return;
        if (d.listIdx != null) ctx.listIdx = d.listIdx + 1;
      }
    }
  }

  let lastLoggedWave = -1;
  let lastSkipCheck = 0;
  const startReal = Date.now();
  const MAX_REAL_MS = 12 * 60 * 1000; // generous cap

  for (;;) {
    await spendFully();

    const state = await poll();

    if (state.wave !== lastLoggedWave) {
      lastLoggedWave = state.wave;
      console.log(
        `  w${String(state.wave).padStart(2)} ` +
          `t=${state.time.toFixed(0).padStart(4)}s ` +
          `lives=${String(state.lives).padStart(2)} ` +
          `$=${String(Math.floor(state.money)).padStart(4)} ` +
          `twr=${state.towers.length} en=${state.enemies.length} kills=${state.kills}`,
      );
    }

    if (state.status !== 'playing') break;

    // Skip check throttled to sim-time to avoid pulling waves too aggressively.
    if (state.time - lastSkipCheck >= 0.4 && shouldSkip(state)) {
      lastSkipCheck = state.time;
      await doSkip();
      await spendFully();
    }

    if (Date.now() - startReal > MAX_REAL_MS) {
      console.log('TIMEOUT: exceeded real-time cap');
      break;
    }

    await page.waitForTimeout(350);
  }

  const finalState = await poll();
  const status = finalState.status;

  // Screenshot the end frame (win/lose overlay should be up).
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT_DIR}/remote-win.png` });

  // Dump final state.
  await page.evaluate(
    ([dump]) => {
      void dump;
    },
    ['x'],
  );
  const fs = await import('fs');
  fs.writeFileSync(`${OUT_DIR}/remote-final-state.json`, JSON.stringify(finalState, null, 2));

  console.log(
    `\nRESULT: ${status.toUpperCase()}  wave=${finalState.wave}  lives=${finalState.lives}  ` +
      `kills=${finalState.kills}  leaks=${finalState.leaks}  towers=${finalState.towers.length}  ` +
      `time=${finalState.time.toFixed(0)}s  money=${Math.floor(finalState.money)}`,
  );
  console.log(`errors=${errors.length}`);
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 20).join('\n'));
  console.log(`screenshot: ${OUT_DIR}/remote-win.png`);
  console.log(`final state: ${OUT_DIR}/remote-final-state.json`);

  await browser.close();

  const won = status === 'won';
  process.exit(won && errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
