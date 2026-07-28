import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF, LEVY_FRAC, UPKEEP_FRAC, REGROW_FRAC, MILITIA_FRAC, WIN_LOSS_MULT, DEF_LOSS_MULT, AI_LEVY_FRAC, AI_LEADER_BIAS, armyAt, maxLevy, levy, canLevy, applyUpkeep, regrow, militiaOf, defenceOf, previewMove, moveArmy, aiTurn, endTurn, battleRoll, winChance, ODDS_K, GOAL_GAIN_FRAC, HORIZON, landProvinces, goalGain, goalProgress, provinceCount, nationRank, outcome, landComponents, theaterOf, setTheater, playableNations, nationProgress, leadingRival, raceLeader, aiObjective, stepToward, type ArmyState } from "./armySim";
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
  it("stacks a second levy (a turn later) into the same army", () => {
    // one levy per province per turn is now enforced (see the "levy per-turn guard" describe block
    // below), so the second levy here must land on a DIFFERENT turn than the first — advance s.turn
    // directly (not endTurn) so upkeep/regrowth don't perturb the population/army numbers this test
    // is pinning.
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const a = levy(s, prov, nation);
    s.turn++;
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

describe("levy per-turn guard (the bug: a province could be levied unlimited times in one turn)", () => {
  it("refuses a second levy on the same province in the same turn and changes nothing", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const first = levy(s, prov, nation);
    expect(first).toBeGreaterThan(0);
    const popAfterFirst = s.pop[prov];
    const menAfterFirst = armyAt(s, prov, nation)!.men;
    const second = levy(s, prov, nation);
    expect(second).toBe(0);
    expect(s.pop[prov]).toBe(popAfterFirst);
    expect(armyAt(s, prov, nation)!.men).toBe(menAfterFirst);
  });

  it("lets the same province be levied again once endTurn advances the turn counter", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    levy(s, prov, nation);
    expect(levy(s, prov, nation)).toBe(0);          // blocked: same turn
    endTurn(s, nation);
    expect(levy(s, prov, nation)).toBeGreaterThan(0); // a new turn, free to levy again
  });

  it("lets two different provinces each be levied in the same turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const owned = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation && maxLevy(s, p) > 0);
    expect(owned.length).toBeGreaterThanOrEqual(2); // guard: this test would be vacuous otherwise
    const [a, b] = owned;
    expect(levy(s, a, nation)).toBeGreaterThan(0);
    expect(levy(s, b, nation)).toBeGreaterThan(0);
  });

  it("canLevy reflects fresh, already-levied-this-turn, and too-low-population states", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    expect(canLevy(s, prov, nation)).toBe(true);         // fresh: owned, population, never levied
    levy(s, prov, nation);
    expect(canLevy(s, prov, nation)).toBe(false);        // already levied this turn
    s.turn++;                                            // a new turn clears the per-turn guard...
    s.pop[prov] = 4;                                     // ...but population is now too low to raise anyone
    expect(maxLevy(s, prov)).toBe(0);
    expect(canLevy(s, prov, nation)).toBe(false);        // population too low
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
    const atk = Math.ceil(def) + 1000; // overwhelming: odds must be near-certain, not just atk>def
    s.armies.push({ prov, nation, men: atk });
    const preview = previewMove(s, prov, nation, target)!;
    const r = moveArmy(s, prov, nation, target)!;
    expect(preview.won).toBe(true);
    expect(r.won).toBe(true);
    expect(r.captured).toBe(true);
    expect(s.owner[target]).toBe(nation);
    // losses now scale by closeness = min(atk,def)/max(atk,def); with atk this far above def the
    // fight is a rout, so this pins the new formula rather than the old flat round(def*WIN_LOSS_MULT).
    const closeness = def / atk;
    expect(r.attackerLosses).toBe(Math.round(def * WIN_LOSS_MULT * closeness));
    expect(armyAt(s, target, nation)!.men).toBe(atk - r.attackerLosses);
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
    // structural, not lucky: pin that the odds themselves are near-zero, so the loss below is
    // guaranteed by the numbers rather than by this particular (seed, turn, target, attacker) roll.
    const preview = previewMove(s, prov, nation, target)!;
    expect(preview.p).toBeLessThan(0.01);
    const r = moveArmy(s, prov, nation, target)!;
    expect(r.won).toBe(false);
    expect(r.captured).toBe(false);
    expect(s.owner[target]).toBe(ownerBefore);
    expect(armyAt(s, prov, nation)).toBeUndefined(); // destroyed
  });
  it("captures with zero surviving attackers on an exactly pyrrhic win (intended: the land is taken, the force is spent)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });

    // Under the old atk>def-only verdict, the pyrrhic boundary was "smallest atk that still wins".
    // Under closeness-scaled losses that boundary can no longer be pyrrhic FOR THE `def` VALUES THIS
    // ENGINE'S CURRENT CONSTANTS CAN ACTUALLY PRODUCE — this is NOT a fact about the formula for every
    // real def. At atk = floor(def)+1, closeness = def/atk is barely below 1, and
    // round(def*WIN_LOSS_MULT*closeness) < atk does fail for some real def: e.g. atk=1, def=0.95 gives
    // round(0.6*0.95^2) = round(0.5415) = 1 = atk, a zero-survivor win at the old-style boundary.
    // (The counterexample band is roughly def in [0.9129, 1) at atk=1.) It happens to hold here only
    // because reaching def < 1 requires a single militia unit times BIOME_DEF, and the only values this
    // engine currently produces are 0.85 (GRASSLAND) and 0.9 (DESERT) — both below that ~0.9129
    // threshold. A future BIOME_DEF or MILITIA_FRAC change that lands def in ~[0.913, 1) would break
    // this reasoning and reopen the old-style boundary as pyrrhic again.
    // The zero-survivor case instead lives on the OTHER side of the ratio: whenever def >= atk, closeness
    // = atk/def, so def*closeness telescopes to exactly atk, and losses = round(WIN_LOSS_MULT*atk) —
    // independent of def. That equals atk only at atk=1 (round(0.6)=1; for atk>=2, 0.6*atk is more
    // than 0.5 below atk). So: attack with a single man (atk=1) into any province whose defence is at
    // least 1 (any biome with BIOME_DEF>=1, one militiaman) — a real, always-available matchup, not a
    // knife-edge one — and IF the roll lands a win, it is unconditionally pyrrhic. Sweep turns (the
    // roll is keyed on turn/target/attacker) to find one where that win actually lands.
    let hit: { turn: number; prov: number; target: number; nation: number; pop: number; atk: number } | null = null;
    for (let turn = 0; turn < 30 && !hit; turn++) {
      const s = initArmySim(world);
      s.turn = turn;
      for (let prov = 0; prov < s.n && !hit; prov++) {
        if (s.owner[prov] < 0) continue;
        const nation = s.owner[prov];
        for (const target of s.adj[prov]) {
          if (hit) break;
          const pop = 5; // floor(5 * MILITIA_FRAC) = 1 man of militia, regardless of biome
          s.pop[target] = pop;
          const def = defenceOf(s, target, nation);
          const atk = 1;
          if (def < atk) continue; // need def >= atk for the telescoping identity above to apply
          const p = winChance(atk, def);
          const roll = battleRoll(s, target, nation);
          if (roll < p) { hit = { turn, prov, target, nation, pop, atk }; break; }
        }
      }
    }
    expect(hit).not.toBeNull(); // if this ever fails, hand-construct the boundary instead (see review)
    const { turn, prov, target, nation, pop, atk } = hit!;

    // rebuild a clean state and pin exactly this boundary
    const s2 = initArmySim(world);
    s2.turn = turn;
    s2.owner[target] = nation === 0 ? 1 : 0; // a hostile target, regardless of its original owner
    s2.pop[target] = pop;
    s2.armies.push({ prov, nation, men: atk });

    const r = moveArmy(s2, prov, nation, target)!;
    expect(r.won).toBe(true);
    expect(r.attackerLosses).toBe(atk); // closeness-scaled, rounded losses consume the entire attacking force
    expect(r.captured).toBe(true);
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
    // two levies so upkeep's minimum 1-man drain shrinks the army without wiping it out. One levy
    // per province per turn is now enforced, so advance s.turn directly (not endTurn, which would
    // itself run upkeep/regrowth and disturb the numbers this test reads) between the two calls.
    levy(s, prov, player);
    s.turn++;
    levy(s, prov, player);
    s.turn = 0;
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

describe("aiTurn mobilises in proportion to nation size (multi-levy)", () => {
  // give `nation` sole ownership of `count` provinces, each with a healthy fixed population, and
  // give every OTHER province in the world an enormous population so its militia dwarfs anything the
  // test nation could ever levy — this makes every adjacent province unbeatable, so aiTurn's move
  // step never fires and only the levy step is exercised (isolating the behaviour under test).
  function isolateForLevyOnly(seed: number, assignments: Array<{ nation: number; provs: number[] }>) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const s = initArmySim(world);
    const owned = new Set<number>();
    for (const { provs } of assignments) for (const p of provs) owned.add(p);
    // strip every OTHER real nation from the world too, not just its population, or one of the
    // world's actual AI nations could conquer our synthetic provinces (they have real, much larger
    // armies) and confound the levy-only measurement this helper exists to isolate.
    for (let p = 0; p < s.n; p++) { s.pop[p] = owned.has(p) ? 100 : 1e12; if (!owned.has(p)) s.owner[p] = -1; }
    for (const { nation, provs } of assignments) for (const p of provs) s.owner[p] = nation;
    return s;
  }

  it("levies from more than one province when the nation owns several", () => {
    const nation = 9001;
    // 8 owned provinces -> ceil(8 * AI_LEVY_FRAC) must be > 1 for this to be a real test
    const provs = [0, 1, 2, 3, 4, 5, 6, 7];
    const expectedN = Math.max(1, Math.ceil(provs.length * AI_LEVY_FRAC));
    expect(expectedN).toBeGreaterThan(1);
    const s = isolateForLevyOnly(1, [{ nation, provs }]);
    aiTurn(s, -1); // no real player: exercise every AI nation including ours
    const levied = new Set(s.armies.filter((a) => a.nation === nation).map((a) => a.prov));
    expect(levied.size).toBe(expectedN);
    // tied populations (all == 100) must break by lower province id
    expect([...levied].sort((a, b) => a - b)).toEqual(provs.slice(0, expectedN));
  });

  it("AI_LEVY_FRAC scaling: a bigger nation levies from strictly more provinces than a small one", () => {
    const big = 9001, small = 9002;
    const bigProvs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // ceil(12 * 0.25) = 3
    const smallProvs = [12, 13];                              // ceil(2 * 0.25) = 1
    const s = isolateForLevyOnly(1, [{ nation: big, provs: bigProvs }, { nation: small, provs: smallProvs }]);
    aiTurn(s, -1);
    const bigLevied = new Set(s.armies.filter((a) => a.nation === big).map((a) => a.prov));
    const smallLevied = new Set(s.armies.filter((a) => a.nation === small).map((a) => a.prov));
    expect(bigLevied.size).toBe(3);
    expect(smallLevied.size).toBe(1);
    expect(bigLevied.size).toBeGreaterThan(smallLevied.size);
  });
});

