import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { BIOME_DEF } from "./armySim";
import { GRASSLAND, ALPINE } from "./biome";
import {
  initFrontSim, setOwner, maxTroops, regenPerTick, tick, terrainDef,
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

describe("frontSim terrain", () => {
  it("reads the biome defence table rather than returning a constant", () => {
    const s = fresh(11);
    const cellA = 0, cellB = 1;
    // Two biomes chosen for their weights actually differing, so a `terrainDef` that always
    // returned (say) 1 could not pass both assertions.
    expect(BIOME_DEF[GRASSLAND]).not.toBe(BIOME_DEF[ALPINE]);
    s.world.biome[cellA] = GRASSLAND;
    s.world.biome[cellB] = ALPINE;
    expect(terrainDef(s, cellA)).toBe(BIOME_DEF[GRASSLAND]);
    expect(terrainDef(s, cellB)).toBe(BIOME_DEF[ALPINE]);
  });

  it("falls back to 1 for a biome id absent from the table", () => {
    const s = fresh(11);
    const cell = 0;
    s.world.biome[cell] = 255; // no biome classifier ever produces this id
    expect(BIOME_DEF[255]).toBeUndefined();
    expect(terrainDef(s, cell)).toBe(1);
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

import {
  borderCells, startAttack, cancelAttack,
  ATTACK_SPEED, FORCE_MIN, FORCE_MAX, COST_ATK, COST_DEF,
} from "./frontSim";

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

  it("refuses SEA as a target instead of annexing the ocean", () => {
    const s = fresh(11);
    // Pick a nation that actually has a coastline, so the rejection is provably about the SEA check
    // and not just the (separate) no-shared-border rejection happening to fire anyway.
    const nation = [...Array(s.tiles.length).keys()].find((p) => borderCells(s, p, SEA).length > 0);
    expect(nation).not.toBeUndefined();
    const before = s.troops[nation!];
    expect(startAttack(s, nation!, SEA, 0.5)).toBe(false);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[nation!]).toBe(before);
  });

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

  it("returns every one of the target's bordering cells, not a subset", () => {
    const { s, a, b } = strip(11, true);
    const border = borderCells(s, a, b);
    // An independent recount over every cell in the map. `length` is the quantity the whole front
    // system relies on, so a border-cells implementation that silently dropped some cells but kept
    // every returned one valid would still pass the test above.
    let recount = 0;
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== b) continue;
      if (s.world.grid.neighbors[c].some((q) => s.owner[q] === a)) recount++;
    }
    expect(border.length).toBe(recount);
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
    s.troops[a] = maxTroops(s, a) * 0.5; // comfortably under the cap, so the cap clamp cannot fire and
                                           // mask what this test is actually pinning
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
    // Both must actually have started, or a degenerate (zero-length) narrow border would still pass
    // this test by leaving `narrow` at 0 captures — silently deleting half the experiment.
    expect(startAttack(narrow.s, narrow.a, narrow.b, 0.5)).toBe(true);
    expect(startAttack(wide.s, wide.a, wide.b, 0.5)).toBe(true);
    // Several ticks, not one: measure — not assume — that the narrow front's own per-tick budget is
    // below a full cell, so a one-tick comparison would risk pitting a real capture against zero for
    // reasons that have nothing to do with border width.
    const nAtk = narrow.s.attacks[0];
    const nDefence = Math.max(1, narrow.s.troops[narrow.b]);
    const nForce = Math.min(FORCE_MAX, Math.max(FORCE_MIN, nAtk.pool / nDefence));
    const nBudget = nForce * borderCells(narrow.s, narrow.a, narrow.b).length * ATTACK_SPEED;
    expect(nBudget).toBeLessThan(1);
    const nBefore = narrow.s.tiles[narrow.a], wBefore = wide.s.tiles[wide.a];
    for (let t = 0; t < 30; t++) { tick(narrow.s); tick(wide.s); }
    const nCaptured = narrow.s.tiles[narrow.a] - nBefore;
    const wCaptured = wide.s.tiles[wide.a] - wBefore;
    expect(nCaptured).toBeGreaterThan(0);        // the narrow side must have actually advanced too
    expect(wCaptured).toBeGreaterThan(nCaptured);
  });

  it("accumulates a sub-one-cell-per-tick budget instead of stalling or rounding away", () => {
    const { s, a, b } = strip(11, false);         // narrow border keeps the border length small
    const cap = maxTroops(s, b);
    s.troops[b] = cap;                            // sits exactly at its own cap: regen is 0, so
                                                    // defence holds steady across the waiting ticks
    s.troops[a] = 500;
    // pool/defence far below FORCE_MIN (cap is at least TROOP_BASE = 200, pool is only 5) so force
    // clamps to FORCE_MIN regardless of the map's exact geometry.
    expect(startAttack(s, a, b, 0.01)).toBe(true);
    const atk = s.attacks[0];
    const border = borderCells(s, a, b);
    // Same quantities advanceAttacks uses, computed here instead of assumed, so the test states its
    // own premise: this front's budget really is below one cell per tick.
    const defence = Math.max(1, s.troops[b]);
    const force = Math.min(FORCE_MAX, Math.max(FORCE_MIN, atk.pool / defence));
    const budget = force * border.length * ATTACK_SPEED;
    expect(force).toBe(FORCE_MIN);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(1);
    const tilesBefore = s.tiles[a];
    const waitTicks = Math.ceil(1 / budget);
    for (let t = 0; t < waitTicks - 1; t++) tick(s);
    expect(s.tiles[a]).toBe(tilesBefore);         // nothing captured yet: budget hasn't reached 1
    tick(s);
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore); // and by ~ceil(1/budget) ticks it has
  });

  it("charges the attacker and bleeds the defender for every cell taken", () => {
    const { s, a, b } = strip(11, true);
    // A twin built the same way (same seed, same wide flag) is bit-identical to `s` before the
    // attack — strip() is a pure function of its arguments — except it is never attacked.
    const twin = strip(11, true);
    startAttack(s, a, b, 0.9);
    const poolBefore = s.attacks[0].pool, tilesBefore = s.tiles[a], tilesBBefore = s.tiles[b];
    // Stop at the tick of the FIRST capture, not many ticks later. Losing land lowers b's own
    // maxTroops cap and throttles its regen for reasons that have nothing to do with COST_DEF — over
    // many ticks that alone pulls troops[b] below the twin's even at COST_DEF = 0, which is exactly
    // what made the original assertion pass regardless of the constant's value. At the single tick
    // where the first cell changes hands, though, that tick's regen was computed from the SAME
    // (still-unshrunk) tile count on both runs — regen runs before combat — so any gap between the
    // two runs measured right here can only be the direct combat cost just applied.
    let t = 0;
    while (s.tiles[b] === tilesBBefore && t < 60) { tick(s); tick(twin.s); t++; }
    expect(s.tiles[b]).toBeLessThan(tilesBBefore);   // a capture actually happened within the budget
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore);
    expect(s.attacks[0]?.pool ?? 0).toBeLessThan(poolBefore);
    expect(s.troops[b]).toBeLessThan(twin.s.troops[b]);
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

  it("refunds the pool once conquest finishes, instead of destroying the army that did it", () => {
    const { s, a, b } = strip(11, false); // narrow: b owns nothing but the thin ring touching a,
                                            // so fully conquering that ring wipes b out entirely
    const cap = maxTroops(s, a);
    s.troops[a] = cap;
    s.troops[b] = 50;                      // a weak defender so force clamps to FORCE_MAX: the whole
                                             // ring falls in a couple dozen ticks, not hundreds, which
                                             // keeps regeneration's own contribution small
    expect(startAttack(s, a, b, 1)).toBe(true); // commit the entire reserve, so it starts at 0
    const committed = s.attacks[0].pool;
    for (let t = 0; t < 300 && s.attacks.length > 0; t++) tick(s);
    expect(s.attacks).toHaveLength(0);      // the front ended because the border vanished...
    expect(s.tiles[b]).toBe(0);             // ...specifically because b has no land left at all
    // Regen alone from a reserve of 0 — the only source of growth if the pool were discarded instead
    // of refunded — cannot climb anywhere near a third of what was committed over this few ticks.
    expect(s.troops[a]).toBeGreaterThan(committed * 0.3);
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

  it("refuses a non-finite fraction instead of creating a front that can never advance or die", () => {
    const { s, a, b } = strip(11, false);
    const before = s.troops[a];
    expect(startAttack(s, a, b, NaN)).toBe(false);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[a]).toBe(before);
  });

  it("clamps a cancelled front's refund to the nation's current cap", () => {
    const { s, a, b } = strip(11, true);
    const cap = maxTroops(s, a);
    expect(startAttack(s, a, b, 0.5)).toBe(true);   // commits half the pool to a front
    s.troops[a] = cap;                              // simulate the reserve regenerating back to the cap
                                                      // while the front is still out
    cancelAttack(s, a, b);                          // handing the committed pool back on top of a full reserve
    expect(s.troops[a]).toBeLessThanOrEqual(cap + 1e-9);
  });

  it("sizes a re-commit from the reserve AFTER the old front's survivors return, not before", () => {
    const { s, a, b } = strip(11, true);
    s.troops[a] = 700; s.troops[b] = 5000;   // strong defender: the first front barely dents it, so
                                               // its pool stays intact for the redirect that follows
    expect(startAttack(s, a, b, 0.9)).toBe(true);
    const existingPool = s.attacks[0].pool;
    s.troops[a] = 700;   // simulate the reserve regenerating back up while the front is still out
    const cap = maxTroops(s, a);
    const expectedFront = Math.min(cap, s.troops[a] + existingPool); // the whole refunded reserve
    expect(startAttack(s, a, b, 1)).toBe(true);   // redirect everything into one front
    // The entire refunded reserve — survivors from the old front included — must land in the new
    // front, not just a fraction of the pre-refund reserve with the survivors stranded at home.
    expect(s.attacks[0].pool).toBeCloseTo(expectedFront, 6);
    expect(s.troops[a]).toBeCloseTo(0, 6);
  });

  it("never loses troops beyond what the cap legitimately clamps when re-committing", () => {
    const { s, a, b } = strip(11, true);
    s.troops[a] = 700; s.troops[b] = 5000;
    expect(startAttack(s, a, b, 0.9)).toBe(true);
    const existingPool = s.attacks[0].pool;
    s.troops[a] = 700;
    const cap = maxTroops(s, a);
    // What the cap alone allows to survive the refund — the only loss this operation may legitimately
    // cause. Anything beyond this is the reserve+pool total actually vanishing.
    const legitimateTotal = Math.min(cap, s.troops[a] + existingPool);
    expect(startAttack(s, a, b, 0.5)).toBe(true);
    const totalAfter = s.troops[a] + s.attacks[0].pool;
    expect(totalAfter).toBeCloseTo(legitimateTotal, 6);
  });

  it("leaves an existing front untouched when a re-commit against the same pair is rejected", () => {
    const { s, a, b } = strip(11, true);
    expect(startAttack(s, a, b, 0.5)).toBe(true);
    const before = { ...s.attacks[0] };
    const reserveBefore = s.troops[a];
    expect(startAttack(s, a, b, NaN)).toBe(false);   // rejected: non-finite fraction
    expect(s.attacks).toHaveLength(1);
    expect(s.attacks[0]).toEqual(before);
    expect(s.troops[a]).toBe(reserveBefore);
  });

  it("captures the same cells when the same tick is run from the same state", () => {
    const one = strip(11, true), two = strip(11, true);
    startAttack(one.s, one.a, one.b, 0.6);
    startAttack(two.s, two.a, two.b, 0.6);
    for (let t = 0; t < 10; t++) { tick(one.s); tick(two.s); }
    expect([...one.s.owner]).toEqual([...two.s.owner]);
    expect([...one.s.troops]).toEqual([...two.s.troops]);
  });

  it("pins the shipped tuning constants", () => {
    // Nothing else in this file references these by value, so any of them drifting (say
    // ATTACK_SPEED going from 0.05 to 0.5) would change every front's speed with no test noticing.
    expect(ATTACK_SPEED).toBe(0.05);
    expect(FORCE_MIN).toBe(0.2);
    expect(FORCE_MAX).toBe(3);
    expect(COST_ATK).toBe(1.0);
    expect(COST_DEF).toBe(0.6);
  });
});
