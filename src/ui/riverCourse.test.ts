// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "../engine/terrain";
import { sharedEdge, type Point } from "../engine/borders";
import { noisyEdge } from "./noisyEdge";
import { riverCourses, riverWidth } from "./riverCourse";
import { renderWorld } from "./svgWorldRenderer";

const worlds = [1, 2, 5].map((seed) => generateWorld({ ...DEFAULT_PARAMS, seed }).world);
const key = ([x, y]: Point) => `${x},${y}`;

const distToPolyline = (p: Point, line: Point[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
};

describe("riverCourses — the river net as runs of water from source to sea", () => {
  it("walks every segment of the net exactly once, each course a connected run", () => {
    for (const w of worlds) {
      const courses = riverCourses(w);
      const starts = new Set(w.riverNet.map((s) => `${s.x1},${s.y1}`));
      let segs = 0;
      for (const c of courses) {
        segs += c.points.length - 1;
        // every step but a mouth's last starts where a segment of the net starts
        for (let i = 0; i + 1 < c.points.length; i++) expect(starts.has(key(c.points[i]))).toBe(true);
      }
      expect(segs).toBe(w.riverNet.length);
    }
  });

  it("ends a tributary on the river it joins", () => {
    for (const w of worlds) {
      const courses = riverCourses(w);
      const onSomeCourse = new Set<string>();
      for (const c of courses) for (const p of c.points) onSomeCourse.add(key(p));
      for (const c of courses) {
        if (c.mouth) continue;
        const end = c.points[c.points.length - 1];
        const others = courses.filter((o) => o !== c).some((o) => o.points.slice(0, -1).some((p) => key(p) === key(end)));
        expect(others).toBe(true);
      }
    }
  });

  // A river that reached the sea used to run on to the middle of the sea's cell — a blue stub standing
  // out past every river mouth on the map.
  it("ends a river that reaches the sea ON the drawn coast, not out over the water", () => {
    for (const w of worlds) {
      const g = w.grid;
      const cellAt = new Map<string, number>();
      for (let i = 0; i < g.count; i++) cellAt.set(`${g.points[i * 2]},${g.points[i * 2 + 1]}`, i);
      const mouths = riverCourses(w).filter((c) => c.mouth);
      expect(mouths.length).toBeGreaterThan(0);
      for (const c of mouths) {
        const land = cellAt.get(key(c.points[c.points.length - 2]))!;
        expect(w.terrain[land]).not.toBe(OCEAN);
        const sea = g.neighbors[land].filter((j) => w.terrain[j] === OCEAN);
        const coast = sea.map((j) => sharedEdge(g.polygons[land], g.polygons[j])).filter((e) => e !== null)
          .map(([a, b]) => [a, ...noisyEdge(a, b), b] as Point[]);
        const end = c.points[c.points.length - 1];
        expect(Math.min(...coast.map((line) => distToPolyline(end, line)))).toBeLessThan(0.05);
      }
    }
  });

  it("widens downstream and never narrows", () => {
    for (const w of worlds) {
      for (const c of riverCourses(w)) {
        for (let i = 1; i < c.widths.length; i++) expect(c.widths[i]).toBeGreaterThanOrEqual(c.widths[i - 1]);
      }
    }
  });

  it("gives a stream a hairline and a great river the heaviest water line", () => {
    expect(riverWidth(0.01, 1)).toBeGreaterThanOrEqual(0.9);
    expect(riverWidth(1, 1)).toBeGreaterThan(riverWidth(0.3, 1));
    expect(riverWidth(1, 1)).toBeLessThan(2.4);   // the coast stays the heaviest line
  });
});

describe("renderWorld rivers as drawn water", () => {
  it("draws each river as a curve, not a chain of straight steps", () => {
    const svg = renderWorld(worlds[0]);
    const ds = [...svg.querySelectorAll(".rivers .river")].map((p) => p.getAttribute("d") ?? "");
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(d).toMatch(/C/);
      expect(d).not.toMatch(/L/);
    }
  });
});
