import { describe, it, expect } from "vitest";
import type { Province } from "./provinces";
import { buildProvinceAdj, initProvinceSim, pAggregate, stepProvinceSim, PROVINCE_SIM_TICKS, type ProvinceSimState } from "./provinceSim";
import { buildSeaLanes } from "./provinceSim";
import { armableTargets, stepPlayerTurn, predictCapture, explainAttack } from "./provinceSim";
import { offerProvinceDilemma, resolveProvinceDilemma } from "./provinceSim";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";

// cells 0,1 → province 0; cell 2 → province 1; cell 3 = ocean (province -1). neighbours 1↔2 make 0,1 adjacent.
const grid = { count: 4, neighbors: [[1], [0, 2], [1, 3], [2]] };
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  { id: 0, name: "A", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4 },
  { id: 1, name: "B", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5 },
];

describe("buildProvinceAdj", () => {
  it("links provinces that share a land border, symmetric, ocean ignored", () => {
    expect(buildProvinceAdj(provinceOf, provinces, grid)).toEqual([[1], [0]]);
  });
  it("gives an isolated province no neighbours", () => {
    const g2 = { count: 3, neighbors: [[1], [0], []] };
    expect(buildProvinceAdj([0, 0, 1], [provinces[0], provinces[1]], g2)).toEqual([[], []]);
  });
});

describe("initProvinceSim (seed 1)", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const s = initProvinceSim(world);
  it("owns one entry per province and starts every nation alive on its own capital province", () => {
    expect(s.n).toBe(world.provinces.length);
    expect(s.provOwner.length).toBe(s.n);
    for (const pol of world.polities) {
      const cap = s.capitalProv[pol.id];
      expect(cap).toBeGreaterThanOrEqual(0);
      expect(s.provOwner[cap]).toBe(pol.id);   // capital province forced to its nation
    }
    expect(s.alive.every(Boolean)).toBe(true);
    expect(s.tick).toBe(0);
  });
  it("seeds owned provinces at SOL_INIT (0.5) and unowned at 0", () => {
    for (let p = 0; p < s.n; p++) {
      expect(s.provSol[p]).toBe(s.provOwner[p] >= 0 ? 0.5 : 0);
    }
  });
  it("builds sea lanes so every capital is reachable over land ∪ lanes", () => {
    // union land adjacency with lane adjacency and flood-fill from each capital; all capitals share one component.
    const lab = new Int32Array(s.n).fill(-1);
    let next = 0;
    for (let s0 = 0; s0 < s.n; s0++) {
      if (lab[s0] >= 0) continue;
      const stack = [s0]; lab[s0] = next;
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of s.adj[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
        for (const v of (s.laneAdj?.[u] ?? [])) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
      }
      next++;
    }
    const capLabels = new Set(world.polities.map((p) => lab[s.capitalProv[p.id]]));
    expect(capLabels.size).toBe(1); // one connected reach-graph across all capitals
    expect(s.laneAdj?.length).toBe(s.n);
  });
});

function fakeState(over: Record<string, unknown> = {}): ProvinceSimState {
  const provinces: Province[] = [
    { id: 0, name: "A", cells: 10, centroid: [0, 0], seedCell: 0, biome: 4 },
    { id: 1, name: "B", cells: 30, centroid: [10, 0], seedCell: 1, biome: 4 },
  ];
  return {
    provinces, n: 2, provOwner: Int32Array.from([0, 0]), provSol: Float32Array.from([0.2, 0.6]),
    adj: [[1], [0]], capitalProv: Int32Array.from([0]), alive: [true], tick: 0, ...over,
  } as ProvinceSimState;
}

describe("pAggregate", () => {
  it("sums cells and averages solidarity weighted by province size", () => {
    const agg = pAggregate(fakeState());
    expect(agg[0].cells).toBe(40);
    // (0.2*10 + 0.6*30) / 40 = 0.5
    expect(agg[0].avg).toBeCloseTo(0.5, 6);
  });
  it("reports 0/0 for a polity that owns nothing", () => {
    const agg = pAggregate(fakeState({ provOwner: Int32Array.from([-1, -1]) }));
    expect(agg[0]).toEqual({ cells: 0, avg: 0 });
  });
});

