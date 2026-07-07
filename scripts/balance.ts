// Cuteness Overload — balance harness.
// Runs the saver (intended winner) and spender (impatient baseline that should
// lose) across all 3 maps x seeds [1..5] and prints a summary table.
//   npx tsx scripts/balance.ts
// Exit code is always 0; the table is the artifact.
import { MAPS } from '../src/sim/maps';
import { playGame, type PlayResult } from './ai-play';

declare const process: { exit(code: number): never };

const SEEDS = [1, 2, 3, 4, 5];
const STRATS = ['saver', 'spender'];

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padL(s: string | number, n: number): string {
  return String(s).padStart(n);
}

function run(): void {
  const results: PlayResult[] = [];
  for (const map of MAPS) {
    for (const strat of STRATS) {
      for (const seed of SEEDS) {
        results.push(playGame(map.id, seed, strat, { log: false }));
      }
    }
  }

  // ---- Detailed table ----
  console.log('\n=== Cuteness Overload — balance table ===\n');
  const header =
    pad('map', 9) + pad('strat', 9) + pad('seed', 5) + pad('result', 8) +
    padL('wave', 5) + padL('lives', 6) + padL('kills', 6) + padL('leaks', 6) +
    padL('time', 7) + padL('twr', 5);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    console.log(
      pad(r.mapId, 9) +
        pad(r.strategy, 9) +
        pad(r.seed, 5) +
        pad(r.status.toUpperCase(), 8) +
        padL(r.wave, 5) +
        padL(r.lives, 6) +
        padL(r.kills, 6) +
        padL(r.leaks, 6) +
        padL(r.time.toFixed(0) + 's', 7) +
        padL(r.towers, 5),
    );
  }

  // ---- Per map/strat summary ----
  console.log('\n=== summary (win rate / avg wave reached / avg lives) ===\n');
  const sumHeader =
    pad('map', 9) + pad('strat', 9) + padL('wins', 6) + padL('avgWave', 9) +
    padL('avgLives', 10) + padL('minLives', 10);
  console.log(sumHeader);
  console.log('-'.repeat(sumHeader.length));
  for (const map of MAPS) {
    for (const strat of STRATS) {
      const rs = results.filter((r) => r.mapId === map.id && r.strategy === strat);
      const wins = rs.filter((r) => r.status === 'won').length;
      const avgWave = rs.reduce((a, r) => a + r.wave, 0) / rs.length;
      const avgLives = rs.reduce((a, r) => a + r.lives, 0) / rs.length;
      const minLives = Math.min(...rs.map((r) => r.lives));
      console.log(
        pad(map.id, 9) +
          pad(strat, 9) +
          padL(`${wins}/${rs.length}`, 6) +
          padL(avgWave.toFixed(1), 9) +
          padL(avgLives.toFixed(1), 10) +
          padL(minLives, 10),
      );
    }
  }

  // ---- Target check ----
  console.log('\n=== target check ===\n');
  const saver = results.filter((r) => r.strategy === 'saver');
  const spender = results.filter((r) => r.strategy === 'spender');
  const saverWins = saver.every((r) => r.status === 'won');
  const spenderLoses = spender.every((r) => r.status === 'lost');
  const spenderInWindow = spender
    .filter((r) => r.status === 'lost')
    .every((r) => r.wave >= 8 && r.wave <= 20); // accepted: well-placed plinker spam survives to the w17-20 boss wall (see BALANCE.md)
  const saverMinLives = Math.min(...saver.map((r) => r.lives));
  console.log(`saver wins all (3 maps x 5 seeds): ${saverWins ? 'PASS' : 'FAIL'}`);
  console.log(`spender loses all:                 ${spenderLoses ? 'PASS' : 'FAIL'}`);
  console.log(`spender losses in wave 8-20 window: ${spenderInWindow ? 'PASS' : 'FAIL'}`);
  console.log(`saver min lives (tension, <14 ideal): ${saverMinLives}`);

  process.exit(0);
}

run();
