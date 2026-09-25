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
  /** for a town the world gives roads: which of them leave by each gate (none: a local way out) */
  gateRoads?: GateRoad[][];
}

/** a road the world gives a town, as the plate takes it: the way it leaves, and where it goes */
export interface GateRoad { bearing: number; to: number[] }

// how far round from the way a road leaves a gate may stand and still be its gate: its road out can
// turn 45 degrees toward the road's way from straight out of the town (see city.ts, roadOut)
const AIM_REACH = Math.PI / 2;

const across = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// how far outward a boundary edge probes for the sea: the waterfront itself. It was 36, to bridge
// the beach a port town used to stand back from its shore by — which also opened every edge of the
// town within 36 of the sea, on dry land: over twelve worlds 124 of 139 ports had a median 42 units
// of their landward edge with no wall at all. A port now comes down to its water (see SHORE_IN), so
// only the stretch that stands on it goes unwalled.
const SEA_PROBE = 8;
// two towers on one run of wall stand at least this far apart
const TOWER_GAP = 9;
// ...and none where it would be drawn on a gate. A gate is drawn as a 6-wide block, square to the
// plate, its corners rounded by 1 and its outline 1 wide; a tower as a disc of 2.6 with a 0.8
// outline. So the block is a 4-wide core grown by 1.5, the tower a point grown by 3.0, and a tower
// is kept only where the two outlines stay apart. (A flat 6 from the gate's middle cleared the block
// along the wall but not toward its corners, which reach 4.2 out: 12 towers still stood on a gate
// there, and 45 more ran their outline into its.)
const GATE_CORE = 2, GATE_REACH = 1.5, TOWER_REACH = 3.0;
const onGate = (t: Point, g: Point) =>
  Math.hypot(Math.max(Math.abs(t[0] - g[0]) - GATE_CORE, 0), Math.max(Math.abs(t[1] - g[1]) - GATE_CORE, 0)) < GATE_REACH + TOWER_REACH;

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

function placeGates(
  segments: Polyline[], roads: Polyline[], maxGates: number, seaGates: Point[], usable: (p: Point) => boolean,
  aims?: { from: Point; roads: GateRoad[]; streets: Polyline[] },
): { gates: Point[]; served: number[][] } {
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
  // ★ ...and, for a town the world gives roads, every place a street runs through the wall. The street
  // nodes reach the wall at a median five places, and a road's way out had none of them within 45
  // degrees for one road in five over twelve worlds; the streets cross it at a median eleven, one of
  // them within 45 degrees of all but 8 of 688 roads. A gate there has its street for its approach: a
  // gate opened where the road met the wall had to be tied in by a stub a median 34 long, cutting
  // across a block — and under a cathedral and two guild halls.
  const crossings: Point[] = [];
  if (aims) for (const st of aims.streets) for (const sg of segments) for (let i = 0; i + 1 < sg.length; i++) {
    const p = crossingOf(st[0], st[st.length - 1], sg[i], sg[i + 1]);
    if (!p || !good(p)) continue;
    if ([...gates, ...crossings].some((g) => (g[0] - p[0]) ** 2 + (g[1] - p[1]) ** 2 < MERGE2)) continue;
    crossings.push(p);
  }
  if (gates.length === 0 && crossings.length === 0) {
    let kept = spare.length ? reduceGates(spare, 1) : fallback ? [fallback] : [];
    // ...and it is a way out: where the wall point nearest a street leads nowhere — a mountain town
    // where its stream rises had its one gate facing its foothills — the nearest one that does
    if (kept.length && !usable(kept[0])) {
      const out = nearestWayOut(segments, roads, good) ?? nearestWayOut(segments, roads, usable);
      if (out) kept = [out];
    }
    // (a town's one gate, however it was found, is the way out of every road that can leave by it)
    return { gates: kept, served: kept.map((g) => aimsWithin(g, aims)) };
  }
  if (!aims?.roads.length) return { gates: reduceGates(gates, maxGates), served: [] };
  // ★ A gate for each road the world gives the town: the way out — a street's end at the wall, or a
  // street running through it — whose direction from the middle of the town is nearest the way the road
  // leaves. The pairs are matched nearest first, so two roads never take one gate and the road whose
  // gate is plainest gets it. A road left without a gate of its own leaves by the nearest one within
  // AIM_REACH, forking outside it, as roads did. Then the town takes as many more gates as it had, as
  // spread out as they come, for the lanes to its fields.
  const cands = [...gates, ...crossings].map((p) => ({ p }));
  const dir = (g: Point) => Math.atan2(g[1] - aims.from[1], g[0] - aims.from[0]);
  const pairs: { c: number; k: number; d: number }[] = [];
  cands.forEach((c, ci) => aims.roads.forEach((r, k) => {
    const d = across(dir(c.p), r.bearing);
    if (d <= AIM_REACH) pairs.push({ c: ci, k, d });
  }));
  pairs.sort((a, b) => a.d - b.d || a.k - b.k || a.c - b.c);
  const chosen: number[] = [], served: number[][] = [], taken = new Set<number>();
  for (const pr of pairs) {
    if (chosen.includes(pr.c) || taken.has(pr.k)) continue;
    chosen.push(pr.c); served.push([pr.k]); taken.add(pr.k);
  }
  aims.roads.forEach((r, k) => {
    if (taken.has(k)) return;
    let best = -1, bd = AIM_REACH;
    chosen.forEach((ci, j) => { const d = across(dir(cands[ci].p), r.bearing); if (d <= bd) { bd = d; best = j; } });
    if (best >= 0) served[best].push(k);
  });
  const out = chosen.map((ci) => cands[ci].p);
  while (out.length < maxGates) {
    let best = -1, bd = -1;
    gates.forEach((g, gi) => {
      if (chosen.includes(gi)) return;
      let md = Infinity;
      for (const c of out) md = Math.min(md, (g[0] - c[0]) ** 2 + (g[1] - c[1]) ** 2);
      if (md > bd) { bd = md; best = gi; }
    });
    if (best < 0) break;
    chosen.push(best); served.push([]); out.push(gates[best]);
  }
  // ⚠ ...and never none: where every way out stands more than AIM_REACH from every road and no street
  // end is left to fill with — the town's wall faces away from where its roads go — it keeps the way
  // out nearest a road, as a town with no street near its wall keeps one (above).
  if (!out.length && cands.length) {
    let best = 0, bd = Infinity;
    cands.forEach((c, ci) => aims.roads.forEach((r) => { const d = across(dir(c.p), r.bearing); if (d < bd) { bd = d; best = ci; } }));
    out.push(cands[best].p); served.push(aimsWithin(cands[best].p, aims));
  }
  return { gates: out, served };
}

