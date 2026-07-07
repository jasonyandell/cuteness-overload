// Cuteness Overload — map definitions. Pure data (built from direction-step paths
// so every consecutive path pair is guaranteed hexDist === 1). Flat-top axial hexes.
import type { Hex, MapDef, Terrain } from './types';
import { hexDist, hexKey } from './hex';

// Six flat-top neighbor directions (axial deltas). z increases "south" in world space.
type Dir = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';
const DELTA: Record<Dir, [number, number]> = {
  N: [0, -1],
  NE: [1, -1],
  SE: [1, 0],
  S: [0, 1],
  SW: [-1, 1],
  NW: [-1, 0],
};

/** Build a path from a start hex plus a list of single-step directions. */
function walk(start: Hex, dirs: Dir[]): Hex[] {
  const out: Hex[] = [{ q: start.q, r: start.r }];
  let cur = start;
  for (const d of dirs) {
    const [dq, dr] = DELTA[d];
    cur = { q: cur.q + dq, r: cur.r + dr };
    out.push(cur);
  }
  return out;
}

/**
 * Assemble a MapDef. Terrain: first hex of each path = 'spawn', last = 'home',
 * intermediate = 'path'. Build cells are every hex within `maxBuildDist` of a path
 * hex (excluding path + blocked). A shared home hex (identical last hex of multiple
 * paths) appears exactly once as 'home'.
 */
function makeMap(
  id: string,
  name: string,
  paths: Hex[][],
  opts: { incomeMul: number; hpMul: number; maxBuildDist: number; blocked?: Hex[] },
): MapDef {
  const cells: { q: number; r: number; t: Terrain }[] = [];
  const seen = new Set<string>();
  const add = (q: number, r: number, t: Terrain) => {
    const k = hexKey(q, r);
    if (seen.has(k)) return;
    seen.add(k);
    cells.push({ q, r, t });
  };

  // Path terrains first (so build generation can exclude them).
  const pathKeys = new Set<string>();
  const allPathHexes: Hex[] = [];
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      const h = path[i];
      pathKeys.add(hexKey(h.q, h.r));
      allPathHexes.push(h);
    }
  }
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      const h = path[i];
      const t: Terrain = i === 0 ? 'spawn' : i === path.length - 1 ? 'home' : 'path';
      // 'home' wins over 'path' if a shared hex; spawn/home added once via `seen`.
      if (t === 'home' || !seen.has(hexKey(h.q, h.r))) add(h.q, h.r, t);
    }
  }

  const blockedKeys = new Set((opts.blocked ?? []).map((b) => hexKey(b.q, b.r)));

  // Build cells: ring of hexes within maxBuildDist of any path hex.
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const h of allPathHexes) {
    minQ = Math.min(minQ, h.q); maxQ = Math.max(maxQ, h.q);
    minR = Math.min(minR, h.r); maxR = Math.max(maxR, h.r);
  }
  const pad = opts.maxBuildDist;
  for (let q = minQ - pad; q <= maxQ + pad; q++) {
    for (let r = minR - pad; r <= maxR + pad; r++) {
      const k = hexKey(q, r);
      if (pathKeys.has(k) || seen.has(k) || blockedKeys.has(k)) continue;
      let minD = Infinity;
      for (const h of allPathHexes) {
        const d = hexDist({ q, r }, h);
        if (d < minD) minD = d;
        if (minD <= 1) break;
      }
      if (minD >= 1 && minD <= opts.maxBuildDist) add(q, r, 'build');
    }
  }

  for (const b of opts.blocked ?? []) add(b.q, b.r, 'blocked');

  return { id, name, cells, paths, incomeMul: opts.incomeMul, hpMul: opts.hpMul };
}

// --- Map 1: Meadow Lane — gentle single snake, generous build space. ---
const meadowPath = walk(
  { q: 0, r: 0 },
  ['SE', 'SE', 'S', 'SE', 'SE', 'S', 'S', 'SW', 'S', 'SE',
   'SE', 'NE', 'NE', 'N', 'SE', 'SE', 'S', 'S', 'SE', 'SE'],
);

// --- Map 2: Twisty Creek — long, switchbacking single path; tight build pockets. ---
const creekPath = walk(
  { q: 0, r: 1 },
  ['S', 'S', 'S', 'SE', 'SE', 'NE', 'N', 'N', 'N', 'SE',
   'SE', 'S', 'S', 'S', 'S', 'SE', 'SE', 'N', 'N', 'N',
   'SE', 'SE', 'S', 'S', 'S', 'SE'],
);

// --- Map 3: Double Trouble — two spawns converging on one shared home. ---
const doubleHome: Hex = { q: 10, r: 3 };
const doublePathA = walk(
  { q: 0, r: 0 },
  ['SE', 'SE', 'S', 'SE', 'S', 'SE', 'SE', 'S', 'SE', 'SE', 'SE', 'SE', 'SE'],
);
const doublePathB = walk(
  { q: 0, r: 6 },
  ['NE', 'SE', 'NE', 'SE', 'SE', 'SE', 'SE', 'SE', 'SE', 'NE'],
);

export const MAPS: MapDef[] = [
  makeMap('meadow', 'Meadow Lane', [meadowPath], {
    incomeMul: 1.0,
    hpMul: 1.0,
    maxBuildDist: 2,
    blocked: [
      { q: 2, r: -1 },
      { q: 6, r: 6 },
      { q: 9, r: 1 },
      { q: 3, r: 6 },
    ],
  }),
  makeMap('creek', 'Twisty Creek', [creekPath], {
    incomeMul: 1.0,
    hpMul: 1.15,
    maxBuildDist: 1,
  }),
  makeMap('double', 'Double Trouble', [doublePathA, doublePathB], {
    incomeMul: 1.1,
    hpMul: 1.2,
    maxBuildDist: 2,
    blocked: [
      { q: 4, r: -1 },
      { q: 2, r: 7 },
    ],
  }),
];
