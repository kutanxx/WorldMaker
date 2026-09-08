import { describe, it, expect } from "vitest";
import { chainRoads } from "./roads";
import type { Polyline } from "../geometry";

const ends = (r: Polyline) => [r[0], r[r.length - 1]].map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).sort().join(" -> ");
const run = (a: number[], b: number[]) => [a, b].map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).sort().join(" -> ");
const turnAt = (a: number[], b: number[], c: number[]) => {
  const a1 = Math.atan2(a[1] - b[1], a[0] - b[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  return 180 - (Math.PI - Math.abs(Math.abs(a1 - a2) - Math.PI)) * 180 / Math.PI;
};

describe("main roads are runs, not a heap of segments", () => {
  it("joins segments that meet end to end into one road", () => {
    const segs: Polyline[] = [[[0, 0], [10, 0]], [[10, 0], [20, 1]], [[20, 1], [30, 3]]];
    const out = chainRoads(segs);
    expect(out.length).toBe(1);
    expect(ends(out[0])).toBe(run([0, 0], [30, 3]));
  });

  it("carries straight on through a junction instead of turning off it", () => {
    // a crossroads: the run from the west should leave to the east, not up the side street
    const segs: Polyline[] = [
      [[0, 0], [10, 0]], [[10, 0], [20, 0]],      // the through road
      [[10, 0], [10, 10]],                        // a side street off the middle of it
    ];
    const out = chainRoads(segs);
    expect(out.map(ends), "the straight run should be kept whole").toContain(run([0, 0], [20, 0]));
    expect(out.map(ends), "and the side street left as its own road").toContain(run([10, 0], [10, 10]));
  });

  it("drops a stretch that is drawn on top of a longer one", () => {
    // a gate stub laid along an existing street: 25% of stubs did this, and the doubled line put a
    // road cap in the middle of another road and a 180-degree "turn" in the network
    const segs: Polyline[] = [[[0, 0], [60, 0]], [[0, 0], [14, 0]]];
    const out = chainRoads(segs);
    expect(out.length).toBe(1);
    expect(ends(out[0])).toBe(run([0, 0], [60, 0]));
  });

  it("eases the corner where a run turns, without leaving the corridor", () => {
    const segs: Polyline[] = [[[0, 0], [20, 0]], [[20, 0], [40, 20]]];
    const out = chainRoads(segs);
    const road = out[0];
    // the sharp 45-degree corner is replaced by a shorter turn, and the ends are where they were
    expect(ends(road)).toBe(run([0, 0], [40, 20]));
    let worst = 0;
    for (let i = 1; i < road.length - 1; i++) worst = Math.max(worst, turnAt(road[i - 1], road[i], road[i + 1]));
    expect(worst).toBeLessThan(45);
    // and it never wanders far from the line it replaces
    for (const p of road) {
      const d = Math.min(
        Math.abs(p[1]),                                    // distance to the first leg
        Math.abs((p[0] - 20) - (p[1] - 0)) / Math.SQRT2,   // distance to the second
      );
      expect(d).toBeLessThan(4);
    }
  });
});
