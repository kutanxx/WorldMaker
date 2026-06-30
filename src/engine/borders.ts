import type { Grid } from "./grid";
import { OCEAN } from "./terrain";

export type Point = [number, number];
export type Segment = [Point, Point];

type GridLike = Pick<Grid, "count" | "polygons" | "neighbors">;

const EPS = 0.01;

export function sharedEdge(a: number[][], b: number[][]): Segment | null {
  const shared: Point[] = [];
  for (const pa of a) {
    let match = false;
    for (const pb of b) {
      if (Math.abs(pa[0] - pb[0]) < EPS && Math.abs(pa[1] - pb[1]) < EPS) { match = true; break; }
    }
    if (!match) continue;
    if (shared.some((s) => Math.abs(s[0] - pa[0]) < EPS && Math.abs(s[1] - pa[1]) < EPS)) continue; // dedup closing vertex
    shared.push([pa[0], pa[1]]);
    // convex Voronoi cells share exactly one edge (2 vertices); stop at 2
    if (shared.length === 2) break;
  }
  return shared.length === 2 ? [shared[0], shared[1]] : null;
}

export function politicalBorders(grid: GridLike, polityOf: number[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (polityOf[i] < 0) continue;
    for (const j of grid.neighbors[i]) {
      if (j <= i) continue;
      if (polityOf[j] >= 0 && polityOf[j] !== polityOf[i]) {
        const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
        if (e) segs.push(e);
      }
    }
  }
  return segs;
}

export function coastline(grid: GridLike, terrain: number[] | Uint8Array): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (terrain[i] === OCEAN) continue;
    for (const j of grid.neighbors[i]) {
      if (terrain[j] === OCEAN) {
        // no j>i guard needed: the ocean cell is skipped by the outer OCEAN check, so each land-ocean edge emits once
        const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
        if (e) segs.push(e);
      }
    }
  }
  return segs;
}
