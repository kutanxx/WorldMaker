import type { WorldParams, World, GeneratedWorld, CityMarker, Polity } from "../types/world";
import { mulberry32, randInt } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";
import { classifyTerrain, OCEAN } from "./terrain";
import { classifyBiomes } from "./biome";
import { makeNameGen } from "./names";
import { assignPolities } from "./polities";

export function generateWorld(params: WorldParams): GeneratedWorld {
  const rng = mulberry32(params.seed);
  const grid = generateGrid(rng, params.width, params.height, params.cellCount);
  const heights = assignHeights(rng, grid);
  const terrain = classifyTerrain(heights, params.seaLevel, params.mountainLevel);
  const biome = classifyBiomes(grid, heights, terrain, params);
  const { polityOf, seeds } = assignPolities(rng, grid, terrain, params.polityCount);
  const names = makeNameGen(rng);

  const isCoastal = (cell: number) =>
    grid.neighbors[cell].some((n) => terrain[n] === OCEAN);

  const polities: Polity[] = seeds.map((s) => ({
    id: s.id,
    capital: s.capital,
    color: s.color,
    name: names.nation(),
  }));

  const cities: CityMarker[] = [];
  let cityId = 0;
  for (const p of polities) {
    cities.push({
      id: cityId++,
      cell: p.capital,
      x: grid.points[p.capital * 2],
      y: grid.points[p.capital * 2 + 1],
      name: names.place(),
      polityId: p.id,
      isCapital: true,
      size: randInt(rng, 3, 6),
      coastal: isCoastal(p.capital),
      elevation: heights[p.capital],
      biome: biome[p.capital],
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
      name: names.place(),
      polityId: polityOf[cell],
      isCapital: false,
      size: randInt(rng, 1, 3),
      coastal: isCoastal(cell),
      elevation: heights[cell],
      biome: biome[cell],
    });
  }

  const world: World = {
    params,
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
  };
  return { world, find: grid.find };
}
