import type { Rng } from "./rng";
import { pick } from "./rng";
import { makeNameGen } from "./names";
import type { Region } from "../types/world";
import {
  OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE,
} from "./biome";

export type { Region };
interface RawRegion { kind: number; centroid: [number, number]; cells: number }

type GridLike = { count: number; neighbors: number[][]; points: number[] };

const MIN_CELLS = 35;   // ignore specks
const MAX_REGIONS = 12; // avoid label clutter (land)
const MAX_SEAS = 2;

// feature nouns by biome kind (research: the noun depends on the terrain)
const NOUNS: Record<number, string[]> = {
  [OCEAN]: ["Sea", "Deep", "Gulf", "Waters", "Expanse", "Main"],
  [TUNDRA]: ["Tundra", "Frostlands", "Barrens"],
  [TAIGA]: ["Pinewood", "Taiga", "Wilds"],
  [TEMPERATE_FOREST]: ["Forest", "Woods", "Wilds", "Reach", "Wold"],
  [GRASSLAND]: ["Plains", "Steppe", "Downs", "Fields"],
  [DESERT]: ["Wastes", "Sands", "Dunes", "Barrens"],
  [TROPICAL]: ["Jungle", "Rainforest", "Wilds"],
  [WETLAND]: ["Marsh", "Fens", "Mire", "Moor"],
  [ALPINE]: ["Peaks", "Mountains", "Range", "Spires", "Heights"],
};
const ADJ = ["Ashen", "Grey", "Green", "Golden", "White", "Black", "Bitter", "Broken",
  "Endless", "Silent", "Frozen", "Shrouded", "Sunken", "Hollow", "Iron", "Amber",
  "Pale", "Riven", "Cold", "Old"];
const WORLD_NOUN = ["Realm", "Lands", "Reaches", "Dominion", "Expanse"];

// same-biome connected components (land) + the deepest point of the largest sea(s)
export function detectRegions(grid: GridLike, biome: number[], terrain: number[]): RawRegion[] {
  const n = grid.count;
  const seen = new Uint8Array(n);
  const land: RawRegion[] = [];
  const seas: { size: number; deepestCell: number }[] = [];

  // coast-distance for ocean cells (multi-source BFS from coast-adjacent ocean)
  const coastDist = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < n; c++) {
    if (terrain[c] !== OCEAN) continue;
    if (grid.neighbors[c].some((nb) => terrain[nb] !== OCEAN)) { coastDist[c] = 0; frontier.push(c); }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) for (const nb of grid.neighbors[c]) {
      if (terrain[nb] === OCEAN && coastDist[nb] < 0) { coastDist[nb] = coastDist[c] + 1; next.push(nb); }
    }
    frontier = next;
  }

  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const b = biome[start];
    seen[start] = 1;
    const comp = [start];
    for (let qi = 0; qi < comp.length; qi++) {
      for (const nb of grid.neighbors[comp[qi]]) {
        if (!seen[nb] && biome[nb] === b) { seen[nb] = 1; comp.push(nb); }
      }
    }
    if (b === OCEAN) {
      let deepest = comp[0], dd = -1;
      for (const c of comp) if (coastDist[c] > dd) { dd = coastDist[c]; deepest = c; }
      seas.push({ size: comp.length, deepestCell: deepest });
      continue;
    }
    if (comp.length < MIN_CELLS) continue;
    let sx = 0, sy = 0;
    for (const c of comp) { sx += grid.points[c * 2]; sy += grid.points[c * 2 + 1]; }
    const mx = sx / comp.length, my = sy / comp.length;
    // anchor at the member cell nearest the mean (a medoid), so the label always sits ON the
    // region — a raw centroid can fall in the sea or a neighbouring biome for a concave region
    let best = comp[0], bd = Infinity;
    for (const c of comp) { const dx = grid.points[c * 2] - mx, dy = grid.points[c * 2 + 1] - my; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
    land.push({ kind: b, centroid: [grid.points[best * 2], grid.points[best * 2 + 1]], cells: comp.length });
  }

  land.sort((a, b) => b.cells - a.cells);
  const regions = land.slice(0, MAX_REGIONS);
  seas.sort((a, b) => b.size - a.size);
  for (const s of seas.slice(0, MAX_SEAS)) {
    regions.push({ kind: OCEAN, centroid: [grid.points[s.deepestCell * 2], grid.points[s.deepestCell * 2 + 1]], cells: s.size });
  }
  return regions;
}

function featureName(rng: Rng, ng: { nation(): string }, kind: number): string {
  const noun = pick(rng, NOUNS[kind] ?? ["Land"]);
  const r = rng();
  if (r < 0.45) return `the ${pick(rng, ADJ)} ${noun}`;
  if (r < 0.75) return `${noun} of ${ng.nation()}`;
  return `${ng.nation()} ${noun}`;
}

export function nameGeography(rng: Rng, raws: RawRegion[]): Region[] {
  const ng = makeNameGen(rng);
  return raws.map((r) => ({ name: featureName(rng, ng, r.kind), kind: r.kind, centroid: r.centroid, cells: r.cells }));
}

export function worldName(rng: Rng): string {
  const ng = makeNameGen(rng);
  return rng() < 0.5 ? ng.nation() : `the ${pick(rng, ADJ)} ${pick(rng, WORLD_NOUN)}`;
}
