import type { Rng } from "./rng";
import { pick } from "./rng";
import { makeNameGen } from "./names";
import type { Region } from "../types/world";
import { featureLabel, type FeatureLabel } from "./featureLabel";
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
export const NOUNS: Record<number, string[]> = {
  [OCEAN]: ["Sea", "Deep", "Gulf", "Waters", "Expanse", "Main"],
  // ⚠ Sized by measurement, not by taste. Over sixty seeds the most regions of ONE kind a world
  // raised was: tundra 4, taiga 4, forest 4, alpine 4, grassland 3, tropical 3, ocean 2, desert 2,
  // wetland 1. A table shorter than its own maximum cannot avoid repeating itself however well the
  // walk works — three of these were, which is what left 5 of 20 worlds calling two places the same
  // thing after the walk landed.
  // ⚠ And a SHARED word shortens both tables that hold it, because whichever biome draws first
  // takes it: `Wilds` sat in taiga, forest AND tropical, so a map with four taiga regions could be
  // down to two usable words. `Wilds` is now taiga's alone. `Barrens` still spans tundra and desert
  // — deliberately: desert peaks at 2 against a 4-word table, so it can spare one.
  [TUNDRA]: ["Tundra", "Frostlands", "Barrens", "Snows", "Icefields"],
  [TAIGA]: ["Pinewood", "Taiga", "Wilds", "Firwood", "Hinterland"],
  [TEMPERATE_FOREST]: ["Forest", "Woods", "Greenwood", "Reach", "Wold"],
  [GRASSLAND]: ["Plains", "Steppe", "Downs", "Fields"],
  [DESERT]: ["Wastes", "Sands", "Dunes", "Barrens"],
  [TROPICAL]: ["Jungle", "Rainforest", "Thickets", "Cloudwood"],
  [WETLAND]: ["Marsh", "Fens", "Mire", "Moor"],
  [ALPINE]: ["Peaks", "Mountains", "Range", "Spires", "Heights"],
};
export const ADJ = ["Ashen", "Grey", "Green", "Golden", "White", "Black", "Bitter", "Broken",
  "Endless", "Silent", "Frozen", "Shrouded", "Sunken", "Hollow", "Iron", "Amber",
  "Pale", "Riven", "Cold", "Old"];
export const WORLD_NOUN = ["Realm", "Lands", "Reaches", "Dominion", "Expanse"];

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

export function featureName(rng: Rng, ng: { nation(): string }, kind: number): { name: string; label: FeatureLabel } {
  const noun = pick(rng, NOUNS[kind] ?? ["Land"]);
  const r = rng();
  // ⚠ The branches must draw in the SAME ORDER as the if-chain they replace — noun, then r, then
  // either an adjective or a nation — or every world downstream of this call moves.
  const label: FeatureLabel = r < 0.45
    ? { pattern: "adj", kind, adj: pick(rng, ADJ), noun }
    : r < 0.75
      ? { pattern: "of", kind, noun, proper: ng.nation() }
      : { pattern: "attributive", kind, noun, proper: ng.nation() };
  return { name: featureLabel(label, "en"), label };
}

// Measured over twenty seeds: 15 of 20 worlds called two different regions by the same noun, because
// `Wilds` is registered in TAIGA, TEMPERATE_FOREST and TROPICAL at once and took 22 of 247 regions
// between them. A retry (redraw the noun until it's free) would work, but every draw after it in the
// same rng stream is downstream of world geometry — a retry loop would silently move the map. So a
// taken noun is instead WALKED to the next free entry in its own biome's table, starting from the
// index it drew: no rng is touched, exactly the technique `lengthen()` in names.ts already uses for
// too-short names. If the whole table is already spoken for, the repeat is kept rather than reaching
// into another biome's list — a borrowed word would say a forest is a desert.
export function nameGeography(rng: Rng, raws: RawRegion[]): Region[] {
  const ng = makeNameGen(rng);
  const usedNouns = new Set<string>();
  const regions = raws.map((r) => {
    let { name, label } = featureName(rng, ng, r.kind);
    if (usedNouns.has(label.noun)) {
      const list = NOUNS[r.kind] ?? ["Land"];
      const start = list.indexOf(label.noun);
      for (let step = 1; step <= list.length; step++) {
        const candidate = list[(start + step) % list.length];
        if (!usedNouns.has(candidate)) {
          label = { ...label, noun: candidate };
          name = featureLabel(label, "en");
          break;
        }
      }
    }
    usedNouns.add(label.noun);
    return { name, label, kind: r.kind, centroid: r.centroid, cells: r.cells };
  });
  return regions;
}

export function worldName(rng: Rng): { name: string; label: FeatureLabel } {
  const ng = makeNameGen(rng);
  const label: FeatureLabel = rng() < 0.5
    ? { pattern: "attributive", kind: -1, noun: "", proper: ng.nation() }
    : { pattern: "adj", kind: -1, adj: pick(rng, ADJ), noun: pick(rng, WORLD_NOUN) };
  return { name: featureLabel(label, "en"), label };
}
