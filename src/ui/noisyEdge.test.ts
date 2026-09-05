import { describe, it, expect } from "vitest";
import { noisyEdge } from "./noisyEdge";
import type { Point } from "../engine/borders";

const A: Point = [10, 20], B: Point = [34, 26];
const dist = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;   // distance to the straight line
};

describe("noisyEdge", () => {
  // THE property. Two cells share an edge and walk it in opposite directions; if they disagree by
  // so much as one point the map leaks at every boundary.
  it("gives the two cells sharing an edge the same line, one of them reversed", () => {
    const forward = noisyEdge(A, B);
    const backward = noisyEdge(B, A);
    expect(forward.length).toBeGreaterThan(0);
    expect(backward).toEqual([...forward].reverse());
  });

  it("holds that property for edges in every direction, including vertical ones", () => {
    const cases: [Point, Point][] = [
      [[0, 0], [10, 0]], [[10, 0], [0, 0]],          // horizontal, both ways
      [[5, 0], [5, 12]], [[5, 12], [5, 0]],          // vertical: the x-tie, decided on y
      [[3, 9], [-4, -2]], [[100.5, 7.25], [4, 88]],  // negatives and fractions
    ];
    for (const [p, q] of cases) {
      expect(noisyEdge(q, p), `${p} / ${q}`).toEqual([...noisyEdge(p, q)].reverse());
    }
  });

  it("is deterministic — the same world draws the same coast every time", () => {
    expect(noisyEdge(A, B)).toEqual(noisyEdge(A, B));
  });

  it("wanders, but stays near its own edge so it cannot cross into a third cell", () => {
    const pts = noisyEdge(A, B);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const off = pts.map((p) => dist(p, A, B));
    expect(Math.max(...off)).toBeGreaterThan(0.02 * len);   // it actually moved
    expect(Math.max(...off)).toBeLessThan(0.35 * len);      // but not far
  });

  it("returns interior points only, so joins stay exact", () => {
    for (const p of noisyEdge(A, B)) {
      expect(p).not.toEqual(A);
      expect(p).not.toEqual(B);
    }
  });

  it("has nothing to say about a degenerate edge", () => {
    expect(noisyEdge([7, 7], [7, 7])).toEqual([]);
  });
});
