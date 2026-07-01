import { describe, it, expect } from "vitest";
import type { Grid } from "./grid";
import { sharedEdge, politicalBorders, coastline } from "./borders";

// three cells in a row; cell0|cell1 share x=2 edge, cell1|cell2 share x=4 edge
const grid = {
  width: 10, height: 10, count: 3,
  points: [1, 1, 3, 1, 5, 1],
  polygons: [
    [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    [[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]],
    [[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]],
  ],
  neighbors: [[1], [0, 2], [1]],
  find: () => 0,
} as unknown as Grid;

describe("borders", () => {
  it("sharedEdge finds the two common vertices", () => {
    const e = sharedEdge(grid.polygons[0], grid.polygons[1]);
    expect(e).not.toBeNull();
    const xs = e!.map((p) => p[0]);
    expect(xs.every((x) => x === 2)).toBe(true);
  });
  it("sharedEdge returns null when only a corner touches", () => {
    const a = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const c = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    expect(sharedEdge(a, c)).toBeNull();
  });
  it("politicalBorders only between differing polities", () => {
    expect(politicalBorders(grid, [0, 1, 1]).length).toBe(1);
    expect(politicalBorders(grid, [0, 0, 0]).length).toBe(0);
  });
  it("coastline only on land-ocean edges", () => {
    expect(coastline(grid, [1, 1, 0]).length).toBe(1); // cell1 touches ocean cell2
    expect(coastline(grid, [1, 1, 1]).length).toBe(0);
  });
  it("skips unassigned cells (polityOf < 0)", () => {
    expect(politicalBorders(grid, [-1, 1, 2]).length).toBe(1); // cell0 unassigned; cells1,2 differ -> 1 border
    expect(politicalBorders(grid, [-1, -1, 1]).length).toBe(0); // every border touches an unassigned cell
  });
  it("politicalBorders accepts an Int32Array (snapshot) owner and matches the array result", () => {
    const arr = Int32Array.from([0, 0, 1]);
    const a = politicalBorders(grid, [0, 0, 1]);
    const b = politicalBorders(grid, arr);
    expect(b.length).toBe(a.length);
    expect(b.length).toBe(1); // only the cell1|cell2 edge differs
  });
});
