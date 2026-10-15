// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { scaleBar, scaleBarAbove, floorScaleCaption, KM_PER_UNIT, METRES_PER_UNIT, KM_PER_WALKING_DAY } from "./scaleBar";
import { FRAME_INSET } from "./renderer";
import { renderWorld } from "./svgWorldRenderer";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS, type CityMarker } from "../types/world";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";

// ★ The bar stands at the foot of the map, and since the frame took its paper mat (2026-10-12) everything
// under the frame's inner rule is covered: measured at 1440x900, 1366x650 and 1920x1080, "도보 12일" stood
// half under the frame's band, and on a 390px phone wholly below it (design review 2026-10-15, item 2).
// The bar's tablet now stands above the rule with a little air, holds every word it carries, and when the
// floor grows the words the bar grows UP: its foot stays where the drawing put it.
const num = (el: Element | null, a: string) => Number(el!.getAttribute(a));
// a bar's foot: its tablet's bottom, in map units
const foot = (g: Element) => num(g.querySelector("rect"), "y") + num(g.querySelector("rect"), "height");
// the lowest ink on a bar: a descender's room under its last word (less the hundredth the floor writes its
// numbers to — 0.006 units came out once, which is no overhang)
const lowest = (g: Element) => Math.max(...[...g.querySelectorAll("text")].map((t) => num(t, "y") + 0.3 * num(t, "font-size"))) - 0.02;

describe("the world map's scale bar stands clear of the frame", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const rule = 700 - FRAME_INSET;

  it("as drawn, with every word on its tablet", () => {
    const g = renderWorld(world, "terrain", [], "ko").querySelector(".scale-bar")!;
    expect(foot(g), "the tablet reaches under the frame's rule").toBeLessThanOrEqual(rule);
    expect(lowest(g), "a word hangs off the tablet").toBeLessThanOrEqual(foot(g));
    expect(g.querySelector(".scale-bar-sub")?.textContent).toBe("도보 12일");
  });

  // 1920x1080 draws the map 1128px wide, 1440x900 950, 1366x650 593, a 390px phone 336
  it("at every window, once its words are held at the names' floor", () => {
    for (const px of [1128, 950, 593, 336]) {
      const svg = renderWorld(world, "terrain", [], "ko");
      floorScaleCaption(svg, 8, px);
      const g = svg.querySelector(".scale-bar")!;
      expect(num(g.querySelector(".scale-bar-sub"), "font-size") * px / 1000, `${px}px: the days on foot`).toBeGreaterThanOrEqual(7.95);
      expect(foot(g), `${px}px: the tablet reaches under the frame's rule`).toBeLessThanOrEqual(rule);
      expect(lowest(g), `${px}px: a word hangs off the tablet`).toBeLessThanOrEqual(foot(g));
    }
  });

  it("grows up, keeping its foot where the drawing put it — and only once", () => {
    const svg = renderWorld(world, "terrain", [], "ko");
    const g = svg.querySelector(".scale-bar")!;
    const was = foot(g), chain = num(g.querySelectorAll("rect")[1], "y");
    floorScaleCaption(svg, 8, 336);
    expect(foot(g)).toBeCloseTo(was, 6);
    expect(num(g.querySelectorAll("rect")[1], "y"), "the chain did not move up with its words").toBeLessThan(chain);
    const once = g.outerHTML;
    floorScaleCaption(svg, 8, 336);   // the window did not change: the page floors again on every relayout
    expect(g.outerHTML, "a second pass moved the bar again").toBe(once);
    floorScaleCaption(svg, 8, 950);   // ...and a wider window asks for less, which takes nothing back
    expect(g.outerHTML).toBe(once);
  });

  it("puts a bar's foot a little above a line it is given", () => {
    const g = scaleBar(430, scaleBarAbove(692, 120, true), 120, "360 km", "도보 12일");
    expect(foot(g)).toBeLessThan(692);
    expect(foot(g)).toBeGreaterThan(692 - 4);
    const plain = scaleBar(20, scaleBarAbove(452, 90, false), 90, "270 m");
    expect(foot(plain)).toBeLessThan(452);
    expect(lowest(plain)).toBeLessThanOrEqual(foot(plain));
  });
});

// ...and a plate's bar, in the plate's bottom-left corner, which the same mat covers: its "270 m" is held at
// the same floor, and on a 336px phone that is two and a half times its size.
describe("a plate's scale bar stands clear of its frame", () => {
  const marker: CityMarker = {
    id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
    polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.4, biome: 4, river: false,
  };
  const layout = generateCityLayout(cityContext(marker), 7);

  it("as drawn, and held at a desktop's and a phone's floor", () => {
    for (const px of [0, 720, 336]) {
      const svg = renderCity(layout);
      const h = Number(svg.getAttribute("viewBox")!.split(/[\s,]+/)[3]);
      if (px) floorScaleCaption(svg, 8, px);
      const g = svg.querySelector(".scale-bar")!;
      expect(foot(g), `${px}px: the tablet reaches under the plate's rule`).toBeLessThanOrEqual(h - FRAME_INSET);
      expect(lowest(g), `${px}px: a word hangs off the tablet`).toBeLessThanOrEqual(foot(g));
    }
  });
});

