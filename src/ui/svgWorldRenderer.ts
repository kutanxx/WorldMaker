import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { OCEAN, BIOME_COLORS, BIOME_NAMES } from "../engine/biome";
import { coastline, type Segment } from "../engine/borders";
import { cellPath, segPath } from "./svgPaths";
import { politicalLayer, type PoliticalOpts } from "./politicalLayer";
import { cultureLayer } from "./cultureLayer";

export type MapView = "terrain" | "political" | "culture";

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

function compassRose(cx: number, cy: number, r: number): SVGElement {
  const g = svgEl("g", { class: "compass" });
  g.appendChild(svgEl("circle", { cx, cy, r, fill: PARCHMENT, "fill-opacity": 0.55, stroke: INK, "stroke-width": 0.8 }));
  g.appendChild(svgEl("path", { d: starPath(cx, cy, 4, r * 0.92, r * 0.3), fill: INK }));
  const n = svgEl("text", { class: "compass-n", x: cx, y: cy - r - 2, "text-anchor": "middle", "font-size": 7, fill: INK });
  n.textContent = "N";
  g.appendChild(n);
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

export function renderWorld(world: World, view: MapView = "terrain", econZones: number[] = []): SVGSVGElement {
  const grid = world.grid;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: `world view-${view}`,
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: BIOME_COLORS[OCEAN] }));

  // biome fills (ocean is the background rect, so skip OCEAN cells)
  const byBiome = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const bm = world.biome[i];
    if (bm === OCEAN) continue;
    byBiome.set(bm, (byBiome.get(bm) ?? "") + cellPath(grid.polygons[i]));
  }
  // Mute biomes under the political/culture views so the overlay fills dominate. Inline (not
  // CSS) so an exported standalone SVG/PNG matches the on-screen map.
  const biomes = svgEl("g", view !== "terrain" ? { class: "biomes", opacity: 0.45 } : { class: "biomes" });
  for (const [bm, d] of byBiome) {
    biomes.appendChild(svgEl("path", { class: "biome", "data-biome": bm, d, fill: BIOME_COLORS[bm] }));
  }
  root.appendChild(biomes);

  root.appendChild(svgEl("path", {
    class: "coastline", d: segPath(coastline(grid, world.terrain)),
    fill: "none", stroke: "#5f7888", "stroke-width": 0.6,
  }));
  const slot = svgEl("g", { class: "political-slot" });
  slot.appendChild(view === "culture"
    ? cultureLayer(grid, world.cultureOf, world.cultures)
    : politicalLayer(grid, world.polityOf, world.polities, politicalOpts(view)));
  root.appendChild(slot);

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

  // geographic feature names (above the political fills, below the settlements)
  const regionLabels = svgEl("g", { class: "region-labels" });
  for (const r of world.regions) {
    const fs = 9 + Math.min(7, r.cells / 90);
    const t = svgEl("text", {
      class: "region-label", x: r.centroid[0].toFixed(1), y: r.centroid[1].toFixed(1),
      "text-anchor": "middle", "font-size": fs.toFixed(1), fill: "#5a4a34",
      stroke: PARCHMENT, "stroke-width": 2, "paint-order": "stroke",
    });
    t.textContent = r.name;
    regionLabels.appendChild(t);
  }
  root.appendChild(regionLabels);

  const riverLabels = svgEl("g", { class: "river-labels" });
  for (const r of world.rivers) {
    const mid = r.path[Math.floor(r.path.length / 2)];
    const fs = 8 + Math.min(5, r.flux / 40);
    const t = svgEl("text", {
      class: "river-label", x: mid[0].toFixed(1), y: mid[1].toFixed(1),
      "text-anchor": "middle", "font-size": fs.toFixed(1), fill: "#3f5d78",
      stroke: PARCHMENT, "stroke-width": 1.8, "paint-order": "stroke", "font-style": "italic",
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
    const label = svgEl("text", {
      class: "city-label", x: c.x + 5, y: c.y + 3, "font-size": 8.5,
      fill: "#2a2118", stroke: PARCHMENT, "stroke-width": 1.6, "paint-order": "stroke",
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
      t.textContent = BIOME_NAMES[bm] ?? "";
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

  root.appendChild(compassRose(grid.width - 26, 28, 14));

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
