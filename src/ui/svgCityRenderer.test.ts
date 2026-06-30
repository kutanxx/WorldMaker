// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.4,
};

describe("renderCity v3", () => {
  it("draws water, main and minor roads, buildings, and a legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".water").length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll(".road-main").length).toBe(layout.mainRoads.length);
    expect(svg.querySelectorAll(".road-minor").length).toBe(layout.minorRoads.length);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".legend-item").length).toBeGreaterThan(0);
  });
});
