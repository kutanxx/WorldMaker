import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import type { Archetype } from "./archetypes";
import type { Water } from "./water";
import { inWater } from "./water";

export function makeBoundary(
  rng: Rng, archetype: Archetype, size: number, center: Point, water: Water
): Polygon {
  const noise = createNoise2D(rng);
  const base = 58 + size * 12;
  const N = 22;
  const axis = rng() * Math.PI;
  const poly: Polygon = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = base * (0.8 + 0.34 * (noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5) * 0.5 + 0.5));
    if (archetype.streetField === "linear") r *= 1 + 0.55 * Math.abs(Math.cos(a - axis));
    else if (archetype.wallShape === "contour") r *= 0.82;
    let p: Point = [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
    const floorSq = (base * 0.3) ** 2;
    let guard = 0;
    while (inWater(water, p) && guard < 30) {
      const np: Point = [p[0] + (center[0] - p[0]) * 0.12, p[1] + (center[1] - p[1]) * 0.12];
      const dx = np[0] - center[0], dy = np[1] - center[1];
      if (dx * dx + dy * dy < floorSq) break; // don't collapse the vertex toward the centre
      p = np;
      guard++;
    }
    poly.push(p);
  }
  return poly;
}
