import type { WorldParams, World, GeneratedWorld, CityMarker, Polity } from "../types/world";
import { mulberry32, deriveSeed, randInt } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";
import { classifyTerrain, OCEAN } from "./terrain";
import { classifyBiomes } from "./biome";
import { makeNameGen, DEFAULT_PHON } from "./names";
import { assignPolities } from "./polities";
import { detectRegions, nameGeography, worldName } from "./geography";
import { assignCultures } from "./culture";
import { traceRivers, nameRivers } from "./rivers";

export function generateWorld(params: WorldParams): GeneratedWorld {
  const rng = mulberry32(params.seed);
  const grid = generateGrid(rng, params.width, params.height, params.cellCount);
  const heights = assignHeights(rng, grid);
  const terrain = classifyTerrain(heights, params.seaLevel, params.mountainLevel);
  const biome = classifyBiomes(grid, heights, terrain, params);
  const { polityOf, seeds } = assignPolities(rng, grid, terrain, params.polityCount);

  // cultures assigned on a SEPARATE stream (no main-stream draw); naming keeps the exact
  // main-stream draw structure (makeNameGen with a profile draws identically), so geometry
  // (polityOf/city cells/sizes) is byte-unchanged — only the name STRINGS become culture-flavoured.
  const cultRng = mulberry32(deriveSeed(params.seed, 6001));
  const cultCount = Math.min(5, 3 + Math.floor(params.polityCount / 4));
  const { cultureOf, cultures } = assignCultures(cultRng, grid, Array.from(terrain), cultCount);
  const phonAt = (cell: number) => cultures[cultureOf[cell]]?.phon ?? DEFAULT_PHON;

  const isCoastal = (cell: number) =>
    grid.neighbors[cell].some((n) => terrain[n] === OCEAN);

  const polities: Polity[] = seeds.map((s) => ({
    id: s.id,
    capital: s.capital,
    color: s.color,
    name: makeNameGen(rng, phonAt(s.capital)).nation(),
  }));

  // river GEOMETRY is rng-free (reads heights/terrain/biome), so tracing it here — before the
  // cities — leaves the main rng stream (and the golden regression) byte-unchanged while letting
  // each city know whether a world river runs through its cell (names still draw on stream 8002).
  const { segments, trunks, riverCells } = traceRivers(grid, heights, terrain, biome);

  const cities: CityMarker[] = [];
  let cityId = 0;
  for (const p of polities) {
    cities.push({
      id: cityId++,
      cell: p.capital,
      x: grid.points[p.capital * 2],
      y: grid.points[p.capital * 2 + 1],
      name: makeNameGen(rng, phonAt(p.capital)).place(),
      polityId: p.id,
      isCapital: true,
      size: randInt(rng, 3, 6),
      coastal: isCoastal(p.capital),
      elevation: heights[p.capital],
      biome: biome[p.capital],
      river: riverCells.has(p.capital),
    });
  }

  // polityOf[i] is both the polity id and its index into polities[] (seeds are id-ordered)
  const claimedLand: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (polityOf[i] >= 0 && i !== polities[polityOf[i]].capital) claimedLand.push(i);
  }
  for (let t = 0; t < params.townCount && claimedLand.length > 0; t++) {
    const idx = randInt(rng, 0, claimedLand.length - 1);
    const cell = claimedLand[idx];
    claimedLand[idx] = claimedLand[claimedLand.length - 1];
    claimedLand.pop();
    cities.push({
      id: cityId++,
      cell,
      x: grid.points[cell * 2],
      y: grid.points[cell * 2 + 1],
      name: makeNameGen(rng, phonAt(cell)).place(),
      polityId: polityOf[cell],
      isCapital: false,
      size: randInt(rng, 1, 3),
      coastal: isCoastal(cell),
      elevation: heights[cell],
      biome: biome[cell],
      river: riverCells.has(cell),
    });
  }

  // geography names use a SEPARATE rng stream so the main stream (heights/terrain/biome/
  // polity/cities and the golden regression) is byte-unchanged; reads the built biome array
  const geoRng = mulberry32(deriveSeed(params.seed, 8001));
  const regions = nameGeography(geoRng, detectRegions(grid, Array.from(biome), Array.from(terrain)));
  const name = worldName(geoRng);

  // river NAMES on a SEPARATE stream (8002); geometry was already traced (rng-free) above, so the
  // golden regression stays byte-unchanged
  const rivRng = mulberry32(deriveSeed(params.seed, 8002));
  const rivers = nameRivers(rivRng, trunks, phonAt);

  const world: World = {
    params,
    name,
    regions,
    cultureOf: Array.from(cultureOf),
    cultures: cultures.map((c) => ({ name: c.name, color: c.color })),
    grid: {
      width: grid.width,
      height: grid.height,
      count: grid.count,
      points: grid.points,
      polygons: grid.polygons,
      neighbors: grid.neighbors,
    },
    heights: Array.from(heights),
    terrain: Array.from(terrain),
    biome: Array.from(biome),
    polityOf: Array.from(polityOf),
    polities,
    cities,
    rivers,
    riverNet: segments,
  };
  return { world, find: grid.find };
}
