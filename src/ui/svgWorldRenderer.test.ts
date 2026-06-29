// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld } from "./svgWorldRenderer";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 600, townCount: 8 };

describe("renderWorld", () => {
  it("creates one region path per polity that owns cells", () => {
    const { world } = generateWorld(small);
    const svg = renderWorld(world);
    const paths = svg.querySelectorAll(".regions path");
    expect(paths.length).toBe(world.polities.length);
  });
  it("renders a marker per city with a data-city id", () => {
    const { world } = generateWorld(small);
    const svg = renderWorld(world);
    expect(svg.querySelectorAll(".markers circle").length).toBe(world.cities.length);
    expect(svg.querySelector(".markers circle")?.getAttribute("data-city")).not.toBeNull();
  });
});
