import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { mulberry32, deriveSeed } from "./rng";
import { pickProvinceSeeds, assignProvinces, buildProvinces } from "./provinces";

const grid1 = () => generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;

describe("pickProvinceSeeds", () => {
  it("picks `target` distinct land seeds, deterministically", () => {
    const w = grid1();
    const rngA = mulberry32(deriveSeed(1, 8100));
    const rngB = mulberry32(deriveSeed(1, 8100));
    const a = pickProvinceSeeds(w.grid, w.terrain, 100, rngA);
    const b = pickProvinceSeeds(w.grid, w.terrain, 100, rngB);
    expect(a.length).toBe(100);
    expect(new Set(a).size).toBe(100);             // distinct
    for (const c of a) expect(w.terrain[c]).not.toBe(OCEAN); // land only
    expect(a).toEqual(b);                          // deterministic
  });
});

describe("assignProvinces", () => {
  it("assigns land by BFS: seeds own themselves, ocean stays -1, provinces are connected", () => {
    const w = grid1();
    const rng = mulberry32(deriveSeed(1, 8100));
    const seeds = pickProvinceSeeds(w.grid, w.terrain, 100, rng);
    const pof = assignProvinces(w.grid, w.terrain, seeds);
    expect(pof.length).toBe(w.grid.count);
    seeds.forEach((s, i) => expect(pof[s]).toBe(i)); // each seed owns its own province
    for (let c = 0; c < w.grid.count; c++) if (w.terrain[c] === OCEAN) expect(pof[c]).toBe(-1);
    // connectivity: BFS within a province id reaches every cell holding that id
    const target = pof[seeds[7]];
    const members = new Set<number>();
    for (let c = 0; c < w.grid.count; c++) if (pof[c] === target) members.add(c);
    const seen = new Set<number>([seeds[7]]); const q = [seeds[7]];
    for (let h = 0; h < q.length; h++) for (const nb of w.grid.neighbors[q[h]]) {
      if (pof[nb] === target && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    expect(seen.size).toBe(members.size); // one connected component
  });
});

describe("buildProvinces", () => {
  it("partitions ALL land with named, connected provinces; ocean is -1; deterministic", () => {
    const w = grid1();
    const run = () => buildProvinces(w.grid, w.terrain, w.biome, mulberry32(deriveSeed(1, 8100)), 100);
    const { provinceOf, provinces } = run();
    // full land coverage, ocean excluded
    let land = 0, covered = 0;
    for (let c = 0; c < w.grid.count; c++) {
      if (w.terrain[c] === OCEAN) { expect(provinceOf[c]).toBe(-1); continue; }
      land++;
      if (provinceOf[c] >= 0 && provinceOf[c] < provinces.length) covered++;
    }
    expect(covered).toBe(land);
    // partition: sum of province cell counts equals land count
    expect(provinces.reduce((s, p) => s + p.cells, 0)).toBe(land);
    // every province is named and non-empty
    for (const p of provinces) { expect(p.name.length).toBeGreaterThan(0); expect(p.cells).toBeGreaterThan(0); }
    // count is at least the seed target (may exceed by seedless-island cleanup)
    expect(provinces.length).toBeGreaterThanOrEqual(100);
    // deterministic: a second run is identical
    const again = run();
    expect(Array.from(again.provinceOf)).toEqual(Array.from(provinceOf));
    expect(again.provinces.map((p) => p.name)).toEqual(provinces.map((p) => p.name));
  });
});
