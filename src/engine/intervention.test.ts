import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, CONQUEST_SOL } from "./historySim";
import { borderTargets, applyIntervention } from "./intervention";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
function playerState(seed: number) {
  const { world } = generateWorld({ ...small, seed });
  const s = initSim(world, seed);
  s.playerPolity = s.owner.find((o) => o >= 0)!; // the first owned polity
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
