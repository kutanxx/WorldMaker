import { describe, it, expect } from "vitest";
import type { Polygon } from "../geometry";
import { wallFromDefenses } from "./walls";
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
