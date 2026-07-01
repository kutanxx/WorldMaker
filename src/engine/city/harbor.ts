import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";

export interface Boat { at: Point; angle: number }
export interface Harbor {
  breakwater: Polyline; // shore → out into the sea → elbow sheltering the basin
  lighthouse: Point;    // breakwater tip
  piers: Polyline[];    // short jetties from the shore into the sheltered water
  boats: Boat[];        // moored boats
  quay: Polyline;       // the waterfront line (contiguous seaward boundary run)
}

// longest cyclic run of `true` (the contiguous shore run), as boundary indices
function longestRun(flags: boolean[]): number[] {
  const n = flags.length;
  if (flags.every((f) => f)) return flags.map((_, i) => i);
  let start = 0;
  while (flags[start]) start = (start + 1) % n; // begin just after a gap so a run isn't split at the seam
  let best: number[] = [], cur: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (flags[i]) cur.push(i);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

export function makeHarbor(
  rng: Rng, water: Water, boundary: Polygon, center: Point,
): Harbor | null {
  if (water.kind !== "sea") return null;

  // seaward EDGES: an edge whose just-outside midpoint is in the sea (same test the wall uses,
  // so the quay spans exactly the open seaward wall side — much longer than a vertex test)
  const n = boundary.length;
  const seawardEdge: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out: Point = [m[0] + (m[0] - center[0]) * 0.06, m[1] + (m[1] - center[1]) * 0.06];
    seawardEdge.push(inWater(water, out));
  }
  const runEdges = longestRun(seawardEdge);
  if (runEdges.length < 1) return null;
  // quay vertices = each run edge's start vertex, plus the last edge's end vertex
  const quay: Polyline = [...runEdges.map((e) => boundary[e]), boundary[(runEdges[runEdges.length - 1] + 1) % n]];
  if (quay.length < 2) return null;

  const anchor: Point = [
    quay.reduce((s, p) => s + p[0], 0) / quay.length,
    quay.reduce((s, p) => s + p[1], 0) / quay.length,
  ];
  let dx = anchor[0] - center[0], dy = anchor[1] - center[1];
  const dl = Math.hypot(dx, dy) || 1;
  const dir: Point = [dx / dl, dy / dl];
  const tan: Point = [-dir[1], dir[0]];
  const inSea = (p: Point) => inWater(water, p);

  // breakwater: out along dir, then an elbow along the shore tangent to enclose a basin
  const reach = 26 + rng() * 12;
  const span = 16 + rng() * 10;
  const side = rng() < 0.5 ? 1 : -1;
  const start: Point = [anchor[0] + dir[0] * 3, anchor[1] + dir[1] * 3];
  const mid: Point = [anchor[0] + dir[0] * reach, anchor[1] + dir[1] * reach];
  const tip: Point = [mid[0] + tan[0] * side * span, mid[1] + tan[1] * side * span];
  const breakwater: Polyline = [start, mid, tip];

  // piers: short jetties from shore points into the sheltered water
  const piers: Polyline[] = [];
  const boats: Boat[] = [];
  const angle = Math.atan2(dir[1], dir[0]);
  for (let k = -1; k <= 1; k++) {
    const base: Point = [anchor[0] + tan[0] * k * 14, anchor[1] + tan[1] * k * 14];
    const outp: Point = [base[0] + dir[0] * 3, base[1] + dir[1] * 3];
    if (!inSea(outp)) continue; // pier must reach water
    const len = 10 + rng() * 6;
    const end: Point = [base[0] + dir[0] * len, base[1] + dir[1] * len];
    piers.push([base, end]);
    boats.push({ at: [end[0] + tan[0] * 2.5, end[1] + tan[1] * 2.5], angle });
  }
  // a couple of boats riding in the sheltered basin
  for (let i = 0; i < 2; i++) {
    const p: Point = [mid[0] - dir[0] * (4 + i * 6) + tan[0] * side * (4 + rng() * 4), mid[1] - dir[1] * (4 + i * 6) + tan[1] * side * (4 + rng() * 4)];
    if (inSea(p)) boats.push({ at: p, angle: angle + (rng() - 0.5) * 0.6 });
  }

  return { breakwater, lighthouse: tip, piers, boats, quay };
}
