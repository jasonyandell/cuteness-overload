import type { TowerKind, TowerSpec, EnemyKind, EnemySpec, TowerStats, UpgradeTrack } from './types';

export const TICK = 1 / 30;            // fixed sim timestep, seconds
export const HEX_SIZE = 1;             // world units, flat-top
export const START_MONEY = 80;
export const START_LIVES = 20;
export const WAVE_INTERVAL = 25;       // seconds between auto wave calls
export const FIRST_WAVE_DELAY = 12;    // build time before wave 1
export const TOTAL_WAVES = 20;
export const SELL_REFUND = 0.7;

// Upgrade cost of level n (0-based current level): round(cost * UPGRADE_BASE * UPGRADE_GROWTH^n).
// FAIRNESS CONTRACT: each track's per-level value multiplier — measured in
// delivered damage (damage x rate x targets x range; see scripts/fairness.ts) —
// is tuned to ~UPGRADE_GROWTH, so every coin spent buys the same marginal
// damage (a slight taper is deliberate: one strong tower also enjoys
// positional advantage). What each tower's tracks grow lives in TOWERS below.
export const UPGRADE_BASE = 0.55;      // fraction of tower cost for first upgrade
export const UPGRADE_GROWTH = 1.5;

// Skip bonus: skipping with T seconds left on the timer earns floor(T * SKIP_RATE * (1 + wave*SKIP_WAVE_SCALE))
export const SKIP_RATE = 0.55;
export const SKIP_WAVE_SCALE = 0.06;

// End-of-wave income (paid when a wave is called, as "wage"): WAVE_INCOME_BASE + wave * WAVE_INCOME_SCALE
export const WAVE_INCOME_BASE = 12;
export const WAVE_INCOME_SCALE = 2;

// Enemy hp scaling per wave: hp = base * hpMul(map) * HP_GROWTH^(wave-1) * (endless extra after 20)
export const HP_GROWTH = 1.22;
// Bosses compound more gently: the wave-20 double-Chonk wall must be beatable
// by a well-saved (not perfect) economy. Trash keeps the steep curve so
// plinker-spam still collapses.
export const BOSS_HP_GROWTH = 1.16;
export const ENDLESS_HP_GROWTH = 1.3;  // growth per wave beyond 20
export const BOUNTY_GROWTH = 1.045;    // bounty growth per wave

