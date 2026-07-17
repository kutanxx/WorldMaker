import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;

const SOL_INIT = 0.5;

export const PROVINCE_SIM_TICKS = 50;

export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;   // province → polity id (-1 unowned)
  provSol: Float32Array;   // province → solidarity [0,1]
  adj: number[][];         // province land-adjacency, index-aligned to provinces
  capitalProv: Int32Array; // polity id → its capital province id
  alive: boolean[];        // polity id → still holds its capital province
  tick: number;
}

// two provinces are adjacent iff some land cell of one has a land-neighbour cell in the other.
export function buildProvinceAdj(
  provinceOf: ArrayLike<number>, provinces: Province[], grid: GridLike,
): number[][] {
  const adj: Set<number>[] = provinces.map(() => new Set<number>());
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c];
    if (p < 0) continue;
    for (const nb of grid.neighbors[c]) {
      const q = provinceOf[nb];
      if (q >= 0 && q !== p) { adj[p].add(q); adj[q].add(p); }
    }
  }
  return adj.map((s) => [...s].sort((a, b) => a - b));
}

// each province's majority owner over its cells (ties → lower id; unowned → -1)
function majorityOwner(provinceOf: ArrayLike<number>, nProv: number, owner: ArrayLike<number>): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < provinceOf.length; c++) {
    const p = provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = owner[c];
    if (o < 0) continue;
    tally[p].set(o, (tally[p].get(o) ?? 0) + 1);
  }
  const out = new Int32Array(nProv).fill(-1);
  for (let p = 0; p < nProv; p++) {
    let best = -1, bestN = 0;
    for (const [o, k] of tally[p]) if (k > bestN || (k === bestN && o < best)) { bestN = k; best = o; }
    out[p] = best;
  }
  return out;
}

export function initProvinceSim(world: World): ProvinceSimState {
  const { provinces, provinceOf, polities, grid } = world;
  const n = provinces.length;
  const provOwner = majorityOwner(provinceOf, n, world.polityOf);
  const capitalProv = new Int32Array(polities.length).fill(-1);
  // force each nation's capital province to itself so no nation starts capital-less (majority snap could
  // otherwise hand a capital's province to a neighbour). Capital-province collisions (two capitals in one
  // province) are last-write-wins — vanishingly rare on the ~100-province map; acceptable for SP1.
  for (const pol of polities) {
    const cap = provinceOf[pol.capital];
    capitalProv[pol.id] = cap;
    if (cap >= 0) provOwner[cap] = pol.id;
  }
  const provSol = new Float32Array(n);
  for (let p = 0; p < n; p++) provSol[p] = provOwner[p] >= 0 ? SOL_INIT : 0;
  const adj = buildProvinceAdj(provinceOf, provinces, grid);
  const alive = polities.map((pol) => capitalProv[pol.id] >= 0 && provOwner[capitalProv[pol.id]] === pol.id);
  return { provinces, n, provOwner, provSol, adj, capitalProv, alive, tick: 0 };
}
