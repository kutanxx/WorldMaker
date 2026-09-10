// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cultureLayer } from "./cultureLayer";
import { peopleLabelKo } from "../engine/nameSuffix";

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

// The palette is not a matter of taste alone: it has a job, and it can be measured doing it. Two
// cultures are told apart by colour only if their fills, composited over whatever biome they happen
// to cover, differ by more than one culture's own fill varies across the biomes IT covers. The
// original five inverted that -- 14.8 between, 19.2 within -- so the reader was reading the biome
// underneath, not the culture. These two guard the property, not the hex values: change the colours
// or either opacity however you like, as long as the map still separates.
import { CULTURE_PROFILES } from "../engine/culture";
import { BIOME_COLORS } from "../engine/biome";
import { CULTURE_FILL_OPACITY } from "./cultureLayer";
import { OVERLAY_BIOME_OPACITY } from "./svgWorldRenderer";
import { PARCHMENT } from "./renderer";

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (a: number[], b: number[], alpha: number) => a.map((v, i) => v * alpha + b[i] * (1 - alpha));
function lab(c: number[]) {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = c.map(f);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * g(Y) - 16, 500 * (g(X) - g(Y)), 200 * (g(Y) - g(Z))];
}
const dE = (a: number[], b: number[]) => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
// what the reader actually sees: the culture fill over the muted biome over the parchment
const seen = (culture: string, biome: string) =>
  over(rgb(culture), over(rgb(biome), rgb(PARCHMENT), OVERLAY_BIOME_OPACITY), CULTURE_FILL_OPACITY);

const CULTURE_HUES = CULTURE_PROFILES.map((p) => p.color);
const BIOMES = Object.values(BIOME_COLORS) as string[];
const between = () => Math.min(...CULTURE_HUES.flatMap((a, i) =>
  CULTURE_HUES.slice(i + 1).flatMap((b) => BIOMES.map((bm) => dE(seen(a, bm), seen(b, bm))))));
const within = () => Math.max(...CULTURE_HUES.flatMap((c) =>
  BIOMES.flatMap((b1) => BIOMES.map((b2) => dE(seen(c, b1), seen(c, b2))))));

describe("the culture palette, as the reader sees it", () => {
  it("separates two cultures by more than the map's own colour bar", () => {
    // the same bar the biome palette was held to when it was tuned
    expect(between()).toBeGreaterThanOrEqual(20);
  });

  it("separates two cultures by MORE than one culture varies across the biomes it covers", () => {
    expect(between()).toBeGreaterThan(within());
  });
});

describe("the culture legend", () => {
  it("says what it is a key to", () => {
    const g = cultureLayer(grid, [0, 0, 1, -1], cultures, "en");
    expect(g.querySelector(".culture-legend .legend-title")?.textContent).toBe("Cultures");
  });
});

// The same complaint `realmLabelKo` answered for a realm's name applies here: a culture drawn across
// its territory with nothing but a transliterated name reads as a PLACE, not the people who live
// there. peopleLabelKo is the fix (드루스브라우 the place -> 드루스브라우인 the people); this proves it
// actually reaches the two places a reader sees a culture's name — the map label and the legend row —
// not just that the function exists and is unit-tested in isolation.
describe("a culture reads as a people in Korean, not a place", () => {
  it("marks the legend row with 인, fused with no space", () => {
    const g = cultureLayer(grid, [0, 0, 1, -1], cultures, "ko");
    const rows = [...g.querySelectorAll(".culture-legend text:not(.legend-title)")].map((e) => e.textContent);
    expect(rows).toEqual(cultures.map((c) => peopleLabelKo(c.name)));
  });

  it("marks the map label the same way", () => {
    // MIN_LABEL_CELLS (20) gates whether a culture gets a map label at all, and the 4-cell fixture
    // above is far under it by design (it exists to test borders/fills cheaply) — so this needs its
    // own bigger, single-culture strip grid purely to earn a label.
    const n = 25;
    const points: number[] = [], polygons: number[][][] = [], neighbors: number[][] = [];
    for (let i = 0; i < n; i++) {
      points.push(i * 10, 0);
      polygons.push([[i * 10, 0], [i * 10 + 10, 0], [i * 10 + 10, 10], [i * 10, 10]]);
      neighbors.push([i - 1, i + 1].filter((j) => j >= 0 && j < n));
    }
    const bigGrid = { count: n, width: n * 10, height: 10, points, polygons, neighbors };
    const g = cultureLayer(bigGrid, new Array(n).fill(0), [cultures[0]], "ko");
    const label = g.querySelector(".culture-label");
    expect(label?.textContent).toBe(peopleLabelKo(cultures[0].name));
  });
});
