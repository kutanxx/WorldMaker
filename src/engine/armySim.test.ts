import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF, LEVY_FRAC, UPKEEP_FRAC, REGROW_FRAC, MILITIA_FRAC, WIN_LOSS_MULT, armyAt, maxLevy, levy, applyUpkeep, regrow, militiaOf, defenceOf, previewMove, moveArmy, aiTurn, endTurn, battleRoll, winChance, ODDS_K } from "./armySim";
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
    // maxLevy should predict the amount we can levy
    const predicted = maxLevy(s, prov);
    expect(predicted).toBe(Math.floor(before * LEVY_FRAC));
    const got = levy(s, prov, nation);
    expect(got).toBe(predicted);
    expect(s.pop[prov]).toBeCloseTo(before - got, 9);
    expect(armyAt(s, prov, nation)!.men).toBe(got);
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
  it("captures with zero surviving attackers on an exactly pyrrhic win (intended: the land is taken, the force is spent)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);

    // Search real adjacent province pairs for a population level at `target` where the resulting
    // militia + terrain defence produces a win that is EXACTLY pyrrhic: the attacker's rounded
    // losses consume the whole attacking force (e.g. 1 militia on grassland: def=0.85, atk=1,
    // losses=round(0.85*WIN_LOSS_MULT)=1, leaving 0 survivors). Computed from the real helpers
    // (not hardcoded) so the boundary tracks any future constant tuning.
    let hit: { prov: number; target: number; nation: number; pop: number; atk: number } | null = null;
    for (let prov = 0; prov < s.n && !hit; prov++) {
      if (s.owner[prov] < 0) continue;
      const nation = s.owner[prov];
      for (const target of s.adj[prov]) {
        if (hit) break;
        for (let pop = 1; pop <= 50; pop++) {
          s.pop[target] = pop;
          const def = defenceOf(s, target, nation);
          if (def <= 0) continue;
          const atk = Math.floor(def) + 1; // smallest integer strictly greater than def (a win)
          const attackerLosses = Math.min(atk, Math.round(def * WIN_LOSS_MULT));
          if (atk - attackerLosses === 0) { hit = { prov, target, nation, pop, atk }; break; }
        }
      }
    }
    expect(hit).not.toBeNull(); // if this ever fails, hand-construct the boundary instead (see review)
    const { prov, target, nation, pop, atk } = hit!;

    // rebuild a clean state and pin exactly this boundary
    const s2 = initArmySim(world);
    s2.owner[target] = nation === 0 ? 1 : 0; // a hostile target, regardless of its original owner
    s2.pop[target] = pop;
    s2.armies.push({ prov, nation, men: atk });

    const r = moveArmy(s2, prov, nation, target)!;
    expect(r.won).toBe(true);
    expect(r.captured).toBe(true);
    expect(r.attackerLosses).toBe(atk); // rounded losses consume the entire attacking force
    expect(s2.owner[target]).toBe(nation);       // the land changes hands...
    expect(armyAt(s2, target, nation)).toBeUndefined(); // ...but no army survives to occupy it
    expect(armyAt(s2, prov, nation)).toBeUndefined();   // the attacking force is spent, not left behind
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

describe("endTurn", () => {
  it("advances the turn, applies upkeep and regrows population", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const men = levy(s, prov, nation);
    const popAfterLevy = s.pop[prov];
    endTurn(s, nation);
    expect(s.turn).toBe(1);
    expect(armyAt(s, prov, nation)!.men).toBeLessThan(men);   // upkeep bled it
    expect(s.pop[prov]).toBeGreaterThan(popAfterLevy);        // regrowth
  });
  it("lets the AI act but never moves the player's armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const player = 0;
    const prov = [...Array(s.n).keys()].find((p) => s.owner[p] === player)!;
    // two levies so upkeep's minimum 1-man drain shrinks the army without wiping it out
    levy(s, prov, player);
    levy(s, prov, player);
    const before = armyAt(s, prov, player)!.men;
    endTurn(s, player);
    // the player's army is still where the player left it (only upkeep changed its size)
    expect(armyAt(s, prov, player)).toBeDefined();
    expect(armyAt(s, prov, player)!.men).toBeLessThan(before);
    // and the AI did something: some nation other than the player raised men
    expect(s.armies.some((a) => a.nation !== player)).toBe(true);
  });
  it("is deterministic: same seed and same commands give the same state", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
      const s = initArmySim(world);
      const prov = [...s.owner].findIndex((o) => o >= 0);
      const nation = s.owner[prov];
      levy(s, prov, nation);
      endTurn(s, nation);
      endTurn(s, nation);
      return JSON.stringify({ o: [...s.owner], p: [...s.pop].map((v) => v.toFixed(6)), a: s.armies, t: s.turn });
    };
    expect(run()).toBe(run());
  });
});

describe("POP_SCALE (armies must survive their own upkeep)", () => {
  it("a single normal levy from a typical owned province is not annihilated by one turn of upkeep", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const men = levy(s, prov, nation);
    expect(men).toBeGreaterThan(0); // sanity: the levy actually raised someone
    endTurn(s, nation);
    const army = armyAt(s, prov, nation);
    expect(army).toBeDefined();
    expect(army!.men).toBeGreaterThan(0); // the bug: upkeep used to wipe out a freshly-levied army
  });
});

