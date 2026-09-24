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
  // A port comes down to its water (the shore runs through the edge of the town's reach), so the
  // side that stands on the water is open and a town that stands back from it is walled all round:
  // the wall used to open across up to 36 of beach, and left a median 42 units of a port's landward
  // edge without a wall.
  const smallRing: Polygon = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; smallRing.push([150 + Math.cos(a) * 40, 150 + Math.sin(a) * 40]); }
  it("opens the side of the town that stands on the water (no walled-off harbour)", () => {
    // the ring's right edge is at x = 190, the sea begins two units beyond it
    const nearSea: Water = { kind: "sea", bodies: [[[192, 0], [300, 0], [300, 300], [192, 300]]], bridges: [] };
    const wall = wallFromDefenses(smallRing, nearSea, noMountains, noRoads);
    expect(wall.seaGates.length).toBeGreaterThan(0);                       // sea side is open
    const totalVerts = wall.segments.reduce((n, s) => n + s.length, 0);
    expect(totalVerts).toBeLessThan(smallRing.length + 1);                 // not a full closed ring
  });
  it("walls a town that stands back from the water across dry ground", () => {
    // the same ring with 20 of beach between it and the sea
    const farSea: Water = { kind: "sea", bodies: [[[210, 0], [300, 0], [300, 300], [210, 300]]], bridges: [] };
    const wall = wallFromDefenses(smallRing, farSea, noMountains, noRoads);
    expect(wall.seaGates.length).toBe(0);
    expect(wall.segments.length).toBe(1);
    expect(wall.segments[0].length).toBe(smallRing.length + 1);            // a closed ring
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
  // Every walled town has a gate, and a gate is a way out. Where no street reached a stretch of wall a
  // road could leave by, the town took the wall point nearest a street whether a road could leave by it
  // or not: a mountain town where its stream rises had its one gate facing its foothills, no road out.
  it("puts a town's one gate where a road can leave, when no street reaches such a spot", () => {
    const street: Polyline = [[150, 100], [150, 91]];   // reaches only the top of the wall
    const wall = wallFromDefenses(ring, noWater, noMountains, [street], Infinity, (g) => g[1] > 150);
    expect(wall.gates.length).toBe(1);
    expect(wall.gates[0][1], "a gate a road can leave by").toBeGreaterThan(150);
    expect(wall.gates[0][1], "...the nearest of them to the street").toBeLessThan(170);
    // ...and a town whose nearest gate a road can leave by keeps it
    const kept = wallFromDefenses(ring, noWater, noMountains, [street], Infinity, () => true);
    expect(kept.gates[0][1]).toBeLessThan(100);
  });
  it("caps the gate count to a few well-spread main gates", () => {
    const roads: Polyline[] = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; roads.push([[150, 150], [150 + Math.cos(a) * 61, 150 + Math.sin(a) * 61]]); }
    const uncapped = wallFromDefenses(ring, noWater, noMountains, roads);
    const capped = wallFromDefenses(ring, noWater, noMountains, roads, 3);
    expect(uncapped.gates.length).toBeGreaterThan(3);
    expect(capped.gates.length).toBeLessThanOrEqual(3);
  });
});
