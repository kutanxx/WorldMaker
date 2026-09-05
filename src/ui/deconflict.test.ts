// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { deconflictLabels } from "./deconflict";

const NS = "http://www.w3.org/2000/svg";
type Box = { x: number; y: number; width: number; height: number };
function mkLabel(svg: SVGSVGElement, cls: string, box: Box) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", cls);
  (t as unknown as { getBBox: () => Box }).getBBox = () => box; // jsdom lacks getBBox; stub per element
  svg.appendChild(t);
  return t as unknown as SVGGraphicsElement;
}

describe("deconflictLabels", () => {
  it("hides a lower-priority label overlapping a higher-priority one; keeps a non-overlapping one", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const nation = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const townOverlap = mkLabel(svg, "city-label city-town", { x: 10, y: 2, width: 40, height: 10 });
    const townFar = mkLabel(svg, "city-label city-town", { x: 200, y: 200, width: 30, height: 10 });
    deconflictLabels(svg, 4);
    expect(nation.style.visibility).toBe("");
    expect(townOverlap.style.visibility).toBe("hidden");
    expect(townFar.style.visibility).toBe("");
  });

  it("never hides the player's own nation label (top tier); the other nation yields", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const other = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const player = mkLabel(svg, "nation-label player", { x: 5, y: 1, width: 50, height: 10 });
    deconflictLabels(svg, 4);
    expect(player.style.visibility).toBe("");
    expect(other.style.visibility).toBe("hidden");
  });

  it("clamps labels spilling past the viewBox back inside the map; rotated rivers are left alone", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    // a west-edge player label: box spills 40 units past the left edge (the Karkvrakh case)
    const west = mkLabel(svg, "nation-label player", { x: -40, y: 300, width: 120, height: 18 });
    west.setAttribute("x", "20");
    // an east-edge town: right edge at 1010, 20 past the frame pad
    const east = mkLabel(svg, "city-label city-town", { x: 960, y: 100, width: 50, height: 8 });
    east.setAttribute("x", "985");
    // a top-edge region label: spills above
    const north = mkLabel(svg, "region-label", { x: 500, y: -6, width: 60, height: 12 });
    north.setAttribute("y", "4");
    // a river label is ROTATED: its local-space bbox can't be shifted via x/y — must not be touched
    const river = mkLabel(svg, "river-label", { x: -30, y: 100, width: 60, height: 8 });
    river.setAttribute("x", "5");
    deconflictLabels(svg, 4);
    expect(Number(west.getAttribute("x"))).toBe(70);  // +50: box.x -40 → 10 (pad)
    expect(Number(east.getAttribute("x"))).toBe(965); // -20: right 1010 → 990
    expect(Number(north.getAttribute("y"))).toBe(20); // +16: box.y -6 → 10
    expect(Number(river.getAttribute("x"))).toBe(5);  // untouched
    expect(west.style.visibility).toBe("");           // clamping must not hide it
  });

  it("without a viewBox the clamp is skipped (culling still runs)", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const t = mkLabel(svg, "nation-label", { x: -40, y: 0, width: 120, height: 18 });
    t.setAttribute("x", "20");
    deconflictLabels(svg, 4);
    expect(Number(t.getAttribute("x"))).toBe(20);
  });

  it("lifts a nation's name clear of a capital instead of deleting the capital", () => {
    // A nation's name is placed at the centroid of its territory and its capital usually sits near
    // that centroid too, so the two collide — and the capital, being the lower tier, was what
    // disappeared. Measured on seed 7's political view, three of eight capitals were lost this way.
    // A political map wants both.
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const nation = mkLabel(svg, "nation-label", { x: 300, y: 300, width: 80, height: 12 });
    nation.setAttribute("y", "310");
    const capital = mkLabel(svg, "city-label city-capital", { x: 320, y: 305, width: 60, height: 10 });
    deconflictLabels(svg, 4);
    expect(capital.style.visibility).toBe("");        // the capital survives
    expect(nation.style.visibility).toBe("");         // and so does the nation
    expect(Number(nation.getAttribute("y"))).toBeLessThan(310);   // by moving the nation up
  });

  it("leaves a nation's name alone when no capital is under it", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const nation = mkLabel(svg, "nation-label", { x: 300, y: 300, width: 80, height: 12 });
    nation.setAttribute("y", "310");
    mkLabel(svg, "city-label city-capital", { x: 700, y: 100, width: 60, height: 10 });
    deconflictLabels(svg, 4);
    expect(Number(nation.getAttribute("y"))).toBe(310);
  });
});

describe("deconflictLabels air gap", () => {
  it("hides a label that merely misses a kept one — a stack needs air, not just no collision", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    // measured on seed 7: two region names 3 units apart with 29 units of horizontal overlap, both
    // kept, reading as one two-line stack.
    const upper = mkLabel(svg, "region-label", { x: 0, y: 0, width: 100, height: 14 });
    const stacked = mkLabel(svg, "region-label", { x: 10, y: 17, width: 90, height: 14 });
    deconflictLabels(svg, 4);
    expect(upper.style.visibility).toBe("");
    expect(stacked.style.visibility).toBe("hidden");
  });

  it("still keeps a label that clears the gap", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const upper = mkLabel(svg, "region-label", { x: 0, y: 0, width: 100, height: 14 });
    const below = mkLabel(svg, "region-label", { x: 10, y: 40, width: 90, height: 14 });
    deconflictLabels(svg, 4);
    expect(upper.style.visibility).toBe("");
    expect(below.style.visibility).toBe("");
  });
});

