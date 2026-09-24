import type { Province } from "../engine/provinces";
import type { Phonetics } from "../engine/names";
import type { FeatureLabel } from "../engine/featureLabel";

export interface WorldParams {
  seed: number;
  width: number;
  height: number;
  cellCount: number;
  seaLevel: number;
  mountainLevel: number;
  polityCount: number;
  townCount: number;
}

export interface CityMarker {
  id: number;
  cell: number;
  x: number;
  y: number;
  name: string;
  polityId: number;
  isCapital: boolean;
  size: number;
  coastal: boolean;
  elevation: number;
  biome: number;
  river: boolean; // a world river runs through this cell — the drilldown should show it
  // which way the open sea lies from here, in world radians (atan2: +x east, +y south), for
  // coastal cities only. The city plate's north is the world's north, so its water can be laid
  // where the world actually put it instead of on an edge drawn from the town's own rng.
  seaBearing?: number;
  // which way the world's river runs through this town (atan2 radians, +x east, +y south), for river
  // towns only, so the plate's river runs where the world map draws it
  riverBearing?: number;
  // ...and what it does there: how far it turns (radians, from the way its biggest feeder comes in to
  // the way it leaves; positive is clockwise on the map) — absent where it rises at the town, which is
  // where the world map first draws it, no feeder coming in
  riverTurn?: number;
  riverRises?: boolean;
  // ...and how big the world map draws it there: 0 a stream, 1 a river, 2 a great river (see riverSize)
  riverSize?: 0 | 1 | 2;
  // the high ground beside the town: which way the mountain cells next to its own lie (weighted by how
  // far they rise above it) and what share of its neighbours they are — only where some do — so the
  // plate's mountains stand where the world map draws them
  mountainBearing?: number;
  mountainShare?: number;
  // the town's own cell is mountain terrain: the world map draws it in the mountains
  onMountain?: boolean;
  // the lie of the land at a town in the mountains — on a SUMMIT (nothing round it higher), in a
  // VALLEY (higher ground on both sides), on a SPUR (higher ground behind only, falling away on the
  // rest) or on a SLOPE — and which way the high ground runs from it: the ridge on from a summit, the
  // walls of a valley, the rise behind a spur or a slope
  relief?: "summit" | "valley" | "spur" | "slope";
  reliefBearing?: number;
}

export interface Polity {
  id: number;
  capital: number;
  color: string;
  name: string;
}

export interface Region {
  name: string;
  label: FeatureLabel;
  kind: number;
  centroid: [number, number];
  cells: number;
}

export interface RiverSegment {
  x1: number; y1: number; x2: number; y2: number; f: number;
}

export interface River {
  name: string;
  label: FeatureLabel;
  path: [number, number][];
  flux: number;
  mouth: [number, number];
}

// `phon` rides along so anything naming something inside a culture's lands can sound like that
// culture — a ruler of the guttural north should not be named like a southerner. It was dropped
// on the way out of the generator until rulers needed it.
export interface CultureInfo { name: string; color: string; phon: Phonetics }

export interface World {
  params: WorldParams;
  name: string;
  nameLabel: FeatureLabel;
  regions: Region[];
  cultureOf: number[];
  cultures: CultureInfo[];
  grid: {
    width: number;
    height: number;
    count: number;
    points: number[];
    polygons: number[][][];
    neighbors: number[][];
  };
  heights: number[];
  terrain: number[];
  biome: number[];
  polityOf: number[];
  polities: Polity[];
  provinceOf: number[];
  provinces: Province[];
  cities: CityMarker[];
  rivers: River[];
  riverNet: RiverSegment[];
}

export interface GeneratedWorld {
  world: World;
  find(x: number, y: number): number;
}

export const DEFAULT_PARAMS: WorldParams = {
  seed: 1,
  width: 1000,
  height: 700,
  cellCount: 4000,
  seaLevel: 0.3,
  mountainLevel: 0.55,
  polityCount: 8,
  townCount: 20,
};
