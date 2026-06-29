import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";

describe("grid", () => {
  it("produces the requested cell count", () => {
    const g = generateGrid(mulberry32(1), 200, 200, 50, 1);
    expect(g.count).toBe(50);
    expect(g.points.length).toBe(100);
    expect(g.polygons.length).toBe(50);
    expect(g.neighbors.length).toBe(50);
  });
  it("has symmetric adjacency", () => {
    const g = generateGrid(mulberry32(2), 200, 200, 60, 1);
    for (let i = 0; i < g.count; i++) {
      for (const n of g.neighbors[i]) {
        expect(g.neighbors[n]).toContain(i);
      }
    }
  });
  it("find returns nearest cell index", () => {
    const g = generateGrid(mulberry32(3), 200, 200, 40, 1);
    const i = 7;
    const idx = g.find(g.points[i * 2], g.points[i * 2 + 1]);
    expect(idx).toBe(i);
  });
  it("is deterministic", () => {
    const a = generateGrid(mulberry32(9), 200, 200, 30, 2);
    const b = generateGrid(mulberry32(9), 200, 200, 30, 2);
    expect(a.points).toEqual(b.points);
  });
});
