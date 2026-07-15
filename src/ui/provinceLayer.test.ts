// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { provinceLayer } from "./provinceLayer";
import type { Province } from "../engine/provinces";

// 4 cells in a row (squares), cells 0-1 = province 0, cell 2 = province 1, cell 3 = ocean (-1)
const grid = {
  count: 4,
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
  { id: 0, name: "the Grey Fields", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4 },
  { id: 1, name: "Iron Wastes", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5 },
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

  it("skips ocean cells (province -1 contributes no fill)", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    // total fill paths equal province count (2), never 3 — the ocean cell is not its own fill
    expect(g.querySelectorAll("path.province-fill").length).toBe(2);
  });
});
