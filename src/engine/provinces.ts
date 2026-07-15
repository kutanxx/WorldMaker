import type { Rng } from "./rng";
import { OCEAN } from "./terrain";

export const PROVINCE_SALT = 8100;
export const PROVINCE_TARGET = 100;

export type GridLike = { count: number; neighbors: number[][]; points: number[] };

// farthest-point sampling: the first seed is an rng pick; each subsequent seed is the land cell
// whose minimum (squared) distance to the already-chosen seeds is greatest. Even + deterministic.
export function pickProvinceSeeds(grid: GridLike, terrain: ArrayLike<number>, target: number, rng: Rng): number[] {
  const land: number[] = [];
  for (let c = 0; c < grid.count; c++) if (terrain[c] !== OCEAN) land.push(c);
  if (land.length <= target) return land.slice();
  const px = (i: number) => grid.points[i * 2], py = (i: number) => grid.points[i * 2 + 1];
  const minD = new Float64Array(grid.count).fill(Infinity);
  const relax = (s: number) => {
    for (const c of land) {
      const dx = px(c) - px(s), dy = py(c) - py(s);
      const d = dx * dx + dy * dy;
      if (d < minD[c]) minD[c] = d;
    }
  };
  const seeds: number[] = [land[Math.floor(rng() * land.length)]];
  relax(seeds[0]);
  while (seeds.length < target) {
    let best = -1, bestD = -1;
    for (const c of land) { if (minD[c] > bestD) { bestD = minD[c]; best = c; } } // ties → lowest index
    seeds.push(best);
    relax(best);
  }
  return seeds;
}

// multi-source BFS over the land adjacency graph: seed i owns province i; ties (equal graph
// distance) go to the lower seed index (FIFO frontier). Guarantees connected, water-respecting
// provinces. Land not reachable from any seed stays -1 (buildProvinces cleans those up).
export function assignProvinces(grid: GridLike, terrain: ArrayLike<number>, seeds: number[]): Int32Array {
  const provinceOf = new Int32Array(grid.count).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < seeds.length; i++) { provinceOf[seeds[i]] = i; queue.push(seeds[i]); }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head], pid = provinceOf[c];
    for (const nb of grid.neighbors[c]) {
      if (terrain[nb] !== OCEAN && provinceOf[nb] === -1) { provinceOf[nb] = pid; queue.push(nb); }
    }
  }
  return provinceOf;
}
