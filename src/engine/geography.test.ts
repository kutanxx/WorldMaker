import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { detectRegions, nameGeography, worldName } from "./geography";

describe("geography", () => {
  it("detectRegions groups same-biome neighbours into one region and drops specks", () => {
    const N = 45;
    const neighbors = Array.from({ length: N }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < N));
    const points: number[] = [];
    for (let i = 0; i < N; i++) points.push(i * 5, 50);
    const biome = new Array(N).fill(3); // temperate forest chain
    biome[42] = biome[43] = biome[44] = 5; // a 3-cell desert speck
    neighbors[41] = neighbors[41].filter((j) => j !== 42); // detach the speck
    neighbors[42] = neighbors[42].filter((j) => j !== 41);
    const terrain = new Array(N).fill(1); // all land
    const regions = detectRegions({ count: N, neighbors, points }, biome, terrain);
    expect(regions.some((r) => r.kind === 3)).toBe(true);  // the 42-cell forest survives
    expect(regions.some((r) => r.kind === 5)).toBe(false); // the 3-cell speck is dropped
    for (const r of regions) { expect(r.centroid[0]).toBeGreaterThanOrEqual(0); expect(r.cells).toBeGreaterThanOrEqual(35); }
  });
  it("nameGeography gives each region a kind-appropriate noun, deterministically", () => {
    const raws = [
      { kind: 5, centroid: [10, 10] as [number, number], cells: 100 }, // desert
      { kind: 8, centroid: [20, 20] as [number, number], cells: 80 },  // alpine
    ];
    const a = nameGeography(mulberry32(1), raws);
    const b = nameGeography(mulberry32(1), raws);
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name)); // deterministic
    expect(/Wastes|Sands|Dunes|Barrens/.test(a[0].name)).toBe(true);
    expect(/Peaks|Mountains|Range|Spires|Heights/.test(a[1].name)).toBe(true);
  });
  it("worldName is a non-empty deterministic string", () => {
    expect(worldName(mulberry32(2))).toBe(worldName(mulberry32(2)));
    expect(worldName(mulberry32(2)).length).toBeGreaterThan(0);
  });
  it("a generated world has a name and named regions", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    expect(world.name.length).toBeGreaterThan(0);
    expect(world.regions.length).toBeGreaterThan(0);
    for (const r of world.regions) expect(r.name.length).toBeGreaterThan(0);
  });
});
