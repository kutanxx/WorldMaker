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
    expect(region.getAttribute("font-size")).toBe("8.00");
    expect(town.getAttribute("font-size")).toBe("4.00");
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
    expect(river.getAttribute("font-size")).toBe("5.00");
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
