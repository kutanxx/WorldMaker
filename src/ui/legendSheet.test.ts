// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { svgEl } from "./renderer";
import { legendSheet, placeLegend } from "./legendSheet";

// A key as the layers draw it: a `.legend` group whose first child is the cartouche `legendPanel`
// puts around it. The panel's own rect is the key's size — asking the DOM (getBBox) would be both
// unavailable here and a guess about fonts, while the rect is the number the layer already chose.
function fakeMap(panel = { x: 9, y: 520, w: 112, h: 171 }): { map: SVGSVGElement; legend: SVGElement } {
  const map = svgEl("svg", { class: "world", viewBox: "0 0 1000 700" }) as SVGSVGElement;
  map.appendChild(svgEl("g", { class: "biomes" }));
  const legend = svgEl("g", { class: "legend biome-legend" });
  const cartouche = svgEl("g", { class: "legend-panel" });
  cartouche.appendChild(svgEl("rect", { x: panel.x, y: panel.y, width: panel.w, height: panel.h }));
  legend.appendChild(cartouche);
  map.appendChild(legend);
  map.appendChild(svgEl("g", { class: "scale-bar" }));
  return { map, legend };
}

describe("placeLegend", () => {
  it("takes the key off the map when the map is too small to hold one", () => {
    const { map, legend } = fakeMap();
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(map.querySelector(".legend")).toBeNull();
    expect(sheet.firstElementChild).toBe(legend);
  });

  // The whole point. On the map the key is drawn in map units and comes out at whatever the map
  // is scaled to — 6px on a phone. In its own sheet one unit is one pixel, so it arrives at the
  // size it was drawn, in every view, with no second copy of the drawing code.
  it("gives the key its own frame at one unit to one pixel", () => {
    const { map } = fakeMap({ x: 9, y: 520, w: 112, h: 171 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(sheet.getAttribute("viewBox")).toBe("9 520 112 171");
    expect(sheet.getAttribute("width")).toBe("112");
    expect(sheet.getAttribute("height")).toBe("171");
  });

  it("follows the key's own size, whichever view drew it", () => {
    const { map } = fakeMap({ x: 9, y: 470, w: 124, h: 221 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(sheet.getAttribute("viewBox")).toBe("9 470 124 221");
    expect(sheet.getAttribute("width")).toBe("124");
  });

  // ⚠ The reason this function is called again after every year: `fillSlot` replaces the political
  // slot on every scrub, and in the political, culture and province views the key lives INSIDE that
  // slot. Each scrub therefore hands us a brand new key while the sheet still holds the old one.
  it("swaps in the key a redraw made, instead of stacking two", () => {
    const { map } = fakeMap();
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    const redrawn = svgEl("g", { class: "legend nation-legend" });
    const cartouche = svgEl("g", { class: "legend-panel" });
    cartouche.appendChild(svgEl("rect", { x: 9, y: 400, width: 124, height: 291 }));
    redrawn.appendChild(cartouche);
    map.appendChild(redrawn);
    placeLegend(map, sheet, true);
    expect(sheet.children.length).toBe(1);
    expect(sheet.firstElementChild).toBe(redrawn);
    expect(sheet.getAttribute("viewBox")).toBe("9 400 124 291");
  });

  // Terrain draws its key once, on the map root, and no scrub redraws it. A second call must not
  // read "no key on the map" as "empty the sheet".
  it("leaves a key alone when nothing redrew it", () => {
    const { map, legend } = fakeMap();
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    placeLegend(map, sheet, true);
    expect(sheet.firstElementChild).toBe(legend);
  });

  it("does nothing to a map that is keeping its own key", () => {
    const { map, legend } = fakeMap();
    const sheet = legendSheet();
    placeLegend(map, sheet, false);
    expect(map.querySelector(".legend")).toBe(legend);
    expect(sheet.children.length).toBe(0);
  });

  // Crossing back over the breakpoint — a rotated phone, a widened window.
  it("puts the key back exactly where it came from, so nothing is redrawn to get it there", () => {
    const { map, legend } = fakeMap();
    const before = [...map.children].map((c) => c.getAttribute("class"));
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    placeLegend(map, sheet, false);
    expect([...map.children].map((c) => c.getAttribute("class"))).toEqual(before);
    expect(map.querySelector(".legend")).toBe(legend);
    expect(sheet.children.length).toBe(0);
  });

  it("drops the key it is holding if the map drew itself a new one while it was away", () => {
    const { map } = fakeMap();
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    const redrawn = svgEl("g", { class: "legend nation-legend" });
    const cartouche = svgEl("g", { class: "legend-panel" });
    cartouche.appendChild(svgEl("rect", { x: 9, y: 400, width: 124, height: 291 }));
    redrawn.appendChild(cartouche);
    map.appendChild(redrawn);
    placeLegend(map, sheet, false);
    expect(map.querySelectorAll(".legend").length).toBe(1);
    expect(sheet.children.length).toBe(0);
  });

  it("says nothing about a map that has no key at all", () => {
    const map = svgEl("svg", { class: "world" }) as SVGSVGElement;
    const sheet = legendSheet();
    expect(() => placeLegend(map, sheet, true)).not.toThrow();
    expect(sheet.children.length).toBe(0);
  });
});
