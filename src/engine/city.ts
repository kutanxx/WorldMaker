import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, pointInPolygon } from "./geometry";
import { selectArchetype } from "./city/archetypes";
import type { Archetype } from "./city/archetypes";
import { makeTensorField } from "./city/tensorField";
import type { BasisField, Vec } from "./city/tensorField";
import { generateStreets } from "./city/streets";
import { buildWater, inWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
import { makeBoundary } from "./city/cityBoundary";
import { wallFromDefenses } from "./city/walls";
import type { DefenseWall } from "./city/walls";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import type { CityMarker } from "../types/world";

export interface Ward {
  polygon: Polygon;
  type: WardType;
  buildings: Polygon[];
  inner: boolean;
}

export interface CityFeatures {
  wallMaterial: "stone" | "timber";
  trees: Point[];
  onStilts: boolean;
  oasis: { center: Point; radius: number } | null;
  groundColor: string;
}

export interface CityLayout {
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  archetype: Archetype;
  bounds: { w: number; h: number };
  boundary: Polygon;
  water: Water;
  wall: DefenseWall | null;
  moat: Polyline[] | null;
  gateBridges: Polyline[];
  mainRoads: Polyline[];
  minorRoads: Polyline[];
  wards: Ward[];
  parks: Polygon[];
  labels: { x: number; y: number; text: string }[];
  features: CityFeatures;
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  elevation: number;
  biome: number;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital, elevation: c.elevation, biome: c.biome };
}

function fieldsFor(arch: Archetype, center: Vec, radius: number, rng: Rng): BasisField[] {
  const fields: BasisField[] = [];
  if (arch.streetField === "radial") fields.push({ kind: "radial", center, size: radius * 3, decay: 1, theta: 0 });
  else fields.push({ kind: "grid", center, size: radius * 4, decay: 1, theta: rng() * Math.PI });
  // offset secondary centres bend the field so streamlines genuinely curve
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2;
    const oc: Vec = [center[0] + Math.cos(a) * radius * 0.7, center[1] + Math.sin(a) * radius * 0.7];
    fields.push({ kind: i === 0 ? "radial" : "grid", center: oc, size: radius * 1.4, decay: 0.6, theta: rng() * Math.PI });
  }
  return fields;
}

function offsetSegment(seg: Polyline, c: Point, d: number): Polyline {
  return seg.map((p) => {
    const dx = p[0] - c[0], dy = p[1] - c[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * d, p[1] + (dy / len) * d] as Point;
  });
}

const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, suburb: 200, military: 260,
};
const MOAT_ARCHETYPES = new Set(["coastalPort", "bridgeTown", "plainsMarket"]);

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Vec = [150, 150];
  const radius = 60 + ctx.size * 12;
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size, biome: ctx.biome });

  const water = buildWater(rng, archetype.water, bounds);
  const boundary = makeBoundary(rng, archetype, ctx.size, center, water);

  const noiseAmp = archetype.streetField === "grid" || archetype.streetField === "linear" ? 0.2 : 0.26;
  // determinism: fieldsFor() consumes rng (3 draws) BEFORE makeTensorField()'s noise draw — keep this call order.
  const field = makeTensorField(rng, fieldsFor(archetype, center, radius, rng), noiseAmp);
  const insideRegion = (p: Point) => pointInPolygon(p, boundary) && !inWater(water, p);
  const stop = (p: Vec) => !insideRegion(p);

  const seedCandidates: Vec[] = [center];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    seedCandidates.push([center[0] + Math.cos(a) * radius * 0.45, center[1] + Math.sin(a) * radius * 0.45]);
  }
  const drySeeds = seedCandidates.filter((p) => insideRegion(p));
  const seeds: Vec[] = drySeeds.length > 0 ? drySeeds : [center];

  const mainRoads = generateStreets(field, { dsep: 34, dtest: 17, step: 3, maxLength: 240, bounds, useMinor: false }, stop, seeds);
  const minorRoads = generateStreets(field, { dsep: 15, dtest: 7, step: 3, maxLength: 180, bounds, useMinor: true }, stop, seeds);
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water);

  const wall = wallFromDefenses(boundary, water, mainRoads); // gates sit where main roads meet the wall
  const moat = MOAT_ARCHETYPES.has(archetype.id) ? wall.segments.map((s) => offsetSegment(s, center, 6)) : null;
  // a causeway crossing the moat in front of each gate, so there is a way in
  const gateBridges: Polyline[] = moat
    ? wall.gates.map((g) => {
        const dx = g[0] - center[0], dy = g[1] - center[1];
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        return [[g[0] - ux * 3, g[1] - uy * 3], [g[0] + ux * 11, g[1] + uy * 11]];
      })
    : [];

  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };

  let cells = generateWards(rng, center[0], center[1], radius * 1.15, 8 + ctx.size * 3);
  cells = cells.filter((c) => pointInPolygon(c.site, boundary) && !inWater(water, c.site));
  const zoned = assignZones(rng, cells, [center[0], center[1]], radius, { hasCastle: ctx.isCapital || ctx.size >= 4, coastal: ctx.coastal });

  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") { parks.push(z.polygon); return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner }; }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        return pointInPolygon(c, boundary) && !inWater(water, c) && !nearRoad(c);
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

  const features: CityFeatures = {
    wallMaterial: archetype.wallMaterial,
    trees: [],
    onStilts: archetype.onStilts,
    oasis: null,
    groundColor: archetype.groundColor,
  };

  return {
    name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital,
    archetype, bounds, boundary, water, wall, moat, gateBridges, mainRoads, minorRoads, wards, parks, labels, features,
  };
}