// The maps are for running a game at a table, and neither of them said how far anything was.
describe("the maps say how far", () => {
  it("rules a bar of the length it claims", () => {
    const g = scaleBar(100, 600, 120, "360 km");
    const chain = [...g.querySelectorAll("rect")].slice(1);   // the first rect is the backing
    expect(chain.length).toBe(4);
    const left = Math.min(...chain.map((r) => Number(r.getAttribute("x"))));
    const right = Math.max(...chain.map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width"))));
    expect(right - left).toBeCloseTo(120, 6);
    expect(left).toBeCloseTo(100, 6);
    expect(g.querySelector("text")?.textContent).toBe("360 km");
  });

  // A region's page (regionPage.ts) measures its bar again — a third of the world across is 100 km on a
  // bar a third shorter — and sets its words in the whole map's type, not in type sized by the new length.
  it("sets a shorter bar's words in the type of the bar it stands for", () => {
    const g = scaleBar(450, 674, 100, "100 km", "도보 3일", 120);
    const chain = [...g.querySelectorAll("rect")].slice(1);
    const right = Math.max(...chain.map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width"))));
    expect(right - 450, "the bar is as long as its distance").toBeCloseTo(100, 6);
    expect(Number(g.querySelector(".scale-bar-text")!.getAttribute("font-size")), "the whole map's caption").toBeCloseTo(9, 6);
    expect(Number(g.querySelector(".scale-bar-sub")!.getAttribute("font-size"))).toBeCloseTo(7.8, 6);
    expect(Number(chain[0].getAttribute("height")), "the whole map's chain").toBeCloseTo(4.2, 6);
  });

  it("keeps a town the size a walled town was", () => {
    // the wall's radius is 60 + 12*size, so a size-3 market town is 192 units across
    expect(192 * METRES_PER_UNIT).toBeGreaterThan(400);
    expect(264 * METRES_PER_UNIT).toBeLessThan(1200);
  });

  it("leaves neighbouring towns a walk apart, not a voyage", () => {
    // measured: the closest pair of cities on a map is about 9 units, the usual spacing far more
    const closest = 9 * KM_PER_UNIT / KM_PER_WALKING_DAY;
    expect(closest).toBeLessThan(1.5);   // under two days
    expect(closest).toBeGreaterThan(0.5); // and not next door
  });
});

// ★ Drawn in map units, the plate's caption shrinks with the plate: "270 m" measured 4.6px on a
// 390px phone and 4.2px in a 1280x600 laptop window — a smudge under a bar that says nothing
// without it. It is held at a screen minimum like the district names, and its tablet grows with it.
describe("a scale bar's caption can be read", () => {
  const drawn = (units: number, drawnPx: number) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", `0 0 ${units} ${units}`);
    const g = scaleBar(20, 442, 90, "270 m");
    svg.appendChild(g);
    floorScaleCaption(svg, 8, drawnPx);
    return g;
  };
  const num = (el: Element | null, a: string) => Number(el!.getAttribute(a));

  it("raises a caption drawn too small to its screen minimum", () => {
    const g = drawn(460, 336);                         // a phone: 0.73 px to the unit
    const text = g.querySelector(".scale-bar-text");
    expect(num(text, "font-size") * (336 / 460)).toBeCloseTo(8, 2);
  });

  it("keeps the caption under the bar and on its tablet", () => {
    const g = drawn(460, 336);
    const text = g.querySelector(".scale-bar-text");
    const back = g.querySelector("rect");
    const chain = g.querySelectorAll("rect")[1];   // the chain's first link (the whole bar moves up as it grows)
    const fs = num(text, "font-size");
    const baseline = num(text, "y");
    expect(baseline - 0.8 * fs, "the caption rides up onto the bar").toBeGreaterThan(num(chain, "y") + num(chain, "height"));
    expect(num(back, "y") + num(back, "height"), "the caption hangs off its tablet").toBeGreaterThan(baseline + 0.2 * fs);
  });

  it("leaves a caption that is already big enough exactly as it was", () => {
    const before = scaleBar(20, 442, 90, "270 m").outerHTML;
    expect(drawn(460, 720).outerHTML).toBe(before);   // a desktop plate: 1.57 px to the unit
  });
});

// ★ The world map's bar carries a second line under its caption — how many days on foot — and the page
// held neither at a minimum: measured on the live site at 1440x900 (the map 871px across for 1000
// units), "360 km" came out 7.8px and "도보 12일" 6.8px, under the 8px every other name on the map is
// held at. The second line is held at the same minimum, under the first, on the same tablet.
describe("the world map's scale bar can be read, both its lines", () => {
  const world = (drawnPx: number) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const g = scaleBar(430, 674, 120, "360 km", "도보 12일");
    svg.appendChild(g);
    floorScaleCaption(svg, 8, drawnPx);
    return g;
  };
  const num = (el: Element | null, a: string) => Number(el!.getAttribute(a));

  it("raises the days on foot to the minimum too", () => {
    const g = world(871);
    const k = 871 / 1000;
    expect(num(g.querySelector(".scale-bar-text"), "font-size") * k).toBeCloseTo(8, 1);
    expect(num(g.querySelector(".scale-bar-sub"), "font-size") * k, "the days on foot stayed small").toBeCloseTo(8, 1);
  });

  it("keeps the second line under the first, and both on the tablet", () => {
    const g = world(871);
    const text = g.querySelector(".scale-bar-text"), sub = g.querySelector(".scale-bar-sub"), back = g.querySelector("rect");
    const subTop = num(sub, "y") - 0.8 * num(sub, "font-size");
    expect(subTop, "the second line rides up onto the first").toBeGreaterThanOrEqual(num(text, "y"));
    expect(num(back, "y") + num(back, "height"), "the second line hangs off its tablet").toBeGreaterThan(num(sub, "y") + 0.2 * num(sub, "font-size"));
  });

  it("leaves a bar already big enough exactly as it was", () => {
    const before = scaleBar(430, 674, 120, "360 km", "도보 12일").outerHTML;
    expect(world(1400).outerHTML).toBe(before);
  });
});
