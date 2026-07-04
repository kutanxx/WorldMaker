// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import { GRASSLAND } from "../engine/biome";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.4, biome: 4,
};

describe("renderCity organic", () => {
  it("clips content to the boundary and draws wall segments + roads + buildings", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
    expect(svg.querySelectorAll(".boundary").length).toBe(1);
    expect(svg.querySelectorAll(".wall-seg").length).toBe(layout.wall ? layout.wall.segments.length : 0);
    expect(svg.querySelectorAll(".road-main").length).toBe(layout.mainRoads.length);
    expect(svg.querySelectorAll(".road-minor").length).toBe(layout.minorRoads.length);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(0);
  });
  it("colour-codes districts: buildings take several distinct hues + a district legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    const fills = new Set([...svg.querySelectorAll(".building")].map((b) => (b.getAttribute("fill") || "").toLowerCase()));
    expect(fills.size).toBeGreaterThan(2); // districts read apart, not one cream mass
    const legend = [...svg.querySelectorAll(".legend text")].map((t) => t.textContent);
    expect(legend).toContain("Slums"); // the legend names the districts, not just "Buildings"
  });
  it("puts the district legend in a right-hand strip outside the map (never covering the city)", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    const vbW = Number((svg.getAttribute("viewBox") || "0 0 0 0").split(" ")[2]);
    expect(vbW).toBeGreaterThan(layout.bounds.w); // widened by a legend strip
    // every legend swatch sits at x >= the map width (in the strip, not over the city)
    const swatches = [...svg.querySelectorAll(".legend .legend-item")];
    expect(swatches.length).toBeGreaterThan(0);
    for (const s of swatches) expect(Number(s.getAttribute("x"))).toBeGreaterThanOrEqual(layout.bounds.w);
  });
  it("tints the ground and uses timber walls for a forest city", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelector(".boundary")?.getAttribute("fill")).toBe("#e3e7d0");
    expect(svg.querySelector(".wall-seg")?.getAttribute("stroke")).toBe("#6b4f34");
  });
  it("draws a tree glyph per forest tree", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".tree").length).toBe(layout.features.trees.length);
    expect(svg.querySelectorAll(".tree").length).toBeGreaterThan(0);
  });
  it("draws palms around a desert oasis", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 5 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.oasis).not.toBeNull();
    expect(svg.querySelectorAll(".palm").length).toBeGreaterThan(0);
  });
  it("draws stilts under marsh buildings", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 7 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.onStilts).toBe(true);
    expect(svg.querySelectorAll(".stilt").length).toBeGreaterThan(0);
  });
  it("draws extramural suburbs outside the boundary clip", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    const svg = renderCity(layout);
    const env = svg.querySelector(".environs");
    expect(env).not.toBeNull();
    expect(env!.closest("[clip-path]")).toBeNull(); // NOT inside the boundary clip
    expect(svg.querySelectorAll(".environs .suburb").length).toBe(layout.suburbs.length);
    expect(svg.querySelectorAll(".environs .suburb-road").length).toBe(layout.suburbRoads.length);
    expect(svg.querySelectorAll(".environs .outwork").length).toBe(layout.outworks.length);
  });
  it("renders mountain masses with cliffs + hachures for a mountain city (none for plains)", () => {
    let mtn = null;
    for (let s = 1; s <= 40 && !mtn; s++) {
      const l = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.9, biome: 4 }), s);
      if (l.mountains.length > 0) mtn = l;
    }
    expect(mtn).not.toBeNull();
    const svg = renderCity(mtn!);
    expect(svg.querySelectorAll(".mountains .mountain").length).toBe(mtn!.mountains.length);
    expect(svg.querySelectorAll(".mountains .cliff").length).toBe(mtn!.mountains.length);
    expect(svg.querySelectorAll(".mountains .hachure").length).toBeGreaterThan(0);

    const plains = renderCity(generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.4, biome: 4 }), 9));
    expect(plains.querySelectorAll(".mountains").length).toBe(0);
  });
  it("renders a harbor (breakwater, lighthouse, piers, boats) for a coastal city; none inland", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: true }), 5);
    expect(layout.harbor).not.toBeNull();
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".harbor .breakwater").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .quay").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .lighthouse").length).toBe(1);
    expect(svg.querySelectorAll(".harbor .pier").length).toBe(layout.harbor!.piers.length);
    expect(svg.querySelectorAll(".harbor .boat").length).toBe(layout.harbor!.boats.length);

    const inland = renderCity(generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.4, biome: 4 }), 9));
    expect(inland.querySelectorAll(".harbor").length).toBe(0);
  });
  it("renders the countryside in the unclipped environs layer", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    const env = svg.querySelector(".environs")!;
    expect(env.getAttribute("clip-path")).toBeNull();
    expect(env.querySelectorAll(".field").length).toBe(layout.countryside.fields.length);
    expect(env.querySelectorAll(".pasture").length).toBe(layout.countryside.pastures.length);
    expect(env.querySelectorAll(".farm-barn").length).toBe(layout.countryside.farmsteads.length);
    expect(env.querySelectorAll(".wood-tree").length).toBe(layout.countryside.woods.length);
  });
  it("draws the castle inner wall, towers and keep", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelector(".castle-wall")).not.toBeNull();
    expect(svg.querySelector(".castle-keep")).not.toBeNull();
    expect(svg.querySelectorAll(".castle-tower").length).toBe(layout.castle!.towers.length);
  });
});
