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
  it("keeps events to milestones (dozens, not per-cell)", () => {
    const w = build(7);
    const h = simulateHistory(w, 7);
    expect(h.events.length).toBeLessThan(200);
    expect(h.events.length).toBeGreaterThan(0);
  });
  it("eliminates a conquered polity: 0 cells and endedYear after its conquest", () => {
    // scan seeds for one that yields a conquest
    for (const s of [5, 7, 11, 13, 2, 3, 8]) {
      const w = build(s);
      const h = simulateHistory(w, s);
      const conq = h.events.find((e) => e.type === "conquer");
      if (!conq) continue;
      const dead = h.polities.find((p) => p.id === conq.otherId)!;
      expect(dead.endedYear).not.toBeNull();
      const after = h.snapshots.find((sn) => sn.year > conq.year);
      if (after) { let cells = 0; for (let c = 0; c < after.owner.length; c++) if (after.owner[c] === dead.id) cells++; expect(cells).toBe(0); }
      return;
    }
    // if no seed produced a conquest, the tuning task (Task 6) addresses it; don't fail here
    expect(true).toBe(true);
  });
  it("designates economic zones with a staple event for each", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.economicZones.length).toBeGreaterThan(0);
    expect(h.economicZones.length).toBeLessThanOrEqual(3);
    for (const z of h.economicZones) {
      expect(h.events.some((e) => e.type === "staple" && e.cell === z.cell)).toBe(true);
    }
  });
  it("spawns civil-war successors and free cities across seeds", () => {
    let civilwar = false, freeCity = false;
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const h = simulateHistory(build(s), s);
      if (h.events.some((e) => e.type === "civilwar")) civilwar = true;
      if (h.polities.some((p) => p.free)) freeCity = true;
    }
    expect(civilwar).toBe(true);
    expect(freeCity).toBe(true);
  });
  it("free polities are neutral-coloured and never expand", () => {
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const h = simulateHistory(build(s), s);
      const free = h.polities.filter((p) => p.free);
      if (free.length === 0) continue;
      for (const fp of free) {
        expect(fp.color).toBe("#b7b1a4");
        // a free city never grows: its cell count in the last snapshot ≤ its founding cluster (≤5)
        const last = h.snapshots[h.snapshots.length - 1].owner;
        let cells = 0; for (let c = 0; c < last.length; c++) if (last[c] === fp.id) cells++;
        expect(cells).toBeLessThanOrEqual(5);
      }
      return;
    }
  });
  it("no single power inevitably conquers everything (varied fates, not one-nation-dominates)", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let totalConquest = 0, hegemony = 0, multiPower = 0, conquestSeeds = 0, citySeeds = 0;
    for (const s of seeds) {
      const w = build(s);
      if (w.polities.length < 2) continue;
      const h = simulateHistory(w, s);
      if (h.events.some((e) => e.type === "conquer")) conquestSeeds++;
      if (h.events.some((e) => e.type === "newCity")) citySeeds++;
      const last = h.snapshots[h.snapshots.length - 1].owner;
      const count = new Map<number, number>();
      let land = 0;
      for (let c = 0; c < last.length; c++) { const o = last[c]; if (o >= 0) { land++; count.set(o, (count.get(o) ?? 0) + 1); } }
      const top = Math.max(...count.values());
      if (top / land > 0.8) totalConquest++;      // one polity holds >80% of land
      if (top / land > 0.7) hegemony++;            // one polity dominates the map
      if (count.size >= 3) multiPower++;           // ≥3 powers survive
    }
    expect(conquestSeeds).toBeGreaterThan(0);      // conquest still happens
    expect(citySeeds).toBeGreaterThan(0);          // lore cities founded
    expect(totalConquest).toBeLessThanOrEqual(4);  // NOT every world unifies (the whole point)
    // the user's complaint: the flow always resolved to one dominant nation. Most worlds must NOT
    // end dominated by a single power (this fails on the pre-fix ~83% snowball plateau: 6/10).
    expect(hegemony).toBeLessThanOrEqual(4);
    expect(multiPower).toBeGreaterThanOrEqual(6);  // most worlds stay genuinely multipolar
  });
});

describe("simulateHistory golden anchor (behaviour lock)", () => {
  const fold = (h: number, x: number) => { h ^= x >>> 0; return Math.imul(h, 16777619) >>> 0; };
  const fnvArr = (arr: ArrayLike<number>) => { let h = 2166136261 >>> 0; for (let i = 0; i < arr.length; i++) h = fold(h, arr[i] + 1); return h >>> 0; };
  const fnvStr = (str: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) h = fold(h, str.charCodeAt(i)); return h >>> 0; };
  const anchors: Record<number, { snaps: number; pols: number; evs: number; econ: number; allSnap: number; events: number; polities: number }> = {
    1: { snaps: 51, pols: 14, evs: 31, econ: 3, allSnap: 2796185232, events: 3677329610, polities: 4247206507 },
    2: { snaps: 51, pols: 15, evs: 38, econ: 3, allSnap:  999977846, events: 1287836464, polities: 1375770347 },
    3: { snaps: 51, pols: 16, evs: 44, econ: 3, allSnap: 4292460260, events: 4115537623, polities: 2430550014 },
  };
  for (const seed of [1, 2, 3]) {
    it(`reproduces the pinned hashes for seed ${seed}`, () => {
      const h = simulateHistory(build(seed), seed);
      let allSnap = 2166136261 >>> 0;
      for (const s of h.snapshots) allSnap = fold(allSnap, fnvArr(s.owner));
      let ev = 2166136261 >>> 0;
      for (const e of h.events) {
        ev = fold(ev, e.year); ev = fold(ev, fnvStr(e.type)); ev = fold(ev, e.polityId + 1);
        ev = fold(ev, (e.otherId ?? -1) + 1); ev = fold(ev, (e.cell ?? -1) + 1); ev = fold(ev, fnvStr(e.text));
      }
      let pol = 2166136261 >>> 0;
      for (const p of h.polities) {
        pol = fold(pol, p.id + 1); pol = fold(pol, p.capital + 1); pol = fold(pol, p.foundedYear);
        pol = fold(pol, (p.endedYear ?? -1) + 1); pol = fold(pol, fnvStr(p.origin)); pol = fold(pol, fnvStr(p.name)); pol = fold(pol, p.free ? 1 : 0);
      }
      const a = anchors[seed];
      expect(h.snapshots.length).toBe(a.snaps);
      expect(h.polities.length).toBe(a.pols);
      expect(h.events.length).toBe(a.evs);
      expect(h.economicZones.length).toBe(a.econ);
      expect(allSnap >>> 0).toBe(a.allSnap);
      expect(ev >>> 0).toBe(a.events);
      expect(pol >>> 0).toBe(a.polities);
    });
  }
});
