// Cuteness Overload — shared sim types. THE contract between sim, renderer, UI, and AI tester.
// The sim is pure data + pure functions: no DOM, no Date, no Math.random (seeded RNG only).

export type Hex = { q: number; r: number }; // axial coords, flat-top hexes

export type Terrain = 'build' | 'path' | 'blocked' | 'spawn' | 'home';

export interface MapDef {
  id: string;
  name: string;
  /** Every playable hex on the map with its terrain. */
  cells: { q: number; r: number; t: Terrain }[];
  /** Ordered hex paths, spawn -> home. Enemies pick one (round-robin by spawn index). */
  paths: Hex[][];
  /** Difficulty knob: income/bounty multiplier for this map (1 = baseline). */
  incomeMul: number;
  /** Difficulty knob: enemy hp multiplier for this map (1 = baseline). */
  hpMul: number;
}

export type TowerKind = 'plinker' | 'freeze' | 'cannon' | 'lightning' | 'doom';
export type EnemyKind = 'regular' | 'fast' | 'shield' | 'boss';

/**
 * One upgrade track. Each level multiplies the listed stats (compounding).
 * Cost of level n (0-based current level): round(cost * UPGRADE_BASE * UPGRADE_GROWTH^n).
 * Fairness contract (see scripts/fairness.ts): the per-level product of the
 * multipliers, measured in delivered damage (damage x rate x targets x range),
 * should roughly match UPGRADE_GROWTH so money spent is money earned.
 */
export interface UpgradeTrack {
  label: string;      // UI button label, e.g. '⚔️ Damage'
  blurb: string;      // UI one-liner, e.g. '+40% dmg'
  max: number;        // levels available on this track
  dmgMul?: number;    // per-level damage multiplier
  rateMul?: number;   // per-level fire-rate multiplier
  rangeMul?: number;  // per-level range multiplier
  splashMul?: number; // per-level splash-radius multiplier
  falloffAdd?: number; // lightning: per-level chain falloff improvement (additive)
}

export interface TowerSpec {
  name: string;       // cute display name
  cost: number;
  range: number;      // world units (hex size = 1, center-to-center dist = ~1.732)
  damage: number;     // base damage per shot
  rate: number;       // shots per second (base)
  splash?: number;    // cannon/doom/freeze: splash radius in world units
  chains?: number;    // lightning: max total targets hit
  chainFalloff?: number; // damage multiplier per jump
  slowFactor?: number;   // freeze: speed multiplier applied to targets
  slowDuration?: number; // freeze: seconds of slow
  /** The two upgrade tracks, keyed by the Tower fields they level ('dmg'/'spd'). */
  tracks: { dmg: UpgradeTrack; spd: UpgradeTrack };
  desc: string;
}

/** Effective combat stats of a tower after applying both upgrade tracks. */
export interface TowerStats {
  damage: number;
  rate: number;
  range: number;
  splash: number;   // 0 when the tower has no splash
  falloff: number;  // 1 when the tower has no chains
  chains: number;
}

export interface EnemySpec {
  name: string;
  hp: number;         // base hp at wave 1 (scaled by wave + map hpMul)
  speed: number;      // world units / sec
  bounty: number;     // money on kill (scaled by map incomeMul)
  shield: number;     // extra hp pool that regenerates when unhit (shield kind only)
  livesCost: number;  // lives lost on leak
}

export interface Tower {
  id: number;
  kind: TowerKind;
  q: number;
  r: number;
  dmgLevel: number;   // 0..tracks.dmg.max for this tower kind
  spdLevel: number;   // 0..tracks.spd.max for this tower kind
  cooldown: number;   // seconds until next shot
  spent: number;      // total money invested (for sell refund)
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pathIdx: number;    // which of map.paths
  dist: number;       // distance travelled along path (world units)
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  speed: number;      // base speed
  slowLeft: number;   // seconds of slow remaining
  slowFactor: number; // current slow multiplier (1 = none)
  bounty: number;
  livesCost: number;
  x: number;          // world position, derived each tick from dist
  z: number;
  lastHitAt: number;  // sim time of last damage taken (for shield regen)
}

export type SimEvent =
  | { type: 'shot'; towerId: number; targetId: number; kind: TowerKind }
  | { type: 'chain'; fromId: number; toId: number }
  | { type: 'aoe'; x: number; z: number; radius: number; kind: TowerKind }
  | { type: 'die'; enemyId: number; kind: EnemyKind; x: number; z: number }
  | { type: 'leak'; enemyId: number; kind: EnemyKind }
  | { type: 'spawn'; enemyId: number }
  | { type: 'wave'; wave: number }
  | { type: 'won' }
  | { type: 'lost' };

export interface SpawnItem {
  at: number;         // sim time to spawn
  kind: EnemyKind;
  wave: number;       // wave it belongs to (hp scaling)
  pathIdx: number;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameState {
  mapId: string;
  seed: number;
  rngState: number;   // mulberry32 internal state — serialize/restore for resume
  tick: number;       // sim ticks elapsed (TICK = 1/30 s each)
  time: number;       // sim seconds elapsed
  status: GameStatus;
  endless: boolean;   // player opted into endless after wave 20
  wave: number;       // last wave that has been called (0 before first)
  nextWaveAt: number; // sim time next wave auto-calls
  lives: number;
  money: number;
  nextId: number;
  towers: Tower[];
  enemies: Enemy[];
  spawnQueue: SpawnItem[];
  /** events emitted by the LAST step() call — renderer reads, sim overwrites each tick */
  events: SimEvent[];
  kills: number;
  leaks: number;
}

// ---- Engine public API (implemented in engine.ts) ----
// createGame(mapId, seed, endless?): GameState
// step(state): void                      — advance exactly one TICK (1/30 s), mutates state
// canPlace(state, map, kind, q, r): boolean
// placeTower(state, map, kind, q, r): boolean   — false if invalid/unaffordable
// upgradeCost(tower, which): number | null      — null if maxed
// upgradeTower(state, towerId, which: 'dmg'|'spd'): boolean
// sellTower(state, towerId): boolean            — refunds SELL_REFUND * spent
// skipWave(state): number                       — calls next wave now, returns bonus earned
// startEndless(state): void                     — after 'won', continue playing
