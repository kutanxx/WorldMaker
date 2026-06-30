import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";
import { classifyTerrain, OCEAN as T_OCEAN, MOUNTAIN as T_MOUNTAIN } from "./terrain";
import { classifyBiomes, OCEAN, ALPINE, TUNDRA, TAIGA, DESERT, TROPICAL, WETLAND } from "./biome";
import { DEFAULT_PARAMS } from "../types/world";

function build(seed: number) {
  const rng = mulberry32(seed);
  const grid = generateGrid(rng, 1000, 700, 1500);
  const heights = assignHeights(rng, grid);
  const terrain = classifyTerrain(heights, 0.3, 0.55);
  return { grid, heights, terrain };
}

describe("classifyBiomes", () => {
  it("keeps ocean as OCEAN and makes mountains ALPINE", () => {
    const { grid, heights, terrain } = build(1);
    const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: 1 });
    for (let i = 0; i < grid.count; i++) {
      if (terrain[i] === T_OCEAN) expect(b[i]).toBe(OCEAN);
      if (terrain[i] === T_MOUNTAIN) expect(b[i]).toBe(ALPINE);
    }
  });
  it("places cold biomes north (smaller y) of hot biomes on average", () => {
    let coldY = 0, coldN = 0, hotY = 0, hotN = 0;
    for (const s of [1, 2, 3]) {
      const { grid, heights, terrain } = build(s);
      const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: s });
      for (let i = 0; i < grid.count; i++) {
        const y = grid.points[i * 2 + 1];
        if (b[i] === TUNDRA || b[i] === TAIGA) { coldY += y; coldN++; }
        if (b[i] === DESERT || b[i] === TROPICAL) { hotY += y; hotN++; }
      }
    }
    expect(coldN).toBeGreaterThan(0);
    expect(hotN).toBeGreaterThan(0);
    expect(coldY / coldN).toBeLessThan(hotY / hotN);
  });
  it("only assigns WETLAND on low-lying land", () => {
    const { grid, heights, terrain } = build(2);
    const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: 2 });
    for (let i = 0; i < grid.count; i++) {
      if (b[i] === WETLAND) expect(heights[i]).toBeLessThan(0.3 + 0.05);
    }
  });
  it("is deterministic", () => {
    const { grid, heights, terrain } = build(7);
    const p = { ...DEFAULT_PARAMS, seed: 7 };
    expect(Array.from(classifyBiomes(grid, heights, terrain, p)))
      .toEqual(Array.from(classifyBiomes(grid, heights, terrain, p)));
  });
});
