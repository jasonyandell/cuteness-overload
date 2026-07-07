import type { TowerKind, TowerSpec, EnemyKind, EnemySpec } from './types';

export const TICK = 1 / 30;            // fixed sim timestep, seconds
export const HEX_SIZE = 1;             // world units, flat-top
export const START_MONEY = 80;
export const START_LIVES = 20;
export const WAVE_INTERVAL = 25;       // seconds between auto wave calls
export const FIRST_WAVE_DELAY = 12;    // build time before wave 1
export const TOTAL_WAVES = 20;
export const MAX_UPGRADE = 5;          // levels per upgrade track
export const SELL_REFUND = 0.7;

// Upgrades: each dmg level multiplies damage by DMG_MUL; each spd level multiplies rate by SPD_MUL.
// Cost of level n (1-based): round(cost * UPGRADE_BASE * UPGRADE_GROWTH^(n-1))
export const DMG_MUL = 1.45;
export const SPD_MUL = 1.30;
export const UPGRADE_BASE = 0.75;      // fraction of tower cost for first upgrade
export const UPGRADE_GROWTH = 1.6;

// Skip bonus: skipping with T seconds left on the timer earns floor(T * SKIP_RATE * (1 + wave*SKIP_WAVE_SCALE))
export const SKIP_RATE = 0.55;
export const SKIP_WAVE_SCALE = 0.06;

// End-of-wave income (paid when a wave is called, as "wage"): WAVE_INCOME_BASE + wave * WAVE_INCOME_SCALE
export const WAVE_INCOME_BASE = 12;
export const WAVE_INCOME_SCALE = 2;

// Enemy hp scaling per wave: hp = base * hpMul(map) * HP_GROWTH^(wave-1) * (endless extra after 20)
export const HP_GROWTH = 1.22;
export const ENDLESS_HP_GROWTH = 1.3;  // growth per wave beyond 20
export const BOUNTY_GROWTH = 1.045;    // bounty growth per wave

export const TOWERS: Record<TowerKind, TowerSpec> = {
  plinker: {
    name: 'Pebble Plinker', cost: 20, range: 2.9, damage: 7, rate: 1.6,
    desc: 'Cheap and cheerful. Plinks one cutie at a time.',
  },
  freeze: {
    name: 'Brr Blaster', cost: 35, range: 2.6, damage: 3, rate: 0.9,
    slowFactor: 0.55, slowDuration: 2.0, splash: 1.6,
    desc: 'Chilly pulse that slows everything nearby.',
  },
  cannon: {
    name: 'Boop Cannon', cost: 60, range: 3.2, damage: 16, rate: 0.7, splash: 1.3,
    desc: 'Lobs a big boop. Splash damage.',
  },
  lightning: {
    name: 'Zap Zapper', cost: 90, range: 3.4, damage: 14, rate: 1.0,
    chains: 4, chainFalloff: 0.72,
    desc: 'Zaps a cutie, then ricochets to friends.',
  },
  doom: {
    name: 'Snuggle Nuke', cost: 240, range: 3.8, damage: 90, rate: 0.18, splash: 2.4,
    desc: 'Extremely strong. Extremely slow. Extremely snuggly.',
  },
};

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  regular: { name: 'Bloop',  hp: 26,  speed: 0.95, bounty: 4, shield: 0,  livesCost: 1 },
  fast:    { name: 'Zippy',  hp: 16,  speed: 1.75, bounty: 4, shield: 0,  livesCost: 1 },
  shield:  { name: 'Shelly', hp: 34,  speed: 0.80, bounty: 7, shield: 30, livesCost: 1 },
  boss:    { name: 'Chonk',  hp: 420, speed: 0.55, bounty: 60, shield: 0, livesCost: 5 },
};

export const SHIELD_REGEN_DELAY = 2.5; // seconds unhit before shield regens
export const SHIELD_REGEN_RATE = 12;   // shield hp per second when regenerating
