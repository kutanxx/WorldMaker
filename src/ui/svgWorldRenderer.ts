import type { World } from "../types/world";
import { svgEl, legendPanel, starPath, compassRose, mapFrame, INK, PARCHMENT, LEGEND_TITLE_H, LEGEND_TEXT, LEGEND_ROW, LEGEND_SWATCH, LEGEND_GAP, LEGEND_W_FIXED } from "./renderer";
import { scaleBar, KM_PER_UNIT, KM_PER_WALKING_DAY } from "./scaleBar";
import { displayBiomes } from "./displayBiome";
import { OCEAN, ALPINE, BIOME_COLORS } from "../engine/biome";
import { type Lang, biomeName, t } from "./i18n";
import { coastline, type Segment } from "../engine/borders";
import { cellPath, segPath } from "./svgPaths";
import { politicalLayer, type PoliticalOpts } from "./politicalLayer";
import { properName, polityLabeller } from "./properName";
import { featureLabel, worldNameIn } from "../engine/featureLabel";
import { cultureLayer } from "./cultureLayer";
import { provinceLayer, snapOwnersToProvinces } from "./provinceLayer";

export type MapView = "terrain" | "political" | "culture" | "province";

// How far the biomes are muted under an overlay view. Named because it is one half of what the
// reader sees through a culture fill; the palette test reads it.
export const OVERLAY_BIOME_OPACITY = 0.6;

// `labelOf` follows `colorOf`: politicalLayer is given the finished answer rather than the language
// to work it out from, so the layer never learns about Hangul or about the i18n table.
export function politicalOpts(view: MapView, lang: Lang = "en", colorOf?: (id: number) => string,
                              labelOf: (id: number, name: string) => string = polityLabeller(lang)): PoliticalOpts {
  // the title comes in as a finished string so politicalLayer stays free of the i18n table
  return view === "political"
    ? { fills: true, labels: true, legend: true, legendTitle: t(lang, "legendRealms"), colorOf, labelOf }
    : { labelOf };
}


// n-point star centered at (cx,cy), alternating outer/inner radius, tip pointing up.
// a drawn thing that can say what it is (SVG's own tooltip: no CSS, and it survives export)
function named<T extends SVGElement>(el: T, text: string): T {
  const tl = svgEl("title");
  tl.textContent = text;
  el.appendChild(tl);
  return el;
}

/**
 * @param sinceFounded city ids the chronicle has not founded yet at the year being shown. They are
 * on the map from year 0 as far as the generator is concerned — the history is what says when they
 * came to be — so the timeline holds them back rather than the world omitting them.
 */
