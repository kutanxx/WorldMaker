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
}

export function makeHarbor(
  rng: Rng, water: Water, boundary: Polygon, center: Point,
): Harbor | null {
  if (water.kind !== "sea") return null;

  // seaward rim = boundary vertices whose just-outside sample is in the sea
  const shore: Point[] = [];
  for (const v of boundary) {
    const out: Point = [v[0] + (v[0] - center[0]) * 0.08, v[1] + (v[1] - center[1]) * 0.08];
    if (inWater(water, out)) shore.push(v);
  }
  if (shore.length < 2) return null;

  const anchor: Point = [
    shore.reduce((s, p) => s + p[0], 0) / shore.length,
    shore.reduce((s, p) => s + p[1], 0) / shore.length,
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

  return { breakwater, lighthouse: tip, piers, boats };
}
