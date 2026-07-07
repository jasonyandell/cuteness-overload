// Cuteness Overload — headless AI player.
// Runs the pure sim with a scripted "shopping list" strategy and prints a per-wave log.
//   npx tsx scripts/ai-play.ts [mapId] [seed] [strategy]
//   mapId   : meadow | creek | double   (default meadow)
//   seed    : integer                   (default 1)
//   strategy: saver | spender           (default saver)
//
// Design note: this player is deliberately dumb. The "saver" keeps a fixed build
// ORDER and only ever buys the NEXT item on it when affordable (win-by-saving
// discipline). The "spender" buys plinkers the instant it can (impatient baseline
// that should lose). Neither one reads the future or substitutes cheaper items.
import { MAPS } from '../src/sim/maps';
import {
  createGame,
  step,
  placeTower,
  canPlace,
  upgradeCost,
  upgradeTower,
  skipWave,
  totalEnemyHp,
} from '../src/sim/engine';
import { TOWERS, TICK, TOTAL_WAVES, DMG_MUL, SPD_MUL, MAX_UPGRADE } from '../src/sim/constants';
import { hexToWorld, buildPathGeom } from '../src/sim/hex';
import type { GameState, MapDef, TowerKind, Tower } from '../src/sim/types';

declare const process: { argv: string[]; exit(code: number): never };

