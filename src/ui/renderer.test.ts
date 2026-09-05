// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { svgEl, legendPanel } from "./renderer";

describe("svgEl", () => {
  it("creates namespaced elements with attributes", () => {
    const r = svgEl("rect", { x: 1, y: 2, fill: "#abc" });
    expect(r.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(r.getAttribute("x")).toBe("1");
    expect(r.getAttribute("fill")).toBe("#abc");
  });
});

describe("legendPanel", () => {
  it("draws the map's own frame at panel scale: a double rule with corner dots, not a UI card", () => {
    const g = legendPanel(10, 20, 100, 60);
    const rects = [...g.querySelectorAll("rect")];
    expect(rects.length).toBe(2);                                   // outer rule, inner rule
    expect(rects[0].getAttribute("stroke")).toBe(rects[1].getAttribute("stroke"));   // one ink
    expect(Number(rects[0].getAttribute("stroke-width")))
      .toBeGreaterThan(Number(rects[1].getAttribute("stroke-width")));               // heavy, then fine
    for (const r of rects) expect(r.getAttribute("rx")).toBeNull();  // square corners, like the frame
    expect(g.querySelectorAll("circle").length).toBe(4);             // a dot at each corner
  });

  it("keeps the inner rule inside the outer one", () => {
    const g = legendPanel(10, 20, 100, 60);
    const [outer, inner] = [...g.querySelectorAll("rect")];
    expect(Number(inner.getAttribute("x"))).toBeGreaterThan(Number(outer.getAttribute("x")));
    expect(Number(inner.getAttribute("width"))).toBeLessThan(Number(outer.getAttribute("width")));
  });

  it("pins its rules to the screen, like every other line on the map", () => {
    const g = legendPanel(10, 20, 100, 60);
    for (const el of g.querySelectorAll("rect")) {
      expect(el.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });

  it("is opaque enough to read a name on, since labels underneath it are culled anyway", () => {
    const outer = legendPanel(10, 20, 100, 60).querySelector("rect")!;
    expect(Number(outer.getAttribute("fill-opacity"))).toBeGreaterThanOrEqual(0.95);
  });
});
