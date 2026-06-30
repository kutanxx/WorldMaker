import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid } from "./geometry";
import { selectArchetype } from "./city/archetypes";
import type { Archetype } from "./city/archetypes";
import { makeTensorField } from "./city/tensorField";
import type { BasisField, Vec } from "./city/tensorField";
import { generateStreets } from "./city/streets";
import { buildWater, inWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import { buildWall, buildMoat } from "./city/walls";
import type { Wall } from "./city/walls";
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
  archetype: Archetype;
  bounds: { w: number; h: number };
  water: Water;
  wall: Wall | null;
  moat: Polygon | null;
  mainRoads: Polyline[];
  minorRoads: Polyline[];
  wards: Ward[];
  parks: Polygon[];
  labels: { x: number; y: number; text: string }[];
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  elevation: number;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital, elevation: c.elevation };
}

function fieldsFor(arch: Archetype, center: Vec, rng: Rng): BasisField[] {
  const fields: BasisField[] = [];
  if (arch.streetField === "radial") {
    fields.push({ kind: "radial", center, size: 260, decay: 1, theta: 0 });
  } else if (arch.streetField === "grid") {
    fields.push({ kind: "grid", center, size: 400, decay: 1, theta: rng() * Math.PI });
  } else if (arch.streetField === "linear") {
    fields.push({ kind: "grid", center, size: 400, decay: 1, theta: rng() < 0.5 ? 0 : Math.PI / 2 });
  } else {
    fields.push({ kind: "grid", center, size: 220, decay: 1, theta: rng() * Math.PI });
    fields.push({ kind: "radial", center, size: 160, decay: 0.7, theta: 0 });
  }
  return fields;
}

const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, suburb: 200, military: 260,
};

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Vec = [150, 150];
  const radius = 60 + ctx.size * 12;
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size }, rng);

  const water = buildWater(rng, archetype.water, bounds);
  const noiseAmp = archetype.streetField === "grid" || archetype.streetField === "linear" ? 0.08 : 0.22;
  const field = makeTensorField(rng, fieldsFor(archetype, center, rng), noiseAmp);
  const insideRegion = (p: Point) =>
    Math.hypot(p[0] - center[0], p[1] - center[1]) <= radius && !inWater(water, p);
  const stop = (p: Vec) => !insideRegion(p);

  const seedCandidates: Vec[] = [center];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    seedCandidates.push([center[0] + Math.cos(a) * radius * 0.45, center[1] + Math.sin(a) * radius * 0.45]);
  }
  const drySeeds = seedCandidates.filter((p) => insideRegion(p));
  const seeds: Vec[] = drySeeds.length > 0 ? drySeeds : [center];

  const mainRoads = generateStreets(field, { dsep: 34, dtest: 17, step: 3, maxLength: 220, bounds, useMinor: false }, stop, seeds);
  const minorRoads = generateStreets(field, { dsep: 15, dtest: 7, step: 3, maxLength: 160, bounds, useMinor: true }, stop, seeds);
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water);

  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };

  let cells = generateWards(rng, center[0], center[1], radius, 8 + ctx.size * 3);
  cells = cells.filter((c) => !inWater(water, c.site));
  const zoned = assignZones(rng, cells, center, radius, { hasCastle: ctx.isCapital || ctx.size >= 4, coastal: ctx.coastal });

  const innerWards = zoned.filter((w) => w.inner);
  const wall = innerWards.length >= 3 ? buildWall(innerWards, 2 + (ctx.size >= 3 ? 1 : 0) + (ctx.isCapital ? 1 : 0)) : null;
  const moat = wall ? buildMoat(wall.ring, 6) : null;

  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") { parks.push(z.polygon); return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner }; }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        return !inWater(water, c) && !nearRoad(c);
      });
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });

  const labels: { x: number; y: number; text: string }[] = [];
  const LABEL: Partial<Record<WardType, string>> = { plaza: "Market", castle: "Keep", cathedral: "Cathedral", guildhall: "Guildhall", harbor: "Harbor" };
  for (const z of zoned) {
    const t = LABEL[z.type];
    if (t) { const c = centroid(z.polygon); labels.push({ x: c[0], y: c[1], text: t }); }
  }

  return {
    name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital,
    archetype, bounds, water, wall, moat, mainRoads, minorRoads, wards, parks, labels,
  };
}
