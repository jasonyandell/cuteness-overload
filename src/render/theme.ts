// Cuteness Overload — pastel palette for the three.js renderer.
// All colors are plain hex ints so they can be fed straight into THREE.Color.

import type { EnemyKind, TowerKind, Terrain } from '../sim/types';

export const SKY = 0xcfe6ff; // soft periwinkle sky
export const FOG = 0xdcecff; // gentle matching fog

// Terrain base colors. Slight per-instance jitter is added at build time.
export const TERRAIN: Record<Terrain, number> = {
  build: 0xaee6a0, // soft meadow green
  path: 0xf2dca6, // warm sandy trail
  blocked: 0x7fbf86, // deeper green (hosts trees/rocks)
  spawn: 0xffb3d9, // pink spawn pad
  home: 0x9be0c8, // minty home tile
};

// Enemy body colors (candy pastels).
export const ENEMY_COLOR: Record<EnemyKind, number> = {
  regular: 0x8fd0ff, // Bloop — baby blue
  fast: 0xffd166, // Zippy — sunny yellow
  shield: 0xc8a2ff, // Shelly — lavender
  boss: 0xff8fab, // Chonk — bubblegum pink
};

export const SHIELD_BUBBLE = 0x9fe8ff; // icy translucent bubble

// Tower accent colors.
export const TOWER_COLOR: Record<TowerKind, number> = {
  plinker: 0xbfc8d6, // pebble gray-blue
  freeze: 0xa6e3ff, // icy blue crystal
  cannon: 0xe8b98a, // warm tan barrel
  lightning: 0xfff07a, // electric yellow
  doom: 0xff5fa2, // ominous-but-cute pink
};

export const TOWER_TRIM = 0xffffff;

// Effect colors keyed by tower kind for aoe rings / tracers.
export const AOE_COLOR: Record<TowerKind, number> = {
  plinker: 0xffffff,
  freeze: 0x9fe8ff,
  cannon: 0xffb066,
  lightning: 0xfff07a,
  doom: 0xff6fb0,
};

export const SHOT_COLOR: Record<TowerKind, number> = {
  plinker: 0xfff2c2,
  freeze: 0xbff2ff,
  cannon: 0xffcf8f,
  lightning: 0xfff79e,
  doom: 0xffa6d4,
};

export const LEAK_FLASH = 0xff5a5a;
export const CONFETTI = [0xff8fab, 0xffd166, 0x8fd0ff, 0xa0e6a0, 0xc8a2ff, 0xffffff];
