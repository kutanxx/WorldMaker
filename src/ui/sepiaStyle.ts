// The map as an old atlas draws it: sepia ink on parchment.
//
// The reader showed an anime world map on burnt parchment (2026-10-16) and asked for its feel beside the
// ink map. Sampled off that picture on a 50px grid: the sea is the paper itself (#d9d1b4), every ground a
// clear step darker than it (#b09452 at the median), the woods dark brown clumps (#654723), the mountains
// painted brown (#5c4124 in shadow), every line and word in one sepia ink, and the page browning to its
// corners (#42352?). Nothing is blue and nothing is green.
//
// It is drawn FROM the colour map, as the ink map is (inkStyle.ts): `renderWorld` draws the map as it always
// does — its marks in this file's palette instead of the painted one — and hands it here to be recoloured
// in place, so the three styles can never disagree about where anything is. The land is raised off the sea
// by a shadow drawn as the colour map's ripples were, bands of the coast under the land, set off to the
// south-east: no SVG filter, because a filter over the map is rasterized again at every zoom and pan. The
// realms', the peoples' and the provinces' layers are drawn as the ink map draws them — no fills, dashed
// borders, the key of the border and the marks — and then put into sepia with everything else.
import type { Lang } from "./i18n";
import { svgEl, INK, PARCHMENT, ROAD_INK, SEA_ROUTE_INK, FREE_PORT_FILL, FREE_PORT_EDGE } from "./renderer";
import { inkSlot, INK as ONE_INK, PAPER as WHITE, type MarkPalette } from "./inkStyle";
import { BIOME_COLORS, OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE } from "../engine/biome";

export const SEPIA = {
  sea: "#e2dabf", paper: "#e2dabf",         // the sea IS the paper; the key's panel, the frame's mat, every halo
  ink: "#2f2114", line: "#4a3418",          // words and marks; the coast
  town: "#4a3824", seaName: "#5a4a30",      // a town's name a shade lighter than a capital's, a sea's lighter still
  river: "#4e3a20", road: "#5a3a1e", seaRoute: "#6b5a3a", freePort: "#b08a3a",
  shadow: "#3a2a16", relief: "#3a2a16",     // under the land's edge; the ranges' shading
  vignette: ["#5a4526", "#3a2a16", 0.5] as const,   // the colour map's browning, deeper
} as const;
// Each ground a sepia of its own, a step darker than the sea and no two alike — the tundra palest (the
// first cut had it a hair off the sea, and the north read as water), the woods darkest under their trees.
export const SEPIA_GROUND: Record<number, string> = {
  [TUNDRA]: "#c8be9a", [TAIGA]: "#a4925e", [TEMPERATE_FOREST]: "#ab9657", [GRASSLAND]: "#c2ae73",
  [DESERT]: "#d1bb80", [TROPICAL]: "#9d8a50", [WETLAND]: "#a99a66", [ALPINE]: "#a08a62",
};
// the colour map's marks (inkStyle.ts PAINT_MARKS), in browns: dark trees, a peak lit in parchment with a
// brown flank, the hills and the sands in the ground's own family
export const SEPIA_MARKS: MarkPalette = {
  cls: "paint", compact: true, line: "#3a2a18", lit: "#e3d7ad", shade: "#6a4a2a", hill: "#cdb985", hillLine: "#7a5a34",
  leaf: ["#5e4a2a", "#6a5430", "#55402a"], needle: ["#4d3f26", "#574829", "#463a22"], trunk: "#3a2a18",
  palm: "#4f3e22", marsh: "#6b5a35", dune: "#8a6a3a",
};
// how far the shadow is set off the land, and its bands: outermost first, each heavier than the one outside it
const SHADOW_OFFSET = "translate(1.3 1.7)";
const SHADOW_BANDS: [number, number][] = [[7, 0.10], [4.5, 0.14], [2.2, 0.22]];
const COAST_W = 1.8;

// Every exact colour the colour map writes, and what it becomes. By value, so the frame, the compass, the
// cartouche, the scale bar and the keys all follow without knowing about sepia — and the two inks the slot
// passes leave (inkStyle.ts twoInks) with them.
const BY_VALUE = new Map<string, string>([
  [BIOME_COLORS[OCEAN], SEPIA.sea], ["#d8e5ec", SEPIA.sea],
  [PARCHMENT, SEPIA.paper], [WHITE, SEPIA.paper], ["#efe7d2", SEPIA.paper], ["#f4ecd8", SEPIA.paper],
  [INK, SEPIA.ink], [ONE_INK, SEPIA.ink], ["#2a2118", SEPIA.ink], ["#42341f", SEPIA.ink], ["#161009", SEPIA.ink], ["#4a3f2c", SEPIA.ink], [FREE_PORT_EDGE, SEPIA.ink],
  ["#6b5d42", SEPIA.town], ["#5a5346", SEPIA.town],
  ["#4a6373", SEPIA.line], ["#5b83a6", SEPIA.river], [SEA_ROUTE_INK, SEPIA.seaRoute], [ROAD_INK, SEPIA.road], [FREE_PORT_FILL, SEPIA.freePort],
  ...Object.entries(SEPIA_GROUND).map(([bm, c]): [string, string] => [BIOME_COLORS[Number(bm)], c]),
]);
// a word's fill: a town's and a sea's keep their lighter standing, everything else is the ink
const WORD_FILLS = new Map<string, string>([["#6b5d42", SEPIA.town], ["#5a5346", SEPIA.town], [SEA_ROUTE_INK, SEPIA.seaName]]);

