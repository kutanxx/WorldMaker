import { describe, it, expect } from "vitest";
import { extractStreets } from "./blockStreets";
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
