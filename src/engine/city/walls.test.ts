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

// ★ The world's roads (worldRoads.ts): a gate for each, where a street runs through the wall nearest the
// way the road leaves; a road with no gate of its own forks from the nearest gate.
describe("wallFromDefenses with the world's roads", () => {
  const centre: [number, number] = [150, 150];
  // streets running straight out of the middle through the ring, every 30 degrees
  const spokes: Polyline[] = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [[150 + Math.cos(a) * 20, 150 + Math.sin(a) * 20], [150 + Math.cos(a) * 90, 150 + Math.sin(a) * 90]];
  });
  const dirOf = (g: [number, number]) => Math.atan2(g[1] - centre[1], g[0] - centre[0]);
  const across = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  it("opens a gate for each road where a street crosses the wall nearest its way", () => {
    const roads = [{ bearing: 0.1, to: [1] }, { bearing: Math.PI / 2 + 0.1, to: [2] }];
    // the street nodes just past the wall (the ring is 60 out), where the town's own gates come from
    const nodes: Polyline[] = spokes.map(([, b]) => { const p: [number, number] = [150 + (b[0] - 150) * (70 / 90), 150 + (b[1] - 150) * (70 / 90)]; return [p, p]; });
    const wall = wallFromDefenses(ring, noWater, noMountains, nodes, 3, () => true, { from: centre, roads, streets: spokes });
    expect(wall.gateRoads).toBeDefined();
    roads.forEach((r) => {
      const gi = wall.gateRoads!.findIndex((rs) => rs.includes(r));
      expect(gi, `no gate for the road at ${r.bearing}`).toBeGreaterThanOrEqual(0);
      expect(across(dirOf(wall.gates[gi] as [number, number]), r.bearing), "its gate is where the nearest street crosses").toBeLessThan(0.11);
    });
    // ...and the town fills up to its number of gates with a way out of its own
    expect(wall.gates.length).toBe(3);
    expect(wall.gateRoads!.filter((rs) => rs.length === 0).length).toBe(1);
  });

  it("forks a road from the nearest gate when it has no way out of its own", () => {
    // one street through the wall, two roads leaving on either side of it
    const one: Polyline[] = [spokes[0]];
    const roads = [{ bearing: -0.3, to: [1] }, { bearing: 0.3, to: [2] }];
    const wall = wallFromDefenses(ring, noWater, noMountains, noRoads, 2, () => true, { from: centre, roads, streets: one });
    expect(wall.gates.length).toBe(1);
    expect(wall.gateRoads![0]).toEqual(expect.arrayContaining(roads));
  });

  it("leaves a town the world gives no road exactly as it was", () => {
    const streets: Polyline[] = [[[150, 150], [150, 213]], [[150, 150], [87, 150]]];
    const plain = wallFromDefenses(ring, noWater, noMountains, streets, 3);
    expect(plain.gateRoads).toBeUndefined();
    expect(wallFromDefenses(ring, noWater, noMountains, streets, 3, () => true, undefined)).toEqual(plain);
  });
});
