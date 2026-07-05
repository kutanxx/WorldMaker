import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import type { Archetype } from "./archetypes";
import type { Water } from "./water";
import { inWater } from "./water";

// nearest point on any water body's edge, and the direction from p toward it (outward, since p is
// inside the water). Used to lift a boundary vertex to the closest BANK.
function nearestShore(water: Water, p: Point): Point | null {
  let best: Point | null = null, bd = Infinity;
  for (const body of water.bodies) {
    for (let i = 0; i < body.length; i++) {
      const a = body[i], b = body[(i + 1) % body.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const q: Point = [a[0] + dx * t, a[1] + dy * t];
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
  }
  return best;
}

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
    // lift a vertex that lands in the water out to the NEAREST BANK, not radially toward the centre:
    // for a wide river crossing the town, boring inward drove the vertex to the min-radius floor,
    // leaving a deep spike that made the wall jut inward at the river (user-reported). Snapping to
    // the closest shore keeps the boundary hugging the riverbank so the wall opens cleanly.
    if (inWater(water, p)) {
      const s = nearestShore(water, p);
      if (s) {
        const dx = s[0] - p[0], dy = s[1] - p[1], dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl, uy = dy / dl;
        let q: Point = [s[0] + ux * 3, s[1] + uy * 3];
        for (let g = 0; g < 8 && inWater(water, q); g++) q = [q[0] + ux * 3, q[1] + uy * 3];
        p = q;
      }
    }
    poly.push(p);
  }
  return poly;
}
