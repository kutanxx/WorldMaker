import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, pointInPolygon } from "./geometry";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import { buildWall, buildMoat } from "./city/walls";
import type { Wall } from "./city/walls";
import { buildRoads } from "./city/roads";
import { buildWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
import type { CityMarker } from "../types/world";

export interface Ward {
  polygon: Polygon;
  type: WardType;
  buildings: Polygon[];
  inner: boolean;
}

export interface CityLayout {
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  bounds: { w: number; h: number };
  water: Water | null;
  moat: Polygon | null;
  wall: Wall | null;
  roads: Polyline[];
  wards: Ward[];
  labels: { x: number; y: number; text: string }[];
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital };
}

const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170,
  patriciate: 240, suburb: 200, military: 260,
};

function buildingMinArea(type: WardType): number {
  return DENSITY[type] ?? 130;
}

function wardLabel(type: WardType): string | null {
  const m: Partial<Record<WardType, string>> = {
    plaza: "Market", castle: "Keep", cathedral: "Cathedral", guildhall: "Guildhall", harbor: "Harbor",
  };
  return m[type] ?? null;
}

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Point = [150, 150];
  const radius = 60 + ctx.size * 12;
  const wardCount = 8 + ctx.size * 3;
  const hasCastle = ctx.isCapital || ctx.size >= 4;
  const gateCount = 2 + (ctx.size >= 3 ? 1 : 0) + (ctx.isCapital ? 1 : 0);

  const water = ctx.coastal ? buildWater(rng, bounds) : null;

  let cells = generateWards(rng, center[0], center[1], radius, wardCount);
  if (water) {
    cells = cells.filter((c) => !pointInPolygon(c.site, water.polygon));
  }

  const zoned = assignZones(rng, cells, center, radius, { hasCastle, coastal: ctx.coastal });

  const innerWards = zoned.filter((w) => w.inner);
  const wall = innerWards.length >= 3 ? buildWall(innerWards, gateCount) : null;
  const moat = wall ? buildMoat(wall.ring, 6) : null;
  const roads = wall ? buildRoads(center, wall.gates) : [];
  if (water && roads.length) water.bridges = waterBridges(roads, water.polygon);

  const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
  const wards: Ward[] = zoned.map((z) => {
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: buildingMinArea(z.type), margin: 1.5 });
      if (water) {
        buildings = buildings.filter((b) => {
          // Drop building if area-weighted centroid is inside water
          if (pointInPolygon(centroid(b), water.polygon)) return false;
          // Also drop if any vertex is inside water (stricter boundary filter)
          if (b.some((v) => pointInPolygon(v, water.polygon))) return false;
          return true;
        });
      }
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });

  const labels: { x: number; y: number; text: string }[] = [];
  for (const z of zoned) {
    const text = wardLabel(z.type);
    if (text) {
      const c = centroid(z.polygon);
      labels.push({ x: c[0], y: c[1], text });
    }
  }

  return { name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital, bounds, water, moat, wall, roads, wards, labels };
}
