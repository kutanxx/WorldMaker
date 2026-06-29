import { createNoise2D } from "simplex-noise";
import type { Rng } from "./rng";
import type { Grid } from "./grid";

export function assignHeights(
  rng: Rng,
  grid: Grid,
  opts?: { scale?: number; octaves?: number; falloff?: number }
): Float32Array {
  const scale = opts?.scale ?? 2.5;
  const octaves = opts?.octaves ?? 4;
  const falloff = opts?.falloff ?? 0.85;
  const noise = createNoise2D(rng);
  const h = new Float32Array(grid.count);
  const cx = grid.width / 2, cy = grid.height / 2;
  const maxD = Math.hypot(cx, cy);
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
    const d = Math.hypot(px - cx, py - cy) / maxD;
    v -= d * falloff;
    h[i] = Math.max(0, Math.min(1, v));
  }
  return h;
}
