// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld, restyleTowns, type MapView } from "./svgWorldRenderer";
import { svgToString } from "./export";
import { makeWorldState, townsIn } from "./worldState";
import { fillSlot } from "./mapSlot";
import { SEPIA, SEPIA_GROUND, SEPIA_MARKS } from "./sepiaStyle";
import { INK as ONE_INK, PAPER as WHITE } from "./inkStyle";

// The map as an old atlas draws it (sepiaStyle.ts): the reader showed an anime world map on burnt
// parchment (2026-10-16) and asked for its feel beside the ink map. The sea is the paper, every ground a
// step darker than it, raised off the sea by a shadow; the woods dark clumps, the peaks painted brown; every
// line and word in one sepia ink; the paper browning to its edges. Drawn FROM the colour map, as the ink map
// is, so the three can never disagree about where anything is.
const ws = makeWorldState({ ...DEFAULT_PARAMS, seed: 1 }, null, {});
const world = ws.generated.world;
const sepia = (view: MapView = "terrain", lang: "ko" | "en" = "ko") =>
  renderWorld(world, view, ws.history.economicZones.map((z) => z.cell), lang, new Set(), ws.colorOf, undefined, "sepia");
// the colour map's own inks and waters, none of which may survive into sepia
const COLOUR_LITERALS = /#(f3ead2|3c2f1c|2a2118|42341f|6b5d42|4a6373|5b83a6|c9dae4|d8e5ec|a9c0cf|95b0c3|819fb5|7a2a1a|3f5d78)\b/i;
const marksInks = [...SEPIA_MARKS.leaf, ...SEPIA_MARKS.needle];

