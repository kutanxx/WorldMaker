import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { assignCultures, CULTURE_PROFILES } from "./culture";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";

// a 10-wide lattice; cultures grow over adjacency now, so the fixture has to say who touches whom
function grid(n: number) {
  const points: number[] = [];
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    points.push((i % 10) * 30, Math.floor(i / 10) * 30);
    const nb: number[] = [];
    if (i % 10 > 0) nb.push(i - 1);
    if (i % 10 < 9 && i + 1 < n) nb.push(i + 1);
    if (i - 10 >= 0) nb.push(i - 10);
    if (i + 10 < n) nb.push(i + 10);
    neighbors.push(nb);
  }
  return { count: n, points, neighbors };
}

describe("assignCultures", () => {
  it("gives every land cell a valid culture and leaves ocean at -1", () => {
    const n = 100, g = grid(n);
    const terrain = new Array(n).fill(1);
    terrain[0] = terrain[1] = 0; // 2 ocean cells
    const { cultureOf, cultures } = assignCultures(mulberry32(1), g, terrain, 4);
    expect(cultures.length).toBeGreaterThanOrEqual(1);
    expect(cultures.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      if (terrain[i] === 0) expect(cultureOf[i]).toBe(-1);
      else { expect(cultureOf[i]).toBeGreaterThanOrEqual(0); expect(cultureOf[i]).toBeLessThan(cultures.length); }
    }
  });
  it("is deterministic and respects count", () => {
    const n = 100, g = grid(n), terrain = new Array(n).fill(1);
    const a = assignCultures(mulberry32(2), g, terrain, 3);
    const b = assignCultures(mulberry32(2), g, terrain, 3);
    expect(Array.from(a.cultureOf)).toEqual(Array.from(b.cultureOf));
    expect(a.cultures.map((c) => c.name)).toEqual(b.cultures.map((c) => c.name));
    expect(a.cultures.length).toBe(3);
  });
  it("ships distinct phonetic profiles", () => {
    const sigs = CULTURE_PROFILES.map((p) => p.phon.onset.join(","));
    expect(new Set(sigs).size).toBe(CULTURE_PROFILES.length);
  });
});

// A culture used to be the set of land cells nearest its centre AS THE CROW FLIES, so its territory
// jumped straits and oceans for no reason the map could show: across ten seeds, 9% of all land sat
// in a fragment cut off from its own culture's main body, and the line dividing two cultures was a
// perpendicular bisector rather than anything on the ground. `provinces.ts` already grows over land
// adjacency for exactly this reason; this is the same rule, arriving late.
//
// The invariant, stated without reference to the algorithm: a culture is ONE body you can walk
// across. The only cells allowed outside it are ones no culture could have walked to at all --
// islands, which take the culture of the nearest shore.
function landComponents(w: ReturnType<typeof generateWorld>["world"], cells: number[]): number[][] {
  const set = new Set(cells), seen = new Set<number>(), out: number[][] = [];
  for (const s of cells) {
    if (seen.has(s)) continue;
    const comp = [s]; seen.add(s);
    for (let h = 0; h < comp.length; h++) {
      for (const nb of w.grid.neighbors[comp[h]]) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); comp.push(nb); }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

describe("a culture is ground you can walk across", () => {
  it("puts no part of a culture where that culture could have walked but did not", () => {
    const offenders: string[] = [];
    for (const seed of [1, 7, 42, 77, 123, 834932]) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const byCulture: number[][] = Array.from({ length: w.cultures.length }, () => []);
      for (let i = 0; i < w.grid.count; i++) if (w.cultureOf[i] >= 0) byCulture[w.cultureOf[i]].push(i);
      // the main body of every culture: the ground the cultures actually grew over
      const mains = new Set<number>();
      for (const cells of byCulture) for (const c of landComponents(w, cells)[0] ?? []) mains.add(c);
      // any cell outside its own culture's main body must be unreachable ON FOOT from every main
      // body -- an island. If it is reachable, the partition crossed water for no reason.
      const reachable = new Set<number>(mains);
      const q = [...mains];
      for (let h = 0; h < q.length; h++) {
        for (const nb of w.grid.neighbors[q[h]]) {
          if (w.cultureOf[nb] >= 0 && !reachable.has(nb)) { reachable.add(nb); q.push(nb); }
        }
      }
      for (let c = 0; c < byCulture.length; c++) {
        const comps = landComponents(w, byCulture[c]);
        for (const stray of comps.slice(1)) {
          const walkable = stray.filter((x) => reachable.has(x)).length;
          if (walkable) offenders.push(`seed ${seed} culture ${w.cultures[c].name}: ${walkable} cells reachable on foot yet cut off from their own culture`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // This one guards a road not taken. Plain multi-source BFS also respects the coast and is the
  // obvious simplification of the loop above, but it grows by graph distance: on seed 1 it handed
  // 49% of the land to whichever culture began on the big landmass, against 34% here. Nothing ever
  // shipped that way -- the bound is here so that "simplifying" the turn-taking cannot pass quietly.
  it("lets no culture take the map because of the ground it started on", () => {
    for (const seed of [1, 7, 42, 77, 123, 834932, 5, 9, 314, 2718]) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const held = new Array(w.cultures.length).fill(0);
      let land = 0;
      for (let i = 0; i < w.grid.count; i++) if (w.cultureOf[i] >= 0) { held[w.cultureOf[i]]++; land++; }
      expect(Math.max(...held) / land, `seed ${seed}`).toBeLessThan(0.45); // measured worst: 0.37
    }
  });
});
