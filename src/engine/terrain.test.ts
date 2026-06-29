import { describe, it, expect } from "vitest";
import { OCEAN, LAND, MOUNTAIN, classifyTerrain, landmasses } from "./terrain";
import type { Grid } from "./grid";

describe("terrain", () => {
  it("classifies by thresholds", () => {
    const h = new Float32Array([0.1, 0.5, 0.9]);
    const t = classifyTerrain(h, 0.4, 0.8);
    expect(Array.from(t)).toEqual([OCEAN, LAND, MOUNTAIN]);
  });
  it("groups contiguous land into one landmass", () => {
    // 4 cells in a line: land land ocean land
    const grid = {
      count: 4,
      neighbors: [[1], [0, 2], [1, 3], [2]],
    } as unknown as Grid;
    const t = new Uint8Array([LAND, LAND, OCEAN, LAND]);
    const comp = landmasses(grid, t);
    expect(comp[0]).toBe(comp[1]);
    expect(comp[2]).toBe(-1);
    expect(comp[3]).not.toBe(comp[0]);
  });
});
