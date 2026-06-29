import type { Point, Polygon } from "../geometry";
import { convexHull, insetPolygon } from "../geometry";
import type { ZonedWard } from "./zoning";

export interface Wall {
  ring: Polygon;
  towers: Point[];
  gates: Point[];
}

export function buildWall(innerWards: ZonedWard[], gateCount: number): Wall {
  const pts: Point[] = [];
  for (const w of innerWards) for (const v of w.polygon) pts.push(v);
  const hull = convexHull(pts);
  const ring = insetPolygon(hull, -3);
  const towers = ring.slice();
  const gates: Point[] = [];
  const n = Math.max(1, gateCount);
  for (let g = 0; g < n; g++) {
    const i = Math.floor((g / n) * ring.length);
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    gates.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return { ring, towers, gates };
}

export function buildMoat(ring: Polygon, d: number): Polygon {
  return insetPolygon(ring, -d);
}
