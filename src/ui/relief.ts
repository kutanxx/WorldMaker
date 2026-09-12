import { cellPath } from "./svgPaths";

export interface ReliefBand { d: string; fill: string; opacity: number }

interface Grid { count: number; points: number[]; polygons: number[][][]; neighbors: number[][] }

// Imhof's light: from the upper left, about 45 degrees up. Every atlas since has kept it there — a
// reader who has ever seen a shaded map reads light-from-the-NW as bulk and the reverse as a hole
// in the ground, so this is a convention, not a taste.
const LX = -0.5, LY = -0.5, LZ = Math.SQRT1_2;
const FLAT = LZ;          // what level ground returns: the shading is the DEPARTURE from this

// The height field runs 0..1 across a world a thousand units wide, so its gradients are about
// 1.5e-3 per unit: without an exaggeration every cell returns the same flat grey.
const EXAGGERATION = 260;
// neighbour-average passes over the heights before the slope is taken. Measured: raw cells agree
// with their neighbours on slope DIRECTION 73% of the time, 82% after one pass, 86% after two.
// Below that agreement the shading reads as mottling on the facets rather than as ground.
const SMOOTHING = 12;

// ★ Only the mountains are shaded, and only with shadow. Both halves of that were measured, not
// chosen.
//
// The biome palette is built on a floor: no two biome colours are closer than ΔE 19.7
// (grassland/desert). Shading spends exactly that budget, because tinting a fill IS moving its
// colour. Measured over every pair of biomes, with every shade either could be wearing:
//
//   shade the whole map, shadow .30 / light .18 → two biomes come within ΔE 2.5 (a lit wetland
//                                                 against a shaded taiga). The palette is gone.
//   the same at .45 / .28                       → ΔE 1.3.
//   weaken it to .16 / .10                      → ΔE 11.4, and by then the relief barely reads.
//   ALPINE only, shadow .45, no highlight       → ΔE 21.4, wider than the palette's own floor.
//
// So the map keeps its colours and the ranges get their bulk, which is what was asked for: the
// complaint was that a mountain range is a flat grey area, not that the plains are flat. Plains ARE
// flat. Highlights are dropped for the same reason — on a light ground they lift the grey toward
// tundra (ΔE 15.3 at .28) while adding little that the shadow has not already said.
const REACH = 0.32, GAMMA = 1.5;   // the ramp from departure-from-level to ink
const MAX_SHADOW = 0.45;
const STEP = 0.03;        // one band per 3% of opacity — fine enough not to read as a contour line

const SHADOW = "#4a3f2f"; // warm brown, not black: on parchment a neutral shadow reads as dirt

/**
 * Hill shading for the ranges: one merged path per opacity band (a dozen or so), not one per cell,
 * so the DOM stays the size it was. The bands use the same noisy `cellPath` as the biome fills, so
 * the shading sits exactly on the fills rather than beside them.
 *
 * `isShaded` says which cells are mountain; the slope itself is read from the whole height field,
 * so a range is lit by the ground it actually stands on and not by its own edge.
 */
export function reliefBands(
  grid: Grid, heights: number[], isShaded: (i: number) => boolean,
  opts: { smoothing?: number; shadow?: number } = {},
): ReliefBand[] {
  const { count, points, neighbors, polygons } = grid;
  const smoothing = opts.smoothing ?? SMOOTHING, maxShadow = opts.shadow ?? MAX_SHADOW;
  let h = heights;
  for (let p = 0; p < smoothing; p++) {
    const nh = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      let s = h[i], k = 1;
      for (const nb of neighbors[i]) { s += h[nb]; k++; }
      nh[i] = s / k;
    }
    h = nh as unknown as number[];
  }

  const byBand = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    if (!isShaded(i)) continue;
    // gradient: the average of (dh/d) along each neighbour direction
    let sx = 0, sy = 0, w = 0;
    for (const nb of neighbors[i]) {
      const dx = points[nb * 2] - points[i * 2], dy = points[nb * 2 + 1] - points[i * 2 + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-9) continue;
      const dh = h[nb] - h[i];
      sx += (dh * dx) / d2; sy += (dh * dy) / d2; w++;
    }
    if (!w) continue;
    const gx = (sx / w) * EXAGGERATION, gy = (sy / w) * EXAGGERATION;
    // surface normal (-gx, -gy, 1), normalised, against the light
    const nl = Math.hypot(gx, gy, 1);
    const dev = (-gx * LX - gy * LY + LZ) / nl - FLAT;
    if (dev >= 0) continue;                                   // the lit side keeps the paper
    const mag = Math.min(1, Math.pow(-dev / REACH, GAMMA));
    const band = Math.round((mag * maxShadow) / STEP);
    if (band === 0) continue;
    byBand.set(band, (byBand.get(band) ?? "") + cellPath(polygons[i]));
  }

  const bands: ReliefBand[] = [];
  for (const [band, d] of [...byBand.entries()].sort((a, b) => a[0] - b[0])) {
    bands.push({ d, fill: SHADOW, opacity: band * STEP });
  }
  return bands;
}
