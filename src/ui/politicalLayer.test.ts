// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { politicalLayer } from "./politicalLayer";
import { nationColor } from "./nationPalette";

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
    expect(first.getAttribute("fill-opacity")).toBe("0.8");
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

  it("with legend adds a nation legend", () => {
    const g = politicalLayer(world.grid, owner0, h.polities, { legend: true });
    expect(g.querySelectorAll(".nation-legend").length).toBe(1);
    expect(g.querySelectorAll(".nation-legend .legend-item").length).toBeGreaterThan(0);
  });

  it("reflects a later snapshot differently once borders have shifted", () => {
    const a = politicalLayer(world.grid, owner0, h.polities, { fills: true });
    const b = politicalLayer(world.grid, h.snapshots[h.snapshots.length - 1].owner, h.polities, { fills: true });
    expect(dstr(a)).not.toBe(dstr(b));
  });
});
