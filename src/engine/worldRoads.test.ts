import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { roadsInUse } from "./worldRoads";
import { simulateHistory } from "./history";

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
    expect(again.roads).toEqual(worlds[2].roads);
  });
});

// The world knew where each road went and which way it left, and threw the way itself away, so the
// map could not draw a single one: 344 roads over twelve worlds, none on the map. It keeps each road
// now, once for the pair, along the cells it was measured over.
describe("each road, once, along the way it was measured", () => {
  const at = (w: (typeof worlds)[number], c: number) => [w.grid.points[c * 2], w.grid.points[c * 2 + 1]];

  it("lists every road between two towns once, and no other", () => {
    for (const w of worlds) {
      expect(Array.isArray(w.roads), `seed ${w.params.seed} keeps no roads`).toBe(true);
      const pairs = new Set(w.cities.flatMap((c) => (c.roads ?? []).filter((r) => c.id < r.to).map((r) => `${c.id}-${r.to}`)));
      const listed = w.roads.map((r) => `${r.a}-${r.b}`);
      expect(new Set(listed).size, `seed ${w.params.seed}: a road listed twice`).toBe(listed.length);
      expect(new Set(listed), `seed ${w.params.seed}`).toEqual(pairs);
    }
  });

  it("runs from one town's cell to the other's, cell to neighbouring cell, over land", () => {
    for (const w of worlds) for (const r of w.roads) {
      const tag = `seed ${w.params.seed}: road ${r.a}-${r.b}`;
      expect(r.cells[0], tag).toBe(w.cities[r.a].cell);
      expect(r.cells[r.cells.length - 1], tag).toBe(w.cities[r.b].cell);
      for (let k = 0; k + 1 < r.cells.length; k++) expect(w.grid.neighbors[r.cells[k]], tag).toContain(r.cells[k + 1]);
      for (const c of r.cells) expect(w.terrain[c], tag).not.toBe(OCEAN);
    }
  });

  it("knows how long it is along the way — never shorter than the crow flies — and what it costs to travel", () => {
    for (const w of worlds) for (const r of w.roads) {
      const tag = `seed ${w.params.seed}: road ${r.a}-${r.b}`;
      let along = 0;
      for (let k = 0; k + 1 < r.cells.length; k++) {
        const [x1, y1] = at(w, r.cells[k]), [x2, y2] = at(w, r.cells[k + 1]);
        along += Math.hypot(x2 - x1, y2 - y1);
      }
      expect(r.length, tag).toBeCloseTo(along, 9);
      const a = w.cities[r.a], b = w.cities[r.b];
      expect(r.length, tag).toBeGreaterThanOrEqual(Math.hypot(b.x - a.x, b.y - a.y) - 1e-9);
      // mountains and climbing make a road dearer than its length, never cheaper
      expect(r.effort, tag).toBeGreaterThanOrEqual(r.length - 1e-9);
    }
  });

  // A plate turns its gates toward the bearings in its town's list; the road the map draws has to
  // leave by the same way, from both of its ends, or the gate faces a road that is not there.
  it("leaves each of its towns the way that town's own list says it does", () => {
    for (const w of worlds) for (const r of w.roads) {
      for (const [from, to, cells] of [[r.a, r.b, r.cells], [r.b, r.a, [...r.cells].reverse()]] as const) {
        const town = w.cities[from];
        const out = town.roads?.find((x) => x.to === to);
        const [x, y] = at(w, cells[Math.min(2, cells.length - 1)]);
        expect(out?.bearing, `seed ${w.params.seed}: ${from} -> ${to}`).toBeCloseTo(Math.atan2(y - town.y, x - town.x), 9);
      }
    }
  });
});

