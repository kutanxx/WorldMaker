import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";
import type { Archetype } from "./archetypes";

export interface MountainMass {
  polygon: Polygon;    // inner rim arc (city side) → outer canvas edge (wedge mass)
  innerEdge: Polyline; // city-facing rim arc, ordered by angle
  steep: boolean;      // spur/valleyPass = sharp cliff; hillside = gentle slope
}

interface MassSpec { dir: number; phi: number; steep: boolean }

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function massSpecs(rng: Rng, id: Archetype["id"]): MassSpec[] {
  const base = rng() * Math.PI * 2;
  if (id === "hillside") return [{ dir: base, phi: 0.9, steep: false }];
  if (id === "spur") return [0, 1, 2].map((k) => ({ dir: base + (k * 2 * Math.PI) / 3 + (rng() - 0.5) * 0.3, phi: 0.7, steep: true }));
  // valleyPass: two opposite valley walls
  return [{ dir: base, phi: 0.7, steep: true }, { dir: base + Math.PI, phi: 0.7, steep: true }];
}

export function makeMountains(
  rng: Rng, archetype: Archetype, boundary: Polygon, center: Point, bounds: { w: number; h: number },
): MountainMass[] {
  if (archetype.id !== "hillside" && archetype.id !== "spur" && archetype.id !== "valleyPass") return [];
  const specs = massSpecs(rng, archetype.id);
  const noise = createNoise2D(rng);
  const vAng = boundary.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]));

  const masses: MountainMass[] = [];
  for (const spec of specs) {
    const inner: Point[] = [];
    for (let i = 0; i < boundary.length; i++) {
      if (Math.abs(wrap(vAng[i] - spec.dir)) <= spec.phi) inner.push(boundary[i]);
    }
    if (inner.length < 2) continue;
    inner.sort((a, b) =>
      wrap(Math.atan2(a[1] - center[1], a[0] - center[0]) - spec.dir) -
      wrap(Math.atan2(b[1] - center[1], b[0] - center[0]) - spec.dir));

    const outer: Point[] = [];
    for (const p of inner) {
      const dx = p[0] - center[0], dy = p[1] - center[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const tx = ux > 0 ? (bounds.w - 2 - p[0]) / ux : ux < 0 ? (2 - p[0]) / ux : Infinity;
      const ty = uy > 0 ? (bounds.h - 2 - p[1]) / uy : uy < 0 ? (2 - p[1]) / uy : Infinity;
      const reach = Math.max(6, Math.min(tx, ty)) * (0.7 + 0.3 * (noise(p[0] * 0.05, p[1] * 0.05) * 0.5 + 0.5));
      outer.push([p[0] + ux * reach, p[1] + uy * reach]);
    }
    masses.push({ polygon: inner.concat([...outer].reverse()), innerEdge: inner, steep: spec.steep });
  }
  return masses;
}

export function inMountains(masses: MountainMass[], p: Point): boolean {
  return masses.some((m) => pointInPolygon(p, m.polygon));
}
