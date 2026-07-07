import { HEX_SIZE } from './constants';
import type { Hex } from './types';

// Flat-top axial hex math.
export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: HEX_SIZE * 1.5 * q,
    z: HEX_SIZE * Math.sqrt(3) * (r + q / 2),
  };
}

export function hexKey(q: number, r: number): string {
  return q + ',' + r;
}

export function hexDist(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** World-space point of a hex path, precomputed as polyline segments. */
export interface PathGeom {
  pts: { x: number; z: number }[];
  /** cumulative distance at each point; total length = cum[cum.length-1] */
  cum: number[];
  length: number;
}

export function buildPathGeom(path: Hex[]): PathGeom {
  const pts = path.map((h) => hexToWorld(h.q, h.r));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Position along a path at distance d (clamped). */
export function pointAt(geom: PathGeom, d: number): { x: number; z: number } {
  if (d <= 0) return { ...geom.pts[0] };
  if (d >= geom.length) return { ...geom.pts[geom.pts.length - 1] };
  let i = 1;
  while (geom.cum[i] < d) i++;
  const t = (d - geom.cum[i - 1]) / (geom.cum[i] - geom.cum[i - 1]);
  const a = geom.pts[i - 1];
  const b = geom.pts[i];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
