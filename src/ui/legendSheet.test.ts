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

// ★ On a phone the key stands UNDER the map, 336px wide, and a one-column key of eight rows used
// 104 of them: measured, a 146px-tall strip with two thirds of its width empty. Two columns halve
// the height and still fit (2 x 104 + a gap, well inside 336). Desktop keeps one column: there the
// key stands in the 210px column beside the map, which two columns would overflow.
describe("placeLegend in two columns", () => {
  // a real terrain-shaped key: a 20-unit heading band and n rows of 17 at y0 + i*17
  function keyWithRows(n: number) {
    const PITCH = 17, h = n * PITCH + 14 + 20, y = 700 - 14 - n * PITCH - 10 - 20;
    const { map, legend } = fakeMapWithBand(20, { x: 9, y, w: 112, h });
    for (let i = 0; i < n; i++) {
      const row = svgEl("g", { class: "legend-row", "data-pitch": PITCH });
      row.appendChild(svgEl("rect", { class: "legend-item", x: 14, y: y + 30 + i * PITCH - 9, width: 12, height: 12 }));
      legend.appendChild(row);
    }
    return { map, legend, h };
  }
  const box = (s: SVGSVGElement) => s.getAttribute("viewBox")!.split(" ").map(Number);

  it("puts the second half of the rows beside the first, and halves the height", () => {
    const one = keyWithRows(8), two = keyWithRows(8);
    const s1 = legendSheet(), s2 = legendSheet();
    placeLegend(one.map, s1, true);
    placeLegend(two.map, s2, true, 1, 2);
    const rows = [...two.legend.querySelectorAll(".legend-row")];
    rows.slice(0, 4).forEach((r, i) => expect(r.getAttribute("transform"), `row ${i} moved`).toBeNull());
    for (const r of rows.slice(4)) expect(r.getAttribute("transform")).toBe(`translate(${104 + 12} ${-4 * 17})`);
    expect(box(s2)[3], "the key is as tall as it was").toBe(box(s1)[3] - 4 * 17);
    expect(box(s2)[2]).toBe(104 * 2 + 12);
    expect(Number(s2.getAttribute("width"))).toBe(104 * 2 + 12);
  });

  it("gives an odd row to the first column", () => {
    const { map, legend } = keyWithRows(7);
    placeLegend(map, legendSheet(), true, 1, 2);
    const moved = [...legend.querySelectorAll(".legend-row")].map((r) => r.getAttribute("transform") !== null);
    expect(moved).toEqual([false, false, false, false, true, true, true]);
  });

  it("leaves a short key in one column — two rows side by side is not a key", () => {
    const { map, legend } = keyWithRows(3);
    const sheet = legendSheet();
    placeLegend(map, sheet, true, 1, 2);
    expect([...legend.querySelectorAll(".legend-row")].some((r) => r.hasAttribute("transform"))).toBe(false);
  });

  // the same key goes back to one column when the window widens — nothing left over from two
  it("takes the columns back out when asked for one", () => {
    const { map, legend } = keyWithRows(8);
    const sheet = legendSheet();
    placeLegend(map, sheet, true, 1, 2);
    const back = legend;
    // the key now lives in the sheet; a re-fit for one column has to reach it there
    map.appendChild(back);
    placeLegend(map, sheet, true, 1, 1);
    expect([...legend.querySelectorAll(".legend-row")].some((r) => r.hasAttribute("transform"))).toBe(false);
    expect(box(sheet)[2]).toBe(104);
  });
});

// ★ The sheet clips (`overflow: hidden` on an inline svg), and it was cut to the CARTOUCHE's width,
// which the layer chose before it knew the names. Measured on a 390x844 phone, seed "Narnia": five
// of eight realm names ran past it by 6-20 units — "브라르그루그 제국" lost its last syllable in the
// key, in one column as much as in two. A column is as wide as its widest word.
describe("placeLegend sizes a column to its words", () => {
  function keyWithWords(widths: number[]) {
    const PITCH = 17, n = widths.length, h = n * PITCH + 14 + 20, y = 700 - 14 - n * PITCH - 10 - 20;
    const { map, legend } = fakeMapWithBand(20, { x: 9, y, w: 112, h });
    widths.forEach((w, i) => {
      const row = svgEl("g", { class: "legend-row", "data-pitch": PITCH });
      const t = svgEl("text", { x: 35, y: y + 30 + i * PITCH });
      // jsdom has no layout; the width a browser would measure is what is being tested
      (t as unknown as { getBBox: () => object }).getBBox = () => ({ x: 35, y: 0, width: w, height: 14 });
      row.appendChild(t);
      legend.appendChild(row);
    });
    return { map, legend };
  }
  const box = (s: SVGSVGElement) => s.getAttribute("viewBox")!.split(" ").map(Number);

  it("widens the key to the longest word, where the cartouche was too narrow", () => {
    const { map } = keyWithWords([60, 102, 70]);            // 35 + 102 ends at 137; the key ran to 117
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(box(sheet)[0] + box(sheet)[2], "the longest word is cut off").toBeGreaterThanOrEqual(137);
  });

  it("keeps the cartouche's width when every word fits it", () => {
    const { map } = keyWithWords([40, 50, 60]);
    const sheet = legendSheet();
    placeLegend(map, sheet, true);
    expect(box(sheet)[2]).toBe(104);
  });

  it("puts the second column past the first column's longest word", () => {
    const { map, legend } = keyWithWords([60, 102, 70, 50, 40, 30, 20, 10]);
    placeLegend(map, legendSheet(), true, 1, 2);
    const moved = legend.querySelectorAll(".legend-row")[4].getAttribute("transform")!;
    const dx = Number(/translate\(([-\d.]+)/.exec(moved)![1]);
    expect(13 + dx, "the second column starts inside the first column's words").toBeGreaterThanOrEqual(137);
  });

  it("stays in one column where two would not fit the room it is standing in", () => {
    const { map, legend } = keyWithWords([60, 102, 70, 50, 40, 30, 20, 10]);
    const sheet = legendSheet();
    const room = document.createElement("div");
    Object.defineProperty(room, "clientWidth", { value: 200 });
    room.appendChild(sheet);
    placeLegend(map, sheet, true, 1, 2);
    expect([...legend.querySelectorAll(".legend-row")].some((r) => r.hasAttribute("transform"))).toBe(false);
  });
});
