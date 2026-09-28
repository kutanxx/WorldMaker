// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";
import { encodeParams } from "./urlState";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";

afterEach(() => { location.hash = ""; });

// The scrubber hides the towns the chronicle has not founded yet, and the free-port diamonds stayed:
// measured on the live site, world 1 opens at year 0 with a diamond on empty land where Khainzaz will
// stand in 390 — and over 12 worlds 6 did, 5 of them still at year 300.
describe("a free port on the map", () => {
  it("stands when its town does", () => {
    const params = { ...DEFAULT_PARAMS, seed: 1 };
    const world = generateWorld(params).world;
    const history = simulateHistory(world, params.seed);
    const founded = new Map(history.cityFoundings.map((f) => [f.cityId, f.year]));
    const towns = history.economicZones.map((z) => world.cities.find((c) => c.cell === z.cell)!);
    const late = towns.find((c) => (founded.get(c.id) ?? 0) > 0)!;
    expect(late, "world 1 no longer has a free port founded late").toBeTruthy();
    location.hash = encodeParams(params).slice(1);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      createApp(root, params);
      const pieces = (cell: number) => [...root.querySelectorAll<SVGElement>(`svg.world .econ-zones [data-zone="${cell}"]`)];
      const shown = (cell: number) => pieces(cell).length === 2 && pieces(cell).every((p) => p.style.display !== "none");
      expect(pieces(late.cell).length).toBe(2);
      expect(shown(late.cell), `a diamond at year 0 where ${late.name} is founded in ${founded.get(late.id)}`).toBe(false);
      for (const c of towns) if ((founded.get(c.id) ?? 0) === 0) expect(shown(c.cell), `${c.name}'s diamond hidden at year 0`).toBe(true);
      const slider = root.querySelector(".timeline-slider") as HTMLInputElement;
      slider.value = String(history.snapshots.findIndex((s) => s.year >= founded.get(late.id)!));
      slider.dispatchEvent(new Event("input"));
      expect(shown(late.cell), "the diamond did not come with its town").toBe(true);
    } finally {
      root.remove();
    }
  }, 30000);
});
