// Standalone validator for MAPS. Run: npx tsx scripts/validate-maps.ts
// Asserts every structural invariant maps.ts must satisfy and prints per-map stats.
import { MAPS } from '../src/sim/maps';
import { hexDist, hexKey, buildPathGeom } from '../src/sim/hex';
import type { MapDef, Hex, Terrain } from '../src/sim/types';

// Minimal ambient for the Node global (this project has no @types/node installed).
declare const process: { exit(code: number): never };

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('  FAIL: ' + msg);
  }
}

// Tower range envelope (world units) from constants; shortest range must still reach.
const MIN_TOWER_RANGE = 2.6;
const ADJ = Math.sqrt(3); // world distance between adjacent hex centers (~1.732)

function terrainOf(map: MapDef): Map<string, Terrain> {
  const m = new Map<string, Terrain>();
  for (const c of map.cells) m.set(hexKey(c.q, c.r), c.t);
  return m;
}

function validate(map: MapDef): void {
  console.log(`\n=== ${map.id} (${map.name}) ===`);

  // 1. No duplicate cells.
  const keys = new Set<string>();
  for (const c of map.cells) {
    const k = hexKey(c.q, c.r);
    check(!keys.has(k), `duplicate cell ${k}`);
    keys.add(k);
  }

  const terr = terrainOf(map);
  const pathKeys = new Set<string>();

  // 2. Per-path invariants: adjacency, terrain roles, membership in cells.
  check(map.paths.length >= 1, 'has at least one path');
  for (let p = 0; p < map.paths.length; p++) {
    const path = map.paths[p];
    check(path.length >= 2, `path ${p} has >= 2 hexes`);
    for (let i = 0; i < path.length; i++) {
      const h = path[i];
      const k = hexKey(h.q, h.r);
      pathKeys.add(k);
      // Every path hex is present in cells.
      check(terr.has(k), `path ${p} hex ${k} present in cells`);
      const want: Terrain = i === 0 ? 'spawn' : i === path.length - 1 ? 'home' : 'path';
      const got = terr.get(k);
      // Shared home hex may be the 'home' terrain for both paths.
      const ok = got === want || (want === 'home' && got === 'home');
      check(ok, `path ${p} hex ${k} terrain is ${want} (got ${got})`);
      // Adjacency to previous hex.
      if (i > 0) {
        const d = hexDist(path[i - 1], h);
        check(d === 1, `path ${p} step ${i} adjacency (dist ${d}, ${hexKey(path[i - 1].q, path[i - 1].r)}->${k})`);
      }
    }
  }

  // 3. Terrain sanity: exactly the spawn/home counts we expect.
  const spawns = map.cells.filter((c) => c.t === 'spawn');
  const homes = map.cells.filter((c) => c.t === 'home');
  check(spawns.length === map.paths.length, `spawn count == path count (${spawns.length} vs ${map.paths.length})`);
  check(homes.length >= 1, `has a home cell (${homes.length})`);
  // Each path's first hex must be a spawn cell, last must be a home cell.
  for (let p = 0; p < map.paths.length; p++) {
    const path = map.paths[p];
    check(terr.get(hexKey(path[0].q, path[0].r)) === 'spawn', `path ${p} starts on spawn`);
    check(terr.get(hexKey(path[path.length - 1].q, path[path.length - 1].r)) === 'home', `path ${p} ends on home`);
  }

  // 4. Build cells exist and are not on the path.
  const buildCells = map.cells.filter((c) => c.t === 'build');
  check(buildCells.length >= 8, `has enough build cells (${buildCells.length})`);
  for (const b of buildCells) {
    check(!pathKeys.has(hexKey(b.q, b.r)), `build cell ${hexKey(b.q, b.r)} not on path`);
  }

  // 5. Reachability: every path hex must have a build cell within a shortest-range
  //    tower's reach (adjacent hex, world dist ~1.732 < MIN_TOWER_RANGE), and most
  //    build cells sit within hexDist 2 of some path hex.
  const buildKeySet = new Set(buildCells.map((b) => hexKey(b.q, b.r)));
  let coveredSegments = 0;
  for (const path of map.paths) {
    for (const h of path) {
      // is there a build cell within MIN_TOWER_RANGE world units of this path hex?
      let reachable = false;
      for (const b of buildCells) {
        const d = hexDist({ q: b.q, r: b.r }, h) * ADJ; // conservative lower bound of world dist
        // hexDist*ADJ overestimates straight-line for diagonals; use true world dist instead.
        const bw = worldDist(b, h);
        if (bw <= MIN_TOWER_RANGE) { reachable = true; break; }
        void d;
      }
      check(reachable, `path hex ${hexKey(h.q, h.r)} has a build cell within min tower range`);
      if (reachable) coveredSegments++;
    }
  }
  void buildKeySet;

  let within2 = 0;
  for (const b of buildCells) {
    let md = Infinity;
    for (const path of map.paths) for (const h of path) md = Math.min(md, hexDist({ q: b.q, r: b.r }, h));
    if (md <= 2) within2++;
  }
  const frac = within2 / buildCells.length;
  check(frac >= 0.9, `>= 90% of build cells within hexDist 2 of path (got ${(frac * 100).toFixed(0)}%)`);

  // 6. Total cell count sane for mobile.
  check(map.cells.length >= 70 && map.cells.length <= 140, `cell count in range (${map.cells.length})`);

  // ---- Stats ----
  let totalPathHexes = 0;
  let totalWorldLen = 0;
  for (const path of map.paths) {
    totalPathHexes += path.length;
    totalWorldLen += buildPathGeom(path).length;
  }
  console.log(`  paths:        ${map.paths.length}`);
  console.log(`  path hexes:   ${totalPathHexes} (${map.paths.map((p) => p.length).join(' + ')})`);
  console.log(`  world length: ${totalWorldLen.toFixed(2)} (${map.paths.map((p) => buildPathGeom(p).length.toFixed(1)).join(' + ')})`);
  console.log(`  build cells:  ${buildCells.length}`);
  console.log(`  blocked:      ${map.cells.filter((c) => c.t === 'blocked').length}`);
  console.log(`  total cells:  ${map.cells.length}`);
  console.log(`  incomeMul ${map.incomeMul}  hpMul ${map.hpMul}`);
}

function worldDist(a: Hex, b: Hex): number {
  // flat-top axial -> world (mirrors hex.ts hexToWorld with HEX_SIZE=1)
  const ax = 1.5 * a.q, az = Math.sqrt(3) * (a.r + a.q / 2);
  const bx = 1.5 * b.q, bz = Math.sqrt(3) * (b.r + b.q / 2);
  return Math.hypot(ax - bx, az - bz);
}

console.log('Validating ' + MAPS.length + ' maps...');
check(MAPS.length === 3, 'exactly 3 maps');
const ids = new Set(MAPS.map((m) => m.id));
check(ids.size === 3, 'unique map ids');
for (const map of MAPS) validate(map);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll maps valid.');
