import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid, pointInPolygon } from "./geometry";
import { inWater } from "./city/water";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5,
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
  it("keeps roads and building centroids inside the boundary and out of water", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...l.mainRoads, ...l.minorRoads]) for (const p of r) {
      expect(inWater(l.water, p)).toBe(false);
    }
    for (const w of l.wards) for (const b of w.buildings) {
      expect(pointInPolygon(centroid(b), l.boundary)).toBe(true);
    }
  });
});
