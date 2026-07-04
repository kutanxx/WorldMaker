import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { generateCountryside } from "./countryside";
import { pointInPolygon, centroid } from "../geometry";
import { GRASSLAND } from "../biome";
import { buildWater } from "./water";
import type { CountrysideOpts } from "./countryside";

function plainOpts(): CountrysideOpts {
  const boundary = [] as [number, number][];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; boundary.push([230 + Math.cos(a) * 100, 230 + Math.sin(a) * 100]); }
  return {
    bounds: { w: 460, h: 460 }, boundary,
    water: buildWater(mulberry32(1), "none", { w: 460, h: 460 }),
    mountains: [],
    roads: [[[330, 230], [395, 232], [457, 230]], [[230, 330], [232, 395], [230, 457]]],
    obstacles: [], size: 3, biome: GRASSLAND, oasis: false,
  };
}

describe("generateCountryside — fields/gardens/orchards", () => {
  it("is deterministic", () => {
    const a = generateCountryside(mulberry32(9), plainOpts());
    const b = generateCountryside(mulberry32(9), plainOpts());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("plains city gets strip fields grouped near roads, all outside the boundary", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.fields.length).toBeGreaterThanOrEqual(3);
    for (const f of c.fields) {
      const ctr = centroid(f.polygon);
      expect(pointInPolygon(ctr, o.boundary)).toBe(false);
      expect(ctr[0]).toBeGreaterThan(3); expect(ctr[0]).toBeLessThan(457);
      expect(f.strips.length).toBeGreaterThanOrEqual(3); // ridge-and-furrow lines
      for (const s of f.strips) for (const p of s) expect(pointInPolygon(p, f.polygon)).toBe(true);
    }
  });
  it("kitchen gardens hug the wall; orchards carry trees inside their plot", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.gardens.length).toBeGreaterThanOrEqual(2);
    for (const g of c.gardens) {
      const ctr = centroid(g);
      const d = Math.hypot(ctr[0] - 230, ctr[1] - 230);
      expect(d).toBeGreaterThan(100); expect(d).toBeLessThan(125); // fringe ring just outside r=100
    }
    expect(c.orchards.length).toBeGreaterThanOrEqual(1);
    for (const or of c.orchards) {
      expect(or.trees.length).toBeGreaterThanOrEqual(4);
      for (const t of or.trees) expect(pointInPolygon(t, or.polygon)).toBe(true);
    }
  });
});
