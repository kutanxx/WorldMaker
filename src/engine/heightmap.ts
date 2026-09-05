import { createNoise2D } from "simplex-noise";
import type { Rng } from "./rng";
import type { Grid } from "./grid";

// Width of the guaranteed-sea band at the edge, as a fraction of the half-width and half-height.
// 0.11 is 55 units along the long sides and 38 along the short ones: measured across twelve seeds it
// leaves the nearest land 11.8 units clear of the frame at worst, and costs almost nothing in land
// (31-46% of cells, against 32-47% at 0.08).
const RIM = 0.11;

export function assignHeights(
  rng: Rng,
  grid: Grid,
  opts?: { scale?: number; octaves?: number; falloff?: number }
): Float32Array {
  const scale = opts?.scale ?? 2.5;
  const octaves = opts?.octaves ?? 4;
    // Retuned with the per-axis form: measured against the old radial falloff, 0.45 per axis drowned
  // a third of the land (seed 1 went 46% -> 31% of cells), because every edge now gets what only the
  // corners used to. 0.34 puts the land share back where it was, 35-46%.
  const falloff = opts?.falloff ?? 0.34;
  const noise = createNoise2D(rng);
  const h = new Float32Array(grid.count);
  const cx = grid.width / 2, cy = grid.height / 2;
  for (let i = 0; i < grid.count; i++) {
    const px = grid.points[i * 2], py = grid.points[i * 2 + 1];
    const nx = px / grid.width, ny = py / grid.height;
    let amp = 1, freq = scale, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    let v = (sum / norm + 1) / 2;
    // How far out this cell sits, measured per axis rather than radially. The old radial form —
    // distance from the centre over the half-diagonal — reaches 1 only at the corners: on a 1000x700
    // canvas the middle of the top edge scored 350/610, so barely half the falloff was applied
    // there, and land ran off the top and bottom of nearly every world. Measured over twelve seeds,
    // all twelve were cut on at least three sides. Per axis, every edge is equally far out.
    const d = Math.max(Math.abs(px - cx) / cx, Math.abs(py - cy) / cy);
    v -= d * falloff;
    // The dome alone cannot promise a coast that stays off the border: noise peaks near 1, and one
    // falloff of 0.45 still leaves 0.55, well above any sane sea level. So the outermost band is
    // drowned outright, ramping in so the shoreline still falls where the noise puts it rather than
    // along a ring. This is what guarantees the sea border the frame needs.
    if (d > 1 - RIM) v -= (d - (1 - RIM)) / RIM;
    h[i] = Math.max(0, Math.min(1, v));
  }
  return h;
}
