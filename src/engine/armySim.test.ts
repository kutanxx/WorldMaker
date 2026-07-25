import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF, LEVY_FRAC, UPKEEP_FRAC, REGROW_FRAC, MILITIA_FRAC, WIN_LOSS_MULT, armyAt, maxLevy, levy, applyUpkeep, regrow, militiaOf, defenceOf, previewMove, moveArmy } from "./armySim";
import { GRASSLAND, ALPINE } from "./biome";

describe("basePopOf (population comes from the generated world)", () => {
  it("scales with province size and biome, and is 0 for no cells", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    for (const p of world.provinces) {
      const pop = basePopOf(world, p.id);
      expect(pop).toBeGreaterThanOrEqual(0);
      // population must be proportional to cells x biome weight, before city bonus
      const floor = p.cells * (BIOME_POP[p.biome] ?? 0);
      expect(pop).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });
  it("weights a grassland province above an alpine one of the same size", () => {
    expect(BIOME_POP[GRASSLAND]).toBeGreaterThan(BIOME_POP[ALPINE]);
    expect(BIOME_DEF[ALPINE]).toBeGreaterThan(BIOME_DEF[GRASSLAND]);
    expect(BIOME_DEF[GRASSLAND]).toBeLessThan(1); // open ground favours the ATTACKER
  });
});

describe("initArmySim", () => {
  it("starts every province owned as the world says, at full population, with no armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    expect(s.n).toBe(world.provinces.length);
    expect(s.armies).toEqual([]);
    expect(s.turn).toBe(0);
    for (let p = 0; p < s.n; p++) {
      expect(s.pop[p]).toBe(s.basePop[p]);
      expect(s.basePop[p]).toBe(basePopOf(world, p));
    }
    // at least one province is owned by each live polity's majority snap
    expect([...s.owner].some((o) => o >= 0)).toBe(true);
    expect(s.adj.length).toBe(s.n);
  });
  it("is deterministic for the same seed", () => {
    const a = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    const b = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
  });
});

describe("levy (men cost population)", () => {
  it("raises up to LEVY_FRAC of the province's population and removes it from the population", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const before = s.pop[prov];
    const expected = Math.floor(before * LEVY_FRAC);
    const got = levy(s, prov, nation);
    expect(got).toBe(expected);
    expect(s.pop[prov]).toBeCloseTo(before - expected, 9);
    expect(armyAt(s, prov, nation)!.men).toBe(expected);
  });
  it("stacks a second levy into the same army", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const a = levy(s, prov, nation);
    const b = levy(s, prov, nation);
    expect(armyAt(s, prov, nation)!.men).toBe(a + b);
    expect(s.armies.filter((x) => x.prov === prov && x.nation === nation).length).toBe(1);
  });
  it("refuses to levy from land you do not own", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const notOwner = s.owner[prov] === 0 ? 1 : 0;
    expect(levy(s, prov, notOwner)).toBe(0);
  });
});

describe("upkeep and regrowth", () => {
  it("bleeds every army by UPKEEP_FRAC each turn and removes empty ones", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    s.armies.push({ prov: 0, nation: 0, men: 100 }, { prov: 1, nation: 0, men: 1 });
    applyUpkeep(s);
    expect(s.armies.find((a) => a.prov === 0)!.men).toBe(100 - Math.max(1, Math.floor(100 * UPKEEP_FRAC)));
    expect(s.armies.find((a) => a.prov === 1)).toBeUndefined(); // 1 man army drains away
  });
  it("regrows population toward basePop but never past it", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    s.pop[0] = 0;
    regrow(s);
    expect(s.pop[0]).toBeCloseTo(s.basePop[0] * REGROW_FRAC, 9);
    s.pop[1] = s.basePop[1];
    regrow(s);
    expect(s.pop[1]).toBe(s.basePop[1]); // capped
  });
});

describe("defence (militia + terrain)", () => {
  it("counts MILITIA_FRAC of the population, multiplied by the biome's defensibility", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = 0;
    s.pop[prov] = 100;
    const expectedMilitia = Math.floor(100 * MILITIA_FRAC);
    expect(militiaOf(s, prov)).toBe(expectedMilitia);
    const attacker = s.owner[prov] === 0 ? 1 : 0;
    const mult = BIOME_DEF[world.provinces[prov].biome];
    expect(defenceOf(s, prov, attacker)).toBeCloseTo(expectedMilitia * mult, 9);
  });
  it("adds an enemy army standing on the province", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = 0;
    s.pop[prov] = 100;
    const defender = s.owner[prov];
    const attacker = defender === 0 ? 1 : 0;
    s.armies.push({ prov, nation: defender, men: 50 });
    const mult = BIOME_DEF[world.provinces[prov].biome];
    expect(defenceOf(s, prov, attacker)).toBeCloseTo((50 + Math.floor(100 * MILITIA_FRAC)) * mult, 9);
  });
});

describe("moveArmy (march, battle, capture)", () => {
  it("refuses a move to a non-adjacent province or with no army", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    expect(moveArmy(s, prov, nation, s.adj[prov][0])).toBeNull(); // no army yet
    levy(s, prov, nation);
    const far = [...Array(s.n).keys()].find((p) => p !== prov && !s.adj[prov].includes(p))!;
    expect(moveArmy(s, prov, nation, far)).toBeNull();
  });
  it("marches into own land without a battle", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] === s.owner[p]))!;
    const nation = s.owner[prov];
    const dest = s.adj[prov].find((q) => s.owner[q] === nation)!;
    const men = levy(s, prov, nation);
    const r = moveArmy(s, prov, nation, dest)!;
    expect(r.won).toBe(true);
    expect(r.attackerLosses).toBe(0);
    expect(armyAt(s, dest, nation)!.men).toBe(men);
    expect(armyAt(s, prov, nation)).toBeUndefined();
  });
  it("wins, captures and bleeds when the attacker outnumbers the defence", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const def = defenceOf(s, target, nation);
    s.armies.push({ prov, nation, men: Math.ceil(def) + 1000 }); // overwhelming
    const preview = previewMove(s, prov, nation, target)!;
    const r = moveArmy(s, prov, nation, target)!;
    expect(preview.won).toBe(true);
    expect(r.won).toBe(true);
    expect(r.captured).toBe(true);
    expect(s.owner[target]).toBe(nation);
    expect(r.attackerLosses).toBe(Math.round(def * WIN_LOSS_MULT));
    expect(armyAt(s, target, nation)!.men).toBe(Math.ceil(def) + 1000 - r.attackerLosses);
  });
  it("loses the whole attacking army and captures nothing when outmatched", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const ownerBefore = s.owner[target];
    s.armies.push({ prov, nation, men: 1 }); // hopeless
    const r = moveArmy(s, prov, nation, target)!;
    expect(r.won).toBe(false);
    expect(r.captured).toBe(false);
    expect(s.owner[target]).toBe(ownerBefore);
    expect(armyAt(s, prov, nation)).toBeUndefined(); // destroyed
  });
  it("previewMove never mutates the state", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    levy(s, prov, nation);
    const target = s.adj[prov][0];
    const before = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    previewMove(s, prov, nation, target);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(before);
  });
});

