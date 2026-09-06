// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { applyLabelScale, applyMarkerScale } from "./labelScale";

const NS = "http://www.w3.org/2000/svg";
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
           river: mk("river-label", 10, 1.8) };
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
