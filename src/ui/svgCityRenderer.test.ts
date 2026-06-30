// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.5,
};

describe("renderCity v2", () => {
  it("draws a closed wall, many buildings, water, and a legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".wall").length).toBe(1);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(20);
    expect(svg.querySelectorAll(".water").length).toBe(1);
    expect(svg.querySelectorAll(".legend-item").length).toBeGreaterThan(2);
  });
  it("renders ward groups for every ward", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".ward").length).toBe(layout.wards.length);
  });
});
