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
    deconflictLabels(svg);
    expect(nation.style.visibility).toBe("");
    expect(townOverlap.style.visibility).toBe("hidden");
    expect(townFar.style.visibility).toBe("");
  });

  it("never hides the player's own nation label (top tier); the other nation yields", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const other = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const player = mkLabel(svg, "nation-label player", { x: 5, y: 1, width: 50, height: 10 });
    deconflictLabels(svg);
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
    deconflictLabels(svg);
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
    deconflictLabels(svg);
    expect(Number(t.getAttribute("x"))).toBe(20);
  });
});