/** The sepia of a colour the colour map paints with (the colour itself when it has none). */
export function sepiaColour(colour: string): string {
  return BY_VALUE.get(colour.toLowerCase()) ?? colour;
}

/** Everything under `root` put into sepia by value, its words into the ink. */
function recolour(root: Element): void {
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of ["fill", "stroke", "stop-color"]) {
      const v = el.getAttribute(attr);
      if (v === null) continue;
      const to = BY_VALUE.get(v.toLowerCase());
      if (to !== undefined) el.setAttribute(attr, to);
    }
    if (el.tagName.toLowerCase() === "text") {
      const fill = el.getAttribute("fill");
      el.setAttribute("fill", (fill && WORD_FILLS.get(fill.toLowerCase())) ?? SEPIA.ink);
      if (el.getAttribute("stroke")) el.setAttribute("stroke", SEPIA.paper);
    }
  }
}

/** A piece drawn in colour after the map was put into sepia (a town's new mark for another year). */
export function reSepia(el: Element): void {
  recolour(el);
}

/**
 * The overlay slot in sepia — the realms', the peoples' or the provinces' layer for a year: drawn as the ink
 * map draws it (no fills, dashed borders on a band of paper, the key of the border and the marks), then its
 * two inks turned to sepia and paper. The page refills the slot at every year and calls this after it.
 */
export function sepiaSlot(slot: Element, lang: Lang): void {
  inkSlot(slot, lang);
  recolour(slot);
}

/** The world map as `renderWorld` drew it, with this file's marks, put into sepia (see the head of this file). */
export function sepiaWorld(svg: SVGSVGElement, lang: Lang): void {
  svg.classList.add("sepia");
  svg.querySelector(":scope > rect")?.setAttribute("fill", SEPIA.sea);
  // the paper has no ripples; the land's shadow says where the water is
  svg.querySelector(".waterlines")?.remove();
  const biomes = svg.querySelector(".biomes");
  // the overlay has no fills to show through, so the ground and its marks keep their full strength on every view
  biomes?.removeAttribute("opacity");
  svg.querySelector(".relief-shade")?.removeAttribute("opacity");
  svg.querySelector(".reliefs")?.removeAttribute("opacity");
  const coast = svg.querySelector(".coastline");
  if (coast && biomes) {
    // (pinned to the screen like the coast it shadows: at 3x a band drawn in map units was 21px of blur round
    //  every island; a file thickens it with the coast — forPrint)
    const shadow = svgEl("g", { class: "land-shadow", transform: SHADOW_OFFSET });
    for (const [w, o] of SHADOW_BANDS) {
      shadow.appendChild(svgEl("path", {
        d: coast.getAttribute("d") ?? "", fill: "none", stroke: SEPIA.shadow, "stroke-width": w, "stroke-opacity": o,
        "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke",
      }));
    }
    biomes.before(shadow);
    coast.setAttribute("stroke-width", String(COAST_W));
  }
  for (const r of svg.querySelectorAll(".river")) r.setAttribute("stroke-width", (Number(r.getAttribute("stroke-width")) * 0.8).toFixed(1));
  for (const s of svg.querySelectorAll(".relief-shade .shade")) s.setAttribute("fill", SEPIA.relief);
  const slot = svg.querySelector(".political-slot");
  if (slot?.querySelector(".territory, .culture-area, .province-fill")) sepiaSlot(slot, lang);
  const stops = svg.querySelectorAll("radialGradient#wm-vignette stop");
  stops.forEach((s, i) => {
    const last = i === stops.length - 1;
    s.setAttribute("stop-color", SEPIA.vignette[last ? 1 : 0]);
    if (last) s.setAttribute("stop-opacity", String(SEPIA.vignette[2]));
  });
  recolour(svg);
  // a region's name over the dark trees keeps the wider halo the ink map gives it
  for (const text of svg.querySelectorAll(".region-label")) text.setAttribute("stroke-width", "3");
}
