import { describe, it, expect } from "vitest";
import type { Polygon, Polyline } from "../geometry";
import { wallFromDefenses } from "./walls";
import type { Water } from "./water";
import type { MountainMass } from "./mountain";

const ring: Polygon = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const noWater: Water = { kind: "none", bodies: [], bridges: [] };
const rightSea: Water = { kind: "sea", bodies: [[[185, 0], [300, 0], [300, 300], [185, 300]]], bridges: [] };
const noMountains: MountainMass[] = [];
const leftMountain: MountainMass[] = [{ polygon: [[0, 0], [115, 0], [115, 300], [0, 300]], innerEdge: [[115, 0], [115, 300]], steep: true }];
const noRoads: Polyline[] = [];

describe("wallFromDefenses", () => {
  it("a landlocked city walls the whole boundary (one closed ring, no sea gates)", () => {
    const wall = wallFromDefenses(ring, noWater, noMountains, noRoads);
    expect(wall.segments.length).toBe(1);
    expect(wall.seaGates.length).toBe(0);
    expect(wall.gates.length).toBe(0); // no roads reach the wall -> no gates
    expect(wall.towers.length).toBeGreaterThanOrEqual(ring.length);
  });
  it("leaves the water-facing side open with sea gates", () => {
    const wall = wallFromDefenses(ring, rightSea, noMountains, noRoads);
    expect(wall.seaGates.length).toBeGreaterThan(0);
    const totalVerts = wall.segments.reduce((n, s) => n + s.length, 0);
    expect(totalVerts).toBeLessThan(ring.length + 1); // less than the full closed ring
  });
  it("leaves the mountain-facing side open but with NO gates (cliff is closed)", () => {
    const wall = wallFromDefenses(ring, noWater, leftMountain, noRoads);
    const totalVerts = wall.segments.reduce((n, s) => n + s.length, 0);
    expect(totalVerts).toBeLessThan(ring.length + 1); // cliff side is open
    expect(wall.seaGates.length).toBe(0);              // no sea gates at a cliff
  });
  it("places a gate where a main road reaches the wall (not at the city centre)", () => {
    const road: Polyline = [[150, 150], [150, 91]]; // runs from centre up to the top wall (~[150,90])
    const wall = wallFromDefenses(ring, noWater, noMountains, [road]);
    expect(wall.gates.length).toBe(1);
    expect(wall.gates[0][1]).toBeLessThan(100); // gate sits on the top of the wall, not at centre (y=150)
  });
});
