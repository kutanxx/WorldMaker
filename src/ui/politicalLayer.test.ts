// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { politicalLayer, keepOffOf, type KeepOff } from "./politicalLayer";
import { nationColor } from "./nationPalette";
import type { Point } from "../engine/geometry";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
const { world } = generateWorld({ ...small, seed: 1 });
const h = simulateHistory(world, 1);
const owner0 = h.snapshots[0].owner;
const dstr = (g: SVGGElement) =>
  Array.from(g.querySelectorAll("path.territory")).map((p) => p.getAttribute("d")).join("|");

describe("politicalLayer", () => {
  it("default draws only borders (no territory fills)", () => {
    const g = politicalLayer(world.grid, owner0, h.polities);
    expect(g.querySelectorAll("path.border").length).toBe(1);
    expect(g.querySelectorAll("path.territory").length).toBe(0);
  });

  it("with fills draws one nation-colored territory per present polity", () => {
    const g = politicalLayer(world.grid, owner0, h.polities, { fills: true });
    const present = new Set<number>();
    for (let i = 0; i < world.grid.count; i++) if (owner0[i] >= 0) present.add(owner0[i]);
    expect(g.querySelectorAll("path.territory").length).toBe(present.size);
    const first = g.querySelector("path.territory") as SVGElement;
    const id = Number(first.getAttribute("data-polity"));
    expect(first.getAttribute("fill")).toBe(nationColor(id));
    expect(first.getAttribute("fill-opacity")).toBe("0.58");
  });

  it("with labels adds nation labels, skipping tiny nations and capping at present count", () => {
    const g = politicalLayer(world.grid, owner0, h.polities, { labels: true });
    const labels = g.querySelectorAll(".nation-label");
    const present = new Set<number>();
    for (let i = 0; i < world.grid.count; i++) if (owner0[i] >= 0) present.add(owner0[i]);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(present.size);
    expect((labels[0] as SVGElement).textContent).toBeTruthy();
  });

  it("renders free (independent) polities in neutral grey, not a nation colour", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    // claim two cells: one normal polity (id 0), one free polity (id 1)
    owner[0] = 0; owner[1] = 1;
    const polities = [{ id: 0, name: "Realm", free: false }, { id: 1, name: "Freeport", free: true }];
    const g = politicalLayer(world.grid, owner, polities, { fills: true });
    const free = g.querySelector('path.territory[data-polity="1"]') as SVGElement;
    const normal = g.querySelector('path.territory[data-polity="0"]') as SVGElement;
    expect(free.getAttribute("fill")).toBe("#b7b1a4");
    expect(free.classList.contains("free-city")).toBe(true);
    expect(normal.getAttribute("fill")).not.toBe("#b7b1a4");
  });
  it("marks free cities with a civic banner + name so they don't read as blank grey patches", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    owner[0] = 0; owner[1] = 1;
    const polities = [{ id: 0, name: "Realm", free: false }, { id: 1, name: "Freeport", free: true }];
    const g = politicalLayer(world.grid, owner, polities, { fills: true });
    const markers = g.querySelector(".free-city-markers")!;
    expect(markers).not.toBeNull();
    expect((markers as SVGElement).style.pointerEvents).toBe("none"); // never blocks city drilldown
    expect(g.querySelectorAll(".free-city-markers .free-city-dot").length).toBe(1); // one per free polity
    expect(g.querySelectorAll(".free-city-markers .free-city-banner").length).toBe(1);
    const label = g.querySelector(".free-city-markers .free-city-label") as SVGElement;
    expect(label.textContent).toBe("Freeport");
  });
  // The political view is about the realms, and a realm's name was the smallest, faintest word on it: 11 units
  // (10.5px at 1440x900) under region names of 10.5-20 and a capital's 10 in bold, with a 2.5 halo the roads
  // crossed through (design review 2026-10-15, item 3). It stands above them now: 13 units, a 3.5 halo.
  it("sets a realm's name above a region's and a capital's: 13 units on a 3.5 halo", () => {
    const owner = new Int32Array(world.grid.count).fill(0);
    const g = politicalLayer(world.grid, owner, [{ id: 0, name: "Realm" }], { labels: true });
    const label = g.querySelector(".nation-label")!;
    expect(Number(label.getAttribute("font-size"))).toBe(13);
    expect(Number(label.getAttribute("stroke-width"))).toBe(3.5);
  });
  // the name under the banner is in italic, a Latin device; a Korean map's face has no italic, and slanted
  // Hangul is the browser's own smear (design review 2026-10-15, item 6)
  it("sets a free city's name upright on a Korean map", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    owner[0] = 0; owner[1] = 1;
    const polities = [{ id: 0, name: "Realm", free: false }, { id: 1, name: "Freeport", free: true }];
    const en = politicalLayer(world.grid, owner, polities, { fills: true }).querySelector(".free-city-label")!;
    const ko = politicalLayer(world.grid, owner, polities, { fills: true, lang: "ko" }).querySelector(".free-city-label")!;
    expect(en.getAttribute("font-style")).toBe("italic");
    expect(ko.getAttribute("font-style") ?? "normal").toBe("normal");
  });
  it("omits free-city markers when there are no fills (terrain view)", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    owner[0] = 0; owner[1] = 1;
    const polities = [{ id: 0, name: "Realm", free: false }, { id: 1, name: "Freeport", free: true }];
    const g = politicalLayer(world.grid, owner, polities, {});
    expect(g.querySelectorAll(".free-city-markers").length).toBe(0);
  });
  it("with legend adds a nation legend", () => {
    const g = politicalLayer(world.grid, owner0, h.polities, { legend: true });
    expect(g.querySelectorAll(".nation-legend").length).toBe(1);
    expect(g.querySelectorAll(".nation-legend .legend-item").length).toBeGreaterThan(0);
  });

  // Restated: there is no "player" realm any more — the game that had one is gone — so what this
  // pins is that every realm is drawn the same way, in its palette colour under a plain label.
  it("draws every realm the same way, in its own colour under a plain label", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const g = politicalLayer(world.grid, owner, [{ id: 0, name: "Mine", free: false }], { fills: true, labels: true });
    const terr = g.querySelector('path.territory[data-polity="0"]') as SVGElement;
    expect(terr.getAttribute("fill")).toBe(nationColor(0));
    expect(terr.getAttribute("fill-opacity")).toBe("0.58");
    const label = g.querySelector(".nation-label") as SVGElement;
    expect(label.textContent).toBe("Mine");
    expect(label.getAttribute("fill")).toBe("#2a2118");
  });

  it("reflects a later snapshot differently once borders have shifted", () => {
    const a = politicalLayer(world.grid, owner0, h.polities, { fills: true });
    const b = politicalLayer(world.grid, h.snapshots[h.snapshots.length - 1].owner, h.polities, { fills: true });
    expect(dstr(a)).not.toBe(dstr(b));
  });

  // M6: `nameOf` guarded `undefined` but not `""`. With a government form in hand, `labelOf(id, "")`
  // returns a truthy suffix — " 왕국" — with nothing in front of it, so the `if (name)` map-label
  // guard and the `.filter(([id]) => nameOf(id))` legend guard would both let a nameless realm
  // through and draw a bare "왕국" where nothing should be drawn at all.
  it("draws no label or legend row for a realm with no name, even when the labeller would suffix it", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const suffixEvenEmpty = (_id: number, name: string) => `${name} 왕국`;
    const g = politicalLayer(world.grid, owner, [{ id: 0, name: "", free: false }],
      { fills: true, labels: true, legend: true, labelOf: suffixEvenEmpty });
    expect(g.querySelectorAll(".nation-label").length).toBe(0);
    expect(g.querySelectorAll(".nation-legend .legend-item").length).toBe(0);
  });
});

