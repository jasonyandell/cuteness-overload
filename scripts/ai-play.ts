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
import {
  TOWERS,
  ENEMIES,
  TICK,
  TOTAL_WAVES,
  HP_GROWTH,
  BOSS_HP_GROWTH,
  towerStats,
} from '../src/sim/constants';
import { waveComposition } from '../src/sim/waves';
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
/** Expected enemies hit per shot, assuming a typical linear density of mobs. */
function targetsPerShot(kind: TowerKind, stats: ReturnType<typeof towerStats>): number {
  const DENSITY = 0.8; // enemies per world unit along the path, mid-wave-ish
  if (kind === 'cannon' || kind === 'doom' || kind === 'freeze') {
    return 1 + stats.splash * 2 * DENSITY * 0.55; // splash covers a path chord
  }
  if (kind === 'lightning') {
    let sum = 1;
    let d = 1;
    for (let i = 1; i < stats.chains; i++) {
      d *= stats.falloff;
      sum += d;
    }
    return sum;
  }
  return 1;
}

function towerDps(t: Tower): number {
  const stats = towerStats(t);
  return stats.damage * stats.rate * targetsPerShot(t.kind, stats);
}

/** Expected BOSSES hit per shot at the wave-20 wall: the two Chonks walk ~1.7
 *  units apart, so a splash that spans that gap double-dips; chains reach the
 *  second boss through the escort. */
function bossTargetsPerShot(kind: TowerKind, stats: ReturnType<typeof towerStats>): number {
  if (kind === 'cannon' || kind === 'doom') return stats.splash >= 1.7 ? 2 : 1;
  if (kind === 'lightning') return 1 + stats.falloff * stats.falloff; // boss->escort->boss
  if (kind === 'freeze') return 0.5; // token damage; its slow is scored elsewhere
  return 1;
}

/** Delivered-damage value (the fairness metric): DPS x targets x time-in-range.
 *  bossMode scores against the boss wall instead of an average mob stream. */
function towerValue(t: Tower, bossMode = false): number {
  const stats = towerStats(t);
  const targets = bossMode
    ? bossTargetsPerShot(t.kind, stats)
    : targetsPerShot(t.kind, stats);
  return stats.damage * stats.rate * targets * stats.range;
}

function teamDps(state: GameState): number {
  let sum = 0;
  for (const t of state.towers) sum += towerDps(t);
  return sum;
}

/** Total scaled hp (incl. shields) the given wave will send. */
function waveThreat(wave: number, map: MapDef): number {
  let sum = 0;
  for (const part of waveComposition(wave)) {
    const spec = ENEMIES[part.kind];
    const boss = part.kind === 'boss';
    const growth = boss ? BOSS_HP_GROWTH : HP_GROWTH;
    const mapMul = boss ? 1 : map.hpMul; // bosses ignore hpMul (see spawnEnemy)
    sum += part.count * (spec.hp + spec.shield) * mapMul * Math.pow(growth, wave - 1);
  }
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
const SAVER_OPENING: Step[] = [
  { type: 'buy', kind: 'plinker' }, // 0 — early coverage
  { type: 'buy', kind: 'plinker' }, // 1
  { type: 'buy', kind: 'cannon' }, // 2 — first splash
  { type: 'up', tower: 2, which: 'dmg' }, // cannon dmg
  { type: 'buy', kind: 'freeze' }, // 3 — slow for swarms/shields
  { type: 'buy', kind: 'cannon' }, // 4 — second splash (covers 2nd path on double)
  { type: 'buy', kind: 'lightning' }, // 5 — swarm clear
  { type: 'up', tower: 2, which: 'dmg' }, // cannon dmg
  { type: 'buy', kind: 'plinker' }, // 6 — more coverage
  { type: 'up', tower: 4, which: 'dmg' }, // cannon2 dmg
  { type: 'buy', kind: 'doom' }, // 7 — THE big save; the discipline payoff
  { type: 'up', tower: 7, which: 'dmg' }, // doom dmg
  { type: 'up', tower: 7, which: 'spd' }, // doom spd
];

// Second-doom extension for multi-lane maps: with the wave split across two
// paths, one doom can't guard both lanes' bosses — buy and deepen another.
const SECOND_DOOM: Step[] = [
  { type: 'buy', kind: 'doom' }, // 8
  { type: 'up', tower: 8, which: 'dmg' },
  { type: 'up', tower: 8, which: 'spd' },
];

/** Saver endgame knobs — exported so tuning sweeps can explore them. */
export const SAVER_CFG = {
  bankStart: 14, // first wave whose overflow goes to the boss fund
  dumpWave: 18,  // wave at which the fund dumps into instant upgrades
  margin: 0,     // bank only while teamDps*18 > margin * next wave's hp (0 = always bank)
  secondDoom: false, // multi-lane maps: buy + deepen a second doom
  doomInDump: false, // allow the dump to buy a fresh doom (the payoff purchase)
};

/**
 * The saver's per-map game plan (like a human reading the level before playing):
 * - meadow: generous build space; bank late, everything into one deep kill zone.
 * - creek: long tight switchbacks; the mid-game is safe cheap coverage, so bank
 *   earlier and dump a wave sooner to absorb the wave-18 crunch.
 * - double: two lanes split the team, so keep spending while threatened
 *   (margin) and field a second doom — one per lane's boss.
 * These settings ACE (20 lives) all maps x seeds 1-5 at current constants.
 */
const SAVER_PROFILES: Record<string, Partial<typeof SAVER_CFG>> = {
  meadow: { bankStart: 14, dumpWave: 18, margin: 0, secondDoom: false },
  creek: { bankStart: 12, dumpWave: 17, margin: 0, secondDoom: false },
  double: { bankStart: 12, dumpWave: 17, margin: 1.6, secondDoom: true },
};
const SAVER_DEFAULTS = { ...SAVER_CFG };

function saverList(): Step[] {
  return SAVER_CFG.secondDoom ? [...SAVER_OPENING, ...SECOND_DOOM] : SAVER_OPENING;
}

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
  const list = saverList();
  // Advance through the fixed list as far as money allows this tick.
  let progressed = true;
  while (progressed) {
    progressed = false;
    if (ctx.listIdx < list.length) {
      const stepDef = list[ctx.listIdx];
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
      // Boss fund: waves BANK_START..DUMP_WAVE-1 the saver banks its overflow,
      // then dumps the whole fund into instant upgrades as the boss wall spawns
      // ("will I be able to save in time?" — the fun part, played straight).
      // Banking is threat-aware: only sit on money while the team comfortably
      // out-guns the next wave; if the margin thins, spend now instead.
      if (state.wave >= SAVER_CFG.bankStart && state.wave < SAVER_CFG.dumpWave) {
        const safe =
          SAVER_CFG.margin <= 0 ||
          teamDps(state) * 18 > SAVER_CFG.margin * waveThreat(state.wave + 1, map);
        if (safe) break;
      }
      // Tail policy: best-value upgrade or new tower with pooled money.
      // From the dump wave on, spend against the boss wall specifically —
      // falling back to general value so the fund never rots unspent.
      const bossMode = state.wave >= SAVER_CFG.dumpWave;
      progressed = tailUpgrade(state, map, cov, bossMode);
      if (!progressed && bossMode) progressed = tailUpgrade(state, map, cov, false);
    }
  }
}

