// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { worldToJSON } from "./export";
import { simulateHistory } from "../engine/history";

describe("export", () => {
  it("serializes a world to parseable JSON", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, cellCount: 200, width: 200, height: 200 });
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(parsed.cities.length).toBe(world.cities.length);
  });
});

// The JSON was the world and nothing else: 1.45 MB of geography, cultures, provinces, rivers and
// the EIGHT realms of year zero, with no snapshots, no events, no rulers. Someone taking their
// world into their own tool lost five centuries without being told. The map export carries the
// scrubbed year and the gazetteer carries the whole chronicle; this is the machine-readable one and
// it has to carry the same history, or the three exports tell three different stories.
describe("the JSON carries the history, not just the world", () => {
  const build = (seed = 2) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };

  it("still serializes a bare world when no history is handed to it", () => {
    const { world } = build();
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.cities.length).toBe(world.cities.length);
    expect(parsed.history).toBeUndefined();
  });

  it("carries every realm that ever stood, not the eight it began with", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.polities.length).toBe(8);                       // year zero, as the world knows it
    expect(parsed.history.polities.length).toBe(history.polities.length);
    expect(parsed.history.polities.length).toBeGreaterThan(8);
  });

  it("carries the territory of every recorded year, in full", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.snapshots.length).toBe(history.snapshots.length);
    const last = parsed.history.snapshots[parsed.history.snapshots.length - 1];
    expect(last.year).toBe(history.years);
    expect(last.owner.length).toBe(world.grid.count);
    // a consumer can rebuild the political map of any year from this alone
    expect(last.owner).toEqual([...history.snapshots[history.snapshots.length - 1].owner]);
  });

  it("carries the events, the free ports, the town foundings and the rulers", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.events.length).toBe(history.events.length);
    expect(parsed.history.economicZones.length).toBe(history.economicZones.length);
    expect(parsed.history.cityFoundings.length).toBe(history.cityFoundings.length);
    const reigns = parsed.history.dynasties;
    expect(Object.keys(reigns).length).toBe(history.polities.length);
    expect(reigns["0"][0]).toMatchObject({ name: expect.any(String), from: expect.any(Number), to: expect.any(Number) });
  });

  // The chronicle panel and the gazetteer both tell the world's natural history; a JSON that left it
  // out would be the third export telling a different story from the other two.
  it("carries the natural history, as data rather than as a sentence", () => {
    const { world, history } = build();
    const parsed = JSON.parse(worldToJSON(world, history));
    expect(parsed.history.naturalHistory.length).toBeGreaterThan(2);
    for (const e of parsed.history.naturalHistory) {
      expect(typeof e.year).toBe("number");
      expect(["plague", "fire", "flood", "winter", "famine"]).toContain(e.kind);
      expect(e.text, "a language-free export carries no rendered sentence").toBeUndefined();
    }
  });
});