describe("aiTurn moves every army, not just the biggest", () => {
  it("moves both a small and a large army in the same turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const nation = 9001, enemy1 = 9002, enemy2 = 9003, player = -1;

    // find two disjoint (province, adjacent-province) pairs so each army gets its own target.
    // Relies only on the province graph having two disjoint edges — true of any world with more
    // than a handful of connected land provinces. The p1/p2 assertions below are what fires if not.
    let p1 = -1, t1 = -1;
    for (let a = 0; a < s.n && p1 < 0; a++) {
      if (s.adj[a].length > 0) { p1 = a; t1 = s.adj[a][0]; }
    }
    expect(p1).toBeGreaterThanOrEqual(0);
    let p2 = -1, t2 = -1;
    for (let c = 0; c < s.n && p2 < 0; c++) {
      if (c === p1 || c === t1) continue;
      for (const d of s.adj[c]) {
        if (d === p1 || d === t1 || d === c) continue;
        p2 = c; t2 = d; break;
      }
    }
    expect(p2).toBeGreaterThanOrEqual(0);

    // isolate: strip every other real nation from the world (as isolateForLevyOnly does above) so the
    // AI's now value-seeking fight step — "best score among what it can beat", not "weakest" — cannot
    // be confounded by real neighbouring nations. Left un-isolated, a nation's own frontier-worthy
    // provinces became live options too once an army was strong enough to beat their real defence,
    // and a probabilistic loss to one of them (a legitimate battle outcome, not a bug) could wipe the
    // army before it ever reached t1/t2. Zeroing every other province's stake makes t1/t2 the ONLY
    // beatable targets, regardless of how large levy makes p1/p2's armies.
    const keep = new Set([p1, p2, t1, t2]);
    for (let p = 0; p < s.n; p++) {
      if (keep.has(p)) continue;
      s.pop[p] = 1e12;
      s.owner[p] = -1;
    }
    s.owner[p1] = nation; s.owner[p2] = nation;
    s.owner[t1] = enemy1; s.owner[t2] = enemy2;
    s.pop[t1] = 0; s.pop[t2] = 0; // zero population -> zero defence -> a certain win for any army
    s.armies.push({ prov: p1, nation, men: 5, movedOn: -1 });   // small — not "the biggest"
    s.armies.push({ prov: p2, nation, men: 500, movedOn: -1 }); // large — would be the ONLY mover today

    aiTurn(s, player);

    expect(s.owner[t1]).toBe(nation); // the small army's target was captured too
    expect(s.owner[t2]).toBe(nation); // and the large army's target
    expect(armyAt(s, p1, nation)).toBeUndefined();
    expect(armyAt(s, p2, nation)).toBeUndefined();
  });
});

