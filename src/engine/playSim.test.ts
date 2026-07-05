import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim, playTurn, playerCells, scorecard, setStance } from "./playSim";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("playSim", () => {
  it("initPlaySim sets the player fields and seeds peakCells", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    expect(s.playerPolity).toBe(0);
    expect(s.stance).toBe("internal");
    expect(s.peakCells).toBe(playerCells(s));
    expect(s.peakCells).toBeGreaterThan(0);
  });

  it("playTurn with no action advances one tick (10 years) and reports the year", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const r = playTurn(s, null);
    expect(r.year).toBe(10);
    expect(r.defeated).toBe(false);
    expect(s.tick).toBe(1);
  });

  it("reports defeat when the player's capital is conquered", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    // force an enemy onto the player's capital cell, then step → conquest eliminates polity 0
    const cap = s.capitals[0];
    const enemy = s.polities.findIndex((_, i) => i !== 0);
    for (const nb of s.grid.neighbors[cap]) s.owner[nb] = enemy;
    s.owner[cap] = enemy;                 // seat already lost
    const r = playTurn(s, null);
    expect(r.defeated).toBe(true);
  });

  it("setStance changes the stance for free", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    setStance(s, "aggressive");
    expect(s.stance).toBe("aggressive");
  });

  it("scorecard ranks the player among living nations", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const sc = scorecard(s);
    expect(sc.cells).toBeGreaterThan(0);
    expect(sc.rank).toBeGreaterThanOrEqual(1);
    expect(sc.rank).toBeLessThanOrEqual(sc.nations);
  });
});
