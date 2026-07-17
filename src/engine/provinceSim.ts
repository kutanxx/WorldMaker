import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;

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
