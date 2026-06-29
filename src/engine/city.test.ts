import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: false, size: 3, coastal: false,
};

describe("city", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99)))
      .toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1)))
      .not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("has a closed wall and districts scaling with size", () => {
    const small = generateCityLayout(cityContext({ ...base, size: 1 }), 5);
    const big = generateCityLayout(cityContext({ ...base, size: 6 }), 5);
    expect(small.wall.length).toBeGreaterThan(2);
    expect(big.districts.length).toBeGreaterThan(small.districts.length);
  });
  it("adds a river only when coastal", () => {
    expect(generateCityLayout(cityContext({ ...base, coastal: false }), 5).river).toBeNull();
    expect(generateCityLayout(cityContext({ ...base, coastal: true }), 5).river).not.toBeNull();
  });
  it("river path varies with the world seed for a coastal city", () => {
    const ctx = cityContext({ ...base, coastal: true });
    const a = generateCityLayout(ctx, 1).river;
    const b = generateCityLayout(ctx, 2).river;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
