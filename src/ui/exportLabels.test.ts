// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { layOutLabelsForExport } from "./exportLabels";

const NS = "http://www.w3.org/2000/svg";
type Box = { x: number; y: number; width: number; height: number };

function build() {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 1000 700");
  const mk = (cls: string, fs: number, box: Box) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls);
    t.setAttribute("font-size", String(fs));
    (t as unknown as { getBBox: () => Box }).getBBox = () => box;
    svg.appendChild(t);
    return t as unknown as SVGGraphicsElement;
  };
  return {
    svg,
    region: mk("region-label", 16, { x: 100, y: 100, width: 120, height: 16 }),
    town: mk("city-label city-town", 8, { x: 110, y: 102, width: 60, height: 8 }),  // sits on the region
    farTown: mk("city-label city-town", 8, { x: 600, y: 400, width: 60, height: 8 }),
    river: mk("river-label", 10, { x: 300, y: 500, width: 70, height: 10 }),
  };
}

describe("layOutLabelsForExport", () => {
  // The pass needs real layout: a detached SVG has no getBBox, so it used to bail and every label
  // went into the file, stacked on top of its neighbours.
  it("culls a label that collides, which a detached SVG never did", () => {
    const { svg, region, town } = build();
    layOutLabelsForExport(svg);
    expect(region.style.visibility).toBe("");
    expect(town.style.visibility).toBe("hidden");
  });

  it("keeps every tier — an exported map is read at one size, so nothing waits for a zoom", () => {
    const { svg, farTown, river } = build();
    layOutLabelsForExport(svg);
    expect(farTown.style.visibility).toBe("");   // a town's name would be gated away on screen
    expect(river.style.visibility).toBe("");
  });

  it("gives the small names their reading size, as the screen does when zoomed", () => {
    const { svg, farTown } = build();
    layOutLabelsForExport(svg);
    expect(Number(farTown.getAttribute("font-size"))).toBeGreaterThan(8);
  });

  it("leaves the svg unattached, so the caller gets back what it handed over", () => {
    const { svg } = build();
    layOutLabelsForExport(svg);
    expect(svg.parentNode).toBeNull();
    expect(document.body.children.length).toBe(0);
  });

  it("takes the svg back even if the pass throws", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const bad = document.createElementNS(NS, "text");
    bad.setAttribute("class", "region-label");
    (bad as unknown as { getBBox: () => Box }).getBBox = () => { throw new Error("no layout"); };
    svg.appendChild(bad);
    expect(() => layOutLabelsForExport(svg)).not.toThrow();
    expect(svg.parentNode).toBeNull();
    expect(document.body.children.length).toBe(0);
  });
});
