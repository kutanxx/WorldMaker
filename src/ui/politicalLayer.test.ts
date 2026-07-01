// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { politicalLayer } from "./politicalLayer";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
const { world } = generateWorld({ ...small, seed: 1 });
const h = simulateHistory(world, 1);
const dstr = (g: SVGGElement) =>
  Array.from(g.querySelectorAll("path.territory")).map((p) => p.getAttribute("d")).join("|");

describe("politicalLayer", () => {
  it("draws one territory path per present polity plus one border path", () => {
    const g = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const present = new Set<number>();
    for (let i = 0; i < world.grid.count; i++) {
      const o = h.snapshots[0].owner[i];
      if (o >= 0) present.add(o);
    }
    expect(g.querySelectorAll("path.territory").length).toBe(present.size);
    expect(g.querySelectorAll("path.border").length).toBe(1);
  });
  it("colors each territory from the polity palette", () => {
    const g = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const first = g.querySelector("path.territory") as SVGElement;
    const id = Number(first.getAttribute("data-polity"));
    expect(first.getAttribute("fill")).toBe(h.polities[id].color);
    expect(first.getAttribute("fill-opacity")).toBe("0.33");
  });
  it("reflects a later snapshot differently once borders have shifted", () => {
    const a = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const b = politicalLayer(world.grid, h.snapshots[h.snapshots.length - 1].owner, h.polities);
    expect(dstr(a)).not.toBe(dstr(b));
  });
});
