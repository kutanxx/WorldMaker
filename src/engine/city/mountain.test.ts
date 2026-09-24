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

// The high ground stands where the world has it: a mountain town's masses face the world's mountains,
// and a town at their foot has them rise past its fields — they used to face a direction the plate drew
// for itself (9 of 15 mountain towns more than 45 degrees off), and a foothill town drew none.
describe("the world's mountains on the plate", () => {
  const plains = TABLE.plainsMarket;
  const facing = (m: { innerEdge: Point[] }) => {
    let x = 0, y = 0;
    for (const p of m.innerEdge) { x += p[0] - center[0]; y += p[1] - center[1]; }
    return Math.atan2(y, x);
  };
  const off = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };

  it("turns a mountain town's high ground toward the world's mountains", () => {
    for (const bearing of [-2.5, -1, 0.4, 2]) {
      for (const kind of [TABLE.hilltopFortress, TABLE.hillside]) {
        const [m] = makeMountains(mulberry32(3), kind, ring, center, bounds, { bearing });
        expect(off(facing(m), bearing), `${kind.id} toward ${bearing}`).toBeLessThan(0.3);
      }
    }
  });

  it("raises foothills past a town's fields on the side the world's mountains are", () => {
    const masses = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0.8, share: 0.4, rng: mulberry32(9) });
    expect(masses.length).toBe(1);
    expect(off(facing(masses[0]), 0.8)).toBeLessThan(0.2);
    // the town keeps its own ground: the band begins well past the wall (radius 60 here)
    for (const p of masses[0].innerEdge) expect(Math.hypot(p[0] - center[0], p[1] - center[1])).toBeGreaterThan(60 + 25);
    // ...and without a site, or with no mountains beside it, a plains town has none
    expect(makeMountains(mulberry32(3), plains, ring, center, bounds)).toEqual([]);
  });

  it("widens the foothills the more of the town's neighbours are mountains", () => {
    const span = (share: number) => {
      const [m] = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0, share, rng: mulberry32(9) });
      const angles = m.innerEdge.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]));
      return Math.max(...angles) - Math.min(...angles);
    };
    expect(span(0.8)).toBeGreaterThan(span(0.2) * 1.8);
  });

  it("lets a river run out through the foothills rather than under them", () => {
    // a river crossing the band due east of the town
    const wet = (p: Point) => Math.abs(p[1] - center[1]) < 8 && p[0] > center[0];
    const masses = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0, share: 0.5, rng: mulberry32(9), wet });
    expect(masses.length, "the band is cut in two").toBe(2);
    for (const m of masses) for (let x = 0; x < bounds.w; x += 2) for (let y = center[1] - 7; y <= center[1] + 7; y += 2) {
      if (!wet([x, y])) continue;
      expect(inMountains([m], [x, y]), `mountain over the river at ${x},${y}`).toBe(false);
    }
  });
});
