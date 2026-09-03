import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { OCEAN, ALPINE, BIOME_COLORS } from "../engine/biome";
import { type Lang, biomeName, t } from "./i18n";
import { coastline, type Segment } from "../engine/borders";
import { cellPath, segPath } from "./svgPaths";
import { politicalLayer, type PoliticalOpts } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";
import { provinceLayer, snapOwnersToProvinces } from "./provinceLayer";

export type MapView = "terrain" | "political" | "culture" | "province";

export function politicalOpts(view: MapView): PoliticalOpts {
  return view === "political" ? { fills: true, labels: true, legend: true } : {};
}

const INK = "#3c2f1c";
const PARCHMENT = "#f3ead2";

// n-point star centered at (cx,cy), alternating outer/inner radius, tip pointing up.
function starPath(cx: number, cy: number, points: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += (i === 0 ? "M" : "L") + (cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1);
  }
  return d + "Z";
}

function compassRose(cx: number, cy: number, r: number, north: string): SVGElement {
  const g = svgEl("g", { class: "compass" });
  g.appendChild(svgEl("circle", { cx, cy, r, fill: PARCHMENT, "fill-opacity": 0.55, stroke: INK, "stroke-width": 0.8 }));
  g.appendChild(svgEl("path", { d: starPath(cx, cy, 4, r * 0.92, r * 0.3), fill: INK }));
  const n = svgEl("text", { class: "compass-n", x: cx, y: cy - r - 2, "text-anchor": "middle", "font-size": 7, fill: INK });
  n.textContent = north;
  g.appendChild(n);
  return g;
}

// How big the world is. Nothing in the generator ever said, so a reader had no way to answer the
// question a map is mostly asked — how far is that, and how long does it take. The span is fixed in
// kilometres rather than derived from the render width, so enlarging the image changes the picture
// and not the world. Five thousand kilometres across is a continent on the scale of Europe or the
// contiguous United States, which is the size this generator's eight-or-so realms imply.
export const WORLD_SPAN_KM = 5000;
const WALK_KM_PER_DAY = 30;   // a person on foot over mixed country — the yardstick fantasy maps use

// Round distances a scale bar is allowed to show. A bar reading "537 km" is arithmetic; a reader
// wants to lay a round number against the map and count.
const NICE_KM = [50, 100, 200, 250, 500, 1000, 2000];

export function scaleBarKm(mapWidthPx: number): number {
  const kmPerPx = WORLD_SPAN_KM / mapWidthPx;
  // Long enough to measure against, short enough to sit in a corner: between an eighth and a fifth
  // of the map's width.
  const fits = NICE_KM.filter((d) => d / kmPerPx >= mapWidthPx * 0.12 && d / kmPerPx <= mapWidthPx * 0.22);
  return fits.length ? fits[fits.length - 1] : NICE_KM[Math.floor(NICE_KM.length / 2)];
}

function scaleBar(w: number, h: number, lang: Lang): SVGElement {
  const g = svgEl("g", { class: "scale-bar" });
  const km = scaleBarKm(w);
  const len = km / (WORLD_SPAN_KM / w);
  // Bottom right: the compass holds the top right, the legend the bottom left, the title the top
  // centre. This is the one corner left, and the corner a scale bar conventionally takes.
  // The decorative frame's inner line sits 8 units in, so the panel is placed to clear it rather
  // than to sit on it: at h - 24 the walking line rendered two units past the frame's bottom edge.
  const x1 = w - 20, x0 = x1 - len, y = h - 30;
  const SEG = 4, segW = len / SEG, barH = 4;

  g.appendChild(svgEl("rect", {
    x: x0 - 8, y: y - 16, width: len + 16, height: 34, rx: 3,
    fill: "#f7f2e6", "fill-opacity": 0.92, stroke: "#cbb784", "stroke-width": 0.5,
  }));
  // Alternating filled and empty segments — the checker a reader counts along.
  for (let i = 0; i < SEG; i++) {
    g.appendChild(svgEl("rect", {
      class: "scale-seg", x: x0 + i * segW, y, width: segW, height: barH,
      fill: i % 2 === 0 ? INK : PARCHMENT, stroke: INK, "stroke-width": 0.5,
    }));
  }
  const tick = (x: number, label: string, anchorPos: string) => {
    const tx = svgEl("text", {
      class: "scale-label", x, y: y - 3, "text-anchor": anchorPos, "font-size": 7.5, fill: INK,
    });
    tx.textContent = label;
    g.appendChild(tx);
  };
  tick(x0, "0", "middle");
  tick(x1, `${km.toLocaleString("en-US")} km`, "end");

  // What a writer actually wants from a distance: how long it takes to walk it.
  const days = Math.max(1, Math.round(km / WALK_KM_PER_DAY));
  const foot = svgEl("text", {
    class: "scale-foot", x: x1, y: y + barH + 9, "text-anchor": "end",
    "font-size": 7, fill: "#6b5d42", "font-style": "italic",
  });
  foot.textContent = t(lang, "scaleFoot").replace("{n}", String(days));
  g.appendChild(foot);
  return g;
}

