// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";

// What the plate's road names are placed around, recorded as they are placed.
const placedWith: { zoomButtons: boolean }[] = [];
vi.mock("./deconflict", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deconflict")>();
  return {
    ...real,
    placeRoadEnds: (svg: SVGSVGElement, ...rest: unknown[]) => {
      const frame = svg.closest(".map-frame");
      if (frame) placedWith.push({ zoomButtons: !!frame.querySelector(":scope > .map-zoom-controls") });
      return (real.placeRoadEnds as (svg: SVGSVGElement, ...a: unknown[]) => void)(svg, ...rest);
    },
  };
});
const { createApp } = await import("./app");
const { encodeParams } = await import("./urlState");

afterEach(() => { location.hash = ""; placedWith.length = 0; });

// Where a road leaves a plate, the name of the town it goes to is written beside it (placeRoadEnds),
// clear of what the page floats over the plate. The zoom buttons stand in the plate's top-left corner,
// and they were put on only AFTER the names had been placed — measured on the live site at 1440x900,
// a destination stood under them on 7 of 34 plates ("트레로이스 방면", "카인자즈 방면", …).
describe("a plate's road names and its zoom buttons", () => {
  it("places the names once the zoom buttons are on the plate", async () => {
    const params = { ...DEFAULT_PARAMS, seed: 1 };
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const app = createApp(root, params);
      app.openCity(0);
      expect(placedWith.length, "the plate placed no road names").toBeGreaterThan(0);
      expect(placedWith[placedWith.length - 1].zoomButtons, "placed before the zoom buttons were on the plate").toBe(true);
    } finally {
      root.remove();
    }
  }, 30000);
});
