import { describe, it, expect } from "vitest";
import { extractStreets, classifyStreets } from "./blockStreets";
import type { WardCell } from "./wards";

const ward = (poly: [number, number][], site: [number, number]): WardCell => ({ polygon: poly, site });

describe("extractStreets", () => {
  it("returns only edges shared by two wards (interior streets), deduping nodes", () => {
    const w1 = ward([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]);
    const w2 = ward([[10, 0], [20, 0], [20, 10], [10, 10]], [15, 5]);
    const far = ward([[40, 40], [50, 40], [50, 50], [40, 50]], [45, 45]);
    const g = extractStreets([w1, w2, far]);
    expect(g.segments.length).toBe(1); // only the shared x=10 edge
    expect(g.nodes.length).toBe(2);    // its two endpoints, deduped
    expect(g.edges.length).toBe(1);
    const s = g.segments[0];
    expect(s.every((p) => Math.abs(p[0] - 10) < 0.01)).toBe(true);
  });
  it("returns no streets when no wards are adjacent", () => {
    const a = ward([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]);
    const b = ward([[40, 40], [50, 40], [50, 50], [40, 50]], [45, 45]);
    expect(extractStreets([a, b]).segments.length).toBe(0);
  });
});

describe("classifyStreets", () => {
  it("marks a gate→centre path as main and connects the gate", () => {
    // an L-shaped chain of 3 blocks meeting at (10,10): bottom-left, bottom-right, top-left.
    // Their two shared edges (x=10 from y=0..10, and y=10 from x=0..10) meet at that corner,
    // so the street graph is a connected 2-edge chain (unlike a row of collinear blocks, whose
    // shared edges are parallel and never touch).
    const wards: WardCell[] = [
      ward([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]),
      ward([[10, 0], [20, 0], [20, 10], [10, 10]], [15, 5]),
      ward([[0, 10], [10, 10], [10, 20], [0, 20]], [5, 15]),
    ];
    const g = extractStreets(wards);
    const { main, minor } = classifyStreets(g, [[20, 5]], [0, 20]);
    // gate at bottom-right (20,5) → centre at top-left (0,20): both interior streets
    // ([10,0]-[10,10] and [10,10]-[0,10]) are on the path → main
    expect(main.length).toBeGreaterThanOrEqual(2);
    // a stub connects the gate (20,5) to the network
    expect(main.some((s) => s.some((p) => Math.abs(p[0] - 20) < 0.01 && Math.abs(p[1] - 5) < 0.01))).toBe(true);
    expect(minor.length).toBe(0);
  });
  it("emits a fallback stub when the graph has no gate→centre path", () => {
    const g = { nodes: [[0, 0], [1, 0]] as [number, number][], edges: [] as [number, number][], segments: [] as [number, number][][] };
    const { main } = classifyStreets(g, [[0, 0]], [100, 100]);
    expect(main.length).toBeGreaterThanOrEqual(1); // gate still joined via stub(s)
  });
});
