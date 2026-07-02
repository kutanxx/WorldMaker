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
  it("keeps a clickable marker per city (capitals as stars, towns as dots)", () => {
    expect(svg.querySelectorAll(".markers [data-city]").length).toBe(world.cities.length);
    const capitals = world.cities.filter((c) => c.isCapital).length;
    expect(svg.querySelectorAll(".marker-capital").length).toBe(capitals);
    expect(svg.querySelectorAll(".marker-town").length).toBe(world.cities.length - capitals);
  });
  it("draws a decorative map frame and a compass rose (parchment theme)", () => {
    expect(svg.querySelectorAll(".map-frame").length).toBe(1);
    expect(svg.querySelectorAll(".compass").length).toBe(1);
    expect(svg.querySelector(".compass-n")?.textContent).toBe("N");
  });
  it("renders the world name as a title and geographic region labels (atlas depth)", () => {
    expect(svg.querySelector(".world-name-text")?.textContent).toBe(world.name);
    expect(svg.querySelectorAll(".region-labels .region-label").length).toBeGreaterThan(0);
    // geography names show in the political view too
    const pol = renderWorld(world, "political");
    expect(pol.querySelectorAll(".region-label").length).toBeGreaterThan(0);
    expect(pol.querySelector(".world-name-text")?.textContent).toBe(world.name);
  });
  it("draws an economic-zone marker per zone cell when given some", () => {
    const zones = [world.cities[0].cell, world.cities[1].cell];
    const withZones = renderWorld(world, "terrain", zones);
    expect(withZones.querySelectorAll(".econ-zones .econ-zone").length).toBe(2);
    // the gold badge must not intercept the city-marker click underneath it
    expect((withZones.querySelector(".econ-zones") as SVGElement).getAttribute("style")).toContain("pointer-events:none");
    expect(svg.querySelectorAll(".econ-zone").length).toBe(0); // none without zones
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
  it("is self-contained for export: biomes muted inline, no biome legend", () => {
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.45");
    expect(svg.querySelectorAll(".biome-legend").length).toBe(0);
  });
});

describe("renderWorld culture view", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("mounts a culture layer with fills + a culture legend (not the political layer)", () => {
    const svg = renderWorld(world, "culture");
    expect(svg.getAttribute("class")).toContain("view-culture");
    expect(svg.querySelectorAll(".culture .culture-area").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".culture-legend .legend-item").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBe(0);
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.45");
  });
});
