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
});
