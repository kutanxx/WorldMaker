import type { Rng } from "../rng";
import { randInt } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";
import type { WaterKind } from "./archetypes";
import { createNoise2D } from "simplex-noise";

export interface Water {
  kind: WaterKind;
  bodies: Polygon[];
  bridges: [Point, Point][];
}

function ribbon(center: Polyline, halfWidth: number): Polygon {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(center.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m, ny = dx / m;
    left.push([center[i][0] + nx * halfWidth, center[i][1] + ny * halfWidth]);
    right.push([center[i][0] - nx * halfWidth, center[i][1] - ny * halfWidth]);
  }
  return left.concat(right.reverse());
}

export function buildWater(rng: Rng, kind: WaterKind, bounds: { w: number; h: number }): Water {
  const { w, h } = bounds;
  if (kind === "none") return { kind, bodies: [], bridges: [] };

  if (kind === "sea") {
    const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
    const noise = createNoise2D(rng);
    const depth = (0.24 + rng() * 0.1) * (side % 2 === 0 ? w : h);
    const K = 12, amp = 13;
    const edge: Point[] = [];
    for (let i = 0; i <= K; i++) {
      const t = i / K;
      const n = noise(t * 3.2, side * 1.7) * amp;
      if (side === 0) edge.push([w - depth + n, t * h]);
      else if (side === 1) edge.push([t * w, h - depth + n]);
      else if (side === 2) edge.push([depth + n, t * h]);
      else edge.push([t * w, depth + n]);
    }
    let polygon: Polygon;
    if (side === 0) polygon = [[w, 0], ...edge, [w, h]];
    else if (side === 1) polygon = [[0, h], ...edge, [w, h]];
    else if (side === 2) polygon = [[0, 0], ...edge, [0, h]];
    else polygon = [[0, 0], ...edge, [w, 0]];
    return { kind, bodies: [polygon], bridges: [] };
  }

  if (kind === "lake") {
    const cx = w * (0.35 + rng() * 0.3), cy = h * (0.35 + rng() * 0.3);
    const r = 28 + rng() * 22;
    const poly: Polygon = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.4);
      poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return { kind, bodies: [poly], bridges: [] };
  }

  // river / meander: a winding centre line crossing the map, turned into a ribbon
  const vertical = kind === "river" ? rng() < 0.5 : true;
  const center: Polyline = [];
  const steps = 12;
  const amp = kind === "meander" ? 70 : 40;
  const base = vertical ? w * (0.4 + rng() * 0.2) : h * (0.4 + rng() * 0.2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * Math.PI * (kind === "meander" ? 3 : 2)) * amp * (0.75 + rng() * 0.5);
    if (vertical) center.push([base + off, t * h]);
    else center.push([t * w, base + off]);
  }
  const poly = ribbon(center, kind === "meander" ? 16 : 11);
  return { kind, bodies: [poly], bridges: [] };
}

export function inWater(water: Water, p: Point): boolean {
  for (const body of water.bodies) if (pointInPolygon(p, body)) return true;
  return false;
}

export function waterBridges(roads: Polyline[], water: Water): [Point, Point][] {
  const bridges: [Point, Point][] = [];
  for (const r of roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      if (inWater(water, a) !== inWater(water, b)) {
        bridges.push([a, b]);
        break;
      }
    }
  }
  return bridges;
}
