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

// The falloff used to be radial — distance from the centre over the half-diagonal — which on a
// 1000x700 canvas subtracts the full amount only at the corners. At the middle of the top edge it
// subtracted 350/610 of it, barely half, so land ran off the top and bottom of almost every world
// and the continent was left sliced flat by a box the reader cannot see.
describe("assignHeights leaves a sea border on every side", () => {
  const W = 1000, H = 700;
  it("puts nothing above sea level anywhere on the boundary", () => {
    for (const seed of [1, 2, 3, 7, 42, 123, 777, 60606]) {
      const g = generateGrid(mulberry32(seed), W, H, 3000, 2);
      const h = assignHeights(mulberry32(seed), g);
      for (let i = 0; i < g.count; i++) {
        const x = g.points[i * 2], y = g.points[i * 2 + 1];
        const onRim = x < 6 || y < 6 || x > W - 6 || y > H - 6;
        if (onRim) expect(h[i], `seed ${seed} cell ${i} at ${x.toFixed(0)},${y.toFixed(0)}`).toBeLessThan(0.3);
      }
    }
  });

  it("drowns the short sides as thoroughly as the long ones", () => {
    // the old radial falloff was weakest at the top and bottom edge midpoints; check them directly
    const g = generateGrid(mulberry32(11), W, H, 3000, 2);
    const h = assignHeights(mulberry32(11), g);
    const nearest = (tx: number, ty: number) => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < g.count; i++) {
        const d = Math.hypot(g.points[i * 2] - tx, g.points[i * 2 + 1] - ty);
        if (d < bd) { bd = d; best = i; }
      }
      return h[best];
    };
    expect(nearest(W / 2, 2)).toBeLessThan(0.3);       // top edge midpoint
    expect(nearest(W / 2, H - 2)).toBeLessThan(0.3);   // bottom edge midpoint
    expect(nearest(2, H / 2)).toBeLessThan(0.3);       // left edge midpoint
  });

  it("still leaves most of the interior above water to build a world on", () => {
    const g = generateGrid(mulberry32(1), W, H, 3000, 2);
    const h = assignHeights(mulberry32(1), g);
    let land = 0;
    for (let i = 0; i < g.count; i++) if (h[i] >= 0.3) land++;
    expect(land / g.count).toBeGreaterThan(0.25);
  });
});
