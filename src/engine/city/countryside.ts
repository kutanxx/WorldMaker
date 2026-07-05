// Extramural countryside (open-field system). Research: 2-3 great common fields of
// furlong strips around the town; kitchen gardens/orchards right under the walls;
// farmhouses at field edges (spec 2026-07-05-extramural-countryside-castle-design.md).
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, centroid, polysOverlap, pointSegDist, segmentsIntersect } from "../geometry";
import { inWater } from "./water";
import type { Water } from "./water";
import { inMountains } from "./mountain";
import type { MountainMass } from "./mountain";
import { DESERT, WETLAND, TAIGA, TEMPERATE_FOREST, TROPICAL, TUNDRA, ALPINE } from "../biome";

export interface FieldPatch { polygon: Polygon; strips: Polyline[]; state: "cultivated" | "fallow" }
export interface Pasture { fence: Polygon; animals: Point[]; kind: "sheep" | "cattle" }
export interface Farmstead { house: Polygon; barn: Polygon; yard: Polygon | null }
export interface Orchard { polygon: Polygon; trees: Point[] }
// a dependent hamlet: church + common green + a lane lined with cottages, garden tofts behind
// them, and a pond — a nucleated settlement, not a ribbon of houses on a road
export interface Village { green: Polygon; chapel: Point; houses: Polygon[]; lane: Polyline; crofts: Polygon[]; pond: Polygon | null }
export interface Countryside {
  gardens: Polygon[];
  fields: FieldPatch[];
  pastures: Pasture[];
  farmsteads: Farmstead[];
  orchards: Orchard[];
  villages: Village[];
  woods: Point[];
  dry: boolean;
}
export interface CountrysideOpts {
  bounds: { w: number; h: number };
  boundary: Polygon;
  water: Water;
  mountains: MountainMass[];
  roads: Polyline[];      // extended gate roads (spines)
  moat: Polyline[];       // wall moat ring (separate blue geometry the patches must clear)
  obstacles: Point[];     // suburb/outwork/landmark centres to keep clear of
  obstaclePolys?: Polygon[]; // suburb/faubourg house footprints the patches must not overlap
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

// true if a polyline's centreline passes inside a polygon (a road running through a building)
function polyCrossedByLine(poly: Polygon, line: Polyline): boolean {
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, y1] = line[i], [x2, y2] = line[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
    for (let s = 0; s <= steps; s++) if (pointInPolygon([x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps], poly)) return true;
  }
  return false;
}

