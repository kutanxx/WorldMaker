import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid } from "./geometry";
import { inWater } from "./city/water";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5,
};

describe("city v3", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99))).toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("builds a street network (main + minor roads)", () => {
    const layout = generateCityLayout(cityContext(base), 5);
    expect(layout.mainRoads.length).toBeGreaterThan(0);
    expect(layout.minorRoads.length).toBeGreaterThan(layout.mainRoads.length);
  });
  it("a coastal city is a coastalPort with sea water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(layout.archetype.id).toBe("coastalPort");
    expect(layout.water.kind).toBe("sea");
  });
  it("a high inland city is a hilltopFortress", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.8 }), 5);
    expect(layout.archetype.id).toBe("hilltopFortress");
  });
  it("never routes a road point through water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...layout.mainRoads, ...layout.minorRoads]) {
      for (const p of r) expect(inWater(layout.water, p)).toBe(false);
    }
  });
  it("never places a building centroid in water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const w of layout.wards) for (const b of w.buildings) {
      expect(inWater(layout.water, centroid(b))).toBe(false);
    }
  });
});
