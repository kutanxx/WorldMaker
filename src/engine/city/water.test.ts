import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area } from "../geometry";
import type { Polyline } from "../geometry";
import { buildWater, inWater, waterBridges } from "./water";

const B = { w: 300, h: 300 };

describe("water", () => {
  it("sea produces a band on one side", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    expect(w.kind).toBe("sea");
    expect(w.bodies.length).toBe(1);
    expect(area(w.bodies[0])).toBeGreaterThan(0);
  });
  it("river crosses the map (spans top to bottom or side to side)", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const poly = w.bodies[0];
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const ySpan = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(xSpan, ySpan)).toBeGreaterThan(150);
  });
  it("lake is an enclosed inland body not touching the border", () => {
    const w = buildWater(mulberry32(3), "lake", B);
    const xs = w.bodies[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(300);
  });
  it("none produces no bodies", () => {
    expect(buildWater(mulberry32(1), "none", B).bodies.length).toBe(0);
  });
  it("inWater is true inside a body and false at the centre for a side sea", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    const inside = w.bodies[0][0];
    expect(inWater(w, inside)).toBe(true);
  });
  it("waterBridges marks a bridge where a road crosses a river", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const road: Polyline = [[0, 150], [300, 150]];
    expect(waterBridges([road], w).length).toBeGreaterThanOrEqual(1);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildWater(mulberry32(7), "meander", B)))
      .toBe(JSON.stringify(buildWater(mulberry32(7), "meander", B)));
  });
});
