import { describe, it, expect } from "vitest";
import { traceRivers, nameRivers } from "./rivers";
import { mulberry32 } from "./rng";
import { DEFAULT_PHON } from "./names";

// A straight chain of cells 0..N-1; cell 0 is ocean, rest land sloping uphill.
// neighbors: each cell links to i-1 and i+1. points on a line. biome 3 (rain 1.0).
function chain(heights: number[]): {
  grid: { count: number; neighbors: number[][]; points: number[] };
  terrain: number[]; biome: number[];
} {
  const n = heights.length;
  const neighbors = Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n));
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push(i * 10, 0);
  const terrain = heights.map((_, i) => (i === 0 ? 0 : 1)); // cell 0 OCEAN
  const biome = new Array(n).fill(3); // TEMPERATE_FOREST → rain 1.0
  return { grid: { count: n, neighbors, points }, terrain, biome };
}

describe("traceRivers", () => {
  it("routes flow downhill to the ocean and accumulates flux", () => {
    const { grid, terrain, biome } = chain([0.0, 0.2, 0.4, 0.6, 0.8]);
    const { segments } = traceRivers(grid, [0.0, 0.2, 0.4, 0.6, 0.8], terrain, biome);
    // 4 land cells → 4 segments, the mouth hop (cell1→cell0) reaches the ocean point x=0
    expect(segments.length).toBe(4);
    const mouth = segments.find((s) => s.x2 === 0);
    expect(mouth).toBeTruthy();
    // mouth flux = sum of the 4 land cells' rain (each 1.0)
    expect(mouth!.f).toBeCloseTo(4, 5);
  });

  it("fills a pit so a local minimum still drains to the sea (no lakes, no cycle)", () => {
    // cell 3 is a pit (0.1) between 0.5 and 0.6; must still drain out to ocean cell 0
    const heights = [0.0, 0.2, 0.5, 0.1, 0.6];
    const { grid, terrain, biome } = chain(heights);
    const { segments } = traceRivers(grid, heights, terrain, biome);
    // every land cell emits a segment toward a strictly-downstream (filled) neighbour,
    // and the network still reaches x=0 (ocean)
    expect(segments.length).toBe(4);
    expect(segments.some((s) => s.x2 === 0)).toBe(true);
  });

  it("returns empty network when there is no land", () => {
    const grid = { count: 2, neighbors: [[1], [0]], points: [0, 0, 10, 0] };
    expect(traceRivers(grid, [0, 0], [0, 0], [0, 0])).toEqual({ segments: [], trunks: [] });
  });

  it("names a trunk mouth-to-source as the max-flux upstream path", () => {
    const { grid, terrain, biome } = chain([0.0, 0.2, 0.4, 0.6, 0.8]);
    const { trunks } = traceRivers(grid, [0.0, 0.2, 0.4, 0.6, 0.8], terrain, biome);
    expect(trunks.length).toBe(1);
    expect(trunks[0].mouthCell).toBe(1);          // the land cell touching the ocean
    expect(trunks[0].path[0]).toEqual([10, 0]);   // path starts at the mouth
    expect(trunks[0].path[trunks[0].path.length - 1]).toEqual([40, 0]); // ends at the source
    expect(trunks[0].flux).toBeCloseTo(4, 5);
  });
});

describe("nameRivers", () => {
  const trunks = [
    { mouthCell: 4, path: [[10, 0], [40, 0]] as [number, number][], flux: 9 },
    { mouthCell: 7, path: [[20, 5], [50, 5]] as [number, number][], flux: 5 },
  ];
  const phonAt = () => DEFAULT_PHON;

  it("names every trunk with a river noun, deterministically", () => {
    const a = nameRivers(mulberry32(1), trunks, phonAt);
    const b = nameRivers(mulberry32(1), trunks, phonAt);
    expect(a.map((r) => r.name)).toEqual(b.map((r) => r.name)); // deterministic
    for (const r of a) expect(/River|Water|Run|Fork|Flow|Race|Rill/.test(r.name)).toBe(true);
  });

  it("carries the mouth point and flux through", () => {
    const [r] = nameRivers(mulberry32(1), trunks, phonAt);
    expect(r.mouth).toEqual([10, 0]);
    expect(r.flux).toBe(9);
    expect(r.path).toEqual(trunks[0].path);
  });

  it("uses the mouth cell's phonetic profile (culture flavour)", () => {
    const guttural = { onset: ["kh", "gr"], vowel: ["a", "u"], coda: ["k", "gg"] };
    const liquid = { onset: ["l", "m"], vowel: ["ia", "ei"], coda: ["l", "n"] };
    const g = nameRivers(mulberry32(3), trunks, () => guttural);
    const l = nameRivers(mulberry32(3), trunks, () => liquid);
    // both valid & deterministic; the profiles produce different strings
    expect(g.map((r) => r.name)).not.toEqual(l.map((r) => r.name));
  });
});