describe("stepProvinceSim — solidarity", () => {
  // three provinces in a line: 0,1 owned by A(0); 2 owned by B(1). 1 borders 2 (frontier); 0 is interior.
  function line(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 0, 1]), provSol: Float32Array.from([0.5, 0.5, 0.5]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("raises frontier provinces and decays interior ones", () => {
    const s = line();
    stepProvinceSim(s);
    expect(s.provSol[0]).toBeCloseTo(0.5 - 0.02, 5); // interior A province decays
    expect(s.provSol[1]).toBeCloseTo(0.5 + 0.03, 5); // A province bordering B rises
    expect(s.provSol[2]).toBeCloseTo(0.5 + 0.03, 5); // B province bordering A rises
    expect(s.tick).toBe(1);
  });
});

describe("stepProvinceSim — conquest & capital defeat", () => {
  // B(1)'s lone province 1 is its capital and is weak; A(0) is large and cohesive next door → A takes it,
  // eliminating B. A's provinces 0 (capital) and 2 make A big; province 1 is B's only (capital) province.
  function fixture(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 20, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 1, 0]),
      provSol: Float32Array.from([0.9, 0.1, 0.9]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 1]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("flips the whole weak enemy province to the strong aggressor and resets its solidarity", () => {
    const s = fixture();
    stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(0);          // province 1 conquered by A
    expect(s.provSol[1]).toBeCloseTo(0.7, 5); // fresh conquest → CONQUEST_SOL
  });
  it("marks a nation dead once its capital province is taken", () => {
    const s = fixture();
    stepProvinceSim(s);
    expect(s.alive[1]).toBe(false); // B lost its capital province
    expect(s.alive[0]).toBe(true);
  });
});

function fnv(arr: ArrayLike<number>): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arr.length; i++) { h ^= (arr[i] + 1) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function ownerShare(s: { provOwner: Int32Array; provinces: { cells: number }[] }): Map<number, number> {
  const m = new Map<number, number>();
  for (let p = 0; p < s.provOwner.length; p++) { const o = s.provOwner[p]; if (o >= 0) m.set(o, (m.get(o) ?? 0) + s.provinces[p].cells); }
  return m;
}

describe("provinceSim determinism + safety (seed 1)", () => {
  it("pins the seed-1 golden hashes (initial + after 50 ticks) — deterministic, rng-free", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    expect(fnv(s.provOwner)).toBe(226648593); // pinned golden hash — initial state (seed 1)
    for (let t = 0; t < PROVINCE_SIM_TICKS; t++) stepProvinceSim(s);
    expect(s.tick).toBe(PROVINCE_SIM_TICKS);
    expect(fnv(s.provOwner)).toBe(2803010495); // pinned golden hash — after 50 ticks (seed 1) — re-pinned with sea lanes
  });
  it("is not static — the world is contested and dynamic (nations are eliminated, the leader's share shifts)", () => {
    // sea lanes spread aggression across more simultaneous fronts, so a single hegemon growing every seed-1 run
    // is no longer guaranteed (a 20-seed probe still shows a hegemon emerging in most seeds) — what's invariant
    // is that the world keeps moving: the top share changes and at least one nation is always eliminated.
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    const t0 = ownerShare(s);
    const topStart = Math.max(...t0.values());
    const aliveStart = s.alive.filter(Boolean).length;
    for (let t = 0; t < PROVINCE_SIM_TICKS; t++) stepProvinceSim(s);
    const topEnd = Math.max(...ownerShare(s).values());
    const aliveEnd = s.alive.filter(Boolean).length;
    expect(topEnd).not.toBe(topStart);         // the leader's share shifted — not static
    expect(aliveEnd).toBeLessThan(aliveStart); // at least one nation was conquered
  });
  it("does not perturb Version A's world-gen golden hash (fork is isolated)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
  });
});

