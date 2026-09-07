// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cultureLayer } from "./cultureLayer";

// 4 cells in a row: cells 0-1 = culture 0, cell 2 = culture 1, cell 3 = ocean (-1)
const grid = {
  count: 4,
  width: 100,
  height: 60,
  points: [0, 0, 10, 0, 20, 0, 30, 0],
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[10, 0], [20, 0], [20, 10], [10, 10]],
    [[20, 0], [30, 0], [30, 10], [20, 10]],
    [[30, 0], [40, 0], [40, 10], [30, 10]],
  ] as number[][][],
  neighbors: [[1], [0, 2], [1, 3], [2]],
};
const cultures = [
  { name: "Druthvraugg", color: "#9a5a3a" },
  { name: "Liolyial", color: "#4a7a8a" },
];

describe("cultureLayer", () => {
  it("draws one fill per culture, a label per culture and a legend", () => {
    const g = cultureLayer(grid, [0, 0, 1, -1], cultures);
    expect(g.getAttribute("class")).toBe("culture");
    expect(g.querySelectorAll("path.culture-area").length).toBe(2);
    expect(g.querySelectorAll(".culture-legend .legend-item").length).toBe(2);
  });

  // Two cultures whose colours are close (measured: the palette's worst pair separates by only
  // dE 14.8 once composited over a biome, less than a single culture varies across biomes) meet
  // with nothing between them. The political and province views both draw the line; this one did
  // not, so the reader had colour alone to go on. Dashed, because an ethnographic boundary is not
  // a political one.
  it("draws a dashed boundary where two cultures meet", () => {
    const g = cultureLayer(grid, [0, 0, 1, -1], cultures);
    const border = g.querySelector("path.culture-border");
    expect(border).not.toBeNull();
    expect((border!.getAttribute("d") || "").length).toBeGreaterThan(0);
    expect(border!.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(border!.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("draws no boundary where a culture meets the sea or stands alone", () => {
    const g = cultureLayer(grid, [0, 0, 0, -1], [cultures[0]]);
    expect(g.querySelector("path.culture-border")?.getAttribute("d") || "").toBe("");
  });
});
