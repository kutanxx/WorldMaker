import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { mulberry32, deriveSeed } from "./rng";
import { pickProvinceSeeds, assignProvinces } from "./provinces";

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
