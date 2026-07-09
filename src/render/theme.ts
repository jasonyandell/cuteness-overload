// Cuteness Overload — bold crayon-primary palette for a preschool-toy-box look.
// Colors are plain hex ints, fed straight into THREE.Color.

import type { EnemyKind, TowerKind, Terrain } from '../sim/types';

export const SKY = 0x8ecbff; // bright friendly sky blue
export const FOG = 0xbfe0ff; // light matching haze

// Terrain base colors. Slight per-instance jitter is added at build time.
export const TERRAIN: Record<Terrain, number> = {
  build: 0x57c64a, // saturated grass green
  path: 0xffcf3f, // bold sandy yellow
  blocked: 0x2f9e46, // deep green (hosts trees/rocks)
  spawn: 0xff5a4d, // bright red spawn pad
  home: 0x3f9bff, // bold blue home tile
};

// Enemy body colors — one strong primary per kind.
export const ENEMY_COLOR: Record<EnemyKind, number> = {
  regular: 0x2f6bff, // Bloop — bold blue
  fast: 0xffd21e, // Zippy — sunny yellow
  shield: 0x33c14a, // Shelly — grass green
  boss: 0x9b30ff, // Chonk — big purple
};

export const SHIELD_BUBBLE = 0x9fe8ff; // icy translucent bubble

// Tower accent colors — bold and distinct.
export const TOWER_COLOR: Record<TowerKind, number> = {
  plinker: 0xff4136, // red
  freeze: 0x2f8bff, // blue
  cannon: 0xff8c1a, // orange
  lightning: 0xffd21e, // yellow
  doom: 0x9b30ff, // purple
};

export const TOWER_TRIM = 0xffffff;

// Effect colors keyed by tower kind for aoe rings / tracers.
export const AOE_COLOR: Record<TowerKind, number> = {
  plinker: 0xffffff,
  freeze: 0x8fe3ff,
  cannon: 0xff8c1a,
  lightning: 0xffe23a,
  doom: 0xb46bff,
};

export const SHOT_COLOR: Record<TowerKind, number> = {
  plinker: 0xff7a6e,
  freeze: 0xbff0ff,
  cannon: 0xffb765,
  lightning: 0xfff06a,
  doom: 0xc98cff,
};

export const LEAK_FLASH = 0xff2a2a;
export const CONFETTI = [0xff4136, 0x2f6bff, 0xffd21e, 0x33c14a, 0xff8c1a, 0x9b30ff, 0xffffff];

// Death poof: enemies pop into a burst of adorable hearts (no gore, ever).
export const HEARTS = [0xff6b9d, 0xff4d8d, 0xffa6c9, 0xff2d6f, 0xff9ecb, 0xffffff];