describe("armableTargets", () => {
  // line: A(0) owns prov 0 (capital) & 1; B(1) owns prov 2 (capital); prov 3 unowned; adj 1-2, 2-3.
  function line(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2, 3].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 4, provOwner: Int32Array.from([0, 0, 1, -1]), provSol: Float32Array.from([0.5, 0.5, 0.5, 0]),
      adj: [[1], [0, 2], [1, 3], [2]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("lists adjacent non-player provinces (enemy) but not the player's own or non-adjacent ones", () => {
    // player = A(0); prov 1 borders enemy prov 2 → armable is [2]; prov 3 (unowned) is not adjacent to A.
    expect(armableTargets(line(), 0)).toEqual([2]);
  });
  it("includes an adjacent unowned province", () => {
    // player = B(1); B's prov 2 borders A's prov 1 AND unowned prov 3 → [1, 3]
    expect(armableTargets(line(), 1)).toEqual([1, 3]);
  });
});

describe("sea lanes — combat & frontier", () => {
  // two lone-nation island provinces, different owners, NOT land-adjacent but lane-linked. Equal strength ⇒
  // no conquest (expedition atk = 0.6·def < 1.03·def), so we can observe the solidarity frontier rule cleanly.
  function islands(over: Record<string, unknown> = {}): ProvinceSimState {
    const provinces: Province[] = [0, 1].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 100, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 2, provOwner: Int32Array.from([0, 1]), provSol: Float32Array.from([0.5, 0.5]),
      adj: [[], []], laneAdj: [[1], [0]], capitalProv: Int32Array.from([0, 1]), alive: [true, true], tick: 0, ...over,
    } as ProvinceSimState;
  }

  it("a province linked to a different owner ONLY by a lane counts as frontier (rises)", () => {
    const s = islands();
    stepProvinceSim(s);
    expect(s.provSol[0]).toBeCloseTo(0.53, 5); // frontier via lane → +SOL_RISE, not interior decay
    expect(s.provSol[1]).toBeCloseTo(0.53, 5);
  });

  it("armableTargets includes a lane-reach enemy with no land border", () => {
    expect(armableTargets(islands(), 0)).toEqual([1]);
  });

  it("explainAttack across a lane flags the expedition and scales attacker strength", () => {
    // make the attacker strong so it would win by land, then confirm the lane penalty is applied + flagged.
    const s = islands({ provSol: Float32Array.from([0.9, 0.1]) });
    const od = explainAttack(s, 0, 1)!;
    expect(od.lane).toBe(true);
    // atk equals the un-penalised strength times EXPEDITION_MULT (0.6): compare to a land-linked twin.
    const land = islands({ provSol: Float32Array.from([0.9, 0.1]), adj: [[1], [0]], laneAdj: [[], []] });
    const landOdds = explainAttack(land, 0, 1)!;
    expect(od.atk).toBeCloseTo(landOdds.atk * 0.6, 5);
    expect(landOdds.lane).toBe(false);
  });

  it("prefers the land route (no penalty) when a target is reachable by BOTH land and lane", () => {
    const both = islands({ adj: [[1], [0]], laneAdj: [[1], [0]] });
    expect(explainAttack(both, 0, 1)!.lane).toBe(false);
  });
});

