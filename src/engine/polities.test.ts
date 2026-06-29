import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { LAND, OCEAN } from "./terrain";
import { assignPolities } from "./polities";
import type { Grid } from "./grid";

function ringGrid(n: number): Grid {
  // n land cells in a connected chain
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ns: number[] = [];
    if (i > 0) ns.push(i - 1);
    if (i < n - 1) ns.push(i + 1);
    neighbors.push(ns);
  }
  return { count: n, neighbors } as unknown as Grid;
}

describe("polities", () => {
  it("claims every connected land cell exactly one polity", () => {
    const grid = ringGrid(20);
    const terrain = new Uint8Array(20).fill(LAND);
    const { polityOf } = assignPolities(mulberry32(1), grid, terrain, 3);
    for (let i = 0; i < 20; i++) {
      expect(polityOf[i]).toBeGreaterThanOrEqual(0);
      expect(polityOf[i]).toBeLessThan(3);
    }
  });
  it("never claims ocean cells", () => {
    const grid = ringGrid(10);
    const terrain = new Uint8Array([LAND, LAND, OCEAN, LAND, LAND, LAND, LAND, OCEAN, LAND, LAND]);
    const { polityOf } = assignPolities(mulberry32(2), grid, terrain, 2);
    expect(polityOf[2]).toBe(-1);
    expect(polityOf[7]).toBe(-1);
  });
  it("places capitals on land and is deterministic", () => {
    const grid = ringGrid(20);
    const terrain = new Uint8Array(20).fill(LAND);
    const a = assignPolities(mulberry32(3), grid, terrain, 3);
    const b = assignPolities(mulberry32(3), grid, terrain, 3);
    expect(Array.from(a.polityOf)).toEqual(Array.from(b.polityOf));
    for (const s of a.seeds) expect(terrain[s.capital]).not.toBe(OCEAN);
  });
});
