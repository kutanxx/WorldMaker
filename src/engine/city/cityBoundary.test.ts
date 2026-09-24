import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { pointInPolygon } from "../geometry";
import type { Point } from "../geometry";
import { buildWater } from "./water";
import type { Water } from "./water";
import { makeBoundary } from "./cityBoundary";
import type { Archetype } from "./archetypes";

const C: Point = [150, 150];
const arch = (over: Partial<Archetype>): Archetype => ({
  id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "none",
  wallMaterial: "stone", vegetation: "none", onStilts: false, oasis: false, groundColor: "#efe7d2",
  ...over,
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
    const linear = polarSpread(arch({ id: "valleyPass", streetField: "linear" }));
    const compact = polarSpread(arch({ id: "hilltopFortress", streetField: "radial", wallShape: "contour" }));
    expect(linear).toBeGreaterThan(compact * 1.1);
    expect(linear).toBeGreaterThan(1.4);
  });
  // The way a town runs, where its ground gives it one (see relief.ts): a valley town along its valley,
  // a spur town out along its ridge. The axis was a draw of dice, so a town in a pass could lie across it.
  it("runs a town the way its ground gives it: along its valley, or out along its spur", () => {
    const w = buildWater(mulberry32(3), "none", { w: 300, h: 300 });
    const extent = (b: Point[], a: number) => {
      const t = b.map((p) => (p[0] - 150) * Math.cos(a) + (p[1] - 150) * Math.sin(a));
      return Math.max(...t) - Math.min(...t);
    };
    const valley = arch({ id: "valleyPass", streetField: "linear" }), spur = arch({ id: "spur", streetField: "radial", wallShape: "hull" });
    const ratios = { valley: [] as number[], spur: [] as number[] };
    for (let seed = 1; seed <= 20; seed++) for (const along of [0.3, 1.9, -2.4]) {
      const v = makeBoundary(mulberry32(seed), valley, 4, C, w, along), s = makeBoundary(mulberry32(seed), spur, 4, C, w, along);
      ratios.valley.push(extent(v, along) / extent(v, along + Math.PI / 2));
      ratios.spur.push(extent(s, along) / extent(s, along + Math.PI / 2));
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    // (on their own axes, measured: a valley town's median 1.35 and least 1.20, a spur's 1.25 and 1.12;
    // on a drawn one, 1.02 and 1.00 at the median)
    expect(median(ratios.valley)).toBeGreaterThan(1.25);
    expect(Math.min(...ratios.valley)).toBeGreaterThan(1.1);
    expect(median(ratios.spur)).toBeGreaterThan(1.15);
    expect(Math.min(...ratios.spur)).toBeGreaterThan(1.05);
    // ...narrower across it, not bigger: a capital stretched out along its spur filled its plate
    const meanR = (b: Point[]) => b.reduce((t, p) => t + Math.hypot(p[0] - 150, p[1] - 150), 0) / b.length;
    for (let seed = 1; seed <= 20; seed++) {
      const grow = meanR(makeBoundary(mulberry32(seed), spur, 4, C, w, 0.7)) / meanR(makeBoundary(mulberry32(seed), spur, 4, C, w));
      expect(grow, `seed ${seed}`).toBeGreaterThan(0.93);
      expect(grow, `seed ${seed}`).toBeLessThan(1.07);
    }
    // ...and a spur town nobody placed on its ground keeps the round shape it always had
    const hull = arch({ id: "forestGrove", streetField: "radial", wallShape: "hull" });
    expect(makeBoundary(mulberry32(4), spur, 4, C, w)).toEqual(makeBoundary(mulberry32(4), hull, 4, C, w));
  });
  it("is deterministic", () => {
    const w = buildWater(mulberry32(5), "none", { w: 300, h: 300 });
    expect(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)))
      .toBe(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)));
  });
  it("lifts a river-crossing vertex to the BANK, not deep toward the centre (clean wall opening)", () => {
    const bt = arch({ id: "bridgeTown", streetField: "linear", wallShape: "riverbank", water: "river" });
    const base = 58 + 4 * 12;
    for (const seed of [7, 12, 21, 36]) {
      const river = buildWater(mulberry32(seed), "river", { w: 300, h: 300 });
      const b = makeBoundary(mulberry32(seed), bt, 4, C, river);
      // every vertex is OUT of the water (the old radial pull could leave a vertex stuck IN the
      // river at the min-radius floor — a spike that made the wall jut inward across the river)
      for (const p of b) for (const body of river.bodies) expect(pointInPolygon(p, body)).toBe(false);
      // and none collapses to the old base*0.3 floor
      const rs = b.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
      expect(Math.min(...rs)).toBeGreaterThan(base * 0.32);
    }
  });
  it("does not collapse a vertex toward the centre when water covers the core", () => {
    const lake: Water = { kind: "lake", bodies: [[[60, 60], [240, 60], [240, 240], [60, 240]]], bridges: [] };
    const b = makeBoundary(mulberry32(3), arch({}), 4, C, lake);
    const rs = b.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
    expect(Math.min(...rs)).toBeGreaterThan(25);
  });
});
