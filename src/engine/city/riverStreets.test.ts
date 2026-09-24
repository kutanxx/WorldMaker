import { describe, it, expect } from "vitest";
import type { Point, Polygon } from "../geometry";
import type { StreetGraph } from "./blockStreets";
import type { Water } from "./water";
import { inWater } from "./water";
import { streetsOverWater, squareCrossing } from "./riverStreets";

// a river 22 wide running north-south through the middle of a town 200 across
const river: Water = { kind: "river", bodies: [[[100, -50], [122, -50], [122, 250], [100, 250]]], bridges: [] };
const town: Polygon = [[0, 0], [200, 0], [200, 200], [0, 200]];
const graphOf = (segs: [Point, Point][]): StreetGraph => {
  const nodes: Point[] = [];
  const at = (p: Point) => { let i = nodes.findIndex((q) => q[0] === p[0] && q[1] === p[1]); if (i < 0) { i = nodes.length; nodes.push(p); } return i; };
  const edges = segs.map(([a, b]) => [at(a), at(b)] as [number, number]);
  return { nodes, edges, segments: segs.map(([a, b]) => [a, b]) };
};
const dryEverywhere = (g: StreetGraph) => g.edges.every(([i, j]) => {
  const a = g.nodes[i], b = g.nodes[j];
  for (let k = 0; k <= 40; k++) if (inWater(river, [a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40])) return false;
  return true;
});

describe("squareCrossing", () => {
  it("takes a street straight over the river and refuses one along it or aslant", () => {
    expect(squareCrossing([80, 100], [140, 100], river)).toBe(true);    // square
    expect(squareCrossing([80, 100], [140, 130], river)).toBe(true);    // 27 degrees off square
    expect(squareCrossing([80, 60], [140, 150], river)).toBe(false);    // 56 degrees off: aslant
    expect(squareCrossing([105, 20], [115, 180], river)).toBe(false);   // down the channel
    expect(squareCrossing([80, 100], [110, 100], river)).toBe(false);   // ends in the water
  });
});

describe("streetsOverWater", () => {
  it("drops a street that runs in the water and stops one that meets it at the bank", () => {
    const g = graphOf([[[105, 20], [115, 180]], [[40, 60], [111, 60]], [[20, 20], [60, 20]]]);
    const { graph, stubs } = streetsOverWater(g, river, town, false);
    expect(graph.edges.length).toBe(1);                 // only the dry street is left as a street
    expect(stubs.length).toBe(1);                       // the one that met the river, cut back
    expect(inWater(river, stubs[0][1])).toBe(false);    // ...to dry ground, not a hair into the water
    expect(stubs[0][1][0]).toBeGreaterThan(95);         // ...at the bank
  });

  it("joins the two banks it cut apart with one square crossing", () => {
    // two streets on each bank, and three ways across: square, aslant, and a pair of bank ends
    const west: [Point, Point][] = [[[20, 40], [85, 40]], [[20, 160], [85, 160]], [[85, 40], [85, 160]]];
    const east: [Point, Point][] = [[[137, 40], [180, 40]], [[137, 160], [180, 160]], [[137, 40], [137, 160]]];
    const g = graphOf([...west, ...east, [[85, 40], [137, 150]]]);
    const { graph } = streetsOverWater(g, river, town, true);
    const crossings = graph.edges.filter(([i, j]) => (graph.nodes[i][0] < 100) !== (graph.nodes[j][0] < 100));
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    for (const [i, j] of crossings) expect(squareCrossing(graph.nodes[i], graph.nodes[j], river)).toBe(true);
    // and nothing it kept runs in the water except those crossings
    expect(dryEverywhere({ ...graph, edges: graph.edges.filter((e) => !crossings.includes(e)) })).toBe(true);
  });

  it("leaves a town with no water exactly as it was", () => {
    const g = graphOf([[[20, 20], [60, 20]], [[60, 20], [60, 80]]]);
    const out = streetsOverWater(g, { kind: "none", bodies: [], bridges: [] }, town, true);
    expect(out.graph).toBe(g);
    expect(out.stubs).toEqual([]);
  });
});
