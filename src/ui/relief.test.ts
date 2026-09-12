// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { reliefBands } from "./relief";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { ALPINE, OCEAN, BIOME_COLORS, BIOME_NAMES } from "../engine/biome";

// a square lattice of cells, each a unit square, with the heights a caller supplies
const lattice = (n: number, height: (x: number, y: number) => number) => {
  const points: number[] = [], polygons: number[][][] = [], neighbors: number[][] = [], heights: number[] = [];
  const at = (x: number, y: number) => y * n + x;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    points.push(x * 10 + 5, y * 10 + 5);
    polygons.push([[x * 10, y * 10], [x * 10 + 10, y * 10], [x * 10 + 10, y * 10 + 10], [x * 10, y * 10 + 10]]);
    const nb: number[] = [];
    if (x > 0) nb.push(at(x - 1, y));
    if (x < n - 1) nb.push(at(x + 1, y));
    if (y > 0) nb.push(at(x, y - 1));
    if (y < n - 1) nb.push(at(x, y + 1));
    neighbors.push(nb);
    heights.push(height(x, y));
  }
  return { grid: { count: n * n, points, polygons, neighbors }, heights };
};

describe("relief shading", () => {
  // The light comes from the upper left because every atlas since Imhof has put it there. A reader
  // takes light-from-the-NW as bulk and the reverse as a hole in the ground, so getting the side
  // wrong turns a range inside out.
  it("darkens the slope that faces away from the light, and leaves the lit slope as paper", () => {
    // a ridge running SW-NE: ground rises to the north-west, so the SE-facing flank is in shadow
    const { grid, heights } = lattice(21, (x, y) => 0.9 - (x + y) * 0.01);
    const bands = reliefBands(grid, heights, () => true, { smoothing: 0 });
    expect(bands.length, "a uniform slope away from the light must take ink").toBeGreaterThan(0);
    // now tilt the other way: the same ground facing INTO the light takes none
    const lit = lattice(21, (x, y) => 0.1 + (x + y) * 0.01);
    expect(reliefBands(lit.grid, lit.heights, () => true, { smoothing: 0 })).toEqual([]);
  });

  it("shades only the cells it is given", () => {
    const { grid, heights } = lattice(21, (x, y) => 0.9 - (x + y) * 0.01);
    const only = new Set([5, 6, 7]);
    const bands = reliefBands(grid, heights, (i) => only.has(i), { smoothing: 0 });
    const cells = bands.reduce((n, b) => n + (b.d.match(/M/g) ?? []).length, 0);
    expect(cells).toBeLessThanOrEqual(only.size);
  });
});

// ★ The reason the shading stops at the mountains. The biome palette is built on a floor — no two
// biome colours are closer than ΔE 19.7 (grassland/desert) — and tinting a fill spends exactly that
// budget. Measured over every pair of biomes wearing every shade either could carry: shading the
// whole map at shadow .30 / light .18 brings a lit wetland within ΔE 2.5 of a shaded taiga, which
// is no distance at all. Alpine alone, shadow only, stays wider than the palette's own floor.
describe("the shading does not cost the palette its floor", () => {
  const lab = (h: string): [number, number, number] => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const dE = (a: string, b: string) => { const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b); return Math.hypot(l1 - l2, a1 - a2, b1 - b2); };
  const over = (fg: string, bg: string, alpha: number) =>
    "#" + [1, 3, 5].map((i) => {
      const f = parseInt(fg.slice(i, i + 2), 16), b = parseInt(bg.slice(i, i + 2), 16);
      return Math.round(f * alpha + b * (1 - alpha)).toString(16).padStart(2, "0");
    }).join("");

  it("never shades a range into another biome's colour", () => {
    let heaviest = 0, ink = "#000000";
    for (let seed = 1; seed <= 3; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      for (const b of reliefBands(world.grid, world.heights, (i) => world.biome[i] === ALPINE)) {
        if (b.opacity > heaviest) { heaviest = b.opacity; ink = b.fill; }
      }
    }
    expect(heaviest, "no shading at all").toBeGreaterThan(0.1);
    const shaded = over(ink, BIOME_COLORS[ALPINE], heaviest);
    const floor = Math.min(...Object.entries(BIOME_COLORS)
      .filter(([k]) => Number(k) !== OCEAN)
      .flatMap(([k1, c1], i, all) => all.slice(i + 1).map(([k2, c2]) => (Number(k1) === Number(k2) ? Infinity : dE(c1, c2)))));
    for (const [k, c] of Object.entries(BIOME_COLORS)) {
      if (Number(k) === OCEAN || Number(k) === ALPINE) continue;
      expect(dE(shaded, c), `a range shaded ${(heaviest * 100).toFixed(0)}% reads as ${BIOME_NAMES[Number(k)]}`).toBeGreaterThan(floor * 0.9);
    }
  });
});