describe("aiTurn determinism under the stronger AI", () => {
  it("multi-levy and multi-move stay deterministic: same seed and commands give the same state", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
      const s = initArmySim(world);
      const player = [...s.owner].find((o) => o >= 0)!;
      for (let i = 0; i < 5; i++) endTurn(s, player);
      return JSON.stringify({ o: [...s.owner], p: [...s.pop].map((v) => v.toFixed(6)), a: s.armies, t: s.turn });
    };
    expect(run()).toBe(run());
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

describe("battle verdict is now a roll against the quoted odds", () => {
  it("reports the same p that the verdict was decided by, and preview matches the real move", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    s.armies.push({ prov, nation, men: 500, movedOn: -1 });
    const pre = previewMove(s, prov, nation, target)!;
    expect(pre.p).toBeCloseTo(winChance(pre.atk, pre.def), 9);
    const real = moveArmy(s, prov, nation, target)!;
    expect(real.won).toBe(pre.won);      // preview cannot disagree with the outcome
    expect(real.p).toBeCloseTo(pre.p, 9);
  });

  it("CAN lose a battle it outnumbers — the point of the change", () => {
    // sweep turns so the roll changes; with atk only slightly above def, some turn must roll a loss
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    let sawLoss = false;
    for (let turn = 0; turn < 40 && !sawLoss; turn++) {
      const s = initArmySim(world);
      s.turn = turn;
      const prov = [...Array(world.provinces.length).keys()]
        .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
      const nation = s.owner[prov];
      const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
      const def = defenceOf(s, target, nation);
      s.armies.push({ prov, nation, men: Math.ceil(def) + 1, movedOn: -1 }); // barely ahead => ~50%
      const r = moveArmy(s, prov, nation, target)!;
      if (!r.won) sawLoss = true;
    }
    expect(sawLoss).toBe(true);
  });

  it("an even fight costs the winner more than a rout does", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const mk = (men: number) => {
      const s = initArmySim(world);
      const prov = [...Array(world.provinces.length).keys()]
        .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
      const nation = s.owner[prov];
      const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
      s.armies.push({ prov, nation, men, movedOn: -1 });
      return previewMove(s, prov, nation, target)!;
    };
    const close = mk(Math.ceil(mk(1).def) + 2);   // barely enough
    const rout = mk(100000);                       // overwhelming
    expect(rout.attackerLosses).toBeLessThan(close.attackerLosses);
  });
});

describe("a repelled attack still bleeds the defender (turtling is not free)", () => {
  it("takes losses from the defending army first", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const defender = s.owner[target];
    s.armies.push({ prov, nation, men: 10, movedOn: -1 });            // hopeless attack
    s.armies.push({ prov: target, nation: defender, men: 5000, movedOn: -1 }); // huge garrison
    const r = moveArmy(s, prov, nation, target)!;
    expect(r.won).toBe(false);
    expect(armyAt(s, target, defender)!.men).toBe(5000 - Math.round(10 * DEF_LOSS_MULT));
  });

  // The verdict is now probabilistic (a roll against winChance), so a single fixed turn might have
  // the attack WIN instead of being repelled. Rather than guard the assertions behind `if (!r.won)`
  // (which could silently skip them every run), sweep turns — rebuilding a fresh state each time —
  // until a repelled attack actually happens, so this test always exercises the branch it names.
  it("spills into the population once the garrison is gone, floored at 0", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const base = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => base.owner[p] >= 0 && base.adj[p].some((q) => base.owner[q] >= 0 && base.owner[q] !== base.owner[p]))!;
    const nation = base.owner[prov];
    const target = base.adj[prov].find((q) => base.owner[q] >= 0 && base.owner[q] !== nation)!;
    const defender = base.owner[target];

    let repelled: { s: typeof base; r: NonNullable<ReturnType<typeof moveArmy>> } | null = null;
    for (let turn = 0; turn < 60 && !repelled; turn++) {
      const s = initArmySim(world);
      s.turn = turn;
      s.pop[target] = 1000;
      s.armies.push({ prov: target, nation: defender, men: 2, movedOn: -1 });
      s.armies.push({ prov, nation, men: 100, movedOn: -1 });
      const r = moveArmy(s, prov, nation, target)!;
      if (!r.won) repelled = { s, r };
    }
    expect(repelled).not.toBeNull(); // if this ever fails, the odds/constants shifted — widen the sweep
    const { s } = repelled!;
    const total = Math.round(100 * DEF_LOSS_MULT);
    expect(armyAt(s, target, defender)).toBeUndefined();          // 2-man garrison wiped
    expect(s.pop[target]).toBeCloseTo(1000 - (total - 2), 9);     // remainder off the population
    expect(s.pop[target]).toBeGreaterThanOrEqual(0);
  });
});

