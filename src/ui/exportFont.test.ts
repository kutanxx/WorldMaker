// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EXPORT_FONT_STYLE, embedExportFonts } from "./exportFont";
import { svgToString } from "./export";

describe("embedExportFonts", () => {
  it("embeds a Cinzel @font-face as a base64 woff2 data-URI (self-contained export)", () => {
    expect(EXPORT_FONT_STYLE).toContain("@font-face");
    expect(EXPORT_FONT_STYLE).toContain("font-family:'Cinzel'");
    expect(EXPORT_FONT_STYLE).toContain("data:font/woff2;base64,");
    expect(EXPORT_FONT_STYLE).toContain("format('woff2')");
  });

  it("inserts the font <style> as the SVG's first child and survives serialization", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    svg.appendChild(rect);
    embedExportFonts(svg);
    const style = svg.firstElementChild!;
    expect(style.tagName.toLowerCase()).toBe("style");
    expect(style.textContent).toContain("@font-face");
    const serialized = svgToString(svg as SVGSVGElement);
    expect(serialized).toContain("data:font/woff2;base64,");
    expect(serialized).toContain(".nation-label"); // pins the same font stack the on-screen CSS uses
  });
});
