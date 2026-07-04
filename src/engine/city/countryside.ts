// Extramural countryside (open-field system). Research: 2-3 great common fields of
// furlong strips around the town; kitchen gardens/orchards right under the walls;
// farmhouses at field edges (spec 2026-07-05-extramural-countryside-castle-design.md).
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, centroid } from "../geometry";
import { inWater } from "./water";
import type { Water } from "./water";
import { inMountains } from "./mountain";
import type { MountainMass } from "./mountain";
import { DESERT, WETLAND, TAIGA, TEMPERATE_FOREST, TROPICAL, TUNDRA, ALPINE } from "../biome";

export interface FieldPatch { polygon: Polygon; strips: Polyline[] }
export interface Pasture { fence: Polygon; animals: Point[]; kind: "sheep" | "cattle" }
export interface Farmstead { house: Polygon; barn: Polygon; yard: Polygon | null }
export interface Orchard { polygon: Polygon; trees: Point[] }
export interface Countryside {
  gardens: Polygon[];
  fields: FieldPatch[];
  pastures: Pasture[];
  farmsteads: Farmstead[];
  orchards: Orchard[];
  woods: Point[];
}
export interface CountrysideOpts {
  bounds: { w: number; h: number };
  boundary: Polygon;
  water: Water;
  mountains: MountainMass[];
  roads: Polyline[];      // extended gate roads (spines)
  obstacles: Point[];     // suburb/outwork/landmark centres to keep clear of
  size: number;
  biome: number;          // biome constants from ../biome
  oasis: boolean;
}

interface Profile { fields: number; pastures: number; orchards: number; woods: number; dry: boolean; animal: "sheep" | "cattle" }
export function countrysideProfile(biome: number, size: number): Profile {
  const base: Profile = { fields: 3 + size, pastures: 2 + Math.floor(size / 2), orchards: 2, woods: 40, dry: false, animal: "sheep" };
  if (biome === DESERT) return { ...base, fields: 2, pastures: 0, orchards: 1, woods: 0, dry: true };
  if (biome === WETLAND) return { ...base, fields: 2, pastures: base.pastures + 2, orchards: 0, woods: 15, animal: "cattle" };
  if (biome === TAIGA || biome === TEMPERATE_FOREST || biome === TROPICAL) return { ...base, fields: Math.max(2, base.fields - 2), pastures: Math.max(1, base.pastures - 1), orchards: 3, woods: 90 };
  if (biome === TUNDRA || biome === ALPINE) return { ...base, fields: 1, pastures: base.pastures + 1, orchards: 0, woods: 10 };
  return base; // plains/grassland default
}

// rectangle centred at c, long axis along unit (ux,uy), half-length hl, half-width hw
function orientedRect(c: Point, ux: number, uy: number, hl: number, hw: number): Polygon {
  const nx = -uy, ny = ux;
  return [
    [c[0] - ux * hl - nx * hw, c[1] - uy * hl - ny * hw],
    [c[0] + ux * hl - nx * hw, c[1] + uy * hl - ny * hw],
    [c[0] + ux * hl + nx * hw, c[1] + uy * hl + ny * hw],
    [c[0] - ux * hl + nx * hw, c[1] - uy * hl + ny * hw],
  ];
}

