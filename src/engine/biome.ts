import { createNoise2D } from "simplex-noise";
import { mulberry32, deriveSeed } from "./rng";
import type { Grid } from "./grid";
import type { WorldParams } from "../types/world";
import { OCEAN as T_OCEAN, MOUNTAIN as T_MOUNTAIN } from "./terrain";

export const OCEAN = 0;
export const TUNDRA = 1;
export const TAIGA = 2;
export const TEMPERATE_FOREST = 3;
export const GRASSLAND = 4;
export const DESERT = 5;
export const TROPICAL = 6;
export const WETLAND = 7;
export const ALPINE = 8;

// muted parchment-friendly palette spread across lightness + hue so all
// biomes stay distinguishable (every CIELAB pairwise ΔE >= ~20)
export const BIOME_COLORS: Record<number, string> = {
  [OCEAN]: "#a9c7e0",
  [TUNDRA]: "#dadcd3",
  [TAIGA]: "#487460",
  [TEMPERATE_FOREST]: "#87a861",
  [GRASSLAND]: "#cbbd83",
  [DESERT]: "#e6bd66",
  [TROPICAL]: "#2f885a",
  [WETLAND]: "#77b199",
  [ALPINE]: "#9c948a",
};

export const BIOME_NAMES: Record<number, string> = {
  [TUNDRA]: "Tundra",
  [TAIGA]: "Taiga",
  [TEMPERATE_FOREST]: "Forest",
  [GRASSLAND]: "Grassland",
  [DESERT]: "Desert",
  [TROPICAL]: "Tropical",
  [WETLAND]: "Wetland",
  [ALPINE]: "Alpine",
};

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function classifyBiomes(
  grid: Grid,
  heights: number[] | Float32Array,
  terrain: number[] | Uint8Array,
  params: WorldParams
): Uint8Array {
  const n = grid.count;
  const tNoise = createNoise2D(mulberry32(deriveSeed(params.seed, 7001)));
  const mNoise = createNoise2D(mulberry32(deriveSeed(params.seed, 7002)));
  const F = 0.006;
  // land y-extent: temperature is normalised over the continent, not the whole map
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (terrain[i] === T_OCEAN) continue;
    const y = grid.points[i * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1, maxY - minY);
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (terrain[i] === T_OCEAN) { biome[i] = OCEAN; continue; }
    if (terrain[i] === T_MOUNTAIN) { biome[i] = ALPINE; continue; }
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    const h = heights[i];
    const latNorm = (y - minY) / span;
    const temp = clamp01(latNorm + tNoise(x * F, y * F) * 0.12 - Math.max(0, h - params.seaLevel) * 0.8);
    const coastal = grid.neighbors[i].some((j) => terrain[j] === T_OCEAN);
    const moist = clamp01((mNoise(x * F, y * F) * 0.5 + 0.5) + (coastal ? 0.12 : 0));
    if (h < params.seaLevel + 0.05 && moist > 0.6) { biome[i] = WETLAND; continue; }
    if (temp < 0.35) biome[i] = moist < 0.45 ? TUNDRA : TAIGA;
    else if (temp < 0.70) biome[i] = moist < 0.40 ? GRASSLAND : TEMPERATE_FOREST;
    else biome[i] = moist < 0.40 ? DESERT : TROPICAL;
  }
  return biome;
}
