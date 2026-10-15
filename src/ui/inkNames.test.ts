// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
const inked = (lang: "ko" | "en") => renderWorld(world, "terrain", [], lang, new Set(), undefined, undefined, "ink");

// ★ On the ink map a region's name — 9.5px, tracked, in a light face — lay over the trees' and the peaks'
// hatching and half vanished ("트리아노르크 침엽수림", design review 2026-10-15, item 11). In ink the land's
// names are set bold where the face has a bold (Gowun Batang 700 is loaded; EB Garamond's is not, and a
// synthesized bold smears), and every region name keeps a paper halo of 3, up from 2.
describe("the ink map's region names stand over the hatching", () => {
  it("sets a Korean land name in bold, with a wider paper halo", () => {
    const land = [...inked("ko").querySelectorAll(".region-label.region-land")];
    expect(land.length).toBeGreaterThan(3);
    for (const t of land) {
      expect(t.getAttribute("font-weight"), t.textContent ?? "").toBe("700");
      expect(t.getAttribute("stroke-width")).toBe("3");
    }
  });

  it("widens an English name's halo but leaves its weight to the face it has", () => {
    const land = [...inked("en").querySelectorAll(".region-label.region-land")];
    expect(land.length).toBeGreaterThan(3);
    for (const t of land) {
      expect(t.getAttribute("font-weight")).not.toBe("700");
      expect(t.getAttribute("stroke-width")).toBe("3");
    }
  });

  it("gives the seas the halo and nothing else", () => {
    for (const lang of ["ko", "en"] as const) {
      const seas = [...inked(lang).querySelectorAll(".region-label.region-sea")];
      expect(seas.length).toBeGreaterThan(0);
      for (const t of seas) {
        expect(t.getAttribute("stroke-width")).toBe("3");
        expect(t.getAttribute("font-weight")).not.toBe("700");
      }
    }
  });

  it("leaves the colour map's names as they were", () => {
    const colour = renderWorld(world, "terrain", [], "ko");
    for (const t of colour.querySelectorAll(".region-label")) {
      expect(t.getAttribute("stroke-width")).toBe("2");
      expect(t.hasAttribute("font-weight")).toBe(false);
    }
  });
});
