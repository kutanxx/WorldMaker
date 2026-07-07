import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim } from "./playSim";
import { computeStanding } from "./standing";

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
});