describe("goal / outcome (start-fair: you must CONQUER, not merely hold)", () => {
  const fresh = () => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world);

  it("goalGain is round(GOAL_GAIN_FRAC x land)", () => {
    const s = fresh();
    expect(goalGain(s)).toBe(Math.round(GOAL_GAIN_FRAC * landProvinces(s)));
    expect(goalGain(s)).toBeGreaterThan(0);
  });

  it("nobody wins at t0, whatever their size — gain is 0 for every start", () => {
    const s = fresh();
    const counts = new Map<number, number>();
    for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) counts.set(s.owner[p], (counts.get(s.owner[p]) ?? 0) + 1);
    const sizes = [...counts].sort((a, b) => a[1] - b[1]);
    const smallest = sizes[0], largest = sizes[sizes.length - 1];
    expect(outcome(s, smallest[0], smallest[1])).toBeNull();
    expect(outcome(s, largest[0], largest[1])).toBeNull();   // a big start cannot win instantly
  });

  it("needs the full gain: one short is not a win, exactly the gain is", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const other = me === 0 ? 1 : 0;
    const land = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0);
    const start = 2;
    const need = goalGain(s);
    for (const p of land) s.owner[p] = other;
    for (const p of land.slice(0, start + need - 1)) s.owner[p] = me;
    // this fixture rigs almost the whole map onto "other" to isolate MY start-fair goal check;
    // pin its start to that rigged holding so it doesn't look like it just raced to victory itself.
    s.startCounts[other] = provinceCount(s, other);
    expect(outcome(s, me, start)).toBeNull();
    s.owner[land[start + need - 1]] = me;
    expect(outcome(s, me, start)).toEqual({ kind: "victory" });
  });

  it("the same finish line for a small and a large start (start-fair)", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const need = goalGain(s);
    expect(goalProgress(s, me, 3).goal).toBe(need);
    expect(goalProgress(s, me, 18).goal).toBe(need);   // identical requirement
  });

  it("reports a NEGATIVE gain when the realm shrinks below its start", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const held = provinceCount(s, me);
    const prog = goalProgress(s, me, held + 4);
    expect(prog.gained).toBe(-4);
  });

  it("defeat still outranks victory and the horizon", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === me) s.owner[p] = me === 0 ? 1 : 0;
    s.turn = HORIZON + 5;
    expect(outcome(s, me, 1)).toEqual({ kind: "defeat" });
  });

  it("ends at the horizon with a rank", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    s.turn = HORIZON;
    const r = outcome(s, me, provinceCount(s, me));
    expect(r && r.kind).toBe("horizon");
    if (r && r.kind === "horizon") expect(r.of).toBe(nationRank(s, me).of);
  });

  it("nationRank ranks by province count, ties to the lower id, counting only living nations", () => {
    const s = fresh();
    const a = 0, b = 1;
    for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) s.owner[p] = -1 as unknown as number; // clear owners
    // rebuild a tiny world: nation a holds 3, nation b holds 5
    const land = [...Array(s.n).keys()].slice(0, 8);
    for (const p of land.slice(0, 3)) s.owner[p] = a;
    for (const p of land.slice(3, 8)) s.owner[p] = b;
    expect(provinceCount(s, a)).toBe(3);
    expect(provinceCount(s, b)).toBe(5);
    expect(nationRank(s, b)).toEqual({ rank: 1, of: 2 });
    expect(nationRank(s, a)).toEqual({ rank: 2, of: 2 });
  });

  it("nationRank breaks a true tie (equal province counts) toward the lower polity id", () => {
    const s = fresh();
    const lo = 0, hi = 1; // lo has the lower id
    for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) s.owner[p] = -1 as unknown as number; // clear owners
    // both nations hold the SAME number of provinces — a genuine tie, exercising the `a.id - b.id`
    // comparator branch that the pre-existing test (3 vs 5 provinces) never reached.
    const land = [...Array(s.n).keys()].slice(0, 6);
    for (const p of land.slice(0, 3)) s.owner[p] = lo;
    for (const p of land.slice(3, 6)) s.owner[p] = hi;
    expect(provinceCount(s, lo)).toBe(3);
    expect(provinceCount(s, hi)).toBe(3);
    expect(nationRank(s, lo)).toEqual({ rank: 1, of: 2 }); // lower id wins the tie
    expect(nationRank(s, hi)).toEqual({ rank: 2, of: 2 });
  });
});

describe("theater scoping (the board is what you can reach)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("splits the map into land components, deterministically", () => {
    const s = fresh(23);
    const a = landComponents(s), b = landComponents(s);
    expect([...a]).toEqual([...b]);
    expect(a.length).toBe(s.n);
    // seed 23 is island-heavy: more than one component
    expect(new Set([...a]).size).toBeGreaterThan(1);
  });

  it("a theater contains the nation's own land and nothing from another component", () => {
    const s = fresh(23);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const comp = landComponents(s);
    const mask = theaterOf(s, nation);
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const myComp = comp[mine[0]];
    for (let p = 0; p < s.n; p++) expect(mask[p] === 1).toBe(comp[p] === myComp);
    for (const p of mine) expect(mask[p]).toBe(1);
  });

  it("scoping shrinks the land count and therefore the goal", () => {
    const s = fresh(23);
    const wholeMap = landProvinces(s);
    const wholeGoal = goalGain(s);
    const nation = [...s.owner].find((o) => o >= 0)!;
    setTheater(s, nation);
    expect(landProvinces(s)).toBeLessThan(wholeMap);
    expect(goalGain(s)).toBeLessThanOrEqual(wholeGoal);
    expect(goalGain(s)).toBe(Math.round(GOAL_GAIN_FRAC * landProvinces(s)));
  });

  it("counts and ranks only within the theater", () => {
    const s = fresh(23);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const before = provinceCount(s, nation);
    setTheater(s, nation);
    expect(provinceCount(s, nation)).toBe(before);          // my own land is all in my theater
    const { of } = nationRank(s, nation);
    // every ranked nation must actually be inside the theater
    const inTheater = new Set<number>();
    for (let p = 0; p < s.n; p++) if (s.scope![p] === 1 && s.owner[p] >= 0) inTheater.add(s.owner[p]);
    expect(of).toBe(inTheater.size);
  });

  it("playableNations excludes a nation with no reachable rival", () => {
    const s = fresh(23);
    const playable = playableNations(s);
    const all = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    expect(playable.length).toBeGreaterThan(0);
    expect(playable.length).toBeLessThan(all.length);        // seed 23 has stranded nations
    for (const n of playable) {
      const mask = theaterOf(s, n);
      const others = new Set<number>();
      for (let p = 0; p < s.n; p++) if (mask[p] === 1 && s.owner[p] >= 0 && s.owner[p] !== n) others.add(s.owner[p]);
      expect(others.size).toBeGreaterThan(0);                // a rival exists in every offered theater
    }
  });

  it("without a scope everything still counts (pre-scoping behaviour)", () => {
    const s = fresh(11);
    expect(s.scope).toBeUndefined();
    expect(landProvinces(s)).toBeGreaterThan(0);
  });
});