// ---------------------------------------------------------------------------
// Coverage precompute: dense sample points along every path, so we can score a
// build cell by "how much path does a tower here actually cover".
// ---------------------------------------------------------------------------
interface Coverage {
  samples: { x: number; z: number; mid: number }[]; // mid: 0..1 how central along its path
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
      // walk the polyline to point at distance d
      let seg = 1;
      while (seg < geom.cum.length && geom.cum[seg] < d) seg++;
      if (seg >= geom.pts.length) seg = geom.pts.length - 1;
      const a = geom.pts[seg - 1];
      const b = geom.pts[seg];
      const segLen = geom.cum[seg] - geom.cum[seg - 1] || 1;
      const lt = (d - geom.cum[seg - 1]) / segLen;
      // "mid" weights central path points a touch higher than the endpoints.
      const mid = 1 - Math.abs(t - 0.5) * 2; // 0 at ends, 1 at middle
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

/** Score a candidate cell for a tower of the given range: weighted count of path
 *  sample points within range (mid points count a little extra). */
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

/** Pick the free build cell with the best coverage for this tower kind. */
function bestCell(
  state: GameState,
  cov: Coverage,
  kind: TowerKind,
): { q: number; r: number } | null {
  const range = TOWERS[kind].range;
  const occupied = new Set(state.towers.map((t) => t.q + ',' + t.r));
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
  return bestScore > 0 ? best : best; // may be null only if no free cells
}

// ---------------------------------------------------------------------------
// DPS estimate — rough single-target throughput of the whole team, used only to
// decide when it's safe to skip a wave for the bonus.
// ---------------------------------------------------------------------------
function towerDps(t: Tower): number {
  const spec = TOWERS[t.kind];
  const dmg = spec.damage * Math.pow(DMG_MUL, t.dmgLevel);
  const rate = spec.rate * Math.pow(SPD_MUL, t.spdLevel);
  let mult = 1;
  // Crude effective-target multipliers so AoE/chain towers aren't undervalued.
  if (t.kind === 'cannon' || t.kind === 'doom') mult = 2.2;
  else if (t.kind === 'lightning') mult = (spec.chains ?? 1) * 0.7;
  else if (t.kind === 'freeze') mult = 1.5;
  return dmg * rate * mult;
}

function teamDps(state: GameState): number {
  let sum = 0;
  for (const t of state.towers) sum += towerDps(t);
  return sum;
}

// ---------------------------------------------------------------------------
// Saver shopping list. Steps are executed strictly in order; a step only fires
// when it is affordable. Tower steps reference the Nth tower this list places.
// ---------------------------------------------------------------------------
type Step =
  | { type: 'buy'; kind: TowerKind }
  | { type: 'up'; tower: number; which: 'dmg' | 'spd' };

// Fixed prefix: get plinker coverage, freeze for the fast/shield waves, then
// scale into cannon -> lightning -> doom while upgrading the anchors. This is the
// "saving" discipline — the big towers (cannon, lightning, doom) are earned in
// order, never substituted with a pile of cheap plinkers.
const SAVER_LIST: Step[] = [
  { type: 'buy', kind: 'plinker' }, // 0
  { type: 'buy', kind: 'plinker' }, // 1
  { type: 'buy', kind: 'cannon' }, // 2
  { type: 'up', tower: 2, which: 'dmg' }, // cannon dmg
  { type: 'buy', kind: 'freeze' }, // 3
  { type: 'up', tower: 0, which: 'dmg' }, // plinker dmg
  { type: 'buy', kind: 'lightning' }, // 4
  { type: 'up', tower: 2, which: 'dmg' }, // cannon dmg
  { type: 'up', tower: 4, which: 'dmg' }, // lightning dmg
  { type: 'buy', kind: 'cannon' }, // 5
  { type: 'up', tower: 5, which: 'dmg' }, // cannon2 dmg
  { type: 'up', tower: 2, which: 'spd' }, // cannon spd
  { type: 'buy', kind: 'doom' }, // 6
  { type: 'up', tower: 6, which: 'dmg' }, // doom dmg
  { type: 'up', tower: 4, which: 'dmg' }, // lightning dmg
  { type: 'buy', kind: 'cannon' }, // 7
  { type: 'up', tower: 6, which: 'dmg' }, // doom dmg
  { type: 'up', tower: 5, which: 'spd' }, // cannon2 spd
  { type: 'up', tower: 2, which: 'dmg' }, // cannon dmg
  { type: 'buy', kind: 'lightning' }, // 8
  { type: 'up', tower: 6, which: 'spd' }, // doom spd
  { type: 'up', tower: 7, which: 'dmg' }, // cannon3 dmg
  { type: 'up', tower: 4, which: 'spd' }, // lightning spd
  { type: 'buy', kind: 'doom' }, // 9
  { type: 'up', tower: 9, which: 'dmg' }, // doom2 dmg
  { type: 'up', tower: 6, which: 'dmg' }, // doom dmg
  { type: 'up', tower: 8, which: 'dmg' }, // lightning2 dmg
  { type: 'up', tower: 5, which: 'dmg' }, // cannon2 dmg
  { type: 'up', tower: 3, which: 'spd' }, // freeze spd (more slow uptime)
];

interface Strategy {
  name: string;
  // return true if it spent money (so we can loop and keep spending)
  act(state: GameState, map: MapDef, cov: Coverage, ctx: PlayCtx): void;
  skips: boolean;
}

interface PlayCtx {
  listIdx: number;
  placed: number[]; // tower id placed at each SAVER_LIST buy index (by placement order)
}

function saverAct(state: GameState, map: MapDef, cov: Coverage, ctx: PlayCtx): void {
  // Advance through the fixed list as far as money allows this tick.
  let progressed = true;
  while (progressed) {
    progressed = false;
    if (ctx.listIdx < SAVER_LIST.length) {
      const stepDef = SAVER_LIST[ctx.listIdx];
      if (stepDef.type === 'buy') {
        if (state.money >= TOWERS[stepDef.kind].cost) {
          const cell = bestCell(state, cov, stepDef.kind);
          if (cell && placeTower(state, map, stepDef.kind, cell.q, cell.r)) {
            ctx.placed.push(state.towers[state.towers.length - 1].id);
            ctx.listIdx++;
            progressed = true;
          } else {
            // no free cell for this kind — skip the step so we don't deadlock
            ctx.listIdx++;
            progressed = true;
          }
        }
      } else {
        const id = ctx.placed[stepDef.tower];
        const tw = id != null ? state.towers.find((t) => t.id === id) : undefined;
        if (!tw) {
          ctx.listIdx++; // referenced tower never got placed; skip
          progressed = true;
        } else {
          const c = upgradeCost(tw, stepDef.which);
          if (c == null) {
            ctx.listIdx++; // maxed; skip
            progressed = true;
          } else if (state.money >= c) {
            upgradeTower(state, tw.id, stepDef.which);
            ctx.listIdx++;
            progressed = true;
          }
        }
      }
    } else {
      // Tail policy: best-value upgrade or new tower with pooled money.
      progressed = tailUpgrade(state, map, cov);
    }
  }
}

// Tail once the scripted list is exhausted: greedily take the affordable action
// with the best DPS gain per dollar — either an upgrade on an existing tower or
// a new cannon/lightning/doom in the best free spot. Converts pooled late-game
// money into damage instead of letting it rot. (Still not "buy-down": it never
// spams cheap plinkers, it maximizes value.)
const TAIL_BUYS: TowerKind[] = ['cannon', 'lightning', 'doom'];

function tailUpgrade(state: GameState, map: MapDef, cov: Coverage): boolean {
  let bestVal = 0;
  let bestAction: (() => void) | null = null;
  let bestCost = Infinity;

  // Upgrades on existing towers.
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
        bestAction = () => upgradeTower(state, t.id, which);
      }
    }
  }

  // New towers in the best free cell.
  for (const kind of TAIL_BUYS) {
    const cost = TOWERS[kind].cost;
    if (state.money < cost) continue;
    const cell = bestCell(state, cov, kind);
    if (!cell || state.towers.some((t) => t.q === cell.q && t.r === cell.r)) continue;
    // coverage factor so an ill-covered spot is worth less
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
      bestAction = () => placeTower(state, map, kind, cell.q, cell.r);
    }
  }

  if (bestAction && state.money >= bestCost) {
    bestAction();
    return true;
  }
  return false;
}

