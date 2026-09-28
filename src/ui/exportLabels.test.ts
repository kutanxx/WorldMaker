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

// A region of the map on its own page (regionPage.ts) is laid out by the page's law: its names at the whole
// map's page size, kept apart by the page's air.
describe("a region's page, laid out", () => {
  it("sets its names at the whole map's page size and keeps them apart by the page's air", () => {
    const { svg, region, town } = build();
    // the region's name 16 tall at 100..116, the town's 8 at 102..110: at a third of the size they part
    (region as unknown as { getBBox: () => Box }).getBBox = () => ({ x: 100, y: 100, width: 40, height: 5.3 });
    (town as unknown as { getBBox: () => Box }).getBBox = () => ({ x: 100, y: 108, width: 20, height: 4 });
    layOutLabelsForExport(svg, undefined, 3);
    expect(Number(town.getAttribute("font-size")), "8, at its reading size 1.5, over 3").toBeCloseTo(4, 2);
    expect(Number(region.getAttribute("font-size"))).toBeCloseTo(5.33, 2);
    expect(town.style.visibility, "2.7 below the region's name: clear of a third of the air").toBe("");
  });
});

// A plate's names step off their signs before they are culled (clearMarks), on the screen and in
// the file alike — so the export takes the plate's own pass, run at the size the file is read at.
describe("a drawing's own pass before the cull", () => {
  it("runs after the names are sized and before any is hidden", () => {
    const { svg, town } = build();
    const seen: string[] = [];
    layOutLabelsForExport(svg, (s) => {
      expect(s).toBe(svg);
      expect(s.isConnected, "measured off the page, where nothing can be measured").toBe(true);
      seen.push(town.style.visibility);
    });
    expect(seen, "the pass never ran").toEqual([""]);   // before the cull hid the town
    expect(town.style.visibility).toBe("hidden");
  });
});
