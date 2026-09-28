// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { applyLabelScale, applyMarkerScale, floorLabelSize, applyPageScale } from "./labelScale";

const NS = "http://www.w3.org/2000/svg";

// A region of the map written to a file holds `z` times less of the world across the same page. Its
// names, marks and the gaps between them keep the size they have on the whole map's page — a chapter's
// map and the world's, printed the same size, are set in the same type — where the screen lets a name
// grow a little as the reader leans in.
describe("applyPageScale", () => {
  function page() {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const add = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      svg.appendChild(e);
      return e;
    };
    // a town's dot at (100,50), its name set 5 right and 3 down of it, as the renderer sets it
    const town = add("text", { class: "city-label city-town", x: "105", y: "53", "font-size": "8", "stroke-width": "1.6" });
    const capital = add("text", { class: "city-label city-capital", x: "25", y: "23", "font-size": "10", "stroke-width": "1.6" });
    const region = add("text", { class: "region-label region-land", x: "500", y: "300", "font-size": "16", "letter-spacing": "2.6", "stroke-width": "2" });
    // a river's name lifted 5 (half its size) off the water at (300,400), up the normal of a 30-degree run
    const river = add("text", { class: "river-label", x: "302.5", y: "395.7", "font-size": "10", "stroke-width": "1.8", transform: "rotate(30.0 302.5 395.7)" });
    const star = add("path", { class: "marker-capital", d: "M200,76L201,79Z", "data-cx": "200.0", "data-cy": "80.0" });
    const dot = add("circle", { class: "free-city-dot", cx: "400", cy: "300", r: "1.7" });
    const banner = add("path", { class: "free-city-banner", d: "M400.0,298.3L400.0,293.0L404.0,294.0L400.0,295.0" });
    const freeName = add("text", { class: "free-city-label", x: "400", y: "305.5", "font-size": "6.5" });
    return { svg, town, capital, region, river, star, dot, banner, freeName };
  }
  const num = (e: Element, a: string) => Number(e.getAttribute(a));

  it("gives a file of the whole map exactly what the whole map's file has always had", () => {
    const a = page(), b = page();
    applyPageScale(a.svg, 1);
    applyLabelScale(b.svg, 1); applyMarkerScale(b.svg, 1);
    expect(a.svg.outerHTML).toBe(b.svg.outerHTML);
  });

  it("sets a region's names, their halos and their tracking at the whole map's page size", () => {
    const { svg, town, capital, region } = page();
    applyPageScale(svg, 3);
    expect(num(town, "font-size")).toBeCloseTo(4, 2);          // 8, at the reading size 1.5, over 3
    expect(num(town, "stroke-width")).toBeCloseTo(0.8, 2);
    expect(num(capital, "font-size")).toBeCloseTo(4.33, 2);    // 10 x 1.3 / 3
    expect(num(region, "font-size")).toBeCloseTo(5.33, 2);
    expect(num(region, "letter-spacing"), "the tracking stayed at the whole map's width").toBeCloseTo(0.87, 2);
  });

  it("keeps a town's name its page distance from its dot", () => {
    const { svg, town } = page();
    applyPageScale(svg, 3);
    expect(num(town, "x")).toBeCloseTo(101.67, 2);
    expect(num(town, "y")).toBeCloseTo(51, 2);
  });

  it("keeps a river's name its page distance off the water, turned as it was", () => {
    const { svg, river } = page();
    applyPageScale(svg, 3);
    expect(num(river, "font-size")).toBeCloseTo(4.33, 2);
    expect(num(river, "x")).toBeCloseTo(300.83, 1);
    expect(num(river, "y")).toBeCloseTo(398.59, 1);
    const [deg, cx, cy] = (river.getAttribute("transform") ?? "").match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(deg).toBeCloseTo(30, 6);
    expect([cx, cy], "turned about where it no longer stands").toEqual([num(river, "x"), num(river, "y")]);
  });

  it("holds a mark, and a free city's banner and name, at their page size about their own point", () => {
    const { svg, star, dot, banner, freeName } = page();
    applyPageScale(svg, 3);
    expect(star.getAttribute("transform")).toBe("translate(200.0,80.0) scale(0.3333) translate(-200,-80)");
    expect(dot.getAttribute("transform")).toBe("translate(400,300) scale(0.3333) translate(-400,-300)");
    expect(banner.getAttribute("transform")).toBe("translate(400,300) scale(0.3333) translate(-400,-300)");
    expect(freeName.getAttribute("transform")).toBe("translate(400,300) scale(0.3333) translate(-400,-300)");
  });
});
function build() {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  const mk = (cls: string, fs: number, sw?: number) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls);
    t.setAttribute("font-size", String(fs));
    if (sw !== undefined) t.setAttribute("stroke-width", String(sw));
    svg.appendChild(t);
    return t;
  };
  return { svg, region: mk("region-label", 16, 2), town: mk("city-label city-town", 8, 1.6),
           river: mk("river-label", 10, 1.8), culture: mk("culture-label", 13, 2.6) };
}

