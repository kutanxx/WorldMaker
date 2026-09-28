// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";
import { displayBiomes } from "./displayBiome";
import { ALPINE, TEMPERATE_FOREST, TAIGA, TROPICAL, DESERT } from "../engine/biome";
import { OCEAN } from "../engine/terrain";
import { pointInPolygon, type Point } from "../engine/geometry";
import { putOnPage, type Page } from "./regionPage";

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
const g = world.grid;
const shown = displayBiomes(g, world.biome);
// World 1 three times over, on the region its preview was drawn from: a range, a forest, a coast, seven towns.
const page: Page = { x: 230, y: 250, w: 1000 / 3, h: 700 / 3, z: 3 };
const inside = (x: number, y: number, m = 0) => x >= page.x - m && x <= page.x + page.w + m && y >= page.y - m && y <= page.y + page.h + m;
const landOnPage = (is: (i: number) => boolean) => {
  const out: number[] = [];
  for (let i = 0; i < g.count; i++) if (world.terrain[i] !== OCEAN && is(i) && inside(g.points[2 * i], g.points[2 * i + 1])) out.push(i);
  return out;
};

// A region written to its own page holds z times less of the world across the same width. Drawn as the
// whole map draws it, a glyph that stands for a cell comes out z times the size and z^2 times as sparse —
// a range of three big triangles. The page draws them at the whole map's page size, as thick on the page
// as the whole map has them: z^2 as many to a cell, 1/z the size. (The reader chose this over the enlarged
// screen, from the preview `region-preview.html`.)
describe("a region's page draws its ground at the page's size", () => {
  it("draws z^2 as many peak glyphs over a range, each a third the size", () => {
    const svg = renderWorld(world, "terrain", [], "ko", new Set(), undefined, undefined, "colour", page);
    const glyphs = (svg.querySelector(".relief")!.getAttribute("d") ?? "").split("M").slice(1)
      .map((s) => s.split(/[L,]/).map(Number));                      // x1,y1 x2,y2 x3,y3 — foot, peak, foot
    const onIt = glyphs.filter(([, , x2, y2]) => inside(x2, y2));
    const ranges = landOnPage((i) => shown[i] === ALPINE && g.neighbors[i].some((n) => shown[n] === ALPINE));
    expect(ranges.length, "no range on the region").toBeGreaterThan(20);
    expect(onIt.length / ranges.length, "one to a cell, as the whole map has them").toBeGreaterThan(8);
    for (const [x1, , , , x3] of onIt.slice(0, 20)) expect(x3 - x1, "6 across on the whole map").toBeCloseTo(2, 1);
  });

  it("draws the ink map's trees, peaks and dunes z^2 as thick, a third the size, each inside its own cell", () => {
    const svg = renderWorld(world, "terrain", [], "ko", new Set(), undefined, undefined, "ink", page);
    const marks = [...svg.querySelectorAll<SVGElement>(".ink-marks [data-cell]")];
    const at = (m: Element): Point => [Number(m.getAttribute("data-x")), Number(m.getAttribute("data-y"))];
    const onIt = marks.filter((m) => inside(...at(m)));
    const count = (cls: string) => onIt.filter((m) => m.classList.contains(cls)).length;
    const forest = landOnPage((i) => shown[i] === TEMPERATE_FOREST || shown[i] === TAIGA).length;
    const rain = landOnPage((i) => shown[i] === TROPICAL).length;
    const range = landOnPage((i) => shown[i] === ALPINE).length;
    expect(forest, "no forest on the region").toBeGreaterThan(50);
    expect(count("ink-tree") / (2 * forest + 3 * rain), "two trees a forest cell on the whole map").toBeGreaterThan(8);
    expect(count("ink-peak") / range, "a peak a mountain cell on the whole map").toBeGreaterThan(8);
    const deserts = landOnPage((i) => shown[i] === DESERT).length;
    if (deserts) expect(count("ink-dune") / (3 * deserts)).toBeGreaterThan(7);
    const leaf = onIt.find((m) => m.classList.contains("ink-broadleaf"))!.querySelector("ellipse")!;
    expect(Number(leaf.getAttribute("rx")), "2.4 across on the whole map").toBeCloseTo(0.8, 2);
    for (const m of marks) {
      const cell = Number(m.getAttribute("data-cell"));
      expect(pointInPolygon(at(m), g.polygons[cell] as Point[]), `a mark outside cell ${cell}`).toBe(true);
    }
    expect(marks.every((m) => inside(...at(m), 30)), "marks drawn far off the page").toBe(true);
  });
});

