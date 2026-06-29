// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: true,
};

describe("renderCity", () => {
  it("draws wall, river, and districts", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".wall").length).toBe(1);
    expect(svg.querySelectorAll(".river").length).toBe(1);
    expect(svg.querySelectorAll(".district").length).toBe(layout.districts.length);
  });
});
