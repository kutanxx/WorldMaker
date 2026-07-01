// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";

describe("renderWorld biomes", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("fills cells by biome (several biome paths, no political region fills)", () => {
    expect(svg.querySelectorAll(".biomes path.biome").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".regions").length).toBe(0);
    expect(svg.querySelectorAll(".mountains").length).toBe(0);
  });
  it("draws coastline once and a political slot with territories + one border", () => {
    expect(svg.querySelectorAll("path.coastline").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll("path.border").length).toBe(1);
  });
  it("keeps a marker per city and shows a biome legend", () => {
    expect(svg.querySelectorAll(".markers circle").length).toBe(world.cities.length);
    const first = svg.querySelector(".markers circle");
    expect(first?.getAttribute("data-city")).not.toBeNull();
    expect(svg.querySelectorAll(".legend .legend-item").length).toBeGreaterThan(0);
  });
});
