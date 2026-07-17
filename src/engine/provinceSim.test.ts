import { describe, it, expect } from "vitest";
import type { Province } from "./provinces";
import { buildProvinceAdj, initProvinceSim } from "./provinceSim";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";

// cells 0,1 → province 0; cell 2 → province 1; cell 3 = ocean (province -1). neighbours 1↔2 make 0,1 adjacent.
const grid = { count: 4, neighbors: [[1], [0, 2], [1, 3], [2]] };
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  { id: 0, name: "A", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4 },
  { id: 1, name: "B", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5 },
];

describe("buildProvinceAdj", () => {
  it("links provinces that share a land border, symmetric, ocean ignored", () => {
    expect(buildProvinceAdj(provinceOf, provinces, grid)).toEqual([[1], [0]]);
  });
  it("gives an isolated province no neighbours", () => {
    const g2 = { count: 3, neighbors: [[1], [0], []] };
    expect(buildProvinceAdj([0, 0, 1], [provinces[0], provinces[1]], g2)).toEqual([[], []]);
  });
});

describe("initProvinceSim (seed 1)", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const s = initProvinceSim(world);
  it("owns one entry per province and starts every nation alive on its own capital province", () => {
    expect(s.n).toBe(world.provinces.length);
    expect(s.provOwner.length).toBe(s.n);
    for (const pol of world.polities) {
      const cap = s.capitalProv[pol.id];
      expect(cap).toBeGreaterThanOrEqual(0);
      expect(s.provOwner[cap]).toBe(pol.id);   // capital province forced to its nation
    }
    expect(s.alive.every(Boolean)).toBe(true);
    expect(s.tick).toBe(0);
  });
  it("seeds owned provinces at SOL_INIT (0.5) and unowned at 0", () => {
    for (let p = 0; p < s.n; p++) {
      expect(s.provSol[p]).toBe(s.provOwner[p] >= 0 ? 0.5 : 0);
    }
  });
});
