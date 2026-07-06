import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, aggregate, contestStrength, CONQUEST_SOL, CITY_MIN_GAP, CITY_SOL_FLOOR, CITY_POWER_BONUS } from "./historySim";
import { OCEAN } from "./terrain";
import { borderTargets, applyIntervention, frontEdges, foundCityTargets, INVEST_DELTA, ATTACK_FOLLOW_MAX } from "./intervention";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
function playerState(seed: number) {
  const { world } = generateWorld({ ...small, seed });
  const s = initSim(world, seed);
  s.playerPolity = s.owner.find((o) => o >= 0)!; // the first owned polity
  return s;
}
// the polity with the most cells (guarantees interior cells for border-scope tests)
function biggestPlayerState(seed: number) {
  const { world } = generateWorld({ ...small, seed });
  const s = initSim(world, seed);
  const counts = new Map<number, number>();
  for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
  s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return s;
}

describe("borderTargets", () => {
  it("lists only enemy land cells adjacent to the player, none owned by the player", () => {
    const s = playerState(1);
    const ts = borderTargets(s);
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(s.owner[t.cell]).not.toBe(s.playerPolity);
      expect(s.owner[t.cell]).toBeGreaterThanOrEqual(0);
      const adj = s.grid.neighbors[t.cell].some((nb) => s.owner[nb] === s.playerPolity);
      expect(adj).toBe(true);
    }
  });
});

describe("applyIntervention attack", () => {
  it("captures a border cell when the player's edge wins, flips owner + resets solidarity", () => {
    const s = playerState(1);
    // make the player overwhelming so at least one target is capturable
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const target = borderTargets(s).find((t) => t.capturable)!;
    expect(target).toBeTruthy();
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("captured");            // land capture code (vs "landed" for amphibious)
    expect(r.data!.name).toBe(s.polities[target.owner].name);
    expect(s.owner[target.cell]).toBe(s.playerPolity);
    expect(s.solidarity[target.cell]).toBeCloseTo(CONQUEST_SOL, 6);
  });

  it("repulses when the defender is stronger (owner unchanged)", () => {
    const s = playerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0; // weak player
    const target = borderTargets(s)[0];
    const before = s.owner[target.cell];
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(false);
    expect(s.owner[target.cell]).toBe(before);
  });

  it("rejects a non-border or own cell", () => {
    const s = playerState(1);
    const own = s.owner.findIndex((o) => o === s.playerPolity);
    expect(applyIntervention(s, { type: "attack", cell: own }).ok).toBe(false);
  });
});

