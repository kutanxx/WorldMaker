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
  it("halves the lettering when the map is twice as big, so it holds its size on screen", () => {
    const { svg, region, town } = build();
    applyLabelScale(svg, 2);
    expect(region.getAttribute("font-size")).toBe("8.00");   // 16 / 2
    // a town's name also carries its reader size (below), so it is 8 * 1.5 / 2, not 8 / 2
    expect(town.getAttribute("font-size")).toBe("6.00");
  });

  it("thins the halo with the letters", () => {
    const { svg, region } = build();
    applyLabelScale(svg, 4);
    expect(region.getAttribute("stroke-width")).toBe("0.50");
  });

  it("always works from the original size, never from the last result", () => {
    const { svg, region } = build();
    applyLabelScale(svg, 2);
    applyLabelScale(svg, 4);
    applyLabelScale(svg, 8);
    expect(region.getAttribute("font-size")).toBe("2.00");   // 16/8, not 16/2/4/8
    applyLabelScale(svg, 1);
    expect(region.getAttribute("font-size")).toBe("16.00");  // and all the way back
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
    expect(river.getAttribute("font-size")).toBe("6.50"); // 10 * 1.3 / 2
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
    expect(dot.getAttribute("transform")).toBe("translate(300,200) scale(0.2500) translate(-300,-200)");
  });

  it("finds the centre of a path mark, which has no cx of its own", () => {
    const svg = mkSvg();
    const star = mkStar(svg, 120, 90);
    applyMarkerScale(svg, 2);
    expect(star.getAttribute("transform")).toContain("translate(120,90)");
    expect(star.getAttribute("transform")).toContain("scale(0.5000)");
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

  it("leaves the big names at the size the map already gave them", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const region = mk(svg, "region-label", 16);
    applyLabelScale(svg, 4);
    expect(px(region, 4)).toBe(16);
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
