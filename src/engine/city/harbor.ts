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
  wharves: Polygon[];   // warehouse blocks lining the quay, protruding to the waterfront
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

  // seaward EDGES: an edge that faces the sea — march outward along its normal (same reach the
  // wall uses to open the sea side) so the quay spans exactly the open seaward run even when the
  // town edge stops a few px short of the shore.
  const n = boundary.length;
  const seawardEdge: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = m[0] - center[0], dy = m[1] - center[1], dl = Math.hypot(dx, dy) || 1;
    let sea = false;
    for (let d = 2; d <= 36; d += 4) {
      if (inWater(water, [m[0] + (dx / dl) * d, m[1] + (dy / dl) * d])) { sea = true; break; }
    }
    seawardEdge.push(sea);
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

  // march from a quay point outward until it meets the sea (bridges the small land gap where
  // the town edge stops short of the shore), returning the first water point.
  const reachWater = (from: Point): Point | null => {
    for (let d = 0; d <= 40; d += 3) {
      const q: Point = [from[0] + dir[0] * d, from[1] + dir[1] * d];
      if (inSea(q)) return q;
    }
    return null;
  };

  // piers: from quay points, cross the shore gap and jut into the sheltered water
  const piers: Polyline[] = [];
  const boats: Boat[] = [];
  const angle = Math.atan2(dir[1], dir[0]);
  for (let k = -1; k <= 1; k++) {
    const base: Point = [anchor[0] + tan[0] * k * 14, anchor[1] + tan[1] * k * 14];
    const shore = reachWater(base);
    if (!shore) continue; // no water reachable from this point
    const len = 8 + rng() * 6;
    const end: Point = [shore[0] + dir[0] * len, shore[1] + dir[1] * len];
    piers.push([base, end]); // quay → across the gap → into the water
    boats.push({ at: [end[0] + tan[0] * 2.5, end[1] + tan[1] * 2.5], angle });
  }
  // a couple of boats riding in the sheltered basin
  for (let i = 0; i < 2; i++) {
    const p: Point = [mid[0] - dir[0] * (4 + i * 6) + tan[0] * side * (4 + rng() * 4), mid[1] - dir[1] * (4 + i * 6) + tan[1] * side * (4 + rng() * 4)];
    if (inSea(p)) boats.push({ at: p, angle: angle + (rng() - 0.5) * 0.6 });
  }

  // wharves: warehouse blocks lining the quay, nudged toward the water so the docks read as
  // protruding from the town's seaward edge (Watabou: the seafront blocks ARE the docks).
  const wharves: Polygon[] = [];
  const step = Math.max(1, Math.floor((quay.length - 1) / 6)); // up to ~6 warehouses
  for (let t = 0; t + 1 < quay.length; t += step) {
    const a2 = quay[t], b2 = quay[t + 1];
    const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
    const alx = b2[0] - a2[0], aly = b2[1] - a2[1], al = Math.hypot(alx, aly) || 1;
    const ux = alx / al, uy = aly / al;                 // along-shore tangent
    const cx = mx + dir[0] * 3, cy = my + dir[1] * 3;   // nudge seaward so it protrudes
    const hwid = 4.5, hdep = 3;
    wharves.push([
      [cx - ux * hwid - dir[0] * hdep, cy - uy * hwid - dir[1] * hdep],
      [cx + ux * hwid - dir[0] * hdep, cy + uy * hwid - dir[1] * hdep],
      [cx + ux * hwid + dir[0] * hdep, cy + uy * hwid + dir[1] * hdep],
      [cx - ux * hwid + dir[0] * hdep, cy - uy * hwid + dir[1] * hdep],
    ]);
  }

  return { breakwater, lighthouse: tip, piers, boats, quay, wharves };
}
