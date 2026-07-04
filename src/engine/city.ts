import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, pointInPolygon, bbox, pointSegDist } from "./geometry";
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
import { makeMountains, inMountains } from "./city/mountain";
import type { MountainMass } from "./city/mountain";
import { makeHarbor } from "./city/harbor";
import type { Harbor } from "./city/harbor";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import { generateCountryside } from "./city/countryside";
import type { Countryside } from "./city/countryside";
import { makeCastle } from "./city/castle";
import type { Castle } from "./city/castle";
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

export interface Outwork { type: "watermill" | "windmill"; at: Point; angle: number; race?: [Point, Point]; }
// extramural landmarks OUTSIDE the walls (research: abbey/cemetery/gallows sat beyond the gates)
export interface Abbey { at: Point; angle: number; }
export interface Cemetery { at: Point; graves: Point[]; }

export interface CityLayout {
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  archetype: Archetype;
  bounds: { w: number; h: number };
  boundary: Polygon;
  water: Water;
  mountains: MountainMass[];
  wall: DefenseWall | null;
  moat: Polyline[] | null;
  gateBridges: Polyline[];
  mainRoads: Polyline[];
  minorRoads: Polyline[];
  wards: Ward[];
  parks: Polygon[];
  labels: { x: number; y: number; type: WardType }[];
  features: CityFeatures;
  suburbRoads: Polyline[];
  suburbs: Polygon[];
  outworks: Outwork[];
  harbor: Harbor | null;
  abbey: Abbey | null;
  cemetery: Cemetery | null;
  gallows: Point | null;
  countryside: Countryside;
  castle: Castle | null;
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

const NO_BUILDINGS: WardType[] = ["plaza", "park", "castle"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, military: 260,
};
const MOAT_ARCHETYPES = new Set(["coastalPort", "bridgeTown", "plainsMarket"]);

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 460, h: 460 };
  const center: Vec = [230, 230];
  const radius = 60 + ctx.size * 12;
  // mountain-variant pick uses a SEPARATE rng stream so the main stream (and thus every
  // existing non-mountain city) is byte-identical; only high-elevation form choice changes.
  const pick = mulberry32(deriveSeed(worldSeed, ctx.id + 4200))();
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size, biome: ctx.biome, pick });

  const water = buildWater(rng, archetype.water, bounds);
  if (archetype.oasis) {
    const or = radius * 0.12;
    const oasisPoly: Polygon = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; oasisPoly.push([center[0] + Math.cos(a) * or, center[1] + Math.sin(a) * or]); }
    water.bodies.push(oasisPoly);
  }
  const boundary = makeBoundary(rng, archetype, ctx.size, center, water);
  const mountains = makeMountains(rng, archetype, boundary, [center[0], center[1]], bounds);

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

  // a few well-placed main gates rather than one at every road (medieval towns had 2-4)
  const maxGates = 2 + Math.floor(ctx.size / 3);
  const wall = wallFromDefenses(boundary, water, mountains, mainRoads, maxGates);
  // moat follows the wall offset outward; where that offset would fall in the sea, keep the wall point
  const moat = MOAT_ARCHETYPES.has(archetype.id)
    ? wall.segments.map((s) => offsetSegment(s, center, 6).map((o, i) => (inWater(water, o) ? s[i] : o)))
    : null;
  // a causeway crossing the moat in front of each gate, so there is a way in
  const gateBridges: Polyline[] = moat
    ? wall.gates
        .map((g): Polyline | null => {
          const dx = g[0] - center[0], dy = g[1] - center[1];
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;
          const outer: Point = [g[0] + ux * 11, g[1] + uy * 11];
          if (inWater(water, outer)) return null; // waterfront gate: no causeway into the sea
          return [[g[0] - ux * 3, g[1] - uy * 3], outer];
        })
        .filter((b): b is Polyline => b !== null)
    : [];

  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };

  let cells = generateWards(rng, center[0], center[1], radius * 1.15, 8 + ctx.size * 3);
  cells = cells.filter((c) => pointInPolygon(c.site, boundary) && !inWater(water, c.site));
  // the keep sits on the high ground: anchor it toward the mountain mass, if any
  let castleAnchor: Point | undefined;
  if (mountains.length) {
    let sx = 0, sy = 0, cnt = 0;
    for (const m of mountains) for (const p of m.innerEdge) { sx += p[0]; sy += p[1]; cnt++; }
    const mx = sx / cnt, my = sy / cnt;
    castleAnchor = [center[0] + (mx - center[0]) * 0.7, center[1] + (my - center[1]) * 0.7];
  }
  // sea direction for harbor placement: the mean of the sea body's vertices points toward
  // the coast, so the ward nearest it is the seaward one (docks belong on the water side).
  let seaAnchor: Point | undefined;
  if (ctx.coastal && water.kind === "sea" && water.bodies.length) {
    const sea = water.bodies[0];
    let sx = 0, sy = 0;
    for (const p of sea) { sx += p[0]; sy += p[1]; }
    seaAnchor = [sx / sea.length, sy / sea.length];
  }
  // the lord's castle sits AT the town wall (research: urban castle) unless a mountain
  // anchor already claims the high ground. Bias the wall pick away from the sea side.
  if (!castleAnchor) {
    let v: Point;
    if (seaAnchor) {
      // coastal: put the castle on the wall run farthest from the harbor side
      let bi = 0, bd = -Infinity;
      for (let i = 0; i < boundary.length; i++) {
        const d = Math.hypot(boundary[i][0] - seaAnchor[0], boundary[i][1] - seaAnchor[1]);
        if (d > bd) { bd = d; bi = i; }
      }
      v = boundary[bi];
    } else {
      v = boundary[Math.floor(rng() * boundary.length)]; // inland: any stretch of wall
    }
    castleAnchor = [center[0] + (v[0] - center[0]) * 0.85, center[1] + (v[1] - center[1]) * 0.85];
  }
  const zoned = assignZones(rng, cells, [center[0], center[1]], radius, { hasCastle: true, coastal: ctx.coastal, castleAnchor, seaAnchor });

  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") {
      if (!archetype.oasis) parks.push(z.polygon); // desert: no green parks
      return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner };
    }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        const dryOk = archetype.onStilts || !inWater(water, c);
        return pointInPolygon(c, boundary) && dryOk && !nearRoad(c);
      });
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });

  // landmark districts get an on-map label; the display TEXT is localised at render time from
  // the ward type (so KO/EN can switch without regenerating the city).
  const LABELLED: WardType[] = ["plaza", "castle", "cathedral", "guildhall", "harbor"];
  const labels: { x: number; y: number; type: WardType }[] = [];
  for (const z of zoned) {
    if (LABELLED.includes(z.type)) { const c = centroid(z.polygon); labels.push({ x: c[0], y: c[1], type: z.type }); }
  }

  // the lord's castle: built from the zoned castle ward polygon, right after wards/labels
  // and before features/extramural work (its rng draws are part of the main stream tail here).
  const castleWard = zoned.find((z) => z.type === "castle") ?? null;
  const castle = castleWard ? makeCastle(rng, castleWard.polygon, [center[0], center[1]], boundary, ctx.size) : null;

  const allBuildings = wards.flatMap((w) => w.buildings);
  const scatterTrees = (n: number): Point[] => {
    const out: Point[] = [];
    const bb = bbox(boundary);
    let tries = 0;
    while (out.length < n && tries < n * 10) {
      tries++;
      const p: Point = [bb.minX + rng() * (bb.maxX - bb.minX), bb.minY + rng() * (bb.maxY - bb.minY)];
      if (!pointInPolygon(p, boundary) || inWater(water, p) || nearRoad(p)) continue;
      if (allBuildings.some((b) => pointInPolygon(p, b))) continue;
      if (out.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 6)) continue;
      out.push(p);
    }
    return out;
  };

  const features: CityFeatures = {
    wallMaterial: archetype.wallMaterial,
    trees: archetype.vegetation === "trees" ? scatterTrees(18 + ctx.size * 4) : [],
    onStilts: archetype.onStilts,
    oasis: archetype.oasis ? { center: [center[0], center[1]], radius: radius * 0.12 } : null,
    groundColor: archetype.groundColor,
  };

  // ---- extramural suburbs (faubourg) + outworks: OUTSIDE the wall, in the canvas margin ----
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const suburbRoads: Polyline[] = [];
  const suburbs: Polygon[] = [];
  for (const g of wall.gates) {
    const dx = g[0] - center[0], dy = g[1] - center[1];
    const gl = Math.hypot(dx, dy) || 1;
    const ux = dx / gl, uy = dy / gl;        // outward unit
    const nx = -uy, ny = ux;                  // perpendicular unit
    const start: Point = [g[0] + ux * 8, g[1] + uy * 8]; // clear wall + moat
    const distX = ux > 0.001 ? (bounds.w - 3 - start[0]) / ux : ux < -0.001 ? (3 - start[0]) / ux : Infinity;
    const distY = uy > 0.001 ? (bounds.h - 3 - start[1]) / uy : uy < -0.001 ? (3 - start[1]) / uy : Infinity;
    const room = Math.min(distX, distY);
    if (room < 14 || inWater(water, start) || inMountains(mountains, start) || !inCanvas(start)) continue;
    const L = room - 1;                       // run all the way to the canvas edge
    const end: Point = [start[0] + ux * L, start[1] + uy * L];
    if (inWater(water, end)) continue; // don't run a highway into the sea
    // gentle bend at the midpoint so the highway reads hand-drawn, not ruled
    const bendOff = (rng() - 0.5) * 12;
    const mid: Point = [start[0] + ux * L * 0.5 + nx * bendOff, start[1] + uy * L * 0.5 + ny * bendOff];
    suburbRoads.push([[g[0], g[1]], inWater(water, mid) || inMountains(mountains, mid) ? [start[0] + ux * L * 0.5, start[1] + uy * L * 0.5] : mid, end]);
    // faubourg ribbon: houses flank the first stretch out of the gate, thinning with distance
    const ribbon = Math.min(55, L);
    for (let d = 6; d < ribbon; d += 8) {
      const prob = 0.9 - (d / ribbon) * 0.5;
      for (const side of [-1, 1]) {
        if (rng() > prob) continue;
        const off = 4 + rng() * 4;
        const cx = start[0] + ux * d + nx * side * off;
        const cy = start[1] + uy * d + ny * side * off;
        if (pointInPolygon([cx, cy], boundary) || inWater(water, [cx, cy]) || inMountains(mountains, [cx, cy]) || !inCanvas([cx, cy])) continue;
        if (suburbs.some((b) => { const c = centroid(b); return Math.hypot(c[0] - cx, c[1] - cy) < 6; })) continue;
        // keep the house off OTHER gate roads crossing this faubourg (own road is ≥4 away by construction)
        if (suburbRoads.some((r) => { for (let si = 0; si < r.length - 1; si++) if (pointSegDist([cx, cy], r[si], r[si + 1]) < 3.8) return true; return false; })) continue;
        // and off the moat ring (blue water line just outside the wall); 6 clears the house
        // half-diagonal (~3.2) plus the moat's half stroke so no corner touches the water line
        if (moat && moat.some((seg) => { for (let si = 0; si < seg.length - 1; si++) if (pointSegDist([cx, cy], seg[si], seg[si + 1]) < 6) return true; return false; })) continue;
        const hw = 2.5, hh = 2;
        suburbs.push([
          [cx - ux * hw - nx * hh, cy - uy * hw - ny * hh],
          [cx + ux * hw - nx * hh, cy + uy * hw - ny * hh],
          [cx + ux * hw + nx * hh, cy + uy * hw + ny * hh],
          [cx - ux * hw + nx * hh, cy - uy * hw + ny * hh],
        ]);
      }
    }
  }
  const outworks: Outwork[] = [];
  const nearWater = (p: Point) =>
    inWater(water, [p[0] + 4, p[1]]) || inWater(water, [p[0] - 4, p[1]]) ||
    inWater(water, [p[0], p[1] + 4]) || inWater(water, [p[0], p[1] - 4]);
  // the mill-race: march from the dry mill spot toward the water to the first wet point
  const raceEnd = (p: Point): Point | null => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let d = 3; d <= 12; d += 1.5) {
        const q: Point = [p[0] + dx * d, p[1] + dy * d];
        if (inWater(water, q)) return q;
      }
    }
    return null;
  };
  // watermill on the watercourse (seigneurial: mill sits ON the water with a race)
  for (let tries = 0; tries < 80 && outworks.length === 0; tries++) {
    const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
    if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p)) continue;
    if (nearWater(p)) { const r = raceEnd(p); outworks.push({ type: "watermill", at: p, angle: rng() * Math.PI * 2, race: r ? [p, r] : undefined }); }
  }
  // windmill on exposed high ground: phase 0 insists on open country well past the wall,
  // phase 1 falls back to any valid spot so a cramped canvas still yields a mill
  for (let phase = 0; phase < 2 && outworks.length === 0; phase++) {
    for (let tries = 0; tries < 80 && outworks.length === 0; tries++) {
      const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p)) continue;
      if (suburbs.some((b) => { const c = centroid(b); return Math.hypot(c[0] - p[0], c[1] - p[1]) < 10; })) continue;
      if (phase === 0 && Math.hypot(p[0] - center[0], p[1] - center[1]) < radius + 22) continue; // exposed, on a rise
      outworks.push({ type: "windmill", at: p, angle: rng() * Math.PI * 2 });
    }
  }

  // harbor: generated LAST of the intramural/water features (its rng draws don't perturb the layout above); sea cities only
  const harbor = makeHarbor(rng, water, boundary, [center[0], center[1]]);

  // extramural landmarks: an empty spot OUTSIDE the wall (not in the town/water/mountains, in the
  // canvas margin, clear of suburbs/mills). Generated after the harbor so coastal layouts are unchanged.
  const occupied: Point[] = [...suburbs.map((b) => centroid(b)), ...outworks.map((o) => o.at)];
  const findSpot = (minGap: number): Point | null => {
    for (let tries = 0; tries < 120; tries++) {
      const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p)) continue;
      if (occupied.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < minGap)) continue;
      occupied.push(p);
      return p;
    }
    return null;
  };
  let abbey: Abbey | null = null;
  if (ctx.size >= 3) { const s = findSpot(20); if (s) abbey = { at: s, angle: rng() * Math.PI * 2 }; }
  let cemetery: Cemetery | null = null;
  { const s = findSpot(13); if (s) { const graves: Point[] = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) graves.push([s[0] + (c - 1) * 3, s[1] + (r - 1) * 3.2]); cemetery = { at: s, graves }; } }
  const gallows: Point | null = ctx.size >= 2 ? findSpot(10) : null;

  // countryside: generated LAST (rng-stream tail, per convention) so it avoids every
  // suburb/outwork/landmark already placed above (occupied carries all of their centres).
  const countryside = generateCountryside(rng, {
    bounds, boundary, water, mountains,
    roads: suburbRoads,
    moat: moat ?? [],
    obstacles: [...occupied],
    size: ctx.size, biome: ctx.biome, oasis: archetype.oasis,
  });

  return {
    name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital,
    archetype, bounds, boundary, water, mountains, wall, moat, gateBridges, mainRoads, minorRoads, wards, parks, labels, features, suburbRoads, suburbs, outworks, harbor,
    abbey, cemetery, gallows, countryside, castle,
  };
}
