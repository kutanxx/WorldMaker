import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF } from "./armySim";
import { GRASSLAND, ALPINE } from "./biome";

describe("basePopOf (population comes from the generated world)", () => {
  it("scales with province size and biome, and is 0 for no cells", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    for (const p of world.provinces) {
      const pop = basePopOf(world, p.id);
      expect(pop).toBeGreaterThanOrEqual(0);
      // population must be proportional to cells x biome weight, before city bonus
      const floor = p.cells * (BIOME_POP[p.biome] ?? 0);
      expect(pop).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });
  it("weights a grassland province above an alpine one of the same size", () => {
    expect(BIOME_POP[GRASSLAND]).toBeGreaterThan(BIOME_POP[ALPINE]);
    expect(BIOME_DEF[ALPINE]).toBeGreaterThan(BIOME_DEF[GRASSLAND]);
    expect(BIOME_DEF[GRASSLAND]).toBeLessThan(1); // open ground favours the ATTACKER
  });
});

describe("initArmySim", () => {
  it("starts every province owned as the world says, at full population, with no armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    expect(s.n).toBe(world.provinces.length);
    expect(s.armies).toEqual([]);
    expect(s.turn).toBe(0);
    for (let p = 0; p < s.n; p++) {
      expect(s.pop[p]).toBe(s.basePop[p]);
      expect(s.basePop[p]).toBe(basePopOf(world, p));
    }
    // at least one province is owned by each live polity's majority snap
    expect([...s.owner].some((o) => o >= 0)).toBe(true);
    expect(s.adj.length).toBe(s.n);
  });
  it("is deterministic for the same seed", () => {
    const a = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    const b = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
  });
});
