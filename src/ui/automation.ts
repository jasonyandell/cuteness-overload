// Automation hook for deployed-site test automation.
// The full game state + a small imperative action surface are exposed on window.__game.
import type { GameState, TowerKind } from '../sim/types';

export interface GameActions {
  /** Start a fresh game on the given map (optionally with a fixed seed). */
  newGame(mapId: string, seed?: number): void;
  /** Place a tower of `kind` at hex (q,r). Returns false if invalid/unaffordable. */
  place(kind: TowerKind, q: number, r: number): boolean;
  /** Upgrade tower `towerId` on the 'dmg' or 'spd' track. */
  upgrade(towerId: number, which: 'dmg' | 'spd'): boolean;
  /** Sell tower `towerId`, refunding part of its cost. */
  sell(towerId: number): boolean;
  /** Call the next wave immediately; returns the money bonus earned. */
  skip(): number;
  /** Set sim speed multiplier. */
  setSpeed(x: 1 | 2): void;
  /** Pause / resume stepping. */
  pause(): void;
  resume(): void;
  /** Opt into endless mode (only meaningful after winning). */
  endless(): void;
}

export interface GameApi {
  /** Live game state (null on the menu / before a game starts). */
  readonly state: GameState | null;
  readonly actions: GameActions;
}

declare global {
  interface Window {
    __game: GameApi;
  }
}

export function installAutomation(api: GameApi): void {
  window.__game = api;
}
