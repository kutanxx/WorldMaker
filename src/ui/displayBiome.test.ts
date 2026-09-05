import { describe, it, expect } from "vitest";
import { displayBiomes } from "./displayBiome";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "../engine/terrain";
import { GRASSLAND, TEMPERATE_FOREST, DESERT } from "../engine/biome";

// A row of cells, each neighbouring the one before and after it. Backgrounds are kept well over
// minPatch: in a short row every patch is a speck, and a fixture where everything is noise measures
// nothing.
const row = (n: number) => ({
  count: n,
  neighbors: Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n)),
});
const G = GRASSLAND, F = TEMPERATE_FOREST, D = DESERT, O = OCEAN;

describe("displayBiomes", () => {
  it("absorbs a one-cell speck into the biome around it", () => {
    expect([...displayBiomes(row(9), [G, G, G, G, F, G, G, G, G])])
      .toEqual([G, G, G, G, G, G, G, G, G]);
  });

  it("absorbs a two-cell speck as one piece", () => {
    expect([...displayBiomes(row(10), [G, G, G, G, F, F, G, G, G, G])])
      .toEqual([G, G, G, G, G, G, G, G, G, G]);
  });

  it("leaves a patch that is big enough alone", () => {
    const b = [G, G, G, F, F, F, G, G, G];
    expect([...displayBiomes(row(9), b)]).toEqual(b);   // three cells clears minPatch = 2
  });

  it("gives a speck to whichever side has more of it", () => {
    //          desert × 3      speck   grass × 4      → grass wins on count once the pair is scored
    const b = [D, D, D, F, F, G, G, G, G];
    const out = [...displayBiomes(row(9), b)];
    expect(out.slice(0, 3)).toEqual([D, D, D]);
    expect(out.slice(5)).toEqual([G, G, G, G]);
    expect(new Set(out.slice(3, 5)).size).toBe(1);      // the pair moved together, not split
    expect([D, G]).toContain(out[3]);
  });

  it("never touches the sea, and leaves a lone island alone", () => {
    const b = [O, O, O, F, O, O, O];
    expect([...displayBiomes(row(7), b)]).toEqual(b);   // an island is land, not noise
  });

  it("settles: smoothing a smoothed world changes nothing", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const once = displayBiomes(world.grid, world.biome);
    expect([...displayBiomes(world.grid, once)]).toEqual([...once]);
  });

  it("cuts the patch count on a real world while moving very little land", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const smoothed = displayBiomes(world.grid, world.biome);
    const patches = (b: ArrayLike<number>) => {
      const seen = new Uint8Array(world.grid.count);
      let n = 0;
      for (let c = 0; c < world.grid.count; c++) {
        if (seen[c] || b[c] === OCEAN) continue;
        n++;
        const stack = [c]; seen[c] = 1;
        while (stack.length) {
          const x = stack.pop()!;
          for (const nb of world.grid.neighbors[x]) if (!seen[nb] && b[nb] === b[x]) { seen[nb] = 1; stack.push(nb); }
        }
      }
      return n;
    };
    expect(patches(smoothed)).toBeLessThan(patches(world.biome) * 0.7);

    let moved = 0, land = 0;
    for (let c = 0; c < world.grid.count; c++) {
      if (world.biome[c] === OCEAN) continue;
      land++;
      if (smoothed[c] !== world.biome[c]) moved++;
    }
    expect(moved / land).toBeLessThan(0.08);   // measured ~5% of land across four seeds
  });

  it("returns a new array — the world's own biomes are never rewritten", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const before = [...world.biome];
    const smoothed = displayBiomes(world.grid, world.biome);
    expect(smoothed).not.toBe(world.biome);
    expect([...world.biome]).toEqual(before);
  });
});
