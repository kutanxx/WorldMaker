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
// ...and the band the cartouche's own heading takes, as `legendPanel` writes it.
function fakeMapWithBand(band: number, panel = { x: 9, y: 520, w: 112, h: 171 }) {
  const { map, legend } = fakeMap(panel);
  legend.querySelector(".legend-panel")!.setAttribute("data-band", String(band));
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
  //
  // ⚠ It is cropped to the KEY, not to the cartouche: off the map the frame and the heading are
  // hidden (the page has drawn a panel and the fold's head has said what this is), so the sheet
  // must not keep their room either. INSET is the double rule's own margin.
  it("gives the key its own frame at one unit to one pixel, cropped to the key", () => {
    const { map } = fakeMap({ x: 9, y: 520, w: 112, h: 171 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(sheet.getAttribute("viewBox")).toBe("13 520 104 167");
    expect(sheet.getAttribute("width")).toBe("104");
    expect(sheet.getAttribute("height")).toBe("167");
  });

  it("crops the cartouche's heading away, by the band the panel itself declares", () => {
    const { map } = fakeMapWithBand(20, { x: 9, y: 520, w: 112, h: 171 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    // top by the band alone — the band already carries the heading's air — sides and bottom by INSET
    expect(sheet.getAttribute("viewBox")).toBe("13 540 104 147");
    expect(sheet.getAttribute("height")).toBe("147");
  });

  it("follows the key's own size, whichever view drew it", () => {
    const { map } = fakeMap({ x: 9, y: 470, w: 124, h: 221 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(sheet.getAttribute("viewBox")).toBe("13 470 116 217");
    expect(sheet.getAttribute("width")).toBe("116");
  });
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
    expect(sheet.getAttribute("viewBox")).toBe("13 400 116 287");   // cropped to the key, as above
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

// ㉗'s rule is one key size across the whole site, and the two keys are drawn in different units to
// get there: the world map's row is 17 because it is drawn at about x1, the plate's is 11 because
// the plate is drawn at x1.554. Standing a key in a sheet at 1:1 therefore gives the right size for
// one of them and a 64%-sized key for the other — so the sheet takes the scale its key was drawn
// for. The viewBox does NOT change: it is the key's own coordinates either way.
describe("placeLegend at the size the key was drawn for", () => {
  it("renders the key larger than 1:1 when its units are smaller", () => {
    const { map } = fakeMap({ x: 9, y: 12, w: 92, h: 158 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true, 17 / 11);
    expect(sheet.getAttribute("viewBox")).toBe("13 12 84 154");   // the key, cropped out of the cartouche
    expect(Number(sheet.getAttribute("width"))).toBeCloseTo(84 * 17 / 11, 3);
    expect(Number(sheet.getAttribute("height"))).toBeCloseTo(154 * 17 / 11, 3);
  });

  it("is 1:1 when nothing says otherwise", () => {
    const { map } = fakeMap({ x: 9, y: 520, w: 112, h: 171 });
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(sheet.getAttribute("width")).toBe("104");   // 112 less the rule's own margin, both sides
  });
});
