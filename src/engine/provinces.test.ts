import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { mulberry32, deriveSeed } from "./rng";
import { pickProvinceSeeds } from "./provinces";

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
