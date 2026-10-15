// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { DEFAULT_PARAMS } from "../types/world";
import { provinceLayer, provinceOwners, PROVINCE_STEPS, PROVINCE_FILL_OPACITY, UNCLAIMED_COLOUR } from "./provinceLayer";
import { lighter } from "./colour";
import { nationColor } from "./nationPalette";

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
const h = simulateHistory(world, 1);
const owner0 = h.snapshots[0].owner;
const colorOf = (id: number) => nationColor(id);

// ★ The province view painted every province a random pastel — fifty pieces of lilac, mint and pink at
// 0.7 — and read as a data-visualization demo beside the atlas's other views (design review 2026-10-15,
// item 9). A province takes its REALM's colour now, the colour the political view paints it, a step
// lighter than its neighbours of the same realm: the view reads as realms made of provinces, and a reader
// switching from the realms' view meets the same colours.
describe("a province is painted in its realm's colour", () => {
  const layer = () => provinceLayer(world.grid, world.provinceOf, world.provinces, { owner: owner0, colorOf });
  const fills = (g: Element) => new Map([...g.querySelectorAll<SVGPathElement>(".province-fill")].map((p) => [Number(p.getAttribute("data-province")), p]));

  it("takes the realm's colour in one of the steps, at the political view's opacity", () => {
    const owners = provinceOwners(world.provinceOf, world.provinces, owner0);
    let claimed = 0, unclaimed = 0;
    for (const [id, p] of fills(layer())) {
      const o = owners[id];
      const base = o >= 0 ? colorOf(o) : UNCLAIMED_COLOUR;
      const steps = PROVINCE_STEPS.map((k) => lighter(base, k));
      expect(steps, `province ${id} (realm ${o}) wears ${p.getAttribute("fill")}`).toContain(p.getAttribute("fill"));
      expect(p.getAttribute("fill-opacity")).toBe(String(PROVINCE_FILL_OPACITY));
      if (o >= 0) claimed++; else unclaimed++;
    }
    expect(claimed).toBeGreaterThan(10);
    expect(unclaimed, "world 1 at year 0 has unclaimed provinces, which should be grey").toBeGreaterThan(0);
  });

  it("gives two touching provinces of one realm different steps", () => {
    const owners = provinceOwners(world.provinceOf, world.provinces, owner0);
    const g = layer();
    const fill = new Map([...fills(g)].map(([id, p]) => [id, p.getAttribute("fill")!]));
    // neighbours: two provinces with adjacent cells
    const pairs = new Set<string>();
    const grid = world.grid;
    for (let c = 0; c < grid.count; c++) {
      const a = world.provinceOf[c];
      if (a < 0) continue;
      for (const n of grid.neighbors[c]) {
        const b = world.provinceOf[n];
        if (b < 0 || b === a) continue;
        pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    }
    let same = 0, alike = 0;
    for (const key of pairs) {
      const [a, b] = key.split(":").map(Number);
      if (owners[a] !== owners[b]) continue;
      same++;
      if (fill.get(a) === fill.get(b)) alike++;
    }
    expect(same, "no two touching provinces share a realm").toBeGreaterThan(20);
    expect(alike, `${alike} of ${same} touching pairs of one realm wear the same step`).toBe(0);
  });

  it("paints every province grey when it is given no owners", () => {
    const g = provinceLayer(world.grid, world.provinceOf, world.provinces);
    const greys = PROVINCE_STEPS.map((k) => lighter(UNCLAIMED_COLOUR, k));
    for (const [, p] of fills(g)) expect(greys).toContain(p.getAttribute("fill"));
  });

  // a hundred names at 7 units were a thicket (83 on screen at 8.6px); the larger quarter of the provinces
  // are named at rest, and the rest arrive as the reader leans in (deconflict.ts tiers)
  it("names the larger provinces at rest and holds the rest for a zoom", () => {
    const g = layer();
    const n = world.provinces.length;
    const major = g.querySelectorAll(".province-label.province-major").length;
    const all = g.querySelectorAll(".province-label").length;
    expect(all).toBe(n);
    expect(major).toBe(Math.min(n, Math.max(12, Math.ceil(n / 4))));
    // the major ones are the largest
    const cells = (el: Element) => world.provinces[Number(el.getAttribute("data-name")!.slice(1))].cells;
    const majors = [...g.querySelectorAll(".province-label.province-major")].map(cells);
    const minors = [...g.querySelectorAll(".province-label:not(.province-major)")].map(cells);
    expect(Math.min(...majors)).toBeGreaterThanOrEqual(Math.max(...minors));
  });
});
