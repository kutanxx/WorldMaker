import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, area, pointInPolygon, bbox, pointSegDist, insetEdges, insetPolygon, polysOverlap, segmentsIntersect, clipToConvex, convexHull } from "./geometry";
import { selectArchetype } from "./city/archetypes";
import type { Archetype } from "./city/archetypes";
import { extractStreets, classifyStreets } from "./city/blockStreets";
import { streetsOverWater, squareCrossing } from "./city/riverStreets";
import { chainRoads } from "./city/roads";
import { buildWater, inWater, waterBridges, overlapsWater } from "./city/water";
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
import { lots, cathedralChurch, guildHall } from "./city/buildings";
import { generateCountryside } from "./city/countryside";
import type { Countryside } from "./city/countryside";
import { makeCastle, castleLabelAt, deepest } from "./city/castle";
import type { Castle } from "./city/castle";
import type { CityMarker } from "../types/world";

export interface Ward {
  polygon: Polygon;
  type: WardType;
  buildings: Polygon[];
  inner: boolean;
}

/** a building a town has only one of, drawn as itself: the cathedral's church, the guild's hall */
export interface Landmark { kind: "cathedral" | "guildhall"; outline: Polygon; at: Point; ridges: [Point, Point][] }

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
  parkTrees: Point[];
  landmarks: Landmark[];
  labels: { x: number; y: number; type: WardType; landmark: boolean }[];
  features: CityFeatures;
  suburbRoads: Polyline[];
  suburbs: Polygon[];
  outworks: Outwork[];
  harbor: Harbor | null;
  abbey: Abbey | null;
  cemetery: Cemetery | null;
  gallows: Point | null;
  leperHouse: { at: Point; angle: number } | null;
  fairground: { at: Point; angle: number; stalls: Polygon[] } | null;
  parishChurches: Point[];
  marketCross: Point | null;
  well: Point | null;
  inns: Point[];
  barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[];
  riversideTrades: { at: Point; kind: "tanner" | "dyer" }[];
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
  river?: boolean; // world river through the cell (optional so test fixtures can omit it → no river)
  seaBearing?: number; // which way the open sea lies, in world radians; absent → the plate picks
  riverBearing?: number; // which way the world's river runs through the town; absent → the plate picks
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital, elevation: c.elevation, biome: c.biome, river: c.river, seaBearing: c.seaBearing, riverBearing: c.riverBearing };
}

/**
 * `p => pointInPolygon(p, poly) && (distance from p to poly's edges) >= clear`, answered by a grid:
 * a cell farther than `clear` from every edge is wholly in or wholly out, and its centre says which;
 * only a point in a cell near an edge is measured. The same answer — the houses of a capital ask it
 * some 3,500 times, and the byte-lock holds the plates to it.
 */
