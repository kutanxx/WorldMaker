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
});
