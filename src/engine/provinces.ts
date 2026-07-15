import type { Rng } from "./rng";
import { OCEAN } from "./terrain";
import { makeNameGen } from "./names";
import { featureName } from "./geography";

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

export interface Province {
  id: number; name: string; cells: number; centroid: [number, number]; seedCell: number; biome: number;
}

export function buildProvinces(
  grid: GridLike, terrain: ArrayLike<number>, biome: ArrayLike<number>, rng: Rng, target = PROVINCE_TARGET,
): { provinceOf: Int32Array; provinces: Province[] } {
  const seedCells = pickProvinceSeeds(grid, terrain, target, rng);
  const provinceOf = assignProvinces(grid, terrain, seedCells);
  // cleanup: land whose landmass held no seed is still -1 — flood-fill each such component as a new province
  for (let c = 0; c < grid.count; c++) {
    if (terrain[c] === OCEAN || provinceOf[c] !== -1) continue;
    const pid = seedCells.length;
    seedCells.push(c);
    provinceOf[c] = pid;
    const q = [c];
    for (let h = 0; h < q.length; h++) {
      for (const nb of grid.neighbors[q[h]]) {
        if (terrain[nb] !== OCEAN && provinceOf[nb] === -1) { provinceOf[nb] = pid; q.push(nb); }
      }
    }
  }
  // aggregate cells / centroid / dominant biome, then name (rng order = province id order → deterministic)
  const count = seedCells.length;
  const cells = new Int32Array(count), sumX = new Float64Array(count), sumY = new Float64Array(count);
  const biomeCount: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c]; if (p < 0) continue;
    cells[p]++; sumX[p] += grid.points[c * 2]; sumY[p] += grid.points[c * 2 + 1];
    const b = biome[c]; biomeCount[p].set(b, (biomeCount[p].get(b) ?? 0) + 1);
  }
  const ng = makeNameGen(rng);
  const provinces: Province[] = [];
  for (let p = 0; p < count; p++) {
    let domB = 0, domN = -1;
    for (const [b, n] of biomeCount[p]) if (n > domN) { domN = n; domB = b; }
    provinces.push({
      id: p, name: featureName(rng, ng, domB), cells: cells[p],
      centroid: [sumX[p] / cells[p], sumY[p] / cells[p]], seedCell: seedCells[p], biome: domB,
    });
  }
  return { provinceOf, provinces };
}
