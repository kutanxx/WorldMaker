// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { icon, sign, ICON_NAMES } from "./icons";

// ★ The bar carried three kinds of sign — colour emoji, text glyphs and one drawn chain — and an emoji is
// drawn by the reader's OS, differently on each (design review 2026-10-15, item 5). Every sign is one
// drawing now, in the ink of whatever it stands in.
describe("icons", () => {
  it("draws every name as an inline svg in currentColor, at the chain's stroke", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(12);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
      expect(svg.getAttribute("aria-hidden"), `${name} is read out as a picture`).toBe("true");
      const shapes = [...svg.querySelectorAll("path, circle")];
      expect(shapes.length, `${name} draws nothing`).toBeGreaterThan(0);
      for (const s of shapes) {
        const colours = [s.getAttribute("fill"), s.getAttribute("stroke")].filter((c) => c !== null && c !== "none");
        expect(colours.length, `${name} has a shape with no ink`).toBeGreaterThan(0);
        for (const c of colours) expect(c, `${name} carries a colour of its own`).toBe("currentColor");
        const w = s.getAttribute("stroke-width");
        if (s.getAttribute("fill") === "none") expect(w).toBe("1.6");
      }
    }
  });

  it("is sized in pixels, square, and takes the size it is asked for", () => {
    expect([icon("die").getAttribute("width"), icon("die").getAttribute("height")]).toEqual(["15", "15"]);
    expect(icon("map", 40).getAttribute("width")).toBe("40");
  });

  it("signs a control with its icon and its words, and again on a language switch", () => {
    const b = document.createElement("button");
    sign(b, "die", "새 세계");
    expect(b.querySelector("svg.icon-die")).not.toBeNull();
    expect(b.querySelector(".icon-words")?.textContent).toBe("새 세계");
    sign(b, "die", "New world");
    expect(b.querySelectorAll("svg").length, "the old icon is still there").toBe(1);
    expect(b.textContent).toBe("New world");
    sign(b, "close");
    expect(b.textContent, "a bare icon has no words").toBe("");
    expect(b.querySelector("svg.icon-close")).not.toBeNull();
  });
});
