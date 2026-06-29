import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, pointInPolygon } from "../geometry";
import { discPolygon, generateWards } from "./wards";

describe("wards", () => {
  it("discPolygon makes a closed ring with the right radius", () => {
    const d = discPolygon(150, 150, 100, 24);
    expect(d.length).toBe(24);
    expect(area(d)).toBeGreaterThan(Math.PI * 100 * 100 * 0.9);
  });
  it("generateWards yields the requested count of non-empty cells inside the disc", () => {
    const wards = generateWards(mulberry32(1), 150, 150, 100, 12);
    expect(wards.length).toBeGreaterThan(0);
    expect(wards.length).toBeLessThanOrEqual(12);
    for (const w of wards) {
      expect(w.polygon.length).toBeGreaterThanOrEqual(3);
      expect(area(w.polygon)).toBeGreaterThan(0);
      expect(pointInPolygon(w.site, discPolygon(150, 150, 100, 48))).toBe(true);
    }
  });
  it("is deterministic", () => {
    const a = generateWards(mulberry32(7), 150, 150, 100, 12);
    const b = generateWards(mulberry32(7), 150, 150, 100, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
