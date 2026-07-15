import type { Province } from "../engine/provinces";

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
}

export interface Polity {
  id: number;
  capital: number;
  color: string;
  name: string;
}

export interface Region {
  name: string;
  kind: number;
  centroid: [number, number];
  cells: number;
}

export interface RiverSegment {
  x1: number; y1: number; x2: number; y2: number; f: number;
}

export interface River {
  name: string;
  path: [number, number][];
  flux: number;
  mouth: [number, number];
}

export interface CultureInfo { name: string; color: string }

export interface World {
  params: WorldParams;
  name: string;
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
