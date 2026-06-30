import { describe, it, expect } from "vitest";
import { area, pointInPolygon } from "../geometry";
import type { ZonedWard } from "./zoning";
import { buildWall, buildMoat } from "./walls";

function innerWards(): ZonedWard[] {
  const pts: [number, number][] = [[120, 120], [180, 120], [180, 180], [120, 180], [150, 150]];
  return pts.map((site) => ({
    site, dist: 0, inner: true, type: "craftsmen" as const,
    polygon: [[site[0] - 8, site[1] - 8], [site[0] + 8, site[1] - 8], [site[0] + 8, site[1] + 8], [site[0] - 8, site[1] + 8]],
  }));
}

describe("walls", () => {
  it("wall ring encloses the inner wards and has towers at each vertex", () => {
    const wall = buildWall(innerWards(), 3);
    expect(wall.ring.length).toBeGreaterThanOrEqual(3);
    expect(wall.towers.length).toBe(wall.ring.length);
    expect(pointInPolygon([150, 150], wall.ring)).toBe(true);
  });
  it("produces the requested number of gates", () => {
    const wall = buildWall(innerWards(), 3);
    expect(wall.gates.length).toBe(3);
  });
  it("moat is larger than the wall ring", () => {
    const wall = buildWall(innerWards(), 3);
    const moat = buildMoat(wall.ring, 6);
    expect(area(moat)).toBeGreaterThan(area(wall.ring));
  });
  it("never places more gates than ring edges and never duplicates them", () => {
    const wall = buildWall(innerWards(), 99);
    expect(wall.gates.length).toBeLessThanOrEqual(wall.ring.length);
    const uniq = new Set(wall.gates.map((g) => g.join(",")));
    expect(uniq.size).toBe(wall.gates.length);
  });
  it("defaults to at least one gate when asked for zero", () => {
    expect(buildWall(innerWards(), 0).gates.length).toBeGreaterThanOrEqual(1);
  });
});

import { wallFromDefenses } from "./walls";
import type { Polygon } from "../geometry";
import type { Water } from "./water";

const ring: Polygon = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const noWater: Water = { kind: "none", bodies: [], bridges: [] };
const rightSea: Water = { kind: "sea", bodies: [[[185, 0], [300, 0], [300, 300], [185, 300]]], bridges: [] };

describe("wallFromDefenses", () => {
  it("a landlocked city walls the whole boundary (one closed ring, no sea gates)", () => {
    const wall = wallFromDefenses(ring, noWater, 3);
    expect(wall.segments.length).toBe(1);
    expect(wall.seaGates.length).toBe(0);
    expect(wall.gates.length).toBe(3);
    expect(wall.towers.length).toBeGreaterThanOrEqual(ring.length);
  });
  it("leaves the water-facing side open with sea gates", () => {
    const wall = wallFromDefenses(ring, rightSea, 3);
    expect(wall.seaGates.length).toBeGreaterThan(0);
    const totalVerts = wall.segments.reduce((n, s) => n + s.length, 0);
    expect(totalVerts).toBeLessThan(ring.length + 1); // less than the full closed ring
  });
});