describe("province dilemmas (rng-free, state-triggered)", () => {
  function st(over: Record<string, unknown> = {}): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2, 3].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 4, provOwner: Int32Array.from([0, 0, 1, 1]), provSol: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
      adj: [[1], [0, 2], [1, 3], [2]], capitalProv: Int32Array.from([0, 3]), alive: [true, true], tick: 0, ...over,
    } as ProvinceSimState;
  }
  it("offers 'restless' for a very shaky owned province", () => {
    expect(offerProvinceDilemma(st({ provSol: Float32Array.from([0.5, 0.15, 0.5, 0.5]) }), 0)).toEqual({ code: "restless", prov: 1 });
  });
  it("offers 'defector' for a low-solidarity adjacent enemy province (not their capital)", () => {
    expect(offerProvinceDilemma(st({ provSol: Float32Array.from([0.5, 0.5, 0.2, 0.5]) }), 0)).toEqual({ code: "defector", prov: 2 });
  });
  it("offers 'muster' periodically when nothing else triggers, else null", () => {
    expect(offerProvinceDilemma(st({ tick: 12 }), 0)).toEqual({ code: "muster", prov: -1 });
    expect(offerProvinceDilemma(st({ tick: 5 }), 0)).toBeNull();
  });
  it("resolve 'restless' A garrisons the province at the capital's expense", () => {
    const s = st({ provSol: Float32Array.from([0.5, 0.15, 0.5, 0.5]) });
    resolveProvinceDilemma(s, 0, { code: "restless", prov: 1 }, "a");
    expect(s.provSol[1]).toBeCloseTo(0.35, 5); // +0.2
    expect(s.provSol[0]).toBeCloseTo(0.45, 5); // capital -0.05
  });
  it("resolve 'defector' A transfers the enemy province to the player (fragile)", () => {
    const s = st({ provSol: Float32Array.from([0.5, 0.5, 0.2, 0.5]) });
    resolveProvinceDilemma(s, 0, { code: "defector", prov: 2 }, "a");
    expect(s.provOwner[2]).toBe(0);
    expect(s.provSol[2]).toBeCloseTo(0.25, 5);
  });
});

describe("stepPlayerTurn determinism + safety (seed 1)", () => {
  // a fixed, deterministic policy: each turn the player (nation 0) attacks EVERY armable province.
  function runPlayerGame() {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    const playerId = 0;
    for (let t = 0; t < PROVINCE_SIM_TICKS && s.alive[playerId]; t++) {
      stepPlayerTurn(s, playerId, new Set(armableTargets(s, playerId)));
    }
    return s;
  }
  it("pins the seed-1 player-path golden hash — deterministic, rng-free", () => {
    const a = runPlayerGame(), b = runPlayerGame();
    expect(fnv(a.provOwner)).toBe(fnv(b.provOwner)); // two runs identical (determinism)
    expect(fnv(a.provOwner)).toBe(2070567107); // pinned golden — seed-1 player-path (all-armable policy); re-pinned at ATTACK_EXHAUST 0.1 — re-pinned with sea lanes
  });
  it("does not perturb Version A's world-gen golden hash (fork is isolated)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
  });
});

