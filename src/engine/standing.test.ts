import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim } from "./playSim";
import { computeStanding, neighborAttitudes, ATT_HOSTILE_RATIO, GRUDGE_TICKS } from "./standing";
import { frontEdges } from "./intervention";
import { aggregate, initSim } from "./historySim";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

// build a controlled two-nation state: player(0) owns [0,pCells), rival(1) owns [pCells, pCells+rCells)
function twoNation(pCells: number, rCells: number, sol = 0.6) {
  const { world } = generateWorld({ ...small, seed: 1 });
  const s = initPlaySim(world, 1, 0, "internal");
  s.alive = s.alive.map((_, i) => i === 0 || i === 1);
  for (let c = 0; c < s.n; c++) {
    s.owner[c] = c < pCells ? 0 : c < pCells + rCells ? 1 : -1;
    s.solidarity[c] = s.owner[c] >= 0 ? sol : 0;
  }
  return s;
}

describe("computeStanding", () => {
  it("reports the player's own cell count and cohesion", () => {
    const s = twoNation(10, 20, 0.7);
    const st = computeStanding(s);
    expect(st.cells).toBe(10);
    expect(Math.round(st.cohesion * 100)).toBe(70);
  });

  it("strength is weak/even/strong vs the living-field average", () => {
    expect(computeStanding(twoNation(10, 20)).strength).toBe("weak");   // 0.5 <= 0.7
    expect(computeStanding(twoNation(10, 10)).strength).toBe("even");   // 1.0
    expect(computeStanding(twoNation(30, 10)).strength).toBe("strong"); // 3.0 >= 1.15
    expect(computeStanding(twoNation(10, 20)).rivalAvgCells).toBe(20);
  });

  it("cohesionState maps by threshold (stable/shaky/danger)", () => {
    expect(computeStanding(twoNation(10, 10, 0.9)).cohesionState).toBe("stable");
    expect(computeStanding(twoNation(10, 10, 0.45)).cohesionState).toBe("shaky");
    expect(computeStanding(twoNation(10, 10, 0.1)).cohesionState).toBe("danger");
  });

  it("counts active truces only (tick still in the future)", () => {
    const s = twoNation(10, 10);
    s.truces.set(1, s.tick + 3);
    s.truces.set(2, s.tick - 1);
    expect(computeStanding(s).truceCount).toBe(1);
  });

  it("guards the no-living-rival case as 'strong'", () => {
    const s = twoNation(10, 0);              // rival owns nothing
    s.alive = s.alive.map((_, i) => i === 0); // player is last standing
    const st = computeStanding(s);
    expect(st.rivalAvgCells).toBe(0);
    expect(st.strength).toBe("strong");
  });

  it("neighborsOnly restricts the average to bordering rivals (0 when isolated)", () => {
    const s = twoNation(10, 0);
    s.alive = s.alive.map((_, i) => i === 0);
    const st = computeStanding(s, { neighborsOnly: true });
    expect(st.borderPolities).toBe(0);
    expect(st.strength).toBe("strong");
  });

  // Real, spatially-generated world (seed 1, small params) where the player (polity 0) naturally
  // borders rival polity 1 across FIVE distinct front-edge cells — i.e. one rival contributing
  // multiple border cells. This is the scenario the cell-counting bug got wrong: it inflated
  // borderPolities to the number of border CELLS instead of distinct bordering polities, and it
  // broke the neighborsOnly filter (which compared polity ids against a set of cell indices).
  it("borderPolities counts distinct bordering polities, not border cells, on a real world", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");

    const edges = frontEdges(s);
    const distinctBorderPolities = new Set(edges.map((e) => s.owner[e.enemy]));

    const st = computeStanding(s);
    expect(st.borderPolities).toBe(distinctBorderPolities.size);
    expect(st.borderPolities).toBe(1); // player only borders rival polity 1, across 5 cells

    // proves the fix: under the old cell-counting behavior, borderPolities would equal
    // edges.length (5), not the distinct-polity count (1). This inequality is what would have
    // FAILED against the pre-fix code (which reported borderPolities === 3, an artifact of
    // counting distinct neighbor cell indices rather than owning polities).
    expect(edges.length).toBeGreaterThan(distinctBorderPolities.size);
  });

  it("neighborsOnly averages over only the bordering polities on a real world (and can differ from the whole-field default)", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");

    const edges = frontEdges(s);
    const borderPolities = [...new Set(edges.map((e) => s.owner[e.enemy]))];
    expect(borderPolities).toEqual([1]); // sanity: matches this seed's fixed world

    // independently derive the expected bordering-only average from the same per-cell ownership
    // data the engine works from (not by calling computeStanding, to avoid circularity)
    const agg = aggregate(s);
    const expectedNeighborAvg =
      borderPolities.reduce((sum, o) => sum + agg[o].cells, 0) / borderPolities.length;

    const stNeighbors = computeStanding(s, { neighborsOnly: true });
    const stDefault = computeStanding(s);

    expect(stNeighbors.rivalAvgCells).toBe(expectedNeighborAvg);

    // whole-field default includes non-bordering living rivals (polities 2-7 also survive in this
    // world), so it must differ from the neighbors-only figure.
    expect(stDefault.rivalAvgCells).not.toBe(stNeighbors.rivalAvgCells);
  });
});