function spenderAct(state: GameState, map: MapDef, cov: Coverage, _ctx: PlayCtx): void {
  // Impatient: buy plinkers on the best remaining spot the instant affordable;
  // when out of spots, dump money into plinker upgrades. Never saves, never skips.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const cost = TOWERS.plinker.cost;
    if (state.money >= cost) {
      const cell = bestCell(state, cov, 'plinker');
      const occupied = state.towers.length;
      const freeCellExists =
        cell != null && !state.towers.some((t) => t.q === cell.q && t.r === cell.r);
      if (freeCellExists && occupied < cov.buildCells.length) {
        if (placeTower(state, map, 'plinker', cell!.q, cell!.r)) {
          progressed = true;
          continue;
        }
      }
    }
    // out of good spots -> upgrade a plinker (dmg first), cheapest available
    let best: { id: number; which: 'dmg' | 'spd'; cost: number } | null = null;
    for (const t of state.towers) {
      if (t.kind !== 'plinker') continue;
      for (const which of ['dmg', 'spd'] as const) {
        const c = upgradeCost(t, which);
        if (c == null) continue;
        if (!best || c < best.cost || (c === best.cost && which === 'dmg')) {
          best = { id: t.id, which, cost: c };
        }
      }
    }
    if (best && state.money >= best.cost) {
      upgradeTower(state, best.id, best.which);
      progressed = true;
    }
  }
}

const STRATEGIES: Record<string, Strategy> = {
  saver: { name: 'saver', act: saverAct, skips: true },
  spender: { name: 'spender', act: spenderAct, skips: false },
};

// ---------------------------------------------------------------------------
// Skip decision — saver only. Skip early to bank the bonus + compress dead time
// when the field can clearly be handled before the next auto-call.
// ---------------------------------------------------------------------------
function shouldSkip(state: GameState): boolean {
  if (state.wave >= TOTAL_WAVES) return false; // can't skip the last wave
  // Never skip while the called wave(s) are still spawning — otherwise we'd pull
  // the next wave on top of enemies that haven't even appeared yet (hp reads 0).
  if (state.spawnQueue.length > 0) return false;
  const secondsLeft = Math.max(0, state.nextWaveAt - state.time);
  if (secondsLeft <= 0.5) return false;
  const hp = totalEnemyHp(state);
  if (hp <= 0) return true; // field clear and nothing queued — bank the bonus
  const dps = teamDps(state);
  // Safe to pull the next wave if we can chew through what's out there with margin.
  return hp < 0.6 * dps * secondsLeft;
}

