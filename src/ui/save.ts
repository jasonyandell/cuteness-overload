// localStorage save/resume + settings. GameState is plain JSON per the design contract.
import type { GameState } from '../sim/types';

const SAVE_KEY = 'cuteness-overload-save-v1';
const META_KEY = 'cuteness-overload-meta-v1';

export interface SaveBlob {
  mapId: string;
  state: GameState;
  savedAt: number;
}

export interface Meta {
  speed: 1 | 2;
}

export function writeSave(mapId: string, state: GameState): void {
  try {
    const blob: SaveBlob = { mapId, state, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
  } catch {
    /* storage full / disabled — ignore, game still playable */
  }
}

export function readSave(): SaveBlob | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as SaveBlob;
    if (!blob || !blob.state || !blob.mapId) return null;
    return blob;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return readSave() !== null;
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Meta;
      if (m.speed === 1 || m.speed === 2) return m;
    }
  } catch {
    /* ignore */
  }
  return { speed: 1 };
}

export function writeMeta(meta: Meta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}