describe("neighborAttitudes", () => {
  function playerState(seed: number) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const s = initSim(world, seed);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return s;
  }

  it("truce ⇒ friendly (the engine literally skips their attacks); strength ⇒ hostile; else wary", () => {
    const s = playerState(1);
    const atts = neighborAttitudes(s);
    expect(atts.length).toBeGreaterThan(0);
    for (const a of atts) {
      if (a.truceLeft > 0) expect(a.att).toBe("friendly");
      else if (a.ratio >= ATT_HOSTILE_RATIO || a.hegemon) expect(a.att).toBe("hostile");
      else expect(a.att).toBe("wary");
    }
    // force a truce with the most-bordering rival and re-derive
    s.truces.set(atts[0].id, s.tick + 3);
    const after = neighborAttitudes(s).find((a) => a.id === atts[0].id)!;
    expect(after.att).toBe("friendly");
    expect(after.truceLeft).toBe(3);
  });

  it("the flagged crisis hegemon is hostile regardless of ratio; sorted by border pressure; read-only", () => {
    const s = playerState(1);
    const base = neighborAttitudes(s);
    const target = base.find((a) => a.truceLeft === 0)!;
    s.dilemmaFlags.add(`hegemonFoe:${target.id}`);
    const owner = [...s.owner];
    const atts = neighborAttitudes(s);
    expect(atts.find((a) => a.id === target.id)!.att).toBe("hostile");
    expect(atts.find((a) => a.id === target.id)!.hegemon).toBe(true);
    for (let i = 1; i < atts.length; i++) expect(atts[i - 1].borderEdges).toBeGreaterThanOrEqual(atts[i].borderEdges);
    expect([...s.owner]).toEqual(owner); // no mutation
  });

  it("a fresh attack makes even a weaker neighbor hostile; the grudge decays; truce still wins", () => {
    const s = playerState(1);
    const weaker = neighborAttitudes(s).find((a) => a.att === "wary");
    expect(weaker).toBeDefined();
    if (!weaker) return;
    s.attacksOnPlayer.set(weaker.id, s.tick);
    let a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.attackedMeAgo).toBe(0);
    expect(a.att).toBe("hostile"); // proven contest superiority beats a small ratio
    // decay: GRUDGE_TICKS later it is forgotten
    s.tick += GRUDGE_TICKS;
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.attackedMeAgo).toBeNull();
    expect(a.att).toBe("wary");
    // truce overrides a fresh grudge (the engine literally blocks their attacks)
    s.attacksOnPlayer.set(weaker.id, s.tick);
    s.truces.set(weaker.id, s.tick + 2);
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.att).toBe("friendly");
    // my own attacks display but never flip attitude
    s.truces.delete(weaker.id);
    s.attacksOnPlayer.delete(weaker.id);
    s.attacksByPlayer.set(weaker.id, s.tick);
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.iAttackedAgo).toBe(0);
    expect(a.att).toBe("wary");
  });
});
