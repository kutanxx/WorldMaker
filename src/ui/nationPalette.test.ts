import { describe, it, expect } from "vitest";
import { NATION_PALETTE, nationColor, nationCentroids } from "./nationPalette";

describe("nationColor", () => {
  it("is stable and cycles through the palette", () => {
    expect(nationColor(0)).toBe(NATION_PALETTE[0]);
    expect(nationColor(NATION_PALETTE.length)).toBe(NATION_PALETTE[0]);
    expect(nationColor(3)).toBe(NATION_PALETTE[3]);
  });
  it("gives distinct colors to the first several ids", () => {
    const seen = new Set([0, 1, 2, 3, 4, 5].map(nationColor));
    expect(seen.size).toBe(6);
  });
  it("handles negative ids without crashing", () => {
    expect(NATION_PALETTE).toContain(nationColor(-1));
  });
});

describe("nationCentroids", () => {
  // 4 cells: polity 0 owns cells at x=0 and x=2 (mean x=1), polity 1 owns x=10; cell3 ocean(-1)
  const grid = { count: 4, points: [0, 0, 2, 0, 10, 0, 5, 5] };
  const owner = [0, 0, 1, -1];
  it("averages owned cell centres and counts cells, skipping unowned", () => {
    const c = nationCentroids(grid, owner);
    expect(c.size).toBe(2);
    expect(c.get(0)).toEqual({ x: 1, y: 0, cells: 2 });
    expect(c.get(1)).toEqual({ x: 10, y: 0, cells: 1 });
  });
});
