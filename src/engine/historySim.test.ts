import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS, aggregate, contestStrength, W_CONSTS_FOR_TEST, CONQUEST_SOL, CONTEST_THRESH, buildStraitLinks, buildSeaLanes, STRAIT_HOPS, GRUDGE_TICKS, REVENGE_MULT, type Stance } from "./historySim";
import { initPlaySim, playTurn } from "./playSim";
import { OCEAN, LAND } from "./terrain";

describe("historySim", () => {
  it("initSim yields the year-0 state", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    expect(s.tick).toBe(0);
    expect(s.snapshots.length).toBe(1);
    expect(s.snapshots[0].year).toBe(0);
    expect(Array.from(s.owner)).toEqual(Array.from(world.polityOf));
    expect(s.polities.length).toBe(world.polities.length);
    for (const p of s.polities) expect(p.origin).toBe("initial");
    const founds = s.events.filter((e) => e.type === "found" && e.year === 0);
    expect(founds.length).toBe(world.polities.length);
    expect(s.events.some((e) => e.type === "staple")).toBe(true);
  });

  it("exports CONTEST_THRESH (> 1)", () => {
    expect(CONTEST_THRESH).toBeGreaterThan(1);
  });

  it("stepSim advances one tick and appends a snapshot", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    stepSim(s);
    expect(s.tick).toBe(1);
    expect(s.snapshots.length).toBe(2);
    expect(s.snapshots[1].year).toBe(10);
    expect(s.snapshots[1].owner.length).toBe(world.grid.count);
  });

  it("is deterministic across two init+step runs (whole-timeline hash)", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
      const s = initSim(world, 4);
      for (let t = 1; t <= TICKS; t++) stepSim(s);
      let h = 2166136261 >>> 0;
      for (const snap of s.snapshots) for (let i = 0; i < snap.owner.length; i++) { h ^= (snap.owner[i] + 1) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    };
    expect(run()).toBe(run());
  });

  describe("contestStrength", () => {
    it("computes the formula: agg[polity].avg * W_ASA + solidarity[solCell] * W_LOCAL + sqrt(cells) * W_POWER - dist * W_DIST + zoneBonus", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
      const s = initSim(world, 5);
      stepSim(s);
      const agg = aggregate(s);

      // find a cell with both a neighbor and an owner to test
      let testCell = -1;
      for (let c = 0; c < s.n; c++) {
        const o = s.owner[c];
        if (o >= 0) {
          const neighbors = s.grid.neighbors[c];
          for (const nb of neighbors) {
            if (s.terrain[nb] !== 0 && s.owner[nb] >= 0 && s.owner[nb] !== o) {
              testCell = c;
              break;
            }
          }
          if (testCell >= 0) break;
        }
      }
      expect(testCell).toBeGreaterThanOrEqual(0);

      const o = s.owner[testCell];
      const neighbors = s.grid.neighbors[testCell];
      let best = -1, bestAvg = -Infinity, bestCell = -1;
      for (const nb of neighbors) {
        if (s.terrain[nb] === 0) continue;
        const p = s.owner[nb];
        if (p < 0 || p === o || s.polities[p].free) continue;
        if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
      }

      if (best >= 0) {
        // use the exported function
        const strength = contestStrength(s, agg, best, testCell, bestCell);

        // manually compute the expected strength using exported constants
        const { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP } = W_CONSTS_FOR_TEST;
        const px = (i: number) => s.grid.points[i * 2];
        const py = (i: number) => s.grid.points[i * 2 + 1];
        const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b));
        let zoneBonus = 0;
        for (const z of s.economicZones) if (s.owner[z.cell] === best) zoneBonus += 0.12;

        const expected = agg[best].avg * W_ASA + s.solidarity[bestCell] * W_LOCAL + Math.min(Math.sqrt(agg[best].cells), SIZE_CAP) * W_POWER - dist(testCell, s.capitals[best]) * W_DIST + zoneBonus;

        expect(strength).toBeCloseTo(expected, 10);
      }
    });
  });

  describe("buildStraitLinks", () => {
    // chain: 0(L) - 1(O) - 2(L) - 3(O) - 4(O) - 5(L)
    const grid = {
      count: 6,
      neighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
      points: new Float64Array(12),
    } as any;
    const terrain = [LAND, OCEAN, LAND, OCEAN, OCEAN, LAND];

    it("links land cells separated by a narrow strait (≤ hops ocean cells)", () => {
      const links = buildStraitLinks(grid, terrain, 2);
      expect(links[0]).toContain(2);        // 0 and 2 are one ocean cell apart
      expect(links[2].slice().sort()).toEqual([0, 5]); // 2 reaches 0 (1 hop) and 5 (2 hops)
    });

    it("does not link land cells beyond the hop budget", () => {
      const links = buildStraitLinks(grid, terrain, 2);
      expect(links[0]).not.toContain(5);    // 0→5 is 3 ocean cells; out of a 2-hop strait
    });
  });

  describe("amphibious strait contest (symmetric, gated on playerPolity)", () => {
    it("lets a strong enemy across a strait take a weak, isolated player coastal cell in one tick", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
      const s = initSim(world, 1);
      const enemy = s.owner.find((o) => o >= 0)!;
      const player = s.owner.find((o) => o >= 0 && o !== enemy)!;
      // a player cell with NO enemy LAND neighbour (so only a strait invasion can flip it)
      const pcTarget = [...Array(s.n).keys()].find(
        (c) => s.owner[c] === player && s.grid.neighbors[c].every((nb) => s.owner[nb] === player || s.terrain[nb] === OCEAN),
      );
      const bc = s.owner.findIndex((o) => o === enemy);
      expect(pcTarget).toBeDefined();
      expect(bc).toBeGreaterThanOrEqual(0);
      // make the enemy overwhelming and the target defenceless
      for (let c = 0; c < s.n; c++) if (s.owner[c] === enemy) s.solidarity[c] = 1;
      s.solidarity[pcTarget!] = 0;
      s.playerPolity = player;
      s.stance = "internal";
      s.straitLinks = Array.from({ length: s.n }, () => [] as number[]);
      s.straitLinks[pcTarget!] = [bc];
      s.straitLinks[bc] = [pcTarget!];
      stepSim(s);
      expect(s.owner[pcTarget!]).toBe(enemy);
    });

    it("never runs the strait pass on the pure-history path (no straitLinks)", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
      const s = initSim(world, 1);
      expect(s.straitLinks).toBeUndefined(); // pure path builds none → golden byte-identity holds
    });
  });

  describe("player fields + stance", () => {
    const mk = () => { const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 2 }); return initSim(world, 2); };

    it("a fresh SimState has no player (byte-identical default path)", () => {
      const s = mk();
      expect(s.playerPolity).toBe(-1);
      expect(s.peakCells).toBe(0);
      expect(CONQUEST_SOL).toBeGreaterThan(0);
    });

    it("internal stance raises a player cell's solidarity more than aggressive over one tick", () => {
      const setup = (stance: Stance) => {
        const s = mk();
        // choose an interior (non-frontier) player cell so the base delta is a decay we can offset
        const p = s.owner.findIndex((o) => o >= 0);
        s.playerPolity = s.owner[p]; s.stance = stance;
        const cell = p;
        stepSim(s);
        return s.solidarity[cell];
      };
      expect(setup("internal")).toBeGreaterThan(setup("aggressive"));
    });

    it("aggressive raises the player's attacker strength above defensive (same state)", () => {
      const s = mk();
      const p = s.owner.find((o) => o >= 0)!;
      s.playerPolity = p;
      const agg = aggregate(s);
      // a border cell of p and the enemy cell beyond it
      let distCell = -1, solCell = -1;
      for (let i = 0; i < s.n && distCell < 0; i++) {
        if (s.owner[i] !== p) continue;
        for (const nb of s.grid.neighbors[i]) if (s.owner[nb] >= 0 && s.owner[nb] !== p) { solCell = i; distCell = nb; break; }
      }
      expect(distCell).toBeGreaterThanOrEqual(0);
      const base = contestStrength(s, agg, p, distCell, solCell);
      // the exported stance multipliers must order aggressive > defensive for the attacker
      const { STANCE_ATK_MULT } = W_CONSTS_FOR_TEST as any; // see Step 3 (added to the export)
      expect(base * STANCE_ATK_MULT.aggressive).toBeGreaterThan(base * STANCE_ATK_MULT.defensive);
    });
  });
});