describe("applyLabelScale", () => {
  const onScreen = (el: Element, scale: number) => Number(el.getAttribute("font-size")) * scale;

  it("shrinks the user-space size as the map grows, so a word never grows with the land", () => {
    const { svg, region } = build();
    const rest = Number(region.getAttribute("font-size"));
    applyLabelScale(svg, 2);
    const at2 = Number(region.getAttribute("font-size"));
    expect(at2).toBeLessThan(rest);                       // smaller in the map's own units
    expect(onScreen(region, 2)).toBeGreaterThan(rest);    // yet bigger on screen
    expect(onScreen(region, 2)).toBeLessThan(rest * 2);   // and nowhere near twice over
  });

  it("keeps the halo in proportion to the letters it sits behind", () => {
    const { svg, region } = build();
    const ratio = 2 / 16;                                 // stroke-width over font-size, at rest
    for (const scale of [1, 2, 4, 8]) {
      applyLabelScale(svg, scale);
      const fs = Number(region.getAttribute("font-size")), sw = Number(region.getAttribute("stroke-width"));
      expect(sw / fs, `scale ${scale}`).toBeCloseTo(ratio, 3);
    }
  });

  it("always works from the original size, never from the last result", () => {
    const { svg, region } = build();
    applyLabelScale(svg, 2);
    applyLabelScale(svg, 4);
    applyLabelScale(svg, 8);
    const viaSteps = region.getAttribute("font-size");
    const fresh = build();
    applyLabelScale(fresh.svg, 8);
    expect(viaSteps).toBe(fresh.region.getAttribute("font-size"));
    applyLabelScale(svg, 1);
    expect(region.getAttribute("font-size")).toBe("16.00");   // and all the way back
  });

  it("ignores a scale that is not a positive number", () => {
    const { svg, region } = build();
    applyLabelScale(svg, 0);
    applyLabelScale(svg, NaN);
    expect(region.getAttribute("font-size")).toBe("16");
  });

  it("writes attributes, not styles, so an export taken while zoomed matches the screen", () => {
    const { svg, river } = build();
    applyLabelScale(svg, 2);
    expect(Number(river.getAttribute("font-size"))).toBeGreaterThan(0);
    expect(river.style.fontSize).toBe("");
  });
});

