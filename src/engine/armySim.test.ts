import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF, LEVY_FRAC, UPKEEP_FRAC, REGROW_FRAC, MILITIA_FRAC, WIN_LOSS_MULT, DEF_LOSS_MULT, AI_LEVY_FRAC, armyAt, maxLevy, levy, applyUpkeep, regrow, militiaOf, defenceOf, previewMove, moveArmy, aiTurn, endTurn, battleRoll, winChance, ODDS_K, GOAL_GAIN_FRAC, HORIZON, landProvinces, goalGain, goalProgress, provinceCount, nationRank, outcome, landComponents, theaterOf, setTheater, playableNations, nationProgress, leadingRival } from "./armySim";
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

    // find two disjoint (province, adjacent-province) pairs so each army gets its own target
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
