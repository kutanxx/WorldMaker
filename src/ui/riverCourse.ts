// The river net as a reader sees water: runs from a source to the sea, or to the river they feed.
//
// The world keeps its rivers as segments, one from each river cell's centre to the centre of the cell
// it drains into, and the map drew them so: a chain of straight steps turning at every cell, in three
// widths, and at every mouth one more step out to the middle of a sea cell — a blue stub standing out
// past the coast. A drawn river does three things those steps did not: it bends rather than turns, it
// widens as it gathers its tributaries, and it ends where the land does.
//
// So the steps are strung into courses (a tributary ends where it meets the river that takes its water,
// which runs on), each course is drawn as one curve through its cells' centres, every step a little
// wider than the one above it, and a mouth's last step stops on the coast as the map draws it.
import type { World } from "../types/world";
import { OCEAN } from "../engine/terrain";
import { sharedEdge, type Point } from "../engine/borders";
import { noisyEdge } from "./noisyEdge";
import { dhypot, dpow } from "../engine/dmath";

export interface RiverCourse {
  points: Point[];   // source (or where it leaves its own course) to its end
  widths: number[];  // the drawn width of each step, points[i] -> points[i + 1]
  mouth: boolean;    // reaches the sea (else it ends on the river it feeds)
}

// A stream is a hairline (the map's floor of one screen pixel), the greatest river just under the coast,
// which stays the heaviest line; between them by the water carried (to the 0.7th power), as a drawn
// river's width grows with its flow's — and to a tenth of a pixel, so the map draws a handful of widths.
export function riverWidth(flow: number, largest: number): number {
  return Math.round((0.9 + 1.3 * dpow(Math.max(0, flow) / largest, 0.7)) * 10) / 10;
}

// Where a step from a land cell's centre to a sea cell's centre meets the coast between them, as drawn
// (the same wobbled edge the coastline is drawn along). Off the line when the step misses the edge — two
// cells' centres need not face across their shared edge — the coast's nearest point to the step.
function onCoast(from: Point, to: Point, line: Point[]): Point {
  let best: Point = line[0], bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const rx = to[0] - from[0], ry = to[1] - from[1], sx = b[0] - a[0], sy = b[1] - a[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) > 1e-12) {
      const t = ((a[0] - from[0]) * sy - (a[1] - from[1]) * sx) / den;
      const u = ((a[0] - from[0]) * ry - (a[1] - from[1]) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a[0] + u * sx, a[1] + u * sy];
    }
    // nearest point of this piece of coast to the step's far end
    for (const p of [a, b]) {
      const d = dhypot(p[0] - to[0], p[1] - to[1]);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

export function riverCourses(world: World): RiverCourse[] {
  const net = world.riverNet;
  if (!net.length) return [];
  const g = world.grid;
  const k = (x: number, y: number) => `${x},${y}`;
  const cellAt = new Map<string, number>();
  for (let i = 0; i < g.count; i++) cellAt.set(k(g.points[i * 2], g.points[i * 2 + 1]), i);
  const largest = net.reduce((m, s) => Math.max(m, s.f), 0);

  const out = new Map<string, number>();       // a node's one step downstream
  const main = new Map<string, number>();      // the step carrying most water INTO a node
  net.forEach((s, i) => {
    out.set(k(s.x1, s.y1), i);
    const at = k(s.x2, s.y2), was = main.get(at);
    if (was === undefined || s.f > net[was].f) main.set(at, i);
  });

  const courses: RiverCourse[] = [];
  net.forEach((s, first) => {
    if (main.has(k(s.x1, s.y1))) return;       // not a source: some course runs on through here
    const points: Point[] = [[s.x1, s.y1]];
    const widths: number[] = [];
    let i = first, mouth = false;
    for (;;) {
      const step = net[i];
      let end: Point = [step.x2, step.y2];
      widths.push(riverWidth(step.f, largest));
      const to = cellAt.get(k(step.x2, step.y2));
      if (to !== undefined && world.terrain[to] === OCEAN) {
        const from = cellAt.get(k(step.x1, step.y1))!;
        const e = sharedEdge(g.polygons[from], g.polygons[to]);
        if (e) end = onCoast([step.x1, step.y1], end, [e[0], ...noisyEdge(e[0], e[1]), e[1]]);
        points.push(end);
        mouth = true;
        break;
      }
      points.push(end);
      const at = k(step.x2, step.y2), next = out.get(at);
      if (next === undefined || main.get(at) !== i) break;   // a tributary ends on the river it feeds
      i = next;
    }
    courses.push({ points, widths, mouth });
  });
  return courses;
}

const f = (v: number) => v.toFixed(1);

/**
 * The courses drawn: one path per width, each run of steps of that width a curve through its points
 * (Catmull-Rom, its tangents taken over the whole course so a run's ends meet the next run's smoothly).
 */
export function riverPaths(world: World): Map<number, string> {
  const byWidth = new Map<number, string>();
  for (const { points: P, widths } of riverCourses(world)) {
    const n = P.length;
    let runW = -1;
    for (let i = 0; i + 1 < n; i++) {
      const a = P[i], b = P[i + 1], before = P[Math.max(0, i - 1)], after = P[Math.min(n - 1, i + 2)];
      const c1: Point = [a[0] + (b[0] - before[0]) / 6, a[1] + (b[1] - before[1]) / 6];
      const c2: Point = [b[0] - (after[0] - a[0]) / 6, b[1] - (after[1] - a[1]) / 6];
      const w = widths[i];
      let d = byWidth.get(w) ?? "";
      if (w !== runW) d += `M${f(a[0])},${f(a[1])}`;
      d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(b[0])},${f(b[1])}`;
      byWidth.set(w, d);
      runW = w;
    }
  }
  return byWidth;
}
