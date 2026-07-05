import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS, aggregate, contestStrength, W_CONSTS_FOR_TEST } from "./historySim";

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
});
