import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, centroid, pointInPolygon } from "../geometry";
import type { Polygon } from "../geometry";
import { subdivide } from "./buildings";

const ward: Polygon = [[0, 0], [60, 0], [60, 60], [0, 60]];

describe("buildings.subdivide", () => {
  it("produces multiple footprints, each smaller than the ward", () => {
    const b = subdivide(mulberry32(1), ward, { minArea: 120, margin: 2 });
    expect(b.length).toBeGreaterThan(4);
    for (const f of b) expect(area(f)).toBeLessThan(area(ward));
  });
  it("smaller minArea yields more (denser) buildings", () => {
    const sparse = subdivide(mulberry32(2), ward, { minArea: 400, margin: 2 });
    const dense = subdivide(mulberry32(2), ward, { minArea: 80, margin: 2 });
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
  it("footprint centroids fall inside the ward", () => {
    const b = subdivide(mulberry32(3), ward, { minArea: 150, margin: 2 });
    for (const f of b) expect(pointInPolygon(centroid(f), ward)).toBe(true);
  });
  it("is deterministic", () => {
    const a = subdivide(mulberry32(5), ward, { minArea: 150, margin: 2 });
    const c = subdivide(mulberry32(5), ward, { minArea: 150, margin: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });
});