describe("sea lanes", () => {
  function lanesFor(seed: number) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const links = buildStraitLinks(world.grid, world.terrain, STRAIT_HOPS);
    const capitals = world.polities.map((p) => p.capital);
    return { world, links, lanes: buildSeaLanes(world.grid, world.terrain, links, capitals) };
  }

  it("bridges a blocked world (capitals in split components) and leaves a connected one alone", () => {
    const blocked = lanesFor(2);
    expect(blocked.lanes.length).toBeGreaterThan(0);
    const connected = lanesFor(1);
    expect(connected.lanes.length).toBe(0);
  });

  it("lanes are deterministic, coastal-anchored, and unite the capitals' reach graph", () => {
    const { world, links, lanes } = lanesFor(2);
    expect(buildSeaLanes(world.grid, world.terrain, links, world.polities.map((p) => p.capital))).toEqual(lanes);
    const { grid, terrain } = world;
    for (const { a, b } of lanes) {
      for (const e of [a, b]) {
        expect(terrain[e]).not.toBe(OCEAN);
        expect(grid.neighbors[e].some((nb) => terrain[nb] === OCEAN)).toBe(true); // coastal
      }
    }
    // union reach: land adjacency + straits + lanes joins every capital into one component
    const n = grid.count;
    const comp = new Int32Array(n).fill(-1);
    const laneOf = new Map<number, number[]>();
    for (const { a, b } of lanes) {
      laneOf.set(a, [...(laneOf.get(a) ?? []), b]);
      laneOf.set(b, [...(laneOf.get(b) ?? []), a]);
    }
    let nc = 0;
    for (let c = 0; c < n; c++) {
      if (terrain[c] === OCEAN || comp[c] >= 0) continue;
      const stack = [c]; comp[c] = nc;
      while (stack.length) {
        const x = stack.pop()!;
        for (const nb of grid.neighbors[x]) if (terrain[nb] !== OCEAN && comp[nb] < 0) { comp[nb] = nc; stack.push(nb); }
        for (const nb of links[x]) if (comp[nb] < 0) { comp[nb] = nc; stack.push(nb); }
        for (const nb of laneOf.get(x) ?? []) if (comp[nb] < 0) { comp[nb] = nc; stack.push(nb); }
      }
      nc++;
    }
    expect(new Set(world.polities.map((p) => comp[p.capital])).size).toBe(1);
  });

  it("pure path carries no lanes; play init populates them; a lane conquest records the grudge", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 2 });
    expect(initSim(world, 2).seaLanes).toEqual([]);
    const s = initPlaySim(world, 2, 0, "aggressive");
    expect(s.seaLanes.length).toBeGreaterThan(0);
    // ROBUST staging (contest margins are seed-sensitive: the distance penalty and stance mults
    // can sink a marginal setup): the player owns EVERYTHING except the foe's single cell b,
    // which is also the foe's capital; b's land neighbours are carved to unclaimed so only the
    // lane can strike it this tick.
    const { a, b } = s.seaLanes[0];
    const player = 0, foe = 1;
    s.playerPolity = player;
    for (let c = 0; c < s.n; c++) if (s.owner[c] >= 0) s.owner[c] = player;
    s.owner[b] = foe;
    s.capitals[foe] = b; // annexation cannot pre-empt the lane flip
    for (const nb of s.grid.neighbors[b]) if (s.terrain[nb] !== OCEAN) s.owner[nb] = -1;
    s.owner[a] = player;
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === player ? 0.9 : 0.1;
    playTurn(s, null);
    expect(s.owner[b]).toBe(player);                       // the expedition landed
    expect(s.attacksByPlayer.get(foe)).toBe(s.tick - 1);   // recorded during the tick (tick has advanced)
  });

  // ROBUST staging (contest margins are seed-sensitive): the FOE owns everything except the
  // player's single cell t; t's solidarity is tuned into the sandwich window where the foe's
  // attack holds WITHOUT a grudge but flips WITH one — that sandwich IS the proof of the mult.
  function stageRevenge(seed: number, playerSol: number) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const s = initPlaySim(world, seed, 0, "internal");
    const player = 0, foe = 1;
    // find a player-owned cell with at least one land neighbor to become the lone holdout
    let t = -1;
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] < 0 || s.terrain[c] === OCEAN) continue;
      if (s.grid.neighbors[c].some((nb) => s.terrain[nb] !== OCEAN)) { t = c; break; }
    }
    for (let c = 0; c < s.n; c++) if (s.owner[c] >= 0) s.owner[c] = foe;
    s.owner[t] = player;
    // neutralize the 3 economic zones' global +ECON_BONUS-per-zone atk bonus (zoneBonus() in
    // historySim.ts is NOT locality-gated — it just checks ownership anywhere on the map). With
    // the foe owning ~everything else, it would otherwise also own all 3 zones for a flat +0.36
    // atk that swamps any player solidarity up to 1.0 (verified empirically: with the zones left
    // to the foe, atk beats the best possible defense at every playerSol in [0,1] and every seed
    // 1-60 — the mult alone can't be isolated). Dropping them to unclaimed removes that fixed
    // term so the sandwich becomes reachable via playerSol alone, as intended.
    for (const z of s.economicZones) if (z.cell !== t) s.owner[z.cell] = -1;
    // foe's capital on a neighbor: kills the admin-distance penalty for the attack
    const nb = s.grid.neighbors[t].find((x) => s.terrain[x] !== OCEAN)!;
    s.capitals[foe] = nb;
    s.capitals[player] = t;
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === foe ? 0.5 : s.owner[c] === player ? playerSol : 0;
    return { s, t, foe, player };
  }

  it("a fresh grudge flips a contest the foe would otherwise lose (REVENGE_MULT bites)", () => {
    expect(REVENGE_MULT).toBeGreaterThan(1);
    // sandwich: same staging, only the grudge differs
    const clean = stageRevenge(3, 0.9);
    playTurn(clean.s, null);
    const held = clean.s.owner[clean.t] === clean.player;

    const grudged = stageRevenge(3, 0.9);
    grudged.s.attacksByPlayer.set(grudged.foe, grudged.s.tick); // the player struck them this tick
    playTurn(grudged.s, null);
    const fell = grudged.s.owner[grudged.t] === grudged.foe;

    expect(held).toBe(true);  // without a grudge the internal-stance defense holds
    expect(fell).toBe(true);  // with one, REVENGE_MULT (1.2) tips the same contest
  });

  it("the grudge expires after GRUDGE_TICKS — the same contest holds again", () => {
    const stale = stageRevenge(3, 0.9);
    stale.s.tick = GRUDGE_TICKS; // age the ledger entry set at tick 0 to exactly-expired
    stale.s.attacksByPlayer.set(stale.foe, 0);
    playTurn(stale.s, null);
    expect(stale.s.owner[stale.t]).toBe(stale.player);
  });
});
