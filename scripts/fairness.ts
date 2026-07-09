// Cuteness Overload — upgrade fairness report.
//
// The fairness contract: whenever the game charges you more, it gives you more.
// "More" is measured as DELIVERED DAMAGE — total damage a tower deals to an
// average stream of mobs moving at average speed across its range in a straight
// line (deliberately rough; directional correctness is the goal, not a thesis):
//
//   value = damage x rate x E[targets per shot] x time-in-range
//   time-in-range  = chord through the range circle / avg mob speed
//   E[targets]     = 1 for single-target; splash/chains add expected extras
//                    at a typical linear mob density along the path
//
// For every tower and both upgrade tracks this prints, per level:
//   - marginal value gained per coin for that level (mVal/$)
//   - cumulative value per coin including the base tower (cVal/$)
// normalized so the BASE tower = 1.00. Fair means mVal/$ stays ~1.00
// (a mild taper is acceptable — a single strong tower also enjoys positional
// advantage); the old 1.45x-value / 1.6x-cost exponential decayed hard.
//
//   npx tsx scripts/fairness.ts
import { TOWERS, UPGRADE_BASE, UPGRADE_GROWTH, towerStats } from '../src/sim/constants';
import { ENEMIES } from '../src/sim/constants';
import type { Tower, TowerKind } from '../src/sim/types';

// Average mob: mean speed of the three common kinds; typical spacing mid-wave.
const AVG_SPEED =
  (ENEMIES.regular.speed + ENEMIES.fast.speed + ENEMIES.shield.speed) / 3;
const DENSITY = 0.8; // mobs per world unit along the path
const PATH_OFFSET = 1.7; // tower sits ~1 hex (1.732) off the path

function expectedTargets(kind: TowerKind, stats: ReturnType<typeof towerStats>): number {
  if (kind === 'cannon' || kind === 'doom' || kind === 'freeze') {
    // splash circle centered on a mob walking the line: expected extras are the
    // mobs within the chord the splash cuts across the path
    return 1 + stats.splash * 2 * DENSITY * 0.55;
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

function deliveredValue(t: Pick<Tower, 'kind' | 'dmgLevel' | 'spdLevel'>): number {
  const stats = towerStats(t as Tower);
  const chord =
    stats.range > PATH_OFFSET
      ? 2 * Math.sqrt(stats.range * stats.range - PATH_OFFSET * PATH_OFFSET)
      : 0.1;
  const timeInRange = chord / AVG_SPEED;
  return stats.damage * stats.rate * expectedTargets(t.kind, stats) * timeInRange;
}

function levelCost(kind: TowerKind, level: number): number {
  return Math.round(TOWERS[kind].cost * UPGRADE_BASE * Math.pow(UPGRADE_GROWTH, level));
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

function report(kind: TowerKind): void {
  const spec = TOWERS[kind];
  const base = deliveredValue({ kind, dmgLevel: 0, spdLevel: 0 });
  const basePerCoin = base / spec.cost;
  console.log(`\n${spec.name} (${kind}) — cost ${spec.cost}, base value/$ = 1.00`);

  for (const which of ['dmg', 'spd'] as const) {
    const track = spec.tracks[which];
    console.log(`  track ${which} (${track.label.replace(/^\S+\s/, '')}, max ${track.max}):`);
    console.log(`    ${pad('lvl', 4)} ${pad('cost', 6)} ${pad('mVal/$', 8)} ${pad('cVal/$', 8)}`);
    let spent = spec.cost;
    let prev = base;
    for (let lvl = 0; lvl < track.max; lvl++) {
      const cost = levelCost(kind, lvl);
      const t = {
        kind,
        dmgLevel: which === 'dmg' ? lvl + 1 : 0,
        spdLevel: which === 'spd' ? lvl + 1 : 0,
      };
      const val = deliveredValue(t);
      spent += cost;
      const marginal = (val - prev) / cost / basePerCoin;
      const cumulative = val / spent / basePerCoin;
      console.log(
        `    ${pad(lvl + 1, 4)} ${pad(cost, 6)} ${pad(marginal.toFixed(2), 8)} ${pad(cumulative.toFixed(2), 8)}`,
      );
      prev = val;
    }
  }
}

console.log('=== Upgrade fairness — delivered damage per coin (base tower = 1.00) ===');
console.log(`avg mob speed ${AVG_SPEED.toFixed(2)}, density ${DENSITY}/unit, path offset ${PATH_OFFSET}`);
(Object.keys(TOWERS) as TowerKind[]).forEach(report);
console.log(
  '\nNote: freeze is a utility tower — its value is the slow, not damage; its' +
    '\ntracks grow range/area and rate, which scale the slow uptime the same way.',
);
