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

// Only the names the tests below actually reference: the brief's Step 1 block also imports
// terrainDef/ATTACK_SPEED/FORCE_MIN/FORCE_MAX/COST_ATK/COST_DEF/capOf, none of which any test body
// uses, and this project's tsconfig has noUnusedLocals — trimmed here so `tsc --noEmit` passes.
import { borderCells, startAttack, cancelAttack } from "./frontSim";

describe("frontSim attacks", () => {
  // Builds a clean two-nation strip so border length is something the test sets, not something the
  // map happens to produce: `a` owns a block of land, `b` owns the cells bordering it.
  function strip(seed: number, wide: boolean) {
    const s = fresh(seed);
    const a = 0, b = 1;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    setOwner(s, land[0], a);
    // grow `a` until it has enough neighbours to make a wide or narrow front
    const want = wide ? 40 : 6;
    for (let i = 1; i < land.length && s.tiles[a] < want; i++) {
      if (s.world.grid.neighbors[land[i]].some((q) => s.owner[q] === a)) setOwner(s, land[i], a);
    }
    // everything touching `a` becomes `b`
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== UNOWNED) continue;
      if (s.world.grid.neighbors[c].some((q) => s.owner[q] === a)) setOwner(s, c, b);
    }
    s.troops[a] = 1000; s.troops[b] = 1000;
    return { s, a, b };
  }

  it("counts the target's cells that touch the attacker, and nothing else", () => {
    const { s, a, b } = strip(11, false);
    const border = borderCells(s, a, b);
    expect(border.length).toBeGreaterThan(0);
    for (const c of border) {
      expect(s.owner[c]).toBe(b);
      expect(s.world.grid.neighbors[c].some((q) => s.owner[q] === a)).toBe(true);
    }
    expect([...border]).toEqual([...border].sort((x, y) => x - y));   // ascending: order is fixed
  });

  it("takes troops out of the pool the moment an attack starts", () => {
    const { s, a, b } = strip(11, false);
    const before = s.troops[a];
    expect(startAttack(s, a, b, 0.5)).toBe(true);
    expect(s.troops[a]).toBeCloseTo(before * 0.5, 6);
    expect(s.attacks).toHaveLength(1);
    expect(s.attacks[0]).toMatchObject({ attacker: a, target: b });
    expect(s.attacks[0].pool).toBeCloseTo(before * 0.5, 6);
  });

  it("gives the pool back when the attack is cancelled", () => {
    const { s, a, b } = strip(11, false);
    const before = s.troops[a];
    startAttack(s, a, b, 0.5);
    cancelAttack(s, a, b);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[a]).toBeCloseTo(before, 6);
  });

  it("advances faster across a wide border than a narrow one — this is the whole point", () => {
    const narrow = strip(11, false), wide = strip(11, true);
    expect(borderCells(wide.s, wide.a, wide.b).length)
      .toBeGreaterThan(borderCells(narrow.s, narrow.a, narrow.b).length);
    startAttack(narrow.s, narrow.a, narrow.b, 0.5);
    startAttack(wide.s, wide.a, wide.b, 0.5);
    const nBefore = narrow.s.tiles[narrow.a], wBefore = wide.s.tiles[wide.a];
    // Several ticks, not one: a front's budget is a fraction of a cell per tick, so a single tick
    // captures nothing on either side and would make this comparison 0 > 0.
    for (let t = 0; t < 30; t++) { tick(narrow.s); tick(wide.s); }
    expect(wide.s.tiles[wide.a] - wBefore).toBeGreaterThan(narrow.s.tiles[narrow.a] - nBefore);
  });

  it("charges the attacker and bleeds the defender for every cell taken", () => {
    const { s, a, b } = strip(11, true);
    startAttack(s, a, b, 0.9);
    const poolBefore = s.attacks[0].pool, defBefore = s.troops[b], tilesBefore = s.tiles[a];
    for (let t = 0; t < 30; t++) tick(s);
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore);
    expect(s.attacks[0]?.pool ?? 0).toBeLessThan(poolBefore);
    expect(s.troops[b]).toBeLessThan(defBefore);
  });

  it("takes unowned land without bleeding anybody", () => {
    const s = fresh(11);
    // Twin reference run that never attacks: landless nations still regen toward the TROOP_BASE
    // floor every tick (pinned Task 1 behaviour — see "chokes regeneration" above), so comparing
    // against their pre-tick snapshot would fail on regen alone. Comparing against a twin run over
    // the same ticks isolates what this test actually claims: the attack itself must not touch them.
    const ref = fresh(11);
    const a = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) { setOwner(s, c, UNOWNED); setOwner(ref, c, UNOWNED); }
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    for (let i = 0; i < 30; i++) { setOwner(s, land[i], a); setOwner(ref, land[i], a); }
    s.troops[a] = 1000; ref.troops[a] = 1000;
    expect(startAttack(s, a, UNOWNED, 0.5)).toBe(true);
    const tilesBefore = s.tiles[a];
    for (let t = 0; t < 30; t++) { tick(s); tick(ref); }
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore);
    for (let p = 1; p < s.troops.length; p++) expect(s.troops[p]).toBe(ref.troops[p]);
  });

  it("ends an attack once its pool runs out", () => {
    const { s, a, b } = strip(11, true);
    s.troops[a] = 4;                       // barely anything to spend
    startAttack(s, a, b, 1);
    for (let t = 0; t < 60 && s.attacks.length > 0; t++) tick(s);
    expect(s.attacks).toHaveLength(0);
  });

  it("refuses an attack with no shared border", () => {
    const s = fresh(11);
    const a = 0, b = 1;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    setOwner(s, land[0], a);
    setOwner(s, land[land.length - 1], b);
    s.troops[a] = 1000;
    const before = s.troops[a];
    expect(startAttack(s, a, b, 0.5)).toBe(false);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[a]).toBe(before);      // a refused attack costs nothing
  });

  it("captures the same cells when the same tick is run from the same state", () => {
    const one = strip(11, true), two = strip(11, true);
    startAttack(one.s, one.a, one.b, 0.6);
    startAttack(two.s, two.a, two.b, 0.6);
    for (let t = 0; t < 10; t++) { tick(one.s); tick(two.s); }
    expect([...one.s.owner]).toEqual([...two.s.owner]);
    expect([...one.s.troops]).toEqual([...two.s.troops]);
  });
});
