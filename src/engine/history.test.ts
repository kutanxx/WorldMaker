import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";

function build(seed: number) {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return world;
}

describe("simulateHistory skeleton", () => {
  it("is deterministic", () => {
    const w = build(1);
    const a = simulateHistory(w, 1), b = simulateHistory(w, 1);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.snapshots.length).toBe(b.snapshots.length);
  });
  it("does not mutate world.polityOf (simulates on a copy)", () => {
    const w = build(2);
    const before = w.polityOf.slice();
    simulateHistory(w, 2);
    expect(w.polityOf).toEqual(before);
  });
  it("every land cell has exactly one owner or -1 in each snapshot (ownership conserved)", () => {
    const w = build(3);
    const h = simulateHistory(w, 3);
    const landCount = w.terrain.filter((t) => t !== 0).length;
    for (const snap of h.snapshots) {
      let owned = 0;
      for (let c = 0; c < snap.owner.length; c++) if (snap.owner[c] >= 0) owned++;
      expect(owned).toBeLessThanOrEqual(landCount);
    }
  });
  it("opens the chronicle with a founding event per initial polity", () => {
    const w = build(4);
    const h = simulateHistory(w, 4);
    const founds = h.events.filter((e) => e.type === "found" && e.year === 0);
    expect(founds.length).toBe(w.polities.length);
    expect(h.polities.length).toBeGreaterThanOrEqual(w.polities.length);
  });
  it("evolves ownership over time (some cells change owner)", () => {
    const w = build(5);
    const h = simulateHistory(w, 5);
    const first = h.snapshots[0].owner, last = h.snapshots[h.snapshots.length - 1].owner;
    let changed = 0;
    for (let c = 0; c < first.length; c++) if (first[c] !== last[c]) changed++;
    expect(changed).toBeGreaterThan(0);
  });
  it("never assigns a land cell to a nonexistent polity", () => {
    const w = build(6);
    const h = simulateHistory(w, 6);
    for (const snap of h.snapshots) for (let c = 0; c < snap.owner.length; c++) {
      const o = snap.owner[c];
      expect(o).toBeGreaterThanOrEqual(-1);
      expect(o).toBeLessThan(h.polities.length);
    }
  });
});