function insideClearOf(poly: Polygon, clear: number): (p: Point) => boolean {
  const CELL = 6;
  const b = bbox(poly);
  const x0 = b.minX - CELL, y0 = b.minY - CELL;
  const nx = Math.ceil((b.maxX - x0) / CELL) + 2, ny = Math.ceil((b.maxY - y0) / CELL) + 2;
  const cells = new Uint8Array(nx * ny);   // 0 not yet known, 1 out, 2 in, 3 near an edge
  const exact = (p: Point) => {
    if (!pointInPolygon(p, poly)) return false;
    for (let i = 0; i < poly.length; i++) if (pointSegDist(p, poly[i], poly[(i + 1) % poly.length]) < clear) return false;
    return true;
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const reach = clear + CELL;   // a cell whose centre is within reach of the edge may come within clear of it
    const i0 = Math.max(0, Math.floor((Math.min(a[0], c[0]) - reach - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((Math.max(a[0], c[0]) + reach - x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], c[1]) - reach - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((Math.max(a[1], c[1]) + reach - y0) / CELL));
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const idx = j * nx + k;
      if (cells[idx] === 3) continue;
      // the cell's centre within clear + half its diagonal of the edge: some point of it may be near
      const mid: Point = [x0 + (k + 0.5) * CELL, y0 + (j + 0.5) * CELL];
      if (pointSegDist(mid, a, c) < clear + CELL * Math.SQRT1_2 + 1e-6) cells[idx] = 3;
    }
  }
  return (p: Point) => {
    const k = Math.floor((p[0] - x0) / CELL), j = Math.floor((p[1] - y0) / CELL);
    if (!(k >= 0 && j >= 0 && k < nx && j < ny)) return false;
    const idx = j * nx + k;
    const s = cells[idx];
    if (s === 3) return exact(p);
    if (s === 0) cells[idx] = pointInPolygon([x0 + (k + 0.5) * CELL, y0 + (j + 0.5) * CELL], poly) ? 2 : 1;
    return cells[idx] === 2;
  };
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
  // a garrison's and a patrician's blocks were 260 and 240: at the rim, by a gate road or the wall's
  // lane, the few lots such a ward is cut into could all fall out, leaving the ward bare
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 200, military: 190,
};
// How each kind of ward is built (see `lots` in buildings.ts): a slum packed and crooked, a patrician
// ward in big houses with gardens between them, a garrison in orderly blocks round a parade ground.
// A grid town cuts its lots half as crookedly again.
const LOT_STYLE: Partial<Record<WardType, { chaos: number; sizeChaos: number; empty: number }>> = {
  slum: { chaos: 0.75, sizeChaos: 0.5, empty: 0.02 },
  craftsmen: { chaos: 0.55, sizeChaos: 0.6, empty: 0.04 },
  gate: { chaos: 0.55, sizeChaos: 0.6, empty: 0.06 },
  market: { chaos: 0.45, sizeChaos: 0.5, empty: 0.04 },
  merchant: { chaos: 0.4, sizeChaos: 0.5, empty: 0.06 },
  patriciate: { chaos: 0.35, sizeChaos: 0.8, empty: 0.22 },
  military: { chaos: 0.15, sizeChaos: 0.3, empty: 0.25 },
  harbor: { chaos: 0.3, sizeChaos: 0.4, empty: 0.03 },
  guildhall: { chaos: 0.4, sizeChaos: 0.5, empty: 0.08 },
  cathedral: { chaos: 0.35, sizeChaos: 0.5, empty: 0.3 },
};
// how far a block's buildings stand back from the streets on its edges (a main road is drawn 4.6
// wide, a street 2.6), and from the town wall's line (drawn 4 wide): the lane inside the wall
const STREET_SETBACK = 3;
const WALL_SETBACK = 3.5;
// ...and from a road that cuts through the block, from its centre line: half its drawn width and a little
const MAIN_ROAD_CLEAR = 2.7;
const MINOR_ROAD_CLEAR = 1.6;
// river towns are defended by the river itself — a separate moat ring hugging the wall read as a
// second, disconnected river alongside the big one, so bridgeTown gets no moat (user-reported)
const MOAT_ARCHETYPES = new Set(["coastalPort", "plainsMarket"]);
// a town below this is a hamlet: too small to be anyone's seat. Above it, roughly one market town
// in three answers to a resident lord — often enough to be unremarkable, rare enough to mean something.
const LORD_SEAT_MIN_SIZE = 3;
const LORD_SEAT_ODDS = 1 / 3;
// the castle's own rng stream, beside the lord-seat pick (+4300) and the mountain form pick (+4200)
const CASTLE_SALT = 4500;
// ...and the buildings', beside it
const BUILDING_SALT = 4400;
// ...and the river a port draws where the world's river reaches the sea
const RIVER_MOUTH_SALT = 4600;
// the width of the key strip an exported plate carries beside the town (the renderer's KEY_STRIP;
// a test holds the two equal), which moves the town's name right by half of it
export const PLATE_KEY_STRIP = 108;

/**
 * The seed of one of a plate's streams: the town's id (plus the stream's salt) under a key that is
 * the WORLD's seed mixed on its own first.
 *
 * ★ They were `deriveSeed(worldSeed, id)`, and deriveSeed mixes its two arguments by XOR before it
 * multiplies — so a town's numbers were fixed by (world seed XOR town id). World 2's town 4 drew
 * exactly what world 3's town 5 drew (2^4 = 3^5), and the same for every such pair: measured over
 * worlds 1-12 all 336 plates shared their main stream with a plate in another world and 16 were
 * the same drawing outright; over worlds 1-40, 105 of 1,120. Two worlds' keys now differ by a
 * multiplied mixture, not a small number. (deriveSeed itself keys every world-level stream —
 * cultures, biomes, history — and cannot change without changing every world.)
 */
const PLATE_KEY = 0x5ca1e;
const plateSeed = (worldSeed: number, stream: number) => deriveSeed(deriveSeed(worldSeed, PLATE_KEY), stream);
// the depth of ward a great seat looks for: an outer curtain, a bailey behind it, and an enceinte
// that still holds its donjon (a lesser seat's is zoning's own default)
const GREAT_CASTLE_ROOM = 26;
// A great seat will look this much further from its anchor than the nearest dry ward for the room its
// two rings need. Its anchor is only a stretch of wall — a random one inland, the one farthest from the
// sea on a coast — and at zoning's own 40 a capital whose nearby wards were gate wards or slivers lost
// its outer curtain (69 of 96 great seats had one, against 81 at 100). A seat anchored to a mountain
// keeps to its high ground.
const GREAT_CASTLE_REACH = 100;
// a castle's ward keeps a town gate this far off its own stretch of wall: the gate block is 6 wide and
// the castle's corner tower stands on the wall beside it (at 0.5, 5 towers stood on gates)
const CASTLE_GATE_GAP = 3;

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(plateSeed(worldSeed, ctx.id));
  const bounds = { w: 460, h: 460 };
  const center: Point = [230, 230];
  const radius = 60 + ctx.size * 12;
  // mountain-variant pick uses a SEPARATE rng stream so the main stream (and thus every
  // existing non-mountain city) is byte-identical; only high-elevation form choice changes.
  const pick = mulberry32(plateSeed(worldSeed, ctx.id + 4200))();
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size, biome: ctx.biome, pick, river: ctx.river });

  const water = buildWater(rng, archetype.water, bounds, ctx.seaBearing, radius, ctx.riverBearing);
  // The sea on its own: what a port's harbour, docks and seaward side are measured against, whatever
  // else runs into it.
  const seaOnly: Water = { kind: water.kind, bodies: water.bodies.slice(), bridges: [] };
  // ★ A port where the world's river reaches the sea draws its river. 22 of the 80 river towns of
  // twelve worlds stand on a coast AND a river — the world map draws the river running out to sea
  // at the town — and their plates drew the sea and no river at all. It comes down the way the world's
  // river runs, into the sea, from a stream of its own, so no other port moves.
  const riverMouth = archetype.water === "sea" && !!ctx.river && ctx.riverBearing !== undefined;
  if (riverMouth) {
    water.bodies.push(...buildWater(mulberry32(plateSeed(worldSeed, ctx.id + RIVER_MOUTH_SALT)), "river", bounds, undefined, undefined, ctx.riverBearing).bodies);
  }
  if (archetype.oasis) {
    const or = radius * 0.12;
    const oasisPoly: Polygon = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; oasisPoly.push([center[0] + Math.cos(a) * or, center[1] + Math.sin(a) * or]); }
    water.bodies.push(oasisPoly);
  }
  const boundary = makeBoundary(rng, archetype, ctx.size, center, water);
  const mountains = makeMountains(rng, archetype, boundary, [center[0], center[1]], bounds);

  // BLOCK-CENTRIC: wards are the city blocks; streets are the gaps (shared ward edges).
  // The ward mesh is laid out to the town's ACTUAL reach, not to a nominal disc. Wards are Voronoi
  // cells clipped to a circle of radius*1.15, but makeBoundary is not a circle: its noise runs to
  // 1.14 of base and a linear archetype stretches another 1.55 along its axis, so the wall regularly
  // stood outside the mesh and the ground between them was blank. Measured over twelve seeds, the
  // wards covered a median 87.8% of the walled area, a tenth of towns under 64.7%, the worst 32.2%,
  // with an uncovered band inside the wall reaching 198 units. Same rng either way -- the site
  // fields draw a fixed number of values whatever radius they are given.
  const reach = Math.max(...boundary.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1])));
  let wardCells = generateWards(rng, center[0], center[1], reach, 8 + ctx.size * 3, archetype.streetField, boundary);
  // A cell was thrown away whole when its SITE fell outside the wall or in the water -- and with it
  // went the ground inside the wall that the same cell covered, leaving a hole in a tiling that has
  // no holes by construction. That is where the unmatched ward edges came from, and the blank wedges
  // inside the wall: a grid field lays its lattice past the corners of the town, so a good many
  // sites sit outside a boundary their cells still reach into. A cell is kept if any of it is in the
  // town; the renderer clips away whatever hangs outside the wall.
  // (the mesh is already confined to the town: generateWards drops outside sites before building
  // the diagram, so there is no cell here that does not belong to the place)
  // ★ The water comes out of the street network before any road is chosen (see riverStreets.ts):
  // streets in the channel are dropped, streets that meet it stop at the bank, and a river town's
  // banks are joined by square crossings. A town with no water keeps its network exactly.
  const riverTown = archetype.water === "river" || archetype.water === "meander" || archetype.water === "loop" || riverMouth;
  const net = streetsOverWater(extractStreets(wardCells), water, boundary, riverTown);
  const streetGraph = net.graph;
  const onStreet = new Set<number>(streetGraph.edges.flat());

  const maxGates = 2 + Math.floor(ctx.size / 3);
  // gates sit where streets reach the wall: feed the street nodes as candidate road-ends — the ones
  // still on a street, on dry ground (a node the water cut off is no road-end)
  const roadEnds = streetGraph.nodes.filter((nd, i) => onStreet.has(i) && !inWater(water, nd));

  // a straight link a gate or a stranded street may lay to the network, provided it stays dry
  const dryLink = (a: Point, b: Point) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let k = 0; k <= n; k++) if (inWater(water, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])) return false;
    return true;
  };
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const overMountain = (a: Point, b: Point) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let k = 0; k <= n; k++) if (inMountains(mountains, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])) return true;
    return false;
  };
  // ★ The road out of a gate: straight out from the middle of the town, or turned up to 45 degrees
  // where straight out runs into the water at the edge of the plate. A river town's gate stands by
  // its river, and the road straight out of it ran down the channel to the edge — so it was dropped,
  // and a town whose only gate that was had no road out at all. It crosses water, if at all, the way
  // the town's own bridges do — once, and square — and never climbs over the mountain.
  const roadOut = (g: Point): { ux: number; uy: number; start: Point; L: number; end: Point } | null => {
    const dx = g[0] - center[0], dy = g[1] - center[1];
    const gl = Math.hypot(dx, dy) || 1;
    for (const turn of [0, 0.26, -0.26, 0.52, -0.52, 0.78, -0.78]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const ux = (dx * c - dy * s) / gl, uy = (dx * s + dy * c) / gl;
      const start: Point = [g[0] + ux * 8, g[1] + uy * 8]; // clear wall + moat
      const distX = ux > 0.001 ? (bounds.w - 3 - start[0]) / ux : ux < -0.001 ? (3 - start[0]) / ux : Infinity;
      const distY = uy > 0.001 ? (bounds.h - 3 - start[1]) / uy : uy < -0.001 ? (3 - start[1]) / uy : Infinity;
      const room = Math.min(distX, distY);
      if (room < 14 || inWater(water, start) || inMountains(mountains, start) || !inCanvas(start) || pointInPolygon(start, boundary)) continue;
      const L = room - 1;                       // run all the way to the canvas edge
      const end: Point = [start[0] + ux * L, start[1] + uy * L];
      if (inWater(water, end) || overMountain(start, end)) continue; // don't run a highway into the sea
      if (!dryLink(start, end) && !squareCrossing(start, end, water)) continue;
      return { ux, uy, start, L, end };
    }
    return null;
  };
  const wall = wallFromDefenses(boundary, water, mountains, roadEnds.map((nd) => [nd, nd]), maxGates, (g) => roadOut(g) !== null);
  const classified = classifyStreets(streetGraph, wall.gates, [center[0], center[1]], water.bodies.length ? dryLink : undefined);
  let mainRoads = classified.main;
  const minorRoads = [...classified.minor, ...net.stubs];
  // ...and only now are the main streets roads rather than the pieces a shortest path was cut into:
  // stitched into continuous runs that carry straight on through a junction, with the stretches
  // drawn twice thrown out and the corners eased. Done before the bridges, so a crossing is
  // measured against the road as it will be drawn.
  mainRoads = chainRoads(mainRoads, wall.gates);
  // A bridge is drawn where a road the plate DRAWS crosses the water. The ward mesh runs on past
  // the wall and the plate clips its streets to the town, so a crossing out there carried a bridge
  // over the river with no road to either end of it — 39 of them over twelve worlds.
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water)
    .filter(([a, b]) => pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], boundary));

  const moat = MOAT_ARCHETYPES.has(archetype.id)
    ? wall.segments.map((s) => offsetSegment(s, center, 6).map((o, i) => (inWater(water, o) ? s[i] : o)))
    : null;
  const gateBridges: Polyline[] = moat
    ? wall.gates
        .map((g): Polyline | null => {
          const dx = g[0] - center[0], dy = g[1] - center[1];
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;
          const outer: Point = [g[0] + ux * 11, g[1] + uy * 11];
          if (inWater(water, outer)) return null;
          return [[g[0] - ux * 3, g[1] - uy * 3], outer];
        })
        .filter((b): b is Polyline => b !== null)
    : [];

  let cells = wardCells;
  // the keep sits on the high ground: anchor it toward the mountain mass, if any
  // A castle marks a LORD'S SEAT, not a wall. Every walled town used to get one, which across 10
  // seeds meant all 280 towns had a castle and the symbol said nothing: the realm's capital, the
  // fortress that is a castle before it is a town, and a minority of market towns where a lesser
  // lord sits. Its own rng stream (the mountain-pick convention), so a town that keeps its castle
  // draws exactly what it drew before and its plan is byte-identical.
  const hasCastle = ctx.isCapital || archetype.id === "hilltopFortress"
    || (ctx.size >= LORD_SEAT_MIN_SIZE && mulberry32(plateSeed(worldSeed, ctx.id + 4300))() < LORD_SEAT_ODDS);
  let castleAnchor: Point | undefined;
  if (hasCastle && mountains.length) {
    let sx = 0, sy = 0, cnt = 0;
    for (const m of mountains) for (const p of m.innerEdge) { sx += p[0]; sy += p[1]; cnt++; }
    const mx = sx / cnt, my = sy / cnt;
    castleAnchor = [center[0] + (mx - center[0]) * 0.7, center[1] + (my - center[1]) * 0.7];
  }
  // Sea direction for harbor placement: the ward nearest this point is the seaward one, because
  // docks belong on the water side.
  //
  // ⚠ The AREA centroid, not the mean of the sea body's vertices. The shoreline is sampled with a
  // couple of hundred points and the open-water edge with about four, so a vertex mean is dragged
  // onto the beach and then slides along it — which put the harbour on the wrong side of the town
  // entirely: measured 120 degrees from the sea on Aerael (seed 2) and 132 on Kukhauth (seed 6).
  // `city.test.ts` had already written this down in its own comment and used the area centroid to
  // MEASURE the sea's side, while the code that PLACES the harbour kept the vertex mean. The bug
  // only surfaced when towns started standing on water more often and the sample of harbour towns
  // grew; two of ninety were wrong before anyone looked.
  let seaAnchor: Point | undefined;
  if (ctx.coastal && water.kind === "sea" && water.bodies.length) {
    let ax = 0, ay = 0, aw = 0;
    for (const b of seaOnly.bodies) {
      const c = centroid(b), w = area(b);
      ax += c[0] * w; ay += c[1] * w; aw += w;
    }
    if (aw > 0) seaAnchor = [ax / aw, ay / aw];
  }
  // the lord's castle sits AT the town wall (research: urban castle) unless a mountain
  // anchor already claims the high ground. Bias the wall pick away from the sea side.
  if (hasCastle && !castleAnchor) {
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
  // mostly UNDER the water, rather than merely touching it — a ward the lake has swallowed
  const isDrowned = (poly: Polygon): boolean => {
    const pts = [...poly, centroid(poly)];
    return pts.filter((p) => inWater(water, p)).length / pts.length > 0.6;
  };
  const zoned = assignZones(rng, cells, [center[0], center[1]], radius, { hasCastle, coastal: ctx.coastal, castleAnchor, seaAnchor,
    wet: (poly) => overlapsWater(water, poly),
    // the ward edge nearest the water: what decides which district is the quayside
    // (the sea's edge: a port's docks face the sea, not the river running into it)
    waterDist: (poly) => {
      let d = Infinity;
      for (const p of poly) for (const b of seaOnly.bodies) for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(p, b[i], b[(i + 1) % b.length]));
      return d;
    },
    drowned: isDrowned,
    walledArea: Math.abs(area(boundary)),
    room: (poly) => { const cut = clipToConvex(boundary, poly); return cut.length >= 3 ? deepest(cut).depth : 0; },
    castleRoom: ctx.isCapital || ctx.size >= 5 ? GREAT_CASTLE_ROOM : undefined,
    castleReach: (ctx.isCapital || ctx.size >= 5) && !mountains.length ? GREAT_CASTLE_REACH : undefined,
    atWall: (poly) => poly.some((q) => !pointInPolygon(q, boundary)),
    // (measured to the ward as the town has it, cut to the wall: the whole cell ran on outside the wall
    // and across the streets round it, and a gate on a neighbour's stretch took great seats off the
    // ground they were built for — 18 of them lost their second ring for it)
    castleOk: (poly) => {
      const cut = clipToConvex(boundary, poly);
      const own = cut.length >= 3 ? cut : poly;
      return !wall.gates.some((g) => pointInPolygon(g, own) || own.some((_, i) => pointSegDist(g, own[i], own[(i + 1) % own.length]) < CASTLE_GATE_GAP));
    } });

  // ★ The town's buildings draw from a stream of their own, so how a block is built can change
  // without moving a single tree, hamlet or mill in the country around it (the castle's convention).
  const brng = mulberry32(plateSeed(worldSeed, ctx.id + BUILDING_SALT));
  const wallDist = (p: Point) => {
    let d = Infinity;
    for (let i = 0; i < boundary.length; i++) d = Math.min(d, pointSegDist(p, boundary[i], boundary[(i + 1) % boundary.length]));
    return d;
  };
  // A house stands inside the wall, not under it: the wall is drawn 4 wide on the town's outline,
  // and a lot tested only by its centre was cut by that line on every plate (a median 28 houses a
  // town). Lots keep WALL_SETBACK off it — the lane inside a town wall — and one that straddles the
  // line is cut back parallel to the wall rather than dropped, if enough of it is left.
  const townInset = insetPolygon(boundary, WALL_SETBACK);
  const inTown = insideClearOf(boundary, WALL_SETBACK);
  const settle = (lot: Polygon): Polygon | null => {
    if (lot.every(inTown)) return lot;
    if (!lot.some((p) => pointInPolygon(p, boundary))) return null;
    const cut = clipToConvex(townInset, lot);
    if (cut.length < 3 || area(cut) < area(lot) * 0.4) return null;
    return cut.every((p) => pointInPolygon(p, boundary) && wallDist(p) >= WALL_SETBACK - 0.8) ? cut : null;
  };
  // ...and on dry ground: a house tested by its centre alone stood with two or more corners in the
  // river on 109 plates. A marsh town's stilt houses are the exception, by design.
  const dry = (b: Polygon) => archetype.onStilts || !b.some((p) => inWater(water, p));
  // A great building is long enough to stand with every corner on dry ground and the river running
  // through its middle (a cathedral at Vragr, seed 1, did): it is tested against the water whole.
  const dryWhole = (b: Polygon) => !overlapsWater(water, b);
  const nearOutline = (b: Polygon, o: Polygon, air: number) => {
    if (polysOverlap(b, o)) return true;
    for (const p of b) for (let i = 0; i < o.length; i++) if (pointSegDist(p, o[i], o[(i + 1) % o.length]) < air) return true;
    for (const p of o) for (let i = 0; i < b.length; i++) if (pointSegDist(p, b[i], b[(i + 1) % b.length]) < air) return true;
    return false;
  };
  const gridTown = archetype.streetField === "grid";
  const landmarks: Landmark[] = [];
  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") {
      if (!archetype.oasis) parks.push(z.polygon); // desert: no green parks
      return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner };
    }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      // The block as the town has it. A ward by the wall is a Voronoi cell that runs on out into the
      // fields, and lots laid out for the whole cell left its sliver inside the wall with fragments
      // too small to keep — an empty band along the inside of the wall. The lots are laid out in the
      // part of the block that is in the town (its hull, so the cutting still sees a convex block).
      const whole = insetEdges(z.polygon, STREET_SETBACK);
      const inside = whole.length >= 3 ? clipToConvex(townInset, whole) : [];
      const block = inside.length >= 3 && area(inside) < area(whole) * 0.97 ? convexHull(inside) : whole;
      // A ward a town has only one of is built around its one building: the cathedral's church, the
      // guild's hall. They used to be blocks of houses like any other, told apart by their tint.
      let great: Polygon | null = null;
      if ((z.type === "cathedral" || z.type === "guildhall") && block.length >= 3) {
        const room = clipToConvex(townInset, block);
        if (room.length >= 3) {
          if (z.type === "cathedral") {
            const ch = cathedralChurch(room, dryWhole);
            if (ch && dryWhole(ch.outline)) { great = ch.outline; landmarks.push({ kind: "cathedral", outline: ch.outline, at: ch.crossing, ridges: ch.ridges }); }
          } else {
            const hall = guildHall(room, dryWhole);
            if (hall && dryWhole(hall.outline)) { great = hall.outline; landmarks.push({ kind: "guildhall", outline: hall.outline, at: centroid(hall.outline), ridges: hall.ridges }); }
          }
        }
      }
      const style = LOT_STYLE[z.type] ?? LOT_STYLE.craftsmen!;
      const raw = block.length >= 3
        ? lots(brng, block, { minArea: DENSITY[z.type] ?? 130, chaos: style.chaos * (gridTown ? 0.5 : 1), sizeChaos: style.sizeChaos, emptyProb: style.empty })
        : [];
      const minArea = DENSITY[z.type] ?? 130;
      for (const lot of raw) {
        const b = settle(lot);
        if (!b) continue;
        // A lot the shore runs through is cut again, smaller, and its dry pieces kept: dropped whole,
        // a ward a river runs through lost its whole bank to the water's edge (a cathedral ward at
        // Grukdruth, seed 7, all of its houses) — where a waterfront is lined with the smallest plots.
        const pieces = dry(b) ? [b]
          : b.some((p) => !inWater(water, p)) && area(b) > minArea * 0.4
            ? lots(brng, b, { minArea: minArea * 0.35, chaos: 0, sizeChaos: 0.3, emptyProb: 0, margin: 0.2 }).filter(dry)
            : [];
        for (const piece of pieces) {
          // the close round a cathedral, the yard in front of a hall
          if (great && nearOutline(piece, great, 3)) continue;
          buildings.push(piece);
        }
      }
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });


  // ★ A house keeps clear of the road as it is DRAWN, not only of its centre line. The filter asked
  // whether a road's centre line ran through a building — and a main road is drawn 4.6 wide, so a
  // house a unit off the line stood half under it, on 150 of 336 plates (the gate stubs and bridge
  // approaches cut through wards; the streets on their edges are held off by the block's setback).
  // Every road segment once, with its box grown by the clearance: a segment whose grown box misses
  // the building's box is nowhere near it (the prefilter the perf pass proved exact, 2026-09-24).
  const roadSegs: { a: Point; c: Point; clear: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const [roads, clear] of [[mainRoads, MAIN_ROAD_CLEAR], [minorRoads, MINOR_ROAD_CLEAR]] as [Polyline[], number][]) {
    for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
      const a: Point = r[i], c: Point = r[i + 1];
      roadSegs.push({ a, c, clear, x0: Math.min(a[0], c[0]) - clear, y0: Math.min(a[1], c[1]) - clear, x1: Math.max(a[0], c[0]) + clear, y1: Math.max(a[1], c[1]) + clear });
    }
  }
  const crowdedByRoad = (b: Polygon): boolean => {
    const bb = bbox(b);
    for (const s of roadSegs) {
      if (s.x1 < bb.minX || s.x0 > bb.maxX || s.y1 < bb.minY || s.y0 > bb.maxY) continue;
      if (pointInPolygon(s.a, b) || pointInPolygon(s.c, b)) return true;
      for (let j = 0; j < b.length; j++) {
        const p = b[j], q = b[(j + 1) % b.length];
        // two segments are nearer than the clearance where they cross or an end of one is
        if (segmentsIntersect(s.a, s.c, p, q) || pointSegDist(p, s.a, s.c) < s.clear
          || pointSegDist(s.a, p, q) < s.clear || pointSegDist(s.c, p, q) < s.clear) return true;
      }
    }
    return false;
  };
  for (const ward of wards) if (ward.buildings.length) ward.buildings = ward.buildings.filter((b) => !crowdedByRoad(b));

  // Parks were a plain green pane, which on a plate full of fields reads as one more field. Trees on
  // a loose grid, clear of the wall and the paths — the country's own tree, so a taiga town's park
  // is a stand of conifers.
  const parkTrees: Point[] = [];
  for (const z of zoned) {
    if (z.type !== "park" || archetype.oasis) continue;
    const room = insetEdges(z.polygon, 3);
    if (room.length < 3) continue;
    const b = bbox(room), step = 6.5;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      const p: Point = [x + (brng() - 0.5) * step * 0.7, y + (brng() - 0.5) * step * 0.7];
      if (brng() > 0.72 || !pointInPolygon(p, room) || !inTown(p) || inWater(water, p)) continue;
      if (roadSegs.some((s) => pointSegDist(p, s.a, s.c) < s.clear + 1.5)) continue;
      parkTrees.push(p);
    }
  }

  // landmark districts get an on-map label; the display TEXT is localised at render time from
  // the ward type (so KO/EN can switch without regenerating the city).
  // Name what is singular. Measured over eight cities, the civic landmarks are always one apiece —
  // one plaza, one cathedral, one guildhall, one castle — while the living quarters repeat, up to
  // thirteen craftsmen wards and eight slums in a single town. Naming every ward would print the
  // same word down the length of a city; so a kind of quarter earns its name on the plan only when
  // the city has exactly one of it, and the reader is sent to the key for the rest.
  //
  // The landmarks are named regardless of size — a cramped guildhall is still the guildhall — and
  // this also picks up the market, the merchant quarter and the harbour, which are one place in most
  // cities and went unnamed under the old fixed list of five.
  const LANDMARKS: WardType[] = ["plaza", "castle", "cathedral", "guildhall", "harbor"];
  const count = new Map<WardType, number>();
  for (const z of zoned) count.set(z.type, (count.get(z.type) ?? 0) + 1);
  const labels: { x: number; y: number; type: WardType; landmark: boolean }[] = [];
  for (const z of zoned) {
    if (!LANDMARKS.includes(z.type) && count.get(z.type) !== 1) continue;
    // A name goes on dry ground. An outside review found a lake wearing the label "Guildhall" —
    // the water had swallowed the ward and the name stayed floating on it. A harbour is allowed to
    // be mostly water (that is what a harbour is), but its name belongs on the quayside, so the
    // label walks in from the ward's middle toward the town until it finds land. A ward with no dry
    // ground at all is not named.
    // ★ The ward as the plate draws it: the Voronoi cell is cut by a DISC, and the plate clips it
    // again to the town's wall, which is not one. Named at the middle of the uncut cell, an outer
    // ward's name stood on the wall or out in the fields — measured over 12 worlds, 69 names in 60
    // towns. The cell is convex, so it can clip the (irregular) wall; where what is left is too
    // lopsided for its own middle to fall inside the town, the ward's site does, by construction.
    const cut = clipToConvex(boundary, z.polygon);
    const shape = cut.length >= 3 && Math.abs(area(cut)) > 1 ? cut : z.polygon;
    let c = centroid(shape);
    if (!pointInPolygon(c, boundary)) c = z.site;
    let at: Point | null = inWater(water, c) ? null : c;
    if (at === null) {
      // pull in toward each corner in turn and take the nearest dry stand. A ward that straddles a
      // river has its centroid in the channel while half of it is good dry bank, and a single walk
      // toward the town centre misses that whenever the bank lies the other way.
      let best = Infinity;
      for (const v of shape) for (const f of [0.35, 0.55, 0.75]) {
        const p: Point = [c[0] + (v[0] - c[0]) * f, c[1] + (v[1] - c[1]) * f];
        if (inWater(water, p) || !pointInPolygon(p, shape) || !pointInPolygon(p, boundary)) continue;
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < best) { best = d; at = p; }
      }
    }
    if (at === null) continue;
    labels.push({ x: at[0], y: at[1], type: z.type, landmark: LANDMARKS.includes(z.type) });
  }

  // The cathedral is named at its church's crossing, where its cross is drawn; the page then sets the
  // name beside the church (`clearMarks` counts the church as a sign), as it does any name at its sign.
  const church = landmarks.find((m) => m.kind === "cathedral");
  const churchLabel = labels.find((l) => l.type === "cathedral");
  if (church && churchLabel) { churchLabel.x = church.at[0]; churchLabel.y = church.at[1]; }

  // the lord's castle: built from the zoned castle ward polygon, right after wards/labels and before
  // features/extramural work. It draws from a stream of its own (the mountain-pick convention), so
  // how a castle is built can change without moving a single tree, hamlet or mill in the country.
  const castleWard = zoned.find((z) => z.type === "castle") ?? null;
  const castle = castleWard
    ? makeCastle(mulberry32(plateSeed(worldSeed, ctx.id + CASTLE_SALT)), castleWard.polygon, [center[0], center[1]], boundary, ctx.size, ctx.isCapital,
      { main: mainRoads, minor: minorRoads })
    : null;

  // Where the castle takes a stretch of the town's outline, that stretch is its wall and carries its
  // towers: the town's own towers on it stood beside the castle's in pairs.
  if (castle) {
    const rings = [castle.innerWall, ...(castle.outerWall ? [castle.outerWall] : [])];
    const onCastle = (p: Point) => rings.some((r) => {
      for (let i = 0; i < r.length; i++) if (pointSegDist(p, r[i], r[(i + 1) % r.length]) < 2) return true;
      return false;
    });
    wall.towers = wall.towers.filter((t) => !onCastle(t));
  }

  // Every ward is named at its own centre, which for a castle is the donjon: the word "Castle" was
  // laid straight across the keep, the halls and the gatehouse of the thing it was naming. The name
  // takes the most open ground the castle has, its yard first (see castleLabelAt).
  if (castle && castleWard) {
    const lab = labels.find((l) => l.type === "castle");
    const cut = clipToConvex(boundary, castleWard.polygon);
    const at = lab ? castleLabelAt(castle, cut.length >= 3 ? cut : castleWard.polygon, (p) => inWater(water, p)) : null;
    if (lab && at) { lab.x = at[0]; lab.y = at[1]; }
    else if (lab) {
      const yc = centroid(castle.innerWall);
      const dx = center[0] - yc[0], dy = center[1] - yc[1];
      const m = Math.hypot(dx, dy) || 1;
      const base = Math.atan2(dy / m, dx / m);
      // the town side is tried first, then swung either way: on some wards the ground toward the
      // town runs out before the enceinte does, and the name has to go round the other side
      outer: for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
        const ux = Math.cos(base + turn), uy = Math.sin(base + turn);
        for (let d = 6; d <= 60; d += 2) {
          const p: Point = [yc[0] + ux * d, yc[1] + uy * d];
          if (pointInPolygon(p, castle.innerWall)) continue;
          if (!pointInPolygon(p, castleWard.polygon)) break;
          lab.x = p[0]; lab.y = p[1];
          break outer;
        }
      }
    }
  }

  // A port's name stands on its quayside. It stood at the middle of its ward, which runs back from
  // the water as far as it runs along it — over twelve worlds 101 of 139 harbour names stood more
  // than 30 units from the water they named. It takes the ward's dry ground nearest the water now,
  // a name's height back from the edge so it is read against the quay, not over the waves.
  const harbourLabel = labels.find((l) => l.type === "harbor");
  const harbourWard = zoned.find((z) => z.type === "harbor");
  if (harbourLabel && harbourWard && water.bodies.length) {
    const toWater = (q: Point) => { let d = Infinity; for (const b of seaOnly.bodies) for (let i = 0; i < b.length; i++) d = Math.min(d, pointSegDist(q, b[i], b[(i + 1) % b.length])); return d; };
    const bb = bbox(harbourWard.polygon);
    let best: Point | null = null, bd = Infinity;
    for (let y = bb.minY + 1.5; y < bb.maxY; y += 3) for (let x = bb.minX + 1.5; x < bb.maxX; x += 3) {
      const q: Point = [x, y];
      if (!pointInPolygon(q, harbourWard.polygon) || !inTown(q) || inWater(water, q)) continue;
      const d = toWater(q);
      if (d >= 9 && d < bd) { bd = d; best = q; }
    }
    if (best) { harbourLabel.x = best[0]; harbourLabel.y = best[1]; }
  }

  const allBuildings = wards.flatMap((w) => w.buildings);
  // trees stay clear of the street network (used only here now that buildings are inset off streets)
  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };
  // A tree is drawn 2.2 across the radius: its middle outside a house or off a road's centre line is
  // not enough. And it keeps off what a town keeps open or builds large — the market square, the
  // cathedral, the guild hall, the castle — where a forest town's trees stood on 65, 42, 36 and 32
  // plates of twelve worlds.
  const TREE_R = 2.2;
  const keepOff: Polygon[] = [
    ...landmarks.map((m) => m.outline),
    ...(castle ? [castle.outerWall ?? castle.innerWall] : []),
    ...zoned.filter((z) => z.type === "plaza").map((z) => z.polygon),
  ];
  // a point on (or within r of) any of a set of shapes; each shape's box is taken once per set
  const boxesOf = new WeakMap<Polygon[], ReturnType<typeof bbox>[]>();
  const onShape = (p: Point, shapes: Polygon[], r: number) => {
    let boxes = boxesOf.get(shapes);
    if (!boxes || boxes.length !== shapes.length) { boxes = shapes.map(bbox); boxesOf.set(shapes, boxes); }
    return shapes.some((sh, k) => {
      const b = boxes![k];
      if (p[0] < b.minX - r || p[0] > b.maxX + r || p[1] < b.minY - r || p[1] > b.maxY + r) return false;
      if (pointInPolygon(p, sh)) return true;
      for (let i = 0; i < sh.length; i++) if (pointSegDist(p, sh[i], sh[(i + 1) % sh.length]) < r) return true;
      return false;
    });
  };
  const scatterTrees = (n: number): Point[] => {
    const out: Point[] = [];
    const bb = bbox(boundary);
    let tries = 0;
    while (out.length < n && tries < n * 10) {
      tries++;
      const p: Point = [bb.minX + rng() * (bb.maxX - bb.minX), bb.minY + rng() * (bb.maxY - bb.minY)];
      if (!pointInPolygon(p, boundary) || inWater(water, p) || nearRoad(p)) continue;
      if (roadSegs.some((sg) => pointSegDist(p, sg.a, sg.c) < sg.clear + TREE_R)) continue;
      if (onShape(p, allBuildings, TREE_R) || onShape(p, keepOff, TREE_R + 0.5)) continue;
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
  const suburbRoads: Polyline[] = [];
  const suburbs: Polygon[] = [];
  for (const g of wall.gates) {
    const road = roadOut(g);
    if (!road) continue;
    const { ux, uy, start, L, end } = road;
    const nx = -uy, ny = ux;                  // perpendicular unit
    // gentle bend at the midpoint so the highway reads hand-drawn, not ruled
    const bendOff = (rng() - 0.5) * 12;
    const mid: Point = [start[0] + ux * L * 0.5 + nx * bendOff, start[1] + uy * L * 0.5 + ny * bendOff];
    // (a road that crosses water keeps straight, so its bridge stands where its crossing was checked)
    const straight = inWater(water, mid) || inMountains(mountains, mid) || !dryLink(start, end);
    suburbRoads.push([[g[0], g[1]], straight ? [start[0] + ux * L * 0.5, start[1] + uy * L * 0.5] : mid, end]);
    // faubourg: a SHORT cluster of houses right at the gate (a gate hamlet), not a long ribbon —
    // the "village" character lives in the nucleated hamlets further out (countryside.villages)
    const ribbon = Math.min(26, L);
    for (let d = 6; d < ribbon; d += 8) {
      const prob = 0.85 - (d / ribbon) * 0.35;
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
        const house: Polygon = [
          [cx - ux * hw - nx * hh, cy - uy * hw - ny * hh],
          [cx + ux * hw - nx * hh, cy + uy * hw - ny * hh],
          [cx + ux * hw + nx * hh, cy + uy * hw + ny * hh],
          [cx - ux * hw + nx * hh, cy - uy * hw + ny * hh],
        ];
        // the whole house, not its middle: a gate house stood with a corner in the river on 10 plates
        // of twelve worlds, and on the mountain's rock on 7
        if (house.some((q) => pointInPolygon(q, boundary) || inMountains(mountains, q) || !inCanvas(q)) || overlapsWater(water, house)) continue;
        suburbs.push(house);
      }
    }
  }
  // A road out of a gate that crosses the water on its way to the edge of the plate crosses it on a
  // bridge: it used to be drawn straight over the river (11 plates of twelve worlds).
  water.bridges.push(...waterBridges(suburbRoads, water));

  // ★ The plate's own furniture lies over the country: the town's name on its tablet across the top,
  // the compass on its disc in one bottom corner, the scale on its tablet in the other. Nothing out
  // there knew it — over twelve worlds some two hundred hamlets, farms, gallows, cemeteries, abbeys
  // and mills lay under one of them. They keep clear now. The name's tablet is reserved for the
  // longest the name may be drawn: its Latin spelling, and centred either on the plate or, in an
  // exported plate that carries its key beside it, on plate and key together.
  const titleHalf = Math.max(60, (ctx.name.length * 13) / 2 + 22);
  const furniture: Polygon[] = [
    [[bounds.w / 2 - titleHalf, 0], [bounds.w / 2 + PLATE_KEY_STRIP / 2 + titleHalf, 0], [bounds.w / 2 + PLATE_KEY_STRIP / 2 + titleHalf, 50], [bounds.w / 2 - titleHalf, 50]],
    Array.from({ length: 16 }, (_, k) => [bounds.w - 32 + Math.cos((k / 16) * Math.PI * 2) * 27, bounds.h - 35 + Math.sin((k / 16) * Math.PI * 2) * 27] as Point),
    [[10, bounds.h - 38], [122, bounds.h - 38], [122, bounds.h], [10, bounds.h]],
  ];
  const furnitureBoxes = furniture.map(bbox);
  const underFurniture = (p: Point, pad = 0) => furniture.some((f, i) => {
    const b = furnitureBoxes[i];   // (nowhere near its box: neither under it nor within pad of it)
    if (p[0] < b.minX - pad || p[0] > b.maxX + pad || p[1] < b.minY - pad || p[1] > b.maxY + pad) return false;
    if (pointInPolygon(p, f)) return true;
    if (pad > 0) for (let i = 0; i < f.length; i++) if (pointSegDist(p, f[i], f[(i + 1) % f.length]) < pad) return true;
    return false;
  });

  // ★ Everything drawn out in the country stands on ground of its own. Each piece was placed by its
  // middle alone — kept off the town, the water and the other pieces' middles — so its drawing lay
  // across a road out of town, a gate house or a field: over twelve worlds an inn stood on the gate
  // hamlet on 377 plates and on its road on 174, and some 150 abbeys, cemeteries, gallows, lazar
  // houses, fairs and mills lay on a road or a field. Each now has a footprint the size it is drawn,
  // placed only where that footprint is clear, and the fields are laid round the footprints exactly.
  const drawnOut: Polygon[] = [...suburbs];
  const disc = (c: Point, r: number): Polygon => Array.from({ length: 12 }, (_, i) => [c[0] + Math.cos((i / 12) * Math.PI * 2) * r, c[1] + Math.sin((i / 12) * Math.PI * 2) * r] as Point);
  const box = (c: Point, hw: number, hh: number): Polygon => [[c[0] - hw, c[1] - hh], [c[0] + hw, c[1] - hh], [c[0] + hw, c[1] + hh], [c[0] - hw, c[1] + hh]];
  const nearLine = (fp: Polygon, line: Polyline, d: number) => {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      if (pointInPolygon(a, fp) || pointInPolygon(b, fp)) return true;
      for (let j = 0; j < fp.length; j++) {
        const q = fp[j], r = fp[(j + 1) % fp.length];
        if (segmentsIntersect(a, b, q, r) || pointSegDist(q, a, b) < d) return true;
      }
    }
    return false;
  };
  const standsClear = (fp: Polygon) =>
    fp.every((q) => inCanvas(q) && !pointInPolygon(q, boundary) && !inMountains(mountains, q) && !underFurniture(q))
    && !overlapsWater(water, fp)
    && !drawnOut.some((o) => polysOverlap(fp, o))
    && !suburbRoads.some((r) => nearLine(fp, r, 1.5));

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
    if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p) || underFurniture(p, 6)) continue;
    if (nearWater(p) && standsClear(disc(p, 3.2))) { const r = raceEnd(p); outworks.push({ type: "watermill", at: p, angle: rng() * Math.PI * 2, race: r ? [p, r] : undefined }); drawnOut.push(disc(p, 3.2)); }
  }
  // windmill on exposed high ground: phase 0 insists on open country well past the wall,
  // phase 1 falls back to any valid spot so a cramped canvas still yields a mill
  for (let phase = 0; phase < 2 && outworks.length === 0; phase++) {
    for (let tries = 0; tries < 80 && outworks.length === 0; tries++) {
      const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p) || underFurniture(p, 6)) continue;
      if (suburbs.some((b) => { const c = centroid(b); return Math.hypot(c[0] - p[0], c[1] - p[1]) < 10; })) continue;
      if (phase === 0 && Math.hypot(p[0] - center[0], p[1] - center[1]) < radius + 22) continue; // exposed, on a rise
      if (!standsClear(disc(p, 4.5))) continue;              // its sails turn 4 out
      outworks.push({ type: "windmill", at: p, angle: rng() * Math.PI * 2 });
      drawnOut.push(disc(p, 4.5));
    }
  }

  // harbor: generated LAST of the intramural/water features (its rng draws don't perturb the layout above); sea cities only
  const harbor = makeHarbor(rng, seaOnly, boundary, [center[0], center[1]]);
  // The quay is the whole seaward run of the wall and its warehouses line all of it, so where the
  // castle stands on that run a warehouse stood on the castle; the lord's stretch has none.
  if (harbor && castleWard) harbor.wharves = harbor.wharves.filter((wf) => !polysOverlap(wf, castleWard.polygon));
  // the wharves ARE the dockside warehouses; drop any intramural house they cover so the quay
  // buildings don't visually overlap the town blocks (user-reported "buildings overlapping").
  if (harbor && harbor.wharves.length) {
    for (const ward of wards) {
      if (!ward.buildings.length) continue;
      ward.buildings = ward.buildings.filter((b) => !harbor.wharves.some((wf) => polysOverlap(b, wf)));
    }
  }

  // extramural landmarks: an empty spot OUTSIDE the wall (not in the town/water/mountains, in the
  // canvas margin, clear of suburbs/mills). Generated after the harbor so coastal layouts are unchanged.
  const occupied: Point[] = [...suburbs.map((b) => centroid(b)), ...outworks.map((o) => o.at)];
  // (the footprint each is drawn to: the abbey's spire reaches 11 from its middle, a fair's green 9)
  const findSpot = (minGap: number, footprint: (p: Point) => Polygon): Point | null => {
    for (let tries = 0; tries < 120; tries++) {
      const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p) || underFurniture(p, 10)) continue;
      if (occupied.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < minGap)) continue;
      const fp = footprint(p);
      if (!standsClear(fp)) continue;
      occupied.push(p);
      drawnOut.push(fp);
      return p;
    }
    return null;
  };
  let abbey: Abbey | null = null;
  if (ctx.size >= 3) { const s = findSpot(20, (p) => disc(p, 11)); if (s) abbey = { at: s, angle: rng() * Math.PI * 2 }; }
  let cemetery: Cemetery | null = null;
  { const s = findSpot(13, (p) => box(p, 6.2, 6.7)); if (s) { const graves: Point[] = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) graves.push([s[0] + (c - 1) * 3, s[1] + (r - 1) * 3.2]); cemetery = { at: s, graves }; } }
  const gallows: Point | null = ctx.size >= 2 ? findSpot(10, (p) => box([p[0] + 2.5, p[1] - 1], 3.2, 5.6)) : null;

  // leper house (lazar house): a chapel + a couple of huts kept OUTSIDE the town at a distance
  // (research: leprosaria were sited beyond the walls, along a road, to isolate the afflicted).
  let leperHouse: { at: Point; angle: number } | null = null;
  if (ctx.size >= 2) { const s = findSpot(16, (p) => disc(p, 8)); if (s) leperHouse = { at: s, angle: rng() * Math.PI * 2 }; }

  // fairground: an open green outside the walls where the periodic fair sets up its stall rows
  // (research: fairs were held on commons/fields beyond the gates, not inside the market square).
  let fairground: { at: Point; angle: number; stalls: Polygon[] } | null = null;
  if (ctx.size >= 3) {
    const s = findSpot(20, (p) => disc(p, 9.5));
    if (s) {
      const angle = rng() * Math.PI * 2;
      const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
      const stalls: Polygon[] = [];
      for (const side of [-1, 1]) for (let j = -1; j <= 1; j++) {
        const cx = s[0] + ux * j * 4 + nx * side * 4, cy = s[1] + uy * j * 4 + ny * side * 4;
        const hw = 1.6, hh = 1.1;
        stalls.push([
          [cx - ux * hw - nx * hh, cy - uy * hw - ny * hh],
          [cx + ux * hw - nx * hh, cy + uy * hw - ny * hh],
          [cx + ux * hw + nx * hh, cy + uy * hw + ny * hh],
          [cx - ux * hw + nx * hh, cy - uy * hw + ny * hh],
        ]);
      }
      fairground = { at: s, angle, stalls };
    }
  }

  // The open ground of a ward nearest to `prefer`: inside the town and its wall's lane, on dry land,
  // `clear` off every road as drawn. A sign placed at a ward's site or centroid stood wherever that
  // happened to fall — 52 parish churches in the river and 18 on a street over twelve worlds, a
  // market cross and three wells on a road through the square.
  const roadDist = (p: Point) => { let d = Infinity; for (const sg of roadSegs) d = Math.min(d, pointSegDist(p, sg.a, sg.c) - sg.clear); return d; };
  const landmarkOutlines = landmarks.map((m) => m.outline);
  const openSpot = (poly: Polygon, prefer: Point, clear: number): Point | null => {
    // the grid's points nearest first (a stable sort, so a tie keeps its place in the scan), and the
    // first that is open ground is the answer — the nearest, found without testing the rest
    const b = bbox(poly);
    const pts: { q: Point; d: number }[] = [];
    for (let y = b.minY + 1.25; y < b.maxY; y += 2.5) for (let x = b.minX + 1.25; x < b.maxX; x += 2.5) pts.push({ q: [x, y], d: Math.hypot(x - prefer[0], y - prefer[1]) });
    pts.sort((u, v) => u.d - v.d);
    // ...and a sign stands off the great buildings and the trees (a parish cross stood on the guild
    // hall on 62 plates of twelve worlds: the hall is built at the middle of its ward, the ward's
    // own site, which is where a parish church was looked for first)
    const open = (q: Point) => !onShape(q, landmarkOutlines, 3.5) && !features.trees.some((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) < 4);
    for (const { q } of pts) if (pointInPolygon(q, poly) && inTown(q) && !inWater(water, q) && roadDist(q) >= clear && open(q)) return q;
    return null;
  };

  // parish churches: a steeple in a few non-civic wards (skyline). Uses zoned wards, no overlap
  // (distinct Voronoi cells) so the count is exactly min(1+size, eligible). Each stands on its
  // ward's open ground nearest the ward's site; the pick of wards draws exactly as it did.
  const parishChurches: Point[] = [];
  {
    const pool = zoned.filter((z) => !(["cathedral", "castle", "plaza", "harbor"] as WardType[]).includes(z.type));
    const want = Math.min(1 + ctx.size, pool.length);
    for (let k = 0; k < want; k++) {
      const idx = Math.floor(rng() * pool.length);
      const z = pool.splice(idx, 1)[0];
      // (the ward's own site, where nothing is open, still stands off the streets: taken as it was,
      // a steeple stood in the road on 3 plates of twelve worlds)
      const at = openSpot(z.polygon, z.site, 3.5)
        ?? (inTown(z.site) && !inWater(water, z.site) && roadDist(z.site) >= 3.5 && !onShape(z.site, landmarkOutlines, 3.5) ? z.site : null);
      if (at) parishChurches.push(at);   // a ward with no dry open ground has no church to show
    }
  }

  // market square furniture: a market cross + public well on the open plaza (no rng) — the cross at
  // the open middle of the square as the town has it, the well a few steps off it
  const plazaWard = zoned.find((z) => z.type === "plaza") ?? null;
  let marketCross: Point | null = null, well: Point | null = null;
  if (plazaWard) {
    const cut = clipToConvex(boundary, plazaWard.polygon);
    const mid = cut.length >= 3 ? centroid(cut) : centroid(plazaWard.polygon);
    marketCross = openSpot(plazaWard.polygon, mid, 4) ?? mid;
    const mc = marketCross;
    const offs: Point[] = [[4, 3], [-4, 3], [4, -3], [-4, -3], [5, 0], [-5, 0], [0, 5], [0, -5]];
    const at = offs.map(([ox, oy]) => [mc[0] + ox, mc[1] + oy] as Point)
      .find((q) => pointInPolygon(q, plazaWard.polygon) && inTown(q) && !inWater(water, q) && roadDist(q) >= 2.5);
    well = at ?? [mc[0] + 4, mc[1] + 3];
  }
  // inns cluster just outside the busiest gates (travelers). Into occupied so countryside avoids them.
  const inns: Point[] = [];
  {
    const want = Math.min(1 + Math.floor(ctx.size / 3), suburbRoads.length);
    for (let k = 0; k < want; k++) {
      const road = suburbRoads[k];
      if (road.length < 2) continue;
      // By the road a little way past the gate hamlet, on whichever side has room: it stood 20 out
      // and 5 off the road, in the middle of the hamlet's houses, with its sign across the road.
      const footprint = (q: Point) => box([q[0] + 1.4, q[1] - 0.3], 4.4, 2.8);   // the house and its sign
      let placed: Point | null = null;
      for (const along of [30, 36, 24, 42, 48]) {
        let at = along, i = 0;
        while (i < road.length - 2 && at > Math.hypot(road[i + 1][0] - road[i][0], road[i + 1][1] - road[i][1])) { at -= Math.hypot(road[i + 1][0] - road[i][0], road[i + 1][1] - road[i][1]); i++; }
        const a = road[i], b = road[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (const side of [1, -1]) {
          const q: Point = [a[0] + ux * at - uy * side * 7, a[1] + uy * at + ux * side * 7];
          if (inWater(water, q) || underFurniture(q, 5) || !standsClear(footprint(q))) continue;
          placed = q;
          break;
        }
        if (placed) break;
      }
      if (!placed) continue;
      inns.push(placed); occupied.push(placed); drawnOut.push(footprint(placed));
    }
  }

  // barbican: a forward gate-work at the principal gate(s) — the longest gate-road is the main
  // approach (ties by index). Skip water/mountain-facing gates. Into occupied.
  const barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[] = [];
  {
    const ranked = suburbRoads
      .map((r) => { let len = 0; for (let i = 0; i < r.length - 1; i++) len += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); return { r, len }; })
      .sort((a, b) => b.len - a.len);
    const wantB = ctx.size >= 4 ? 2 : 1;
    for (const { r } of ranked) {
      if (barbicans.length >= wantB) break;
      if (r.length < 2) continue;
      const gate = r[0];
      const dx = r[1][0] - gate[0], dy = r[1][1] - gate[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const front: Point = [gate[0] + ux * 12, gate[1] + uy * 12];
      if (pointInPolygon(front, boundary) || inWater(water, front) || inMountains(mountains, front)) continue;
      const t1: Point = [gate[0] + ux * 11 + nx * 4, gate[1] + uy * 11 + ny * 4];
      const t2: Point = [gate[0] + ux * 11 - nx * 4, gate[1] + uy * 11 - ny * 4];
      const wallA: Polyline = [[gate[0] + nx * 3, gate[1] + ny * 3], t1];
      const wallB: Polyline = [[gate[0] - nx * 3, gate[1] - ny * 3], t2];
      barbicans.push({ at: front, towers: [t1, t2], walls: [wallA, wallB] });
      occupied.push(front, t1, t2);
      drawnOut.push(disc(t1, 3), disc(t2, 3));
    }
    // The barbican stands where the gate hamlet's first houses were: its towers, 11 out, were drawn
    // on top of them on 513 barbicans of twelve worlds. A forward gate-work is built in front of the
    // gate, and the houses it stands on make way for it.
    const onBarbican = (h: Polygon) => barbicans.some((bb) =>
      bb.towers.some((t) => polysOverlap(h, disc(t, 3))) || bb.walls.some((wl) => nearLine(h, wl, 1.8)));
    for (let i = suburbs.length - 1; i >= 0; i--) if (onBarbican(suburbs[i])) suburbs.splice(i, 1);
  }

  // waterside trades: tanners/dyers pushed to the water's edge outside the walls (stench/effluent).
  // Honest approximation of "by the water" — no flow data for true downstream. Into occupied.
  const riversideTrades: { at: Point; kind: "tanner" | "dyer" }[] = [];
  if (water.bodies.length) {
    const nearW = (p: Point) => inWater(water, [p[0] + 4, p[1]]) || inWater(water, [p[0] - 4, p[1]]) || inWater(water, [p[0], p[1] + 4]) || inWater(water, [p[0], p[1] - 4]);
    const want = 2 + (ctx.size >= 4 ? 1 : 0);
    for (let tries = 0; tries < 140 && riversideTrades.length < want; tries++) {
      const p: Point = [4 + rng() * (bounds.w - 8), 4 + rng() * (bounds.h - 8)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || underFurniture(p, 4)) continue;
      if (!nearW(p)) continue;
      if (occupied.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 8)) continue;
      if (!standsClear(box(p, 2.4, 2.8))) continue;   // the workshop and the dyer's rack below it
      const kind: "tanner" | "dyer" = rng() < 0.5 ? "tanner" : "dyer";
      riversideTrades.push({ at: p, kind }); occupied.push(p); drawnOut.push(box(p, 2.4, 2.8));
    }
  }

  // countryside: generated LAST (rng-stream tail, per convention) so it avoids every
  // suburb/outwork/landmark already placed above (occupied carries all of their centres).
  const countryside = generateCountryside(rng, {
    bounds, boundary, water, mountains,
    roads: suburbRoads,
    moat: moat ?? [],
    obstacles: [...occupied],
    // faubourg house footprints: patches must not overlap them (centre-gap missed big blocks) — nor the
    // plate's furniture
    obstaclePolys: [...drawnOut, ...furniture],
    size: ctx.size, biome: ctx.biome, oasis: archetype.oasis,
  });

  return {
    name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital,
    archetype, bounds, boundary, water, mountains, wall, moat, gateBridges, mainRoads, minorRoads, wards, parks, labels, features, suburbRoads, suburbs, outworks, harbor,
    abbey, cemetery, gallows, leperHouse, fairground, parishChurches, marketCross, well, inns, barbicans, riversideTrades, countryside, castle,
    parkTrees, landmarks,
  };
}
