import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS, calcContestStrength } from "./historySim";

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

  describe("calcContestStrength", () => {
    it("computes identical results to the inlined calculation from stepSim", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
      const s = initSim(world, 5);
      // take a snapshot after one step so solidarity/owner are evolved
      stepSim(s);
      const agg = (() => {
        const a = s.polities.map(() => ({ cells: 0, power: 0, avg: 0 }));
        for (let c = 0; c < s.n; c++) { const o = s.owner[c]; if (o >= 0) { a[o].cells++; a[o].power += s.solidarity[c]; } }
        for (const g of a) g.avg = g.cells > 0 ? g.power / g.cells : 0;
        return a;
      })();

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
        const strength = calcContestStrength({
          polityId: best,
          cellSolidarity: s.solidarity[bestCell],
          cellCount: agg[best].cells,
          avgAsabiyya: agg[best].avg,
          distanceToCapital: Math.hypot(
            s.grid.points[testCell * 2] - s.grid.points[s.capitals[best] * 2],
            s.grid.points[testCell * 2 + 1] - s.grid.points[s.capitals[best] * 2 + 1]
          ),
          economicBonus: s.zoneCells.has(bestCell) ? 0.12 : 0,
        });

        // manually compute the expected strength
        const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002;
        const SIZE_CAP = 24;
        const expected = agg[best].avg * W_ASA + s.solidarity[bestCell] * W_LOCAL + Math.min(Math.sqrt(agg[best].cells), SIZE_CAP) * W_POWER - Math.hypot(
          s.grid.points[testCell * 2] - s.grid.points[s.capitals[best] * 2],
          s.grid.points[testCell * 2 + 1] - s.grid.points[s.capitals[best] * 2 + 1]
        ) * W_DIST + (s.zoneCells.has(bestCell) ? 0.12 : 0);

        expect(strength).toBeCloseTo(expected, 10);
      }
    });
  });
});
