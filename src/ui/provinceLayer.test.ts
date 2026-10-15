// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { provinceLayer, provinceOwners, snapOwnersToProvinces } from "./provinceLayer";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import type { Province } from "../engine/provinces";
import { simulateHistory } from "../engine/history";

// 4 cells in a row (squares), cells 0-1 = province 0, cell 2 = province 1, cell 3 = ocean (-1)
const grid = {
  count: 4,
  height: 100,
  points: [0, 0, 10, 0, 20, 0, 30, 0],
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[10, 0], [20, 0], [20, 10], [10, 10]],
    [[20, 0], [30, 0], [30, 10], [20, 10]],
    [[30, 0], [40, 0], [40, 10], [30, 10]],
  ] as number[][][],
  neighbors: [[1], [0, 2], [1, 3], [2]],
};
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  // A province carries the parts of its name beside the finished English string, exactly as a
  // region does, so the province view can be drawn in Korean (korean-names task 3).
  { id: 0, name: "the Grey Fields", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4,
    label: { pattern: "adj", kind: 4, adj: "Grey", noun: "Fields" } },
  { id: 1, name: "Iron Wastes", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5,
    label: { pattern: "attributive", kind: 5, noun: "Wastes", proper: "Iron" } },
];

describe("provinceLayer", () => {
  it("draws a border path, a tinted+titled fill per province, and a label per province", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    expect(g.getAttribute("class")).toBe("province");
    // one border path with a non-empty d
    const border = g.querySelector("path.province-border")!;
    expect(border).not.toBeNull();
    expect((border.getAttribute("d") || "").length).toBeGreaterThan(0);
    // one fill per non-ocean province, each carrying its name as a <title>
    const fills = g.querySelectorAll("path.province-fill");
    expect(fills.length).toBe(2);
    const titles = [...fills].map((f) => f.querySelector("title")?.textContent);
    expect(new Set(titles)).toEqual(new Set(["the Grey Fields", "Iron Wastes"]));
    expect(fills[0].getAttribute("data-province")).not.toBeNull();
    // a label per province, largest-first (province 0 has more cells → comes first)
    const labels = [...g.querySelectorAll("text.province-label")].map((t) => t.textContent);
    expect(labels).toEqual(["the Grey Fields", "Iron Wastes"]);
  });

  // (since 2026-10-15 a province wears its realm's colour in a step of its own — provinceTint.test; with no
  // owners given, both are the unclaimed grey, and two that touch still part at their hairline by a step)
  it("gives two touching provinces different fills, not the biome colour", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    const fills = [...g.querySelectorAll("path.province-fill")];
    const colors = fills.map((f) => f.getAttribute("fill"));
    expect(colors[0]).not.toBe(colors[1]);      // neighbouring provinces read as different regions
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/); // a tint of its own, not the biome's hex
  });

  it("draws bold nation borders when an owner array is given, and none without", () => {
    const owner = [0, 1, 1, -1]; // a nation border runs between cell 0 (nation 0) and cell 1 (nation 1)
    const withOwner = provinceLayer(grid, provinceOf, provinces, { owner });
    const nb = withOwner.querySelector("path.nation-border");
    expect(nb).not.toBeNull();
    expect((nb!.getAttribute("d") || "").length).toBeGreaterThan(0);
    expect(provinceLayer(grid, provinceOf, provinces).querySelector("path.nation-border")).toBeNull();
  });

  it("snaps each province to its majority-owner nation (ties → lower id, unclaimed → -1)", () => {
    // province 0 = cells 0,1 (owners 0 and 1 → tie → lower id 0); province 1 = cell 2 (owner 1)
    expect(provinceOwners(provinceOf, provinces, [0, 1, 1, -1])).toEqual([0, 1]);
    // an all-unclaimed province resolves to -1 (no nation)
    expect(provinceOwners(provinceOf, provinces, [-1, -1, 3, -1])).toEqual([-1, 3]);
  });

  it("snapOwnersToProvinces maps every cell to its province's majority owner (ocean stays -1)", () => {
    // province 0 = cells 0,1 (owners 0,1 → tie → lower id 0); province 1 = cell 2 (owner 1); cell 3 = ocean
    const snapped = snapOwnersToProvinces(4, provinceOf, provinces, [0, 1, 1, -1]);
    expect([...snapped]).toEqual([0, 0, 1, -1]);
  });

  it("places a settlement seat dot at each province", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    expect(g.querySelectorAll("circle.province-seat").length).toBe(2); // one per province
  });

  it("skips ocean cells (province -1 contributes no fill)", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    // total fill paths equal province count (2), never 3 — the ocean cell is not its own fill
    expect(g.querySelectorAll("path.province-fill").length).toBe(2);
  });
});

