import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { pointInPolygon } from "../geometry";
import type { Point } from "../geometry";
import { buildWater } from "./water";
import { makeBoundary } from "./cityBoundary";
import type { Archetype } from "./archetypes";

const C: Point = [150, 150];
const arch = (over: Partial<Archetype>): Archetype => ({
  id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "none", ...over,
});

describe("cityBoundary", () => {
  it("is a closed irregular ring (radius varies, not a circle)", () => {
    const b = makeBoundary(mulberry32(1), arch({}), 4, C, buildWater(mulberry32(1), "none", { w: 300, h: 300 }));
    expect(b.length).toBeGreaterThanOrEqual(16);
    const rs = b.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
    expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(1.25);
  });
  it("keeps all vertices out of the water (coastal D-shape)", () => {
    const water = buildWater(mulberry32(2), "sea", { w: 300, h: 300 });
    const b = makeBoundary(mulberry32(2), arch({ id: "coastalPort", streetField: "organic", water: "sea" }), 4, C, water);
    for (const p of b) {
      for (const body of water.bodies) expect(pointInPolygon(p, body)).toBe(false);
    }
  });
  it("elongates a linear archetype more than a compact one (axis-independent)", () => {
    const w = buildWater(mulberry32(3), "none", { w: 300, h: 300 });
    const polarSpread = (a: Archetype) => {
      const b = makeBoundary(mulberry32(3), a, 4, C, w);
      const rs = b.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
      return Math.max(...rs) / Math.min(...rs);
    };
    const linear = polarSpread(arch({ id: "ridgeLinear", streetField: "linear" }));
    const compact = polarSpread(arch({ id: "hilltopFortress", streetField: "radial", wallShape: "contour" }));
    expect(linear).toBeGreaterThan(compact * 1.1);
    expect(linear).toBeGreaterThan(1.4);
  });
  it("is deterministic", () => {
    const w = buildWater(mulberry32(5), "none", { w: 300, h: 300 });
    expect(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)))
      .toBe(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)));
  });
});
