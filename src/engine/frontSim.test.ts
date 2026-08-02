import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import {
  initFrontSim, setOwner, maxTroops, regenPerTick, tick,
  TROOP_BASE, TROOP_EXP, UNOWNED, SEA,
} from "./frontSim";

const INITIAL_TROOPS = TROOP_BASE / 2; // not "the floor" — a nation starts with half the base, not TROOP_BASE itself

const fresh = (seed: number) => initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

describe("frontSim state", () => {
  it("owns land cell by cell, marks the sea, and starts every nation at half the troop base", () => {
    const s = fresh(11);
    expect(s.n).toBe(s.world.grid.count);
    for (let c = 0; c < s.n; c++) {
      if (s.world.terrain[c] === OCEAN) expect(s.owner[c]).toBe(SEA);
      else expect(s.owner[c]).toBeGreaterThanOrEqual(UNOWNED);
    }
    // at least one nation actually holds land, or every later test is vacuous
    expect([...s.tiles].some((k) => k > 0)).toBe(true);
    expect([...s.troops].every((t) => t === INITIAL_TROOPS)).toBe(true);
    expect(s.attacks).toEqual([]);
    expect(s.tick).toBe(0);
  });

  it("keeps the tile counts in step with the owner array", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const cell = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED)!;
    const before = s.tiles[nation];
    setOwner(s, cell, nation);
    expect(s.tiles[nation]).toBe(before + 1);
    setOwner(s, cell, UNOWNED);
    expect(s.tiles[nation]).toBe(before);
    // and the derived count still matches a full recount, which is the invariant that matters
    const counted = [...s.owner].filter((o) => o === nation).length;
    expect(s.tiles[nation]).toBe(counted);
  });
});

describe("frontSim economy", () => {
  it("raises the cap sublinearly — ten times the land is far less than ten times the ceiling", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === nation) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(land.length).toBeGreaterThan(220);          // seed 11 has plenty of land to work with
    for (let i = 0; i < 20; i++) setOwner(s, land[i], nation);
    const small = maxTroops(s, nation);
    for (let i = 20; i < 200; i++) setOwner(s, land[i], nation);
    const big = maxTroops(s, nation);
    expect(big).toBeGreaterThan(small);                 // more land is still more power
    // Literals, not a recomputation of the implementation's own formula with its own exported
    // exponent — that would hold for any exponent and pin nothing. At TROOP_EXP 0.6 these are
    // 200 + 60*20^0.6 and 200 + 60*200^0.6; at a linear exponent they would be 1400 and 12200.
    expect(small).toBeCloseTo(562.05, 1);
    expect(big).toBeCloseTo(1641.35, 1);
    // Ten times the land must give under four times the ceiling. Linear growth is 8.71x here, so
    // this bound is what actually separates sublinear from linear.
    expect(big / small).toBeLessThan(4);
    expect(TROOP_EXP).toBeLessThan(1);
  });

  it("chokes regeneration as the pool fills, and stops dead at the cap", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const max = maxTroops(s, nation);
    s.troops[nation] = max * 0.1;
    const low = regenPerTick(s, nation);
    s.troops[nation] = max * 0.9;
    const high = regenPerTick(s, nation);
    expect(low).toBeGreaterThan(high);
    s.troops[nation] = max;
    expect(regenPerTick(s, nation)).toBe(0);
  });

  it("snaps the pool down to the new cap after territory is lost", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === nation) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(land.length).toBeGreaterThan(220);
    for (let i = 0; i < 200; i++) setOwner(s, land[i], nation);
    const oldMax = maxTroops(s, nation);
    s.troops[nation] = oldMax; // fill the pool to the cap while the nation is still large
    for (let i = 20; i < 200; i++) setOwner(s, land[i], UNOWNED); // take most of the land back away
    const newMax = maxTroops(s, nation);
    expect(newMax).toBeLessThan(oldMax); // the shrink actually lowered the ceiling
    tick(s);
    expect(s.troops[nation]).toBeLessThanOrEqual(newMax + 1e-9);
  });

  it("never lets a tick push a nation past its cap", () => {
    const s = fresh(11);
    for (let t = 0; t < 200; t++) tick(s);
    for (let p = 0; p < s.troops.length; p++) {
      expect(s.troops[p]).toBeLessThanOrEqual(maxTroops(s, p) + 1e-9);
    }
    expect(s.tick).toBe(200);
  });

  it("same seed, same ticks, identical state — no clock and no rng", () => {
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 50; t++) { tick(a); tick(b); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.troops]).toEqual([...b.troops]);
    expect([...a.tiles]).toEqual([...b.tiles]);
  });
});