// The fills and the legend each called `nationColor(id)` directly, so there was no way to give the
// map a colouring that knows which realms border which. Both now read `colorOf`, and they must read
// the SAME one — a legend swatch that disagrees with the territory it is a key to is worse than no
// legend.
describe("politicalLayer takes the colouring it is given", () => {
  const grid = {
    count: 4, width: 100, height: 100,
    polygons: [[[0,0],[1,0],[1,1]], [[2,0],[3,0],[3,1]], [[4,0],[5,0],[5,1]], [[6,0],[7,0],[7,1]]],
    neighbors: [[1],[0,2],[1,3],[2]],
    points: [0,0, 2,0, 4,0, 6,0],
  };
  const owner = [0, 1, 2, 0];
  const polities = [{ id: 0, name: "A" }, { id: 1, name: "B" }, { id: 2, name: "C" }];
  const opts = { fills: true, legend: true, legendTitle: "Realms" };

  it("paints the territories in the given colours, not the id-indexed ones", () => {
    const colorOf = (id: number) => ["#111111", "#222222", "#333333"][id];
    const g = politicalLayer(grid, owner, polities, { ...opts, colorOf });
    const fills = [...g.querySelectorAll("path.territory")].map((p) => p.getAttribute("fill"));
    expect(fills.sort()).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("keys the legend with the same colours it painted", () => {
    const colorOf = (id: number) => ["#111111", "#222222", "#333333"][id];
    const g = politicalLayer(grid, owner, polities, { ...opts, colorOf });
    const swatches = [...g.querySelectorAll("rect.legend-item")].map((r) => r.getAttribute("fill"));
    const fills = [...g.querySelectorAll("path.territory")].map((p) => p.getAttribute("fill"));
    for (const s of swatches) expect(fills).toContain(s);
    expect(swatches.length).toBeGreaterThan(0);
  });

  it("falls back to the id-indexed palette when given no colouring", () => {
    const g = politicalLayer(grid, owner, polities, opts);
    const fills = [...g.querySelectorAll("path.territory")].map((p) => p.getAttribute("fill"));
    expect(fills).toContain(nationColor(0));
  });
});

// A realm's name stood at its realm's centroid, where the roads between the capitals run: measured on world 1's
// political view at 1440x900, a road crossed 7 of the 8 names, 5 of 8 on world 12 (design review 2026-10-15,
// item 3). Given the roads and the towns, the name steps a line up or down, up to two, to where the fewest roads
// cross it and no town stands under it — and stays at the centroid where no step is better.
describe("a realm's name keeps off the roads", () => {
  const one = new Int32Array(world.grid.count).fill(0);   // one realm: its name at the land's centroid
  const at = (keepOff?: KeepOff): [number, number] => {
    const t = politicalLayer(world.grid, one, [{ id: 0, name: "Realm" }], { labels: true, keepOff }).querySelector(".nation-label")!;
    return [Number(t.getAttribute("x")), Number(t.getAttribute("y"))];
  };
  const [cx, cy] = at();

  it("stands at its realm's centroid when nothing crosses it", () => {
    expect(at({ roads: [[[0, 0], [1, 0]]], towns: [] })).toEqual([cx, cy]);
  });

  it("steps one line up off a road that runs through it", () => {
    const [x, y] = at({ roads: [[[cx - 100, cy], [cx + 100, cy]]], towns: [] });
    expect(x).toBe(cx);
    expect(y, "the name did not move off the road").toBe(cy - 13);
  });

  it("steps the other way when a town stands where it would go", () => {
    const [, y] = at({ roads: [[[cx - 100, cy], [cx + 100, cy]]], towns: [[cx, cy - 13]] });
    expect(y).toBe(cy + 13);
  });

  it("stays put where every step is as crossed", () => {
    expect(at({ roads: [[[cx, cy - 100], [cx, cy + 100]]], towns: [] })[1]).toBe(cy);
  });

  it("is told the roads and the towns in map units", () => {
    const keep = keepOffOf([10, 20, 30, 40, 50, 60], [{ cells: [0, 2] }], [{ x: 7, y: 8 }]);
    expect(keep.roads).toEqual([[[10, 20], [50, 60]]]);
    expect(keep.towns).toEqual([[7, 8]]);
  });
});

// a square lattice of n x n cells, `cell` units across: a grid whose cells stand exactly where its points say
function lattice(n: number, cell: number) {
  const count = n * n, points: number[] = new Array(count * 2).fill(0), polygons: number[][][] = [], neighbors: number[][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = i * cell, y = j * cell;
    points[k * 2] = x + cell / 2; points[k * 2 + 1] = y + cell / 2;
    polygons.push([[x, y], [x + cell, y], [x + cell, y + cell], [x, y + cell]]);
    const nb: number[] = [];
    if (i > 0) nb.push(k - 1); if (i < n - 1) nb.push(k + 1); if (j > 0) nb.push(k - n); if (j < n - 1) nb.push(k + n);
    neighbors.push(nb);
  }
  return { count, points, polygons, neighbors, width: n * cell, height: n * cell };
}

// ...and on its own realm. A step that clears the road but stands the name on the sea or on a neighbour is worse
// than the road: a reviewer's probe over six worlds found 23 of 245 moved names with their middle off their realm,
// two of them on the sea in year 0 (2026-10-15). A line whose middle stands in another's cell costs more than any
// road — and the name steps one line, not two.
describe("a realm's name stays on its realm", () => {
  const grid = lattice(40, 5);                                     // 200 x 200, cells 5 across
  // one realm: the cells whose middles the predicate takes; a band is the rows between y0 and y1
  const owned = (take: (x: number, y: number) => boolean) => {
    const owner = new Int32Array(grid.count).fill(-1);
    for (let k = 0; k < grid.count; k++) if (take(grid.points[k * 2], grid.points[k * 2 + 1])) owner[k] = 0;
    return owner;
  };
  const band = (y0: number, y1: number) => owned((_, y) => y > y0 && y < y1);
  const at = (owner: Int32Array, roads: Point[][]): [number, number] => {
    const t = politicalLayer(grid, owner, [{ id: 0, name: "Realm" }], { labels: true, keepOff: { roads, towns: [] } }).querySelector(".nation-label")!;
    return [Number(t.getAttribute("x")), Number(t.getAttribute("y"))];
  };
  const across = (y: number): Point[][] => [[[0, y], [200, y]]];
  // (the name's anchor is the realm's cell nearest its centroid — nationPalette.ts — so it is read, not assumed)

  it("steps onto its own land, not off it, to clear a road", () => {
    // the realm: the rows 50..75 across, and a tongue of two more rows (75..85) three cells wide under its
    // middle — so one line below its name's line is its own land, and one line above is the sea
    const owner = owned((x, y) => (y > 50 && y < 75) || (y > 75 && y < 85 && x > 90 && x < 105));
    const [cx, cy] = at(owner, []);
    expect([cx, cy]).toEqual([97.5, 62.5]);
    expect(at(owner, across(cy))).toEqual([cx, cy + 13]);
  });

  it("stays on the road where no line of its own realm is clear of it", () => {
    const owner = band(55, 65), [cx, cy] = at(owner, []);   // two rows: a line up or down stands the middle off them
    expect(at(owner, across(cy))).toEqual([cx, cy]);
  });

  it("steps one line at most", () => {
    // ten rows of realm, and roads along the name's line and one line above and below it: a second line would be
    // clear, and is not taken
    const owner = band(40, 90), [cx, cy] = at(owner, []);
    expect(at(owner, [...across(cy), ...across(cy - 13), ...across(cy + 13)])).toEqual([cx, cy]);
  });
});
