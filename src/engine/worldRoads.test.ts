import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";

// The world drew no roads, and a town plate's roads left its gates wherever its own streets met the
// wall: the gap between a plate's nearest road out and each of its three nearest towns was a median
// 37 degrees over twelve worlds — 39 for bearings drawn at random. The world now says where each
// town's roads go (see worldRoads.ts).
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const worlds = SEEDS.map((seed) => generateWorld({ ...DEFAULT_PARAMS, seed }).world);

// which landmass each cell is on: a flood over the land
function landmasses(w: (typeof worlds)[number]): Int32Array {
  const terrain = w.terrain as ArrayLike<number>;
  const mass = new Int32Array(w.grid.count).fill(-1);
  let k = 0;
  for (let s = 0; s < w.grid.count; s++) {
    if (terrain[s] === OCEAN || mass[s] >= 0) continue;
    const stack = [s];
    mass[s] = k;
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of w.grid.neighbors[c]) if (terrain[n] !== OCEAN && mass[n] < 0) { mass[n] = k; stack.push(n); }
    }
    k++;
  }
  return mass;
}

describe("the roads between the towns", () => {
  it("run both ways, and only over land", () => {
    for (const w of worlds) {
      const mass = landmasses(w);
      for (const c of w.cities) {
        for (const r of c.roads ?? []) {
          const o = w.cities[r.to];
          expect(o.roads?.some((back) => back.to === c.id), `seed ${w.params.seed}: ${c.id} -> ${o.id} has no way back`).toBe(true);
          expect(mass[o.cell], `seed ${w.params.seed}: a road from ${c.id} to ${o.id} crosses the sea`).toBe(mass[c.cell]);
        }
      }
    }
  });

  it("reach every town on its landmass, and leave no town that has neighbours without one", () => {
    let towns = 0;
    for (const w of worlds) {
      const mass = landmasses(w);
      for (const c of w.cities) {
        const others = w.cities.filter((o) => o !== c && mass[o.cell] === mass[c.cell]);
        if (!others.length) continue;
        towns++;
        // walk the roads from this town: every town on its landmass is reached
        const seen = new Set([c.id]), stack = [c.id];
        while (stack.length) for (const r of w.cities[stack.pop()!].roads ?? []) if (!seen.has(r.to)) { seen.add(r.to); stack.push(r.to); }
        for (const o of others) expect(seen.has(o.id), `seed ${w.params.seed}: no road from ${c.id} reaches ${o.id}`).toBe(true);
      }
    }
    expect(towns).toBeGreaterThan(300);
  });

  it("gives a town a few roads, not one to every town", () => {
    const counts = worlds.flatMap((w) => w.cities.map((c) => c.roads?.length ?? 0)).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    expect(median).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThanOrEqual(3);
    expect(counts[counts.length - 1], "a town with a road to half the map").toBeLessThanOrEqual(7);
  });

  it("leaves each town the way its route runs, which is mostly toward where it goes", () => {
    const gaps: number[] = [];
    for (const w of worlds) for (const c of w.cities) for (const r of c.roads ?? []) {
      const o = w.cities[r.to];
      const straight = Math.atan2(o.y - c.y, o.x - c.x);
      gaps.push(Math.abs(Math.atan2(Math.sin(r.bearing - straight), Math.cos(r.bearing - straight))));
    }
    gaps.sort((a, b) => a - b);
    expect(gaps.length).toBeGreaterThan(500);
    expect(gaps[Math.floor(gaps.length / 2)], "the median road leaves at an angle to its town").toBeLessThan(Math.PI / 8);
  });

  it("is the same road network every time the world is made", () => {
    const again = generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world;
    expect(again.cities.map((c) => c.roads)).toEqual(worlds[2].cities.map((c) => c.roads));
  });
});