function mapFrame(w: number, h: number): SVGElement {
  const g = svgEl("g", { class: "map-frame" });
  g.appendChild(svgEl("rect", { x: 4, y: 4, width: w - 8, height: h - 8, fill: "none", stroke: INK, "stroke-width": 2 }));
  g.appendChild(svgEl("rect", { x: 8, y: 8, width: w - 16, height: h - 16, fill: "none", stroke: INK, "stroke-width": 0.6 }));
  for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) {
    g.appendChild(svgEl("circle", { cx: x, cy: y, r: 2, fill: INK }));
  }
  return g;
}

export function renderWorld(world: World, view: MapView = "terrain", econZones: number[] = [], lang: Lang = "en"): SVGSVGElement {
  const grid = world.grid;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: `world view-${view}`,
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: BIOME_COLORS[OCEAN] }));

  // coastal waterlines: soft blue bands echoing the shore, drawn UNDER the biome fills so only
  // the seaward half shows — the classic antique-atlas figure-ground cue that lifts the coast
  // off a flat ocean. Coastline segments computed once and reused for the crisp line below.
  const coastD = segPath(coastline(grid, world.terrain));
  const waterlines = svgEl("g", { class: "waterlines" });
  for (const [w, op] of [[9, 0.1], [6, 0.16], [3, 0.26]] as const) {
    waterlines.appendChild(svgEl("path", {
      d: coastD, fill: "none", stroke: "#7ba2c0", "stroke-width": w, "stroke-opacity": op,
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }
  root.appendChild(waterlines);

  // biome fills (ocean is the background rect, so skip OCEAN cells)
  const byBiome = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const bm = world.biome[i];
    if (bm === OCEAN) continue;
    byBiome.set(bm, (byBiome.get(bm) ?? "") + cellPath(grid.polygons[i]));
  }
  // Mute biomes under the political/culture views so the overlay fills dominate. Inline (not
  // CSS) so an exported standalone SVG/PNG matches the on-screen map.
  const biomes = svgEl("g", view !== "terrain" ? { class: "biomes", opacity: 0.6 } : { class: "biomes" });
  for (const [bm, d] of byBiome) {
    biomes.appendChild(svgEl("path", { class: "biome", "data-biome": bm, d, fill: BIOME_COLORS[bm] }));
  }
  root.appendChild(biomes);

  root.appendChild(svgEl("path", {
    class: "coastline", d: coastD,
    fill: "none", stroke: "#5f7888", "stroke-width": 0.6,
  }));
  const slot = svgEl("g", { class: "political-slot" });
  slot.appendChild(
    view === "culture" ? cultureLayer(grid, world.cultureOf, world.cultures)
      : view === "province" ? provinceLayer(grid, world.provinceOf, world.provinces, { owner: world.polityOf })
        // terrain/political: snap nation ownership to whole provinces so borders (and political fills)
        // fall on province edges — the SAME geometry the province view uses, so views stay consistent.
        : politicalLayer(grid, snapOwnersToProvinces(grid.count, world.provinceOf, world.provinces, world.polityOf), world.polities, politicalOpts(view)));
  root.appendChild(slot);

  // mountain relief: a small peak glyph on each alpine cell so ranges read as mountains rather
  // than a flat grey fill (antique/fantasy convention). Above the overlay fills, below rivers/labels.
  let reliefD = "";
  for (let i = 0; i < grid.count; i++) {
    if (world.biome[i] !== ALPINE) continue;
    if (!grid.neighbors[i].some((nb) => world.biome[nb] === ALPINE)) continue; // skip lone peaks in the plains — only draw where mountains cluster into a range
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    reliefD += `M${(x - 3).toFixed(1)},${(y + 2).toFixed(1)}L${x.toFixed(1)},${(y - 2.6).toFixed(1)}L${(x + 3).toFixed(1)},${(y + 2).toFixed(1)}`;
  }
  if (reliefD) {
    root.appendChild(svgEl("g", { class: "reliefs" })).appendChild(svgEl("path", {
      class: "relief", d: reliefD, fill: "none", stroke: "#6b5f4c", "stroke-width": 0.6,
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }

  // rivers — above the political/culture fills, below labels & markers; shown in all views
  if (world.riverNet.length) {
    const maxF = world.riverNet.reduce((m, s) => Math.max(m, s.f), 0);
    const tierSegs: Segment[][] = [[], [], []];
    const tierW = [0.5, 1.0, 1.8];
    for (const s of world.riverNet) {
      const t = s.f < 0.15 * maxF ? 0 : s.f < 0.5 * maxF ? 1 : 2;
      tierSegs[t].push([[s.x1, s.y1], [s.x2, s.y2]]);
    }
    const rivers = svgEl("g", { class: "rivers" });
    tierSegs.forEach((segs, t) => {
      if (!segs.length) return;
      rivers.appendChild(svgEl("path", {
        class: "river", d: segPath(segs), fill: "none", stroke: "#5b83a6",
        "stroke-width": tierW[t], "stroke-linecap": "round", "stroke-linejoin": "round",
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
    const t = svgEl("text", {
      class: "region-label " + (isSea ? "region-sea" : "region-land"),
      x: r.centroid[0].toFixed(1), y: r.centroid[1].toFixed(1),
      "text-anchor": "middle", "font-size": fs.toFixed(1),
      fill: isSea ? "#3f5d78" : "#5a4a34",
      "font-style": isSea ? "italic" : "normal",
      "letter-spacing": isSea ? "0" : (fs * 0.16).toFixed(1),
      stroke: PARCHMENT, "stroke-width": 2, "paint-order": "stroke",
    });
    t.textContent = isSea ? r.name : r.name.toUpperCase();
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
    t.textContent = r.name;
    riverLabels.appendChild(t);
  }
  root.appendChild(riverLabels);

  const markers = svgEl("g", { class: "markers" });
  for (const c of world.cities) {
    if (c.isCapital) {
      markers.appendChild(svgEl("path", {
        class: "marker-capital", d: starPath(c.x, c.y, 5, 4.2, 1.9),
        fill: INK, stroke: PARCHMENT, "stroke-width": 0.7,
        "data-city": c.id, style: "cursor:pointer",
      }));
    } else {
      markers.appendChild(svgEl("circle", {
        class: "marker-town", cx: c.x, cy: c.y, r: 2.3,
        fill: INK, stroke: PARCHMENT, "stroke-width": 0.9,
        "data-city": c.id, style: "cursor:pointer",
      }));
    }
    // settlement hierarchy: capitals promoted (larger, bold, dark ink); towns demoted
    // (smaller, muted brown) so the eye reads the capitals first.
    const label = svgEl("text", {
      class: "city-label " + (c.isCapital ? "city-capital" : "city-town"),
      x: c.x + 5, y: c.y + 3, "font-size": c.isCapital ? 10 : 8,
      "font-weight": c.isCapital ? 600 : 400,
      fill: c.isCapital ? "#2a2118" : "#6b5d42",
      stroke: PARCHMENT, "stroke-width": 1.6, "paint-order": "stroke",
    });
    label.textContent = c.name;
    markers.appendChild(label);
  }
  root.appendChild(markers);

  // biome legend: terrain view only (the nation legend, from politicalLayer, replaces
  // it in political view). Rendered conditionally — not CSS-hidden — so exports match.
  if (view === "terrain") {
    const present = [...byBiome.keys()].sort((a, b) => a - b);
    const legend = svgEl("g", { class: "legend biome-legend" });
    const x0 = 14, y0 = grid.height - 14 - present.length * 14;
    legend.appendChild(svgEl("rect", {
      x: x0 - 5, y: y0 - 10, width: 104, height: present.length * 14 + 14, rx: 3,
      fill: "#f7f2e6", "fill-opacity": 0.92, stroke: "#cbb784", "stroke-width": 0.5,
    }));
    present.forEach((bm, i) => {
      const y = y0 + i * 14;
      legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 8, width: 10, height: 10, fill: BIOME_COLORS[bm], stroke: "#9a8a70", "stroke-width": 0.4 }));
      const t = svgEl("text", { x: x0 + 16, y: y, "font-size": 9, fill: "#4a3f2c" });
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
      eg.appendChild(svgEl("path", {
        class: "econ-zone", "data-zone": cell,
        d: `M${x.toFixed(1)},${(y - 4).toFixed(1)}L${(x + 4).toFixed(1)},${y.toFixed(1)}L${x.toFixed(1)},${(y + 4).toFixed(1)}L${(x - 4).toFixed(1)},${y.toFixed(1)}Z`,
        fill: "#e0a83a", stroke: "#7a5a1a", "stroke-width": 0.8,
      }));
    }
    root.appendChild(eg);
  }

  root.appendChild(compassRose(grid.width - 26, 28, 14, t(lang, "compassN")));
  root.appendChild(scaleBar(grid.width, grid.height, lang));

  // the world's name, an atlas title cartouche at the top-centre
  const title = svgEl("g", { class: "world-name" });
  const wt = svgEl("text", {
    class: "world-name-text", x: grid.width / 2, y: 30, "text-anchor": "middle",
    "font-size": 22, fill: INK, stroke: PARCHMENT, "stroke-width": 3, "paint-order": "stroke",
  });
  wt.textContent = world.name;
  title.appendChild(wt);
  title.appendChild(svgEl("line", { x1: grid.width / 2 - 70, y1: 38, x2: grid.width / 2 + 70, y2: 38, stroke: INK, "stroke-width": 0.6 }));
  root.appendChild(title);

  root.appendChild(mapFrame(grid.width, grid.height));

  return root;
}