// ---------------------------------------------------------------------------
export interface PlayResult {
  mapId: string;
  seed: number;
  strategy: string;
  status: 'won' | 'lost';
  wave: number;
  lives: number;
  money: number;
  kills: number;
  leaks: number;
  time: number;
  towers: number;
  waveLog: string[];
}

export function playGame(
  mapId: string,
  seed: number,
  strategyName: string,
  opts: { log?: boolean; maxWave?: number } = {},
): PlayResult {
  const map = MAPS.find((m) => m.id === mapId);
  if (!map) throw new Error('unknown map ' + mapId);
  const strat = STRATEGIES[strategyName];
  if (!strat) throw new Error('unknown strategy ' + strategyName);

  const cov = precompute(map);
  const state = createGame(map, seed);
  const ctx: PlayCtx = { listIdx: 0, placed: [] };
  const maxWave = opts.maxWave ?? TOTAL_WAVES;

  const waveLog: string[] = [];
  let lastLoggedWave = -1;
  const MAX_TICKS = 300000; // safety cap (~2.7 hrs sim); real games are far shorter

  for (let i = 0; i < MAX_TICKS; i++) {
    // spend before stepping so new towers can act this tick
    strat.act(state, map, cov, ctx);
    if (strat.skips && shouldSkip(state)) {
      skipWave(state, map);
      strat.act(state, map, cov, ctx); // spend the skip bonus right away
    }

    step(state, map);

    // one-line log per wave, captured just after the wave was called
    if (state.wave !== lastLoggedWave) {
      lastLoggedWave = state.wave;
      const line =
        `  w${String(state.wave).padStart(2)} ` +
        `t=${state.time.toFixed(0).padStart(4)}s ` +
        `lives=${String(state.lives).padStart(2)} ` +
        `$=${String(Math.floor(state.money)).padStart(4)} ` +
        `twr=${state.towers.length} ` +
        `en=${state.enemies.length} ` +
        `kills=${state.kills}`;
      waveLog.push(line);
      if (opts.log) console.log(line);
    }

    if (state.status !== 'playing') break;
    // stop once we've cleared the requested wave cap (endless never enabled)
    if (state.wave >= maxWave && state.enemies.length === 0 && state.spawnQueue.length === 0) {
      if (state.status === 'playing') {
        // treat surviving the cap as a win for balance purposes
        state.status = 'won';
      }
      break;
    }
  }

  return {
    mapId,
    seed,
    strategy: strategyName,
    status: state.status === 'lost' ? 'lost' : 'won',
    wave: state.wave,
    lives: state.lives,
    money: Math.floor(state.money),
    kills: state.kills,
    leaks: state.leaks,
    time: state.time,
    towers: state.towers.length,
    waveLog,
  };
}

// ---- CLI entry ----
function main(): void {
  const mapId = process.argv[2] ?? 'meadow';
  const seed = Number(process.argv[3] ?? '1');
  const strategy = process.argv[4] ?? 'saver';
  console.log(`\n=== ${mapId} seed=${seed} strategy=${strategy} ===`);
  const r = playGame(mapId, seed, strategy, { log: true });
  console.log(
    `\nRESULT: ${r.status.toUpperCase()}  wave=${r.wave}  lives=${r.lives}  ` +
      `kills=${r.kills}  leaks=${r.leaks}  towers=${r.towers}  ` +
      `time=${r.time.toFixed(0)}s  money=${r.money}`,
  );
}

// Run as CLI when invoked directly (not when imported by balance.ts).
// tsx sets import.meta.url; compare against argv[1].
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();

void TICK;
void MAX_UPGRADE;