describe("the race (every nation has the same victory condition)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("records every nation's starting size", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))];
    for (const n of nations) expect(s.startCounts[n]).toBe(provinceCount(s, n));
  });

  it("measures a rival's progress from ITS OWN start", () => {
    const s = fresh(11);
    const rival = [...new Set([...s.owner].filter((o) => o >= 0))][1];
    const before = nationProgress(s, rival);
    expect(before.gained).toBe(0);
    expect(before.goal).toBe(goalGain(s));
    // hand the rival one more province
    const victim = [...Array(s.n).keys()].find((p) => s.owner[p] >= 0 && s.owner[p] !== rival)!;
    s.owner[victim] = rival;
    expect(nationProgress(s, rival).gained).toBe(1);
  });

  it("leadingRival names the rival closest to the goal, never the player", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const free = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== rival && s.owner[p] !== me);
    for (const p of free.slice(0, 3)) s.owner[p] = rival;      // rival pulls ahead
    const lead = leadingRival(s, me)!;
    expect(lead.nation).toBe(rival);
    expect(lead.nation).not.toBe(me);
    expect(lead.gained).toBeGreaterThan(0);
  });

  it("the player LOSES when a rival reaches the goal first", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const takeable = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== rival && s.owner[p] !== me);
    for (const p of takeable.slice(0, need)) s.owner[p] = rival;
    const r = outcome(s, me, s.startCounts[me]);
    expect(r).toEqual({ kind: "outpaced", by: rival });
  });

  it("a tie goes to the player: my own victory outranks a rival's", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const pool = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== me && s.owner[p] !== rival);
    for (const p of pool.slice(0, need)) s.owner[p] = rival;          // rival is at the goal
    for (const p of pool.slice(need, need * 2)) s.owner[p] = me;      // and so am I
    expect(outcome(s, me, s.startCounts[me])).toEqual({ kind: "victory" });
  });

  it("my own defeat still outranks everything", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const pool = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== me);
    for (const p of pool.slice(0, need)) s.owner[p] = rival;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === me) s.owner[p] = rival;   // I hold nothing
    expect(outcome(s, me, s.startCounts[me])).toEqual({ kind: "defeat" });
  });
});

describe("aiObjective (the AI wants land worth having)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("picks a province on the nation's frontier, never its own land", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const obj = aiObjective(s, nation);
    expect(obj).toBeGreaterThanOrEqual(0);
    expect(s.owner[obj]).not.toBe(nation);
    const touchesMe = s.adj[obj].some((q) => s.owner[q] === nation);
    expect(touchesMe).toBe(true);
  });

  it("prefers the richer of two equally defended frontier provinces", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    // find two frontier candidates and make one clearly richer, both undefended by armies
    const frontier = [...Array(s.n).keys()].filter((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation));
    expect(frontier.length).toBeGreaterThan(1);
    const [a, b] = frontier;
    // seed 11's frontier has more than two candidates; zero the others' population so a/b's
    // score comparison isn't confounded by some unrelated, naturally richer frontier province.
    for (const p of frontier) if (p !== a && p !== b) s.pop[p] = 0;
    s.armies = s.armies.filter((x) => x.prov !== a && x.prov !== b);
    s.pop[a] = 10; s.pop[b] = 10;
    expect(aiObjective(s, nation)).toBe(Math.min(a, b));   // equal value -> lower id
    s.pop[b] = 400;                                         // now b is far richer
    expect(aiObjective(s, nation)).toBe(b);
  });

  it("returns -1 for a nation with no frontier at all", () => {
    const s = fresh(23);
    // an isolated nation (seed 23 has them): every neighbour of its land is its own
    // Relies on seed 23's world containing at least one nation whose territory touches no other
    // nation's — an island or a bloc sealed by unowned land. If world-gen ever stops producing one
    // for this seed, the toBeDefined below is what fires, and this is why.
    const isolated = [...new Set([...s.owner].filter((o) => o >= 0))]
      .find((n) => {
        for (let p = 0; p < s.n; p++) if (s.owner[p] === n) for (const q of s.adj[p]) if (s.owner[q] !== n) return false;
        return true;
      });
    expect(isolated).toBeDefined();
    expect(aiObjective(s, isolated!)).toBe(-1);
  });

  it("is pure — calling it twice gives the same answer and mutates nothing", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const snap = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    const first = aiObjective(s, nation);
    expect(aiObjective(s, nation)).toBe(first);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(snap);
  });
});

describe("stepToward (deterministic march through your own land)", () => {
  const fresh = () => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);

  it("returns a neighbour of `from` that is owned by the nation and closer to `to`", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    // find a pair of my provinces at distance >= 2 through my own land.
    // Relies on this nation's territory being a connected blob at least three provinces deep in
    // some direction, so a march has a middle step to take. `from` staying -1 is what fires if a
    // world-gen change ever shrinks every nation to a diameter-1 clump.
    let from = -1, to = -1;
    for (const a of mine) for (const b of mine) {
      if (a === b || s.adj[a].includes(b)) continue;
      if (stepToward(s, a, b, nation) >= 0) { from = a; to = b; break; }
      if (from >= 0) break;
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const step = stepToward(s, from, to, nation);
    expect(s.adj[from]).toContain(step);
    expect(s.owner[step]).toBe(nation);
  });

  it("is deterministic and does not mutate", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const snap = JSON.stringify({ o: [...s.owner], a: s.armies });
    const a = stepToward(s, mine[0], mine[mine.length - 1], nation);
    expect(stepToward(s, mine[0], mine[mine.length - 1], nation)).toBe(a);
    expect(JSON.stringify({ o: [...s.owner], a: s.armies })).toBe(snap);
  });

  it("returns -1 when the destination cannot be reached through own land", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const foreign = [...Array(s.n).keys()].find((p) => s.owner[p] >= 0 && s.owner[p] !== nation)!;
    const mine = [...Array(s.n).keys()].find((p) => s.owner[p] === nation)!;
    expect(stepToward(s, mine, foreign, nation)).toBe(-1);
  });
});

describe("the AI concentrates instead of idling", () => {
  it("moves an army that cannot win anything toward the front", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 11 });
    const s = initArmySim(world);
    const player = 0;
    const nation = [...new Set([...s.owner].filter((o) => o >= 0 && o !== player))][0];
    // put a tiny army deep inside the nation's territory, far from any enemy it could beat
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const interior = mine.find((p) => s.adj[p].every((q) => s.owner[q] === nation));
    if (interior === undefined) return;                   // this seed has no interior province; nothing to assert
    s.armies.push({ prov: interior, nation, men: 1, movedOn: -1 });
    aiTurn(s, player);
    // it must not still be sitting where it started doing nothing
    expect(armyAt(s, interior, nation)).toBeUndefined();
  });

  it("still obeys one move per army per turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 11 });
    const s = initArmySim(world);
    const player = 0;
    aiTurn(s, player);
    for (const a of s.armies) if (a.nation !== player) expect(a.movedOn === -1 || a.movedOn === s.turn).toBe(true);
  });
});