describe("applyMarkerScale", () => {
  const mkSvg = () => document.createElementNS(NS, "svg") as SVGSVGElement;
  const mkCircle = (svg: SVGSVGElement, cx: number, cy: number) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "marker-town"); c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy));
    svg.appendChild(c); return c;
  };
  const mkStar = (svg: SVGSVGElement, cx: number, cy: number) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("class", "marker-capital");
    p.dataset.cx = String(cx); p.dataset.cy = String(cy);
    svg.appendChild(p); return p;
  };

  it("shrinks a mark in place rather than sliding it toward the origin", () => {
    const svg = mkSvg();
    const dot = mkCircle(svg, 300, 200);
    applyMarkerScale(svg, 4);
    expect(dot.getAttribute("transform")).toBe("translate(300,200) scale(0.4665) translate(-300,-200)"); // 4^0.45 / 4
  });

  it("finds the centre of a path mark, which has no cx of its own", () => {
    const svg = mkSvg();
    const star = mkStar(svg, 120, 90);
    applyMarkerScale(svg, 2);
    expect(star.getAttribute("transform")).toContain("translate(120,90)");
    expect(star.getAttribute("transform")).toContain("scale(0.6830)"); // 2^0.45 / 2
  });

  it("returns a mark to full size at zoom 1", () => {
    const svg = mkSvg();
    const dot = mkCircle(svg, 10, 10);
    applyMarkerScale(svg, 8);
    applyMarkerScale(svg, 1);
    expect(dot.getAttribute("transform")).toBe("translate(10,10) scale(1.0000) translate(-10,-10)");
  });
});

// A town's name was sized 8px so that a hundred of them could be crammed onto the resting map.
// They no longer appear there at all — they wait for a zoom — so the reason to keep them tiny is
// gone, and holding them at 8px meant that when a reader finally zoomed in far enough to see one,
// it was still too small to read.
describe("applyLabelScale reader sizes", () => {
  const mk = (svg: SVGSVGElement, cls: string, fs: number) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls); t.setAttribute("font-size", String(fs));
    svg.appendChild(t); return t;
  };
  const px = (el: Element, scale: number) => Number(el.getAttribute("font-size")) * scale;

  it("shows a name that waited for the zoom at a size worth reading", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const town = mk(svg, "city-label city-town", 8);
    const capital = mk(svg, "city-label city-capital", 10);
    const river = mk(svg, "river-label", 10);
    applyLabelScale(svg, 2.6);
    for (const [name, el] of [["town", town], ["capital", capital], ["river", river]] as const) {
      expect(px(el, 2.6), `${name} on screen`).toBeGreaterThanOrEqual(11.5);
    }
  });

  it("gives the big names no reader size of their own — the map already sized those", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const region = mk(svg, "region-label", 16);
    const realm = mk(svg, "nation-label", 16);
    applyLabelScale(svg, 4);
    expect(px(region, 4)).toBe(px(realm, 4));   // both follow the zoom alone, neither is boosted
  });

  it("keeps a capital's name ahead of a town's, as the map's own hierarchy has it", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const town = mk(svg, "city-label city-town", 8);
    const capital = mk(svg, "city-label city-capital", 10);
    applyLabelScale(svg, 3);
    expect(px(capital, 3)).toBeGreaterThan(px(town, 3));
  });

  it("still works from the original size when the scale changes again", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const town = mk(svg, "city-label city-town", 8);
    applyLabelScale(svg, 2);
    applyLabelScale(svg, 4);
    expect(px(town, 4)).toBeCloseTo(px(town, 4), 5);
    applyLabelScale(svg, 1);
    const atRest = Number(town.getAttribute("font-size"));
    applyLabelScale(svg, 8);
    applyLabelScale(svg, 1);
    expect(Number(town.getAttribute("font-size"))).toBe(atRest);
  });
});