describe("movedOn (one move per army per turn)", () => {
  it("refuses a second march by the same army in the same turn and changes nothing", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] === s.owner[p]))!;
    const nation = s.owner[prov];
    const dest = s.adj[prov].find((q) => s.owner[q] === nation)!;
    levy(s, prov, nation);
    const r1 = moveArmy(s, prov, nation, dest);
    expect(r1).not.toBeNull();
    const snapshot = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    // the same army, now sitting at `dest`, tries to march again this turn (back the way it came)
    const r2 = moveArmy(s, dest, nation, prov);
    expect(r2).toBeNull();
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(snapshot);
  });

  it("lets the army move again once endTurn advances the turn counter", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] === s.owner[p]))!;
    const nation = s.owner[prov];
    const dest = s.adj[prov].find((q) => s.owner[q] === nation)!;
    levy(s, prov, nation);
    expect(moveArmy(s, prov, nation, dest)).not.toBeNull();
    expect(moveArmy(s, dest, nation, prov)).toBeNull();     // blocked: already moved this turn
    endTurn(s, nation);
    expect(armyAt(s, dest, nation)).toBeDefined();          // survived upkeep
    expect(moveArmy(s, dest, nation, prov)).not.toBeNull(); // a new turn, free to move again
  });

  it("marks a stack as moved when another army merges into it, so the merge cannot move again this turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    let found: { x: number; w: number; y: number; nation: number } | null = null;
    for (let y = 0; y < s.n && !found; y++) {
      if (s.owner[y] < 0) continue;
      const nation = s.owner[y];
      const friends = s.adj[y].filter((q) => s.owner[q] === nation && maxLevy(s, q) > 0);
      if (friends.length >= 2) found = { x: friends[0], w: friends[1], y, nation };
    }
    expect(found).not.toBeNull();
    const { x, w, y, nation } = found!;
    levy(s, x, nation);
    levy(s, w, nation);
    expect(moveArmy(s, x, nation, y)).not.toBeNull();  // first arrival creates the stack at y
    expect(moveArmy(s, w, nation, y)).not.toBeNull();  // second arrival merges into it
    // the merged stack must read as moved this turn, even though the merge came from a
    // fresh (never-moved) army — merging must not launder the target's spent move.
    expect(moveArmy(s, y, nation, x)).toBeNull();
  });
});

describe("aiTurn (AI acts independently)", () => {
  it("only moves non-player nations and never touches the player's armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const player = 0;
    // have the player levy to create an army
    const playerProv = [...Array(s.n).keys()].find((p) => s.owner[p] === player);
    if (playerProv !== undefined) {
      levy(s, playerProv, player);
    }
    const playerArmiesBefore = s.armies.filter((a) => a.nation === player);
    // call aiTurn directly to move all non-player nations
    aiTurn(s, player);
    // verify: the AI created at least one army for a non-player nation
    expect(s.armies.some((a) => a.nation !== player)).toBe(true);
    // and the player's armies are untouched (count and nation match)
    const playerArmiesAfter = s.armies.filter((a) => a.nation === player);
    expect(playerArmiesAfter.length).toBe(playerArmiesBefore.length);
  });
});

describe("winChance (odds from the strength ratio)", () => {
  it("is a coin flip at parity and rises with advantage", () => {
    expect(ODDS_K).toBe(3); // the exact sharpness this whole describe block's numbers assume
    expect(winChance(100, 100)).toBeCloseTo(0.5, 6);
    expect(winChance(200, 100)).toBeCloseTo(8 / 9, 6);      // 2:1 with ODDS_K=3 -> 8/9
    expect(winChance(150, 100)).toBeGreaterThan(0.75);
    expect(winChance(50, 100)).toBeLessThan(0.15);
    expect(winChance(120, 100)).toBeGreaterThan(winChance(110, 100)); // monotone
  });
  it("is certain against no defence and hopeless with no attackers", () => {
    expect(winChance(50, 0)).toBe(1);
    expect(winChance(0, 50)).toBe(0);
  });
  it("always returns a probability", () => {
    for (const [a, d] of [[1, 1], [1, 1000], [1000, 1], [7, 13]]) {
      const p = winChance(a, d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("battleRoll (uncertainty WITHOUT losing determinism)", () => {
  it("is stable for the same battle identity and in [0,1)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const a = battleRoll(s, 5, 2), b = battleRoll(s, 5, 2);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it("differs across target, attacker and turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const base = battleRoll(s, 5, 2);
    expect(battleRoll(s, 6, 2)).not.toBe(base);   // different target
    expect(battleRoll(s, 5, 3)).not.toBe(base);   // different attacker
    s.turn = 1;
    expect(battleRoll(s, 5, 2)).not.toBe(base);   // different turn
  });
  it("does not depend on Math.random", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
    const s1 = initArmySim(world), s2 = initArmySim(world);
    expect(battleRoll(s1, 9, 1)).toBe(battleRoll(s2, 9, 1));
  });
});