export function generateCountryside(rng: Rng, opts: CountrysideOpts): Countryside {
  const { bounds, boundary, water, mountains, roads, size, biome } = opts;
  const prof = countrysideProfile(biome, size);
  const bc = centroid(boundary);
  const obstacles: Point[] = [...opts.obstacles];
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const blocked = (p: Point) => pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p);
  // exact geometry, not centroid gaps: big furlong blocks overlapped each other and roads
  // cut through them when only centre distances were checked (user-reported overlaps). Seed with
  // the faubourg house footprints so patches never sit on a gate-hamlet house (centre-gap missed it).
  const claimedPolys: Polygon[] = [...(opts.obstaclePolys ?? [])];
  const roadThrough = (poly: Polygon) => {
    for (const road of roads) for (let i = 0; i < road.length - 1; i++) {
      const a: Point = road[i], b: Point = road[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let s = 0; s <= steps; s++) {
        if (pointInPolygon([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps], poly)) return true;
      }
      for (let j = 0; j < poly.length; j++) if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
    }
    return false;
  };
  const distToRoads = (p: Point) => {
    let d = Infinity;
    for (const road of roads) for (let i = 0; i < road.length - 1; i++) d = Math.min(d, pointSegDist(p, road[i], road[i + 1]));
    return d;
  };
  // the moat is a ~5px-wide blue ring just outside the wall; keep every patch off it so
  // wall-hugging gardens don't sit under the water line (user-reported farm/water overlap).
  // Clearance is to the moat CENTERLINE, so it must exceed the moat's 2.5px half-stroke plus a
  // visible gap — 4px left gardens abutting the blue ring (65 patches within the stroke).
  const MOAT_CLEAR = 7;
  const nearMoat = (poly: Polygon) => {
    for (const seg of opts.moat) for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i], b = seg[i + 1];
      for (const v of poly) if (pointSegDist(v, a, b) < MOAT_CLEAR) return true;
      for (let j = 0; j < poly.length; j++) if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
    }
    return false;
  };
  const polyOk = (poly: Polygon, gap: number) => {
    const c = centroid(poly);
    if (poly.some(blocked) || blocked(c)) return false;
    if (obstacles.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < gap)) return false;
    if (claimedPolys.some((cp) => polysOverlap(poly, cp))) return false;
    if (roadThrough(poly) || nearMoat(poly)) return false;
    return true;
  };
  const claim = (poly: Polygon) => { obstacles.push(centroid(poly)); claimedPolys.push(poly); };

  // ring 1: kitchen gardens + orchards against the wall, between the gate roads
  const gardens: Polygon[] = [];
  const orchards: Orchard[] = [];
  const wallR = (() => { let s = 0; for (const p of boundary) s += Math.hypot(p[0] - bc[0], p[1] - bc[1]); return s / boundary.length; })();
  // moated archetypes push the wall-fringe rings out past the ~9px moat band so gardens/orchards
  // sit just beyond the water, not under it
  const moatOff = opts.moat.length ? 12 : 0;
  for (let tries = 0; tries < 140 && gardens.length < 3 + size; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 8 + moatOff + rng() * 8;
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const ux = -Math.sin(a), uy = Math.cos(a); // long side parallel to the wall
    const plot = orientedRect(c, ux, uy, 5 + rng() * 3, 3);
    if (!polyOk(plot, 8)) continue;
    gardens.push(plot); claim(plot);
  }
  for (let tries = 0; tries < 140 && orchards.length < prof.orchards; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 12 + moatOff + rng() * 14;
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
  const sectors = roads.length >= 2 ? Math.min(3, roads.length) : roads.length;
  // three-field rotation: one whole sector lies fallow this year (grazed), the rest cropped.
  // Deserts irrigate rather than rotate, so nothing there lies fallow.
  const fallowSector = sectors >= 2 && !prof.dry ? Math.floor(rng() * sectors) : -1;
  for (let sIdx = 0; sIdx < sectors; sIdx++) {
    const road = roads[sIdx % roads.length];
    for (let tries = 0; tries < 200 && fields.length < Math.ceil((prof.fields * (sIdx + 1)) / Math.max(1, sectors)); tries++) {
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
      fields.push({ polygon: plot, strips, state: sIdx === fallowSector ? "fallow" : "cultivated" }); claim(plot);
    }
  }
  // desert: keep only fields near water/oasis (irrigation)
  const keptFields = prof.dry
    ? fields.filter((f) => { const c = centroid(f.polygon); return water.bodies.some((b) => { const wc = centroid(b); return Math.hypot(wc[0] - c[0], wc[1] - c[1]) < 90; }); })
    : fields;

  // pastures: fenced irregular paddocks in the gaps between field sectors; meadows prefer water
  const pastures: Pasture[] = [];
  for (let tries = 0; tries < 200 && pastures.length < prof.pastures; tries++) {
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
  // note: requires keptFields.length > 0, so a desert city whose fields were all filtered
  // out (no water nearby for irrigation) intentionally ends up with zero farmsteads.
  const farmsteads: Farmstead[] = [];
  const wantF = 1 + Math.floor(size / 3);
  for (let tries = 0; tries < 140 && farmsteads.length < wantF && keptFields.length > 0; tries++) {
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

  // nucleated villages: a common green with a church, cottages clustered around it gable-end
  // inward, garden tofts behind them, a pond, and an approach lane off the road. A compact
  // clustered hamlet reads as a village — the ribbon look was the gate faubourg (now shortened).
  const villages: Village[] = [];
  const wantV = 1 + Math.floor(size / 3);
  for (let tries = 0; tries < 200 && villages.length < wantV && roads.length > 0; tries++) {
    const road = roads[Math.floor(rng() * roads.length)];
    const t = 0.55 + rng() * 0.35;
    const i = Math.min(road.length - 2, Math.floor(t * (road.length - 1)));
    const frac = t * (road.length - 1) - i;
    const ax = road[i][0] + (road[i + 1][0] - road[i][0]) * frac;
    const ay = road[i][1] + (road[i + 1][1] - road[i][1]) * frac;
    const side = rng() < 0.5 ? -1 : 1;
    let rx = road[i + 1][0] - road[i][0], ry = road[i + 1][1] - road[i][1];
    const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
    const lux = -ry * side, luy = rx * side;             // toward open country, off the road
    const pnx = -luy, pny = lux;
    const off = 20 + rng() * 10;                          // clear of the roadside fields
    const vc: Point = [ax + lux * off, ay + luy * off];   // the green at the village core

    const gr = 4 + rng() * 1.5;                           // common green
    const green: Polygon = [];
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; const rr = gr * (0.8 + rng() * 0.4); green.push([vc[0] + Math.cos(a) * rr, vc[1] + Math.sin(a) * rr]); }
    const chapel: Point = [vc[0] - lux * (gr + 1.5), vc[1] - luy * (gr + 1.5)]; // church at the green, road side

    // approach lane: a track off the road threading THROUGH the green (a street). The cottage ring
    // is offset so the lane axis (±lux) falls in the GAPS between cottages, not over them.
    const lane: Polyline = [[ax, ay], vc, [vc[0] + lux * (gr + 6), vc[1] + luy * (gr + 6)]];
    const laneAngle = Math.atan2(luy, lux);

    // cottages ring the green (gable-end inward); a candidate garden toft behind most of them
    const houses: Polygon[] = [];
    const croftCand: Polygon[] = [];
    const nH = 6 + Math.floor(rng() * 4);
    const hr = gr + 3.5;
    for (let k = 0; k < nH; k++) {
      const a = laneAngle + ((k + 0.5) / nH) * Math.PI * 2 + (rng() - 0.5) * 0.14; // half-step off the lane axis
      const cos = Math.cos(a), sin = Math.sin(a);
      const hc: Point = [vc[0] + cos * hr, vc[1] + sin * hr];
      houses.push(orientedRect(hc, cos, sin, 2, 1.4));
      // toft sits BEHIND the cottage (clear of the house footprint at hr±2), out toward the field
      if (rng() < 0.6) croftCand.push(orientedRect([vc[0] + cos * (hr + 5), vc[1] + sin * (hr + 5)], cos, sin, 2.4, 1.8));
    }
    let pondCand: Polygon | null = null;                    // candidate village pond on the green (inside the cottage ring)
    if (rng() < 0.6) {
      const pc: Point = [vc[0] + pnx * (gr * 0.8), vc[1] + pny * (gr * 0.8)];
      pondCand = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rr = 1.5 * (0.8 + rng() * 0.4); pondCand.push([pc[0] + Math.cos(a) * rr, pc[1] + Math.sin(a) * rr]); }
    }

    // the CLUSTER (green + cottages) must fit intact — that's what makes a village. The lane must
    // also thread the gaps (never cut through a cottage), else reject and retry.
    const core = [green, ...houses];
    if (core.some((poly) => !polyOk(poly, 5))) continue;
    let selfBad = false;
    for (let a = 0; a < houses.length && !selfBad; a++) for (let b = a + 1; b < houses.length; b++) if (polysOverlap(houses[a], houses[b])) selfBad = true;
    if (selfBad) continue;
    if (houses.some((h) => polyCrossedByLine(h, lane))) continue; // lane never runs through a cottage
    // Validate tofts/pond against pre-existing patches (fields etc.) BEFORE claiming this village, so
    // no field overlaps them — but the pond may sit ON its own green (that's where village ponds go),
    // which is why the green isn't claimed until after these checks.
    const clearOfHouses = (poly: Polygon) => !houses.some((h) => polysOverlap(poly, h));
    const crofts: Polygon[] = [];
    for (const cr of croftCand) if (polyOk(cr, 3) && clearOfHouses(cr) && !crofts.some((c) => polysOverlap(cr, c))) crofts.push(cr);
    const pond = pondCand && polyOk(pondCand, 3) && clearOfHouses(pondCand) && !crofts.some((c) => polysOverlap(pondCand!, c)) ? pondCand : null;
    [...core, ...crofts, ...(pond ? [pond] : [])].forEach(claim); // now reserve the whole hamlet
    villages.push({ green, chapel, houses, lane, crofts, pond });
  }

  // woodland fringe: tree points along the outer margin (the world continues into forest)
  const woods: Point[] = [];
  for (let tries = 0; tries < prof.woods * 8 && woods.length < prof.woods; tries++) {
    const edge = Math.floor(rng() * 4);
    const t = rng() * (edge < 2 ? bounds.w : bounds.h);
    const depth = 4 + rng() * 30;
    const p: Point = edge === 0 ? [t, depth] : edge === 1 ? [t, bounds.h - depth] : edge === 2 ? [depth, t] : [bounds.w - depth, t];
    if (blocked(p)) continue;
    if (obstacles.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 7)) continue;
    if (woods.some((w2) => Math.hypot(w2[0] - p[0], w2[1] - p[1]) < 5)) continue;
    if (claimedPolys.some((cp) => pointInPolygon(p, cp)) || distToRoads(p) < 3) continue;
    woods.push(p);
  }

  return { gardens, fields: keptFields, pastures, farmsteads, orchards, villages, woods, dry: prof.dry };
}
