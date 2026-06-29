import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area } from "../geometry";
import type { Polyline } from "../geometry";
import { buildWater, waterBridges } from "./water";

describe("water", () => {
  it("produces a non-empty coastal band polygon", () => {
    const w = buildWater(mulberry32(1), { w: 300, h: 300 });
    expect(w.polygon.length).toBeGreaterThanOrEqual(4);
    expect(area(w.polygon)).toBeGreaterThan(0);
    expect(w.bridges).toEqual([]);
  });
  it("is deterministic", () => {
    const a = buildWater(mulberry32(9), { w: 300, h: 300 });
    const b = buildWater(mulberry32(9), { w: 300, h: 300 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("waterBridges marks a bridge where a road crosses the water edge", () => {
    const w = buildWater(mulberry32(1), { w: 300, h: 300 });
    // a corner-to-corner diagonal crosses any of the four side bands
    const road: Polyline = [[0, 0], [300, 300]];
    const bridges = waterBridges([road], w.polygon);
    expect(bridges.length).toBeGreaterThanOrEqual(1);
    // a tiny road in the dry centre yields no bridge
    expect(waterBridges([[[150, 150], [152, 152]]], w.polygon).length).toBe(0);
  });
  it("can place the band on all four sides across seeds", () => {
    const sides = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const poly = buildWater(mulberry32(s), { w: 300, h: 300 }).polygon;
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      if (maxX >= 300 && minX > 150) sides.add("right");
      else if (minX <= 0 && maxX < 150) sides.add("left");
      else if (maxY >= 300 && minY > 150) sides.add("bottom");
      else if (minY <= 0 && maxY < 150) sides.add("top");
    }
    expect(sides.size).toBe(4);
  });
});
