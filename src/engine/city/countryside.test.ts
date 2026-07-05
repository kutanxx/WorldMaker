import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { generateCountryside } from "./countryside";
import { pointInPolygon, centroid, polysOverlap, pointSegDist } from "../geometry";
import type { Polygon } from "../geometry";
import { GRASSLAND, DESERT } from "../biome";
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
    obstacles: [], moat: [], size: 3, biome: GRASSLAND, oasis: false,
  };
}

// a ring just outside the r=100 boundary, like the real wall-offset moat
function moatRing(): [number, number][][] {
  const ring: [number, number][] = [];
  for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push([230 + Math.cos(a) * 104, 230 + Math.sin(a) * 104]); }
  return [ring];
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
    expect(c.dry).toBe(false);
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

describe("generateCountryside — pastures/farmsteads/woods", () => {
  it("plains city gets fenced pastures with animals inside, farmsteads with barns", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBeGreaterThanOrEqual(2);
    for (const p of c.pastures) {
      expect(p.animals.length).toBeGreaterThanOrEqual(2);
      for (const a of p.animals) expect(pointInPolygon(a, p.fence)).toBe(true);
    }
    expect(c.farmsteads.length).toBeGreaterThanOrEqual(1);
    for (const f of c.farmsteads) {
      expect(pointInPolygon(centroid(f.barn), o.boundary)).toBe(false);
      // barn is the bigger footprint (research: barns dwarf the farmhouse)
      const area = (poly: Polygon) => Math.abs(poly.reduce((s, [x, y], i, arr) => { const [nx2, ny2] = arr[(i + 1) % arr.length]; return s + x * ny2 - nx2 * y; }, 0) / 2);
      expect(area(f.barn)).toBeGreaterThan(area(f.house));
    }
    expect(c.woods.length).toBeGreaterThanOrEqual(10);
    for (const t of c.woods) {
      const nearEdge = t[0] < 40 || t[0] > 420 || t[1] < 40 || t[1] > 420;
      expect(nearEdge).toBe(true);
    }
  });
  it("patches never overlap each other and roads never cut through them (user-reported)", () => {
    for (const seed of [7, 9, 21]) {
      const o = plainOpts();
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (let i = 0; i < patches.length; i++) {
        for (let j = i + 1; j < patches.length; j++) {
          expect(polysOverlap(patches[i], patches[j])).toBe(false);
        }
      }
      // sample every road at 4px steps: no sample may land inside a patch
      for (const road of o.roads) for (let i = 0; i < road.length - 1; i++) {
        const [x1, y1] = road[i], [x2, y2] = road[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4));
        for (let s = 0; s <= steps; s++) {
          const p: [number, number] = [x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps];
          for (const patch of patches) expect(pointInPolygon(p, patch)).toBe(false);
        }
      }
      // trees stay out of patches too
      for (const t of c.woods) for (const patch of patches) expect(pointInPolygon(t, patch)).toBe(false);
    }
  });
  it("places nucleated villages (chapel + green + house cluster) out in open country", () => {
    const o = plainOpts();
    let total = 0, croftTotal = 0;
    for (const seed of [9, 3, 7, 21, 42]) {
      const c = generateCountryside(mulberry32(seed), o);
      for (const v of c.villages) {
        total++;
        expect(v.houses.length).toBeGreaterThanOrEqual(5);
        expect(pointInPolygon(v.chapel, o.boundary)).toBe(false);
        expect(pointInPolygon(centroid(v.green), o.boundary)).toBe(false);
        for (const h of v.houses) expect(pointInPolygon(centroid(h), o.boundary)).toBe(false);
        // a nucleated hamlet, not a ribbon: an approach lane + tofts/pond enrich the cluster,
        // and the cottages sit tightly around the green (all within a compact radius)
        expect(v.lane.length).toBeGreaterThanOrEqual(2);
        const gc = centroid(v.green);
        for (const h of v.houses) expect(Math.hypot(centroid(h)[0] - gc[0], centroid(h)[1] - gc[1])).toBeLessThan(14);
        for (const cr of v.crofts) expect(pointInPolygon(centroid(cr), o.boundary)).toBe(false);
        // the lane threads the gaps between cottages — it never runs through a house
        for (const h of v.houses) {
          let hit = false;
          for (let i = 0; i < v.lane.length - 1; i++) {
            const a = v.lane[i], b = v.lane[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
            for (let s = 0; s <= steps; s++) if (pointInPolygon([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps], h)) hit = true;
          }
          expect(hit).toBe(false);
        }
        croftTotal += v.crofts.length;
      }
    }
    expect(total).toBeGreaterThanOrEqual(1);
    expect(croftTotal).toBeGreaterThan(0); // garden tofts actually get placed (regressed to 0 once)
  });
  it("runs a three-field rotation: one sector lies fallow, the rest cultivated", () => {
    let sawFallow = false, sawCultivated = false;
    for (const seed of [3, 7, 9, 21, 42]) {
      const c = generateCountryside(mulberry32(seed), plainOpts());
      for (const f of c.fields) {
        expect(["cultivated", "fallow"]).toContain(f.state);
        if (f.state === "fallow") sawFallow = true;
        if (f.state === "cultivated") sawCultivated = true;
      }
    }
    expect(sawFallow).toBe(true);
    expect(sawCultivated).toBe(true);
  });
  it("desert fields are all cultivated (irrigation, not rotation)", () => {
    const c = generateCountryside(mulberry32(9), { ...plainOpts(), biome: DESERT });
    for (const f of c.fields) expect(f.state).toBe("cultivated");
  });

  it("keeps gardens and every patch clear of the moat ring (user-reported farm-vs-water overlap)", () => {
    for (const seed of [9, 3, 7, 21, 42]) {
      const o = { ...plainOpts(), moat: moatRing() };
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (const patch of patches) for (const seg of o.moat) for (let i = 0; i < seg.length - 1; i++) {
        for (const v of patch) expect(pointSegDist(v, seg[i], seg[i + 1])).toBeGreaterThan(2.5);
      }
      expect(c.gardens.length).toBeGreaterThanOrEqual(2); // still populated past the moat
    }
  });
  it("no countryside patch overlaps the watercourse when a river crosses the map", () => {
    for (const seed of [3, 7, 9, 21, 42]) {
      const o = plainOpts();
      o.water = buildWater(mulberry32(seed), "river", { w: 460, h: 460 });
      const c = generateCountryside(mulberry32(seed), o);
      const patches: Polygon[] = [
        ...c.gardens, ...c.fields.map((f) => f.polygon), ...c.pastures.map((p) => p.fence),
        ...c.orchards.map((or) => or.polygon), ...c.farmsteads.flatMap((f) => [f.house, f.barn]),
        ...c.villages.flatMap((v) => [v.green, ...v.houses]),
      ];
      for (const patch of patches) for (const body of o.water.bodies) {
        expect(polysOverlap(patch, body)).toBe(false);
      }
    }
  });

  it("desert city has no pastures and no woods", () => {
    const o = { ...plainOpts(), biome: DESERT };
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBe(0);
    expect(c.woods.length).toBe(0);
    expect(c.dry).toBe(true);
  });
});
