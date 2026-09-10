// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { provinceLayer, provinceOwners, snapOwnersToProvinces } from "./provinceLayer";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import type { Province } from "../engine/provinces";

// 4 cells in a row (squares), cells 0-1 = province 0, cell 2 = province 1, cell 3 = ocean (-1)
const grid = {
  count: 4,
  height: 100,
  points: [0, 0, 10, 0, 20, 0, 30, 0],
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[10, 0], [20, 0], [20, 10], [10, 10]],
    [[20, 0], [30, 0], [30, 10], [20, 10]],
    [[30, 0], [40, 0], [40, 10], [30, 10]],
  ] as number[][][],
  neighbors: [[1], [0, 2], [1, 3], [2]],
};
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  // A province carries the parts of its name beside the finished English string, exactly as a
  // region does, so the province view can be drawn in Korean (korean-names task 3).
  { id: 0, name: "the Grey Fields", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4,
    label: { pattern: "adj", kind: 4, adj: "Grey", noun: "Fields" } },
  { id: 1, name: "Iron Wastes", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5,
    label: { pattern: "attributive", kind: 5, noun: "Wastes", proper: "Iron" } },
];

describe("provinceLayer", () => {
  it("draws a border path, a tinted+titled fill per province, and a label per province", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    expect(g.getAttribute("class")).toBe("province");
    // one border path with a non-empty d
    const border = g.querySelector("path.province-border")!;
    expect(border).not.toBeNull();
    expect((border.getAttribute("d") || "").length).toBeGreaterThan(0);
    // one fill per non-ocean province, each carrying its name as a <title>
    const fills = g.querySelectorAll("path.province-fill");
    expect(fills.length).toBe(2);
    const titles = [...fills].map((f) => f.querySelector("title")?.textContent);
    expect(new Set(titles)).toEqual(new Set(["the Grey Fields", "Iron Wastes"]));
    expect(fills[0].getAttribute("data-province")).not.toBeNull();
    // a label per province, largest-first (province 0 has more cells → comes first)
    const labels = [...g.querySelectorAll("text.province-label")].map((t) => t.textContent);
    expect(labels).toEqual(["the Grey Fields", "Iron Wastes"]);
  });

  it("gives each province a distinct (id-based) colour, not the biome colour", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    const fills = [...g.querySelectorAll("path.province-fill")];
    const colors = fills.map((f) => f.getAttribute("fill"));
    expect(colors[0]).not.toBe(colors[1]);      // neighbouring provinces read as different regions
    for (const c of colors) expect(c).toMatch(/^hsl\(/); // per-province hue, not the old faint biome hex
  });

  it("draws bold nation borders when an owner array is given, and none without", () => {
    const owner = [0, 1, 1, -1]; // a nation border runs between cell 0 (nation 0) and cell 1 (nation 1)
    const withOwner = provinceLayer(grid, provinceOf, provinces, { owner });
    const nb = withOwner.querySelector("path.nation-border");
    expect(nb).not.toBeNull();
    expect((nb!.getAttribute("d") || "").length).toBeGreaterThan(0);
    expect(provinceLayer(grid, provinceOf, provinces).querySelector("path.nation-border")).toBeNull();
  });

  it("snaps each province to its majority-owner nation (ties → lower id, unclaimed → -1)", () => {
    // province 0 = cells 0,1 (owners 0 and 1 → tie → lower id 0); province 1 = cell 2 (owner 1)
    expect(provinceOwners(provinceOf, provinces, [0, 1, 1, -1])).toEqual([0, 1]);
    // an all-unclaimed province resolves to -1 (no nation)
    expect(provinceOwners(provinceOf, provinces, [-1, -1, 3, -1])).toEqual([-1, 3]);
  });

  it("snapOwnersToProvinces maps every cell to its province's majority owner (ocean stays -1)", () => {
    // province 0 = cells 0,1 (owners 0,1 → tie → lower id 0); province 1 = cell 2 (owner 1); cell 3 = ocean
    const snapped = snapOwnersToProvinces(4, provinceOf, provinces, [0, 1, 1, -1]);
    expect([...snapped]).toEqual([0, 0, 1, -1]);
  });

  it("places a settlement seat dot at each province", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    expect(g.querySelectorAll("circle.province-seat").length).toBe(2); // one per province
  });

  it("skips ocean cells (province -1 contributes no fill)", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    // total fill paths equal province count (2), never 3 — the ocean cell is not its own fill
    expect(g.querySelectorAll("path.province-fill").length).toBe(2);
  });
});