describe("stepPlayerTurn", () => {
  // A(0) is big/cohesive (prov 0 capital + prov 1), B(1) holds a lone weak capital prov 2. adj 1-2.
  function fixture(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 20, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 0, 1]), provSol: Float32Array.from([0.9, 0.9, 0.1]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("conquers a targeted weak enemy province for the player and returns the event", () => {
    const s = fixture();
    const ev = stepPlayerTurn(s, 0, new Set([2]));
    expect(s.provOwner[2]).toBe(0);
    expect(s.provSol[2]).toBeCloseTo(0.7, 5); // CONQUEST_SOL
    expect(ev.conquests).toEqual([{ prov: 2, from: 1, to: 0 }]);
    expect(ev.eliminated).toEqual([1]); // B lost its capital province
    expect(s.tick).toBe(1);
  });
  it("does NOT take a beatable enemy province the player did not target (player never auto-initiates)", () => {
    const s = fixture();
    stepPlayerTurn(s, 0, new Set()); // no targets
    expect(s.provOwner[2]).toBe(1); // prov 2 stays B's — player didn't attack, and B isn't attacking itself
    expect(s.alive[1]).toBe(true);
  });
  it("lets an AI nation capture the player's province (player is a valid defender)", () => {
    // swap roles: player = B(1) with the weak lone capital; A(0) is the AI aggressor.
    const s = fixture();
    stepPlayerTurn(s, 1, new Set()); // player B does nothing; AI A auto-contests prov 2
    expect(s.provOwner[2]).toBe(0); // A took the player's capital province
    expect(s.alive[1]).toBe(false); // player B defeated
  });
  it("predictCapture exactly matches what stepPlayerTurn will do (green/red never lies)", () => {
    // A(0) big & cohesive can take B(1)'s weak lone capital province 2 → predict TRUE, and it happens.
    const s1 = fixture();
    expect(predictCapture(s1, 0, 2)).toBe(true);
    stepPlayerTurn(s1, 0, new Set([2]));
    expect(s1.provOwner[2]).toBe(0); // prediction held

    // As weak B(1), attacking A(0)'s adjacent province 1 (B borders it via prov 2) → predict FALSE, and it fails.
    const s2 = fixture();
    expect(predictCapture(s2, 1, 1)).toBe(false);
    stepPlayerTurn(s2, 1, new Set([1]));
    expect(s2.provOwner[1]).toBe(0); // A kept province 1

    // a target the player does not border → null (can't attack): B(1) owns only prov 2, and prov 0 is not
    // adjacent to it (prov 1, owned by A, sits between them).
    expect(predictCapture(fixture(), 1, 0)).toBeNull();
  });
  it("explainAttack reports strengths + the dominant reason, matching the verdict", () => {
    // A(0) strong realm takes B(1)'s weak lone province 2 → win, dominant factor is the realm gap.
    const win = explainAttack(fixture(), 0, 2)!;
    expect(win.win).toBe(true);
    expect(win.atk).toBeGreaterThan(win.def);
    expect(win.reason).toBe("realm-strong");
    // As weak B(1) attacking A(0)'s province 1 → lose, because B's realm is unstable.
    const lose = explainAttack(fixture(), 1, 1)!;
    expect(lose.win).toBe(false);
    expect(lose.reason).toBe("realm-weak");
    // B loses now because its realm is weak — but a fully-cohesive B could take A's prov 1 → breakable.
    expect(lose.breakable).toBe(true);
    // A already wins, so it is trivially breakable too.
    expect(win.breakable).toBe(true);
    // unreachable target → null, same as predictCapture
    expect(explainAttack(fixture(), 1, 0)).toBeNull();
    expect(predictCapture(fixture(), 0, 2)).toBe(true); // predictCapture still agrees with explainAttack.win
  });
  it("consolidate: fortifies only the SELECTED owned provinces, and makes no player attack", () => {
    const plain = fixture(); stepPlayerTurn(plain, 0, new Set());                       // ordinary turn, no attack
    const cons = fixture(); stepPlayerTurn(cons, 0, new Set([0]), { consolidate: true }); // fortify ONLY province 0
    expect(cons.provOwner[2]).toBe(1);                          // consolidate makes no attack
    expect(cons.provSol[0]).toBeGreaterThan(plain.provSol[0]);  // the fortified province is stronger
    expect(cons.provSol[1]).toBeCloseTo(plain.provSol[1], 5);   // an un-selected province is NOT boosted (no free blanket shield)
  });
});