describe("amphibious attack across a strait", () => {
  // wire a strait link between a player cell and an enemy cell not reachable over land
  function straitScenario(seed: number) {
    const s = biggestPlayerState(seed);
    const pc = s.owner.findIndex((o) => o === s.playerPolity);
    const ec = [...Array(s.n).keys()].find(
      (c) => s.owner[c] >= 0 && s.owner[c] !== s.playerPolity && s.grid.neighbors[c].every((nb) => s.owner[nb] !== s.playerPolity),
    )!;
    s.straitLinks = Array.from({ length: s.n }, () => [] as number[]);
    s.straitLinks[pc] = [ec];
    s.straitLinks[ec] = [pc];
    return { s, pc, ec };
  }

  it("borderTargets lists a strait-reachable enemy cell as a sea target", () => {
    const { s, ec } = straitScenario(1);
    const t = borderTargets(s).find((x) => x.cell === ec);
    expect(t).toBeTruthy();
    expect(t!.sea).toBe(true);
  });

  it("captures a strait-linked enemy cell when the player's edge wins", () => {
    const { s, ec } = straitScenario(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1; // overwhelming
    const r = applyIntervention(s, { type: "attack", cell: ec });
    expect(r.ok).toBe(true);
    expect(s.owner[ec]).toBe(s.playerPolity);
  });

  it("rejects an enemy cell that is neither land-adjacent nor strait-reachable", () => {
    const s = biggestPlayerState(1); // no straitLinks, and pick a deep enemy cell
    const far = [...Array(s.n).keys()].find(
      (c) => s.owner[c] >= 0 && s.owner[c] !== s.playerPolity && s.grid.neighbors[c].every((nb) => s.owner[nb] !== s.playerPolity),
    )!;
    expect(applyIntervention(s, { type: "attack", cell: far }).ok).toBe(false);
  });
});

describe("attack breakthrough (follow-on capture)", () => {
  it("an overwhelming attack also captures weak same-owner neighbours, capped at 1+ATTACK_FOLLOW_MAX", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
      else if (s.owner[c] >= 0) s.solidarity[c] = 0; // defenceless enemies
    }
    const target = borderTargets(s).find((t) => t.capturable && !t.sea)!;
    expect(target).toBeTruthy();
    const before = new Set<number>();
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) before.add(c);
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(true);
    let gained = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity && !before.has(c)) gained++;
    expect(gained).toBe(Number(r.data!.n));
    expect(gained).toBeGreaterThanOrEqual(1);
    expect(gained).toBeLessThanOrEqual(1 + ATTACK_FOLLOW_MAX);
    // follow-ons only ever come adjacent to the target, with fresh-conquest cohesion
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity && !before.has(c) && c !== target.cell) {
        expect(s.grid.neighbors[target.cell]).toContain(c);
        expect(s.solidarity[c]).toBeCloseTo(CONQUEST_SOL, 6);
      }
    }
  });

  it("reports the captured count in data.n (at least the picked cell)", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const target = borderTargets(s).find((t) => t.capturable && !t.sea)!;
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(true);
    expect(Number(r.data!.n)).toBeGreaterThanOrEqual(1);
  });
});

describe("applyIntervention invest", () => {
  it("nation scope raises solidarity on every player cell by INVEST_DELTA", () => {
    const s = playerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.5;
    const r = applyIntervention(s, { type: "invest", scope: "nation" });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("invested");            // localisable outcome code + data (for KO/EN log)
    expect(r.data!.scope).toBe("nation");
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) expect(s.solidarity[c]).toBeCloseTo(0.5 + INVEST_DELTA, 6);
    }
  });

  it("clamps invested solidarity at 1", () => {
    const s = playerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.95;
    applyIntervention(s, { type: "invest", scope: "nation" });
    const some = s.owner.findIndex((o) => o === s.playerPolity);
    expect(s.solidarity[some]).toBeCloseTo(1, 6);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) expect(s.solidarity[c]).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("border scope raises a frontier cell but leaves a deep interior cell untouched", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.5;
    const interior = [...Array(s.n).keys()].find(
      (c) => s.owner[c] === s.playerPolity && s.grid.neighbors[c].every((nb) => s.owner[nb] === s.playerPolity),
    );
    const border = [...Array(s.n).keys()].find(
      (c) =>
        s.owner[c] === s.playerPolity &&
        s.grid.neighbors[c].some((nb) => s.owner[nb] !== s.playerPolity && s.terrain[nb] !== OCEAN),
    );
    expect(interior).toBeDefined();
    expect(border).toBeDefined();
    applyIntervention(s, { type: "invest", scope: "border" });
    expect(s.solidarity[interior!]).toBeCloseTo(0.5, 6);
    expect(s.solidarity[border!]).toBeCloseTo(0.5 + INVEST_DELTA, 6);
  });
});

