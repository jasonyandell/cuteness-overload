// Cuteness Overload — wave composition. Pure, deterministic, no side effects.
// Distribution: regulars always; fast from wave 3; shield from wave 5;
// boss waves 10 (boss + escort) & 20 (double boss + escort); endless scales past 20.
import type { EnemyKind } from './types';

export interface WavePart {
  kind: EnemyKind;
  count: number;
}

// Hand-authored waves 1-20. Totals grow gently (~6 -> ~19) with periodic
// fast-swarm and double-shield spikes to keep the shopping list interesting.
const WAVES_1_20: Record<number, WavePart[]> = {
  1: [{ kind: 'regular', count: 6 }],
  2: [{ kind: 'regular', count: 8 }],
  3: [{ kind: 'regular', count: 5 }, { kind: 'fast', count: 3 }],
  4: [{ kind: 'regular', count: 6 }, { kind: 'fast', count: 3 }],
  5: [{ kind: 'regular', count: 5 }, { kind: 'shield', count: 3 }],
  6: [{ kind: 'regular', count: 6 }, { kind: 'fast', count: 3 }, { kind: 'shield', count: 2 }],
  7: [{ kind: 'regular', count: 4 }, { kind: 'fast', count: 7 }], // fast swarm
  8: [{ kind: 'regular', count: 7 }, { kind: 'shield', count: 4 }],
  9: [{ kind: 'regular', count: 6 }, { kind: 'fast', count: 4 }, { kind: 'shield', count: 3 }],
  10: [{ kind: 'boss', count: 1 }, { kind: 'regular', count: 8 }], // boss + escort
  11: [{ kind: 'regular', count: 7 }, { kind: 'fast', count: 4 }, { kind: 'shield', count: 3 }],
  12: [{ kind: 'regular', count: 4 }, { kind: 'fast', count: 10 }], // fast swarm
  13: [{ kind: 'regular', count: 8 }, { kind: 'shield', count: 6 }], // double shield
  14: [{ kind: 'regular', count: 7 }, { kind: 'fast', count: 5 }, { kind: 'shield', count: 3 }],
  15: [{ kind: 'regular', count: 8 }, { kind: 'fast', count: 5 }, { kind: 'shield', count: 4 }],
  16: [{ kind: 'regular', count: 6 }, { kind: 'shield', count: 8 }], // double shield
  17: [{ kind: 'regular', count: 5 }, { kind: 'fast', count: 12 }], // fast swarm
  18: [{ kind: 'regular', count: 9 }, { kind: 'fast', count: 5 }, { kind: 'shield', count: 4 }],
  19: [{ kind: 'regular', count: 8 }, { kind: 'fast', count: 6 }, { kind: 'shield', count: 5 }],
  20: [{ kind: 'boss', count: 2 }, { kind: 'regular', count: 8 }, { kind: 'fast', count: 4 }], // double boss + escort
};

/** Enemies to spawn for a given wave. Waves > 20 scale endlessly. */
export function waveComposition(wave: number): WavePart[] {
  if (wave >= 1 && wave <= 20) return WAVES_1_20[wave].map((p) => ({ ...p }));
  if (wave < 1) return [{ kind: 'regular', count: 6 }];

  // Endless: steadily thickening mix, with a boss every 5th wave.
  const over = wave - 20;
  const comp: WavePart[] = [
    { kind: 'regular', count: 8 + over },
    { kind: 'fast', count: 5 + Math.floor(over / 2) },
    { kind: 'shield', count: 4 + Math.floor(over / 2) },
  ];
  if (wave % 5 === 0) {
    comp.unshift({ kind: 'boss', count: 1 + Math.floor(over / 10) });
  }
  return comp;
}

/** Per-enemy spawn cadence (seconds between releases). Fast trickle quick, bosses lumber. */
export function spawnGap(kind: EnemyKind): number {
  switch (kind) {
    case 'boss':
      return 3.0;
    case 'shield':
      return 1.3;
    case 'fast':
      return 0.6;
    case 'regular':
    default:
      return 1.0;
  }
}

/**
 * Interleave a composition into a flat ordered spawn list so kinds are mixed
 * across the wave instead of arriving in solid blocks (weighted round-robin).
 */
export function flattenWave(comp: WavePart[]): EnemyKind[] {
  const buckets = comp.map((p) => ({ kind: p.kind, n: p.count }));
  const out: EnemyKind[] = [];
  let any = true;
  while (any) {
    any = false;
    for (const b of buckets) {
      if (b.n > 0) {
        out.push(b.kind);
        b.n--;
        any = true;
      }
    }
  }
  return out;
}