// Which roads the map shows in a year. The world page opens at year 0, when only the seats the world
// starts with stand: a road shown only once both its towns stood left world 1 with ONE road between
// its eight capitals (87 of 344 over twelve worlds, a third of the capitals with none), and a network
// redrawn among the standing towns every year took 155 roads away again over one play. Asked, the
// reader chose the roads on the cheapest way between two standing towns: every standing town is on
// one, no road is ever taken away, and by the end they are all the plates' roads.
describe("the roads in use in a year", () => {
  // five towns: a chain of cheap roads 0-1-2-3, a dear road 0-3 beside it, and a spur 1-4
  const roads = [
    { a: 0, b: 1, effort: 1 }, { a: 1, b: 2, effort: 1 }, { a: 2, b: 3, effort: 1 },
    { a: 1, b: 4, effort: 1 }, { a: 0, b: 3, effort: 5 },
  ];
  const inUse = (standing: number[]) => roadsInUse(roads, (id) => standing.includes(id));

  it("runs between two standing towns by the cheapest way, through the sites of towns not founded yet", () => {
    expect(inUse([0, 3])).toEqual([true, true, true, false, false]);
  });

  it("leaves out a road that leads only to a town not founded yet, until it is", () => {
    expect(inUse([0, 1, 2, 3])).toEqual([true, true, true, false, false]);
    expect(inUse([0, 1, 2, 3, 4])).toEqual([true, true, true, true, false]);
  });

  it("has nothing to join for one town or none", () => {
    expect(inUse([4])).toEqual([false, false, false, false, false]);
    expect(inUse([])).toEqual([false, false, false, false, false]);
  });
});

describe("the roads in use as the chronicle runs, over twelve worlds", () => {
  const runs = worlds.map((w) => {
    const h = simulateHistory(w, w.params.seed);
    const founded = new Map(h.cityFoundings.map((f) => [f.cityId, f.year]));
    // a town stands once the chronicle has founded it (the map's own rule, app.ts unfoundedAt)
    return { w, years: h.snapshots.map((s) => s.year), stands: (y: number) => (id: number) => (founded.get(id) ?? 0) <= y };
  });

  it("never takes a road away once it is in use", () => {
    for (const { w, years, stands } of runs) {
      let before = w.roads.map(() => false);
      for (const y of years) {
        const now = roadsInUse(w.roads, stands(y));
        before.forEach((was, k) => { if (was) expect(now[k], `seed ${w.params.seed}: road ${w.roads[k].a}-${w.roads[k].b} gone in ${y}`).toBe(true); });
        before = now;
      }
    }
  });

  it("joins every standing town to the others standing on its land, in every year", () => {
    for (const { w, years, stands } of runs) {
      const mass = landmasses(w);
      for (const y of years) {
        const up = stands(y), now = roadsInUse(w.roads, up);
        const standing = w.cities.filter((c) => up(c.id));
        for (const c of standing) {
          const seen = new Set([c.id]), stack = [c.id];
          while (stack.length) {
            const t = stack.pop()!;
            w.roads.forEach((r, k) => {
              if (!now[k] || (r.a !== t && r.b !== t)) return;
              const o = r.a === t ? r.b : r.a;
              if (!seen.has(o)) { seen.add(o); stack.push(o); }
            });
          }
          for (const o of standing) {
            if (o !== c && mass[o.cell] === mass[c.cell]) expect(seen.has(o.id), `seed ${w.params.seed}, ${y}: ${c.id} cannot reach ${o.id}`).toBe(true);
          }
        }
      }
    }
  });

  it("has every road in use once every town stands", () => {
    for (const { w, years, stands } of runs) expect(roadsInUse(w.roads, stands(years[years.length - 1])).every(Boolean), `seed ${w.params.seed}`).toBe(true);
  });

  it("opens world 1 on fifteen roads between its eight capitals", () => {
    const { w, stands } = runs[0];
    expect(w.cities.filter((c) => stands(0)(c.id)).length).toBe(8);
    expect(roadsInUse(w.roads, stands(0)).filter(Boolean).length).toBe(15);
  });
});
