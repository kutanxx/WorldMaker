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
});
