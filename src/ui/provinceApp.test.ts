// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountProvinceApp, provinceCellOwner } from "./provinceApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "../engine/provinceSim";

describe("provinceCellOwner", () => {
  it("maps each cell to its province's owner, ocean/unowned to -1", () => {
    const provinceOf = [0, 0, 1, -1];
    const provOwner = Int32Array.from([5, 2]); // prov 0 → nation 5, prov 1 → nation 2
    expect(Array.from(provinceCellOwner(4, provinceOf, provOwner))).toEqual([5, 5, 2, -1]);
  });
});

describe("mountProvinceApp (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("renders the province map: a framed svg with owner-colored polity paths and a nation border", () => {
    mountProvinceApp(root, { seed: 1 });
    const svg = root.querySelector("svg") as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 700"); // grid.width x grid.height (DEFAULT_PARAMS)
    // politicalLayer emits one path per owning polity, tagged data-polity
    expect(root.querySelectorAll("[data-polity]").length).toBeGreaterThan(0);
    // and the snapped nation border overlay is present
    expect(root.querySelector(".nation-border")).toBeTruthy();
  });

  it("does not mutate the world's province objects (read-only aliasing guard)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const before = world.provinces[0].cells;
    const s = initProvinceSim(world);
    provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);
    expect(world.provinces[0].cells).toBe(before);
  });
});