export function generateCountryside(rng: Rng, opts: CountrysideOpts): Countryside {
  const { bounds, boundary, water, mountains, roads, size, biome } = opts;
  const prof = countrysideProfile(biome, size);
  const bc = centroid(boundary);
  const obstacles: Point[] = [...opts.obstacles];
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const blocked = (p: Point) => pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p);
  const polyOk = (poly: Polygon, gap: number) => {
    const c = centroid(poly);
    if (poly.some(blocked) || blocked(c)) return false;
    if (obstacles.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < gap)) return false;
    return true;
  };
  const claim = (poly: Polygon) => obstacles.push(centroid(poly));

  // ring 1: kitchen gardens + orchards against the wall, between the gate roads
  const gardens: Polygon[] = [];
  const orchards: Orchard[] = [];
  const wallR = (() => { let s = 0; for (const p of boundary) s += Math.hypot(p[0] - bc[0], p[1] - bc[1]); return s / boundary.length; })();
  for (let tries = 0; tries < 90 && gardens.length < 3 + size; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 8 + rng() * 8;
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const ux = -Math.sin(a), uy = Math.cos(a); // long side parallel to the wall
    const plot = orientedRect(c, ux, uy, 5 + rng() * 3, 3);
    if (!polyOk(plot, 8)) continue;
    gardens.push(plot); claim(plot);
  }
  for (let tries = 0; tries < 90 && orchards.length < prof.orchards; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 12 + rng() * 14;
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const ux = -Math.sin(a), uy = Math.cos(a);
    const hl = 8 + rng() * 4, hw = 6 + rng() * 3;
    const plot = orientedRect(c, ux, uy, hl, hw);
    if (!polyOk(plot, 12)) continue;
    const trees: Point[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t: Point = [c[0] + ux * i * hl * 0.6 + -uy * j * hw * 0.6, c[1] + uy * i * hl * 0.6 + ux * j * hw * 0.6];
      if (pointInPolygon(t, plot)) trees.push(t);
    }
    orchards.push({ polygon: plot, trees }); claim(plot);
  }

  // ring 2: great fields — 2-3 sectors anchored to road spines, furlong blocks of strips
  const fields: FieldPatch[] = [];
  const sectors = roads.length >= 2 ? Math.min(3, roads.length) : roads.length || 0;
  for (let sIdx = 0; sIdx < sectors; sIdx++) {
    const road = roads[sIdx % roads.length];
    for (let tries = 0; tries < 120 && fields.length < Math.ceil((prof.fields * (sIdx + 1)) / Math.max(1, sectors)); tries++) {
      const t = 0.25 + rng() * 0.65;                    // along the road, clear of the gate
      const i = Math.min(road.length - 2, Math.floor(t * (road.length - 1)));
      const frac = t * (road.length - 1) - i;
      const ax = road[i][0] + (road[i + 1][0] - road[i][0]) * frac;
      const ay = road[i][1] + (road[i + 1][1] - road[i][1]) * frac;
      let ux = road[i + 1][0] - road[i][0], uy = road[i + 1][1] - road[i][1];
      const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      const side = rng() < 0.5 ? -1 : 1;
      const off = 8 + rng() * 16;
      const c: Point = [ax + -uy * side * off, ay + ux * side * off];
      const hl = 11 + rng() * 7, hw = 6 + rng() * 4;   // furlong block, long axis along the road
      const plot = orientedRect(c, ux, uy, hl, hw);
      if (!polyOk(plot, 14)) continue;
      // ridge-and-furrow: strips run along the LONG axis, spaced across the width
      const nStrips = 4 + Math.floor(rng() * 4);
      const strips: Polyline[] = [];
      for (let k = 1; k < nStrips; k++) {
        const w = -hw + (2 * hw * k) / nStrips;
        strips.push([
          [c[0] - ux * (hl - 1.2) + -uy * w, c[1] - uy * (hl - 1.2) + ux * w],
          [c[0] + ux * (hl - 1.2) + -uy * w, c[1] + uy * (hl - 1.2) + ux * w],
        ]);
      }
      fields.push({ polygon: plot, strips }); claim(plot);
    }
  }
  // desert: keep only fields near water/oasis (irrigation)
  const keptFields = prof.dry
    ? fields.filter((f) => { const c = centroid(f.polygon); return water.bodies.some((b) => { const wc = centroid(b); return Math.hypot(wc[0] - c[0], wc[1] - c[1]) < 90; }); })
    : fields;

  // pastures: fenced irregular paddocks in the gaps between field sectors; meadows prefer water
  const pastures: Pasture[] = [];
  for (let tries = 0; tries < 140 && pastures.length < prof.pastures; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 24 + rng() * (Math.min(bounds.w, bounds.h) / 2 - wallR - 40);
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const verts = 7 + Math.floor(rng() * 3);
    const R = 9 + rng() * 6;
    const fence: Polygon = [];
    for (let k = 0; k < verts; k++) {
      const va = (k / verts) * Math.PI * 2;
      const vr = R * (0.7 + rng() * 0.5);              // noise-deformed blob
      fence.push([c[0] + Math.cos(va) * vr, c[1] + Math.sin(va) * vr]);
    }
    if (!polyOk(fence, 14)) continue;
    const animals: Point[] = [];
    const nA = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < nA * 6 && animals.length < nA; k++) {
      const p: Point = [c[0] + (rng() - 0.5) * R, c[1] + (rng() - 0.5) * R];
      if (pointInPolygon(p, fence)) animals.push(p);
    }
    pastures.push({ fence, animals, kind: prof.animal }); claim(fence);
  }

  // farmsteads: at a field-block corner beside a road — never mid-field (Watabou lesson)
  const farmsteads: Farmstead[] = [];
  const wantF = 1 + Math.floor(size / 3);
  for (let tries = 0; tries < 100 && farmsteads.length < wantF && keptFields.length > 0; tries++) {
    const f = keptFields[Math.floor(rng() * keptFields.length)];
    const corner = f.polygon[Math.floor(rng() * f.polygon.length)];
    const away = 4 + rng() * 3;
    const dxc = corner[0] - centroid(f.polygon)[0], dyc = corner[1] - centroid(f.polygon)[1];
    const dl = Math.hypot(dxc, dyc) || 1;
    const hc: Point = [corner[0] + (dxc / dl) * away, corner[1] + (dyc / dl) * away];
    const theta = rng() * Math.PI;
    const hux = Math.cos(theta), huy = Math.sin(theta);
    const house = orientedRect(hc, hux, huy, 2.2, 1.7);
    const barn = orientedRect([hc[0] + hux * 6, hc[1] + huy * 6], hux, huy, 3.4, 2.4);
    if (!polyOk(house, 9) || !polyOk(barn, 0)) continue;
    const yard = rng() < 0.6 ? orientedRect([hc[0] + hux * 3, hc[1] + huy * 3], hux, huy, 7.5, 5) : null;
    farmsteads.push({ house, barn, yard }); claim(house); claim(barn);
  }

  // woodland fringe: tree points along the outer margin (the world continues into forest)
  const woods: Point[] = [];
  for (let tries = 0; tries < prof.woods * 8 && woods.length < prof.woods; tries++) {
    const edge = Math.floor(rng() * 4);
    const t = rng() * bounds.w;
    const depth = 4 + rng() * 30;
    const p: Point = edge === 0 ? [t, depth] : edge === 1 ? [t, bounds.h - depth] : edge === 2 ? [depth, t] : [bounds.w - depth, t];
    if (blocked(p)) continue;
    if (obstacles.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 7)) continue;
    if (woods.some((w2) => Math.hypot(w2[0] - p[0], w2[1] - p[1]) < 5)) continue;
    woods.push(p);
  }

  return { gardens, fields: keptFields, pastures, farmsteads, orchards, woods };
}