// Per-tower upgrade tracks. Track keys 'dmg'/'spd' match Tower.dmgLevel/spdLevel
// (save/automation compatible); what a track actually grows is per tower —
// e.g. the freeze tower's 'dmg' track upgrades RANGE, not damage.
export const TOWERS: Record<TowerKind, TowerSpec> = {
  plinker: {
    // Fast and cheap with a deliberate CEILING: only 2 levels per track, so a
    // pile of plinkers can't carry the late game (max ~46 DPS, single target).
    name: 'Pebble Pal', cost: 20, range: 2.9, damage: 6.5, rate: 1.6,
    tracks: {
      dmg: { label: '⚔️ Damage', blurb: '+35% dmg', max: 2, dmgMul: 1.35 },
      spd: { label: '⚡ Speed', blurb: '+35% speed', max: 2, rateMul: 1.35 },
    },
    desc: 'Boops one darling at a time with teeny pebbles. Bless its heart, it tires by the tenth wave.',
  },
  freeze: {
    // Utility tower: its damage is token, so its tracks grow RANGE and RATE.
    name: 'Brr-Buddy', cost: 35, range: 2.6, damage: 3, rate: 0.9,
    slowFactor: 0.55, slowDuration: 2.0, splash: 1.6,
    tracks: {
      dmg: { label: '📡 Range', blurb: '+12% range, +10% area', max: 5, rangeMul: 1.12, splashMul: 1.1 },
      spd: { label: '⚡ Speed', blurb: '+45% speed', max: 5, rateMul: 1.45 },
    },
    desc: 'Blows frosty little kisses. Everyone nearby slows right down for a cuddle.',
  },
  cannon: {
    // Even damage on the field: upgrades widen the splash as they deepen it.
    name: 'Boop Cannon', cost: 60, range: 3.2, damage: 16, rate: 0.7, splash: 1.3,
    tracks: {
      dmg: { label: '⚔️ Damage', blurb: '+33% dmg, +7% splash', max: 5, dmgMul: 1.33, splashMul: 1.07, rangeMul: 1.03 },
      spd: { label: '⚡ Speed', blurb: '+45% speed', max: 5, rateMul: 1.45 },
    },
    desc: 'Lobs one enormous BOOP and shares the affection with the whole snuggly cluster.',
  },
  lightning: {
    // Damage down a chain of individuals: upgrades make late hops hit harder.
    name: 'Zappy Tickler', cost: 90, range: 3.4, damage: 14, rate: 1.0,
    chains: 4, chainFalloff: 0.72,
    tracks: {
      dmg: { label: '⚔️ Damage', blurb: '+38% dmg, chains hit harder', max: 5, dmgMul: 1.38, falloffAdd: 0.03, rangeMul: 1.03 },
      spd: { label: '⚡ Speed', blurb: '+45% speed', max: 5, rateMul: 1.45 },
    },
    desc: 'A tingly little zap that leaps friend-to-friend, holding hands all the way down.',
  },
  doom: {
    // A ton of damage on the field — if you can afford it.
    name: 'Big Hug', cost: 240, range: 3.8, damage: 90, rate: 0.26, splash: 2.4,
    tracks: {
      dmg: { label: '⚔️ Damage', blurb: '+35% dmg, +6% splash', max: 5, dmgMul: 1.35, splashMul: 1.06, rangeMul: 1.03 },
      spd: { label: '⚡ Speed', blurb: '+45% speed', max: 5, rateMul: 1.45 },
    },
    desc: 'One enormous, loving squeeze. Takes forever to wind up. Nobody in the whole huddle walks away.',
  },
};

/** Chain falloff can improve with upgrades but never past this. */
export const FALLOFF_CAP = 0.9;

/** Effective combat stats after applying both upgrade tracks (compounding). */
export function towerStats(t: { kind: TowerKind; dmgLevel: number; spdLevel: number }): TowerStats {
  const spec = TOWERS[t.kind];
  const s: TowerStats = {
    damage: spec.damage,
    rate: spec.rate,
    range: spec.range,
    splash: spec.splash ?? 0,
    falloff: spec.chainFalloff ?? 1,
    chains: spec.chains ?? 1,
  };
  const apply = (tr: UpgradeTrack, lvl: number) => {
    if (lvl <= 0) return;
    if (tr.dmgMul) s.damage *= Math.pow(tr.dmgMul, lvl);
    if (tr.rateMul) s.rate *= Math.pow(tr.rateMul, lvl);
    if (tr.rangeMul) s.range *= Math.pow(tr.rangeMul, lvl);
    if (tr.splashMul) s.splash *= Math.pow(tr.splashMul, lvl);
    if (tr.falloffAdd) s.falloff = Math.min(FALLOFF_CAP, s.falloff + tr.falloffAdd * lvl);
  };
  apply(spec.tracks.dmg, t.dmgLevel);
  apply(spec.tracks.spd, t.spdLevel);
  return s;
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  regular: { name: 'Bloop',  hp: 26,  speed: 0.95, bounty: 4, shield: 0,  livesCost: 1 },
  fast:    { name: 'Zippy',  hp: 16,  speed: 1.75, bounty: 4, shield: 0,  livesCost: 1 },
  shield:  { name: 'Shelly', hp: 34,  speed: 0.80, bounty: 7, shield: 30, livesCost: 1 },
  boss:    { name: 'Chonk',  hp: 420, speed: 0.55, bounty: 60, shield: 0, livesCost: 5 },
};

export const SHIELD_REGEN_DELAY = 2.5; // seconds unhit before shield regens
export const SHIELD_REGEN_RATE = 12;   // shield hp per second when regenerating