// The whole map drawn, then set on the region's page: its view, its furniture carried to the page's corners
// at their page size, its scale bar measured again, its water lines at the whole map's spacing, and only the
// names of what is on it.
describe("putOnPage", () => {
  const onPageMap = (style: "colour" | "ink" = "colour") => {
    const svg = renderWorld(world, "terrain", [], "ko", new Set(), undefined, undefined, style, page);
    putOnPage(svg, page, world, "ko");
    return svg;
  };

  it("shows the region, and tells the cull where its frame is", () => {
    const svg = onPageMap();
    expect(svg.getAttribute("viewBox")).toBe("230 250 333.33 233.33");
    expect(svg.dataset.baseViewbox).toBe("230 250 333.33 233.33");
  });

  it("carries the key, the title, the compass and the frame to the page's corners at their page size", () => {
    for (const style of ["colour", "ink"] as const) {
      const svg = onPageMap(style);
      const group = svg.querySelector(":scope > .page-furniture")!;
      expect(group, style).not.toBeNull();
      expect(group.getAttribute("transform")).toBe("translate(230 250) scale(0.33333)");
      expect([group.getAttribute("data-x"), group.getAttribute("data-y")]).toEqual(["230", "250"]);
      expect(Number(group.getAttribute("data-k"))).toBeCloseTo(1 / 3, 9);
      for (const cls of ["legend", "world-name", "compass", "map-frame", "scale-bar"]) {
        expect(group.querySelectorAll(`.${cls}`).length, `${style}: ${cls} on the page`).toBe(1);
        expect(svg.querySelectorAll(`.${cls}`).length, `${style}: a ${cls} left on the map`).toBe(1);
      }
    }
  });

  it("measures the scale bar again for the region, in the whole map's type", () => {
    const bar = onPageMap().querySelector(".page-furniture .scale-bar")!;
    expect(bar.querySelector(".scale-bar-text")!.textContent).toBe("100 km");
    expect(bar.querySelector(".scale-bar-sub")!.textContent).toBe("도보 3일");
    const chain = [...bar.querySelectorAll("rect")].slice(1);
    const xs = chain.flatMap((r) => [Number(r.getAttribute("x")), Number(r.getAttribute("x")) + Number(r.getAttribute("width"))]);
    // in the whole map's page units: 100 km is 33.3 map units, three times over on this page, centred
    expect(Math.min(...xs)).toBeCloseTo(450, 6);
    expect(Math.max(...xs)).toBeCloseTo(550, 6);
    expect(Number(bar.querySelector(".scale-bar-text")!.getAttribute("font-size"))).toBeCloseTo(9, 6);
  });

  it("draws the water lines at the whole map's spacing", () => {
    const widths = [...onPageMap().querySelectorAll(".waterlines path")].map((p) => Number(p.getAttribute("stroke-width")));
    expect(widths).toEqual([3, 2, 1]);                  // 9, 6 and 3 on the whole map
  });

  it("names the towns on the page and leaves off the rest", () => {
    const svg = onPageMap();
    const named = [...svg.querySelectorAll(".city-label")].map((t) => Number(t.getAttribute("data-city"))).sort((a, b) => a - b);
    expect(named).toEqual([5, 6, 8, 12, 13, 14, 16, 19, 27]);
  });

  // River Gruathgra (v2) crosses the page's east side, and its name stands at its middle, off the page: it
  // is named again where it crosses. The rivers that miss the page leave no name on it.
  it("names a river where it crosses the page, and leaves off the rivers that miss it", () => {
    const svg = onPageMap();
    const rivers = [...svg.querySelectorAll(".river-label")];
    expect(rivers.map((t) => t.getAttribute("data-name")).sort()).toEqual(["v1", "v2"]);
    const v2 = rivers.find((t) => t.getAttribute("data-name") === "v2")!;
    const x = Number(v2.getAttribute("x")), y = Number(v2.getAttribute("y"));
    expect(inside(x, y), `v2's name at ${x},${y}`).toBe(true);
    const water = world.rivers[2].path.map(([px, py]) => Math.hypot(px - x, py - y));
    const fs = Number(v2.getAttribute("font-size"));
    expect(Math.min(...water), "lifted half its size off its water").toBeCloseTo(fs / 2, 1);
    expect(v2.getAttribute("transform")).toMatch(new RegExp(`^rotate\\(-?[\\d.]+ ${v2.getAttribute("x")} ${v2.getAttribute("y")}\\)$`));
  });
});
