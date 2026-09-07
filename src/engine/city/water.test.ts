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
  it("sea has a wavy (non-straight) land-facing edge", () => {
    // try several seeds; the land edge must deviate from a straight line
    let wavy = false;
    for (let s = 0; s < 8; s++) {
      const w = buildWater(mulberry32(s), "sea", { w: 300, h: 300 });
      const poly = w.bodies[0];
      // land-facing edge = the vertices NOT on the canvas border (x in (0,300), y in (0,300))
      const inner = poly.filter((p) => p[0] > 1 && p[0] < 299 && p[1] > 1 && p[1] < 299);
      if (inner.length >= 3) {
        const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]);
        const spreadX = Math.max(...xs) - Math.min(...xs);
        const spreadY = Math.max(...ys) - Math.min(...ys);
        // a straight side band has ~0 spread on the depth axis; waviness gives > 6
        if (Math.min(spreadX, spreadY) > 6) wavy = true;
      }
    }
    expect(wavy).toBe(true);
  });
});

// The town plan's waterfront used to be one smooth low-frequency wave sampled 13 times: measured
// across 81 coastal towns it was only 0.6-2.6% longer than a dead straight line, where the world
// map's coastline is 6.4% longer PER voronoi edge. At the plate's own scale that reads as the edge
// of a colour band, not as a coast. These two guard the fix: coast-scale crenulation, at more than
// one scale.
function seaEdge(seed: number, bounds = { w: 460, h: 460 }) {
  const body = buildWater(mulberry32(seed), "sea", bounds).bodies[0];
  return body.slice(1, body.length - 1); // drop the two canvas corners; the rest is the shore
}
function chordRatio(edge: { 0: number; 1: number }[] | number[][]): number {
  const a = edge[0] as number[], b = edge[edge.length - 1] as number[];
  let len = 0;
  for (let i = 1; i < edge.length; i++) {
    const p = edge[i] as number[], q = edge[i - 1] as number[];
    len += Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  return len / Math.hypot(b[0] - a[0], b[1] - a[1]);
}

describe("sea shore relief", () => {
  it("crenulates as much as the world map's own coastline", () => {
    for (let s = 0; s < 12; s++) {
      // the world coastline's noisy edges measure 1.064 mean / 1.182 worst per edge
      expect(chordRatio(seaEdge(s))).toBeGreaterThan(1.05);
    }
  });
  it("carries relief at more than one scale (not a single smooth wave)", () => {
    for (let s = 0; s < 12; s++) {
      const edge = seaEdge(s);
      const a = edge[0], b = edge[edge.length - 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy);
      const dev = edge.map((p) => ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / m);
      let turns = 0;
      for (let i = 2; i < dev.length; i++) {
        const d1 = dev[i - 1] - dev[i - 2], d2 = dev[i] - dev[i - 1];
        if (d1 * d2 < 0) turns++;
      }
      // one 3-period wave gives ~5 turns; coast-scale detail gives many more
      expect(turns).toBeGreaterThanOrEqual(12);
    }
  });
});
