import { describe, it, expect } from "vitest";
import { signedArea, area, centroid, bbox, perimeter, pointInPolygon } from "./geometry";
import type { Polygon } from "./geometry";

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

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
