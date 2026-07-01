import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid, pointInPolygon } from "./geometry";
import { inWater } from "./city/water";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5, biome: 4,
};

function curvaturePct(road: [number, number][]): number {
  if (road.length < 3) return 0;
  const a = road[0], b = road[road.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let m = 0;
  for (const p of road) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > m) m = d;
  }
  return (m / len) * 100;
}

describe("city organic", () => {
  it("is deterministic", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 9))).toBe(JSON.stringify(generateCityLayout(ctx, 9)));
  });
  it("varies with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("exposes an irregular boundary polygon (radius varies)", () => {
    const l = generateCityLayout(cityContext(base), 5);
    const rs = l.boundary.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
    expect(l.boundary.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(1.2);
  });
  it("has at least one genuinely curved main road across seeds", () => {
    let curved = false;
    for (let s = 1; s <= 6; s++) {
      const l = generateCityLayout(cityContext({ ...base, coastal: false }), s);
      if (l.mainRoads.some((r) => curvaturePct(r) > 12)) curved = true;
    }
    expect(curved).toBe(true);
  });
  it("a coastal city leaves the seaward wall open (sea gates present)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.wall).not.toBeNull();
    expect(l.wall!.seaGates.length).toBeGreaterThan(0);
  });
  it("gives a moated city one gate bridge per gate, each spanning the moat", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.moat).not.toBeNull(); // coastalPort has a moat
    expect(l.gateBridges.length).toBe(l.wall!.gates.length);
    for (const br of l.gateBridges) {
      const len = Math.hypot(br[1][0] - br[0][0], br[1][1] - br[0][1]);
      expect(len).toBeGreaterThan(6); // crosses the ~6px moat band
    }
  });
  it("has no gate bridges when there is no moat", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.85 }), 5);
    expect(l.moat).toBeNull(); // hilltopFortress has no moat
    expect(l.gateBridges.length).toBe(0);
  });
  it("keeps roads and building centroids inside the boundary and out of water", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...l.mainRoads, ...l.minorRoads]) for (const p of r) {
      expect(inWater(l.water, p)).toBe(false);
    }
    for (const w of l.wards) for (const b of w.buildings) {
      expect(pointInPolygon(centroid(b), l.boundary)).toBe(true);
    }
  });
  it("always exposes features with archetype-derived defaults", () => {
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 5);
    expect(plains.features.wallMaterial).toBe("stone");
    expect(plains.features.groundColor).toBe("#efe7d2");
    expect(plains.features.trees).toEqual([]);
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 5);
    expect(forest.features.wallMaterial).toBe("timber");
    expect(forest.features.groundColor).toBe("#e3e7d0");
  });
  it("scatters trees on open ground for a forest city (none for plains)", () => {
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 7);
    expect(forest.features.trees.length).toBeGreaterThan(0);
    for (const t of forest.features.trees) {
      expect(pointInPolygon(t, forest.boundary)).toBe(true);
      expect(inWater(forest.water, t)).toBe(false);
    }
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 7);
    expect(plains.features.trees).toEqual([]);
  });
  it("gives a desert city a central oasis (water body) and no green parks", () => {
    const desert = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 5 }), 7);
    expect(desert.features.oasis).not.toBeNull();
    expect(desert.parks.length).toBe(0);
    // the oasis was added to the water bodies (so buildings/roads avoid it via the water filter)
    const o = desert.features.oasis!;
    const hasOasisBody = desert.water.bodies.some((body) => {
      const c = centroid(body);
      return Math.hypot(c[0] - o.center[0], c[1] - o.center[1]) < 3;
    });
    expect(hasOasisBody).toBe(true);
    // buildings never sit in water (oasis included)
    for (const w of desert.wards) for (const b of w.buildings) {
      expect(inWater(desert.water, centroid(b))).toBe(false);
    }
  });
  it("lets a marsh city keep buildings over water (stilts)", () => {
    const marsh = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 7 }), 7);
    expect(marsh.features.onStilts).toBe(true);
    const overWater = marsh.wards.flatMap((w) => w.buildings).filter((b) => inWater(marsh.water, centroid(b)));
    expect(overWater.length).toBeGreaterThan(0);
  });
});
