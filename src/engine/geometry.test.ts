import { describe, it, expect } from "vitest";
import { signedArea, area, centroid, bbox, perimeter, pointInPolygon } from "./geometry";
import { convexHull, clipToConvex, splitByLine, insetPolygon, insetConvex } from "./geometry";
import { pointSegDist, segmentsIntersect, polysOverlap, polygonSelfIntersects } from "./geometry";
import type { Polygon } from "./geometry";

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe("proximity/overlap helpers", () => {
  it("measures point-to-segment distance incl. clamped endpoints", () => {
    expect(pointSegDist([5, 5], [0, 0], [10, 0])).toBeCloseTo(5, 6);
    expect(pointSegDist([-3, 4], [0, 0], [10, 0])).toBeCloseTo(5, 6); // beyond endpoint a
  });
  it("detects proper segment crossings only", () => {
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false);
  });
  it("detects polygon overlap: intersecting, contained, disjoint", () => {
    const shifted: Polygon = [[5, 5], [15, 5], [15, 15], [5, 15]];
    const inside: Polygon = [[4, 4], [6, 4], [6, 6], [4, 6]];
    const away: Polygon = [[20, 20], [30, 20], [30, 30], [20, 30]];
    expect(polysOverlap(square, shifted)).toBe(true);
    expect(polysOverlap(square, inside)).toBe(true);
    expect(polysOverlap(square, away)).toBe(false);
  });
});

describe("geometry measures", () => {
  it("computes signed area (CCW positive) and absolute area", () => {
    expect(signedArea(square)).toBeCloseTo(100, 6);
    expect(area([[0, 0], [0, 10], [10, 10], [10, 0]])).toBeCloseTo(100, 6);
    expect(signedArea([[0, 0], [0, 10], [10, 10], [10, 0]])).toBeCloseTo(-100, 6);
  });
  it("computes centroid of a square", () => {
    const c = centroid(square);
    expect(c[0]).toBeCloseTo(5, 6);
    expect(c[1]).toBeCloseTo(5, 6);
  });
  it("computes bbox and perimeter", () => {
    expect(bbox(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(perimeter(square)).toBeCloseTo(40, 6);
  });
  it("tests point in polygon", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
});

describe("geometry ops", () => {
  it("convexHull returns CCW hull of a point cloud", () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
    expect(area(hull)).toBeCloseTo(100, 6);
    expect(hull.length).toBe(4);
  });
  it("clipToConvex clips a square to a smaller square", () => {
    const sub: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const clip: Polygon = [[2, 2], [8, 2], [8, 8], [2, 8]];
    const out = clipToConvex(sub, clip);
    expect(area(out)).toBeCloseTo(36, 4);
  });
  it("splitByLine splits a square into two halves preserving total area", () => {
    const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const parts = splitByLine(sq, [5, -1], [5, 11]);
    expect(parts.length).toBe(2);
    expect(area(parts[0]) + area(parts[1])).toBeCloseTo(100, 4);
    expect(area(parts[0])).toBeCloseTo(50, 4);
  });
  it("insetPolygon shrinks area and stays inside", () => {
    const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inner = insetPolygon(sq, 2);
    expect(area(inner)).toBeLessThan(100);
    expect(area(inner)).toBeGreaterThan(0);
    expect(area(inner)).toBeCloseTo(51.43, 1);
  });
  it("insetPolygon with negative d expands outward", () => {
    const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const outer = insetPolygon(sq, -2);
    expect(area(outer)).toBeGreaterThan(100);
  });
  it("insetConvex offsets every edge uniformly inward (not a radial shrink)", () => {
    const rect: Polygon = [[0, 0], [20, 0], [20, 4], [0, 4]]; // radial inset would be very non-uniform here
    const inner = insetConvex(rect, 1);
    const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(1, 4);
    expect(Math.max(...xs)).toBeCloseTo(19, 4);
    expect(Math.min(...ys)).toBeCloseTo(1, 4);
    expect(Math.max(...ys)).toBeCloseTo(3, 4);
  });
  it("polygonSelfIntersects detects a bowtie and passes a simple quad", () => {
    expect(polygonSelfIntersects([[0,0],[10,0],[0,10],[10,10]])).toBe(true);   // classic bowtie
    expect(polygonSelfIntersects([[0,0],[10,0],[10,10],[0,10]])).toBe(false);  // simple square
  });
  // The contract is the DISTANCE, not merely "some polygon back". The fallback used to be the
  // radial inset, which pulls each vertex a fixed step toward the centroid and so hands back a
  // shape far closer to the far edge than asked: over 4,641 city wards the mitred path came out at
  // a median of exactly 4.00 for a request of 4, and the 16% that fell back at 1.89 — which is how
  // buildings ended up half under the street drawn along their own block edge. It now returns
  // either a simple polygon that really is d clear of the original, or nothing at all when no such
  // polygon exists.
  it("insetConvex returns a polygon that is genuinely d clear of the original, or nothing", () => {
    const clearance = (inner: Polygon, outer: Polygon) => {
      let worst = Infinity;
      for (const v of inner) for (let i = 0; i < outer.length; i++) {
        worst = Math.min(worst, pointSegDist(v, outer[i], outer[(i + 1) % outer.length]));
      }
      return worst;
    };
    const box: Polygon = [[0,0],[40,0],[40,30],[0,30]];
    const inner = insetConvex(box, 4);
    expect(polygonSelfIntersects(inner)).toBe(false);
    expect(clearance(inner, box)).toBeGreaterThanOrEqual(4 - 1e-6);

    // a thin sliver where an edge-offset pinches: nowhere in a 2-unit-thick shape is 4 clear of it
    const sliver: Polygon = [[0,0],[30,0],[30,1.5],[15,2],[0,1.5]];
    expect(insetConvex(sliver, 4).length).toBe(0);
    // ...but the same sliver has room for a small inset, and that one must hold its distance
    const thin = insetConvex(sliver, 0.5);
    expect(polygonSelfIntersects(thin)).toBe(false);
    expect(thin.length).toBeGreaterThanOrEqual(3);
    expect(clearance(thin, sliver)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
});
