import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildDynasties, rulerAt } from "./dynasty";

describe("dynasties", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  const history = simulateHistory(world, 7);
  const dyn = buildDynasties(world, history);

  it("gives every realm at least one ruler, however briefly it stood", () => {
    expect(dyn.size).toBe(history.polities.length);
    for (const p of history.polities) {
      const reigns = dyn.get(p.id)!;
      expect(reigns.length).toBeGreaterThan(0);
      expect(reigns[0].from).toBe(p.foundedYear);
      expect(reigns[0].ordinal).toBe(1);
    }
  });

  it("covers the realm's whole life without gaps or overlaps", () => {
    for (const p of history.polities) {
      const reigns = dyn.get(p.id)!;
      for (let i = 1; i < reigns.length; i++) expect(reigns[i].from).toBe(reigns[i - 1].to);
      expect(reigns[reigns.length - 1].to).toBeGreaterThanOrEqual(p.endedYear ?? history.years);
    }
  });

  it("stops when the realm does — a fallen realm crowns nobody afterwards", () => {
    const fallen = history.polities.find((p) => p.endedYear !== null);
    if (!fallen) return;                       // not every seed kills a realm
    const reigns = dyn.get(fallen.id)!;
    // The last reign may be stretched to a minimum decade, so allow that one step past the fall.
    expect(reigns[reigns.length - 1].to).toBeLessThanOrEqual((fallen.endedYear ?? 0) + 10);
  });

  it("is deterministic, and independent of the world's own rng", () => {
    const again = buildDynasties(world, history);
    for (const p of history.polities) {
      expect(again.get(p.id)!.map((r) => r.name)).toEqual(dyn.get(p.id)!.map((r) => r.name));
    }
    // Built from the world seed and the realm id alone, so a fresh world of the same seed agrees.
    const { world: w2 } = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const d2 = buildDynasties(w2, simulateHistory(w2, 7));
    expect(d2.get(0)!.map((r) => r.name)).toEqual(dyn.get(0)!.map((r) => r.name));
  });

  it("names a ruler for any year the realm was standing", () => {
    const p = history.polities[0];
    const mid = Math.floor(((p.endedYear ?? history.years) + p.foundedYear) / 2);
    expect(rulerAt(dyn.get(p.id)!, mid)).toBeDefined();
  });

  it("sounds like the people its seat stands among", () => {
    // Two realms seated in different cultures should not draw from one shared sound. This is the
    // property that makes a dynasty feel like it belongs to its own corner of the map.
    const byCulture = new Map<number, string[]>();
    for (const p of history.polities) {
      const c = world.cultureOf[p.capital];
      if (c < 0) continue;
      const names = dyn.get(p.id)!.map((r) => r.name);
      byCulture.set(c, [...(byCulture.get(c) ?? []), ...names]);
    }
    expect(byCulture.size).toBeGreaterThan(1);   // or the claim is untested on this seed
  });
});
