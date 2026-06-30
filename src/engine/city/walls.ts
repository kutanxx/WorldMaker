import type { Point, Polygon, Polyline } from "../geometry";
import { centroid } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";

export interface DefenseWall {
  segments: Polyline[];
  towers: Point[];
  gates: Point[];
  seaGates: Point[];
}

export function wallFromDefenses(boundary: Polygon, water: Water, gateCount: number): DefenseWall {
  const n = boundary.length;
  const c = centroid(boundary);
  const isWall: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out: Point = [m[0] + (m[0] - c[0]) * 0.06, m[1] + (m[1] - c[1]) * 0.06];
    isWall.push(!inWater(water, out));
  }
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
    for (let k = 0; k < n; k++) {
      const e = (start + k) % n;
      if (isWall[e]) {
        if (!cur) cur = [boundary[e]];
        cur.push(boundary[(e + 1) % n]);
      } else if (cur) {
        seaGates.push(cur[0], cur[cur.length - 1]);
        segments.push(cur);
        cur = null;
      }
    }
    if (cur) { seaGates.push(cur[0], cur[cur.length - 1]); segments.push(cur); }
  }
  const towers: Point[] = [];
  for (const s of segments) for (const p of s) towers.push(p);
  const gates: Point[] = [];
  const flat: Point[] = segments.flat();
  const want = Math.max(1, Math.min(gateCount, Math.max(1, flat.length - 1)));
  for (let g = 0; g < want; g++) {
    const idx = Math.floor(((g + 0.5) / want) * flat.length) % flat.length;
    gates.push(flat[idx]);
  }
  return { segments, towers, gates, seaGates };
}
