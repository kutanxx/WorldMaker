// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { DEFAULT_PARAMS } from "../types/world";
import { BIOME_COLORS, GRASSLAND } from "../engine/biome";
import { politicalLayer } from "./politicalLayer";
import { cultureLayer, CULTURE_FILL_OPACITY } from "./cultureLayer";
import { KEY_GROUND, PARCHMENT } from "./renderer";
import { OVERLAY_BIOME_OPACITY } from "./svgWorldRenderer";
import { over } from "./colour";
import { nationColor } from "./nationPalette";

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
const h = simulateHistory(world, 1);
const owner0 = h.snapshots[0].owner;

// ★ A key's swatch said the realm's colour; the map paints that colour at 0.58 over the muted ground, and
// the two did not look like the same colour — "다이시다르 제국" was blue in the key and grey-teal on the
// map (design review 2026-10-15, item 8). A swatch now says the colour the map paints: the fill laid over
// grassland as the overlay views paint it, at the fill's own opacity.
describe("a key's swatch is the colour the map paints", () => {
  it("stands on grassland as the overlay views paint it", () => {
    expect(KEY_GROUND).toBe(over(BIOME_COLORS[GRASSLAND], PARCHMENT, OVERLAY_BIOME_OPACITY));
    expect(KEY_GROUND).toBe("#e2dab1");
  });

  it("gives each realm's row the realm's fill over that ground, at the territory's opacity", () => {
    const g = politicalLayer(world.grid, owner0, h.polities, { fills: true, legend: true, colorOf: nationColor });
    const rows = [...g.querySelectorAll<SVGRectElement>(".nation-legend rect.legend-item")];
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      const id = Number(r.getAttribute("data-polity"));
      expect(Number.isNaN(id), "a swatch does not say which realm it is").toBe(false);
      const territory = g.querySelector(`.territory[data-polity="${id}"]`)!;
      expect(territory, `realm ${id} has a row and no land`).not.toBeNull();
      const painted = over(territory.getAttribute("fill")!, KEY_GROUND, Number(territory.getAttribute("fill-opacity")));
      expect(r.getAttribute("fill"), `realm ${id}`).toBe(painted);
      expect(r.getAttribute("fill"), "the swatch still says the pure colour").not.toBe(territory.getAttribute("fill"));
    }
  });

  it("does the same for a people's row", () => {
    const g = cultureLayer(world.grid, world.cultureOf, world.cultures, "ko");
    const rows = [...g.querySelectorAll<SVGRectElement>(".culture-legend rect.legend-item")];
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      const id = Number(r.getAttribute("data-culture"));
      expect(r.getAttribute("fill"), `people ${id}`).toBe(over(world.cultures[id].color, KEY_GROUND, CULTURE_FILL_OPACITY));
    }
  });
});
