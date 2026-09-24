// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { scaleBar, floorScaleCaption, KM_PER_UNIT, METRES_PER_UNIT, KM_PER_WALKING_DAY } from "./scaleBar";

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
    const fs = num(text, "font-size");
    const baseline = num(text, "y");
    expect(baseline - 0.8 * fs, "the caption rides up onto the bar").toBeGreaterThan(442);
    expect(num(back, "y") + num(back, "height"), "the caption hangs off its tablet").toBeGreaterThan(baseline + 0.2 * fs);
  });

  it("leaves a caption that is already big enough exactly as it was", () => {
    const before = scaleBar(20, 442, 90, "270 m").outerHTML;
    expect(drawn(460, 720).outerHTML).toBe(before);   // a desktop plate: 1.57 px to the unit
  });
});
