// The buildings of a block, and the few buildings a town has only one of.
//
// Lots are cut the way Watabou's generator cuts them (TownGeneratorOS, `Ward.createAlleys`): across
// the block's LONGEST edge, at a ratio near its middle, turned a little in a chaotic ward and not
// at all in a small one, sometimes leaving an alley in the cut, until a piece is house-sized. The
// cut used to be axis-aligned — split the bounding box across its longer side — so the lots lay on
// the page's grid rather than their street's: measured over twelve worlds, a median 54% of houses
// stood more than 15 degrees askew of the street nearest them, and a ward's lots read as paving
// laid over the block and cut off by its edges.
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { area, splitByLine, insetEdges, pointInPolygon, pointSegDist, bbox, centroid } from "../geometry";

export interface LotOpts {
  minArea: number;    // a piece smaller than about this is one building
  chaos?: number;     // 0..1: how far a cut strays from the middle and from square (Watabou's gridChaos)
  sizeChaos?: number; // 0..1: how much building sizes vary
  emptyProb?: number; // the share of house-sized pieces left open: yards, gardens, a parade ground
  alley?: number;     // the width of an alley, where a cut opens one
  margin?: number;    // the gap drawn round each building
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** split a convex polygon by the line through `p` along `dir`; each half's cut side pulled back gap/2 */
function cut(poly: Polygon, p: Point, dir: [number, number], gap: number): Polygon[] {
  const q: Point = [p[0] + dir[0], p[1] + dir[1]];
  const halves = splitByLine(poly, p, q);
  if (halves.length < 2 || gap <= 0) return halves;
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const onLine = (v: Point) => Math.abs(dir[0] * (v[1] - p[1]) - dir[1] * (v[0] - p[0])) / len < 1e-6;
  const out: Polygon[] = [];
  for (const h of halves) {
    const ds = h.map((v, i) => (onLine(v) && onLine(h[(i + 1) % h.length]) ? gap / 2 : 0));
    const s = insetEdges(h, ds);
    if (s.length >= 3) out.push(s);
  }
  return out;
}

/** the buildings of a CONVEX block (see the note at the top of the file) */
export function lots(rng: Rng, block: Polygon, o: LotOpts): Polygon[] {
  const chaos = o.chaos ?? 0.5, sizeChaos = o.sizeChaos ?? 0.6, empty = o.emptyProb ?? 0.04;
  const alley = o.alley ?? 1.2, margin = o.margin ?? 0.3;
  const out: Polygon[] = [];
  const keep = (p: Polygon) => {
    const m = margin > 0 ? insetEdges(p, margin) : p;
    if (m.length >= 3 && area(m) > o.minArea * 0.12) out.push(m);
  };
  const recurse = (poly: Polygon, depth: number, split: boolean) => {
    const n = poly.length;
    let li = 0, ll = -1;
    for (let i = 0; i < n; i++) { const l = dist(poly[i], poly[(i + 1) % n]); if (l > ll) { ll = l; li = i; } }
    const a = poly[li], b = poly[(li + 1) % n];
    const spread = 0.8 * chaos;
    const ratio = (1 - spread) / 2 + rng() * spread;
    // a small piece is cut square, whatever the ward, or its houses come out as wedges
    const turn = (rng() - 0.5) * (Math.PI / 6) * chaos * (area(poly) < o.minArea * 4 ? 0 : 1);
    const ex = (b[0] - a[0]) / (ll || 1), ey = (b[1] - a[1]) / (ll || 1);
    const c = Math.cos(turn), s = Math.sin(turn);
    const dir: [number, number] = [-ey * c - ex * s, -ey * s + ex * c];
    const p1: Point = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    const halves = depth > 12 || ll < 1e-6 ? [] : cut(poly, p1, dir, split ? alley : 0);
    if (halves.length < 2) { keep(poly); return; }
    for (const h of halves) {
      if (area(h) < o.minArea * Math.pow(2, 4 * sizeChaos * (rng() - 0.5))) {
        if (rng() >= empty) keep(h);
      } else {
        const r1 = rng(), r2 = rng();
        recurse(h, depth + 1, area(h) > o.minArea / Math.max(1e-6, r1 * r2));
      }
    }
  };
  if (block.length >= 3 && area(block) > o.minArea * 0.12) recurse(block, 0, true);
  return out;
}

/** a rectangle centred at c, long side along u */
function rect(c: Point, ux: number, uy: number, halfLong: number, halfShort: number): Polygon {
  const vx = -uy, vy = ux;
  return [
    [c[0] - ux * halfLong - vx * halfShort, c[1] - uy * halfLong - vy * halfShort],
    [c[0] + ux * halfLong - vx * halfShort, c[1] + uy * halfLong - vy * halfShort],
    [c[0] + ux * halfLong + vx * halfShort, c[1] + uy * halfLong + vy * halfShort],
    [c[0] - ux * halfLong + vx * halfShort, c[1] - uy * halfLong + vy * halfShort],
  ];
}

function edgeDist(p: Point, poly: Polygon): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** the sampled point of a polygon farthest from its edges */
function pole(poly: Polygon): Point {
  const b = bbox(poly);
  const step = Math.max(0.75, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 20);
  let best = centroid(poly), bd = pointInPolygon(best, poly) ? edgeDist(best, poly) : -1;
  for (let y = b.minY + step / 2; y < b.maxY; y += step) for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    const p: Point = [x, y];
    if (!pointInPolygon(p, poly)) continue;
    const d = edgeDist(p, poly);
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}

const fitsIn = (shape: Polygon, room: Polygon, clear: number) => shape.every((p) => pointInPolygon(p, room) && edgeDist(p, room) >= clear);

// Where a great building may stand, in shares of its own length along and across it: the block's
// deepest point first, then outward. Five spots round the middle were all a river through the block
// needed to leave a cathedral ward without its church.
const SPOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (const du of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4]) for (const dv of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45]) out.push([du, dv]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

/**
 * A cathedral: a Latin cross with its apse to the east, as churches were built — a long nave from
 * the west front, a transept across it, a shorter choir ending in the round apse. The cathedral
 * ward used to be filled with the same houses as the ward beside it, told apart only by their lilac.
 * The biggest cross that fits the block — facing east where it can, turned to the block's own long
 * side where that holds a bigger one; `crossing` is where the arms meet, where its cross is drawn.
 */
export function cathedralChurch(room: Polygon, ok: (outline: Polygon) => boolean = () => true): { outline: Polygon; crossing: Point; ridges: [Point, Point][] } | null {
  const at = pole(room);
  // the long side of the block, for a church that cannot face east
  let lx = 1, ly = 0, ll = -1;
  for (let i = 0; i < room.length; i++) {
    const a = room[i], b = room[(i + 1) % room.length], l = dist(a, b);
    if (l > ll) { ll = l; lx = (b[0] - a[0]) / (l || 1); ly = (b[1] - a[1]) / (l || 1); }
  }
  for (let L = 40; L >= 15; L *= 0.92) {
    for (const [ux, uy] of [[1, 0], [lx, ly]] as [number, number][]) {
      const W = 0.24 * L, T = 0.6 * L, Wc = 0.8 * W, r = Wc / 2;
      const u0 = -0.5 * L, ut = 0.1 * L, tw = W, ua = 0.5 * L - r;
      // the outline in the church's own frame: u east along the nave, v across it
      const local: [number, number][] = [
        [u0, -W / 2], [ut, -W / 2], [ut, -T / 2], [ut + tw, -T / 2], [ut + tw, -Wc / 2], [ua, -Wc / 2],
      ];
      for (let k = 1; k < 8; k++) { const a = -Math.PI / 2 + (k / 8) * Math.PI; local.push([ua + Math.cos(a) * r, Math.sin(a) * r]); }
      local.push([ua, Wc / 2], [ut + tw, Wc / 2], [ut + tw, T / 2], [ut, T / 2], [ut, W / 2], [u0, W / 2]);
      const vx = -uy, vy = ux;
      const place = (c: Point): Polygon => local.map(([u, v]) => [c[0] + ux * u + vx * v, c[1] + uy * u + vy * v] as Point);
      // the pole first, then a little toward each side, for a block whose deepest point is off-centre
      for (const [du, dv] of SPOTS) {
        const c: Point = [at[0] + ux * du * L + vx * dv * L, at[1] + uy * du * L + vy * dv * L];
        const outline = place(c);
        if (fitsIn(outline, room, 1.5) && ok(outline)) {
          const mid = ut + tw / 2;
          const at = (u: number, v: number): Point => [c[0] + ux * u + vx * v, c[1] + uy * u + vy * v];
          // the roof's ridges: down the nave and choir, and across the transept
          const ridges: [Point, Point][] = [[at(u0, 0), at(ua, 0)], [at(mid, -T / 2), at(mid, T / 2)]];
          return { outline, crossing: at(mid, 0), ridges };
        }
      }
    }
  }
  return null;
}

/**
 * A guild hall: one great roof along the block's long side, the building a guild ward is named for.
 * The biggest that fits, down to the size of a large house; null where even that will not go in.
 */
export function guildHall(room: Polygon, ok: (outline: Polygon) => boolean = () => true): { outline: Polygon; ridges: [Point, Point][] } | null {
  const at = pole(room);
  let ux = 1, uy = 0, ll = -1;
  for (let i = 0; i < room.length; i++) {
    const a = room[i], b = room[(i + 1) % room.length], l = dist(a, b);
    if (l > ll) { ll = l; ux = (b[0] - a[0]) / (l || 1); uy = (b[1] - a[1]) / (l || 1); }
  }
  for (let half = 14; half >= 6; half *= 0.9) {
    for (const [du, dv] of SPOTS) {
      const c: Point = [at[0] + ux * du * 2 * half - uy * dv * 2 * half, at[1] + uy * du * 2 * half + ux * dv * 2 * half];
      const hall = rect(c, ux, uy, half, half * 0.42);
      if (fitsIn(hall, room, 1.5) && ok(hall)) {
        const ridge: [Point, Point] = [[c[0] - ux * half, c[1] - uy * half], [c[0] + ux * half, c[1] + uy * half]];
        return { outline: hall, ridges: [ridge] };
      }
    }
  }
  return null;
}