// Tail once the scripted list is exhausted: greedily take the affordable action
// with the best DPS gain per dollar — either an upgrade on an existing tower or
// a new cannon/lightning/doom in the best free spot. Converts pooled late-game
// money into damage instead of letting it rot. (Still not "buy-down": it never
// spams cheap plinkers, it maximizes value.)
const TAIL_BUYS: TowerKind[] = ['cannon', 'lightning', 'doom'];

function tailUpgrade(state: GameState, map: MapDef, cov: Coverage, bossMode = false): boolean {
  let bestVal = 0;
  let bestAction: (() => void) | null = null;
  let bestCost = Infinity;

  // Upgrades on existing towers — marginal delivered-damage value per dollar.
  for (const t of state.towers) {
    const cur = towerValue(t, bossMode);
    for (const which of ['dmg', 'spd'] as const) {
      const c = upgradeCost(t, which);
      if (c == null || state.money < c) continue;
      const next: Tower = {
        ...t,
        dmgLevel: t.dmgLevel + (which === 'dmg' ? 1 : 0),
        spdLevel: t.spdLevel + (which === 'spd' ? 1 : 0),
      };
      const gain = towerValue(next, bossMode) - cur;
      const val = gain / c;
      if (val > bestVal) {
        bestVal = val;
        bestCost = c;
        bestAction = () => upgradeTower(state, t.id, which);
      }
    }
  }

  // New towers in the best free cell. In boss mode a fresh level-0 tower is
  // usually trap value (deepen the anchors instead) — except, optionally, a
  // second doom: the only base tower whose per-shot damage matters to bosses.
  const buys = bossMode ? (SAVER_CFG.doomInDump ? (['doom'] as TowerKind[]) : []) : TAIL_BUYS;
  for (const kind of buys) {
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
    const gain = towerValue(fresh) * Math.min(1, covScore / 20);
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
  loadout: string;
}

export function playGame(
  mapId: string,
  seed: number,
  strategyName: string,
  opts: {
    log?: boolean;
    maxWave?: number;
    cfg?: Partial<typeof SAVER_CFG>;
    /** Play endless mode: no wave-20 win; runs until death or maxWave. */
    endless?: boolean;
  } = {},
): PlayResult {
  const map = MAPS.find((m) => m.id === mapId);
  if (!map) throw new Error('unknown map ' + mapId);
  const strat = STRATEGIES[strategyName];
  if (!strat) throw new Error('unknown strategy ' + strategyName);
  if (strategyName === 'saver') {
    Object.assign(SAVER_CFG, SAVER_DEFAULTS, SAVER_PROFILES[mapId], opts.cfg);
  }

  const cov = precompute(map);
  const state = createGame(map, seed, opts.endless ?? false);
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

    // remember hp so a leak event can report how close the kill was
    const hpBefore = new Map<number, number>();
    for (const e of state.enemies) hpBefore.set(e.id, e.hp + e.shield);

    step(state, map);

    for (const ev of state.events) {
      if (ev.type === 'leak' && ev.kind === 'boss') {
        const hp = hpBefore.get(ev.enemyId) ?? -1;
        const line = `  !! boss leaked at w${state.wave} with ${hp.toFixed(0)} hp`;
        waveLog.push(line);
        if (opts.log) console.log(line);
      }
    }

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
    loadout: state.towers
      .map((t) => `${t.kind}[${t.dmgLevel}/${t.spdLevel}]$${t.spent}`)
      .join(' '),
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
  console.log('LOADOUT: ' + r.loadout);
}

// Run as CLI when invoked directly (not when imported by balance.ts).
// tsx sets import.meta.url; compare against argv[1].
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();

void TICK;