describe("foundCity", () => {
  // CITY_MIN_GAP is sized for the real 1000×1000 map — the 300×300 test world has no room,
  // so these tests use a full-size world (generated once, initSim per test is cheap)
  const { world: bigWorld } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  function bigPlayerState() {
    const s = initSim(bigWorld, 1);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return s;
  }
  const cellDist = (s: ReturnType<typeof playerState>, a: number, b: number) =>
    Math.hypot(s.grid.points[a * 2] - s.grid.points[b * 2], s.grid.points[a * 2 + 1] - s.grid.points[b * 2 + 1]);

  it("initSim defaults: empty foundedCities and truces (golden guard)", () => {
    const s = playerState(1);
    expect(s.foundedCities.size).toBe(0);
    expect(s.truces.size).toBe(0);
  });

  it("targets are player-owned and respect CITY_MIN_GAP from existing cities", () => {
    const s = bigPlayerState();
    const ts = foundCityTargets(s);
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(s.owner[t.cell]).toBe(s.playerPolity);
      for (const c of s.cityCells) expect(cellDist(s, t.cell, c.cell)).toBeGreaterThanOrEqual(CITY_MIN_GAP);
    }
  });

  it("founding adds an anchor + a newCity event; too-close site is rejected", () => {
    const s = bigPlayerState();
    const t = foundCityTargets(s)[0];
    const before = s.events.length;
    const r = applyIntervention(s, { type: "foundCity", cell: t.cell });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("founded");
    expect(String(r.data!.name).length).toBeGreaterThan(0);
    expect(s.foundedCities.has(t.cell)).toBe(true);
    expect(s.events.length).toBe(before + 1);
    expect(s.events[before].type).toBe("newCity");
    // second founding on the SAME cell: now too close to the new city
    expect(applyIntervention(s, { type: "foundCity", cell: t.cell }).ok).toBe(false);
  });

  it("anchor floors the cell's solidarity while owned; a captured anchor stays in the set", () => {
    const s = bigPlayerState();
    const t = foundCityTargets(s)[0];
    applyIntervention(s, { type: "foundCity", cell: t.cell });
    s.solidarity[t.cell] = 0.1;
    stepSim(s);
    if (s.owner[t.cell] === s.playerPolity) expect(s.solidarity[t.cell]).toBeGreaterThanOrEqual(CITY_SOL_FLOOR);
    // captured anchor goes inert but the city still exists in the tally
    const s2 = bigPlayerState();
    const t2 = foundCityTargets(s2)[0];
    applyIntervention(s2, { type: "foundCity", cell: t2.cell });
    const other = s2.polities.find((p) => p.id !== s2.playerPolity && s2.alive[p.id])!;
    s2.owner[t2.cell] = other.id;
    stepSim(s2);
    expect(s2.foundedCities.has(t2.cell)).toBe(true);
  });

  it("anchor adds CITY_POWER_BONUS to the player's contest strength at the cell", () => {
    const s = bigPlayerState();
    const t = foundCityTargets(s)[0];
    const agg = aggregate(s);
    const before = contestStrength(s, agg, s.playerPolity, t.cell, t.cell);
    applyIntervention(s, { type: "foundCity", cell: t.cell });
    const after = contestStrength(s, agg, s.playerPolity, t.cell, t.cell);
    expect(after).toBeCloseTo(before + CITY_POWER_BONUS, 6);
  });
});

describe("frontEdges", () => {
  it("an overwhelming player yields only push edges at capturable enemy cells", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const edges = frontEdges(s);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(s.owner[e.cell]).toBe(s.playerPolity);
      expect(s.owner[e.enemy]).toBeGreaterThanOrEqual(0);
      expect(s.owner[e.enemy]).not.toBe(s.playerPolity);
      expect(s.terrain[e.enemy]).not.toBe(OCEAN);
    }
    expect(edges.some((e) => e.kind === "threat")).toBe(false);
  });

  it("a defenceless player against strong enemies yields threat edges on its own border", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0;
      else if (s.owner[c] >= 0) s.solidarity[c] = 1;
    }
    const edges = frontEdges(s);
    const threats = edges.filter((e) => e.kind === "threat");
    expect(threats.length).toBeGreaterThan(0);
    for (const e of threats) expect(s.owner[e.cell]).toBe(s.playerPolity);
  });
});