describe("buildSeaLanes — short-hop coastal crossings", () => {
  // 4 land provinces in two pairs separated by a thin sea. Row of cells:
  //   [P0][P0][sea][P1][P1]   (a narrow one-cell strait between P0 and P1)
  //   [P2 far ................ P3]  handled in Task 2; here just P0/P1.
  // grid.points are cell centers; width/height set the spacing reference.
  function strait(): {
    provinceOf: number[]; provinces: import("./provinces").Province[];
    grid: { count: number; neighbors: number[][]; points: number[]; width: number; height: number };
    adj: number[][];
  } {
    // cells: 0,1 => P0 ; 2 => sea(-1) ; 3,4 => P1. neighbours are the line.
    const provinceOf = [0, 0, -1, 1, 1];
    const points = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
    const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3]];
    const grid = { count: 5, neighbors, points, width: 40, height: 10 };
    const provinces = [
      { id: 0, name: "P0", cells: 2, centroid: [5, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "P1", cells: 2, centroid: [35, 0] as [number, number], seedCell: 3, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    return { provinceOf, provinces, grid, adj };
  }

  it("links two coastal provinces across a narrow sea gap", () => {
    const { provinceOf, provinces, grid, adj } = strait();
    expect(adj).toEqual([[], []]); // NOT land-adjacent (sea cell 2 between them)
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1]);
    expect(lanes).toEqual([[1], [0]]); // a lane bridges them
  });

  it("is deterministic (two runs identical)", () => {
    const a = strait(), b = strait();
    expect(buildSeaLanes(a.provinceOf, a.provinces, a.grid, a.adj, [0, 1]))
      .toEqual(buildSeaLanes(b.provinceOf, b.provinces, b.grid, b.adj, [0, 1]));
  });

  it("respects the per-province degree cap", () => {
    // one hub province surrounded by 5 island provinces all within hop range → hub keeps at most LANE_MAX_DEGREE (3).
    // cells: 0 => hub P0 at origin; islands P1..P5 one sea cell away in a ring.
    const provinceOf = [0, -1, 1, 2, 3, 4, 5];
    const points = [0, 0,  0, 5,  10, 0,  0, 10,  -10, 0,  0, -10,  7, 7];
    const neighbors = [[1], [0, 2, 3, 4, 5, 6], [1], [1], [1], [1], [1]];
    const grid = { count: 7, neighbors, points, width: 40, height: 40 };
    const mk = (id: number, x: number, y: number, c: number) =>
      ({ id, name: "P" + id, cells: 1, centroid: [x, y] as [number, number], seedCell: c, biome: 4 });
    const provinces = [mk(0, 0, 0, 0), mk(1, 0, 5, 2), mk(2, 10, 0, 3), mk(3, 0, 10, 4), mk(4, -10, 0, 5), mk(5, 0, -10, 6)];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    // single capital (hub) — this test targets the short-hop degree cap, not the connectivity fallback,
    // so there must be only one capital-bearing component (nothing for the fallback to bridge).
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0]);
    expect(lanes[0].length).toBeLessThanOrEqual(3); // hub capped at LANE_MAX_DEGREE
  });
});

describe("buildSeaLanes — connectivity fallback", () => {
  // Two capitals on land-disconnected islands FAR apart (beyond hop range) still get exactly one lifeline lane.
  // cells: 0 => P0(cap of nation, island A) ; 1 => sea ; ... ; big gap ; N => P1 (island B). No land adjacency.
  function farIslands() {
    const provinceOf = [0, -1, -1, -1, -1, 1];
    const points: number[] = [0, 0, 20, 0, 40, 0, 60, 0, 80, 0, 100, 0];
    const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]];
    const grid = { count: 6, neighbors, points, width: 100, height: 10 };
    const provinces = [
      { id: 0, name: "A", cells: 1, centroid: [0, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "B", cells: 1, centroid: [100, 0] as [number, number], seedCell: 5, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    return { provinceOf, provinces, grid, adj };
  }

  it("bridges land-disconnected capital components even beyond hop range", () => {
    const { provinceOf, provinces, grid, adj } = farIslands();
    // both provinces are >maxHop apart, so the short-hop pass adds nothing; the fallback must still connect them.
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1]);
    expect(lanes).toEqual([[1], [0]]);
  });

  it("adds no fallback lane when capitals already connect by land", () => {
    // one landmass, two provinces adjacent by land → already one component → no lane needed.
    const provinceOf = [0, 0, 1, 1];
    const points: number[] = [0, 0, 10, 0, 20, 0, 30, 0];
    const neighbors = [[1], [0, 2], [1, 3], [2]];
    const grid = { count: 4, neighbors, points, width: 30, height: 10 };
    const provinces = [
      { id: 0, name: "A", cells: 2, centroid: [5, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "B", cells: 2, centroid: [25, 0] as [number, number], seedCell: 2, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    expect(buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1])).toEqual([[], []]);
  });
});
