import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "./world";
import { OCEAN } from "./terrain";

describe("biome integration", () => {
  it("does not shift existing seeds (biome uses a separate rng stream)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    let ch = 2166136261 >>> 0;
    for (const c of world.cities) { ch ^= c.cell; ch = Math.imul(ch, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
    expect(ch >>> 0).toBe(4294534188);
    expect(world.cities.length).toBe(28);
  });
  it("exposes a biome per cell and per city", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    expect(world.biome.length).toBe(world.grid.count);
    for (const c of world.cities) expect(world.biome[c.cell]).toBe(c.biome);
  });
  it("assigns cultures to the land (separate stream — geometry above is unchanged)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    expect(world.cultures.length).toBeGreaterThan(0);
    let landWithCulture = 0;
    for (let i = 0; i < world.grid.count; i++) {
      if (world.terrain[i] !== OCEAN) {
        expect(world.cultureOf[i]).toBeGreaterThanOrEqual(0);
        expect(world.cultureOf[i]).toBeLessThan(world.cultures.length);
        landWithCulture++;
      } else {
        expect(world.cultureOf[i]).toBe(-1);
      }
    }
    expect(landWithCulture).toBeGreaterThan(0);
  });
});

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
  it("never places two cities on the same cell", () => {
    const { world } = generateWorld(small);
    const cells = world.cities.map((c) => c.cell);
    expect(new Set(cells).size).toBe(cells.length);
  });
  it("gives each city the elevation of its cell", () => {
    const { world } = generateWorld(small);
    for (const c of world.cities) {
      expect(c.elevation).toBeCloseTo(world.heights[c.cell], 5);
      expect(c.elevation).toBeGreaterThanOrEqual(0);
      expect(c.elevation).toBeLessThanOrEqual(1);
    }
  });
});

describe("world rivers", () => {
  it("keeps the golden regression byte-identical (rivers add no main-stream draws)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
    expect(world.cities.length).toBe(28);
  });
  it("exposes a named river network for a normal seed", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    expect(world.riverNet.length).toBeGreaterThan(0);
    expect(world.rivers.length).toBeGreaterThan(0);
    for (const r of world.rivers) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.path.length).toBeGreaterThan(0);
      expect(r.mouth).toEqual(r.path[0]);
    }
  });
  it("is deterministic (two builds → identical rivers)", () => {
    const a = generateWorld({ ...DEFAULT_PARAMS, seed: 7 }).world;
    const b = generateWorld({ ...DEFAULT_PARAMS, seed: 7 }).world;
    expect(JSON.stringify(a.rivers)).toBe(JSON.stringify(b.rivers));
    expect(JSON.stringify(a.riverNet)).toBe(JSON.stringify(b.riverNet));
  });
});
