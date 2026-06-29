import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";

describe("heightmap", () => {
  it("stays within 0..1 and is per-cell", () => {
    const g = generateGrid(mulberry32(1), 300, 300, 200, 1);
    const h = assignHeights(mulberry32(1), g);
    expect(h.length).toBe(g.count);
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("is deterministic", () => {
    const g = generateGrid(mulberry32(2), 300, 300, 200, 1);
    const a = assignHeights(mulberry32(5), g);
    const b = assignHeights(mulberry32(5), g);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it("island shaping makes edges lower than center on average", () => {
    const g = generateGrid(mulberry32(3), 300, 300, 400, 1);
    const h = assignHeights(mulberry32(3), g);
    let centerSum = 0, centerN = 0, edgeSum = 0, edgeN = 0;
    for (let i = 0; i < g.count; i++) {
      const x = g.points[i * 2], y = g.points[i * 2 + 1];
      const d = Math.hypot(x - 150, y - 150);
      if (d < 60) { centerSum += h[i]; centerN++; }
      else if (d > 130) { edgeSum += h[i]; edgeN++; }
    }
    expect(centerSum / centerN).toBeGreaterThan(edgeSum / edgeN);
  });
});