describe("raceLeader (the AI can see who is winning)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("picks the nation with the most conquest since its own start, not the biggest nation", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    expect(nations.length).toBeGreaterThan(2);
    // at t0 every nation's `gained` is exactly 0, and conquering nothing is not leading — so there
    // is no leader at all yet. (Falling through to the lowest-id tie-break here would aim the AI's
    // bias at whichever nation happens to hold id 0, for no reason connected to the race.)
    expect(raceLeader(s)).toBe(-1);
    // climber = the SMALLEST nation at t0 (ties -> lower id). Picking it this way, rather than by id,
    // means a size-ranked implementation cannot accidentally agree with the answer below.
    const sizesAtT0 = nations
      .map((n) => ({ n, k: provinceCount(s, n) }))
      .sort((a, b) => a.k - b.k || a.n - b.n);
    const climber = sizesAtT0[0].n;
    const victim = nations.find((n) => n !== climber)!;
    const taken = [...Array(s.n).keys()].find((p) => s.owner[p] === victim)!;
    s.owner[taken] = climber;
    expect(nationProgress(s, climber).gained).toBe(1);
    // unconditional, not "if this happens to be true": the size leader must be someone other than
    // climber, so the next assertion (raceLeader picks climber) actually proves size was not the metric.
    const sizeLeader = nations
      .map((n) => ({ n, k: provinceCount(s, n) }))
      .sort((a, b) => b.k - a.k || a.n - b.n)[0].n;
    expect(sizeLeader).not.toBe(climber);
    expect(raceLeader(s)).toBe(climber);
  });

  it("includes the player — it is not the rival-only question leadingRival answers", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0];
    const taken = [...Array(s.n).keys()].find((p) => s.owner[p] === nations[1])!;
    s.owner[taken] = player;
    expect(raceLeader(s)).toBe(player);                 // the player can be the leader
    expect(leadingRival(s, player)?.nation).not.toBe(player); // leadingRival still excludes them
  });

  it("ignores nations outside the theater", () => {
    const s = fresh(23);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const outsider = nations[nations.length - 1];
    // scope the theater so every province the outsider owns is out, everything else is in
    s.scope = new Uint8Array(s.n);
    for (let p = 0; p < s.n; p++) s.scope[p] = s.owner[p] === outsider ? 0 : 1;
    // Rig the scores so the outsider would WIN if raceLeader's own scope guard were missing.
    // provinceCount already filters by scope independently of raceLeader, so the outsider's in-scope
    // holdings read as 0 either way — give it a NEGATIVE start count of -5, so its `gained` is a
    // strongly positive 5. Give every in-scope nation a `gained` of exactly 1 (start count one below
    // its current holdings), so if the guard were gone and the outsider leaked into the candidate
    // set, its 5 would beat all of them. Positive on both sides is what keeps this discriminating
    // now that a `gained` of 0 no longer counts as leading at all.
    s.startCounts[outsider] = -5;
    for (const n of nations) {
      if (n === outsider) continue;
      s.startCounts[n] = provinceCount(s, n) - 1;
    }
    expect(raceLeader(s)).not.toBe(outsider);
    expect(nations.filter((n) => n !== outsider)).toContain(raceLeader(s));
  });

  it("returns -1 when nobody holds land", () => {
    const s = fresh(11);
    s.owner.fill(-1);
    expect(raceLeader(s)).toBe(-1);
  });

  it("is pure and deterministic — same answer twice, state untouched", () => {
    const s = fresh(11);
    const snap = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    const first = raceLeader(s);
    expect(raceLeader(s)).toBe(first);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(snap);
  });
});