// Holding a name at exactly its on-screen size is what a map application does, and at 8x it leaves
// the lettering looking detached: the land is eight times the size and the word beside it is not.
// Letting it grow with the zoom is the other extreme, and that is what the map used to do — a
// region's name eight times over. So it grows, but more slowly than the map does.
describe("applyLabelScale growth with zoom", () => {
  const mk = (svg: SVGSVGElement, cls: string, fs: number) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls); t.setAttribute("font-size", String(fs));
    svg.appendChild(t); return t;
  };
  const onScreen = (el: Element, scale: number) => Number(el.getAttribute("font-size")) * scale;
  const region = () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    return { svg, el: mk(svg, "region-label", 16) };
  };

  it("leaves the resting map exactly as it was", () => {
    const { svg, el } = region();
    applyLabelScale(svg, 1);
    expect(onScreen(el, 1)).toBeCloseTo(16, 4);
  });

  it("grows the lettering as the reader zooms, so it stays attached to the land", () => {
    const { svg, el } = region();
    applyLabelScale(svg, 8);
    expect(onScreen(el, 8)).toBeGreaterThan(16 * 1.8);
  });

  it("but far more slowly than the map grows, which is what the old behaviour did", () => {
    const { svg, el } = region();
    applyLabelScale(svg, 8);
    expect(onScreen(el, 8)).toBeLessThan(16 * 8 * 0.5);   // nowhere near eight times over
  });

  it("never runs away, however far the reader zooms", () => {
    const a = region(); applyLabelScale(a.svg, 8);
    const b = region(); applyLabelScale(b.svg, 64);
    expect(onScreen(b.el, 64)).toBeLessThanOrEqual(onScreen(a.el, 8) * 1.2);
  });

  it("grows without ever shrinking as the reader goes in", () => {
    let prev = 0;
    for (const s of [1, 1.5, 2, 2.6, 4, 6, 8]) {
      const { svg, el } = region();
      applyLabelScale(svg, s);
      const now = onScreen(el, s);
      expect(now, `scale ${s}`).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe("applyMarkerScale grows with its name", () => {
  it("follows the same law the lettering does, so a mark never outgrows or trails its label", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "marker-town"); dot.setAttribute("cx", "0"); dot.setAttribute("cy", "0");
    svg.appendChild(dot);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("class", "city-label city-town"); label.setAttribute("font-size", "8");
    svg.appendChild(label);

    const markAt = (s: number) => {
      applyMarkerScale(svg, s);
      return Number(/scale\(([\d.]+)\)/.exec(dot.getAttribute("transform")!)![1]);
    };
    const labelAt = (s: number) => {
      applyLabelScale(svg, s);
      return Number(label.getAttribute("font-size")) / 8;   // the factor applied in map units
    };
    for (const s of [1, 2, 4, 8]) {
      // the label carries a reader size the mark does not, so compare growth against zoom 1
      const m = markAt(s) / markAt(1), l = labelAt(s) / labelAt(1);
      expect(m, `scale ${s}`).toBeCloseTo(l, 3);
    }
  });
});

describe("applyLabelScale and the city plan", () => {
  it("holds a ward's name the way it holds every other name", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const ward = document.createElementNS(NS, "text");
    ward.setAttribute("class", "ward-label");
    ward.setAttribute("font-size", "7");
    svg.appendChild(ward);
    const rest = 7;
    applyLabelScale(svg, 4);
    const onScreen = Number(ward.getAttribute("font-size")) * 4;
    expect(onScreen).toBeGreaterThan(rest);        // grows with the zoom
    expect(onScreen).toBeLessThan(rest * 4);       // but nowhere near as fast as the plan does
    applyLabelScale(svg, 1);
    expect(ward.getAttribute("font-size")).toBe("7.00");
  });

  // Where a road leaves the plate it names the town it goes to (the road ends, 2026-09-26). Zooming a
  // plate cannot be measured from here (the relayout waits on a frame a hidden pane never draws), so the
  // one claim is pinned instead: a road's destination grows and shrinks exactly as a ward's name does,
  // and its parchment halo with it.
  it("holds a road's destination the way it holds a ward's name", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const make = (cls: string, halo?: string) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("class", cls);
      t.setAttribute("font-size", "7");
      if (halo) t.setAttribute("stroke-width", halo);
      svg.appendChild(t);
      return t;
    };
    const ward = make("ward-label"), end = make("road-end", "2.4");
    for (const s of [0.5, 2, 4, 8]) {
      applyLabelScale(svg, s);
      const k = Number(end.getAttribute("font-size")) / 7;
      expect(k, `scale ${s}`).not.toBe(1);
      expect(end.getAttribute("font-size"), `scale ${s}`).toBe(ward.getAttribute("font-size"));
      expect(Number(end.getAttribute("stroke-width")), `scale ${s}`).toBeCloseTo(2.4 * k, 1);
    }
    applyLabelScale(svg, 1);
    expect(end.getAttribute("font-size")).toBe("7.00");
  });
});