// Zoom on this map rewrites the viewBox, so a stroke without `non-scaling-stroke` is drawn at its
// width TIMES the zoom. Every other line here carries it -- coastline, national border, culture
// seam, rivers -- and this layer carried it nowhere: measured at 7.53x, the province mesh went from
// 1.1 to 8.3 screen pixels and the country outline from 2 to 15, a black smear beside a coastline
// still holding 2.4. The seats are deliberately not in this: they are marks, scaled about their own
// centre by applyMarkerScale, and are meant to grow a little with the zoom the way every other
// settlement mark does.
describe("the province view's lines hold their width", () => {
  it("draws both borders at a width rather than at a width times the zoom", () => {
    const g = provinceLayer(grid, provinceOf, provinces, { owner: [0, 0, 1, -1] });
    for (const sel of [".province-border", ".nation-border"]) {
      const path = g.querySelector(sel);
      expect(path, sel).not.toBeNull();
      expect(path!.getAttribute("vector-effect"), sel).toBe("non-scaling-stroke");
    }
  });
});

// (The hue-per-province rules that stood here — twelve hues dealt against the adjacency, the whole wheel
// spent — went with the hues on 2026-10-15: a province wears its realm's colour now, and two that touch
// within one realm part by a lightness step. provinceTint.test holds that rule, over every touching pair.)

// A free city holds five cells and a province is far bigger, so snapping ownership to whole
// provinces — which is what makes political borders fall on province edges — erased every free city
// from the map. Measured on seed 1 at year 500: all four free realms still held their own seats in
// the simulation and said so in the gazetteer, while the map and the city list showed the empire
// around them. The map, the list and the document gave two different answers to "who holds this
// town", and the free-city markers the layer already draws never appeared, because their anchor was
// computed from the very array that had erased them.
describe("an enclave smaller than a province survives the snap", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const history = simulateHistory(world, 1);
  const last = history.snapshots[history.snapshots.length - 1];
  const free = history.polities.filter((p) => p.free);

  it("has free cities holding ground at the end, or the claim below is untested", () => {
    expect(free.length).toBeGreaterThan(0);
    for (const p of free) expect(last.owner[p.capital], `${p.name} lost its own seat`).toBe(p.id);
  });

  it("loses them without `keep`, and keeps them with it", () => {
    const plain = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, last.owner);
    const kept = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, last.owner,
                                       new Set(free.map((p) => p.id)));
    for (const p of free) {
      expect(plain[p.capital], `${p.name} should be swallowed without keep`).not.toBe(p.id);
      expect(kept[p.capital], `${p.name} should survive with keep`).toBe(p.id);
    }
  });

  it("leaves every other cell exactly where the snap put it", () => {
    const freeIds = new Set(free.map((p) => p.id));
    const plain = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, last.owner);
    const kept = snapOwnersToProvinces(world.grid.count, world.provinceOf, world.provinces, last.owner, freeIds);
    let moved = 0;
    for (let c = 0; c < world.grid.count; c++) {
      if (plain[c] !== kept[c]) {
        expect(freeIds.has(kept[c]), `cell ${c} changed owner and is not a free city`).toBe(true);
        moved++;
      }
    }
    // small, and no larger than the ground those realms actually hold
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(free.reduce((n, p) => n + [...last.owner].filter((o) => o === p.id).length, 0));
  });
});
