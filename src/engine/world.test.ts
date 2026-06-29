import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "./world";
import { OCEAN } from "./terrain";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 600, townCount: 8 };

describe("world", () => {
  it("is deterministic for the same params", () => {
    const a = generateWorld(small).world;
    const b = generateWorld(small).world;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("places capitals plus towns and never on ocean", () => {
    const { world } = generateWorld(small);
    const capitals = world.cities.filter((c) => c.isCapital).length;
    expect(capitals).toBe(world.polities.length);
    expect(world.cities.length).toBeGreaterThan(capitals);
    for (const c of world.cities) expect(world.terrain[c.cell]).not.toBe(OCEAN);
  });
  it("assigns every city x/y from its cell point", () => {
    const { world } = generateWorld(small);
    for (const c of world.cities) {
      expect(c.x).toBeCloseTo(world.grid.points[c.cell * 2], 5);
      expect(c.y).toBeCloseTo(world.grid.points[c.cell * 2 + 1], 5);
    }
  });
  it("find locates a city's own cell", () => {
    const { world, find } = generateWorld(small);
    const c = world.cities[0];
    expect(find(c.x, c.y)).toBe(c.cell);
  });
});
