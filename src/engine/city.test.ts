import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { pointInPolygon, centroid } from "./geometry";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false,
};

describe("city v2", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99))).toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("produces many wards and buildings", () => {
    const layout = generateCityLayout(cityContext(base), 5);
    expect(layout.wards.length).toBeGreaterThan(6);
    const totalBuildings = layout.wards.reduce((n, w) => n + w.buildings.length, 0);
    expect(totalBuildings).toBeGreaterThan(20);
  });
  it("a capital has a castle and a closed wall", () => {
    const layout = generateCityLayout(cityContext({ ...base, isCapital: true, size: 5 }), 5);
    expect(layout.wards.some((w) => w.type === "castle")).toBe(true);
    expect(layout.wall).not.toBeNull();
    expect(layout.wall!.ring.length).toBeGreaterThanOrEqual(3);
  });
  it("a coastal city has water and a harbor", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(layout.water).not.toBeNull();
    expect(layout.wards.some((w) => w.type === "harbor")).toBe(true);
  });
  it("a non-coastal city has no water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: false }), 5);
    expect(layout.water).toBeNull();
  });
  it("scales ward count with size", () => {
    const small = generateCityLayout(cityContext({ ...base, size: 1 }), 5);
    const big = generateCityLayout(cityContext({ ...base, size: 6 }), 5);
    expect(big.wards.length).toBeGreaterThan(small.wards.length);
  });
  it("never places building footprints inside the water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const w of layout.wards) {
      for (const b of w.buildings) {
        expect(pointInPolygon(centroid(b), layout.water!.polygon)).toBe(false);
      }
    }
  });
});