describe("deconflictLabels and the world's title", () => {
  it("reserves the title's space, so a region name cannot sit under it", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const title = mkLabel(svg, "world-name-text", { x: 400, y: 14, width: 200, height: 22 });
    const under = mkLabel(svg, "region-label", { x: 420, y: 38, width: 160, height: 14 });
    const elsewhere = mkLabel(svg, "region-label", { x: 100, y: 300, width: 160, height: 14 });
    deconflictLabels(svg, 4);
    expect(title.style.visibility).toBe("");      // a title is never the thing that yields
    expect(under.style.visibility).toBe("hidden");
    expect(elsewhere.style.visibility).toBe("");
  });
});

// The pass has to survive being run again: once the map re-runs it on every zoom step, a pass that
// nudges a label by a delta each time would walk it off the map.
describe("deconflictLabels run more than once", () => {
  // A stub that follows the element, the way a real getBBox does — with a fixed box, moving a label
  // and re-measuring it look the same, and the drift this test is here to catch is invisible.
  const mkMoving = (svg: SVGSVGElement, cls: string, x: number, y: number, w: number, h: number) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls); t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    (t as unknown as { getBBox: () => Box }).getBBox = () =>
      ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) - h, width: w, height: h });
    svg.appendChild(t);
    return t as unknown as SVGGraphicsElement;
  };

  it("puts a lifted nation label in the same place the second time", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 500 500");
    const nation = mkMoving(svg, "nation-label", 100, 112, 60, 12);
    const capital = mkMoving(svg, "city-label city-capital", 110, 114, 40, 10);
    deconflictLabels(svg, 4);
    const afterOne = nation.getAttribute("y");
    expect(afterOne).not.toBe("112");           // it did move off the capital
    deconflictLabels(svg, 4);
    expect(nation.getAttribute("y")).toBe(afterOne);
    deconflictLabels(svg, 4);
    expect(nation.getAttribute("y")).toBe(afterOne);
    expect(capital.style.visibility).toBe("");
  });

  it("clamps against the map, not against whatever the viewBox is zoomed to", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 500 500");
    // a label sitting comfortably inside the map, far from the corner the zoom will show
    const far = mkLabel(svg, "region-label", { x: 300, y: 300, width: 80, height: 14 });
    far.setAttribute("x", "300"); far.setAttribute("y", "312");
    deconflictLabels(svg);
    expect(far.getAttribute("x")).toBe("300");   // nothing to clamp at base scale
    // now zoom into the top-left corner: the label is off-screen, and must NOT be dragged into view
    svg.setAttribute("viewBox", "0 0 125 125");
    deconflictLabels(svg);
    expect(far.getAttribute("x")).toBe("300");
    expect(far.getAttribute("y")).toBe("312");
  });
});

// Scale thresholds: at rest the map carries only the names of large things, and the smaller ones
// arrive as the reader leans in. Marks are not names — a town's dot stays, so the map still shows
// where the settlements are; it is the word beside it that waits for the zoom.
describe("deconflictLabels scale thresholds", () => {
  const build = () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    return {
      svg,
      region: mkLabel(svg, "region-label", { x: 10, y: 10, width: 80, height: 14 }),
      capital: mkLabel(svg, "city-label city-capital", { x: 300, y: 300, width: 40, height: 10 }),
      river: mkLabel(svg, "river-label", { x: 500, y: 100, width: 50, height: 10 }),
      town: mkLabel(svg, "city-label city-town", { x: 700, y: 500, width: 30, height: 8 }),
    };
  };
  const shown = (el: SVGGraphicsElement) => el.style.visibility !== "hidden";

  it("shows only the big names at rest", () => {
    const { svg, region, capital, river, town } = build();
    deconflictLabels(svg, 1);
    expect(shown(region)).toBe(true);
    expect(shown(capital)).toBe(false);
    expect(shown(river)).toBe(false);
    expect(shown(town)).toBe(false);
  });

  it("lets them in as the reader leans in, biggest first", () => {
    const { svg, capital, river, town } = build();
    deconflictLabels(svg, 1.5);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, false, false]);
    deconflictLabels(svg, 2);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, true, false]);
    deconflictLabels(svg, 2.6);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, true, true]);
  });

  it("takes them away again on the way back out", () => {
    const { svg, town } = build();
    deconflictLabels(svg, 4);
    expect(shown(town)).toBe(true);
    deconflictLabels(svg, 1);
    expect(shown(town)).toBe(false);
  });

  it("defaults to the resting scale when no zoom is given", () => {
    const { svg, region, town } = build();
    deconflictLabels(svg);
    expect(shown(region)).toBe(true);
    expect(shown(town)).toBe(false);
  });

  it("never lets a name held back for scale take up room a visible one could use", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const town = mkLabel(svg, "city-label city-town", { x: 100, y: 100, width: 90, height: 12 });
    const region = mkLabel(svg, "region-label", { x: 100, y: 100, width: 90, height: 12 });
    deconflictLabels(svg, 1);   // the town is out of scale; it must not cull the region under it
    expect(shown(region)).toBe(true);
    expect(shown(town)).toBe(false);
  });
});