describe("AI_LEADER_BIAS (the AI checks the leader, but never suicides for it)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);
  const frontierOf = (s: ArmyState, nation: number) => [...Array(s.n).keys()]
    .filter((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation));
  const otherNation = (s: ArmyState, nation: number) =>
    [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];

  // `defenceOf` reads armies, population and biome — never `owner`. So reassigning a province's
  // owner changes the bias and NOTHING else, which is what makes these tests exact rather than
  // dependent on some seed's biome layout happening to produce a tie.
  const scoreOf = (s: ArmyState, p: number, nation: number) => s.pop[p] / (1 + defenceOf(s, p, nation));

  it("lifts the leader's province past a rival the AI would otherwise prefer", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const leader = otherNation(s, nation);
    const top = aiObjective(s, nation, -1);
    expect(top).toBeGreaterThanOrEqual(0);
    // a near-miss: loses on raw value, but by less than the bias makes up.
    // Relies on this nation's frontier holding at least two populated provinces whose raw scores
    // are within a factor of AI_LEADER_BIAS of each other — i.e. a frontier that is not one
    // overwhelming prize next to worthless scraps. toBeDefined below is what fires if that changes.
    const runnerUp = frontierOf(s, nation).filter((p) => p !== top)
      .find((p) => scoreOf(s, p, nation) > 0 && scoreOf(s, p, nation) * AI_LEADER_BIAS > scoreOf(s, top, nation));
    expect(runnerUp).toBeDefined();
    s.owner[top] = -1;                 // make sure the leader does not also own the old winner
    s.owner[runnerUp!] = leader;
    expect(aiObjective(s, nation, -1)).toBe(top);           // unbiased: unchanged
    expect(aiObjective(s, nation, leader)).toBe(runnerUp);  // biased: the leader's land wins
  });

  it("does not mistake unowned wasteland for the leader's land when there is no leader", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const top = aiObjective(s, nation, -1);
    // Same structural need as the test above: a runner-up on this nation's frontier close enough
    // that AI_LEADER_BIAS would flip it, so turning it into wasteland is a real temptation.
    const wild = frontierOf(s, nation).filter((p) => p !== top)
      .find((p) => scoreOf(s, p, nation) > 0 && scoreOf(s, p, nation) * AI_LEADER_BIAS > scoreOf(s, top, nation));
    expect(wild).toBeDefined();
    s.owner[wild!] = -1;                              // unowned, scoring just below the winner
    s.owner[top] = otherNation(s, nation);            // owned, so it is not wasteland too
    // owner is -1 for wasteland and raceLeader returns -1 for "nobody". Drop the `leader >= 0`
    // guard from leaderWeight and `wild` wins this. It must not.
    expect(aiObjective(s, nation, -1)).toBe(top);
  });

  it("never turns a fight the AI would decline into one it takes", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const leader = otherNation(s, nation);
    // every neighbour becomes the leader's (maximally attractive) AND unbeatable (militia alone
    // dwarfs anything this nation can raise). The bias must not override the winnability gate.
    for (const p of frontierOf(s, nation)) { s.owner[p] = leader; s.pop[p] = 1e6; }
    // The premise, proved rather than assumed: without it, if `leader` ever stopped being the
    // race leader the bias would go inert and an unbiased AI would decline this fight too — the
    // test would keep passing while silently testing the old, unbiased behaviour.
    expect(raceLeader(s)).toBe(leader);
    const mine = new Set([...Array(s.n).keys()].filter((p) => s.owner[p] === nation));
    // Run the levy step here, exactly as aiTurn does it (most populous first, ties -> lower id), so
    // the force it raises can be snapshotted. aiTurn's own levy then adds nothing: the leviedOn
    // clock refuses a second levy of the same province on the same turn.
    const owned = [...mine].sort((a, b) => (s.pop[b] - s.pop[a]) || (a - b));
    const nLevy = Math.max(1, Math.ceil(owned.length * AI_LEVY_FRAC));
    for (let i = 0; i < nLevy && i < owned.length; i++) levy(s, owned[i], nation);
    // Freeze everyone else's mobilisation as well. At turn 0 no other nation has an army yet, so
    // with the levy clock already spent this turn belongs entirely to `nation` — and the men and
    // province counts below can only move because of what IT did. Left unfrozen, the leader levies
    // the 1e6-population frontier this test just handed it and conquers `nation`'s land, which says
    // nothing about whether the bias overrode the winnability gate.
    s.leviedOn!.fill(s.turn);
    const before = s.armies.filter((a) => a.nation === nation);
    expect(before.length).toBeGreaterThan(0);                       // it did raise troops
    const menBefore = before.reduce((k, a) => k + a.men, 0);
    const provsBefore = provinceCount(s, nation);

    aiTurn(s, -1);

    // Positions alone cannot see a suicide: an army that attacks a 1e6-population neighbour is
    // annihilated by moveArmy's losing branch, so the loop below simply never visits it and any
    // surviving interior army satisfies it vacuously. Missing men cannot hide the same way — a
    // taken fight either destroys the attacker outright or costs it def x WIN_LOSS_MULT x closeness.
    const after = s.armies.filter((a) => a.nation === nation);
    expect(after.reduce((k, a) => k + a.men, 0)).toBe(menBefore);   // no men spent on a battle
    // Not toBe: moveArmy merges an army onto a friendly stack when it arrives, so two armies
    // stepping onto the same front province legitimately shrink the count with no bug present.
    // The men-conservation check above already proves nothing was destroyed — levies are frozen
    // here, so men can only leave through battle, and none did. A drop here just means a merge.
    expect(after.length).toBeLessThanOrEqual(before.length);        // no army wiped out
    expect(provinceCount(s, nation)).toBe(provsBefore);             // and nothing was captured
    for (const a of after) expect(mine.has(a.prov)).toBe(true);
  });

  it("defaults to inert — the third parameter is optional and unbiased", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    expect(AI_LEADER_BIAS).toBeGreaterThan(1);        // 1 would be a no-op lever
    expect(aiObjective(s, nation)).toBe(aiObjective(s, nation, -1));
  });

  it("same seed and the same commands still reproduce the game exactly", () => {
    // A determinism regression test, NOT an order-independence one: two identical runs of identical
    // code agree whether or not aiTurn depends on nation order. The test below is the one with teeth
    // on that question.
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 8; t++) { endTurn(a, 0); endTurn(b, 0); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
    expect(a.armies).toEqual(b.armies);
  });

  // --- the two scoring sites inside aiTurn ---
  //
  // The tests above call aiObjective directly, which leaves both of aiTurn's own uses of the bias
  // unverified: the objective it passes `leader` to, and the per-army fight-target loop. These
  // fixtures drive aiTurn itself.
  //
  // They share one isolation trick, an extension of the one the older aiTurn tests use: strip every
  // province that is not part of the fixture down to owner -1 / pop 0 and park a garrison on it.
  // The garrison belongs to a pseudo-nation that owns no land, so it never appears in aiTurn's
  // nation list and never acts — it is a wall, not a player. That makes those provinces both
  // unbeatable (nothing distracts the army under test) and worth 0 (nothing outbids the fixture).
  const GARRISON = 9999;
  const wallOff = (s: ArmyState, keep: Set<number>) => {
    for (let p = 0; p < s.n; p++) {
      if (keep.has(p)) continue;
      s.owner[p] = -1; s.pop[p] = 0;
      s.armies.push({ prov: p, nation: GARRISON, men: 1e6, movedOn: -1 });
    }
  };
  // startCounts is indexed by polity id and the fixtures use synthetic ids outside the generated
  // world's range, so widen it and state each nation's start outright. Only `leader` is given a
  // positive `gained` — which is now what it takes to be the leader at all.
  const setRace = (s: ArmyState, all: number[], leader: number) => {
    s.startCounts = new Int32Array(GARRISON + 1);
    for (const n of all) s.startCounts[n] = provinceCount(s, n) - (n === leader ? 1 : 0);
  };

  it("aiTurn's fight target prefers the leader's province among fights it could already win", () => {
    const s = fresh(11);
    const nation = 9001, rival = 9002, leader = 9003;
    // Relies on the province graph having a vertex of degree >= 2, so one army faces a real choice
    // of two targets. toBeDefined below is what fires if world-gen ever stops producing one.
    const home = [...Array(s.n).keys()].find((p) => s.adj[p].length >= 2);
    expect(home).toBeDefined();
    const [plain, lead] = [...s.adj[home!]].sort((a, b) => a - b);
    wallOff(s, new Set([home!, plain, lead]));
    s.owner[home!] = nation; s.pop[home!] = 0;   // pop 0 -> maxLevy 0 -> the levy step adds nothing
    s.owner[plain] = rival;  s.pop[plain] = 4;   // floor(4 * MILITIA_FRAC) = 0, so defence is 0 on
    s.owner[lead] = leader;  s.pop[lead] = 3;    // any biome — worth strictly less raw than `plain`
    s.armies.push({ prov: home!, nation, men: 10, movedOn: -1 });
    setRace(s, [nation, rival, leader], leader);
    expect(raceLeader(s)).toBe(leader);

    // BOTH fights clear the winnability gate, so the gate is not what decides this — only the score
    // is. Raw value prefers `plain`; `lead` trails it by less than AI_LEADER_BIAS makes up.
    expect(defenceOf(s, plain, nation)).toBe(0);
    expect(defenceOf(s, lead, nation)).toBe(0);
    expect(scoreOf(s, plain, nation)).toBeGreaterThan(scoreOf(s, lead, nation));
    expect(scoreOf(s, lead, nation) * AI_LEADER_BIAS).toBeGreaterThan(scoreOf(s, plain, nation));

    aiTurn(s, -1);
    expect(s.owner[lead]).toBe(nation);     // the leader's province was taken
    expect(s.owner[plain]).toBe(rival);     // the one worth more on raw value was left alone
  });

  it("aiTurn's objective follows the leader too — and with it the front idle armies march to", () => {
    const s = fresh(11);
    const nation = 9001, rival = 9002, leader = 9003;
    // Relies on the province graph containing an edge x-y where x has a neighbour `a` that y does
    // not touch and y has a neighbour `b` that x does not touch — the shape that makes the OBJECTIVE
    // decide where an army goes: objective `a` puts the front on x (stay put), objective `b` puts it
    // on y (march). toBeDefined below is what fires if no such shape exists.
    let fix: { x: number; y: number; a: number; b: number } | undefined;
    for (let x = 0; x < s.n && !fix; x++) {
      for (const y of [...s.adj[x]].sort((p, q) => p - q)) {
        const nx = new Set(s.adj[x]), ny = new Set(s.adj[y]);
        const a = [...s.adj[x]].sort((p, q) => p - q).find((p) => p !== y && !ny.has(p));
        const b = [...s.adj[y]].sort((p, q) => p - q).find((p) => p !== x && p !== a && !nx.has(p));
        if (a !== undefined && b !== undefined) { fix = { x, y, a, b }; break; }
      }
    }
    expect(fix).toBeDefined();
    const { x, y, a, b } = fix!;
    wallOff(s, new Set([x, y, a, b]));
    s.owner[x] = nation; s.pop[x] = 0;
    s.owner[y] = nation; s.pop[y] = 0;
    s.owner[a] = rival;  s.pop[a] = 4;      // equal raw population: the scores differ only by
    s.owner[b] = leader; s.pop[b] = 4;      // defence, which the garrisons below set exactly
    // Garrison both so NEITHER can be attacked. That forces the army into the march branch, the
    // only path the objective's choice of front can influence. The garrisons are the landless
    // pseudo-nation's, so rival and leader stay armyless and inert despite owning the provinces.
    s.armies.push({ prov: a, nation: GARRISON, men: 1000, movedOn: -1 });
    const dA = defenceOf(s, a, nation);
    // Put b's defence strictly between a's and 1 + 2 x a's: the band where raw value prefers `a`
    // but an AI_LEADER_BIAS of 2 flips the objective to `b`. Solved through the biome multiplier
    // rather than guessed, so no seed's biome layout has to cooperate.
    s.armies.push({ prov: b, nation: GARRISON, men: Math.round(1.4 * dA / (BIOME_DEF[s.world.provinces[b].biome] ?? 1)), movedOn: -1 });
    const dB = defenceOf(s, b, nation);
    expect(dB).toBeGreaterThan(dA);
    expect(dB).toBeLessThan(1 + 2 * dA);
    s.armies.push({ prov: x, nation, men: 10, movedOn: -1 });
    expect(dA).toBeGreaterThanOrEqual(10);  // unwinnable both ways: the army marches, never fights
    setRace(s, [nation, rival, leader], leader);
    expect(raceLeader(s)).toBe(leader);
    expect(aiObjective(s, nation, -1)).toBe(a);
    expect(aiObjective(s, nation, leader)).toBe(b);

    aiTurn(s, -1);
    // objective b -> front y -> the army walks x to y. Objective a -> front x -> it never moves.
    expect(armyAt(s, x, nation)).toBeUndefined();
    expect(armyAt(s, y, nation)?.men).toBe(10);
  });

  it("computes the leader once per turn — a mid-turn capture does not re-aim a later nation", () => {
    // Relies on the province graph containing a province h of degree >= 2 plus an edge p-c wholly
    // outside h's TWO-step neighbourhood. `first` and `later` DO share a border at h's own frontier
    // (that border is the test's readout: whether `later` takes qn from `first`) — what p-c being
    // outside the two-step neighbourhood buys is that `first`'s capture there cannot itself reach
    // anything `later` reads, so any effect on `later`'s choice must be routed through raceLeader.
    // toBeDefined is what fires if no such pair exists.
    const locate = (s: ArmyState) => {
      for (let h = 0; h < s.n; h++) {
        if (s.adj[h].length < 2) continue;
        const near = new Set<number>([h, ...s.adj[h]]);
        for (const q of s.adj[h]) for (const r of s.adj[q]) near.add(r);
        for (let p = 0; p < s.n; p++) {
          if (near.has(p)) continue;
          const c = [...s.adj[p]].sort((u, v) => u - v).find((v) => !near.has(v));
          if (c === undefined) continue;
          const [ql, qn] = [...s.adj[h]].sort((u, v) => u - v);
          return { h, ql, qn, p, c };
        }
      }
      return undefined;
    };
    // first < later in id, so aiTurn processes `first` first. `leader` leads the race when the turn
    // begins; `first` taking c from it hands the lead to `first` partway through the very same turn.
    const first = 9001, later = 9002, leader = 9003;
    const build = () => {
      const s = fresh(11);
      const f = locate(s);
      expect(f).toBeDefined();
      const { h, ql, qn, p, c } = f!;
      wallOff(s, new Set([h, ql, qn, p, c]));
      s.owner[h] = later;   s.pop[h] = 0;
      s.owner[ql] = leader; s.pop[ql] = 3;   // the pre-turn leader's land: lower raw value...
      s.owner[qn] = first;  s.pop[qn] = 4;   // ...than the mid-turn usurper's
      s.owner[p] = first;   s.pop[p] = 0;
      s.owner[c] = leader;  s.pop[c] = 4;    // taking this is what flips the race
      s.armies.push({ prov: p, nation: first, men: 10, movedOn: -1 });
      s.armies.push({ prov: h, nation: later, men: 500, movedOn: -1 });
      setRace(s, [first, later, leader], leader);
      return { s, h, ql, qn, p, c };
    };

    // the premise, proved rather than assumed: `first`'s capture really does move the lead.
    const probe = build();
    expect(raceLeader(probe.s)).toBe(leader);
    probe.s.owner[probe.c] = first;                 // exactly what aiTurn is about to do below
    expect(raceLeader(probe.s)).toBe(first);

    const { s, ql, qn, c } = build();
    // 2 x 3 (the pre-turn leader's) beats 4 (the usurper's); 3 loses to 2 x 4. So `later`'s target
    // is a direct readout of WHICH leader it saw, and the two fights are equally winnable (both
    // defenceless), so the winnability gate is not what decides it.
    expect(defenceOf(s, ql, later)).toBe(0);
    expect(defenceOf(s, qn, later)).toBe(0);

    aiTurn(s, -1);

    expect(s.owner[c]).toBe(first);     // the earlier nation did capture, mid-turn
    expect(s.owner[ql]).toBe(later);    // yet the later one still went for the PRE-TURN leader
    expect(s.owner[qn]).toBe(first);    // not for the nation that had just overtaken it
  });
});
