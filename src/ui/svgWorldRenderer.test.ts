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
  it("terrain view (default): borders only, no territory fills, biome legend shown", () => {
    expect(svg.getAttribute("class")).toContain("view-terrain");
    expect(svg.querySelectorAll("path.coastline").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBe(0);
    expect(svg.querySelectorAll("path.border").length).toBe(1);
    expect(svg.querySelectorAll(".biome-legend .legend-item").length).toBeGreaterThan(0);
  });
  it("keeps a marker per city", () => {
    expect(svg.querySelectorAll(".markers circle").length).toBe(world.cities.length);
    expect(svg.querySelector(".markers circle")?.getAttribute("data-city")).not.toBeNull();
  });
});

describe("renderWorld political view", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world, "political");
  it("fills nations, labels them, and shows a nation legend", () => {
    expect(svg.getAttribute("class")).toContain("view-political");
    expect(svg.querySelectorAll(".political-slot .territory").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".nation-label").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".nation-legend").length).toBe(1);
  });
});
