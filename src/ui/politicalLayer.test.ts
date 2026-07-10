// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { politicalLayer } from "./politicalLayer";
import { nationColor, PLAYER_COLOR, PLAYER_LABEL_COLOR } from "./nationPalette";

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

  it("draws the player's nation in the reserved player color with a ♛-marked bold label", () => {
    // player owns 30 cells (>=25) so its label renders; a single polity keeps the fixture simple
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const polities = [{ id: 0, name: "Mine", free: false }];
    const g = politicalLayer(world.grid, owner, polities, {
      fills: true, labels: true, playerPolity: 0, playerColor: PLAYER_COLOR,
    });
    const terr = g.querySelector('path.territory[data-polity="0"]') as SVGElement;
    expect(terr.getAttribute("fill")).toBe(PLAYER_COLOR);
    expect(terr.getAttribute("fill-opacity")).toBe("0.72");
    expect(terr.classList.contains("player")).toBe(true);
    const label = g.querySelector(".nation-label.player") as SVGElement;
    expect(label).not.toBeNull();
    expect(label.textContent!.startsWith("♛")).toBe(true);
    expect(label.getAttribute("fill")).toBe(PLAYER_LABEL_COLOR); // player label text is gold — legible on the magenta realm
  });

  it("leaves fills/labels unchanged when no playerPolity is passed (Version A path)", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const g = politicalLayer(world.grid, owner, [{ id: 0, name: "Mine", free: false }], { fills: true, labels: true });
    expect((g.querySelector('path.territory[data-polity="0"]') as SVGElement).getAttribute("fill")).toBe(nationColor(0));
    expect(g.querySelector(".nation-label.player")).toBeNull();
  });

  it("reflects a later snapshot differently once borders have shifted", () => {
    const a = politicalLayer(world.grid, owner0, h.polities, { fills: true });
    const b = politicalLayer(world.grid, h.snapshots[h.snapshots.length - 1].owner, h.polities, { fills: true });
    expect(dstr(a)).not.toBe(dstr(b));
  });
});