// `colorOf` is threaded in rather than looked up here so that the first paint and every later one
// use ONE colouring: this draws `world.polityOf` (the eight realms of year zero) while the scrubber
// redraws from the history's snapshots, and a realm that changed colour between the two would be a
// drift bug of exactly the kind the shared chronicle assembler was built to end.
export function renderWorld(world: World, view: MapView = "terrain", econZones: number[] = [], lang: Lang = "en", unfounded: ReadonlySet<number> = new Set(), colorOf?: (id: number) => string, labelOf: (id: number, name: string) => string = polityLabeller(lang)): SVGSVGElement {
  const grid = world.grid;
  // Every proper noun this function draws goes through one of two doors, and which door is not a
  // choice: a name with a common noun IN it (the world's, a region's, a river's) is rebuilt from
  // its parts, while a bare invented word (a town, a realm) is transliterated. Running "the Hollow
  // Realm" through `properName` would hand toHangul letters no invented word contains.
  const nm = (name: string) => properName(lang, name);
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: `world view-${view}`,
    role: "img",
  }) as SVGSVGElement;
  // The map IS the page, and to a screen reader it was an untitled graphic: no role, no name, no
  // description, announcing as nothing at all. A title and a description of the view make it one
  // thing that can be spoken. Both are real SVG elements, so they travel into the exported file.
  const rootTitle = svgEl("title");
  const worldName = worldNameIn(world, lang);
  rootTitle.textContent = `${t(lang, "mapOf")} ${worldName}`;
  const rootDesc = svgEl("desc");
  rootDesc.textContent = t(lang, `view${view.charAt(0).toUpperCase()}${view.slice(1)}` as never);
  root.append(rootTitle, rootDesc);

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: BIOME_COLORS[OCEAN] }));

  // coastal waterlines: soft blue bands echoing the shore, drawn UNDER the biome fills so only
  // the seaward half shows — the classic antique-atlas figure-ground cue that lifts the coast
  // off a flat ocean. Coastline segments computed once and reused for the crisp line below.
  const coastD = segPath(coastline(grid, world.terrain));
  const waterlines = svgEl("g", { class: "waterlines" });
  for (const [w, op] of [[9, 0.14], [6, 0.24], [3, 0.38]] as const) {
    waterlines.appendChild(svgEl("path", {
      d: coastD, fill: "none", stroke: "#7ba2c0", "stroke-width": w, "stroke-opacity": op,
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }
  root.appendChild(waterlines);

  // Specks — half the biome patches on a world are one or two cells, and together they hold a
  // twentieth of the land — are merged for DRAWING ONLY; world.biome is untouched. The fills and the
  // mountain glyphs below read this same array, so a range is never hatched over a colour that has
  // stopped saying mountain.
  const shownBiome = displayBiomes(grid, world.biome);

  // biome fills (ocean is the background rect, so skip OCEAN cells)
  const byBiome = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const bm = shownBiome[i];
    if (bm === OCEAN) continue;
    byBiome.set(bm, (byBiome.get(bm) ?? "") + cellPath(grid.polygons[i]));
  }
  // Mute biomes under the political/culture views so the overlay fills dominate. Inline (not
  // CSS) so an exported standalone SVG/PNG matches the on-screen map.
  const biomes = svgEl("g", view !== "terrain" ? { class: "biomes", opacity: OVERLAY_BIOME_OPACITY } : { class: "biomes" });
  for (const [bm, d] of byBiome) {
    biomes.appendChild(svgEl("path", { class: "biome", "data-biome": bm, d, fill: BIOME_COLORS[bm] }));
  }
  root.appendChild(biomes);

  root.appendChild(svgEl("path", {
    class: "coastline", d: coastD,
    fill: "none", stroke: "#4a6373", "stroke-width": 2.4, "vector-effect": "non-scaling-stroke",
  }));
  const slot = svgEl("g", { class: "political-slot" });
  slot.appendChild(
    view === "culture" ? cultureLayer(grid, world.cultureOf, world.cultures, lang)
      : view === "province" ? provinceLayer(grid, world.provinceOf, world.provinces, { owner: world.polityOf, legend: true, lang })
        // terrain/political: snap nation ownership to whole provinces so borders (and political fills)
        // fall on province edges — the SAME geometry the province view uses, so views stay consistent.
        // ⚠ No `keep` set here, and none needed: this draws `world.polityOf`, the ownership of year
        // ZERO, and a free city is something the simulation declares later — `world.polities` has no
        // `free` flag at all. The per-year layer app.ts swaps into this slot is where free realms
        // have to survive the snap; see snapOwnersToProvinces.
        : politicalLayer(grid, snapOwnersToProvinces(grid.count, world.provinceOf, world.provinces, world.polityOf), world.polities, politicalOpts(view, lang, colorOf, labelOf)));
  root.appendChild(slot);

  // mountain relief: a small peak glyph on each alpine cell so ranges read as mountains rather
  // than a flat grey fill (antique/fantasy convention). Above the overlay fills, below rivers/labels.
  let reliefD = "";
  for (let i = 0; i < grid.count; i++) {
    if (shownBiome[i] !== ALPINE) continue;
    if (!grid.neighbors[i].some((nb) => shownBiome[nb] === ALPINE)) continue; // skip lone peaks in the plains — only draw where mountains cluster into a range
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    reliefD += `M${(x - 3).toFixed(1)},${(y + 2).toFixed(1)}L${x.toFixed(1)},${(y - 2.6).toFixed(1)}L${(x + 3).toFixed(1)},${(y + 2).toFixed(1)}`;
  }
  if (reliefD) {
    root.appendChild(svgEl("g", { class: "reliefs" })).appendChild(svgEl("path", {
      class: "relief", d: reliefD, fill: "none", stroke: "#6b5f4c", "stroke-width": 0.9, "vector-effect": "non-scaling-stroke",
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }

  // rivers — above the political/culture fills, below labels & markers; shown in all views
  if (world.riverNet.length) {
    const maxF = world.riverNet.reduce((m, s) => Math.max(m, s.f), 0);
    const tierSegs: Segment[][] = [[], [], []];
    const tierW = [0.9, 1.5, 2.1];
    for (const s of world.riverNet) {
      const t = s.f < 0.15 * maxF ? 0 : s.f < 0.5 * maxF ? 1 : 2;
      tierSegs[t].push([[s.x1, s.y1], [s.x2, s.y2]]);
    }
    const rivers = svgEl("g", { class: "rivers" });
    tierSegs.forEach((segs, t) => {
      if (!segs.length) return;
      rivers.appendChild(svgEl("path", {
        class: "river", d: segPath(segs, false), fill: "none", stroke: "#5b83a6", // rivers run between cell centres, not along cell edges
        "stroke-width": tierW[t], "vector-effect": "non-scaling-stroke",
        "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
    });
    root.appendChild(rivers);
  }

  // geographic feature names (above the political fills, below the settlements).
  // Cartographic convention: AREA (land) features are set upright + UPPERCASE with wide
  // letter-spacing to reinforce their extent; WATER (seas) are italic + blue like rivers.
  const regionLabels = svgEl("g", { class: "region-labels" });
  for (const r of world.regions) {
    // Type size is a map's first signal of what kind of thing a word names, and the three classes
    // used to overlap: regions ran 9.4-16.0, cities 8.5-10.5, rivers 9.4-10.4, so anything in the
    // 9.4-10.5 band gave the reader no way to tell a mountain range from a village. The bands are
    // now separated in the order an atlas uses — the land's own features largest, settlements
    // smallest, since a town's prominence comes from its marker rather than its type.
    const fs = 10.5 + Math.min(9.5, r.cells / 60);
    const isSea = r.kind === OCEAN;
    // On any view but the terrain one these names belong to somebody else's subject: they are the
    // ground the countries, cultures and provinces are drawn ON, not the thing being shown. Faded
    // rather than dropped, so a reader can still see WHICH tundra a nation holds — and demoted in
    // the deconflict order, because in the province view a region label and a province label sat at
    // the same priority and a collision between them was decided by a coin toss.
    const faint = view !== "terrain";
    const t = svgEl("text", {
      class: "region-label " + (isSea ? "region-sea" : "region-land") + (faint ? " region-faint" : ""),
      ...(faint ? { "fill-opacity": 0.45 } : {}),
      x: r.centroid[0].toFixed(1), y: r.centroid[1].toFixed(1),
      "text-anchor": "middle", "font-size": fs.toFixed(1),
      fill: isSea ? "#3f5d78" : "#42341f",
      "font-style": isSea ? "italic" : "normal",
      "letter-spacing": isSea ? "0" : (fs * 0.16).toFixed(1),
      stroke: PARCHMENT, "stroke-width": 2, "paint-order": "stroke",
    });
    // UPPERCASE is an English typographic device for a region name and does nothing whatever to
    // Hangul — there are no cases to raise — so the Korean map keeps the size and the tracking,
    // which is what carries the register anyway.
    const regionName = featureLabel(r.label, lang);
    t.textContent = isSea || lang === "ko" ? regionName : regionName.toUpperCase();
    regionLabels.appendChild(t);
  }
  root.appendChild(regionLabels);

  // river labels follow the water's course (rotated to the local flow direction), lifted
  // just off the line, never upside-down — the standard hydrographic labelling treatment.
  const riverLabels = svgEl("g", { class: "river-labels" });
  for (const r of world.rivers) {
    const i = Math.floor(r.path.length / 2);
    const mid = r.path[i];
    const a = r.path[Math.max(0, i - 1)], b = r.path[Math.min(r.path.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180; // keep it readable
    const fs = 9 + Math.min(3, r.flux / 60);   // between the settlements and the regions
    // offset perpendicular to the flow, toward the upper side
    let nx = -dy / len, ny = dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
    const lx = mid[0] + nx * fs * 0.5, ly = mid[1] + ny * fs * 0.5;
    const t = svgEl("text", {
      class: "river-label", x: lx.toFixed(1), y: ly.toFixed(1),
      "text-anchor": "middle", "font-size": fs.toFixed(1), fill: "#3f5d78",
      stroke: PARCHMENT, "stroke-width": 1.8, "paint-order": "stroke", "font-style": "italic",
      transform: `rotate(${deg.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`,
    });
    t.textContent = featureLabel(r.label, lang);
    riverLabels.appendChild(t);
  }
  root.appendChild(riverLabels);

  const markers = svgEl("g", { class: "markers" });
  // A marker was a four-pixel dot with a click handler and nothing else — no name, no sign it led
  // anywhere — and the labels beside them are withheld until the reader zooms (deconflict holds
  // .city-capital to 1.5x and .city-town to 2.6x). So the marker carries the name itself: the
  // map's own tooltip, needing no CSS and surviving export.
  const nationOf = (c: { cell: number }) => {
    const p = world.polityOf[c.cell];
    const name = p >= 0 ? world.polities.find((q) => q.id === p)?.name : undefined;
    return name === undefined ? null : labelOf(p, name);
  };
  const markerTitle = (c: { name: string; cell: number; isCapital: boolean }) => {
    const nation = nationOf(c);
    const seat = c.isCapital ? ` (${t(lang, "capitalSeat")})` : "";
    return nation ? `${nm(c.name)}${seat} · ${nation}` : `${nm(c.name)}${seat}`;
  };
  for (const c of world.cities) {
    if (unfounded.has(c.id)) continue;   // the chronicle has not founded it yet
    // The mark itself stays small — a settlement is a point on a map and growing it would be a lie
    // about the size of the place. What grows is an invisible target around it. Measured on the
    // live page the marks were 5px across (8 for a capital) against a 24px minimum touch target,
    // and the page had no focusable element at all, so a keyboard could not reach a city plan.
    // The target is a mark too, so applyMarkerScale holds it at its screen size through the zoom.
    markers.appendChild(named(svgEl("circle", {
      class: "marker-hit", cx: c.x, cy: c.y, r: 14, fill: "transparent",
      "data-city": c.id, style: "cursor:pointer",
      tabindex: 0, role: "button", "aria-label": markerTitle(c),
    }), markerTitle(c)));
    if (c.isCapital) {
      markers.appendChild(named(svgEl("path", {
        class: "marker-capital", d: starPath(c.x, c.y, 5, 4.2, 1.9), "data-cx": c.x.toFixed(1), "data-cy": c.y.toFixed(1),
        fill: INK, stroke: PARCHMENT, "stroke-width": 0.7,
        "data-city": c.id, style: "cursor:pointer",
      }), markerTitle(c)));
    } else {
      markers.appendChild(named(svgEl("circle", {
        class: "marker-town", cx: c.x, cy: c.y, r: 2.3,
        fill: INK, stroke: PARCHMENT, "stroke-width": 0.9,
        "data-city": c.id, style: "cursor:pointer",
      }), markerTitle(c)));
    }
    // settlement hierarchy: capitals promoted (larger, bold, dark ink); towns demoted
    // (smaller, muted brown) so the eye reads the capitals first.
    // the name opens the city too: it is several times the area of the dot beside it, and a reader
    // who can see a name is far likelier to aim at it than at the speck
    const label = svgEl("text", {
      class: "city-label " + (c.isCapital ? "city-capital" : "city-town"),
      "data-city": c.id, style: "cursor:pointer",
      x: c.x + 5, y: c.y + 3, "font-size": c.isCapital ? 10 : 8,
      "font-weight": c.isCapital ? 600 : 400,
      fill: c.isCapital ? "#2a2118" : "#6b5d42",
      stroke: PARCHMENT, "stroke-width": 1.6, "paint-order": "stroke",
    });
    label.textContent = nm(c.name);
    markers.appendChild(label);
  }
  root.appendChild(markers);

  // biome legend: terrain view only (the nation legend, from politicalLayer, replaces
  // it in political view). Rendered conditionally — not CSS-hidden — so exports match.
  if (view === "terrain") {
    const present = [...byBiome.keys()].sort((a, b) => a - b);
    const legend = svgEl("g", { class: "legend biome-legend" });
    const x0 = 14, y0 = grid.height - 14 - present.length * LEGEND_ROW;
    // the heading grows the panel UPWARD so the key stays anchored to the map's bottom-left corner
    legend.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, LEGEND_W_FIXED, present.length * LEGEND_ROW + 14 + LEGEND_TITLE_H, t(lang, "legendTerrain")));
    present.forEach((bm, i) => {
      const y = y0 + i * LEGEND_ROW;
      legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 9, width: LEGEND_SWATCH, height: LEGEND_SWATCH, fill: BIOME_COLORS[bm], stroke: INK, "stroke-width": 0.6, "vector-effect": "non-scaling-stroke" }));
      const t = svgEl("text", { x: x0 + LEGEND_SWATCH + LEGEND_GAP, y: y, "font-size": LEGEND_TEXT, fill: "#42341f", "letter-spacing": 0.3 });
      t.textContent = biomeName(lang, bm);
      legend.appendChild(t);
    });
    root.appendChild(legend);
  }

  // economic special zones (free ports / staple towns): a gold diamond on the city
  if (econZones.length) {
    const eg = svgEl("g", { class: "econ-zones", style: "pointer-events:none" }); // badge only; don't block city clicks

    for (const cell of econZones) {
      const x = grid.points[cell * 2], y = grid.points[cell * 2 + 1];
      const d = `M${x.toFixed(1)},${(y - 4).toFixed(1)}L${(x + 4).toFixed(1)},${y.toFixed(1)}L${x.toFixed(1)},${(y + 4).toFixed(1)}L${(x - 4).toFixed(1)},${y.toFixed(1)}Z`;
      const at = { "data-cx": x.toFixed(1), "data-cy": y.toFixed(1) };
      // Gold has almost no value contrast on a tan or green biome — measured, #e0a83a came to 1.13:1
      // against grassland, where a graphical mark wants 3:1 — and no single colour can clear that
      // against both the palest tundra and the darkest taiga. So the badge is haloed like every name
      // on the map: the parchment ring lifts it off the dark biomes, its dark outline off the pale
      // ones, and the gold is left to say what the mark MEANS rather than to be seen.
      eg.appendChild(svgEl("path", {
        class: "econ-zone-halo", ...at, d,
        fill: "none", stroke: PARCHMENT, "stroke-width": 2.6, "stroke-linejoin": "round",
      }));
      eg.appendChild(svgEl("path", {
        class: "econ-zone", "data-zone": cell, ...at, d,
        fill: "#d69a2c", stroke: "#3d2c08", "stroke-width": 1, "stroke-linejoin": "round",
      }));
    }
    root.appendChild(eg);
  }

  root.appendChild(compassRose(grid.width - 26, 28, 14, t(lang, "compassN")));

  // the world's name, an atlas title cartouche at the top-centre
  const title = svgEl("g", { class: "world-name" });
  const wt = svgEl("text", {
    class: "world-name-text", x: grid.width / 2, y: 36, "text-anchor": "middle",
    "font-size": 22, fill: INK, stroke: PARCHMENT, "stroke-width": 3, "paint-order": "stroke",
  });
  wt.textContent = worldName;
  title.appendChild(wt);
  title.appendChild(svgEl("line", {
    x1: grid.width / 2 - 70, y1: 44, x2: grid.width / 2 + 70, y2: 44,
    stroke: INK, "stroke-width": 0.9, "vector-effect": "non-scaling-stroke",
  }));
  root.appendChild(title);

  // how far the ground is, which neither map said. Bottom CENTRE: the legend has the bottom-left
  // corner and the zoom controls the bottom-right, and the bar sat on the legend when it was put
  // beside it. Drawn in map units so it grows with the zoom, as a scale bar should — it says how
  // far the ground is, and the ground does not change when the reader leans in.
  {
    const units = 120;
    const km = Math.round(units * KM_PER_UNIT);
    const days = km / KM_PER_WALKING_DAY;
    const sub = days >= 1.5
      ? t(lang, "walkDays").replace("{d}", String(Math.round(days)))
      : t(lang, "walkDay");
    root.appendChild(scaleBar(grid.width / 2 - units / 2, grid.height - 26, units, `${km} km`, sub));
  }
  root.appendChild(mapFrame(grid.width, grid.height));

  return root;
}
