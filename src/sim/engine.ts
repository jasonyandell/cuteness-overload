// Cuteness Overload — deterministic simulation core.
// Pure data + pure functions: no DOM, no Date, no Math.random. Fixed timestep TICK.
import type {
  MapDef,
  GameState,
  Enemy,
  Tower,
  TowerKind,
  TowerSpec,
  SpawnItem,
  Terrain,
} from './types';
import {
  TICK,
  START_MONEY,
  START_LIVES,
  FIRST_WAVE_DELAY,
  WAVE_INTERVAL,
  TOTAL_WAVES,
  SELL_REFUND,
  UPGRADE_BASE,
  UPGRADE_GROWTH,
  towerStats,
  SKIP_RATE,
  SKIP_WAVE_SCALE,
  WAVE_INCOME_BASE,
  WAVE_INCOME_SCALE,
  HP_GROWTH,
  BOSS_HP_GROWTH,
  ENDLESS_HP_GROWTH,
  BOUNTY_GROWTH,
  SHIELD_REGEN_DELAY,
  SHIELD_REGEN_RATE,
  TOWERS,
  ENEMIES,
} from './constants';
import { buildPathGeom, pointAt, hexToWorld, hexKey, type PathGeom } from './hex';
import { rngNext } from './rng';
import { waveComposition, spawnGap, flattenWave } from './waves';

// ---- Derived, non-serialized caches (rebuilt from MapDef.id on demand) ----
// Keyed by map.id so save/load works: GameState carries only mapId, and these
// are lazily reconstructed the first time a map is stepped after a resume.
const geomCache = new Map<string, PathGeom[]>();
const cellCache = new Map<string, Map<string, Terrain>>();

function getGeoms(map: MapDef): PathGeom[] {
  let g = geomCache.get(map.id);
  if (!g) {
    g = map.paths.map(buildPathGeom);
    geomCache.set(map.id, g);
  }
  return g;
}

function getCells(map: MapDef): Map<string, Terrain> {
  let c = cellCache.get(map.id);
  if (!c) {
    c = new Map();
    for (const cell of map.cells) c.set(hexKey(cell.q, cell.r), cell.t);
    cellCache.set(map.id, c);
  }
  return c;
}

// Finite sentinel (JSON-safe, unlike -Infinity) meaning "never hit yet".
const NEVER = -1e9;

// ---- Lifecycle ----
export function createGame(map: MapDef, seed: number, endless = false): GameState {
  return {
    mapId: map.id,
    seed,
    rngState: seed | 0,
    tick: 0,
    time: 0,
    status: 'playing',
    endless,
    wave: 0,
    nextWaveAt: FIRST_WAVE_DELAY,
    lives: START_LIVES,
    money: START_MONEY,
    nextId: 1,
    towers: [],
    enemies: [],
    spawnQueue: [],
    events: [],
    kills: 0,
    leaks: 0,
  };
}

function waveLimit(state: GameState): number {
  return state.endless ? Infinity : TOTAL_WAVES;
}

// ---- Wave calling (shared by auto-call and skipWave) ----
function callWave(state: GameState, map: MapDef): void {
  state.wave++;
  const w = state.wave;

  // Wage paid on every wave call.
  const income = Math.floor((WAVE_INCOME_BASE + w * WAVE_INCOME_SCALE) * map.incomeMul);
  state.money += income;

  // Build the spawn schedule, spread over ~8-14s with per-kind cadence.
  const list = flattenWave(waveComposition(w));
  const nPaths = map.paths.length;
  let t = 0.3; // small lead-in before the first enemy
  for (let i = 0; i < list.length; i++) {
    const kind = list[i];
    const gap = spawnGap(kind);
    const jitter = (rngNext(state) - 0.5) * gap * 0.3;
    const item: SpawnItem = {
      at: state.time + t + jitter,
      kind,
      wave: w,
      pathIdx: i % nPaths,
    };
    state.spawnQueue.push(item);
    t += gap;
  }

  state.events.push({ type: 'wave', wave: w });
  state.nextWaveAt = state.time + WAVE_INTERVAL;
}

function spawnEnemy(state: GameState, map: MapDef, item: SpawnItem): void {
  const spec = ENEMIES[item.kind];
  const w = item.wave;
  // Bosses use their own gentler curve and ignore the map's hpMul: map
  // difficulty lives in the trash waves; the boss-wall climax is the same
  // save-up test everywhere (and stays beatable on the harder maps).
  const boss = item.kind === 'boss';
  const growth = boss ? BOSS_HP_GROWTH : HP_GROWTH;
  let scale = (boss ? 1 : map.hpMul) * Math.pow(growth, w - 1);
  if (w > 20) scale *= Math.pow(ENDLESS_HP_GROWTH, w - 20);

  const hp = spec.hp * scale;
  const shield = spec.shield * scale;
  const bounty = Math.round(spec.bounty * map.incomeMul * Math.pow(BOUNTY_GROWTH, w - 1));

  const geom = getGeoms(map)[item.pathIdx];
  const p = pointAt(geom, 0);

  const e: Enemy = {
    id: state.nextId++,
    kind: item.kind,
    pathIdx: item.pathIdx,
    dist: 0,
    hp,
    maxHp: hp,
    shield,
    maxShield: shield,
    speed: spec.speed,
    slowLeft: 0,
    slowFactor: 1,
    bounty,
    livesCost: spec.livesCost,
    x: p.x,
    z: p.z,
    lastHitAt: NEVER,
  };
  state.enemies.push(e);
  state.events.push({ type: 'spawn', enemyId: e.id });
}

