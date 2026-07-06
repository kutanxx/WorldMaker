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

  it("scorecard reports a defeated player as unranked (rank 0), not mis-ranked past the nation count", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const cap = s.capitals[0];
    const enemy = s.polities.findIndex((_, i) => i !== 0);
    for (const nb of s.grid.neighbors[cap]) s.owner[nb] = enemy;
    s.owner[cap] = enemy;
    const r = playTurn(s, null);
    expect(r.defeated).toBe(true);
    const sc = scorecard(s);
    expect(sc.alive).toBe(false);
    expect(sc.rank).toBe(0);                        // 0 = unranked (was 1 + living-nation count → "7 of 6")
    expect(sc.rank).toBeLessThanOrEqual(sc.nations);
  });

  it("defeat coincides EXACTLY with losing the capital cell (locks the civil-war-keeps-seat invariant)", () => {
    // pick the largest polity so a civil war of the player's realm is likely over the full game
    const { world } = generateWorld({ ...small, seed: 3 });
    const counts = new Map<number, number>();
    for (const o of world.polityOf) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const s = initPlaySim(world, 3, largest, "aggressive");
    for (let t = 0; t < 50; t++) {
      const r = playTurn(s, null);
      // The ONLY way to be defeated is for the seat cell to leave the player's hands (conquest). A
      // civil war of the player keeps the old capital with the original polity id, so it never
      // defeats — if that invariant ever broke, this equality would fail.
      expect(r.defeated).toBe(s.owner[s.capitals[s.playerPolity]] !== s.playerPolity);
      if (r.finished) break;
    }
  });
});
