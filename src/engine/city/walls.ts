import type { Point, Polygon, Polyline } from "../geometry";
import { centroid } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";
import type { MountainMass } from "./mountain";
import { inMountains } from "./mountain";

export interface DefenseWall {
  segments: Polyline[];
  towers: Point[];
  gates: Point[];
  seaGates: Point[];
}

// how far outward (px) a boundary edge probes for the sea; large enough to bridge the small
// land gap where the city boundary stops short of the shoreline, small enough not to catch a
// sea that is genuinely on the far side of the town.
const SEA_PROBE = 36;
// two towers on one run of wall stand at least this far apart
const TOWER_GAP = 9;
// ...and no tower this close to a gate (a 6-wide gate block and a 2.6-radius tower touch inside it)
const GATE_CLEAR = 6;

// nearest point on a polyline to p, with its squared distance
function nearestOnPolyline(p: Point, line: Polyline): { pt: Point; d2: number } {
  let best: Point = line[0], bd2 = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const q: Point = [a[0] + dx * t, a[1] + dy * t];
    const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d2 < bd2) { bd2 = d2; best = q; }
  }
  return { pt: best, d2: bd2 };
}

// keep the most spread-out `max` gates (farthest-point sampling) so a city has a few
// well-placed main gates rather than one at every road — medieval towns had 2-4 gates.
function reduceGates(gates: Point[], max: number): Point[] {
  if (gates.length <= max) return gates;
  const chosen: Point[] = [gates[0]];
  while (chosen.length < max) {
    let best: Point | null = null, bd = -1;
    for (const g of gates) {
      if (chosen.includes(g)) continue;
      let md = Infinity;
      for (const c of chosen) { const d = (g[0] - c[0]) ** 2 + (g[1] - c[1]) ** 2; if (d < md) md = d; }
      if (md > bd) { bd = md; best = g; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

// gates sit where a main road reaches the wall: snap each road endpoint onto the
// nearest wall segment when it is close enough, merging gates that nearly coincide.
// a gate this close to the end of a run of wall where the water takes over opens onto the shore
const WET_END = 10;

function placeGates(segments: Polyline[], roads: Polyline[], maxGates: number, seaGates: Point[], usable: (p: Point) => boolean): Point[] {
  const NEAR = 15, MERGE2 = 12 * 12;
  const gates: Point[] = [];
  // ★ A gate is a way out to somewhere. A street node near the end of a run of wall snapped onto
  // that end — beside the water, where the wall stops — on 55 plates of twelve worlds, and 99 gates
  // had no road leaving them at all, their way out running straight into the river or the cliff.
  // Such a spot is passed over while the town has a better one.
  const good = (g: Point) => !seaGates.some((e) => Math.hypot(e[0] - g[0], e[1] - g[1]) < WET_END) && usable(g);
  const spare: Point[] = [];
  let fallback: Point | null = null, fd2 = Infinity;   // nearest wall point to any street, however far
  for (const r of roads) {
    if (r.length < 2) continue;
    for (const end of [r[0], r[r.length - 1]]) {
      let best: Point | null = null, bd2 = NEAR * NEAR;
      for (const s of segments) {
        const { pt, d2 } = nearestOnPolyline(end, s);
        if (d2 < bd2) { bd2 = d2; best = pt; }
        if (d2 < fd2) { fd2 = d2; fallback = pt; }
      }
      if (best && !gates.some((g) => (g[0] - best![0]) ** 2 + (g[1] - best![1]) ** 2 < MERGE2)
        && !spare.some((g) => (g[0] - best![0]) ** 2 + (g[1] - best![1]) ** 2 < MERGE2)) {
        (good(best) ? gates : spare).push(best);
      }
    }
  }
  // ⚠ Every walled town has a gate. The candidates here are the ward-mesh street nodes, and
  // `extractStreets` returns the edges BETWEEN cells, so the outermost node sits one ward deep
  // inside the wall — a town with few, large wards, or one whose wall is mostly water openings,
  // can have no node within 15 units of any wall run at all. Measured over 12 seeds, 11 of 336
  // towns came out with NO gate, and a gateless town loses everything that hangs off a gate: no
  // main streets inside, no highway out, and no villages in its countryside (the fields survive
  // only because they fall back to a synthetic spine). Those towns were river, meander and lake
  // towns, whose wall is cut by the water, plus two mountain towns.
  // So when nothing is near enough, the town still takes ONE gate: the wall point closest to a
  // street, however far that is. It is a floor, not a retune — the 325 towns that had gates keep
  // exactly the gates they had.
  if (gates.length === 0 && spare.length) return reduceGates(spare, 1);
  if (gates.length === 0 && fallback) return [fallback];
  return reduceGates(gates, maxGates);
}

// barrier per boundary edge: 0 = none (walled), 1 = water, 2 = mountain
export function wallFromDefenses(
  boundary: Polygon, water: Water, mountains: MountainMass[], mainRoads: Polyline[],
  maxGates = Infinity, usable: (gate: Point) => boolean = () => true,
): DefenseWall {
  const n = boundary.length;
  const c = centroid(boundary);
  const barrier: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out: Point = [m[0] + (m[0] - c[0]) * 0.06, m[1] + (m[1] - c[1]) * 0.06];
    let bar = 0;
    if (water.kind === "sea") {
      // march outward along the edge normal so the WHOLE sea-facing side opens even when the
      // boundary stops a few px short of the shoreline — otherwise the wall seals off the
      // harbour and only a tiny stretch that literally touches the water stays open.
      const dx = m[0] - c[0], dy = m[1] - c[1], dl = Math.hypot(dx, dy) || 1;
      for (let d = 2; d <= SEA_PROBE; d += 4) {
        if (inWater(water, [m[0] + (dx / dl) * d, m[1] + (dy / dl) * d])) { bar = 1; break; }
      }
    } else if (inWater(water, out)) {
      bar = 1; // river/lake: the near outward point is enough (bridges handle crossings)
    }
    if (bar === 0 && inMountains(mountains, out)) bar = 2;
    barrier.push(bar);
  }
  const isWall = barrier.map((b) => b === 0);
  const isWaterGate = (edge: number) => barrier[((edge % n) + n) % n] === 1; // gate only at water, not cliff
  const segments: Polyline[] = [];
  const seaGates: Point[] = [];
  const allWall = isWall.every((w) => w);
  if (allWall) {
    const ring: Polyline = boundary.map((p) => [p[0], p[1]]);
    ring.push([boundary[0][0], boundary[0][1]]);
    segments.push(ring);
  } else {
    let start = 0;
    while (isWall[start]) start = (start + 1) % n;        // a non-wall edge
    let cur: Polyline | null = null;
    let runFirstEdge = -1, runLastEdge = -1;
    const closeRun = (followingEdge: number) => {
      if (!cur) return;
      if (isWaterGate(runFirstEdge - 1)) seaGates.push(cur[0]);
      if (isWaterGate(followingEdge)) seaGates.push(cur[cur.length - 1]);
      segments.push(cur);
      cur = null;
    };
    for (let k = 0; k < n; k++) {
      const e = (start + k) % n;
      if (isWall[e]) {
        if (!cur) { cur = [boundary[e]]; runFirstEdge = e; }
        cur.push(boundary[(e + 1) % n]);
        runLastEdge = e;
      } else {
        closeRun(e);
      }
    }
    closeRun(runLastEdge + 1);
  }
  const towers: Point[] = [];
  // Towers stand at the wall's corners, but not shoulder to shoulder: where two corners come within
  // TOWER_GAP of each other the second is passed over (a run keeps both its ends). Every corner
  // carried one, and a wall's corners come within six units of each other on 4 plates of twelve
  // worlds (1.3 at the closest) — so far always on a stretch a castle then took over, which is the
  // only reason no two towers stood there.
  for (const s of segments) {
    let last = -1;
    s.forEach((p, i) => {
      const end = i === s.length - 1;
      const near = last >= 0 && Math.hypot(p[0] - s[last][0], p[1] - s[last][1]) < TOWER_GAP;
      if (near && !end) return;
      // the run's last corner takes the place of a middle one it crowds, never of the first
      if (near && end && last > 0) towers.pop();
      towers.push(p); last = i;
    });
  }
  const gates = placeGates(segments, mainRoads, maxGates, seaGates, usable);
  // A gate is its own tower: the square gate block stands where the wall is opened, and a drum tower
  // on the corner beside it was drawn on top of it — on 213 of 336 plates of twelve worlds.
  const clearOfGates = towers.filter((t) => !gates.some((g) => Math.hypot(t[0] - g[0], t[1] - g[1]) < GATE_CLEAR));
  return { segments, towers: clearOfGates, gates, seaGates };
}
