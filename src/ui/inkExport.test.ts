// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";

// jsdom has no canvas to draw a PNG with: what reaches the drawing step is what is checked
const drawn: { svg: SVGSVGElement; width: number; height: number }[] = [];
vi.mock("./export", async (original) => ({
  ...(await original<typeof import("./export")>()),
  svgToPngBlob: vi.fn(async (svg: SVGSVGElement, width: number, height: number) => { drawn.push({ svg, width, height }); return new Blob(); }),
  downloadBlob: vi.fn(),
}));
const { createApp } = await import("./app");

afterEach(() => { location.hash = ""; drawn.length = 0; });

// A world map's PNG is for print: the map three times over (3000px across the usual world, ten inches at
// 300dpi), and its lines pinned to the screen are thickened by as much — measured in the first 3000px ink
// file, the coast came out no heavier than its own water lines and the rivers as hairlines. The SVG is
// vector and stays as drawn. The colour map's PNG was the map's own size, 1000px — eight and a half
// centimetres at 300dpi — until a region of the map could be written for a book's chapter (regionPage.ts):
// now both are drawn for print.
describe("the world map's print file", () => {
  const press = async (root: HTMLElement, label: string) => {
    ([...root.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement).click();
    for (let k = 0; k < 400 && !drawn.length; k++) await new Promise((r) => setTimeout(r, 5));
  };
  const coast = (svg: SVGSVGElement) => Number(svg.querySelector(".coastline")!.getAttribute("stroke-width"));

  it("draws the colour and the ink PNG three times over, their screen-pinned lines thickened with them", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      createApp(root, { ...DEFAULT_PARAMS, seed: 1 });
      await press(root, "PNG");
      expect(drawn[0], "the colour PNG never drawn").toBeDefined();
      expect([drawn[0].width, drawn[0].height]).toEqual([3000, 2100]);
      expect(coast(drawn[0].svg), "the colour coast was not thickened for print").toBeCloseTo(2.4 * 3, 6);
      drawn.length = 0;
      (root.querySelector(".ink-toggle") as HTMLButtonElement).click();
      await press(root, "PNG");
      expect([drawn[0].width, drawn[0].height]).toEqual([3000, 2100]);
      expect(drawn[0].svg.classList.contains("ink")).toBe(true);
      expect(coast(drawn[0].svg), "the ink coast was not thickened for print").toBeCloseTo(1.5 * 3, 6);
    } finally {
      root.remove();
    }
  }, 20000);
});
