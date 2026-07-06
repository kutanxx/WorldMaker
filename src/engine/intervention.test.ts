import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, CONQUEST_SOL } from "./historySim";
import { OCEAN } from "./terrain";
import { borderTargets, applyIntervention, INVEST_DELTA } from "./intervention";

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