// ---- Damage helpers ----
function damageEnemy(state: GameState, e: Enemy, amount: number): void {
  if (amount <= 0) return;
  e.lastHitAt = state.time;
  if (e.shield > 0) {
    if (amount <= e.shield) {
      e.shield -= amount;
      return;
    }
    amount -= e.shield;
    e.shield = 0;
  }
  e.hp -= amount;
}

// Freeze slow: never stacks — keep the strongest factor (lowest) and longest duration.
function applySlow(e: Enemy, factor: number, duration: number): void {
  if (duration <= 0) return;
  if (e.slowLeft <= 0) {
    e.slowFactor = factor;
    e.slowLeft = duration;
  } else {
    e.slowFactor = Math.min(e.slowFactor, factor);
    e.slowLeft = Math.max(e.slowLeft, duration);
  }
}

function fire(
  state: GameState,
  tower: Tower,
  spec: TowerSpec,
  stats: ReturnType<typeof towerStats>,
  target: Enemy,
): void {
  const dmg = stats.damage;

  switch (tower.kind) {
    case 'plinker': {
      damageEnemy(state, target, dmg);
      state.events.push({ type: 'shot', towerId: tower.id, targetId: target.id, kind: 'plinker' });
      break;
    }

    case 'lightning': {
      state.events.push({ type: 'shot', towerId: tower.id, targetId: target.id, kind: 'lightning' });
      const maxTargets = stats.chains;
      const falloff = stats.falloff;
      const hit = new Set<number>([target.id]);
      let current = target;
      let curDmg = dmg;
      damageEnemy(state, current, curDmg);
      for (let j = 1; j < maxTargets; j++) {
        let next: Enemy | null = null;
        let nd = Infinity;
        for (const e of state.enemies) {
          if (hit.has(e.id) || e.hp <= 0) continue;
          const dx = e.x - current.x;
          const dz = e.z - current.z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= 2.2 * 2.2 && d2 < nd) {
            nd = d2;
            next = e;
          }
        }
        if (!next) break;
        curDmg *= falloff;
        damageEnemy(state, next, curDmg);
        state.events.push({ type: 'chain', fromId: current.id, toId: next.id });
        hit.add(next.id);
        current = next;
      }
      break;
    }

    case 'cannon':
    case 'doom': {
      damageEnemy(state, target, dmg);
      state.events.push({ type: 'shot', towerId: tower.id, targetId: target.id, kind: tower.kind });
      const r = stats.splash;
      if (r > 0) {
        const tx = target.x;
        const tz = target.z;
        for (const e of state.enemies) {
          if (e.id === target.id) continue;
          const dx = e.x - tx;
          const dz = e.z - tz;
          if (dx * dx + dz * dz <= r * r) damageEnemy(state, e, dmg);
        }
        state.events.push({ type: 'aoe', x: tx, z: tz, radius: r, kind: tower.kind });
      }
      break;
    }

    case 'freeze': {
      const r = stats.splash;
      const tx = target.x;
      const tz = target.z;
      const factor = spec.slowFactor ?? 1;
      const duration = spec.slowDuration ?? 0;
      for (const e of state.enemies) {
        const dx = e.x - tx;
        const dz = e.z - tz;
        if (dx * dx + dz * dz <= r * r) {
          damageEnemy(state, e, dmg);
          applySlow(e, factor, duration);
        }
      }
      state.events.push({ type: 'aoe', x: tx, z: tz, radius: r, kind: 'freeze' });
      break;
    }
  }
}

