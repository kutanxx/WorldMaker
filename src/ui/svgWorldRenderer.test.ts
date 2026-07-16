// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";
import { politicalBorders } from "../engine/borders";
import { segPath } from "./svgPaths";
import { snapOwnersToProvinces } from "./provinceLayer";

describe("renderWorld biomes", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("renders a province view: province layer, no nation labels, biomes muted", () => {
    const pv = renderWorld(world, "province");
    expect(pv.querySelectorAll(".political-slot .province").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-border").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-fill").length).toBeGreaterThan(1);
    expect(pv.querySelectorAll(".province .nation-border").length).toBe(1);      // bold country borders
    expect(pv.querySelectorAll(".province circle.province-seat").length).toBeGreaterThan(1); // a city per province
    expect(pv.querySelectorAll(".nation-labels").length).toBe(0);         // not the political view
    expect(pv.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6"); // muted like political/culture
  });
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
  it("draws coastal waterlines under the biome fills (antique figure-ground)", () => {
    // stacked, fading blue bands, and they must render before the biomes so the land half is occluded
    const paths = svg.querySelectorAll(".waterlines path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const kids = [...svg.children].map((c) => c.getAttribute("class"));
    expect(kids.indexOf("waterlines")).toBeLessThan(kids.indexOf("biomes"));
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
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6");
    expect(svg.querySelectorAll(".biome-legend").length).toBe(0);
  });
  it("snaps nation borders to province edges in political & terrain views (whole-province ownership)", () => {
    const snapped = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, world.polityOf);
    const expected = segPath(politicalBorders(world.grid, snapped));
    const cellBased = segPath(politicalBorders(world.grid, world.polityOf));
    expect(expected).not.toBe(cellBased); // provinces straddle raw polity edges, so snapping actually moves the border
    for (const view of ["political", "terrain"] as const) {
      const d = renderWorld(world, view).querySelector("path.border")?.getAttribute("d");
      expect(d).toBe(expected);
    }
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
    expect(svg.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6");
  });
});

describe("renderWorld rivers", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  it("draws the river network and named river labels", () => {
    const svg = renderWorld(world);
    expect(svg.querySelectorAll(".rivers .river").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".river-labels .river-label").length).toBeGreaterThan(0);
  });
  it("shows rivers in political and culture views too (geography is view-independent)", () => {
    for (const view of ["political", "culture"] as const) {
      const svg = renderWorld(world, view);
      expect(svg.querySelectorAll(".rivers .river").length).toBeGreaterThan(0);
    }
  });
  it("rotates river labels to follow the water's course", () => {
    const svg = renderWorld(world);
    const labels = [...svg.querySelectorAll(".river-labels .river-label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l.getAttribute("transform")).toMatch(/^rotate\(/);
  });
});

describe("renderWorld label hierarchy (cartographic conventions)", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("sets land-area labels upright + UPPERCASE, seas italic + blue", () => {
    const land = svg.querySelector(".region-land");
    expect(land).toBeTruthy();
    expect(land?.getAttribute("font-style")).toBe("normal");
    expect(land?.textContent).toBe(land?.textContent?.toUpperCase());
    const sea = svg.querySelector(".region-sea");
    if (sea) {
      expect(sea.getAttribute("font-style")).toBe("italic");
      expect(sea.getAttribute("fill")).toBe("#3f5d78");
    }
  });
  it("promotes capital labels (larger, bold) over towns (smaller, muted)", () => {
    const cap = svg.querySelector(".city-capital");
    const town = svg.querySelector(".city-town");
    expect(cap).toBeTruthy();
    expect(town).toBeTruthy();
    expect(Number(cap?.getAttribute("font-size"))).toBeGreaterThan(Number(town?.getAttribute("font-size")));
    expect(cap?.getAttribute("font-weight")).toBe("600");
    expect(town?.getAttribute("font-weight")).toBe("400");
  });
});
