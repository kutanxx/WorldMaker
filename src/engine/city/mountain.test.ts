import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { Polygon, Point } from "../geometry";
import { makeMountains, inMountains } from "./mountain";
import { selectArchetype, TABLE } from "./archetypes";

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
  // named rather than reached through `pick`: the variant list grows, and a test that says "0.6
  // means spur" breaks for a reason that has nothing to do with what it is checking.
  it("gives each kind of high ground the number of masses its shape needs", () => {
    expect(makeMountains(mulberry32(3), TABLE.hillside, ring, center, bounds).length).toBe(1);
    expect(makeMountains(mulberry32(3), TABLE.spur, ring, center, bounds).length).toBe(3);
    expect(makeMountains(mulberry32(3), TABLE.valleyPass, ring, center, bounds).length).toBe(2);
    expect(makeMountains(mulberry32(3), TABLE.hilltopFortress, ring, center, bounds).length).toBe(1);
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

// makeMountains listed hillside, spur and valleyPass and stopped there, so the one mountain variant
// named for its high ground was the one that never got any: a hilltop fortress was drawn on a flat
// plain. It gets a single broad shoulder rather than a full collar -- the masses run out to the edge
// of the plate, and a ring of them would swallow the fields and hamlets outside the wall.
describe("the fortress on the hill", () => {
  const ring: Polygon = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return [center[0] + Math.cos(a) * 60, center[1] + Math.sin(a) * 60] as Point;
  });
  it("stands on high ground like the other mountain kinds", () => {
    const arch = selectArchetype({ coastal: false, elevation: 0.9, size: 3, biome: 4, pick: 0 });
    expect(arch.id).toBe("hilltopFortress");
    expect(makeMountains(mulberry32(5), arch, ring, center, bounds).length).toBeGreaterThan(0);
  });
  it("keeps ground open outside the wall for its fields and hamlets", () => {
    const arch = selectArchetype({ coastal: false, elevation: 0.9, size: 3, biome: 4, pick: 0 });
    const masses = makeMountains(mulberry32(5), arch, ring, center, bounds);
    // sample the ring of ground just outside the wall: a collar of rock would leave nowhere to farm
    let open = 0, total = 0;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p: Point = [center[0] + Math.cos(a) * 80, center[1] + Math.sin(a) * 80];
      total++;
      if (!inMountains(masses, p)) open++;
    }
    expect(open / total).toBeGreaterThan(0.4);
  });
});
