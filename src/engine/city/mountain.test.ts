import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { Polygon, Point } from "../geometry";
import { makeMountains, inMountains } from "./mountain";
import { selectArchetype } from "./archetypes";

const bounds = { w: 300, h: 300 };
const center: Point = [150, 150];
const ring: Polygon = [];
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const mtn = { coastal: false, elevation: 0.9, size: 4, biome: 4 };
const arch = (pick: number) => selectArchetype({ ...mtn, pick });

describe("makeMountains", () => {
  it("returns [] for non-mountain archetypes without drawing rng", () => {
    const rngA = mulberry32(1), rngB = mulberry32(1);
    const plains = selectArchetype({ ...mtn, elevation: 0.5, biome: 4 }); // plainsMarket
    expect(makeMountains(rngA, plains, ring, center, bounds)).toEqual([]);
    // the rng must be untouched: a fresh rng at the same seed yields the same next value
    expect(rngA()).toBe(rngB());
  });
  it("makes 1 mass for hillside, 3 for spur, 2 for valleyPass", () => {
    expect(makeMountains(mulberry32(3), arch(0.3), ring, center, bounds).length).toBe(1); // hillside
    expect(makeMountains(mulberry32(3), arch(0.6), ring, center, bounds).length).toBe(3); // spur
    expect(makeMountains(mulberry32(3), arch(0.99), ring, center, bounds).length).toBe(2); // valleyPass
  });
  it("each mass is a closed-ish polygon with an inner edge; interior sits outside the rim", () => {
    const masses = makeMountains(mulberry32(7), arch(0.3), ring, center, bounds);
    for (const m of masses) {
      expect(m.polygon.length).toBeGreaterThanOrEqual(4);
      expect(m.innerEdge.length).toBeGreaterThanOrEqual(2);
    }
    // the city centre is never inside a mass; a point just outside a covered rim vertex is
    expect(inMountains(masses, center)).toBe(false);
    const rimV = masses[0].innerEdge[0];
    const outward: Point = [rimV[0] + (rimV[0] - 150) * 0.15, rimV[1] + (rimV[1] - 150) * 0.15];
    expect(inMountains(masses, outward)).toBe(true);
  });
  it("is deterministic for a given rng seed", () => {
    const a = makeMountains(mulberry32(5), arch(0.6), ring, center, bounds);
    const b = makeMountains(mulberry32(5), arch(0.6), ring, center, bounds);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