// Zoom on this map rewrites the viewBox, so a stroke without `non-scaling-stroke` is drawn at its
// width TIMES the zoom. Every other line here carries it -- coastline, national border, culture
// seam, rivers -- and this layer carried it nowhere: measured at 7.53x, the province mesh went from
// 1.1 to 8.3 screen pixels and the country outline from 2 to 15, a black smear beside a coastline
// still holding 2.4. The seats are deliberately not in this: they are marks, scaled about their own
// centre by applyMarkerScale, and are meant to grow a little with the zoom the way every other
// settlement mark does.
describe("the province view's lines hold their width", () => {
  it("draws both borders at a width rather than at a width times the zoom", () => {
    const g = provinceLayer(grid, provinceOf, provinces, { owner: [0, 0, 1, -1] });
    for (const sel of [".province-border", ".nation-border"]) {
      const path = g.querySelector(sel);
      expect(path, sel).not.toBeNull();
      expect(path!.getAttribute("vector-effect"), sel).toBe("non-scaling-stroke");
    }
  });
});

// The hues were spaced by the golden angle over the province ID -- which separates CONSECUTIVE ids
// and says nothing about who touches whom. Province ids come from farthest-point seeding, so
// neighbours draw arbitrary ids: measured over 968 touching pairs in five worlds, the median gap was
// a healthy 94 degrees but about twelve pairs a world sat within 15, and 2.5% within 5 -- the same
// colour, either side of a hairline. The fill is supposed to be what separates them.
describe("no two provinces that touch wear the same colour", () => {
  const hueOf = (fill: string) => Number(/hsl\(\s*([\d.]+)/.exec(fill)![1]);
  const gap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  it("keeps every shared border between two visibly different fills", () => {
    for (const seed of [1, 42, 834932]) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const g = provinceLayer(w.grid, w.provinceOf, w.provinces);
      const fill = new Map<number, number>();
      for (const el of g.querySelectorAll(".province-fill")) {
        fill.set(Number(el.getAttribute("data-province")), hueOf(el.getAttribute("fill")!));
      }
      let worst = 360, who = "";
      for (let i = 0; i < w.grid.count; i++) {
        const a = w.provinceOf[i];
        if (a < 0) continue;
        for (const nb of w.grid.neighbors[i]) {
          const b = w.provinceOf[nb];
          if (b < 0 || b === a) continue;
          const d = gap(fill.get(a)!, fill.get(b)!);
          if (d < worst) { worst = d; who = `seed ${seed}: ${a}/${b}`; }
        }
      }
      expect(worst, who).toBeGreaterThanOrEqual(30);
    }
  });

  // Adjacency alone leaves the answer degenerate: a province whose neighbours are all still
  // unassigned scores every hue the same, so with a fixed starting point every one of them took the
  // first hue and the map came out dominated by a single pink. Ties break to the province's own
  // golden-angle position instead, which spends the whole wheel.
  it("spends the whole wheel rather than crowding one hue", () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const g = provinceLayer(w.grid, w.provinceOf, w.provinces);
    const used = new Map<number, number>();
    for (const el of g.querySelectorAll(".province-fill")) {
      const h = hueOf(el.getAttribute("fill")!);
      used.set(h, (used.get(h) ?? 0) + 1);
    }
    const total = w.provinces.length;
    expect(used.size).toBeGreaterThanOrEqual(10);
    expect(Math.max(...used.values()) / total).toBeLessThan(0.2); // measured: 11%
  });
});
