// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { encodeParams } from "./urlState";

afterEach(() => { location.hash = ""; });

// The page refills the realms' layer at every year (fillSlot), and the realms' key with it: the marks'
// rows must come back with every year, not only with the first drawing.
describe("the key beside the map", () => {
  it("still names the marks after the year is moved, in the realms' view", () => {
    const params = { ...DEFAULT_PARAMS, seed: 1 };
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      createApp(root, params);
      ([...root.querySelectorAll(".view-toggle button")][1] as HTMLButtonElement).click();   // the realms
      const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
      slider.value = String(Math.floor(Number(slider.max) / 2));
      slider.dispatchEvent(new Event("input"));
      const words = [...root.querySelectorAll(".legend-sheet .legend-row text")].map((t) => t.textContent);
      expect(words.slice(-3)).toEqual(["Capital", "Town", "Free port"]);
    } finally {
      root.remove();
    }
  }, 30000);
});
