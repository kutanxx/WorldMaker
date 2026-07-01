import type { Point, Polygon, Polyline } from "../geometry";
import { centroid } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";
import type { MountainMass } from "./mountain";
import { inMountains } from "./mountain";

export interface DefenseWall {
  segments: Polyline[];
  towers: Point[];
  gates: Point[];
  seaGates: Point[];
}

// nearest point on a polyline to p, with its squared distance
function nearestOnPolyline(p: Point, line: Polyline): { pt: Point; d2: number } {
  let best: Point = line[0], bd2 = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const q: Point = [a[0] + dx * t, a[1] + dy * t];
    const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d2 < bd2) { bd2 = d2; best = q; }
  }
  return { pt: best, d2: bd2 };
}

// gates sit where a main road reaches the wall: snap each road endpoint onto the
// nearest wall segment when it is close enough, merging gates that nearly coincide.
function placeGates(segments: Polyline[], roads: Polyline[]): Point[] {
  const NEAR = 15, MERGE2 = 12 * 12;
  const gates: Point[] = [];
  for (const r of roads) {
    if (r.length < 2) continue;
    for (const end of [r[0], r[r.length - 1]]) {
      let best: Point | null = null, bd2 = NEAR * NEAR;
      for (const s of segments) {
        const { pt, d2 } = nearestOnPolyline(end, s);
        if (d2 < bd2) { bd2 = d2; best = pt; }
      }
      if (best && !gates.some((g) => (g[0] - best![0]) ** 2 + (g[1] - best![1]) ** 2 < MERGE2)) {
        gates.push(best);
      }
    }
  }
  return gates;
}

// barrier per boundary edge: 0 = none (walled), 1 = water, 2 = mountain
export function wallFromDefenses(
  boundary: Polygon, water: Water, mountains: MountainMass[], mainRoads: Polyline[],
): DefenseWall {
  const n = boundary.length;
  const c = centroid(boundary);
  const barrier: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out: Point = [m[0] + (m[0] - c[0]) * 0.06, m[1] + (m[1] - c[1]) * 0.06];
    barrier.push(inWater(water, out) ? 1 : inMountains(mountains, out) ? 2 : 0);
  }
  const isWall = barrier.map((b) => b === 0);
  const isWaterGate = (edge: number) => barrier[((edge % n) + n) % n] === 1; // gate only at water, not cliff
  const segments: Polyline[] = [];
  const seaGates: Point[] = [];
  const allWall = isWall.every((w) => w);
  if (allWall) {
    const ring: Polyline = boundary.map((p) => [p[0], p[1]]);
    ring.push([boundary[0][0], boundary[0][1]]);
    segments.push(ring);
  } else {
    let start = 0;
    while (isWall[start]) start = (start + 1) % n;        // a non-wall edge
    let cur: Polyline | null = null;
    let runFirstEdge = -1, runLastEdge = -1;
    const closeRun = (followingEdge: number) => {
      if (!cur) return;
      if (isWaterGate(runFirstEdge - 1)) seaGates.push(cur[0]);
      if (isWaterGate(followingEdge)) seaGates.push(cur[cur.length - 1]);
      segments.push(cur);
      cur = null;
    };
    for (let k = 0; k < n; k++) {
      const e = (start + k) % n;
      if (isWall[e]) {
        if (!cur) { cur = [boundary[e]]; runFirstEdge = e; }
        cur.push(boundary[(e + 1) % n]);
        runLastEdge = e;
      } else {
        closeRun(e);
      }
    }
    closeRun(runLastEdge + 1);
  }
  const towers: Point[] = [];
  for (const s of segments) for (const p of s) towers.push(p);
  const gates = placeGates(segments, mainRoads);
  return { segments, towers, gates, seaGates };
}
