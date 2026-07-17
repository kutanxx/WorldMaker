import { describe, it, expect } from "vitest";
import type { Province } from "./provinces";
import { buildProvinceAdj, initProvinceSim, pAggregate, type ProvinceSimState } from "./provinceSim";
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

function fakeState(over: Record<string, unknown> = {}): ProvinceSimState {
  const provinces: Province[] = [
    { id: 0, name: "A", cells: 10, centroid: [0, 0], seedCell: 0, biome: 4 },
    { id: 1, name: "B", cells: 30, centroid: [10, 0], seedCell: 1, biome: 4 },
  ];
  return {
    provinces, n: 2, provOwner: Int32Array.from([0, 0]), provSol: Float32Array.from([0.2, 0.6]),
    adj: [[1], [0]], capitalProv: Int32Array.from([0]), alive: [true], tick: 0, ...over,
  } as ProvinceSimState;
}

describe("pAggregate", () => {
  it("sums cells and averages solidarity weighted by province size", () => {
    const agg = pAggregate(fakeState());
    expect(agg[0].cells).toBe(40);
    // (0.2*10 + 0.6*30) / 40 = 0.5
    expect(agg[0].avg).toBeCloseTo(0.5, 6);
  });
  it("reports 0/0 for a polity that owns nothing", () => {
    const agg = pAggregate(fakeState({ provOwner: Int32Array.from([-1, -1]) }));
    expect(agg[0]).toEqual({ cells: 0, avg: 0 });
  });
});