// The culture view's names were left out of the selector, so they alone kept growing with the land:
// measured at 7.53x, a region's name was down to font-size 4.12 and a town's to 4.28 while a
// culture's still read 13 -- 3.2x every other name on the same map, with nothing to stop it.
describe("the culture view's names", () => {
  it("holds its size on screen like every other name on the map", () => {
    const { svg, culture, region } = build();
    const rest = Number(culture.getAttribute("font-size"));
    applyLabelScale(svg, 8);
    const at8 = Number(culture.getAttribute("font-size"));
    expect(at8).toBeLessThan(rest);                                  // shrinks in map units
    expect(at8 * 8).toBeLessThan(rest * 3);                          // grows on screen, far less than the land
    // and lands in the same band as the region names it sits beside, rather than towering over them
    const regionOnScreen = Number(region.getAttribute("font-size")) * 8;
    expect(at8 * 8).toBeLessThan(regionOnScreen * 1.5);
  });
});

// The city plate is drawn to fit whatever room it has, and its names are drawn in map units, so a
// small window shrinks the lettering with the drawing. Measured on a 390x844 phone: the plate came
// out 336px across for 494 units, which put a 7-unit ward name at 4.8px on screen — while the SAME
// word in the key under it was 18px, three times over. A legend is not the thing you are looking at.
describe("floorLabelSize", () => {
  const NSVG = "http://www.w3.org/2000/svg";
  const plate = (units = 494) => {
    const svg = document.createElementNS(NSVG, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 " + units + " " + units);
    const t = document.createElementNS(NSVG, "text");
    t.setAttribute("class", "ward-label");
    t.setAttribute("font-size", "7");
    t.setAttribute("stroke-width", "2.2");
    svg.appendChild(t);
    return { svg, t };
  };
  const px = (t: Element, drawnPx: number, units = 494) =>
    Number(t.getAttribute("font-size")) * (drawnPx / units);

  it("lifts a name that is drawn too small to be read", () => {
    const { svg, t } = plate();
    floorLabelSize(svg, ".ward-label", 9, 336);
    expect(px(t, 336), "the name is still under the floor on a phone").toBeCloseTo(9, 2);
  });

  it("leaves a drawing that is already big enough alone", () => {
    const { svg, t } = plate();
    floorLabelSize(svg, ".ward-label", 9, 720);   // a desktop plate: 7 units is 10.2px already
    expect(Number(t.getAttribute("font-size")), "a desktop plate was rewritten for nothing").toBe(7);
  });

  // The halo is what keeps a name off the roofs under it; left behind, it thins to a hairline at
  // exactly the size where the name finally matters.
  it("keeps the halo in proportion to the letters it grew", () => {
    const { svg, t } = plate();
    floorLabelSize(svg, ".ward-label", 9, 336);
    expect(Number(t.getAttribute("stroke-width")) / Number(t.getAttribute("font-size")))
      .toBeCloseTo(2.2 / 7, 3);
  });

  // jsdom, and every render that has not been mounted yet, measures nothing. A floor computed from
  // a width of zero is an infinity written into the drawing.
  it("does nothing at all when the drawing has not been laid out", () => {
    const { svg, t } = plate();
    floorLabelSize(svg, ".ward-label", 9, 0);
    expect(Number(t.getAttribute("font-size"))).toBe(7);
  });

  // The floor is the size at rest; a reader who leans in must never end up below it again.
  it("survives the zoom, which works from the floored size", () => {
    const { svg, t } = plate();
    floorLabelSize(svg, ".ward-label", 9, 336);
    for (const scale of [1, 2, 4, 8]) {
      applyLabelScale(svg, scale);
      // sizes are written with two decimals, as everything in this module is, so the floor is
      // held to within that rounding and not to the last bit
      expect(px(t, 336) * scale, "zoomed to " + scale).toBeGreaterThanOrEqual(9 - 0.02);
    }
  });
});

// ★ The world map's names had no floor at all. Measured over 12 seeds on a 390x844 phone, the map
// is drawn 336px across for 1000 units (x0.336), so its names stood at a median 4.4px and as small
// as 3.5 — while the same map on a desktop reads 15. The floor lives INSIDE the zoom's own
// arithmetic, because the world map re-runs that arithmetic on every scrub and every pinch: a floor
// written once at rest (the plate's `floorLabelSize`) is overwritten by the first year the reader
// scrubs to. And it floors the size ON SCREEN at each scale rather than raising the base size,
// which would multiply every zoomed size along with it — a town's name at 2.6x would go from 6px
// to 18px.
describe("applyLabelScale with a floor", () => {
  const map = (fs = 12, sw = 3) => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", "region-label");
    t.setAttribute("font-size", String(fs));
    t.setAttribute("stroke-width", String(sw));
    svg.appendChild(t);
    return { svg, t };
  };
  const onScreen = (t: Element, drawnPx: number, scale: number) =>
    Number(t.getAttribute("font-size")) * (drawnPx / 1000) * scale;

  it("lifts a name drawn under the floor to the floor, on screen", () => {
    const { svg, t } = map();                              // 12 units at x0.336 is 4.0px
    applyLabelScale(svg, 1, { minPx: 8, drawnPx: 336 });
    expect(onScreen(t, 336, 1)).toBeCloseTo(8, 1);
  });

  it("holds the floor at every zoom, and every scrub that re-runs it", () => {
    const { svg, t } = map();
    for (const scale of [1, 1.2, 2, 1, 4, 8, 1]) {
      applyLabelScale(svg, scale, { minPx: 8, drawnPx: 336 });
      expect(onScreen(t, 336, scale), "zoomed to " + scale).toBeGreaterThanOrEqual(8 - 0.02);
    }
  });

  it("changes nothing once the zoom has carried a name past the floor", () => {
    const a = map(), b = map();
    applyLabelScale(a.svg, 8, { minPx: 8, drawnPx: 336 });
    applyLabelScale(b.svg, 8);
    expect(a.t.getAttribute("font-size"), "the floor inflated a name that was already big enough")
      .toBe(b.t.getAttribute("font-size"));
  });

  it("leaves a desktop map, already past the floor, as it was", () => {
    const a = map(), b = map();
    applyLabelScale(a.svg, 1, { minPx: 8, drawnPx: 929 });   // 12 units at x0.929 is 11px
    applyLabelScale(b.svg, 1);
    expect(a.t.getAttribute("font-size")).toBe(b.t.getAttribute("font-size"));
  });

  it("keeps the halo in proportion to the letters it grew", () => {
    const { svg, t } = map(12, 3);
    applyLabelScale(svg, 1, { minPx: 8, drawnPx: 336 });
    expect(Number(t.getAttribute("stroke-width")) / Number(t.getAttribute("font-size"))).toBeCloseTo(3 / 12, 2);
  });

  it("does nothing at all when the drawing has not been laid out", () => {
    const a = map(), b = map();
    applyLabelScale(a.svg, 1, { minPx: 8, drawnPx: 0 });
    applyLabelScale(b.svg, 1);
    expect(a.t.getAttribute("font-size")).toBe(b.t.getAttribute("font-size"));
  });
});
