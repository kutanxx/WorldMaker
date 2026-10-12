import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { generateCityLayout, cityContext } from "./city";
import { worldFingerprint, plateFingerprint } from "./fingerprint";

// A world is not stored anywhere: every browser computes it from its number. The fingerprint is how a
// reader checks that two browsers computed the same one — a short code over everything the world is
// (its ground, waters, realms, peoples, provinces, towns and roads) and its five centuries; and a town's
// plate has its own. Same number and settings, same code: same fingerprint.
const made = (seed: number, over = {}) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed, ...over });
  return { world, history: simulateHistory(world, seed) };
};

describe("a world's fingerprint", () => {
  const one = made(1);
  it("is a short code a reader can read out: two groups of four", () => {
    expect(worldFingerprint(one.world, one.history)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
  it("is the same every time the same world is made", () => {
    const again = made(1);
    expect(worldFingerprint(again.world, again.history)).toBe(worldFingerprint(one.world, one.history));
  });
  it("tells worlds apart, and settings apart", () => {
    const prints = new Set([1, 2, 3, 4, 5].map((s) => { const m = made(s); return worldFingerprint(m.world, m.history); }));
    expect(prints.size).toBe(5);
    const fewer = made(1, { polityCount: 6 });
    expect(worldFingerprint(fewer.world, fewer.history)).not.toBe(worldFingerprint(one.world, one.history));
  });
  it("changes when only the history does", () => {
    const other = simulateHistory(one.world, 2);
    expect(worldFingerprint(one.world, other)).not.toBe(worldFingerprint(one.world, one.history));
  });
  it("changes when only a town's name does", () => {
    const renamed = { ...one.world, cities: one.world.cities.map((c, i) => (i === 3 ? { ...c, name: c.name + "x" } : c)) };
    expect(worldFingerprint(renamed, one.history)).not.toBe(worldFingerprint(one.world, one.history));
  });
  // Pinned: world 1 as this code makes it. If a change to the generator moves it, every shared link of
  // world 1 opens another world — the change must say so (see the world goldens in world.test.ts).
  it("pins world 1", () => {
    expect(worldFingerprint(one.world, one.history)).toBe(PIN_WORLD_1);
  });
});

describe("a plate's fingerprint", () => {
  const { world } = made(1);
  const layout = (id: number) => generateCityLayout(cityContext(world.cities[id]), 1);
  it("is a short code, the same for the same plate, different for another", () => {
    const a = plateFingerprint(layout(0));
    expect(a).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(plateFingerprint(layout(0))).toBe(a);
    expect(plateFingerprint(layout(1))).not.toBe(a);
  });
  it("pins world 1's first town", () => {
    expect(plateFingerprint(layout(0))).toBe(PIN_PLATE_1_0);
  });
});

const PIN_WORLD_1 = "1C6B-DC73";
const PIN_PLATE_1_0 = "5B32-7862";
