import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";

// The world's roads stop at the shore: an island town had no way to anywhere (its "Nearby" pointed at
// the three nearest towns as the crow flies), and a road round a gulf was the only way across it. Ships
// sail where the sea is the better way (see seaRoutes.ts) — the rule the reader chose from a preview of
// two, over the other that joined every port to its sea neighbours and wound dashed loops round islands.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const made = SEEDS.map((seed) => generateWorld({ ...DEFAULT_PARAMS, seed }));
const worlds = made.map((m) => m.world);

// the shortest way between two towns over the roads, by road length (Infinity where none reaches)
function byRoad(w: (typeof worlds)[number], from: number, to: number): number {
  const dist = new Map<number, number>([[from, 0]]);
  const open = new Set([from]);
  while (open.size) {
    let u = -1;
    for (const x of open) if (u < 0 || dist.get(x)! < dist.get(u)!) u = x;
    open.delete(u);
    for (const r of w.roads) {
      if (r.a !== u && r.b !== u) continue;
      const o = r.a === u ? r.b : r.a, d = dist.get(u)! + r.length;
      if (d < (dist.get(o) ?? Infinity)) { dist.set(o, d); open.add(o); }
    }
  }
  return dist.get(to) ?? Infinity;
}

describe("the sea routes between the ports", () => {
  it("sail between two ports, once for the pair", () => {
    let routes = 0;
    for (const w of worlds) {
      expect(Array.isArray(w.seaRoutes), `seed ${w.params.seed} keeps no sea routes`).toBe(true);
      const pairs = new Set<string>();
      for (const s of w.seaRoutes) {
        const tag = `seed ${w.params.seed}: ${s.a}-${s.b}`;
        expect(s.a, tag).toBeLessThan(s.b);
        expect(w.cities[s.a].coastal && w.cities[s.b].coastal, `${tag} joins a town that is no port`).toBe(true);
        pairs.add(`${s.a}-${s.b}`);
        routes++;
      }
      expect(pairs.size, `seed ${w.params.seed}: a route listed twice`).toBe(w.seaRoutes.length);
    }
    // measured when the rule was chosen: 40 over the twelve worlds, 5 in world 1 and 9 in world 11
    expect(routes).toBe(40);
    expect(worlds[0].seaRoutes.length).toBe(5);
    expect(worlds[10].seaRoutes.length).toBe(9);
  });

  it("run from one port to the other, and know how long the voyage is", () => {
    for (const w of worlds) for (const s of w.seaRoutes) {
      const tag = `seed ${w.params.seed}: ${s.a}-${s.b}`;
      const [first, last] = [s.points[0], s.points[s.points.length - 1]];
      expect(first, tag).toEqual([w.cities[s.a].x, w.cities[s.a].y]);
      expect(last, tag).toEqual([w.cities[s.b].x, w.cities[s.b].y]);
      let along = 0;
      for (let k = 0; k + 1 < s.points.length; k++) along += Math.hypot(s.points[k + 1][0] - s.points[k][0], s.points[k + 1][1] - s.points[k][1]);
      expect(s.length, tag).toBeCloseTo(along, 9);
    }
  });

  // The way through the sea's cell centres runs half a cell off the shore and drew a dotted second
  // coastline; the course is pulled straight, but never over the land.
  it("sail over the water, in straight legs between headlands", () => {
    let legs = 0, cells = 0;
    made.forEach(({ world: w, find }) => {
      for (const s of w.seaRoutes) {
        const ends = new Set([w.cities[s.a].cell, w.cities[s.b].cell]);
        for (let k = 0; k + 1 < s.points.length; k++) {
          const [x1, y1] = s.points[k], [x2, y2] = s.points[k + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
          for (let i = 0; i <= n; i++) {
            const c = find(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n);
            expect(w.terrain[c] === OCEAN || ends.has(c), `seed ${w.params.seed}: ${s.a}-${s.b} crosses land at leg ${k}`).toBe(true);
          }
          legs++;
        }
        cells += s.points.length;
      }
    });
    expect(legs).toBeGreaterThan(40);
    // straight legs: far fewer turns than the cells the way was measured over
    expect(cells / legs).toBeLessThan(3);
  });

  it("are taken only where no road goes, or the road is more than half as long again", () => {
    for (const w of worlds) for (const s of w.seaRoutes) {
      expect(byRoad(w, s.a, s.b), `seed ${w.params.seed}: ${s.a}-${s.b}`).toBeGreaterThan(1.5 * s.length);
    }
  });

  it("reach every port no road leaves", () => {
    let lone = 0;
    for (const w of worlds) for (const c of w.cities) {
      if (c.roads?.length || !c.coastal) continue;
      lone++;
      expect(w.seaRoutes.some((s) => s.a === c.id || s.b === c.id), `seed ${w.params.seed}: port ${c.id} has no way anywhere`).toBe(true);
    }
    expect(lone, "no port without a road to try").toBeGreaterThan(0);
  });

  it("are the same routes every time the world is made", () => {
    expect(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world.seaRoutes).toEqual(worlds[10].seaRoutes);
  });
});
