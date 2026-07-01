import type { World } from "../types/world";

// Distinct, parchment-friendly nation hues. Applied at render time (indexed by
// polity id), so nations stay distinguishable regardless of the engine's pastel
// palette. Purely cosmetic — not part of any rng/seed, so determinism holds.
export const NATION_PALETTE = [
  "#b5432f", "#3f6f8f", "#5f7a2f", "#c08a2f", "#6b4a7a", "#2f8f7a",
  "#a8532f", "#43683f", "#7a5a2f", "#7a2f4a", "#3f7a6f", "#4a4a8a",
];

export function nationColor(id: number): string {
  const n = NATION_PALETTE.length;
  return NATION_PALETTE[((id % n) + n) % n];
}

type GridLike = Pick<World["grid"], "count" | "points">;

export interface Centroid {
  x: number;
  y: number;
  cells: number;
}

// Mean of each present polity's owned cell-centre points, plus its cell count.
export function nationCentroids(grid: GridLike, owner: ArrayLike<number>): Map<number, Centroid> {
  const acc = new Map<number, { sx: number; sy: number; cells: number }>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const a = acc.get(o) ?? { sx: 0, sy: 0, cells: 0 };
    a.sx += grid.points[i * 2];
    a.sy += grid.points[i * 2 + 1];
    a.cells++;
    acc.set(o, a);
  }
  const out = new Map<number, Centroid>();
  for (const [o, a] of acc) out.set(o, { x: a.sx / a.cells, y: a.sy / a.cells, cells: a.cells });
  return out;
}