describe("the sepia map", () => {
  it("draws the sea as the paper and raises the land off it, without a filter", () => {
    const svg = sepia();
    expect(svg.classList.contains("sepia")).toBe(true);
    expect(svg.querySelector(":scope > rect")!.getAttribute("fill")).toBe(SEPIA.sea);
    expect(svg.querySelector(".waterlines"), "the colour map's ripples stayed").toBeNull();
    const shadow = svg.querySelector(".land-shadow")!;
    expect(shadow, "no shadow under the land").not.toBeNull();
    expect(shadow.getAttribute("transform")).toBe("translate(1.3 1.7)");
    const coast = svg.querySelector(".coastline")!.getAttribute("d");
    const bands = [...shadow.querySelectorAll("path")];
    expect(bands.length).toBe(3);
    for (const b of bands) expect(b.getAttribute("d")).toBe(coast);
    // ...and held at its width on the screen as the coast is, whatever the zoom
    for (const b of bands) expect(b.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    // under the land, so only the seaward half of each band shows
    const biomes = svg.querySelector(".biomes")!;
    expect(shadow.compareDocumentPosition(biomes) & Node.DOCUMENT_POSITION_FOLLOWING, "the shadow lies over the land").toBeTruthy();
    expect(svg.querySelector("filter, [filter]"), "a filter is rasterized again at every zoom and pan").toBeNull();
  });

  it("paints every ground a sepia and its marks in browns", () => {
    const svg = sepia();
    const grounds = [...svg.querySelectorAll(".biome")];
    expect(grounds.length).toBeGreaterThan(3);
    for (const g of grounds) expect(g.getAttribute("fill"), `biome ${g.getAttribute("data-biome")}`).toBe(SEPIA_GROUND[Number(g.getAttribute("data-biome"))]);
    // (a palm is drawn in line alone, its fronds in the palm's own brown)
    const trees = [...svg.querySelectorAll(".reliefs .paint-tree:not(.paint-palm)")];
    expect(trees.length).toBeGreaterThan(100);
    for (const t of trees) expect(marksInks, t.getAttribute("fill")!).toContain(t.getAttribute("fill"));
    for (const p of svg.querySelectorAll(".reliefs .paint-palm")) expect(p.getAttribute("stroke")).toBe(SEPIA_MARKS.palm);
    const peaks = [...svg.querySelectorAll(".reliefs .paint-peak")];
    expect(peaks.length).toBeGreaterThan(10);
    for (const p of peaks) {
      expect(p.children[0].getAttribute("fill")).toBe(SEPIA_MARKS.lit);
      expect(p.children[1].getAttribute("fill")).toBe(SEPIA_MARKS.shade);
    }
    for (const s of svg.querySelectorAll(".relief-shade .shade")) expect(s.getAttribute("fill")).toBe(SEPIA.relief);
  });

  it("writes every line and word in sepia ink, and keys its swatches in the same sepia", () => {
    const svg = sepia();
    expect(svg.querySelector(".coastline")!.getAttribute("stroke")).toBe(SEPIA.line);
    for (const r of svg.querySelectorAll(".river")) expect(r.getAttribute("stroke")).toBe(SEPIA.river);
    for (const r of svg.querySelectorAll(".road")) expect(r.getAttribute("stroke")).toBe(SEPIA.road);
    const texts = [...svg.querySelectorAll("text")];
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect([SEPIA.ink, SEPIA.town, SEPIA.seaName], t.textContent ?? "").toContain(t.getAttribute("fill"));
    for (const t of texts) if (t.getAttribute("stroke")) expect(t.getAttribute("stroke"), t.textContent ?? "").toBe(SEPIA.paper);
    // the key: each ground's swatch is the colour the map paints it, its marks the map's marks
    const swatches = [...svg.querySelectorAll(".biome-legend .legend-item")];
    expect(swatches.length).toBeGreaterThan(3);
    for (const s of swatches) expect(Object.values(SEPIA_GROUND)).toContain(s.getAttribute("fill"));
    for (const t of svg.querySelectorAll(".biome-legend .paint-tree:not(.paint-palm)")) expect(marksInks).toContain(t.getAttribute("fill"));
    expect(svgToString(svg)).not.toMatch(COLOUR_LITERALS);
    // ...and the page browning to its edges, more than the colour map's
    const stops = [...svg.querySelectorAll("#wm-vignette stop")];
    expect(stops.length).toBe(2);
    expect(Number(stops[1].getAttribute("stop-opacity"))).toBeGreaterThan(0.3);
  });

  it("draws the realms', the peoples' and the provinces' views as the ink map does, in sepia", () => {
    for (const view of ["political", "culture", "province"] as const) {
      const svg = sepia(view);
      const fills = [...svg.querySelectorAll(".political-slot .territory, .political-slot .culture-area, .political-slot .province-fill")].map((p) => p.getAttribute("fill"));
      expect(fills.length, view).toBeGreaterThan(0);
      expect(new Set(fills), `${view}: a realm painted in colour`).toEqual(new Set(["none"]));
      const text = svgToString(svg);
      expect(text, `${view}: the ink map's black`).not.toContain(ONE_INK);
      expect(text, `${view}: the ink map's white paper`).not.toContain(WHITE);
      expect(text).not.toMatch(COLOUR_LITERALS);
      if (view !== "province") {
        expect(svg.querySelector(".political-slot .ink-legend .border-key"), `${view}: the key of the border and the marks`).not.toBeNull();
        for (const h of svg.querySelectorAll(".political-slot .ink-border-halo")) expect(h.getAttribute("stroke")).toBe(SEPIA.paper);
      }
    }
  });

  it("keeps a scrubbed year in sepia", () => {
    const svg = sepia("political");
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    fillSlot(slot, "political", Math.floor(ws.history.snapshots.length / 2), ws, "ko", "sepia");
    const fills = [...slot.querySelectorAll(".territory")].map((p) => p.getAttribute("fill"));
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set(["none"]));
    const text = svgToString(svg);
    expect(text).not.toContain(ONE_INK);
    expect(text).not.toContain(WHITE);
    expect(text).not.toMatch(COLOUR_LITERALS);
  });

  // Pinned at birth: world 1's sepia map, every view, with the names' `data-name` and the keys as drawn. The colour
  // and the ink pins (inkStyle.test.ts) did not move when the sepia came — it is a third pass on the same drawing.
  it("draws world 1's sepia map exactly as it did, in every view", () => {
    const fnv = (s: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h >>> 0; };
    const hashes = (["terrain", "political", "culture", "province"] as const).map((v) => fnv(svgToString(sepia(v))));
    // (the shadow's bands took `vector-effect: non-scaling-stroke` before the first commit: were [3823197687,
    //  66622902, 3607061001, 3342209289] with the bands in map units)
    expect(hashes).toEqual([2283568839, 2612778008, 1168694617, 3479229223]);
  });

  it("keeps a town's new mark in sepia when the year changes its standing", () => {
    const svg = sepia();
    // a year in which some town's standing differs from year zero
    const year = (() => {
      for (let i = ws.history.snapshots.length - 1; i > 0; i--) {
        const towns = townsIn(ws, i, "ko");
        if (world.cities.some((c) => towns.at(c).seat !== c.isCapital)) return i;
      }
      return -1;
    })();
    expect(year, "world 1 never changes a capital").toBeGreaterThan(0);
    restyleTowns(svg, world, "ko", townsIn(ws, year, "ko").at);
    for (const m of svg.querySelectorAll(".markers .marker-capital, .markers .marker-town")) {
      expect(m.getAttribute("fill")).toBe(SEPIA.ink);
      expect(m.getAttribute("stroke")).toBe(SEPIA.paper);
    }
    for (const l of svg.querySelectorAll(".markers .city-label")) expect([SEPIA.ink, SEPIA.town]).toContain(l.getAttribute("fill"));
    expect(svgToString(svg)).not.toMatch(COLOUR_LITERALS);
  });
});
