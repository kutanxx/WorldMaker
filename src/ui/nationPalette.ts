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

// The player's realm is always rendered in this reserved signature colour (play mode only), so
// "which realm is mine" needs no swatch-matching. Deep magenta: the one hue family absent from the
// map (no pinks), colourblind-safe (Okabe-Ito reddish-purple), avoids the blue↔purple confusion a
// violet would cause given the map's many blues. Render-time only — not seeded.
export const PLAYER_COLOR = "#c0247a";

type GridLike = Pick<World["grid"], "count" | "points">;

export interface Centroid {
  x: number;
  y: number;
  cells: number;
}

// Label anchor for each present polity: the owned cell-centre NEAREST the polity's mean (a
// medoid), plus its cell count. Snapping to a member cell — rather than using the bare mean —
// keeps the label ON the territory; a concave or post-conquest (disconnected) shape can have a
// mean that falls in the sea or a neighbour. Matches the region-label treatment in geography.ts.
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
  const mean = new Map<number, { mx: number; my: number; cells: number }>();
  for (const [o, a] of acc) mean.set(o, { mx: a.sx / a.cells, my: a.sy / a.cells, cells: a.cells });
  // second pass: for each polity, keep the owned cell closest to its mean
  const best = new Map<number, { x: number; y: number; d: number }>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const m = mean.get(o)!;
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    const dx = x - m.mx, dy = y - m.my, d = dx * dx + dy * dy;
    const b = best.get(o);
    if (!b || d < b.d) best.set(o, { x, y, d });
  }
  const out = new Map<number, Centroid>();
  for (const [o, m] of mean) { const b = best.get(o)!; out.set(o, { x: b.x, y: b.y, cells: m.cells }); }
  return out;
}
