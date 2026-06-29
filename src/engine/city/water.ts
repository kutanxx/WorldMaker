import type { Rng } from "../rng";
import { randInt } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";

export interface Water {
  polygon: Polygon;
  bridges: [Point, Point][];
}

export function buildWater(rng: Rng, bounds: { w: number; h: number }): Water {
  const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
  const { w, h } = bounds;
  const depth = 0.22 + rng() * 0.1;
  let polygon: Polygon;
  if (side === 0) polygon = [[w * (1 - depth), 0], [w, 0], [w, h], [w * (1 - depth), h]];
  else if (side === 1) polygon = [[0, h * (1 - depth)], [w, h * (1 - depth)], [w, h], [0, h]];
  else if (side === 2) polygon = [[0, 0], [w * depth, 0], [w * depth, h], [0, h]];
  else polygon = [[0, 0], [w, 0], [w, h * depth], [0, h * depth]];
  return { polygon, bridges: [] };
}

export function waterBridges(roads: Polyline[], polygon: Polygon): [Point, Point][] {
  const bridges: [Point, Point][] = [];
  for (const r of roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      if (pointInPolygon(a, polygon) !== pointInPolygon(b, polygon)) {
        bridges.push([a, b]);
        break;
      }
    }
  }
  return bridges;
}