// the world's roads that can leave by a gate: those within AIM_REACH of the way it faces
function aimsWithin(g: Point, aims?: { from: Point; roads: GateRoad[]; streets: Polyline[] }): number[] {
  if (!aims) return [];
  const d = Math.atan2(g[1] - aims.from[1], g[0] - aims.from[0]);
  return aims.roads.flatMap((r, k) => (across(d, r.bearing) <= AIM_REACH ? [k] : []));
}

// where segment ab crosses segment cd, if it does
function crossingOf(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}

// the point of the wall nearest the end of a street that `ok` accepts, if the wall has one
function nearestWayOut(segments: Polyline[], roads: Polyline[], ok: (p: Point) => boolean): Point | null {
  const ends = roads.filter((r) => r.length >= 2).flatMap((r) => [r[0], r[r.length - 1]]);
  if (!ends.length) return null;
  const spots: { p: Point; d2: number }[] = [];
  for (const s of segments) for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let j = 0; j < k; j++) {
      const p: Point = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
      spots.push({ p, d2: Math.min(...ends.map((e) => (e[0] - p[0]) ** 2 + (e[1] - p[1]) ** 2)) });
    }
  }
  spots.sort((x, y) => x.d2 - y.d2);
  return spots.find((sp) => ok(sp.p))?.p ?? null;
}

// barrier per boundary edge: 0 = none (walled), 1 = water, 2 = mountain
export function wallFromDefenses(
  boundary: Polygon, water: Water, mountains: MountainMass[], mainRoads: Polyline[],
  maxGates = Infinity, usable: (gate: Point) => boolean = () => true,
  aims?: { from: Point; roads: GateRoad[]; streets: Polyline[] },
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
      for (let d = 2; d <= SEA_PROBE; d += 2) {
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
  const { gates, served } = placeGates(segments, mainRoads, maxGates, seaGates, usable, aims);
  // A gate is its own tower: the square gate block stands where the wall is opened, and a drum tower
  // on the corner beside it was drawn on top of it — on 213 of 336 plates of twelve worlds.
  const clearOfGates = towers.filter((t) => !gates.some((g) => onGate(t, g)));
  if (!aims?.roads.length) return { segments, towers: clearOfGates, gates, seaGates };
  return { segments, towers: clearOfGates, gates, seaGates, gateRoads: served.map((ks) => ks.map((k) => aims.roads[k])) };
}
