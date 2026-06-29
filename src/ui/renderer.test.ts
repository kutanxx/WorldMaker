// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { svgEl } from "./renderer";

describe("svgEl", () => {
  it("creates namespaced elements with attributes", () => {
    const r = svgEl("rect", { x: 1, y: 2, fill: "#abc" });
    expect(r.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(r.getAttribute("x")).toBe("1");
    expect(r.getAttribute("fill")).toBe("#abc");
  });
});