// ---- Main step: advance exactly one TICK ----
export function step(state: GameState, map: MapDef): void {
  state.events = [];
  if (state.status !== 'playing') return;

  const geoms = getGeoms(map);

  // (1) auto-call wave
  if (state.time >= state.nextWaveAt && state.wave < waveLimit(state)) {
    callWave(state, map);
  }

  // (2) process spawn queue (waves overlap, so this spans multiple waves)
  if (state.spawnQueue.length > 0) {
    const remaining: SpawnItem[] = [];
    for (const item of state.spawnQueue) {
      if (item.at <= state.time) spawnEnemy(state, map, item);
      else remaining.push(item);
    }
    state.spawnQueue = remaining;
  }

  // (3) move enemies, tick slow, regen shields
  for (const e of state.enemies) {
    let factor = 1;
    if (e.slowLeft > 0) {
      factor = e.slowFactor;
      e.slowLeft -= TICK;
      if (e.slowLeft <= 0) {
        e.slowLeft = 0;
        e.slowFactor = 1;
      }
    }
    e.dist += e.speed * factor * TICK;
    const p = pointAt(geoms[e.pathIdx], e.dist);
    e.x = p.x;
    e.z = p.z;

    if (e.maxShield > 0 && e.shield < e.maxShield && state.time - e.lastHitAt >= SHIELD_REGEN_DELAY) {
      e.shield = Math.min(e.maxShield, e.shield + SHIELD_REGEN_RATE * TICK);
    }
  }

  // (4) towers acquire (furthest along path in range) and fire
  for (const tower of state.towers) {
    if (tower.cooldown > 0) {
      tower.cooldown -= TICK;
      continue;
    }
    const spec = TOWERS[tower.kind];
    const stats = towerStats(tower);
    const tw = hexToWorld(tower.q, tower.r);
    const r2 = stats.range * stats.range;
    let target: Enemy | null = null;
    let best = -1;
    for (const e of state.enemies) {
      const dx = e.x - tw.x;
      const dz = e.z - tw.z;
      if (dx * dx + dz * dz <= r2 && e.dist > best) {
        best = e.dist;
        target = e;
      }
    }
    if (!target) continue;
    fire(state, tower, spec, stats, target);
    tower.cooldown = 1 / stats.rate;
  }

  // (5) reap dead (bounty) and leaked (lives)
  const survivors: Enemy[] = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      state.money += e.bounty;
      state.kills++;
      state.events.push({ type: 'die', enemyId: e.id, kind: e.kind, x: e.x, z: e.z });
      continue;
    }
    if (e.dist >= geoms[e.pathIdx].length) {
      state.lives -= e.livesCost;
      state.leaks++;
      state.events.push({ type: 'leak', enemyId: e.id, kind: e.kind });
      continue;
    }
    survivors.push(e);
  }
  state.enemies = survivors;

  // (6) win/lose
  if (state.lives <= 0) {
    state.lives = 0;
    state.status = 'lost';
    state.events.push({ type: 'lost' });
  } else if (
    !state.endless &&
    state.wave >= TOTAL_WAVES &&
    state.enemies.length === 0 &&
    state.spawnQueue.length === 0
  ) {
    state.status = 'won';
    state.events.push({ type: 'won' });
  }

  state.time += TICK;
  state.tick++;
}

// ---- Placement / economy ----
export function canPlace(
  state: GameState,
  map: MapDef,
  kind: TowerKind,
  q: number,
  r: number,
): boolean {
  if (getCells(map).get(hexKey(q, r)) !== 'build') return false;
  for (const t of state.towers) if (t.q === q && t.r === r) return false;
  return state.money >= TOWERS[kind].cost;
}

export function placeTower(
  state: GameState,
  map: MapDef,
  kind: TowerKind,
  q: number,
  r: number,
): boolean {
  if (!canPlace(state, map, kind, q, r)) return false;
  const cost = TOWERS[kind].cost;
  state.money -= cost;
  state.towers.push({
    id: state.nextId++,
    kind,
    q,
    r,
    dmgLevel: 0,
    spdLevel: 0,
    cooldown: 0,
    spent: cost,
  });
  return true;
}

export function upgradeCost(tower: Tower, which: 'dmg' | 'spd'): number | null {
  const level = which === 'dmg' ? tower.dmgLevel : tower.spdLevel;
  if (level >= TOWERS[tower.kind].tracks[which].max) return null;
  return Math.round(TOWERS[tower.kind].cost * UPGRADE_BASE * Math.pow(UPGRADE_GROWTH, level));
}

export function upgradeTower(state: GameState, towerId: number, which: 'dmg' | 'spd'): boolean {
  const tower = state.towers.find((t) => t.id === towerId);
  if (!tower) return false;
  const cost = upgradeCost(tower, which);
  if (cost == null || state.money < cost) return false;
  state.money -= cost;
  tower.spent += cost;
  if (which === 'dmg') tower.dmgLevel++;
  else tower.spdLevel++;
  return true;
}

export function sellTower(state: GameState, towerId: number): boolean {
  const i = state.towers.findIndex((t) => t.id === towerId);
  if (i < 0) return false;
  state.money += Math.floor(SELL_REFUND * state.towers[i].spent);
  state.towers.splice(i, 1);
  return true;
}

// ---- Wave control ----
export function skipWave(state: GameState, map: MapDef): number {
  if (state.status !== 'playing' || state.wave >= waveLimit(state)) return 0;
  const remaining = Math.max(0, state.nextWaveAt - state.time);
  const bonus = Math.floor(remaining * SKIP_RATE * (1 + state.wave * SKIP_WAVE_SCALE));
  state.money += bonus;
  callWave(state, map);
  return bonus;
}

export function startEndless(state: GameState): void {
  if (state.status !== 'won') return;
  state.endless = true;
  state.status = 'playing';
  state.nextWaveAt = state.time + 5;
}

// ---- AI-tester convenience ----
export function totalEnemyHp(state: GameState): number {
  let sum = 0;
  for (const e of state.enemies) sum += e.hp + e.shield;
  return sum;
}
